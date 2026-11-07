import assert from "node:assert/strict";
import test from "node:test";
import { parseMemoryEntity } from "../src/memory/store.js";
import { collectMemoryReferenceTargets } from "../src/memory/references.js";
import { parseSchemaModel, MEMSPHERE_SCHEMA_MODEL } from "../src/memory/schema-model.js";
import { graphDomainFixture } from "./helpers/graph-domain.js";
import { validateGraphBody } from "../src/context_control/graph-content.js";
import { checkModelDefinition } from "../src/project/model-validation.js";
import type { GraphProcedureMemory } from "../src/memory/ast.js";
const syntax = "memsphere-20261027-stable";
const definition = `!schema\nsyntax: ${syntax}\ntype: object\nfields: [summary]\n`;
function procedure(model: unknown = { definedBy: MEMSPHERE_SCHEMA_MODEL, definition }, contentType = "application/json") {
  return parseMemoryEntity("procedures", { tag: "!procedure", syntax, mode: "graph", names: ["schema-graph"], defines: ["Schema artifacts"], actions: [{ tag: "!action", id: "write", description: "Write", dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "Report", model, payload: { contentType } } }] }) as GraphProcedureMemory;
}
test("graph accepts inline YAML and canonical Schema references, rejecting ambiguous model sources", () => {
  const p = procedure({ definedBy: MEMSPHERE_SCHEMA_MODEL, ref: "schemas/report" });
  assert.deepEqual(collectMemoryReferenceTargets(p), ["schemas/report"]);
  for (const model of [{ definedBy: MEMSPHERE_SCHEMA_MODEL }, { definedBy: MEMSPHERE_SCHEMA_MODEL, ref: "schemas/report", definition }, { definedBy: "raw.json", ref: "schemas/report" }, { definedBy: MEMSPHERE_SCHEMA_MODEL, ref: "statements/report" }]) assert.throws(() => procedure(model));
  assert.throws(() => parseSchemaModel("!schema\ntype: string\n"), /explicit syntax/);
});
test("graph Schema validates structure while retaining independent model-management scope", async () => {
  await assert.rejects(checkModelDefinition({}, { modelRef: "report.json", metaModel: MEMSPHERE_SCHEMA_MODEL, source: definition, definition: undefined }), /only by graph/);
  const spec = procedure().actions[0].artifact!;
  const reader = async () => { throw Error("unexpected contentRef"); };
  await validateGraphBody({ content: { model: { definedBy: MEMSPHERE_SCHEMA_MODEL, definition }, payload: { contentType: "application/json", content: '{"summary":"ok"}' } } }, spec, reader);
  await assert.rejects(validateGraphBody({ content: { model: { definedBy: MEMSPHERE_SCHEMA_MODEL, definition }, payload: { contentType: "application/json", content: '{}' } } }, spec, reader), /summary/);
  const { runtime } = await checkModelDefinition({}, { modelRef: "report.json", metaModel: MEMSPHERE_SCHEMA_MODEL, source: definition, definition: undefined, scope: "graph" });
  assert.throws(() => runtime!.reflect({}), { code: "MODEL_REFLECTION_UNSUPPORTED" });
});
test("Run freezes a Schema model and submits according to the frozen definition", async t => {
  const { service } = await graphDomainFixture(t);
  await service.withGraph(async g => {
    const start = await g.start({ name: "Report", procedure: procedure() });
    assert.equal(start.run.schemaContracts?.write.compiledVersion, 1);
    const step = start.steps[0]; await g.enter(start.run.id, step.id);
    await assert.rejects(g.report(start.run.id, step.id, { text: '{}' }), /summary/);
    const result = await g.report(start.run.id, step.id, { text: '{"summary":"ok"}' });
    assert.equal(result.step.status, "done");
  });
});

