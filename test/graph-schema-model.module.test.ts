import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseMemoryEntity } from "../src/memory/store.js";
import { collectMemoryReferenceTargets } from "../src/memory/references.js";
import { parseSchemaModel, MEMSPHERE_SCHEMA_MODEL } from "../src/memory/schema-model.js";
import { bounded } from "./helpers/fixture-process.js";
import { contextModuleFixture as graphDomainFixture } from "./helpers/module-context.js";
import { validateGraphBody } from "../src/context_control/graph-content.js";
import { checkModelDefinition } from "../src/project/model-validation.js";
import type { GraphProcedureMemory } from "../src/memory/ast.js";
const syntax = "memsphere-20261027-stable";
const definition = `!schema\nsyntax: ${syntax}\ntype: object\nfields: [summary]\n`;
function procedure(model: unknown = { definedBy: MEMSPHERE_SCHEMA_MODEL, definition }, contentType = "application/json") {
  return parseMemoryEntity("procedures", { tag: "!procedure", syntax, mode: "graph", names: ["schema-graph"], defines: ["Schema artifacts"], actions: [{ tag: "!action", id: "write", description: "Write", dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "Report", model, payload: { contentType } } }] }) as GraphProcedureMemory;
}
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
    await assert.rejects(g.report(run, step, { text: "{}" }), /summary/);
    const update = service.stores.step.update.bind(service.stores.step);
    let fail = true;
    service.stores.step.update = async (c, id, value, options) => {
      if (fail && (value as import("../src/context_control/types.js").Step).frames?.length) { fail = false; throw Error("frame interrupted"); }
      return update(c, id, value, options);
    };
    await assert.rejects(g.report(run, step, { text: '{"summary":"final"}' }), (error: any) => {
      assert.match(error.message, /frame interrupted/);
      assert.deepEqual(error.details, { runId: run, stepId: step, artifactId: writing.draft!.id, recoveryCommand: `memsphere run status --run ${run}`, message: "Draft submission sealed; recover status before repeating report" });
      return true;
    });
    const sealed = await g.schemaShow(run, step); assert.equal(sealed.phase, "submitting");
    const recovered = await g.advance(run);
    assert.equal(recovered.artifacts.length, 1); assert.equal(recovered.artifacts[0].id, writing.draft!.id);
    assert.equal(recovered.artifacts[0].content!.payload.content, '{"summary":"final"}');
    assert.equal(recovered.steps[0].status, "done");
    assert.equal(recovered.steps[0].validation?.status, "passed");
    assert.equal(recovered.steps[0].validation?.artifactId, writing.draft!.id);
    assert.equal(recovered.steps[0].validation?.sha256, createHash("sha256").update('{"summary":"final"}').digest("hex"));
    assert.deepEqual((await g.schemaShow(run, step)).validation, recovered.steps[0].validation);
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

