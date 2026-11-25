import { invokeCliModule } from "./helpers/cli-module.js";
import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initializedContextFixture } from "./helpers/initialized-context.js";
import { businessFixture } from "./helpers/business-data.js";
import { serializeMemoryYaml } from "../src/memory/serializer.js";
import type { GraphProcedureMemory } from "../src/memory/ast.js";

import { openContextControl } from "../src/project/context-control.js";
import { requireCommandState } from "../src/home/command-state-store.js";
import { ownTestProcess } from "./helpers/owned-process.js";


const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

async function fixture(t: test.TestContext, multiple = false, prepared = true, processBoundary = false, embedded = false) {
  const f = prepared ? await initializedContextFixture(t) : await businessFixture(t, {});
  await writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: { codex: { identity_enabled: true, async_enabled: false } } }));
  await exec("git", ["init", "-b", "master"], { cwd: f.root });
  const config = JSON.parse(await readFile(join(f.root, "config.json"), "utf8"));
  if (embedded) config.store = { type: "embedded", repository_path: f.root, memory_path: "memory" };
  else {
    // These contracts concern graph commands, not linked-worktree discovery.
    // Give Managed Memory a real committed baseline rather than paying for
    // unrelated Embedded worktree enumeration on every Store read.
    const cwd = join(f.root, "memory");
    await exec("git", ["init", "-b", "master"], { cwd });
    await exec("git", ["-c", "user.name=Graph Test", "-c", "user.email=graph@example.invalid", "commit", "--allow-empty", "-m", "Fixture baseline"], { cwd });
    config.store = { type: "managed", branch: "master", published_revision: (await exec("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim() };
  }
  await writeFile(join(f.root, "config.json"), JSON.stringify(config));
  const procedure = join(f.directory, "graph.yaml");
  const action = (id: string) => `  - !action\n    id: ${id}\n    description: Produce ${id}\n    dependencies: [!dependency {from: START}]\n    artifact:\n      name: ${id} output\n      model: {definedBy: raw.json, definition: '{}'}\n      payload: {contentType: text/plain}\n`;
  await writeFile(procedure, `!procedure\nsyntax: memsphere-20261027-stable\nnames: [cli-graph]\ndefines: [CLI graph]\nmode: graph\nactions:\n${action("A")}${multiple ? action("B") : ""}`);
  const invokeUsing = (native: boolean, args: string[]) => {
    t.signal.throwIfAborted();
    const env = { ...process.env, MEMSPHERE_HOME: f.home, XDG_RUNTIME_DIR: f.directory, CODEX_THREAD_ID: "graph-session", TRAECLI_THREAD_ID: "" };
    const result = native
      ? exec(process.execPath, [cli, "--project", "test-project", ...args], { cwd: f.root, env })
      : invokeCliModule(["--project", "test-project", ...args], f.root, env, cli);
    if ("child" in result) ownTestProcess(result.child, t.signal, f.beforeCleanup);
    return result.then(value => { t.signal.throwIfAborted(); return value; })
      .catch(error => { throw new Error(`${error.message}\nstdout: ${error.stdout}\nstderr: ${error.stderr}`); });
  };
  const invoke = (...args: string[]) => invokeUsing(processBoundary, args);
  const call = async (...args: string[]) => JSON.parse((await invoke(...args, "--output", "json")).stdout);
  const invokeInProcess = (...args: string[]) => invokeUsing(false, args);
  const callInProcess = async (...args: string[]) => JSON.parse((await invokeInProcess(...args, "--output", "json")).stdout);
  const inspect = async (runId: string) => (await openContextControl(f.root))!.inspect(runId);
  return { ...f, procedure, invoke, call, invokeInProcess, callInProcess, inspect };
}

for (const language of ["zh-CN", "en"] as const) test(`graph CLI module ${language} Step prompts provide executable fixed-material reads for direct and collected inputs`, { timeout: 90000 }, async t => {
  const f = await fixture(t);
  await writeFile(join(f.home, "config.json"), JSON.stringify({ language, runner_agents: { codex: { identity_enabled: true, async_enabled: false } } }));
  const artifact = { name: "Result", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/plain" } };
  const p: GraphProcedureMemory = { tag: "!procedure", syntax: "memsphere-20261027-stable", names: ["cli-materials"], defines: ["Read materials"], mode: "graph", actions: [
    { tag: "!action", id: "seed", description: "Prepare", dependencies: [{ tag: "!dependency", from: "START" }, { tag: "!dependency", from: "b", when: 'artifacts.b = "again"' }], artifact },
    { tag: "!action", id: "b", description: "Use direct input", dependencies: [{ tag: "!dependency", from: "seed" }], artifact },
    { tag: "!action", id: "gather", description: "Collect", dependencies: [{ tag: "!dependency", from: "b", when: 'artifacts.b = "stop"' }], collect: ["seed", "b"] },
    { tag: "!action", id: "final", description: "Use collected inputs", dependencies: [{ tag: "!dependency", from: "gather" }], artifact }
  ] };
  await writeFile(f.procedure, serializeMemoryYaml(p));
  const start = await f.call("run", "start", "--file", f.procedure, "--name", "Read closed inputs");
  const first = await f.call("continue", "report", "--artifact", "seed body");
  const read = (id: string) => ["--project", "test-project", "run", "artifact", "show", "--run", start.runId, "--artifact", id];
  assert.deepEqual(first.nextMaterials[0].read.args, read(first.artifactId));
  const second = await f.call("continue", "report", "--artifact", "again");
  const third = await f.call("continue", "report", "--artifact", "seed second body");
  const last = await f.call("continue", "report", "--artifact", "stop");
  const final = (await f.call("run", "show", "--run", start.runId)).steps.find((s: any) => s.actionId === "final");
  const detail = await f.call("run", "step", "show", "--run", start.runId, "--step", final.id);
  assert.deepEqual(detail.step.inputGroups, { seed: [{ kind: "artifact", id: first.artifactId }, { kind: "artifact", id: third.artifactId }], b: [{ kind: "artifact", id: second.artifactId }, { kind: "artifact", id: last.artifactId }] });
  for (const [id, text] of [[first.artifactId, "seed body"], [second.artifactId, "again"], [third.artifactId, "seed second body"], [last.artifactId, "stop"]]) {
    const material = last.nextMaterials.find((material: any) => material.id === id);
    assert.deepEqual(material.read.args, read(id));
    const result = await f.invoke(...material.read.args);
    assert.match(result.stdout, new RegExp(text));
  }
});

test("graph CLI auto-enters one Step, binds Continue and leaves show read-only", { timeout: 60000 }, async t => {
  const f = await fixture(t, false, false, true, true);
  const start = await f.call("run", "start", "--file", f.procedure, "--name", "CLI graph");
  assert.equal(Object.hasOwn(start, "prompt"), false);
  const snapshot = await f.call("run", "show", "--run", start.runId);
  const step = snapshot.steps[0]; assert.equal(step.status, "running");
  const before = await readFile(join(f.root, "data/context_control/steps", start.runId, `${step.id}.json`), "utf8");
  await f.call("run", "step", "show", "--run", start.runId, "--step", step.id);
  assert.equal(await readFile(join(f.root, "data/context_control/steps", start.runId, `${step.id}.json`), "utf8"), before);
  const help = await f.invoke("continue", "--help"); assert.match(help.stdout, new RegExp(step.id));
  const result = await f.call("continue", "report", "--artifact", "done");
  assert.equal(result.stepId, step.id); assert.equal(result.status, "done");
  assert.ok(result.nextAction.args.includes("finish"));
  await assert.rejects(f.invoke("continue", "report", "--artifact", "duplicate"), /RUN_FINISHED/);
  await f.call("run", "finish", "--run", start.runId);
});

test("CLI module multiple pending Steps require explicit enter; repeated enter returns the same Continue binding", { timeout: 60000 }, async t => {
  const f = await fixture(t, true);
  const start = await f.call("run", "start", "--file", f.procedure, "--name", "Choose");
  assert.equal(start.nextAction.kind, "choose");
  assert.ok(start.nextAction.choices.every((action: any) => action.args.includes("enter")));
  assert.equal(start.instruction, undefined);
  const snapshot = await f.call("run", "show", "--run", start.runId);
  assert.deepEqual(snapshot.steps.map((s: any) => s.status), ["pending", "pending"]);
  const id = snapshot.steps[0].id;
  const first = await f.invoke("run", "step", "enter", "--run", start.runId, "--step", id);
  const second = await f.invoke("run", "step", "enter", "--run", start.runId, "--step", id);
  assert.equal(first.stdout, second.stdout);
  await assert.rejects(f.call("run", "report", "--run", start.runId, "--artifact", "missing step"), /INVALID_ARGUMENT/);
  await assert.rejects(f.call("run", "finish", "--run", start.runId), /GRAPH_INCOMPLETE/);
});

test("independent CLI processes enter idempotently and complete different Steps with unique completion sequence", { timeout: 60000 }, async t => {
  const f = await fixture(t, true, true, true);
  await writeFile(join(f.home, "config.json"), JSON.stringify({}));
  const start = await f.call("run", "start", "--file", f.procedure, "--name", "concurrent");
  const steps = (await f.call("run", "show", "--run", start.runId)).steps;
  const entries = await Promise.all([...steps, steps[0]].map((s: any) => f.invoke("run", "step", "enter", "--run", start.runId, "--step", s.id)));
  assert.equal(entries[0].stdout, entries[2].stdout);
  const submitted = await Promise.allSettled(steps.map((s: any) => f.call("run", "report", "--run", start.runId, "--step", s.id, "--artifact", s.id)));
  for (const submission of submitted) if (submission.status === "rejected") {
    const line = submission.reason.message.split("\n").find((line: string) => line.startsWith('{"error":'));
    assert.ok(line, "concurrent report failure must provide a machine-readable error");
    const error = JSON.parse(line).error;
    assert.ok(["REVISION_CONFLICT", "ALREADY_EXISTS"].includes(error.code), JSON.stringify(error));
    assert.equal(error.details.runId, start.runId); assert.ok(error.details.artifactId);
    assert.deepEqual(error.nextAction.args.slice(-4), ["run", "status", "--run", start.runId]);
  }
  // A saved submission remains durable even when concurrent automatic recovery conflicts.
  await f.call("run", "status", "--run", start.runId);
  const result = await f.inspect(start.runId);
  assert.equal(result.steps.length, 2); assert.equal(result.artifacts.length, 2);
  assert.deepEqual(result.steps.map((s: any) => s.status), ["done", "done"]);
  assert.equal(new Set(result.steps.map((s: any) => s.completionSequence)).size, 2);
  assert.equal(result.run.frames[0].graphFrame.processedStepIds.length, 2);
});

test("CLI module Continue binds Human authorization and advisory resolution to its Step and closes after Runner acceptance", { timeout: 120000 }, async t => {
  const f = await fixture(t);
  const config = JSON.parse(await readFile(join(f.root, "config.json"), "utf8"));
  config.control_plane = { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { reviewer: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] }, advisor: { kind: "human", name: "Advisor", permissions: ["artifact.read", "decision.assess"] } } };
  await writeFile(join(f.root, "config.json"), JSON.stringify(config));
  await writeFile(f.procedure, (await readFile(f.procedure, "utf8")).replace("      payload:", "      review: [approval]\n      payload:"));
  const binding = join(f.directory, "review.json");
  await writeFile(binding, JSON.stringify({ reviews: { "cli-graph#actions[A]": { policy: "artifact_acceptance.unanimous" } }, slots: { "cli-graph::approval": { actors: ["reviewer", "advisor"] } } }));
  const start = await f.call("run", "start", "--file", f.procedure, "--review-config", binding, "--name", "review context");
  assert.equal(Object.hasOwn(start, "prompt"), false);
  const report = await f.call("continue", "report", "--artifact", "candidate");
  assert.equal(report.status, "awaiting_review"); assert.deepEqual(report.nextAction.resume.args, ["continue", "review", "wait"]);
  const snapshot = await f.inspect(start.runId), step = snapshot.steps[0], round = step.reviewRounds![0];
  const comments = join(f.directory, "comments.json"); await writeFile(comments, "[]");
  const handle = `graph-review-${start.runId}__${step.id}`;
  const vote = ["review", "submit-for-human", "--assignment", "reviewer", "--vote", "approve", "--comments-file", comments];
  await assert.rejects(f.call("continue", ...vote), /INTERNAL_ERROR/);
  await assert.rejects(f.call("continue", ...vote, "--authorization-note", ""), /PERMISSION_DENIED/);
  await assert.rejects(f.call("continue", ...vote, "--round", "other-round", "--authorization-note", "fixture authorization"), /INVALID_ARGUMENT/);
  await assert.rejects(f.call("continue", ...vote, "--run", "other-run", "--authorization-note", "fixture authorization"), /INVALID_ARGUMENT/);
  await f.call("continue", ...vote, "--authorization-note", "Simulated authorized vote in an isolated test fixture");
  const note = join(f.directory, "advice.json"); await writeFile(note, JSON.stringify([{ body: "Clarify purpose", severity: "blocking" }]));
  await f.call("continue", "review", "submit-for-human", "--assignment", "advisor", "--vote", "approve", "--comments-file", note, "--authorization-note", "Isolated fixture advisor authorization");
  const reviewed = await f.inspect(start.runId);
  const personal = reviewed.reviews.find((r: any) => r.reviewer.actorId === "advisor");
  assert.equal(personal.roundId, round.id); assert.match(personal.vote.delegationNote, /fixture advisor authorization/);
  const commentId = personal.comments[0].commentId;
  assert.equal(typeof commentId, "string"); assert.ok(commentId.length > 0);
  assert.equal(personal.comments[0].id, undefined);
  const resolve = ["review", "resolve", "--comment", commentId, "--disposition", "accepted-fixed", "--note", "Clarified in candidate"];
  await assert.rejects(f.call("continue", ...resolve), /INVALID_ARGUMENT/);
  const runPath = join(f.root, "data/context_control/runs", `${start.runId}.json`);
  const saved = await readFile(runPath, "utf8"), restricted = JSON.parse(saved);
  restricted.value.permissionConfig.runner.permissions = ["artifact.read", "artifact.submit"];
  await writeFile(runPath, JSON.stringify(restricted));
  await assert.rejects(f.call("continue", ...resolve, "--validation-summary", "Checked candidate"), /PERMISSION_DENIED/);
  await writeFile(runPath, saved);
  await f.call("continue", ...resolve, "--validation-summary", "Checked candidate");
  const resolved = await f.inspect(start.runId);
  assert.equal(resolved.steps[0].reviewRounds[0].resolutions[0].commentId, commentId);
  assert.equal(resolved.steps[0].reviewRounds[0].id, round.id);
  assert.equal(resolved.steps[0].id, step.id);
  const wait = await f.invoke("continue", "review", "wait"); assert.match(wait.stdout, /approve/);
  const accepted = await f.invoke("continue", "review", "vote", "--vote", "approve"); assert.match(accepted.stdout, /finish/);
  assert.equal((await f.call("run", "show", "--run", start.runId)).steps[0].id, step.id);
  assert.match((await f.invoke("continue", "--help")).stdout, /done/);
});


test("CLI module failed auxiliary Continue store preserves the running Step and offers a native report command", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  await mkdir(join(f.home, "data"), { recursive: true });
  const invalid = join(f.home, "data", "runner-sessions"); await writeFile(invalid, "not a directory");
  const start = await f.call("run", "start", "--file", f.procedure, "--name", "context recovery");
  assert.deepEqual(start.nextAction.args.slice(2, 7), ["run", "report", "--run", start.runId, "--step"]);
  const before = await f.call("run", "show", "--run", start.runId); assert.equal(before.steps.length, 1); assert.equal(before.steps[0].status, "running");
  await rm(invalid);
  const recovered = await f.invoke("run", "step", "enter", "--run", start.runId, "--step", before.steps[0].id);
  assert.match(recovered.stdout, /memsphere continue report/);
});