test("Schema writing saves one draft, rejects stale positions and submits that same identity", async t => {
  const { service } = await graphDomainFixture(t);
  await service.withGraph(async g => {
    const start = await g.start({ name: "Draft", procedure: procedure() }), run = start.run.id, step = start.steps[0].id;
    await g.enter(run, step);
    const initial = await g.enterSchema(run, step);
    assert.equal(initial.phase, "writing");
    assert.equal((await g.enterSchema(run, step)).draft!.id, initial.draft!.id);
    await assert.rejects(g.report(run, step, { text: '{"summary":"bypass"}' }), { code: "SCHEMA_INCOMPLETE" });
    const saved = await g.schemaWrite(run, step, "report", initial.position!, '{"summary":"draft"}');
    assert.equal(saved.draft!.id, initial.draft!.id);
    assert.equal(saved.phase, "awaiting_finalization");
    await assert.rejects(g.schemaWrite(run, step, "report", initial.position!, '{"summary":"stale"}'), { code: "SCHEMA_POSITION_CHANGED" });
    await assert.rejects(g.report(run, step, { text: '{}' }), /summary/);
    assert.equal((await g.schemaShow(run, step)).draft!.content!.payload.content, '{"summary":"draft"}');
    const result = await g.report(run, step, { text: '{"summary":"edited final copy"}' });
    assert.equal(result.artifact.id, initial.draft!.id);
    assert.equal(result.artifact.status, "submitted");
    assert.equal(result.artifact.content!.payload.content, '{"summary":"edited final copy"}');
    assert.equal(result.snapshot.artifacts.length, 1);
  });
});
test("submission recovers a sealed draft after the Step frame write is interrupted", async t => {
  const { service } = await graphDomainFixture(t);
  await service.withGraph(async g => {
    const start = await g.start({ name: "Recovery", procedure: procedure() }), run = start.run.id, step = start.steps[0].id;
    await g.enter(run, step); const writing = await g.enterSchema(run, step);
    await g.schemaWrite(run, step, "report", writing.position!, '{"summary":"draft"}');
    const update = service.stores.step.update.bind(service.stores.step);
    let fail = true;
    service.stores.step.update = async (c, id, value, options) => {
      if (fail && (value as import("../src/context_control/types.js").Step).frames?.length) { fail = false; throw Error("frame interrupted"); }
      return update(c, id, value, options);
    };
    await assert.rejects(g.report(run, step, { text: '{"summary":"final"}' }), /frame interrupted/);
    const sealed = await g.schemaShow(run, step); assert.equal(sealed.phase, "submitting");
    const recovered = await g.advance(run);
    assert.equal(recovered.artifacts.length, 1); assert.equal(recovered.artifacts[0].id, writing.draft!.id);
    assert.equal(recovered.artifacts[0].content!.payload.content, '{"summary":"final"}');
    assert.equal(recovered.steps[0].status, "done");
    assert.deepEqual((await g.advance(run)).artifacts, recovered.artifacts);
  });
});