test("first writing entry wins against a direct report already preparing its frame", { timeout: 30000 }, async t => {
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
    void reporting.catch(() => {});
    let writing: Awaited<ReturnType<typeof g.enterSchema>>;
    try {
      await bounded(Promise.race([atFrame, reporting.then(() => { throw Error("Report finished before its frame barrier"); })]), "submission Step CAS barrier");
      writing = await g.enterSchema(run, step); release();
      await assert.rejects(reporting, { code: "REVISION_CONFLICT" });
    } finally { release(); await Promise.allSettled([reporting]); }
    const snapshot = await g.snapshot(run); assert.equal(snapshot.artifacts.length, 1); assert.equal(snapshot.artifacts[0].id, writing.draft!.id);
    assert.equal(snapshot.artifacts[0].status, "draft"); assert.equal(snapshot.steps[0].status, "running");
  });
});
test("a direct submission wins against a first writing entry awaiting its Step CAS", { timeout: 30000 }, async t => {
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
    const entering = g.enterSchema(run, step); void entering.catch(() => {});
    let result: Awaited<ReturnType<typeof g.report>>;
    try {
      await bounded(Promise.race([atClaim, entering.then(() => { throw Error("Entry finished before its claim barrier"); })]), "writing Step CAS barrier");
      result = await g.report(run, step, { text: '{"summary":"direct"}' }); release();
      await assert.rejects(entering, { code: "REVISION_CONFLICT" });
    } finally { release(); await Promise.allSettled([entering]); }
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

test("referenced Schema is frozen, with cycles rejected before creating a Run", async t => {
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
    assert.equal(revision.validation, undefined, "A new draft does not inherit the preceding submission validation");
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
  const { service: base, clock, workers } = await graphDomainFixture(t);
  const { ContextControl } = await import("../src/context_control/service.js");
  const { createHash } = await import("node:crypto");
  const bytes = Buffer.from('{"summary":"referenced final"}');
  const service = new ContextControl(base.stores, async () => ({ bytes, contentType: "application/json" }), { now: clock.iso, workers });
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
    assert.equal(recovered.steps[0].validation?.status, "passed");
    assert.equal(recovered.steps[0].validation?.sha256, contentRef.sha256);
    assert.equal(recovered.steps[0].validation?.artifactId, draft.draft!.id);
    assert.deepEqual((await g.schemaShow(run, step)).validation, recovered.steps[0].validation);
    assert.equal(Buffer.from((await g.readArtifact(run, draft.draft!.id)).bytes).toString(), bytes.toString());
  });
});

for (const reviewed of [false, true]) test(`status recovers an already submitted draft before ${reviewed ? "Review creation" : "Step completion"}`, async t => {
  const { service } = await graphDomainFixture(t);
  const p = procedure(); if (reviewed) p.actions[0].artifact!.review = ["approval"];
  await service.withGraph(async g => {
    const start = await g.start({ name: "Late recovery", procedure: p, ...(reviewed ? { controlPlane: { runner: { permissions: ["artifact.read", "artifact.write", "artifact.submit", "decision.decide"] }, actors: { human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] } } }, reviewConfiguration: { reviews: { "schema-graph#actions[write]": { policy: "artifact_acceptance.unanimous" } }, slots: { "schema-graph::approval": { actorIds: ["human"] } } } } : {}) });
    const run = start.run.id, step = start.steps[0].id; await g.enter(run, step);
    const draft = await g.enterSchema(run, step); await g.schemaWrite(run, step, "report", draft.position!, '{"summary":"final"}');
    let fail = true;
    if (reviewed) {
      const create = service.stores.review.create.bind(service.stores.review);
      service.stores.review.create = async (...args) => { if (fail) { fail = false; throw Error("review interrupted"); } return create(...args); };
    } else {
      const update = service.stores.step.update.bind(service.stores.step);
      service.stores.step.update = async (context, id, value, options) => {
        if (fail && (value as import("../src/context_control/types.js").Step).status === "done") { fail = false; throw Error("completion interrupted"); }
        return update(context, id, value, options);
      };
    }
    await assert.rejects(g.report(run, step, { text: '{"summary":"final"}' }), /interrupted/);
    const pending = await g.schemaShow(run, step);
    assert.equal(pending.draft!.status, "submitted"); assert.equal(pending.phase, "submitting");
    const recovered = await g.advance(run);
    assert.equal(recovered.steps[0].status, reviewed ? "awaiting_review" : "done");
    assert.equal(recovered.artifacts.length, 1); assert.equal(recovered.artifacts[0].id, draft.draft!.id);
    assert.equal(recovered.artifacts[0].writing, undefined); assert.equal(recovered.reviews.length, reviewed ? 1 : 0);
    assert.equal((await g.schemaShow(run, step)).phase, "submitted");
    assert.deepEqual(await g.advance(run), recovered);
  });
});

