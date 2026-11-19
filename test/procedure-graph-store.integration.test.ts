// @integration-platform: native — uses the real project context, file Stores and native locks.
import assert from "node:assert/strict";
import { addAbortListener } from "node:events";
import test, { type TestContext } from "node:test";
import { initializedContextFixture } from "./helpers/initialized-context.js";
import { openContextControl } from "../src/project/context-control.js";
import { openBusinessStore, removeBusinessStore } from "../src/project/business-stores.js";
import { readAll } from "../src/data/extensions/shared/payload.js";
import { graphStoreMemorySyntax } from "../src/memory/syntax.js";
import type { GraphProcedureMemory } from "../src/memory/ast.js";
import type { Step } from "../src/context_control/types.js";

const model = { definedBy: "json-schema/draft-07.json", definition: '{"type":"object"}' };
function procedure(operation: "upsert" | "create"): GraphProcedureMemory {
  return {
    tag: "!procedure", syntax: graphStoreMemorySyntax, mode: "graph",
    names: ["store-graph"], defines: ["Write a graph candidate"], goals: [],
    actions: [
      { tag: "!action", id: "write", description: "Write", dependencies: [{ tag: "!dependency", from: "START" }],
        artifact: { name: "Candidate", model, payload: { contentType: "application/json" }, store: { store_id: "records", operation } } },
      { tag: "!action", id: "next", description: "Consume", dependencies: [{ tag: "!dependency", from: "write" }],
        artifact: { name: "Next", model, payload: { contentType: "application/json" } } }
    ]
  };
}

async function fixture(t: TestContext, kind: "value" | "data" = "value") {
  const f = await initializedContextFixture(t, { "record.json": { type: "object", required: ["name"], properties: { name: { type: "string" } } } });
  await f.createStore("records", "record.json", kind);
  const service = (await openContextControl(f.root))!;
  const graph = procedure(kind === "value" ? "upsert" : "create");
  const { run, steps } = await service.withGraph(g => g.start({ name: "Store test", procedure: graph }));
  const id = steps[0].id;
  await service.withGraph(g => g.enter(run.id, id));
  const { store } = await openBusinessStore({}, f.root, "records");
  return { f, service, runId: run.id, id, store };
}

test("graph data create preserves original bytes and media type, with no synthetic revision", async t => {
  const { service, runId, id, store } = await fixture(t, "data");
  assert.equal(store.kind, "DataStore");
  const text = '{\n  "name": "report"\n}\n';
  await assert.rejects(service.withGraph(g => g.report(runId, id, { text, writeOptions: { data_id: "wrong.txt" } })), /MIME/);
  assert.deepEqual((await store.list({}, {})).items, []);
  const done = await service.withGraph(g => g.report(runId, id, { text }));
  const name = done.artifact.business!.destination.dataId;
  assert.match(name, /\.json$/);
  const row = await store.get({}, name);
  assert(row && !row.deleted);
  assert.equal(row.data.payload.contentType, "application/json");
  assert.equal(Buffer.from(await readAll({}, row.data.payload.content)).toString("utf8"), text);
  assert.equal(done.step.businessReceipt?.revision, undefined);
  assert.equal(done.step.businessReceipt?.artifactId, done.artifact.id);
});

test("invalid Graph Store bindings fail at startup", async t => {
  const f = await initializedContextFixture(t, { "record.json": { type: "object" } });
  await f.createStore("files", "record.json", "data");
  await f.createStore("values");
  const service = (await openContextControl(f.root))!;
  for (const [store_id, operation, code] of [
    ["missing", "create", "STORE_NOT_FOUND"],
    ["files", "upsert", "UNSUPPORTED_CAPABILITY"],
    ["values", "create", "UNSUPPORTED_CAPABILITY"],
    [service.stores.step.id, "upsert", "SYSTEM_STORE_FORBIDDEN"]
  ] as const) {
    const graph = procedure(operation);
    graph.actions[0].artifact!.store!.store_id = store_id;
    await assert.rejects(service.withGraph(g => g.start({ name: "Bad target", procedure: graph })), { code });
  }
  for (const id of ["files", "values"]) {
    const { store } = await openBusinessStore({}, f.root, id);
    assert.deepEqual((await store.list({}, {})).items, []);
  }
});