test("outline writing preserves optional skips and Repeat groups in one draft", async t => {
  const { service } = await graphDomainFixture(t);
  const yaml = `!schema\nsyntax: ${syntax}\ntype: object\nformat:\n  layout: outline\nfields:\n  - summary\n  - !schema\n    name: notes\n    optional: true\n  - !repeat\n    limit: {min: 0, max: 2}\n    body: [evidence]\n`;
  await service.withGraph(async g => {
    const start = await g.start({ name: "Outline", procedure: procedure({ definedBy: MEMSPHERE_SCHEMA_MODEL, definition: yaml }, "text/markdown") });
    const run = start.run.id, step = start.steps[0].id; await g.enter(run, step);
    let state = await g.enterSchema(run, step); const id = state.draft!.id;
    state = await g.schemaWrite(run, step, "report", state.position!, "# Report");
    const stale = state.position!;
    await assert.rejects(g.schemaWrite(run, step, "skip", state.position), /optional/);
    state = await g.schemaWrite(run, step, "report", state.position!, "Conclusion");
    await assert.rejects(g.schemaWrite(run, step, "report", stale, "wrong notes"), { code: "SCHEMA_POSITION_CHANGED" });
    state = await g.schemaWrite(run, step, "skip", state.position!);
    await assert.rejects(g.schemaWrite(run, step, "repeat", state.position!, 3), /Repeat count/);
    state = await g.schemaWrite(run, step, "repeat", state.position!, 2);
    state = await g.schemaWrite(run, step, "report", state.position!, "First source");
    state = await g.schemaWrite(run, step, "report", state.position!, "Second source");
    assert.equal(state.phase, "awaiting_finalization"); assert.equal(state.draft!.id, id);
    assert.match(state.draft!.content!.payload.content, /evidence 1/);
    const result = await g.report(run, step, { text: state.draft!.content!.payload.content });
    assert.equal(result.artifact.id, id); assert.equal(result.snapshot.artifacts.length, 1);
  });
});
test("a field failing its Schema keeps the same position and draft content", async t => {
  const { service } = await graphDomainFixture(t);
  await service.withGraph(async g => {
    const start = await g.start({ name: "Field validation", procedure: procedure() });
    const run = start.run.id, step = start.steps[0].id; await g.enter(run, step); const initial = await g.enterSchema(run, step);
    await assert.rejects(g.schemaWrite(run, step, "report", initial.position!, '{}'), /summary/);
    const after = await g.schemaShow(run, step); assert.equal(after.position, initial.position); assert.equal(after.draft!.content!.payload.content, "");
  });
});

test("first writing entry wins against a direct report already preparing its frame", async t => {
  const { service } = await graphDomainFixture(t);
  await service.withGraph(async g => {
    const start = await g.start({ name: "Path race", procedure: procedure() }), run = start.run.id, step = start.steps[0].id; await g.enter(run, step);
    let reached!: () => void, release!: () => void;
    const atFrame = new Promise<void>(r => { reached = r; }), gate = new Promise<void>(r => { release = r; });
    const update = service.stores.step.update.bind(service.stores.step);
    service.stores.step.update = async (c, id, value, options) => {
      const candidate = value as import("../src/context_control/types.js").Step;
      if (candidate.frames?.length && !candidate.writing) { reached(); await gate; }
      return update(c, id, value, options);
    };
    const reporting = g.report(run, step, { text: '{"summary":"direct"}' });
    await atFrame; const writing = await g.enterSchema(run, step); release();
    await assert.rejects(reporting, { code: "REVISION_CONFLICT" });
    const snapshot = await g.snapshot(run); assert.equal(snapshot.artifacts.length, 1); assert.equal(snapshot.artifacts[0].id, writing.draft!.id);
    assert.equal(snapshot.artifacts[0].status, "draft"); assert.equal(snapshot.steps[0].status, "running");
  });
});
test("a direct submission wins against a first writing entry awaiting its Step CAS", async t => {
  const { service } = await graphDomainFixture(t);
  await service.withGraph(async g => {
    const start = await g.start({ name: "Direct path race", procedure: procedure() }), run = start.run.id, step = start.steps[0].id; await g.enter(run, step);
    let reached!: () => void, release!: () => void;
    const atClaim = new Promise<void>(r => { reached = r; }), gate = new Promise<void>(r => { release = r; });
    const update = service.stores.step.update.bind(service.stores.step);
    service.stores.step.update = async (c, id, value, options) => {
      const candidate = value as import("../src/context_control/types.js").Step;
      if (candidate.writing && !candidate.frames?.length) { reached(); await gate; }
      return update(c, id, value, options);
    };
    const entering = g.enterSchema(run, step); await atClaim;
    const result = await g.report(run, step, { text: '{"summary":"direct"}' }); release();
    await assert.rejects(entering, { code: "REVISION_CONFLICT" });
    assert.equal(result.snapshot.artifacts.length, 1); assert.equal(result.step.status, "done"); assert.equal((await g.snapshot(run)).artifacts.length, 1);
  });
});
for (const permissions of [["artifact.read"], ["artifact.read", "artifact.write"]] as const) test(`Schema operations respect ${permissions.join("+")} permissions`, async t => {
  const { service } = await graphDomainFixture(t);
  await service.withGraph(async g => {
    const start = await g.start({ name: "Permissions", procedure: procedure(), controlPlane: { runner: { permissions: [...permissions] }, actors: {} } });
    const run = start.run.id, step = start.steps[0].id; await g.enter(run, step);
    if (permissions.length === 1) {
      await assert.rejects(g.enterSchema(run, step), { code: "PERMISSION_DENIED" }); assert.equal((await g.snapshot(run)).artifacts.length, 0);
    } else {
      const writing = await g.enterSchema(run, step); await g.schemaWrite(run, step, "report", writing.position!, '{"summary":"draft"}');
      await assert.rejects(g.report(run, step, { text: '{"summary":"final"}' }), { code: "PERMISSION_DENIED" });
      assert.equal((await g.schemaShow(run, step)).phase, "awaiting_finalization");
    }
  });
});

