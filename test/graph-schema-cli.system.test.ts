import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { cliModuleProcess } from "./helpers/cli-module-process.js";
import { initializedContextFixture } from "./helpers/initialized-context.js";
import { ownTestProcess } from "./helpers/owned-process.js";
const exec = promisify(execFile), cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const cliTimeout = 20_000;

async function schemaCliFixture(t: test.TestContext, invocation: "process" | "worker" = "process") {
  const f = await initializedContextFixture(t);
  // Schema writing uses a real project and persisted Stores. A Managed Memory
  // baseline avoids enumerating Embedded worktrees on each unrelated Store read.
  const processOptions = { timeout: cliTimeout, killSignal: "SIGKILL" as const };
  const runProcess = (file: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) => {
    t.signal.throwIfAborted();
    const result = exec(file, args, { cwd, env, ...processOptions });
    ownTestProcess(result.child, t.signal, f.beforeCleanup);
    return result;
  };
  const memory = join(f.root, "memory");
  await runProcess("git", ["init", "-b", "master"], memory);
  await runProcess("git", ["-c", "user.name=Graph Test", "-c", "user.email=graph@example.invalid", "commit", "--allow-empty", "-m", "Fixture baseline"], memory);
  const { stdout: revision } = await runProcess("git", ["rev-parse", "HEAD"], memory);
  const config = JSON.parse(await readFile(join(f.root, "config.json"), "utf8"));
  config.store = { type: "managed", branch: "master", published_revision: revision.trim() };
  await writeFile(join(f.root, "config.json"), JSON.stringify(config));
  await writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: { codex: { identity_enabled: true, async_enabled: false } } }));
  const env: NodeJS.ProcessEnv = { ...process.env, MEMSPHERE_HOME: f.home, MEMSPHERE_REVIEW_ASSIGNMENT_ID: "", MEMSPHERE_REVIEW_SESSION_ID: "", CODEX_THREAD_ID: "schema-cli", TRAECLI_THREAD_ID: "", CLAUDE_CODE_SESSION_ID: "" };
  const worker = invocation === "worker" ? cliModuleProcess({
    cwd: f.cwd, env, entrypoint: cli, signal: t.signal, timeout: cliTimeout, beforeCleanup: f.beforeCleanup
  }) : undefined;
  const invoke = (...args: string[]) => {
    const command = ["--project", "test-project", ...args];
    return worker ? worker.invoke(command) : runProcess(process.execPath, [cli, ...command], f.cwd, env);
  };
  const call = async (...args: string[]) => JSON.parse((await invoke(...args, "--output", "json")).stdout);
  const raw = async (...args: string[]) => (await invoke(...args)).stdout;
  return { f, env, call, raw };
}

async function startSchemaStep({ f, call }: Awaited<ReturnType<typeof schemaCliFixture>>) {
  const file = join(f.directory, "schema.yaml");
  await writeFile(file, `!procedure\nsyntax: memsphere-20261027-stable\nmode: graph\nname: schema-cli\ndefines: [Report]\nactions:\n  - !action\n    id: report\n    description: Report\n    dependencies: [!dependency {from: START}]\n    artifact:\n      name: Report\n      model:\n        definedBy: memsphere/schema.json\n        definition: |\n          !schema\n          syntax: memsphere-20261027-stable\n          type: object\n          fields: [summary]\n      payload: {contentType: application/json}\n`);
  const { runId: run, stepId: step } = await call("run", "start", "--file", file, "--name", "Schema CLI");
  assert.ok(step);
  const target = ["--run", run, "--step", step];
  return { run, step, target };
}

