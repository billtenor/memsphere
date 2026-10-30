import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { businessFixture } from "./helpers/business-data.js";
import { serializeMemoryYaml } from "../src/memory/serializer.js";
import type { GraphProcedureMemory } from "../src/memory/ast.js";
import { graphNext } from "../src/commands/procedure-graph.js";
import type { GraphRuntime } from "../src/context_control/graph-runtime.js";
import type { Snapshot } from "../src/context_control/types.js";
const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

test("graph continuation returns a status command if its auto-enter target completed concurrently", async () => {
  const snapshot = { run: { id: "run-current", status: "running", language: "zh-CN" } } as Snapshot;
  const runtime = { ready: () => [{ id: "step-next" }], enter: async () => {
    throw Object.assign(new Error("Step is done"), { code: "STEP_FINISHED" });
  } } as unknown as GraphRuntime;
  const prompt = await graphNext(runtime, snapshot, "test-project");
  assert.match(prompt, /下一 Step 已由其他进程完成/);
  assert.match(prompt, /memsphere --project 'test-project' run status --run run-current/);
});

test("graph continuation preserves an unrelated auto-enter failure", async () => {
  const snapshot = { run: { id: "run-current", status: "running", language: "en" } } as Snapshot;
  const failure = Object.assign(new Error("CAS conflict"), { code: "REVISION_CONFLICT" });
  const runtime = { ready: () => [{ id: "step-next" }], enter: async () => { throw failure; } } as unknown as GraphRuntime;
  await assert.rejects(graphNext(runtime, snapshot, "test-project"), error => error === failure);
});

async function fixture(t: test.TestContext, multiple = false) {
  const f = await businessFixture(t, {});
  await writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: { codex: { identity_enabled: true, async_enabled: false } } }));
  await exec("git", ["init", "-b", "master"], { cwd: f.root });
  await writeFile(join(f.root, "config.json"), JSON.stringify({ store: { type: "embedded", repository_path: f.root, memory_path: "memory" } }));
  const procedure = join(f.directory, "graph.yaml");
  const action = (id: string) => `  - !action\n    id: ${id}\n    description: Produce ${id}\n    dependencies: [!dependency {from: START}]\n    artifact:\n      name: ${id} output\n      model: {definedBy: raw.json, definition: '{}'}\n      payload: {contentType: text/plain}\n`;
  await writeFile(procedure, `!procedure\nsyntax: memsphere-20261027-stable\nnames: [cli-graph]\ndefines: [CLI graph]\nmode: graph\nactions:\n${action("A")}${multiple ? action("B") : ""}`);
  const invoke = (...args: string[]) => exec(process.execPath, [cli, "--project", "test-project", ...args], { cwd: f.root, env: { ...process.env, MEMSPHERE_HOME: f.home, XDG_RUNTIME_DIR: f.directory, CODEX_THREAD_ID: "graph-session", TRAECLI_THREAD_ID: "" } }).catch(error => { throw new Error(`${error.message}\nstdout: ${error.stdout}\nstderr: ${error.stderr}`); });
  const call = async (...args: string[]) => JSON.parse((await invoke(...args, "--output", "json")).stdout);
  return { ...f, procedure, invoke, call };
}

for (const language of ["zh-CN", "en"] as const) test(`graph ${language} Step prompts provide executable fixed-material reads for direct and collected inputs`, { timeout: 90000 }, async t => {
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
  const read = (id: string) => `memsphere --project 'test-project' run artifact show --run '${start.runId}' --artifact '${id}'`;
  assert.ok(first.prompt.includes(read(first.artifactId)), first.prompt);
  assert.match(first.prompt, language === "en" ? /read commands/ : /读取命令/);
  const second = await f.call("continue", "report", "--artifact", "again");
  const third = await f.call("continue", "report", "--artifact", "seed second body");
  const last = await f.call("continue", "report", "--artifact", "stop");
  const final = (await f.call("run", "show", "--run", start.runId)).steps.find((s: any) => s.source?.actionId === "final");
  assert.deepEqual(final.inputs, { seed: [{ kind: "artifact", id: first.artifactId }, { kind: "artifact", id: third.artifactId }], b: [{ kind: "artifact", id: second.artifactId }, { kind: "artifact", id: last.artifactId }] });
  for (const [id, text] of [[first.artifactId, "seed body"], [second.artifactId, "again"], [third.artifactId, "seed second body"], [last.artifactId, "stop"]]) {
    assert.ok(last.prompt.includes(read(id)), last.prompt);
    // Execute the exact printed argument vector using the fixture's CLI entrypoint.
    const args = read(id).slice("memsphere ".length).match(/'[^']*'|\S+/g)!.map(s => s.replace(/^'|'$/g, ""));
    const result = await f.invoke(...args); assert.match(result.stdout, new RegExp(text));
  }
});