test("file Store rejects unmapped record IDs before freezing, then accepts its configured extension", async t => {
  const f = await initializedContextFixture(t, { "record.json": { type: "object" } });
  await f.createStore("records", "record.json", "data", {
    directory: "data/records",
    contentTypeExtensions: { "application/json": [".record"] }
  });
  const service = (await openContextControl(f.root))!;
  const { store } = await openBusinessStore({}, f.root, "records");
  assert.equal(store.kind, "DataStore");
  await service.withGraph(async g => {
    const { run, steps: [step] } = await g.start({ name: "Custom extension", procedure: procedure("create") });
    await g.enter(run.id, step.id);
    for (const [data_id, error] of [
      ["undecorated", /MIME/], ["standard.json", /MIME/],
      ["reports/../escape.record", /not portable/], [`${"a".repeat(250)}.record`, /255-byte/]
    ] as const) {
      await assert.rejects(g.report(run.id, step.id, { text: "{}", writeOptions: { data_id } }), error);
      const snapshot = await g.snapshot(run.id);
      assert.equal(snapshot.artifacts.length, 0);
      assert.equal(snapshot.steps.length, 1);
      assert.equal(snapshot.steps[0].businessReceipt, undefined);
      assert.deepEqual((await store.list({}, {})).items, []);
    }
    const data_id = `reports/${"a".repeat(248)}.record`;
    const result = await g.report(run.id, step.id, { text: "{}", writeOptions: { data_id } });
    assert.equal(result.artifact.business!.destination.dataId, data_id);
    const row = await store.get({}, data_id);
    assert(row && !row.deleted);
    assert.equal(row.data.payload.contentType, "application/json");
  });
});

for (const boundary of ["before-receipt", "after-receipt"] as const) test(`ordinary recovery never replays business upsert ${boundary}`, async t => {
  const { f, service, runId, id, store } = await fixture(t);
  assert.equal(store.kind, "ValueStore");
  const save = service.stores.step.update.bind(service.stores.step);
  service.stores.step.update = async (...args) => {
    const step = args[2] as Step;
    if (step.id === id && (boundary === "before-receipt" ? step.frames?.[0]?.submissionFrame.businessReceipt : step.status === "done"))
      throw new Error("interrupted state save");
    return save(...args);
  };
  await assert.rejects(service.withGraph(g => g.report(runId, id, { text: '{"name":"A"}', writeOptions: { data_id: "same" } })));
  assert.deepEqual((await store.get({}, "same"))?.value, { name: "A" });
  const b = await store.upsert!({}, "same", { name: "B" });
  const fresh = (await openContextControl(f.root))!;
  if (boundary === "before-receipt") {
    await assert.rejects(fresh.withGraph(g => g.advance(runId)), /unconfirmed/);
    const snapshot = await fresh.withGraph(g => g.snapshot(runId));
    assert.equal(snapshot.steps.length, 1);
    assert.equal(snapshot.steps[0].businessReceipt, undefined);
  } else {
    const snapshot = await fresh.withGraph(g => g.advance(runId));
    assert.equal(snapshot.steps.find(step => step.id === id)?.status, "done");
    assert.equal(snapshot.steps.filter(step => step.source?.actionId === "next").length, 1);
    await assert.rejects(fresh.withGraph(g => g.retryBusinessStore(runId, id)), /No unsuccessful/);
  }
  assert.deepEqual((await store.get({}, "same"))?.value, { name: "B" });
  assert.equal((await store.get({}, "same"))?.revision, b.revision);
});