test("every Schema content group, including shorthand and defines-only fields, gates formal Review", async t => {
  const { service } = await graphDomainFixture(t);
  const { currentReviewNode, allReviewNodes, needsNodeReport } = await import("../src/review-nodes.js");
  const reviews = await import("../src/context_control/review-repository.js");
  const source = `!schema\nsyntax: ${syntax}\ntype: object\nfields:\n  - summary\n  - !schema\n    name: notes\n    defines: [Explain the notes]\n  - !schema\n    name: evidence\n    asserts: [Cite the source]\n`;
  const p = procedure({ definedBy: MEMSPHERE_SCHEMA_MODEL, definition: source }); p.actions[0].artifact!.review = ["approval"];
  const result = await service.withGraph(async g => {
    const start = await g.start({ name: "Review every group", procedure: p, controlPlane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { agent: { kind: "agent", name: "Reviewer", permissions: ["artifact.read", "decision.assess"], agent: { provider: "test", providerType: "traex", command: process.execPath, args: [], env: {}, startupTimeoutMs: 1000, idleTimeoutMs: 1000 } } } }, reviewConfiguration: { reviews: { "schema-graph#actions[write]": { policy: "artifact_acceptance.unanimous" } }, slots: { "schema-graph::approval": { actorIds: ["agent"] } } } });
    await g.enter(start.run.id, start.steps[0].id);
    return g.report(start.run.id, start.steps[0].id, { text: '{"summary":"S","notes":"N","evidence":"E"}' });
  });
  const input = { service, runsRoot: "unused", reviewId: reviews.graphReviewHandle(result.snapshot.run.id, result.step.id), roundId: result.step.reviewRounds![0].id, actorId: "agent" };
  const claimed = (await reviews.claimArtifactReviewAgentAssignment({ ...input, workerPid: process.pid }))!;
  const bound = { ...input, attemptId: claimed.attempt.id }; await reviews.markArtifactReviewAgentCliReady(bound);
  let read = await reviews.readArtifactReviewForActor(input);
  const groups = allReviewNodes(read.assignment.nodeTree!).filter(n => n.requiresReport);
  assert.equal(groups.length, 4); assert.ok(groups.every(needsNodeReport));
  assert.ok(groups.some(n => n.name === "summary" && n.asserts.length === 0));
  await assert.rejects(reviews.submitArtifactReviewAgentAssignment({ ...bound, vote: "approve" }), /incomplete/);
  const visited: string[] = [];
  while (currentReviewNode(read.assignment)) {
    const node = currentReviewNode(read.assignment)!; visited.push(node.nodeId);
    read = await reviews.mutateArtifactReviewNodes({ ...bound, mutation: { operation: "report", expectedNodeId: node.nodeId, artifact: { applicable: true } } });
  }
  assert.ok(groups.every(n => visited.includes(n.nodeId)));
  await reviews.submitArtifactReviewAgentAssignment({ ...bound, vote: "approve" });
  assert.equal((await reviews.readArtifactReviewForActor(input)).assignment.status, "submitted");
});