test('CLI rewind preview is read only, preserves Continue, and requires explicit enter', {timeout:60000}, async t=>{
 const f=await fixture(t, false, true, true);
 // Prepare and inspect through the real command tree in process. The preview,
 // rewind, stale Continue, explicit enter and fresh report still cross native
 // process boundaries to protect persisted bindings and replacement behavior.
 const start=await f.callInProcess('run','start','--file',f.procedure,'--name','rewind CLI');
 const completed=await f.callInProcess('continue','report','--artifact','old body');
 const show=await f.callInProcess('run','show','--run',start.runId);
 const target=show.steps[0].id;
 const {snapshotTree}=await import('./helpers/business-data.js');
 const before=await snapshotTree(f.root);
 const preview=await f.call('run','step','rewind','--run',start.runId,'--step',target,'--dry-run');
 assert.equal(preview.dryRun,true); assert.deepEqual(await snapshotTree(f.root),before);
 await assert.rejects(f.invokeInProcess('run','step','rewind','--run',start.runId,'--step',target,'--reason',' '),/INVALID_ARGUMENT/);
 const reason=join(f.directory,'reason.md');await writeFile(reason,'Product needs revision');
 await assert.rejects(f.invokeInProcess('run','step','rewind','--run',start.runId,'--step',target,'--reason','x','--reason-file',reason),/INVALID_ARGUMENT/);
 const result=await f.call('run','step','rewind','--run',start.runId,'--step',target,'--reason-file',reason);
 assert.deepEqual(result.nextAction.args.slice(2, 5), ["run", "step", "enter"]);
 const next=await f.callInProcess('run','show','--run',start.runId);
 assert.equal(next.steps.find((s:any)=>s.id===result.replacementStepId).status,'pending');
 assert.equal(next.steps.find((s:any)=>s.id===target).effective,false);
 await assert.rejects(f.invoke('continue','report','--artifact','late body'),/STEP_SUPERSEDED/);
 await f.invoke('run','step','enter','--run',start.runId,'--step',result.replacementStepId);
 const fresh=await f.call('continue','report','--artifact','new body');
 const final=await f.inspect(start.runId);
 assert.equal(final.artifacts.find((a:any)=>a.id===fresh.artifactId).revisedFrom,completed.artifactId);
});

