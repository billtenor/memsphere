import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { initializedContextFixture } from "./helpers/initialized-context.js";
const exec = promisify(execFile), cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

async function schemaCliFixture(t: test.TestContext) {
  const f = await initializedContextFixture(t);
  await exec("git", ["init", "-b", "master"], { cwd: f.root, signal: t.signal, timeout: 20000, killSignal: "SIGKILL" });
  const config = JSON.parse(await readFile(join(f.root, "config.json"), "utf8"));
  config.store = { type: "embedded", repository_path: f.root, memory_path: "memory" };
  await writeFile(join(f.root, "config.json"), JSON.stringify(config));
  await writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: { codex: { identity_enabled: true, async_enabled: false } } }));
  const env = { ...process.env, MEMSPHERE_HOME: f.home, MEMSPHERE_REVIEW_ASSIGNMENT_ID: "", MEMSPHERE_REVIEW_SESSION_ID: "", CODEX_THREAD_ID: "schema-cli", TRAECLI_THREAD_ID: "" };
  const call = async (...args: string[]) => JSON.parse((await exec(process.execPath, [cli, "--project", "test-project", ...args, "--output", "json"], { cwd: f.root, env, signal: t.signal, timeout: 20000, killSignal: "SIGKILL" })).stdout);
  const raw = async (...args: string[]) => (await exec(process.execPath, [cli, "--project", "test-project", ...args], { cwd: f.root, env, signal: t.signal, timeout: 20000, killSignal: "SIGKILL" })).stdout;
  return { f, call, raw };
}

test("real graph CLI and Continue save a positioned draft, export and submit the same Artifact", { timeout: 90000 }, async t => {
  const { f, call } = await schemaCliFixture(t);
  const file = join(f.directory, "schema.yaml");
  await writeFile(file, `!procedure\nsyntax: memsphere-20261027-stable\nmode: graph\nname: schema-cli\ndefines: [Report]\nactions:\n  - !action\n    id: report\n    description: Report\n    dependencies: [!dependency {from: START}]\n    artifact:\n      name: Report\n      model:\n        definedBy: memsphere/schema.json\n        definition: |\n          !schema\n          syntax: memsphere-20261027-stable\n          type: object\n          fields: [summary]\n      payload: {contentType: application/json}\n`);
  const started = await call("run", "start", "--file", file, "--name", "Schema CLI");
  const run = started.runId;
  const snapshot = await call("run", "show", "--run", run); const step = snapshot.steps[0].id;
  const initial = await call("continue", "enter-schema");
  const saved = await call("continue", "schema", "report", "--position", initial.position, "--artifact", '{"summary":"draft"}');
  assert.equal(saved.draft.id, initial.draft.id); assert.equal(saved.phase, "awaiting_finalization");
  await assert.rejects(call("run", "schema", "report", "--run", run, "--step", step, "--position", initial.position, "--artifact", '{"summary":"late"}'), /Writing position changed/);
  const reference = join(f.directory, "invalid-reference.json");
  await writeFile(reference, JSON.stringify({ contentRef: { storeId: "context_control/artifacts", dataId: `${run}/${initial.draft.id}`, sha256: "0".repeat(64) } }));
  await assert.rejects(call("continue", "report", "--file", reference), /SHA-256 mismatch/);
  const failed = await call("continue", "schema", "show");
  assert.match(failed.validation.issues[0].message, /SHA-256 mismatch/); assert.equal(failed.validation.sha256, undefined);
  assert.equal(failed.draft.content.payload.content, saved.draft.content.payload.content);
  const copy = join(f.directory, "copy.json");
  await call("continue", "artifact", "export", "--file", copy);
  assert.deepEqual(JSON.parse(await readFile(copy, "utf8")), { summary: "draft" });
  await writeFile(copy, '{"summary":"final"}');
  const submitted = await call("continue", "report", "--artifact-file", copy);
  assert.equal(submitted.artifactId, initial.draft.id); assert.equal(submitted.status, "done");
});