test("referenced Schema and rules are frozen, with cycles rejected before creating a Run", async t => {
  const { service } = await graphDomainFixture(t);
  const p = procedure({ definedBy: MEMSPHERE_SCHEMA_MODEL, ref: "schemas/report" });
  const { serializeMemoryYaml } = await import("../src/memory/serializer.js");
  const source = `!schema\nsyntax: ${syntax}\nname: report\ntype: object\nfields: [summary]\n`;
  const memories = { "procedures/schema-graph": { memoryRef: "procedures/schema-graph", payload: { contentType: "application/yaml", content: serializeMemoryYaml(p) } }, "schemas/report": { memoryRef: "schemas/report", payload: { contentType: "application/yaml", content: source } } };
  await service.withGraph(async g => {
    const start = await g.start({ name: "Reference", procedure: p, memorySnapshot: { memories } });
    memories["schemas/report"].payload.content = source.replace("summary", "changed");
    await g.enter(start.run.id, start.steps[0].id);
    const result = await g.report(start.run.id, start.steps[0].id, { text: '{"summary":"frozen"}' });
    assert.equal(result.step.status, "done");
    const cycle = source.replace("fields: [summary]", "fields: [!ref {target: schemas/report}]");
    memories["schemas/report"].payload.content = cycle;
    await assert.rejects(g.start({ name: "Cycle", procedure: p, memorySnapshot: { memories } }), /Circular Schema/);
  });
});
test("Schema Review projection distinguishes repeated field instances and explains absent optional fields", async () => {
  const { freezeSchemaContract, schemaReviewSources } = await import("../src/context_control/schema-contract.js");
  const yaml = `!schema\nsyntax: ${syntax}\ntype: object\nformat: {name: markdown, layout: outline}\nfields:\n  - !schema\n    name: notes\n    optional: true\n    asserts: [Explain notes]\n  - !repeat\n    limit: {min: 0, max: 2}\n    body:\n      - !schema\n        name: evidence\n        asserts: [Cite the source]\n`;
  const spec = procedure({ definedBy: MEMSPHERE_SCHEMA_MODEL, definition: yaml }, "text/markdown").actions[0].artifact!;
  const frozen = await freezeSchemaContract(spec, {}, { kind: "step", path: "model.definition" });
  const sources = await schemaReviewSources(frozen, "text/markdown", Buffer.from("# Report\n\n## First evidence\nSource one\n\n## Second evidence\nSource two"));
  const repeated = sources.filter(s => s.name.startsWith("evidence["));
  assert.equal(repeated.length, 2); assert.notEqual(repeated[0].name, repeated[1].name);
  assert.match(repeated[0].defines!.join("\n"), /Source one/); assert.doesNotMatch(repeated[0].defines!.join("\n"), /Source two/);
  assert.match(repeated[1].defines!.join("\n"), /Source two/);
  assert.equal(repeated[0].source.path, repeated[1].source.path);
  assert.ok(sources.some(s => s.name.includes("notes (no content instance)")));
  const empty = await schemaReviewSources(frozen, "text/markdown", Buffer.from(""));
  assert.ok(empty.some(s => s.name.includes("evidence (no content instance)")));
});
test("structured graph submissions cannot replace the frozen Schema with another accepting model", async t => {
  const { service } = await graphDomainFixture(t);
  await service.withGraph(async g => {
    const start = await g.start({ name: "Contract identity", procedure: procedure() });
    const run = start.run.id, step = start.steps[0].id; await g.enter(run, step);
    const body = (source: string) => ({ content: { model: { definedBy: MEMSPHERE_SCHEMA_MODEL, definition: source }, payload: { contentType: "application/json", content: '{"summary":"ok"}' } } });
    await assert.rejects(g.report(run, step, body(definition.replace('fields: [summary]', 'fields: [summary]\ndefines: [Another meaning]'))), { code: "ARTIFACT_CONTRACT_MISMATCH" });
    assert.equal((await g.snapshot(run)).artifacts.length, 0);
    const result = await g.report(run, step, body(definition.replace('type: object\nfields: [summary]', 'fields: [summary]\ntype: object')));
    assert.equal(result.step.status, "done");
  });
});