for (const path of ['status', 'branch-report', 'branch-review']) test(`CLI module ${path} preserves explicit enter for a pending rewind replacement`, { timeout: 120000 }, async t => {
  const f = await fixture(t, path !== 'status');
  const binding = join(f.directory, 'replacement-review.json');
  if (path === 'branch-review') {
    const config = JSON.parse(await readFile(join(f.root, 'config.json'), 'utf8'));
    config.control_plane = { runner: { permissions: ['artifact.read', 'artifact.submit', 'decision.decide'] }, actors: { reviewer: { kind: 'human', name: 'Human', permissions: ['artifact.read', 'decision.decide'] } } };
    await writeFile(join(f.root, 'config.json'), JSON.stringify(config));
    await writeFile(f.procedure, (await readFile(f.procedure, 'utf8')).replace('      name: B output', '      review: [approval]\n      name: B output'));
    await writeFile(binding, JSON.stringify({ reviews: { 'cli-graph#actions[B]': { policy: 'artifact_acceptance.unanimous' } }, slots: { 'cli-graph::approval': { actors: ['reviewer'] } } }));
  }
  const start = await f.call('run', 'start', '--file', f.procedure, '--name', 'explicit replacement', ...(path === 'branch-review' ? ['--review-config', binding] : []));
  const initial = await f.call('run', 'show', '--run', start.runId);
  const a = initial.steps.find((s: any) => s.actionId === 'A');
  await f.invoke('run', 'step', 'enter', '--run', start.runId, '--step', a.id);
  const originalBinding = await requireCommandState('codex-graph-session', f.home);
  const rewind = await f.call('run', 'step', 'rewind', '--run', start.runId, '--step', a.id, '--reason', 'revise A');
  const target = rewind.replacementStepId;
  let prompt: string;
  if (path === 'status') {
    await writeFile(join(f.home, 'config.json'), JSON.stringify({}));
    prompt = (await f.invoke('run', 'status', '--run', start.runId)).stdout;
    await writeFile(join(f.home, 'config.json'), JSON.stringify({ runner_agents: { codex: { identity_enabled: true, async_enabled: false } } }));
  } else {
    const b = initial.steps.find((s: any) => s.actionId === 'B');
    await f.invoke('run', 'step', 'enter', '--run', start.runId, '--step', b.id);
    const report = await f.call('continue', 'report', '--artifact', 'B candidate');
    prompt = (report.nextAction?.args ?? []).join(" ");
    if (path === 'branch-review') {
      assert.equal(report.status, 'awaiting_review');
      const comments = join(f.directory, 'replacement-comments.json'); await writeFile(comments, '[]');
      await f.invoke('continue', 'review', 'submit-for-human', '--assignment', 'reviewer', '--vote', 'approve', '--comments-file', comments, '--authorization-note', 'Simulated authorized review in an isolated test fixture');
      prompt = (await f.invoke('continue', 'review', 'vote', '--vote', 'approve')).stdout;
    }
  }
  assert.ok(prompt.includes(`run step enter --run ${start.runId} --step ${target}`), prompt);
  const before = await f.call('run', 'show', '--run', start.runId);
  assert.equal(before.steps.find((s: any) => s.id === target).status, 'pending');
  if (path === 'status') {
    assert.deepEqual(await requireCommandState('codex-graph-session', f.home), originalBinding);
    await assert.rejects(f.invoke('continue', '--help'), error => {
      const message = String(error); return message.includes(a.id) && message.includes('STEP_SUPERSEDED') && !message.includes(target);
    });
    await assert.rejects(f.invoke('continue', 'report', '--artifact', 'obsolete'), /STEP_SUPERSEDED/);
  } else {
    const help = (await f.invoke('continue', '--help')).stdout;
    assert.ok(!help.includes(target), help);
  }
  await f.invoke('run', 'step', 'enter', '--run', start.runId, '--step', target);
  assert.ok((await f.invoke('continue', '--help')).stdout.includes(target));
  const accepted = await f.call('continue', 'report', '--artifact', 'new A');
  assert.equal(accepted.stepId, target);
  assert.equal(accepted.status, 'done');
});