test("Schema native entry and Continue retain all rule scopes, input links and Human responsibility", { timeout: 90000 }, async t => {
  const { f, call, raw } = await schemaCliFixture(t);
  const { serializeMemoryYaml } = await import("../src/memory/serializer.js");
  const source = { tag: "!procedure", syntax: "memsphere-20261027-stable", mode: "graph", names: ["schema-context"], defines: ["Report"], asserts: ["Workflow rule"], actions: [
    { tag: "!action", id: "input", description: "Prepare", dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "Input", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/plain" } } },
    { tag: "!action", id: "report", actor: "human", description: "Write the report", asserts: ["Action rule"], dependencies: [{ tag: "!dependency", from: "input" }], artifact: { name: "Report", asserts: ["Artifact rule"], model: { definedBy: "memsphere/schema.json", definition: "!schema\nsyntax: memsphere-20261027-stable\ntype: object\nfields: [summary]\n" }, payload: { contentType: "application/json" } } }
  ] };
  const file = join(f.directory, "context.yaml"); await writeFile(file, serializeMemoryYaml(source as import("../src/memory/ast.js").GraphProcedureMemory));
  const started = await call("run", "start", "--file", file, "--name", "Context");
  const delivered = await call("continue", "report", "--artifact", "Upstream source");
  const snapshot = await call("run", "show", "--run", started.runId);
  const step = snapshot.steps.find((s: any) => s.source.actionId === "report").id;
  const native = await raw("run", "step", "enter", "--run", started.runId, "--step", step);
  for (const prompt of [delivered.prompt, native]) {
    for (const requirement of ["Workflow rule", "Action rule", "Artifact rule", delivered.artifactId, "run artifact show", "summary", "Human", "enter-schema"]) assert.ok(prompt.includes(requirement), requirement);
  }
});

async function parallelDraftFixture(t: test.TestContext, content?: { a: string; b: string }) {
  const fixture = await schemaCliFixture(t);
  const { openContextControl } = await import("../src/project/context-control.js");
  const service = (await openContextControl(fixture.f.root))!;
  // Public API setup keeps CLI assertions focused on target isolation or submission,
  // rather than paying for repeated CLI startup while preparing unrelated state.
  const state = await service.withGraph(async g => {
    const source = { tag: "!procedure", syntax: "memsphere-20261027-stable", mode: "graph", names: ["parallel-drafts"], defines: ["Independent reports"], actions: ["a", "b"].map(id => ({ tag: "!action", id, description: id, dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: id, model: { definedBy: "memsphere/schema.json", definition: "!schema\nsyntax: memsphere-20261027-stable\ntype: object\nfields: [summary]\n" }, payload: { contentType: "application/json" } } })) };
    const started = await g.start({ name: "Parallel drafts", procedure: source as import("../src/memory/ast.js").GraphProcedureMemory });
    const run = started.run.id, a = started.steps.find(s => s.source?.actionId === "a")!.id, b = started.steps.find(s => s.source?.actionId === "b")!.id;
    await g.enter(run, a); const first = await g.enterSchema(run, a);
    if (content) await g.schemaWrite(run, a, "report", first.position!, JSON.stringify({ summary: content.a }));
    await g.enter(run, b); const second = await g.enterSchema(run, b);
    if (content) await g.schemaWrite(run, b, "report", second.position!, JSON.stringify({ summary: content.b }));
    return { run, a, b, first, second };
  });
  return { ...fixture, service, ...state };
}

test("native Schema writes reject a Step outside the current Continue binding without mutating either draft", { timeout: 90000 }, async t => {
  const { call, raw, service, run, a, b, first, second } = await parallelDraftFixture(t);
  await raw("run", "step", "enter", "--run", run, "--step", b);
  await assert.rejects(call("run", "schema", "report", "--run", run, "--step", a, "--position", first.position!, "--artifact", '{"summary":"wrong target"}'), /bound to another target/);
  await service.withGraph(async g => {
    const unchangedA = await g.schemaShow(run, a), unchangedB = await g.schemaShow(run, b);
    assert.equal(unchangedA.position, first.position); assert.equal(unchangedB.position, second.position);
    assert.equal(unchangedA.draft!.content!.payload.content, ""); assert.equal(unchangedB.draft!.content!.payload.content, "");
  });
});