test("review revision freezes business ID and only a passed candidate writes", async t => {
  const f = await initializedContextFixture(t, { "record.json": { type: "object" } });
  await f.createStore();
  const service = (await openContextControl(f.root))!;
  const graph = procedure("upsert");
  graph.actions[0].artifact!.review = ["owner"];
  const { run, steps } = await service.withGraph(g => g.start({
    procedure: graph, name: "Review before write",
    controlPlane: {
      acpProviders: {},
      runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
      actors: { owner: { name: "Owner", kind: "human", permissions: ["artifact.read", "decision.decide"] } }
    },
    reviewConfiguration: {
      reviews: { "store-graph#actions[write]": { policy: "artifact_acceptance.unanimous" } },
      slots: { "store-graph::owner": { actorIds: ["owner"] } }
    }
  }));
  const id = steps[0].id;
  const { store } = await openBusinessStore({}, f.root, "records");
  assert.equal(store.kind, "ValueStore");
  await service.withGraph(async g => {
    await g.enter(run.id, id);
    const first = await g.report(run.id, id, { text: '{"name":"draft"}', writeOptions: { data_id: "fixed" } });
    assert.equal(await store.get({}, "fixed"), undefined);
    await g.submitReview(run.id, id, first.step.reviewRounds![0].id, "owner", "request_changes", [{ body: "Revise" }]);
    await assert.rejects(g.report(run.id, id, { text: '{"name":"good"}', revisionSummary: "Changed", writeOptions: { data_id: "other" } }), /frozen/);
    const revised = await g.report(run.id, id, { text: '{"name":"good"}', revisionSummary: "Changed" });
    const round = revised.step.reviewRounds!.at(-1)!.id;
    await g.submitReview(run.id, id, round, "owner", "approve");
    assert.equal(await store.get({}, "fixed"), undefined);
    const approved = await g.submitReview(run.id, id, round, "runner", "approve");
    assert.deepEqual((await store.get({}, "fixed"))?.value, { name: "good" });
    assert.equal(approved.steps.find(step => step.id === id)?.businessReceipt?.revision, "1");
    assert.equal(approved.steps.filter(step => step.source?.actionId === "next").length, 1);
  });
});