test("real graph CLI and Continue save a positioned draft, export and submit the same Artifact", { timeout: 90000 }, async t => {
  const setupStarted = performance.now();
  const fixture = await schemaCliFixture(t);
  t.diagnostic(`Fixture setup took ${Math.round(performance.now() - setupStarted)} ms`);
  const { f } = fixture;
  const call = async (...args: string[]) => {
    const started = performance.now();
    try {
      return await fixture.call(...args);
    } finally {
      const command = args.join(" ").split(" --", 1)[0];
      t.diagnostic(`${command} took ${Math.round(performance.now() - started)} ms`);
    }
  };
  const { target } = await startSchemaStep({ ...fixture, call });
  const initial = await call("continue", "enter-schema");
  assert.equal(Object.hasOwn(initial, "stepId"), false);
  assert.ok(initial.position);
  const saved = await call("continue", "schema", "report", "--position", initial.position, "--artifact", '{"summary":"draft"}');
  assert.equal(saved.artifactId, initial.artifactId);
  assert.equal(saved.phase, "awaiting_finalization");

  const copy = join(f.directory, "copy.json");
  const exported = await call("continue", "artifact", "export", "--file", copy);
  assert.equal(exported.artifactId, initial.artifactId);
  assert.deepEqual(exported.nextAction.args, ["continue", "report", "--artifact-file", copy]);
  assert.deepEqual(JSON.parse(await readFile(copy, "utf8")), { summary: "draft" });
  await writeFile(copy, '{"summary":"final"}');
  const submitted = await call(...exported.nextAction.args);
  assert.equal(submitted.artifactId, initial.artifactId);
  assert.equal(submitted.status, "done");

  const finalCopy = join(f.directory, "submitted.json");
  const persisted = await call("run", "artifact", "export", ...target, "--file", finalCopy);
  assert.equal(persisted.artifactId, initial.artifactId);
  assert.deepEqual(JSON.parse(await readFile(finalCopy, "utf8")), { summary: "final" });
});

test("graph Schema CLI preserves draft identity and enforces position and lifecycle boundaries", { timeout: 90000 }, async t => {
  const fixture = await schemaCliFixture(t, "worker");
  const { f, call } = fixture;
  const { run, target } = await startSchemaStep(fixture);
  for (const state of [await call("run", "schema", "show", ...target), await call("continue", "schema", "show")]) {
    assert.equal(state.phase, "not_started");
    assert.ok(state.nextAction.args.includes("enter-schema"));
  }
  const mutations = [["schema", "report", "--artifact", "{}"], ["repeat", "0"], ["skip"]];
  for (const operation of mutations) {
    await assert.rejects(call("run", ...operation, ...target, "--position", "unopened"), /STEP_NOT_RUNNING/);
    await assert.rejects(call("continue", ...operation, "--position", "unopened"), /STEP_NOT_RUNNING/);
  }
  assert.equal((await call("run", "schema", "show", ...target)).phase, "not_started");
  const initial = await call("continue", "enter-schema");
  const saved = await call("continue", "schema", "report", "--position", initial.position, "--artifact", '{"summary":"draft"}');
  assert.equal(saved.artifactId, initial.artifactId); assert.equal(saved.phase, "awaiting_finalization");
  await assert.rejects(call("run", "schema", "report", ...target, "--position", initial.position, "--artifact", '{"summary":"late"}'), /SCHEMA_POSITION_CHANGED/);
  const reference = join(f.directory, "invalid-reference.json");
  await writeFile(reference, JSON.stringify({ contentRef: { storeId: "context_control/artifacts", dataId: `${run}/${initial.artifactId}`, sha256: "0".repeat(64) } }));
  await assert.rejects(call("continue", "report", "--file", reference), /(CONTENT_CHANGED|RECOVERY_REQUIRED|INVALID_ARGUMENT)/);
  const failed = await call("continue", "schema", "show");
  assert.equal(failed.validation.status, "failed");
  assert.equal(failed.validation.issueCount, 1);
  assert.equal(failed.validation.reason, "CONTENT_DIGEST_MISMATCH");
  assert.equal(Object.hasOwn(failed, "draft"), false);
  const native = await call("run", "schema", "show", ...target);
  assert.equal(native.phase, "awaiting_finalization");
  assert.equal(native.artifactId, initial.artifactId);
  for (const draft of [await call("run", "enter-schema", ...target), await call("continue", "enter-schema")]) {
    assert.equal(draft.phase, "awaiting_finalization");
    assert.equal(draft.artifactId, initial.artifactId);
  }
  const nativeCopy = join(f.directory, "native-copy.json");
  const nativeExport = await call("run", "artifact", "export", ...target, "--file", nativeCopy);
  assert.equal(nativeExport.exported, nativeCopy);
  assert.deepEqual(JSON.parse(await readFile(nativeCopy, "utf8")), { summary: "draft" });
  const submitted = await call("run", "report", ...target, "--artifact-file", nativeCopy);
  assert.equal(submitted.artifactId, initial.artifactId);
  assert.equal(submitted.status, "done");
  for (const operation of mutations) {
    await assert.rejects(call("run", ...operation, ...target, "--position", initial.position), /STEP_NOT_RUNNING|RUN_FINISHED/);
    await assert.rejects(call("continue", ...operation, "--position", initial.position), /RUN_FINISHED/);
  }
  assert.equal((await call("run", "schema", "show", ...target)).phase, "submitted");
  assert.equal((await call("continue", "schema", "show")).phase, "submitted");
});