for (const [type, contentType, value] of [
  ["object", "application/yaml", "summary: YAML value\n"],
  ["array", "application/json", '["first","second"]'],
  ["number", "application/json", "42"],
  ["boolean", "application/yaml", "false\n"],
] as const) test(`progressive ${type} preserves original ${contentType} serialization`, async t => {
  const { service } = await graphDomainFixture(t);
  const source = `!schema\nsyntax: ${syntax}\ntype: ${type}\n${type === "object" ? "fields: [summary]\n" : type === "array" ? "item: !schema {type: string}\n" : ""}`;
  await service.withGraph(async g => {
    const start = await g.start({ name: "Serialization", procedure: procedure({ definedBy: MEMSPHERE_SCHEMA_MODEL, definition: source }, contentType) });
    const run = start.run.id, step = start.steps[0].id; await g.enter(run, step);
    const initial = await g.enterSchema(run, step);
    const saved = await g.schemaWrite(run, step, "report", initial.position!, value);
    assert.equal(saved.phase, "awaiting_finalization"); assert.equal(saved.draft!.content!.payload.content, value);
    const result = await g.report(run, step, { text: value });
    assert.equal(result.artifact.id, initial.draft!.id); assert.equal(result.artifact.content!.payload.content, value);
  });
});
test("skipping an optional outline object skips its children and continues at its sibling", async t => {
  const { service } = await graphDomainFixture(t);
  const source = `!schema\nsyntax: ${syntax}\ntype: object\nformat: {layout: outline}\nfields:\n  - !schema\n    name: notes\n    optional: true\n    fields: [detail]\n  - summary\n`;
  await service.withGraph(async g => {
    const start = await g.start({ name: "Optional subtree", procedure: procedure({ definedBy: MEMSPHERE_SCHEMA_MODEL, definition: source }, "text/markdown") });
    const run = start.run.id, step = start.steps[0].id; await g.enter(run, step);
    let state = await g.enterSchema(run, step);
    state = await g.schemaWrite(run, step, "report", state.position!, "# Report");
    state = await g.schemaWrite(run, step, "skip", state.position!);
    assert.equal(state.current!.artifact, "Report.summary");
    state = await g.schemaWrite(run, step, "report", state.position!, "Conclusion");
    assert.equal(state.phase, "awaiting_finalization");
    assert.doesNotMatch(state.draft!.content!.payload.content, /notes|detail/);
    assert.equal((await g.report(run, step, { text: state.draft!.content!.payload.content })).step.status, "done");
  });
});
test("failed field validation is visible until the draft advances", async t => {
  const { service } = await graphDomainFixture(t);
  await service.withGraph(async g => {
    const start = await g.start({ name: "Validation progress", procedure: procedure() });
    const run = start.run.id, step = start.steps[0].id; await g.enter(run, step);
    const initial = await g.enterSchema(run, step);
    await assert.rejects(g.schemaWrite(run, step, "report", initial.position!, '{"summary":'), /JSON/);
    assert.equal((await g.schemaShow(run, step)).validation!.status, "failed");
    const saved = await g.schemaWrite(run, step, "report", initial.position!, '{"summary":"corrected"}');
    assert.equal(saved.validation, undefined);
  });
});
test("unsupported frozen contract versions fail without recompiling current Memory", async () => {
  const { resolvedArtifact } = await import("../src/context_control/schema-contract.js");
  const spec = procedure().actions[0].artifact!;
  assert.throws(() => resolvedArtifact({ id: "old-run", schemaContracts: { write: { compiledVersion: 99 } } } as unknown as import("../src/context_control/types.js").Run, "write", spec), { code: "SCHEMA_CONTRACT_VERSION_UNSUPPORTED" });
});