test("graph uses the same Store capability for TOS ValueStore and TOS DataStore", async t => {
  const { useTosService } = await import("./support/tos-sdk-service.js");
  const { createBusinessStore } = await import("../src/project/business-stores.js");
  const transport = useTosService(t);
  const previousAk = process.env.GRAPH_ARTIFACT_TEST_AK;
  const previousSk = process.env.GRAPH_ARTIFACT_TEST_SK;
  process.env.GRAPH_ARTIFACT_TEST_AK = "fake-ak";
  process.env.GRAPH_ARTIFACT_TEST_SK = "fake-sk";
  t.after(() => {
    if (previousAk === undefined) delete process.env.GRAPH_ARTIFACT_TEST_AK; else process.env.GRAPH_ARTIFACT_TEST_AK = previousAk;
    if (previousSk === undefined) delete process.env.GRAPH_ARTIFACT_TEST_SK; else process.env.GRAPH_ARTIFACT_TEST_SK = previousSk;
  });
  for (const mode of ["value", "raw", "revision", "revision-timeout"] as const) {
    const operation = mode === "value" ? "upsert" : "create";
    const f = await initializedContextFixture(t, { "record.json": { type: "object" } });
    const common = {
      region: "cn-beijing", endpoint: "tos-cn-beijing.volces.com", bucket: "test-bucket", prefix: `graph-${mode}/`,
      credentials: { source: "env", accessKeyIdEnv: "GRAPH_ARTIFACT_TEST_AK", accessKeySecretEnv: "GRAPH_ARTIFACT_TEST_SK" }
    };
    await createBusinessStore({}, f.root, "records", operation === "upsert"
      ? { model: "record.json", kind: "value", factory: "memsphere/tos-json", config: common }
      : { model: "record.json", kind: "data", factory: "memsphere/tos", config: { ...common, mode: mode === "revision-timeout" ? "revision" : mode } });
    const service = (await openContextControl(f.root))!;
    const { run, steps } = await service.withGraph(g => g.start({ name: "Cloud target", procedure: procedure(operation) }));
    const put = transport.put.bind(transport);
    let requests = 0;
    const { TosRequestError } = await import("../src/data/extensions/tos-datastore/response.js");
    transport.put = async (...args) => {
      requests++;
      if (operation === "upsert" && requests === 1) throw new TosRequestError("PreconditionFailed", 412);
      const result = await put(...args);
      if (mode === "revision-timeout" && requests === 1) throw new TosRequestError("TOS_DEADLINE");
      return result;
    };
    await service.withGraph(async g => {
      await g.enter(run.id, steps[0].id);
      const report = () => g.report(run.id, steps[0].id, { text: '{ "name": "cloud" }', writeOptions: { data_id: "cloud" } });
      if (operation === "upsert") {
        await assert.rejects(report(), { code: "REVISION_CONFLICT" });
        await assert.rejects(g.advance(run.id), { code: "BUSINESS_WRITE_RECOVERY_REQUIRED" });
        assert.equal(requests, 1);
        const recovered = await g.retryBusinessStore(run.id, steps[0].id);
        const step = recovered.steps.find(step => step.id === steps[0].id)!;
        assert.equal(step.status, "done");
        assert.equal(typeof step.businessReceipt?.revision, "string");
        assert.equal(requests, 2);
      } else if (mode === "revision-timeout") {
        await assert.rejects(report(), { code: "BUSINESS_WRITE_UNCONFIRMED" });
        await assert.rejects(g.advance(run.id), { code: "BUSINESS_WRITE_RECOVERY_REQUIRED" });
        assert.equal(requests, 1);
        const snapshot = await g.snapshot(run.id);
        assert.equal(snapshot.steps.length, 1);
        assert.equal(snapshot.steps[0].businessReceipt, undefined);
      } else {
        const result = await report();
        assert.equal(result.step.status, "done");
        assert.equal(result.step.businessReceipt?.artifactId, result.artifact.id);
        assert.equal(result.step.businessReceipt?.revision, undefined);
        assert.equal(requests, 1);
      }
    });
    transport.put = put;
    assert([...transport.objects.keys()].some(key => key.startsWith(`graph-${mode}/cloud`)));
  }
});

test("create recovery never attributes another writer's identical record to the candidate", async t => {
  const { service, runId, id, store } = await fixture(t, "data");
  assert.equal(store.kind, "DataStore");
  const { bytesContent } = await import("../src/data/extensions/shared/payload.js");
  const text = '{"name":"same content"}';
  await store.create({}, { id: "same.json", model: "record.json", payload: { contentType: "application/json", content: bytesContent(Buffer.from(text)) } });
  const before = await store.get({}, "same.json");
  await assert.rejects(service.withGraph(g => g.report(runId, id, { text, writeOptions: { data_id: "same.json" } })), /already|exists/i);
  await assert.rejects(service.withGraph(g => g.retryBusinessStore(runId, id)), /already|exists/i);
  const snapshot = await service.withGraph(g => g.snapshot(runId));
  assert.equal(snapshot.steps.length, 1);
  assert.equal(snapshot.steps[0].businessReceipt, undefined);
  assert.equal(snapshot.steps[0].status, "running");
  const after = await store.get({}, "same.json");
  assert(after && !after.deleted && before && !before.deleted);
  assert.equal(after.revision, before.revision);
  assert.equal(Buffer.from(await readAll({}, after.data.payload.content)).toString(), text);
});