test("Graph Schema CLI cancellation and command deadline stop a waiting worker before it updates the draft", { timeout: 90000 }, async t => {
  const fixture = await schemaCliFixture(t, "worker");
  const { f, env, call } = fixture;
  const { target } = await startSchemaStep(fixture);
  const initial = await call("continue", "enter-schema");
  const input = join(f.directory, "field.json");
  await writeFile(input, '{"summary":"must not persist"}');
  // Pause the actual command before it can write the field, then observe worker exit.
  const preload = join(f.directory, "pause-schema-read.mjs");
  await writeFile(preload, `
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const readFile = fs.readFile;
fs.readFile = async (path, ...args) => {
  if (path === process.env.MEMSPHERE_PAUSED_SCHEMA_INPUT) {
    process.send({ type: "reading-schema-input" });
    await new Promise(resolve => process.once("message", resolve));
  }
  return readFile(path, ...args);
};
syncBuiltinESMExports();
`);
  const workerEnv = {
    ...env, NODE_OPTIONS: [env.NODE_OPTIONS, `--import=${pathToFileURL(preload).href}`].filter(Boolean).join(" "),
    MEMSPHERE_PAUSED_SCHEMA_INPUT: input
  };
  for (const stop of ["abort", "deadline"] as const) {
    const controller = new AbortController();
    const worker = cliModuleProcess({
      cwd: f.cwd, env: workerEnv, entrypoint: cli,
      signal: AbortSignal.any([t.signal, controller.signal]), timeout: cliTimeout, beforeCleanup: f.beforeCleanup
    });
    const paused = once(worker.child, "message", { signal: t.signal });
    if (stop === "deadline") t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const writing = worker.invoke(["--project", "test-project", "continue", "schema", "report",
        "--position", initial.position, "--artifact-file", input, "--output", "json"]);
      const [event] = await Promise.race([paused, writing.then(() => { throw new Error("Schema write passed the input barrier"); })]);
      assert.deepEqual(event, { type: "reading-schema-input" });
      if (stop === "abort") {
        const reason = new Error("Test cancelled while reading the field");
        controller.abort(reason);
        await assert.rejects(writing, error => error === reason);
      } else {
        t.mock.timers.tick(cliTimeout);
        await assert.rejects(writing, /CLI command timed out after 20000 ms/);
      }
      assert.ok(worker.child.exitCode !== null || worker.child.signalCode !== null);
    } finally {
      if (stop === "deadline") t.mock.timers.reset();
    }
    const unchanged = await call("run", "schema", "show", ...target);
    assert.equal(unchanged.phase, "writing");
    assert.equal(unchanged.artifactId, initial.artifactId);
    assert.equal(unchanged.position, initial.position);
  }
});