test("inline Schema freezes transitive Statement rules and their sources for the actual Review", async t => {
  const { service } = await graphDomainFixture(t);
  const { serializeMemoryYaml } = await import("../src/memory/serializer.js");
  const { allReviewNodes } = await import("../src/review-nodes.js");
  const source = `!schema\nsyntax: ${syntax}\ntype: object\nfields:\n  - !schema\n    name: summary\n    asserts: [!ref {target: statements/base}]\n    suggests: [!ref {target: statements/advice}]\n`;
  const p = procedure({ definedBy: MEMSPHERE_SCHEMA_MODEL, definition: source }); p.actions[0].artifact!.review = ["approval"];
  assert.deepEqual(collectMemoryReferenceTargets(p).sort(), ["statements/advice", "statements/base"]);
  const payload = (content: string) => ({ memoryRef: "fixture", payload: { contentType: "application/yaml", content } });
  const memories = {
    "procedures/schema-graph": payload(serializeMemoryYaml(p)),
    "statements/base": payload(`!statement\nsyntax: ${syntax}\nname: base\nasserts: [!ref {target: statements/nested}]\n`),
    "statements/nested": payload(`!statement\nsyntax: ${syntax}\nname: nested\nasserts: [Frozen requirement]\n`),
    "statements/advice": payload(`!statement\nsyntax: ${syntax}\nname: advice\nsuggests: [Frozen suggestion]\n`)
  };
  for (const [ref, memory] of Object.entries(memories)) memory.memoryRef = ref;
  await service.withGraph(async g => {
    const start = await g.start({ name: "Frozen rules", procedure: p, memorySnapshot: { memories }, controlPlane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { agent: { kind: "agent", name: "Reviewer", permissions: ["artifact.read", "decision.assess"], agent: { provider: "test", providerType: "traex", command: process.execPath, args: [], env: {}, startupTimeoutMs: 1000, idleTimeoutMs: 1000 } } } }, reviewConfiguration: { reviews: { "schema-graph#actions[write]": { policy: "artifact_acceptance.unanimous" } }, slots: { "schema-graph::approval": { actorIds: ["agent"] } } } });
    memories["statements/nested"].payload.content = memories["statements/nested"].payload.content.replace("Frozen requirement", "Changed requirement");
    memories["statements/advice"].payload.content = memories["statements/advice"].payload.content.replace("Frozen suggestion", "Changed suggestion");
    await g.enter(start.run.id, start.steps[0].id);
    const result = await g.report(start.run.id, start.steps[0].id, { text: '{"summary":"Conclusion"}' });
    const nodes = allReviewNodes(result.snapshot.reviews[0].nodeTree!);
    assert.ok(nodes.some(n => n.source?.memoryRef === "statements/nested" && n.asserts.some(r => r.text === "Frozen requirement")));
    assert.ok(nodes.some(n => n.source?.memoryRef === "statements/advice" && n.suggests.some(r => r.text === "Frozen suggestion")));
    assert.doesNotMatch(JSON.stringify(nodes), /Changed requirement|Changed suggestion/);
  });
});
for (const scenario of ["missing", "wrong-kind", "cycle"] as const) test(`inline Schema ${scenario} Statement dependency rejects Run creation`, async t => {
  const { service } = await graphDomainFixture(t);
  const { serializeMemoryYaml } = await import("../src/memory/serializer.js");
  const target = scenario === "wrong-kind" ? "schemas/not-a-statement" : "statements/base";
  const source = `!schema\nsyntax: ${syntax}\ntype: object\nfields:\n  - !schema\n    name: summary\n    asserts: [!ref {target: ${target}}]\n`;
  const p = procedure({ definedBy: MEMSPHERE_SCHEMA_MODEL, definition: source });
  const payload = (content: string) => ({ memoryRef: "fixture", payload: { contentType: "application/yaml", content } });
  const memories = { "procedures/schema-graph": payload(serializeMemoryYaml(p)), ...(scenario === "wrong-kind" ? { [target]: payload(`!schema\nsyntax: ${syntax}\nname: not-a-statement\n`) } : scenario === "cycle" ? { [target]: payload(`!statement\nsyntax: ${syntax}\nname: base\nasserts: [!ref {target: statements/base}]\n`) } : {}) };
  await service.withGraph(async g => {
    await assert.rejects(g.start({ name: "Invalid rule dependency", procedure: p, memorySnapshot: { memories } }), scenario === "missing" ? /not found/i : scenario === "wrong-kind" ? /must identify a Statement/ : /cycl/i);
    assert.deepEqual((await service.stores.run.list({})).items, []);
  });
});