test("Schema draft stays in the Run and finalized value writes through the same candidate", async t => {
  const f = await initializedContextFixture(t, { "record.json": { type: "object", required: ["name"], properties: { name: { type: "string" } } } });
  await f.createStore();
  const service = (await openContextControl(f.root))!;
  const graph = procedure("upsert");
  graph.actions[0].artifact!.model = { definedBy: "memsphere/schema.json", definition: "!schema\nsyntax: memsphere-20261118-stable\ntype: object\nfields: [name]\n" };
  const { store } = await openBusinessStore({}, f.root, "records");
  assert.equal(store.kind, "ValueStore");
  await service.withGraph(async g => {
    const { run, steps } = await g.start({ name: "Schema write", procedure: graph });
    const id = steps[0].id;
    await g.enter(run.id, id);
    const draft = await g.enterSchema(run.id, id);
    await g.schemaWrite(run.id, id, "report", draft.position!, '{"name":"draft"}');
    assert.deepEqual((await store.list({}, {})).items, []);
    await assert.rejects(g.report(run.id, id, { text: '{}', writeOptions: { data_id: "record" } }));
    assert.deepEqual((await store.list({}, {})).items, []);
    const submitted = await g.report(run.id, id, { text: '{"name":"final"}', writeOptions: { data_id: "record" } });
    assert.equal(submitted.artifact.id, draft.draft!.id);
    assert.deepEqual((await store.get({}, "record"))?.value, { name: "final" });
    assert.deepEqual(JSON.parse(submitted.artifact.business!.valueJson), { name: "final" });
  });
});

test("explicit JSON null is an existing ValueStore record, not a missing record", async t => {
  const f = await initializedContextFixture(t, { "record.json": { type: "null" } });
  await f.createStore();
  const service = (await openContextControl(f.root))!;
  const graph = procedure("upsert");
  await assert.rejects(service.withGraph(g => g.start({ name: "Incompatible", procedure: graph })), { code: "STORE_MODEL_MISMATCH" });
  graph.actions[0].artifact!.model = { ...model, definition: '{"type":"null"}' };
  const { run, steps } = await service.withGraph(g => g.start({ name: "Null record", procedure: graph }));
  const { store } = await openBusinessStore({}, f.root, "records");
  assert.equal(store.kind, "ValueStore");
  assert.equal(await store.get({}, "nullable"), undefined);
  await service.withGraph(async g => {
    await g.enter(run.id, steps[0].id);
    await g.report(run.id, steps[0].id, { text: "null", writeOptions: { data_id: "nullable" } });
  });
  const row = await store.get({}, "nullable");
  assert(row);
  assert.equal(row.value, null);
});