test("a requested revision starts a new draft and preserves the preceding submission and Review", async t => {
  const { service } = await graphDomainFixture(t);
  const p = procedure(); p.actions[0].artifact!.review = ["approval"];
  await service.withGraph(async g => {
    const start = await g.start({ name: "Revision", procedure: p, controlPlane: { runner: { permissions: ["artifact.read", "artifact.write", "artifact.submit", "decision.decide"] }, actors: { human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] } } }, reviewConfiguration: { reviews: { "schema-graph#actions[write]": { policy: "artifact_acceptance.unanimous" } }, slots: { "schema-graph::approval": { actorIds: ["human"] } } } });
    const run = start.run.id, step = start.steps[0].id; await g.enter(run, step);
    let draft = await g.enterSchema(run, step); draft = await g.schemaWrite(run, step, "report", draft.position!, '{"summary":"first"}');
    const first = await g.report(run, step, { text: draft.draft!.content!.payload.content });
    await g.submitReview(run, step, first.step.reviewRounds![0].id, "runner", "request_changes", [], "Clarify summary");
    const revision = await g.enterSchema(run, step);
    assert.notEqual(revision.draft!.id, first.artifact.id); assert.equal(revision.draft!.revisedFrom, first.artifact.id);
    assert.equal((await g.enterSchema(run, step)).draft!.id, revision.draft!.id);
    await g.schemaWrite(run, step, "report", revision.position!, '{"summary":"second"}');
    const second = await g.report(run, step, { text: '{"summary":"second"}', revisionSummary: "Clarified" });
    assert.equal(second.artifact.id, revision.draft!.id); assert.equal(second.artifact.revisedFrom, first.artifact.id);
    assert.equal(second.snapshot.artifacts.find(a => a.id === first.artifact.id)!.content!.payload.content, '{"summary":"first"}');
    assert.equal(second.step.reviewRounds!.length, 2);
  });
});
test("graph persists content-specific Schema rules into the actual Reviewer node tree", async t => {
  const { service } = await graphDomainFixture(t);
  const { allReviewNodes } = await import("../src/review-nodes.js");
  const source = `!schema\nsyntax: ${syntax}\ntype: object\nfields:\n  - !schema\n    name: summary\n    asserts: [Explain the conclusion]\n`;
  const p = procedure({ definedBy: MEMSPHERE_SCHEMA_MODEL, definition: source }); p.actions[0].artifact!.review = ["approval"];
  await service.withGraph(async g => {
    const start = await g.start({ name: "Review tree", procedure: p, controlPlane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { agent: { kind: "agent", name: "Reviewer", permissions: ["artifact.read", "decision.assess"], agent: { provider: "test", providerType: "traex", command: process.execPath, args: [], env: {}, startupTimeoutMs: 1000, idleTimeoutMs: 1000 } } } }, reviewConfiguration: { reviews: { "schema-graph#actions[write]": { policy: "artifact_acceptance.unanimous" } }, slots: { "schema-graph::approval": { actorIds: ["agent"] } } } });
    const run = start.run.id, step = start.steps[0].id; await g.enter(run, step);
    const result = await g.report(run, step, { text: '{"summary":"Real conclusion"}' });
    const review = result.snapshot.reviews.find(r => r.reviewer.actorId === "agent")!;
    const nodes = allReviewNodes(review.nodeTree!);
    const summary = nodes.find(n => n.asserts.some(a => a.text === "Explain the conclusion"))!;
    assert.ok(summary); assert.match(summary.defines!.join("\n"), /Real conclusion/);
    assert.equal(summary.source!.path, "actions[0].artifact.model.definition.fields[0]");
    assert.ok(nodes.some(n => n.kind === "open_review"));
  });
});