test('rewind JSON argument and superseded errors use the structured stderr contract', { timeout: 60000 }, async t => {
  const f = await fixture(t, false, true, true);
  const start = await f.call('run', 'start', '--file', f.procedure, '--name', 'structured rewind errors');
  const old = (await f.call('run', 'show', '--run', start.runId)).steps[0].id;
  const rewind = await f.call('run', 'step', 'rewind', '--run', start.runId, '--step', old, '--reason', 'new A');
  const { snapshotTree } = await import('./helpers/business-data.js');
  const before = await snapshotTree(f.root);
  const cases: Array<[string[], string]> = [
    [['run', 'step', 'rewind', '--step', 'dummy', '--dry-run'], 'INVALID_ARGUMENT'],
    [['run', 'step', 'rewind', '--run', start.runId, '--step', rewind.replacementStepId], 'INVALID_ARGUMENT'],
    [['run', 'step', 'rewind', '--run', start.runId, '--step', old, '--dry-run'], 'STEP_SUPERSEDED']
  ];
  for (const [args, code] of cases) {
    await assert.rejects(exec(process.execPath, [cli, '--project', 'test-project', ...args, '--output', 'json'], { cwd: f.root, env: { ...process.env, MEMSPHERE_HOME: f.home, XDG_RUNTIME_DIR: f.directory, CODEX_THREAD_ID: 'graph-session', TRAECLI_THREAD_ID: '' } }), (error: any) => {
      assert.equal(error.code, 1); assert.equal(error.stdout, '');
      const result = JSON.parse(error.stderr);
      assert.equal(result.error.code, code);
      assert.equal(Object.hasOwn(result.error, 'message'), false);
      assert.equal(error.stderr, `${JSON.stringify(result)}\n`);
      return true;
    });
  }
  assert.deepEqual(await snapshotTree(f.root), before);
});