test("graph CLI auto-enters one Step, binds Continue and leaves show read-only", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  const start = await f.call("run", "start", "--file", f.procedure, "--name", "CLI graph");
  assert.doesNotMatch(start.prompt, /context-/);
  const snapshot = await f.call("run", "show", "--run", start.runId);
  const step = snapshot.steps[0]; assert.equal(step.status, "running");
  const before = await readFile(join(f.root, "data/context_control/steps", start.runId, `${step.id}.json`), "utf8");
  await f.call("run", "step", "show", "--run", start.runId, "--step", step.id);
  assert.equal(await readFile(join(f.root, "data/context_control/steps", start.runId, `${step.id}.json`), "utf8"), before);
  const help = await f.invoke("continue", "--help"); assert.match(help.stdout, new RegExp(step.id));
  const result = await f.call("continue", "report", "--artifact", "done");
  assert.equal(result.stepId, step.id); assert.equal(result.status, "done");
  assert.match(result.prompt, /finish/);
  await assert.rejects(f.invoke("continue", "report", "--artifact", "duplicate"), /No transitions/);
  await f.call("run", "finish", "--run", start.runId);
});

test("multiple pending Steps require explicit enter; repeated enter returns the same Continue binding", { timeout: 60000 }, async t => {
  const f = await fixture(t, true);
  const start = await f.call("run", "start", "--file", f.procedure, "--name", "Choose");
  assert.match(start.prompt, /step enter/); assert.doesNotMatch(start.prompt, /Action/);
  const snapshot = await f.call("run", "show", "--run", start.runId);
  assert.deepEqual(snapshot.steps.map((s: any) => s.status), ["pending", "pending"]);
  const id = snapshot.steps[0].id;
  const first = await f.invoke("run", "step", "enter", "--run", start.runId, "--step", id);
  const second = await f.invoke("run", "step", "enter", "--run", start.runId, "--step", id);
  assert.equal(first.stdout, second.stdout);
  await assert.rejects(f.call("run", "report", "--run", start.runId, "--artifact", "missing step"), /--step is required/);
  await assert.rejects(f.call("run", "finish", "--run", start.runId), /unfinished work/);
});

test("independent CLI processes enter idempotently and complete different Steps with unique completion sequence", { timeout: 60000 }, async t => {
  const f = await fixture(t, true);
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
    assert.equal(error.details.recoveryCommand, `memsphere run status --run ${start.runId}`);
  }
  // A saved submission remains durable even when concurrent automatic recovery conflicts.
  await f.call("run", "status", "--run", start.runId);
  const result = await f.call("run", "show", "--run", start.runId);
  assert.equal(result.steps.length, 2); assert.equal(result.artifacts.length, 2);
  assert.deepEqual(result.steps.map((s: any) => s.status), ["done", "done"]);
  assert.equal(new Set(result.steps.map((s: any) => s.completionSequence)).size, 2);
  assert.equal(result.run.frames[0].graphFrame.processedStepIds.length, 2);
});

