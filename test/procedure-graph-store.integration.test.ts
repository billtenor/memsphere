// @integration-platform: native — uses the real project context, file Stores and native locks.
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { initializedContextFixture } from "./helpers/initialized-context.js";
import { openContextControl } from "../src/project/context-control.js";
import { openBusinessStore } from "../src/project/business-stores.js";
import { readAll } from "../src/data/extensions/shared/payload.js";
import { parseMemoryEntity } from "../src/memory/store.js";
import { serializeMemoryYaml } from "../src/memory/serializer.js";
import { parseMemoryYaml } from "../src/memory/yaml.js";
import { graphMemorySyntax, graphStoreMemorySyntax } from "../src/memory/syntax.js";
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

test("graph Store grammar is versioned and preserves the binding through serialization", () => {
  const graph = procedure("upsert");
  assert.throws(() => parseMemoryEntity("procedures", { ...graph, syntax: graphMemorySyntax }), /store/);
  const parsed = parseMemoryEntity("procedures", parseMemoryYaml(serializeMemoryYaml(graph)));
  assert.deepEqual(parsed, graph);
});

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
  for (const operation of ["upsert", "create"] as const) {
    const f = await initializedContextFixture(t, { "record.json": { type: "object" } });
    const common = {
      region: "cn-beijing", endpoint: "tos-cn-beijing.volces.com", bucket: "test-bucket", prefix: `graph-${operation}/`,
      credentials: { source: "env", accessKeyIdEnv: "GRAPH_ARTIFACT_TEST_AK", accessKeySecretEnv: "GRAPH_ARTIFACT_TEST_SK" }
    };
    await createBusinessStore({}, f.root, "records", operation === "upsert"
      ? { model: "record.json", kind: "value", factory: "memsphere/tos-json", config: common }
      : { model: "record.json", kind: "data", factory: "memsphere/tos", config: { ...common, mode: "raw" } });
    const service = (await openContextControl(f.root))!;
    const { run, steps } = await service.withGraph(g => g.start({ name: "Cloud target", procedure: procedure(operation) }));
    const put = transport.put.bind(transport);
    let requests = 0;
    const { TosRequestError } = await import("../src/data/extensions/tos-datastore/response.js");
    transport.put = async (...args) => {
      requests++;
      if (operation === "upsert" && requests === 1) throw new TosRequestError("PreconditionFailed", 412);
      return put(...args);
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
      } else {
        const result = await report();
        assert.equal(result.step.status, "done");
        assert.equal(result.step.businessReceipt?.artifactId, result.artifact.id);
        assert.equal(result.step.businessReceipt?.revision, undefined);
        assert.equal(requests, 1);
      }
    });
    transport.put = put;
    assert(transport.objects.has(operation === "upsert" ? "graph-upsert/cloud.json" : "graph-create/cloud"));
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