test("Schema Markdown table freezes its array contract and writes typed values without changing the Artifact body", async t => {
  const f = await initializedContextFixture(t, {
    "record.json": { type: "array", items: { type: "object", required: ["quantity", "active"], properties: { quantity: { type: "number" }, active: { type: "boolean" } } } },
    "wrong.json": { type: "string" }
  });
  await f.createStore();
  await f.createStore("wrong", "wrong.json");
  const graph = procedure("upsert");
  const artifact = graph.actions[0].artifact!;
  artifact.payload.contentType = "text/markdown";
  artifact.model = { definedBy: "memsphere/schema.json", definition: `!schema
syntax: memsphere-20261118-stable
type: array
format: {layout: table}
items:
  - !schema
    type: object
    fields:
      - !schema
        names: [quantity, Qty]
        type: number
        format: plain
      - !schema
        names: [active, Enabled]
        type: boolean
        format: plain
  - !schema
    type: object
    fields:
      - !schema
        names: [quantity, Qty]
        type: boolean
        format: plain
      - !schema
        names: [active, Enabled]
        type: boolean
        format: plain
` };
  const service = (await openContextControl(f.root))!;
  const { store } = await openBusinessStore({}, f.root, "records");
  assert.equal(store.kind, "ValueStore");
  await service.withGraph(async g => {
    const wrongGraph = structuredClone(graph);
    wrongGraph.actions[0].artifact!.store!.store_id = "wrong";
    await assert.rejects(g.start({ name: "Wrong Schema destination", procedure: wrongGraph }), { code: "STORE_MODEL_MISMATCH" });
    const ref = "schemas/record-table";
    wrongGraph.actions[0].artifact!.model = { definedBy: artifact.model.definedBy, ref };
    const memories = { [ref]: { memoryRef: ref, payload: { contentType: "application/yaml", content: artifact.model.definition!.replace("type: array", "names: [record-table]\ntype: array") } } };
    await assert.rejects(g.start({ name: "Wrong referenced Schema destination", procedure: wrongGraph, memorySnapshot: { memories } }), { code: "STORE_MODEL_MISMATCH" });
    const { run, steps: [step] } = await g.start({ name: "Markdown Schema", procedure: graph });
    await g.enter(run.id, step.id);
    const table = "| Qty | Enabled |\n| --- | --- |\n| 42 | false |\n";
    const result = await g.report(run.id, step.id, { text: table, writeOptions: { data_id: "table" } });
    const expected = [{ quantity: 42, active: false }];
    const { graphArtifactDto } = await import("../src/context_control/review-repository.js");
    assert.deepEqual((await store.get({}, "table"))?.value, expected);
    assert.deepEqual(JSON.parse(result.artifact.business!.valueJson), expected);
    assert.deepEqual((await graphArtifactDto(service, result.artifact)).business?.value, expected);
    const body = await g.readArtifact(run.id, result.artifact.id);
    assert.equal(body.contentType, "text/markdown");
    assert.equal(Buffer.from(body.bytes).toString(), table);
  });
});

test("a referenced input becomes a fixed Artifact even after the source is deleted and the business record changes", async t => {
  const { f, service, runId, id, store } = await fixture(t);
  const { createHash } = await import("node:crypto");
  const { bytesContent } = await import("../src/data/extensions/shared/payload.js");
  await f.createStore("source", "record.json", "data");
  const source = (await openBusinessStore({}, f.root, "source")).store;
  assert.equal(source.kind, "DataStore");
  assert.equal(store.kind, "ValueStore");
  const text = '{ "name": "original" }\n';
  await source.create({}, { id: "source.json", model: "record.json", payload: { contentType: "application/json", content: bytesContent(Buffer.from(text)) } });
  const artifactId = await service.withGraph(async g => {
    const result = await g.report(runId, id, {
      contentRef: { storeId: "source", dataId: "source.json", sha256: createHash("sha256").update(text).digest("hex") },
      writeOptions: { data_id: "business" }
    });
    assert.equal(await source.delete({}, "source.json"), true);
    await store.upsert!({}, "business", { name: "updated" });
    const body = await g.readArtifact(runId, result.artifact.id);
    assert.equal(Buffer.from(body.bytes).toString(), text);
    assert.deepEqual(JSON.parse(result.artifact.business!.valueJson), { name: "original" });
    return result.artifact.id;
  });
  await service.abandon(runId, "Verify historical reads");
  for (const archived of [true, false]) {
    await service.archive(runId, archived);
    const body = await service.readArtifact(runId, artifactId);
    assert.equal(Buffer.from(body.bytes).toString(), text);
    assert.deepEqual((await store.get({}, "business"))?.value, { name: "updated" });
  }
  assert.equal(await store.delete({}, "business"), true);
  await removeBusinessStore({}, f.root, "records");
  const historical = await service.readArtifact(runId, artifactId);
  assert.equal(Buffer.from(historical.bytes).toString(), text);
});