test("graph native and Continue reports validate business options before writing", { timeout: 90000 }, async t => {
  const f = await fixture(t);
  const { mutateModel } = await import("../src/project/model-service.js");
  const { openBusinessStore } = await import("../src/project/business-stores.js");
  await mutateModel({}, f.root, "create", "cli-record.json", { source: '{"type":"object","required":["name"],"properties":{"name":{"type":"string"}}}' });
  await f.createStore("records", "cli-record.json");
  const artifact: NonNullable<GraphProcedureMemory["actions"][number]["artifact"]> = {
    name: "Record", model: { definedBy: "json-schema/draft-07.json", definition: '{"type":"object"}' },
    payload: { contentType: "application/json" }, store: { store_id: "records", operation: "upsert" }
  };
  await writeFile(f.procedure, serializeMemoryYaml({
    tag: "!procedure", syntax: "memsphere-20261118-stable", names: ["cli-store"], defines: ["Save records"], goals: [], mode: "graph",
    actions: [{ tag: "!action", id: "write", description: "Save", dependencies: [{ tag: "!dependency", from: "START" }], artifact }]
  }));
  const { store } = await openBusinessStore({}, f.root, "records");
  const first = await f.call("run", "start", "--file", f.procedure, "--name", "Native");
  const step = (await f.call("run", "show", "--run", first.runId)).steps[0].id;
  await assert.rejects(f.call("run", "report", "--run", first.runId, "--step", step, "--artifact", "{}", "--write-options", '{"data_id":"native"}'));
  for (const data_id of ["parent/child", "a".repeat(251)])
    await assert.rejects(f.call("run", "report", "--run", first.runId, "--step", step, "--artifact", '{"name":"native"}', "--write-options", JSON.stringify({ data_id })), /INVALID_ARGUMENT/);
  assert.deepEqual((await store.list({}, {})).items, []);
  await f.call("run", "report", "--run", first.runId, "--step", step, "--artifact", '{"name":"native"}', "--write-options", '{"data_id":"native"}');
  const second = await f.call("run", "start", "--file", f.procedure, "--name", "Continue");
  await assert.rejects(f.call("continue", "report", "--artifact", '{"name":"continue"}', "--write-options", '{"unexpected":true}'));
  assert.equal((await store.list({}, {})).items.length, 1);
  const done = await f.call("continue", "report", "--artifact", '{"name":"continue"}', "--write-options", '{"data_id":"continue"}');
  assert.equal(done.runId, second.runId);
  assert.equal(done.status, "done");
  assert.deepEqual((await store.get({}, "continue") as { value: unknown }).value, { name: "continue" });
});