test("Continue saves preserve independent concurrent draft identities content and positions", { timeout: 90000 }, async t => {
  const { call, raw, service, run, a, b, first, second } = await parallelDraftFixture(t);
  assert.notEqual(first.draft!.id, second.draft!.id);
  await raw("run", "step", "enter", "--run", run, "--step", b);
  const savedB = await call("continue", "schema", "report", "--position", second.position!, "--artifact", '{"summary":"B"}');
  assert.equal(savedB.draft.id, second.draft!.id);
  await raw("run", "step", "enter", "--run", run, "--step", a);
  const resumed = await call("continue", "schema", "show");
  assert.equal(resumed.draft.id, first.draft!.id); assert.equal(resumed.position, first.position); assert.equal(resumed.draft.content.payload.content, "");
  const savedA = await call("continue", "schema", "report", "--position", first.position!, "--artifact", '{"summary":"A"}');
  assert.equal(savedA.draft.id, first.draft!.id);
  const untouched = await service.withGraph(g => g.schemaShow(run, b));
  assert.equal(untouched.draft!.id, second.draft!.id); assert.equal(untouched.draft!.content!.payload.content, '{"summary":"B"}');
});

test("Continue submits each concurrent Schema draft once and preserves both completed identities", { timeout: 90000 }, async t => {
  const { call, raw, run, a, first, second } = await parallelDraftFixture(t, { a: "A", b: "B" });
  await raw("run", "step", "enter", "--run", run, "--step", a);
  const aDone = await call("continue", "report", "--artifact", '{"summary":"A"}'); assert.equal(aDone.artifactId, first.draft!.id);
  const bDraft = await call("continue", "schema", "show"); assert.equal(bDraft.draft.id, second.draft!.id);
  const bDone = await call("continue", "report", "--artifact", '{"summary":"B"}'); assert.equal(bDone.artifactId, second.draft!.id);
  const completed = await call("run", "show", "--run", run);
  assert.deepEqual(new Set(completed.completeIds), new Set([first.draft!.id, second.draft!.id]));
});

test("CLI status recovery replaces a previous failed diagnostic with the sealed submission hash", { timeout: 90000 }, async t => {
  const { f, call } = await schemaCliFixture(t);
  const { openContextControl } = await import("../src/project/context-control.js");
  const { createHash } = await import("node:crypto");
  const service = (await openContextControl(f.root))!;
  const final = '{"summary":"recovered final"}';
  const identity = await service.withGraph(async g => {
    const p = { tag: "!procedure", syntax: "memsphere-20261027-stable", mode: "graph", names: ["recover-cli"], defines: ["Report"], actions: [{ tag: "!action", id: "report", description: "Report", dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "Report", model: { definedBy: "memsphere/schema.json", definition: "!schema\nsyntax: memsphere-20261027-stable\ntype: object\nfields: [summary]\n" }, payload: { contentType: "application/json" } } }] };
    const start = await g.start({ name: "Recovery", procedure: p as import("../src/memory/ast.js").GraphProcedureMemory });
    const run = start.run.id, step = start.steps[0].id;
    await g.enter(run, step); const draft = await g.enterSchema(run, step);
    await g.schemaWrite(run, step, "report", draft.position!, '{"summary":"draft"}');
    await assert.rejects(g.report(run, step, { text: "{}" }), /summary/);
    const update = service.stores.step.update.bind(service.stores.step);
    service.stores.step.update = async (context, id, value, options) => {
      if ((value as import("../src/context_control/types.js").Step).frames?.length) throw Error("frame interrupted");
      return update(context, id, value, options);
    };
    try { await assert.rejects(g.report(run, step, { text: final }), /frame interrupted/); }
    finally { service.stores.step.update = update; }
    return { run, step, artifactId: draft.draft!.id };
  });
  await call("run", "status", "--run", identity.run);
  const state = await call("run", "schema", "show", "--run", identity.run, "--step", identity.step);
  assert.equal(state.phase, "submitted");
  assert.equal(state.validation.status, "passed"); assert.equal(state.validation.artifactId, identity.artifactId);
  assert.equal(state.validation.sha256, createHash("sha256").update(final).digest("hex"));
  assert.deepEqual(state.validation.issues, []);
});