for (const winner of ["save", "seal"] as const) test(`draft ${winner} wins without a late save overwriting the submitted identity`, { timeout: 30000 }, async t => {
  const { service } = await graphDomainFixture(t);
  await service.withGraph(async g => {
    const start = await g.start({ name: "Save versus seal", procedure: procedure() });
    const run = start.run.id, step = start.steps[0].id; await g.enter(run, step);
    const draft = await g.enterSchema(run, step);
    let reached!: () => void, release!: () => void, pause = true;
    const atSave = new Promise<void>(r => { reached = r; }), gate = new Promise<void>(r => { release = r; });
    const update = service.stores.artifact.update.bind(service.stores.artifact);
    service.stores.artifact.update = async (context, id, value, options) => {
      const a = value as import("../src/context_control/types.js").Artifact;
      if (pause && a.id === draft.draft!.id && a.writing?.index === 1 && !a.writing.submission) { pause = false; reached(); await bounded(gate, "release draft save"); }
      return update(context, id, value, options);
    };
    const saving = g.schemaWrite(run, step, "report", draft.position!, '{"summary":"late field"}'); void saving.catch(() => {});
    let final: Awaited<ReturnType<typeof g.report>>;
    try {
      await bounded(Promise.race([atSave, saving.then(() => { throw Error("Save missed its CAS barrier"); })]), "draft save CAS");
      if (winner === "save") {
        // A fresh full submission cannot seal a draft until its last save lands.
        await assert.rejects(g.report(run, step, { text: '{"summary":"final"}' }), { code: "SCHEMA_INCOMPLETE" });
        release(); await saving;
        final = await g.report(run, step, { text: '{"summary":"final"}' });
      } else {
        await g.schemaWrite(run, step, "report", draft.position!, '{"summary":"winning field"}');
        final = await g.report(run, step, { text: '{"summary":"final"}' });
        release(); await assert.rejects(saving, { code: "REVISION_CONFLICT" });
      }
    } finally { release(); await bounded(Promise.allSettled([saving]), "pending draft save cleanup"); }
    assert.equal(final.artifact.id, draft.draft!.id); assert.equal(final.artifact.content!.payload.content, '{"summary":"final"}');
    const snapshot = await g.advance(run);
    assert.equal(snapshot.artifacts.length, 1); assert.deepEqual(snapshot.completeIds, [draft.draft!.id]); assert.equal(snapshot.reviews.length, 0);
  });
});