test("graph Store retry closes the terminal Step's Continue binding and preserves its candidate", { timeout: 90000 }, async t => {
  const f = await fixture(t);
  const { mutateModel } = await import("../src/project/model-service.js");
  const { openBusinessStore } = await import("../src/project/business-stores.js");
  const { bytesContent, readAll } = await import("../src/data/extensions/shared/payload.js");
  await mutateModel({}, f.root, "create", "cli-record.json", { source: '{"type":"object"}' });
  await f.createStore("records", "cli-record.json", "data");
  await writeFile(f.procedure, serializeMemoryYaml({
    tag: "!procedure", syntax: "memsphere-20261118-stable", names: ["cli-retry"], defines: ["Retry records"], goals: [], mode: "graph",
    actions: [{
      tag: "!action", id: "write", description: "Save", dependencies: [{ tag: "!dependency", from: "START" }],
      artifact: {
        name: "Record", model: { definedBy: "json-schema/draft-07.json", definition: '{"type":"object"}' },
        payload: { contentType: "application/json" }, store: { store_id: "records", operation: "create" }
      }
    }]
  }));
  const { store } = await openBusinessStore({}, f.root, "records");
  assert.equal(store.kind, "DataStore");
  const dataId = "retry.json";
  const previous = '{"name":"existing"}';
  await store.create({}, { id: dataId, model: "cli-record.json", payload: { contentType: "application/json", content: bytesContent(Buffer.from(previous)) } });
  const { runId } = await f.call("run", "start", "--file", f.procedure, "--name", "Retry");
  const { steps: [step] } = await f.call("run", "show", "--run", runId);
  const body = '{ "name": "candidate" }\n';
  await assert.rejects(f.call("continue", "report", "--artifact", body, "--write-options", '{"data_id":"retry.json"}'), /ALREADY_EXISTS/);
  const failed = await f.inspect(runId);
  assert.equal(failed.steps[0].businessReceipt, undefined);
  assert.equal((await requireCommandState("codex-graph-session", f.home)).value.status, "active");
  const { openContextControl } = await import("../src/project/context-control.js");
  const { graphPermissionConfig } = await import("../src/context_control/graph-review.js");
  const service = (await openContextControl(f.root))!;
  const restricted = graphPermissionConfig({ runner: { permissions: ["artifact.read", "decision.decide"] }, actors: {}, acpProviders: {} }, "en");
  // Construct the persisted permission fixture around an actual failed candidate.
  // Production freezes permissions, so it cannot naturally fail a report from this Runner.
  const setPermissions = (permissionConfig?: import("../src/context_control/types.js").Run["permissionConfig"]) => service.withGraph(async g => {
    const row = await g.records.require<import("../src/context_control/types.js").Run>("run", runId, runId);
    const run = { ...row.value, permissionConfig };
    if (!permissionConfig) delete run.permissionConfig;
    await g.records.update("run", runId, row, run);
  });
  await setPermissions(restricted);
  await assert.rejects(f.call("run", "step", "store", "retry", "--run", runId, "--step", step.id), /PERMISSION_DENIED/);
  const rejected = await f.inspect(runId);
  assert.deepEqual(rejected.steps, failed.steps);
  assert.deepEqual(rejected.artifacts, failed.artifacts);
  assert.deepEqual((await store.list({}, {})).items.map(item => item.id), [dataId]);
  await setPermissions();
  const other = await f.call("run", "start", "--file", f.procedure, "--name", "Other session target");
  await assert.rejects(f.call("run", "step", "store", "retry", "--run", runId, "--step", step.id), /SESSION_CONTEXT_CONFLICT/);
  const existing = await store.get({}, dataId);
  assert(existing && !existing.deleted);
  assert.equal(Buffer.from(await readAll({}, existing.data.payload.content)).toString(), previous);
  assert.deepEqual((await f.inspect(runId)).steps, failed.steps);
  const otherStep = (await f.call("run", "show", "--run", other.runId)).steps[0].id;
  await assert.rejects(f.call("run", "step", "store", "retry", "--run", other.runId, "--step", otherStep), /INVALID_STATE|NOT_FOUND/);
  await f.invoke("run", "step", "enter", "--run", runId, "--step", step.id);
  assert.equal(await store.delete({}, dataId), true);
  const result = await f.call("run", "step", "store", "retry", "--run", runId, "--step", step.id);
  assert.equal(result.status, "done");
  assert.equal(result.artifactId, failed.artifacts[0].id);
  assert.equal((await requireCommandState("codex-graph-session", f.home)).value.status, "closed");
  const saved = await store.get({}, dataId);
  assert(saved && !saved.deleted);
  assert.equal(Buffer.from(await readAll({}, saved.data.payload.content)).toString(), body);
  await assert.rejects(f.call("run", "step", "store", "retry", "--run", runId, "--step", step.id), /INVALID_STATE|NOT_FOUND/);
});