test("Store model drift after startup does not produce an Artifact or write business data", async t => {
  const { f, service, runId, id, store } = await fixture(t);
  const { publishFixtureDefinition } = await import("./helpers/business-data.js");
  await publishFixtureDefinition(f.root, "record.json", '{"type":"object"}');
  await assert.rejects(service.withGraph(g => g.report(runId, id, { text: '{"name":"unchanged"}' })), { code: "MODEL_ARTIFACT_TARGET_CHANGED" });
  assert.deepEqual((await store.list({}, {})).items, []);
  const snapshot = await service.withGraph(g => g.snapshot(runId));
  assert.equal(snapshot.artifacts.length, 0);
  assert.equal(snapshot.steps.length, 1);
});

for (const [type, body, expected] of [["number", "42", 42], ["boolean", "false", false]] as const) {
  test(`plain Schema ${type} starts and writes a typed ValueStore record`, async t => {
    const f = await initializedContextFixture(t, { "record.json": { type } });
    await f.createStore();
    const { store } = await openBusinessStore({}, f.root, "records");
    assert.equal(store.kind, "ValueStore");
    const graph = procedure("upsert");
    const artifact = graph.actions[0].artifact!;
    artifact.model = { definedBy: "memsphere/schema.json", definition: `!schema\nsyntax: memsphere-20261118-stable\ntype: ${type}\nformat: plain\n` };
    artifact.payload.contentType = "text/plain";
    await (await openContextControl(f.root))!.withGraph(async g => {
      const { run, steps: [step] } = await g.start({ name: "Scalar Store", procedure: graph });
      await g.enter(run.id, step.id);
      await g.report(run.id, step.id, { text: body, writeOptions: { data_id: "scalar" } });
    });
    assert.equal((await store.get({}, "scalar"))?.value, expected);
  });
}

test("a loop and its rewind replacement each use a distinct default Store record", async t => {
  const f = await initializedContextFixture(t, { "record.json": { type: "object" } });
  await f.createStore();
  const { store } = await openBusinessStore({}, f.root, "records");
  assert.equal(store.kind, "ValueStore");
  const graph = procedure("upsert");
  const write = graph.actions[0];
  graph.actions = [write];
  write.dependencies.push({ tag: "!dependency", from: "write", when: "artifacts.write.again = true" });
  await (await openContextControl(f.root))!.withGraph(async g => {
    const { run, steps: [first] } = await g.start({ name: "Write in a loop", procedure: graph });
    await g.enter(run.id, first.id);
    const one = await g.report(run.id, first.id, { text: '{"again":true}' });
    const second = one.snapshot.steps.find(step => step.status === "pending")!;
    assert(second);
    await g.enter(run.id, second.id);
    const two = await g.report(run.id, second.id, { text: '{"again":false}' });
    const rewind = await g.rewind(run.id, second.id, "Replace second loop instance");
    await assert.rejects(g.retryBusinessStore(run.id, second.id), { code: "STEP_SUPERSEDED" });
    await g.enter(run.id, rewind.replacementStepId);
    const three = await g.report(run.id, rewind.replacementStepId, { text: '{"again":false,"revised":true}' });
    const writes = [one, two, three].map(result => result.artifact.business!.destination.dataId);
    assert.equal(new Set(writes).size, 3);
    assert.deepEqual(await Promise.all(writes.map(async id => (await store.get({}, id))?.value)), [
      { again: true }, { again: false }, { again: false, revised: true }
    ]);
    assert.equal(Buffer.from((await g.readArtifact(run.id, two.artifact.id)).bytes).toString(), '{"again":false}');
  });
});