test("Continue binds Human authorization and advisory resolution to its Step and closes after Runner acceptance", { timeout: 120000 }, async t => {
  const f = await fixture(t);
  const config = JSON.parse(await readFile(join(f.root, "config.json"), "utf8"));
  config.control_plane = { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { reviewer: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] }, advisor: { kind: "human", name: "Advisor", permissions: ["artifact.read", "decision.assess"] } } };
  await writeFile(join(f.root, "config.json"), JSON.stringify(config));
  await writeFile(f.procedure, (await readFile(f.procedure, "utf8")).replace("      payload:", "      review: [approval]\n      payload:"));
  const binding = join(f.directory, "review.json");
  await writeFile(binding, JSON.stringify({ reviews: { "cli-graph#actions[A]": { policy: "artifact_acceptance.unanimous" } }, slots: { "cli-graph::approval": { actors: ["reviewer", "advisor"] } } }));
  const start = await f.call("run", "start", "--file", f.procedure, "--review-config", binding, "--name", "review context");
  assert.doesNotMatch(start.prompt, /context-/);
  const report = await f.call("continue", "report", "--artifact", "candidate");
  assert.equal(report.status, "awaiting_review"); assert.match(report.prompt, /memsphere continue review wait/);
  const snapshot = await f.call("run", "show", "--run", start.runId), step = snapshot.steps[0], round = step.reviewRounds[0];
  const comments = join(f.directory, "comments.json"); await writeFile(comments, "[]");
  const handle = `graph-review-${start.runId}__${step.id}`;
  const vote = ["review", "submit-for-human", "--assignment", "reviewer", "--vote", "approve", "--comments-file", comments];
  await assert.rejects(f.call("continue", ...vote), /authorization-note/);
  await assert.rejects(f.call("continue", ...vote, "--authorization-note", ""), /authorization/);
  await assert.rejects(f.call("continue", ...vote, "--round", "other-round", "--authorization-note", "fixture authorization"), /unknown option/);
  await assert.rejects(f.call("continue", ...vote, "--run", "other-run", "--authorization-note", "fixture authorization"), /unknown option/);
  await f.call("continue", ...vote, "--authorization-note", "Simulated authorized vote in an isolated test fixture");
  const note = join(f.directory, "advice.json"); await writeFile(note, JSON.stringify([{ body: "Clarify purpose", severity: "blocking" }]));
  await f.call("continue", "review", "submit-for-human", "--assignment", "advisor", "--vote", "approve", "--comments-file", note, "--authorization-note", "Isolated fixture advisor authorization");
  const reviewed = await f.call("run", "show", "--run", start.runId);
  const personal = reviewed.reviews.find((r: any) => r.reviewer.actorId === "advisor");
  assert.equal(personal.roundId, round.id); assert.match(personal.vote.delegationNote, /fixture advisor authorization/);
  const commentId = personal.comments[0].id;
  const resolve = ["review", "resolve", "--comment", commentId, "--disposition", "accepted-fixed", "--note", "Clarified in candidate"];
  await assert.rejects(f.call("continue", ...resolve), /validation/);
  const runPath = join(f.root, "data/context_control/runs", `${start.runId}.json`);
  const saved = await readFile(runPath, "utf8"), restricted = JSON.parse(saved);
  restricted.value.permissionConfig.runner.permissions = ["artifact.read", "artifact.submit"];
  await writeFile(runPath, JSON.stringify(restricted));
  await assert.rejects(f.call("continue", ...resolve, "--validation-summary", "Checked candidate"), /decision.decide/);
  await writeFile(runPath, saved);
  await f.call("continue", ...resolve, "--validation-summary", "Checked candidate");
  const resolved = await f.call("run", "show", "--run", start.runId);
  assert.equal(resolved.steps[0].reviewRounds[0].resolutions[0].commentId, commentId);
  assert.equal(resolved.steps[0].reviewRounds[0].id, round.id);
  assert.equal(resolved.steps[0].id, step.id);
  const wait = await f.invoke("continue", "review", "wait"); assert.match(wait.stdout, /approve/);
  const accepted = await f.invoke("continue", "review", "vote", "--vote", "approve"); assert.match(accepted.stdout, /finish/);
  assert.equal((await f.call("run", "show", "--run", start.runId)).steps[0].id, step.id);
  assert.match((await f.invoke("continue", "--help")).stdout, /No further transitions/);
});


test("a failed auxiliary Continue store preserves the running Step and offers a native report command", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  await mkdir(join(f.home, "data"), { recursive: true });
  const invalid = join(f.home, "data", "runner-sessions"); await writeFile(invalid, "not a directory");
  const start = await f.call("run", "start", "--file", f.procedure, "--name", "context recovery");
  assert.match(start.prompt, new RegExp(`run report --run ${start.runId} --step`));
  const before = await f.call("run", "show", "--run", start.runId); assert.equal(before.steps.length, 1); assert.equal(before.steps[0].status, "running");
  await rm(invalid);
  const recovered = await f.invoke("run", "step", "enter", "--run", start.runId, "--step", before.steps[0].id);
  assert.match(recovered.stdout, /memsphere continue report/);
});