for (const phase of ["save", "seal", "recovery"] as const) test(`rewind fences an in-flight ${phase} after admission from effective Review and downstream results`, { timeout: 30000 }, async t => {
  const { service } = await graphDomainFixture(t);
  const p = procedure(); p.actions[0].artifact!.review = ["approval"];
  p.actions.push({ tag: "!action", id: "consume", description: "Consume", dependencies: [{ tag: "!dependency", from: "write" }], artifact: { name: "Consumed", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/plain" } } });
  await service.withGraph(async g => {
    const start = await g.start({ name: "In-flight rewind", procedure: p, controlPlane: { runner: { permissions: ["artifact.read", "artifact.write", "artifact.submit", "decision.decide"] }, actors: { human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] } } }, reviewConfiguration: { reviews: { "schema-graph#actions[write]": { policy: "artifact_acceptance.unanimous" } }, slots: { "schema-graph::approval": { actorIds: ["human"] } } } });
    const run = start.run.id, step = start.steps[0].id; await g.enter(run, step);
    let draft = await g.enterSchema(run, step);
    if (phase !== "save") draft = await g.schemaWrite(run, step, "report", draft.position!, '{"summary":"old"}');
    let reached!: () => void, release!: () => void, pause = true;
    const atWrite = new Promise<void>(r => { reached = r; }), gate = new Promise<void>(r => { release = r; });
    const update = service.stores.artifact.update.bind(service.stores.artifact);
    service.stores.artifact.update = async (context, id, value, options) => {
      const a = value as import("../src/context_control/types.js").Artifact;
      const selected = phase === "save" ? a.writing?.index === 1 && !a.writing.submission : phase === "seal" ? Boolean(a.writing?.submission) : a.status === "submitted";
      if (pause && a.id === draft.draft!.id && selected) { pause = false; reached(); await bounded(gate, "release admitted old Artifact CAS"); }
      return update(context, id, value, options);
    };
    let pending: Promise<unknown> | undefined, rewinding: ReturnType<typeof g.rewind> | undefined;
    let releaseEntry = () => {}, replacement = "";
    const advance = g.advance.bind(g);
    try {
      if (phase === "recovery") {
        // Rewind normally recovers existing frames in its preflight. Start it
        // first, then admit submission recovery before the rewind intent saves.
        let reachedEntry!: () => void, hold = true;
        const atEntry = new Promise<void>(r => { reachedEntry = r; });
        const entryGate = new Promise<void>(r => { releaseEntry = r; });
        g.advance = async id => { const snapshot = await advance(id); if (hold) { hold = false; reachedEntry(); await bounded(entryGate, "release rewind preflight"); } return snapshot; };
        rewinding = g.rewind(run, step, "Replace the requirements"); void rewinding.catch(() => {});
        await bounded(Promise.race([atEntry, rewinding.then(() => { throw Error("Rewind missed its preflight barrier"); })]), "rewind preflight");
      }
      pending = phase === "save" ? g.schemaWrite(run, step, "report", draft.position!, '{"summary":"old"}') : g.report(run, step, { text: '{"summary":"old"}' });
      void pending.catch(() => {});
      await bounded(Promise.race([atWrite, pending.then(() => { throw Error("Old request missed its admitted-write barrier"); })]), "admitted Artifact CAS barrier");
      if (rewinding) { releaseEntry(); replacement = (await rewinding).replacementStepId; }
      else replacement = (await g.rewind(run, step, "Replace the requirements")).replacementStepId;
      release(); await assert.rejects(pending, { code: "STEP_SUPERSEDED" });
    } finally {
      release(); releaseEntry(); g.advance = advance;
      await bounded(Promise.allSettled([...(pending ? [pending] : []), ...(rewinding ? [rewinding] : [])]), "old in-flight request cleanup");
    }
    const rewound = await g.advance(run);
    assert.equal(rewound.completeIds.length, 0); assert.equal(rewound.outputArtifactIds.length, 0); assert.equal(rewound.reviews.length, 0);
    assert.ok(!rewound.steps.some(s => s.source?.actionId === "consume"));
    await assert.rejects(g.enterSchema(run, step), { code: "STEP_SUPERSEDED" });
    await g.enter(run, replacement);
    const fresh = await g.enterSchema(run, replacement); assert.notEqual(fresh.draft!.id, draft.draft!.id);
    await g.schemaWrite(run, replacement, "report", fresh.position!, '{"summary":"replacement"}');
    const submitted = await g.report(run, replacement, { text: '{"summary":"replacement"}' });
    const round = submitted.step.reviewRounds!.at(-1)!.id;
    await g.submitReview(run, replacement, round, "human", "approve");
    await g.submitReview(run, replacement, round, "runner", "approve");
    const snapshot = await g.advance(run);
    assert.deepEqual(snapshot.completeIds, [fresh.draft!.id]);
    assert.ok(snapshot.reviews.every(r => r.artifactId === fresh.draft!.id));
    assert.equal(snapshot.steps.filter(s => s.source?.actionId === "consume").length, 1);
    assert.deepEqual(snapshot.steps.find(s => s.source?.actionId === "consume")!.inputs, { write: [{ kind: "artifact", id: fresh.draft!.id }] });
    assert.equal(snapshot.artifacts.find(a => a.id === fresh.draft!.id)!.content!.payload.content, '{"summary":"replacement"}');
  });
});

for (const surface of ["full", "lazy"] as const) test(`${surface} View keeps draft value and diagnostic revision from the same read when a save interleaves`, { timeout: 30000 }, async t => {
  const { service } = await graphDomainFixture(t);
  const { contextRunPayload } = await import("../src/context_control/view.js");
  await service.withGraph(async g => {
    const start = await g.start({ name: "Coherent View read", procedure: procedure() });
    const run = start.run.id, step = start.steps[0].id; await g.enter(run, step);
    const initial = await g.enterSchema(run, step);
    await assert.rejects(g.schemaWrite(run, step, "report", initial.position!, '{}'), /summary/);
    const failure = (await g.schemaShow(run, step)).validation!;
    const get = service.stores.artifact.get.bind(service.stores.artifact); let interleave = true;
    service.stores.artifact.get = async (context, id) => {
      const row = await get(context, id);
      if (interleave && id === `${run}/${initial.draft!.id}`) {
        interleave = false;
        await g.schemaWrite(run, step, "report", initial.position!, '{"summary":"newer saved body"}');
      }
      return row;
    };
    const snapshot = surface === "full" ? await g.snapshot(run) : (await service.viewProjection(run, "action", "write"))!;
    const shown = contextRunPayload(snapshot).context.artifacts.find(a => a.id === initial.draft!.id)!.writingProgress!;
    assert.equal(shown.index, 0); assert.deepEqual(shown.validation, failure);
    const latest = contextRunPayload(await g.snapshot(run)).context.artifacts.find(a => a.id === initial.draft!.id)!.writingProgress!;
    assert.equal(latest.index, 1); assert.equal(latest.validation, undefined);
  });
});

test("failed reference submission replaces the latest draft diagnostic without changing its body or position", async t => {
  const { service: base, clock, workers } = await graphDomainFixture(t);
  const { ContextControl } = await import("../src/context_control/service.js");
  const { createHash } = await import("node:crypto");
  let bytes = Buffer.from('{}'), contentType = "application/json";
  const service = new ContextControl(base.stores, async () => ({ bytes, contentType }), { now: clock.iso, workers });
  await service.withGraph(async g => {
    const start = await g.start({ name: "Reference diagnostics", procedure: procedure() });
    const run = start.run.id, step = start.steps[0].id; await g.enter(run, step);
    const initial = await g.enterSchema(run, step);
    const draft = await g.schemaWrite(run, step, "report", initial.position!, '{"summary":"saved draft"}');
    await assert.rejects(g.report(run, step, { text: '{}' }), /summary/);
    const ref = () => ({ storeId: "input", dataId: "report", sha256: createHash("sha256").update(bytes).digest("hex") });
    for (const kind of ["hash", "mime", "schema"] as const) {
      bytes = Buffer.from('{}'); contentType = kind === "mime" ? "text/plain" : "application/json";
      await assert.rejects(g.report(run, step, { contentRef: kind === "hash" ? { ...ref(), sha256: "0".repeat(64) } : ref() }));
      const after = await g.schemaShow(run, step);
      assert.equal(after.validation!.status, "failed"); assert.equal(after.validation!.sha256, undefined);
      assert.match(after.validation!.issues[0].message, kind === "hash" ? /SHA-256 mismatch/ : kind === "mime" ? /Expected application\/json/ : /summary/);
      assert.deepEqual(after.draft, draft.draft); assert.equal(after.phase, "awaiting_finalization");
      const snapshot = await g.snapshot(run); assert.equal(snapshot.reviews.length, 0); assert.equal(snapshot.steps[0].frames?.length ?? 0, 0);
    }
  });
});

test("a successful validation cannot be persisted without the checked content identity", async t => {
  const { service } = await graphDomainFixture(t);
  await service.withGraph(async g => {
    const start = await g.start({ name: "Verified identity", procedure: procedure() });
    await g.enter(start.run.id, start.steps[0].id);
    const result = await g.report(start.run.id, start.steps[0].id, { text: '{"summary":"verified"}' });
    const id = `${start.run.id}/${result.step.id}`, row = (await service.stores.step.get({}, id))!;
    const invalid = structuredClone(row.value) as import("../src/context_control/types.js").Step;
    delete invalid.validation!.sha256;
    await assert.rejects(service.stores.step.update({}, id, invalid, { expectedRevision: row.revision! }), /validation.sha256/);
    assert.deepEqual(await service.stores.step.get({}, id), row);
  });
});

for (const target of ["artifact", "step", "run"] as const) test(`a payload pointing to its mutable ${target} record is rejected before sealing so the draft remains recoverable`, async t => {
  const { service: base, clock, workers } = await graphDomainFixture(t);
  const { ContextControl } = await import("../src/context_control/service.js");
  const { createHash } = await import("node:crypto");
  const reader = async (ref: { dataId: string }) => ({ bytes: Buffer.from(JSON.stringify((await base.stores[target].get({}, ref.dataId))!.value)), contentType: "application/json" });
  const service = new ContextControl(base.stores, reader, { now: clock.iso, workers });
  await service.withGraph(async g => {
    const start = await g.start({ name: "No mutable self reference", procedure: procedure({ definedBy: MEMSPHERE_SCHEMA_MODEL, definition: `!schema\nsyntax: ${syntax}\ntype: object\n` }) });
    const run = start.run.id, step = start.steps[0].id; await g.enter(run, step);
    const initial = await g.enterSchema(run, step); const saved = await g.schemaWrite(run, step, "report", initial.position!, '{}');
    const dataId = target === "run" ? run : `${run}/${target === "step" ? step : initial.draft!.id}`, bytes = (await reader({ dataId })).bytes;
    await assert.rejects(g.report(run, step, { contentRef: { storeId: base.stores[target].id, dataId, sha256: createHash("sha256").update(bytes).digest("hex") } }), /own mutable context record/);
    assert.deepEqual((await g.schemaShow(run, step)).draft, saved.draft);
    assert.equal((await g.advance(run)).steps[0].frames?.length ?? 0, 0);
    assert.equal((await g.report(run, step, { text: '{}' })).step.status, "done");
  });
});

for (const outcome of ["saved", "not_saved", "unconfirmed"] as const) test(`submission write failure reports ${outcome} intent without automatically resubmitting`, { timeout: 10000 }, async t => {
  const { service } = await graphDomainFixture(t);
  await service.withGraph(async g => {
    const start = await g.start({ name: "Write outcome", procedure: procedure() });
    const run = start.run.id, step = start.steps[0].id;
    await g.enter(run, step); const draft = await g.enterSchema(run, step);
    const before = await g.schemaWrite(run, step, "report", draft.position!, '{"summary":"draft"}');
    const update = service.stores.artifact.update.bind(service.stores.artifact);
    const get = service.stores.artifact.get.bind(service.stores.artifact);
    const original = Error("submission write acknowledgement failed");
    let attempts = 0, failRead = false;
    service.stores.artifact.update = async (context, id, value, options) => {
      if ((value as import("../src/context_control/types.js").Artifact).writing?.submission && attempts++ === 0) {
        if (outcome !== "not_saved") await update(context, id, value, options);
        failRead = outcome === "unconfirmed";
        throw original;
      }
      return update(context, id, value, options);
    };
    service.stores.artifact.get = async (...args) => {
      if (failRead) { failRead = false; throw Error("verification read failed"); }
      return get(...args);
    };
    const final = '{"summary":"final"}';
    try {
      await assert.rejects(g.report(run, step, { text: final }), (error: any) => {
        assert.equal(error, original);
        assert.match(error.message, /write acknowledgement failed/);
        if (outcome === "not_saved") assert.equal(error.details, undefined);
        else {
          assert.equal(error.details.runId, run); assert.equal(error.details.stepId, step);
          assert.equal(error.details.artifactId, draft.draft!.id);
          assert.equal(error.details.recoveryCommand, `memsphere run status --run ${run}`);
          assert.match(error.details.message, outcome === "saved" ? /Draft submission sealed/ : /outcome could not be confirmed/);
        }
        return true;
      });
      assert.equal(attempts, 1, "report must not automatically retry a write with an uncertain result");
    } finally {
      service.stores.artifact.update = update; service.stores.artifact.get = get;
    }
    const pending = await g.schemaShow(run, step);
    if (outcome === "not_saved") {
      assert.equal(pending.phase, "awaiting_finalization");
      assert.deepEqual(pending.draft, before.draft); assert.equal(pending.position, before.position);
      assert.equal((await g.snapshot(run)).completeIds.length, 0);
      await g.report(run, step, { text: final });
    } else {
      assert.equal(pending.phase, "submitting");
      const token = pending.draft!.writing!.submission!.token;
      assert.ok(token); await g.advance(run);
    }
    const recovered = await g.snapshot(run);
    assert.equal(recovered.artifacts.length, 1); assert.equal(recovered.artifacts[0].id, draft.draft!.id);
    assert.equal(recovered.artifacts[0].content!.payload.content, final);
    assert.equal(recovered.reviews.length, 0); assert.deepEqual(recovered.completeIds, [draft.draft!.id]);
    assert.equal(recovered.steps[0].validation?.status, "passed");
    assert.equal(recovered.steps[0].validation?.sha256, createHash("sha256").update(final).digest("hex"));
    assert.deepEqual(await g.advance(run), recovered);
  });
});