test("an in-flight Graph write holds the Run lock until its receipt is persisted", { timeout: 15000 }, async t => {
  const { f, service, runId, id, store } = await fixture(t);
  assert.equal(store.kind, "ValueStore");
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const canceled = Promise.withResolvers<never>();
  const signal = AbortSignal.any([t.signal, AbortSignal.timeout(12000)]);
  const onAbort = addAbortListener(signal, () => canceled.reject(signal.reason));
  void canceled.promise.catch(() => undefined);
  const save = service.stores.step.update.bind(service.stores.step);
  service.stores.step.update = async (...args) => {
    const step = args[2] as Step;
    if (step.id === id && step.frames?.[0]?.submissionFrame.businessReceipt) {
      reached.resolve();
      await Promise.race([release.promise, canceled.promise]);
      signal.throwIfAborted();
    }
    return save(...args);
  };
  const pending = service.withGraph(g => g.report(runId, id, { text: '{"name":"first"}', writeOptions: { data_id: "held" } }));
  const settled = pending.then(() => undefined, () => undefined);
  f.beforeCleanup(async () => {
    release.resolve();
    const cleanupSignal = AbortSignal.timeout(5000);
    const cleanupTimeout = Promise.withResolvers<never>();
    const onTimeout = addAbortListener(cleanupSignal, () => cleanupTimeout.reject(cleanupSignal.reason));
    try { await Promise.race([settled, cleanupTimeout.promise]); }
    finally { onTimeout[Symbol.dispose](); }
  });
  try {
    await Promise.race([canceled.promise, reached.promise, pending.then(() => { throw new Error("Write completed without reaching the receipt gate"); })]);
    const independentService = (await openContextControl(f.root))!;
    await independentService.withGraph(async g => {
      const before = await g.snapshot(runId);
      const written = await store.get({}, "held");
      assert.deepEqual(written?.value, { name: "first" });
      assert.equal(before.steps.length, 1);
      assert.equal(before.steps[0].businessReceipt, undefined);
      for (const compete of [
        () => g.advance(runId),
        () => g.retryBusinessStore(runId, id),
        () => g.rewind(runId, id, "Compete with write"),
        () => g.abandon(runId)
      ]) {
        signal.throwIfAborted();
        await assert.rejects(compete(), { code: "LOCK_TIMEOUT" });
      }
      assert.deepEqual(await g.snapshot(runId), before);
      assert.deepEqual(await store.get({}, "held"), written);
    });
  } finally {
    release.resolve();
    try { await Promise.race([settled, canceled.promise]); }
    finally { onAbort[Symbol.dispose](); }
  }
  const completed = await pending;
  assert.equal(completed.step.businessReceipt?.revision, "1");
  assert.equal(completed.snapshot.steps.filter(step => step.source?.actionId === "next").length, 1);
});

test("finalized Schema writes its original JSON bytes to a file DataStore", async t => {
  const f = await initializedContextFixture(t, { "record.json": { type: "object", required: ["name"], properties: { name: { type: "string" } } } });
  await f.createStore("records", "record.json", "data");
  const service = (await openContextControl(f.root))!;
  const { store } = await openBusinessStore({}, f.root, "records");
  assert.equal(store.kind, "DataStore");
  const graph = procedure("create");
  graph.actions[0].artifact!.model = { definedBy: "memsphere/schema.json", definition: "!schema\nsyntax: memsphere-20261118-stable\ntype: object\nfields: [name]\n" };
  await service.withGraph(async g => {
    const { run, steps: [step] } = await g.start({ name: "Schema file", procedure: graph });
    await g.enter(run.id, step.id);
    const writing = await g.enterSchema(run.id, step.id);
    await g.schemaWrite(run.id, step.id, "report", writing.position!, '{"name":"draft"}');
    assert.deepEqual((await store.list({}, {})).items, []);
    const text = '{\n  "name": "final"\n}\n';
    const dataId = "reports/schema.json";
    const result = await g.report(run.id, step.id, { text, writeOptions: { data_id: dataId } });
    const stored = await store.get({}, dataId);
    assert(stored && !stored.deleted);
    assert.equal(stored.data.payload.contentType, "application/json");
    assert.equal(Buffer.from(await readAll({}, stored.data.payload.content)).toString(), text);
    assert.equal(Buffer.from((await g.readArtifact(run.id, result.artifact.id)).bytes).toString(), text);
    assert.equal(result.step.businessReceipt?.artifactId, writing.draft!.id);
  });
});