test("rewind preserves the old draft and rejects its writes while the replacement gets its own draft", async t => {
  const { service } = await graphDomainFixture(t);
  await service.withGraph(async g => {
    const start = await g.start({ name: "Draft rewind", procedure: procedure() });
    const run = start.run.id, step = start.steps[0].id; await g.enter(run, step);
    const initial = await g.enterSchema(run, step);
    const saved = await g.schemaWrite(run, step, "report", initial.position!, '{"summary":"old"}');
    const rewind = await g.rewind(run, step, "Revise requirements");
    await assert.rejects(g.schemaWrite(run, step, "report", initial.position!, '{"summary":"stale"}'), { code: "STEP_SUPERSEDED" });
    await g.enter(run, rewind.replacementStepId);
    const fresh = await g.enterSchema(run, rewind.replacementStepId);
    assert.notEqual(fresh.draft!.id, initial.draft!.id);
    assert.equal((await g.schemaShow(run, step)).draft!.content!.payload.content, saved.draft!.content!.payload.content);
    assert.equal((await g.snapshot(run)).completeIds.length, 0);
  });
});
test("Schema final submission accepts a frozen content reference and retains it during sealed recovery", async t => {
  const { service: base } = await graphDomainFixture(t);
  const { ContextControl } = await import("../src/context_control/service.js");
  const { createHash } = await import("node:crypto");
  const bytes = Buffer.from('{"summary":"referenced final"}');
  const service = new ContextControl(base.stores, async () => ({ bytes, contentType: "application/json" }));
  await service.withGraph(async g => {
    const start = await g.start({ name: "Referenced submission", procedure: procedure() });
    const run = start.run.id, step = start.steps[0].id; await g.enter(run, step);
    const draft = await g.enterSchema(run, step); await g.schemaWrite(run, step, "report", draft.position!, '{"summary":"draft"}');
    const update = service.stores.step.update.bind(service.stores.step); let fail = true;
    service.stores.step.update = async (context, id, value, options) => {
      if (fail && (value as import("../src/context_control/types.js").Step).frames?.length) { fail = false; throw Error("frame interrupted"); }
      return update(context, id, value, options);
    };
    const contentRef = { storeId: "external", dataId: "report", sha256: createHash("sha256").update(bytes).digest("hex") };
    await assert.rejects(g.report(run, step, { contentRef: { ...contentRef, sha256: "0".repeat(64) } }), { code: "CONTENT_CHANGED" });
    await assert.rejects(g.report(run, step, { contentRef }), /frame interrupted/);
    const sealed = (await g.schemaShow(run, step)).draft!;
    assert.equal(sealed.content, undefined); assert.deepEqual(sealed.contentRef, contentRef);
    const recovered = await g.advance(run);
    assert.equal(recovered.steps[0].status, "done"); assert.equal(recovered.artifacts[0].id, draft.draft!.id);
    assert.deepEqual(recovered.artifacts[0].contentRef, contentRef);
    assert.equal(Buffer.from((await g.readArtifact(run, draft.draft!.id)).bytes).toString(), bytes.toString());
  });
});