test("Graph report and Continue accept nested file Store IDs and reject traversal", { timeout: 90000 }, async t => {
  const f = await fixture(t, false, true, true);
  const { mutateModel } = await import("../src/project/model-service.js");
  const { openBusinessStore } = await import("../src/project/business-stores.js");
  const { readAll } = await import("../src/data/extensions/shared/payload.js");
  await mutateModel({}, f.root, "create", "cli-record.json", { source: '{"type":"object"}' });
  await f.createStore("records", "cli-record.json", "data");
  await writeFile(f.procedure, serializeMemoryYaml({
    tag: "!procedure", syntax: "memsphere-20261118-stable", names: ["cli-files"], defines: ["Save files"], goals: [], mode: "graph",
    actions: [{
      tag: "!action", id: "write", description: "Save", dependencies: [{ tag: "!dependency", from: "START" }],
      artifact: {
        name: "Record", model: { definedBy: "json-schema/draft-07.json", definition: '{"type":"object"}' },
        payload: { contentType: "application/json" }, store: { store_id: "records", operation: "create" }
      }
    }]
  }));
  const { store } = await openBusinessStore({}, f.root, "records");
  assert.equal(store.kind, "DataStore");
  for (const entry of ["native", "continue"] as const) {
    const { runId } = await f.call("run", "start", "--file", f.procedure, "--name", entry);
    const before = await f.inspect(runId);
    const stepId = before.steps[0].id;
    const args = entry === "native" ? ["run", "report", "--run", runId, "--step", stepId] : ["continue", "report"];
    const body = '{ "name": "report" }\n';
    const report = (data_id: string) => f.call(...args, "--artifact", body, "--write-options", JSON.stringify({ data_id }));
    const existing = (await store.list({}, {})).items;
    await assert.rejects(report("reports/../../escape.json"), /INVALID_ARGUMENT/);
    const rejected = await f.inspect(runId);
    assert.deepEqual(rejected.artifacts, []);
    assert.deepEqual(rejected.steps, before.steps);
    assert.deepEqual((await store.list({}, {})).items, existing);
    const dataId = `reports/${entry}.json`;
    const done = await report(dataId);
    const after = await f.inspect(runId);
    assert.equal(after.steps[0].businessReceipt.artifactId, done.artifactId);
    assert.equal(after.artifacts[0].business.destination.dataId, dataId);
    const row = await store.get({}, dataId);
    assert(row && !row.deleted);
    assert.equal(row.data.payload.contentType, "application/json");
    assert.equal(Buffer.from(await readAll({}, row.data.payload.content)).toString(), body);
  }
});