test("Schema native entry and Continue retain all rule scopes, input links and Human responsibility", { timeout: 90000 }, async t => {
  const { f, call, raw } = await schemaCliFixture(t, "worker");
  const { serializeMemoryYaml } = await import("../src/memory/serializer.js");
  const source = { tag: "!procedure", syntax: "memsphere-20261027-stable", mode: "graph", names: ["schema-context"], defines: ["Report"], asserts: ["Workflow rule"], actions: [
    { tag: "!action", id: "input", description: "Prepare", dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "Input", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/plain" } } },
    { tag: "!action", id: "report", actor: "human", description: "Write the report", asserts: ["Action rule"], dependencies: [{ tag: "!dependency", from: "input" }], artifact: { name: "Report", asserts: ["Artifact rule"], model: { definedBy: "memsphere/schema.json", definition: "!schema\nsyntax: memsphere-20261027-stable\ntype: object\nfields: [summary]\n" }, payload: { contentType: "application/json" } } }
  ] };
  const file = join(f.directory, "context.yaml"); await writeFile(file, serializeMemoryYaml(source as import("../src/memory/ast.js").GraphProcedureMemory));
  const started = await call("run", "start", "--file", file, "--name", "Context");
  const delivered = await call("continue", "report", "--artifact", "Upstream source");
  const snapshot = await call("run", "show", "--run", started.runId);
  const step = snapshot.steps.find((s: any) => s.actionId === "report").id;
  const native = await raw("run", "step", "enter", "--run", started.runId, "--step", step);
  assert.equal(delivered.nextStep, step);
  assert.equal(delivered.nextActor, "human");
  assert.equal(delivered.nextAction.kind, "human_confirmation");
  assert.ok(delivered.nextAction.resume.args.includes("enter-schema"));
  for (const requirement of ["Workflow rule", "Action rule", "Artifact rule", delivered.artifactId, "run artifact show", "human", "enter-schema"]) {
    assert.ok(native.includes(requirement), requirement);
  }
  const details = await call("run", "step", "show", "--run", started.runId, "--step", step);
  assert.ok(Object.values(details.step.inputGroups).flat().some((input: any) => input.id === delivered.artifactId));
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
  await assert.rejects(call("run", "schema", "report", "--run", run, "--step", a, "--position", first.position!, "--artifact", '{"summary":"wrong target"}'), /SESSION_CONTEXT_CONFLICT/);
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
  assert.equal(savedB.artifactId, second.draft!.id);
  await raw("run", "step", "enter", "--run", run, "--step", a);
  const resumed = await call("continue", "schema", "show");
  assert.equal(resumed.artifactId, first.draft!.id); assert.equal(resumed.position, first.position); assert.equal(Object.hasOwn(resumed, "draft"), false);
  const savedA = await call("continue", "schema", "report", "--position", first.position!, "--artifact", '{"summary":"A"}');
  assert.equal(savedA.artifactId, first.draft!.id);
  const untouched = await service.withGraph(g => g.schemaShow(run, b));
  assert.equal(untouched.draft!.id, second.draft!.id); assert.equal(untouched.draft!.content!.payload.content, '{"summary":"B"}');
});

test("Continue submits each concurrent Schema draft once and preserves both completed identities", { timeout: 90000 }, async t => {
  const { call, raw, run, a, first, second } = await parallelDraftFixture(t, { a: "A", b: "B" });
  await raw("run", "step", "enter", "--run", run, "--step", a);
  const aDone = await call("continue", "report", "--artifact", '{"summary":"A"}'); assert.equal(aDone.artifactId, first.draft!.id);
  const bDraft = await call("continue", "schema", "show"); assert.equal(bDraft.artifactId, second.draft!.id);
  const bDone = await call("continue", "report", "--artifact", '{"summary":"B"}'); assert.equal(bDone.artifactId, second.draft!.id);
  const completed = await call("run", "show", "--run", run);
  assert.deepEqual(new Set(completed.steps.filter((step: any) => step.status === "done").map((step: any) => step.artifactId)), new Set([first.draft!.id, second.draft!.id]));
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
  assert.equal(state.validation.status, "passed");
  assert.equal(Object.hasOwn(state.validation, "issueCount"), false);
  const verified = await service.withGraph(g => g.schemaShow(identity.run, identity.step));
  assert.equal(verified.validation?.artifactId, identity.artifactId);
  assert.equal(verified.validation?.sha256, createHash("sha256").update(final).digest("hex"));
  assert.deepEqual(verified.validation?.issues, []);
});
