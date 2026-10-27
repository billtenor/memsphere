import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { businessFixture } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";
import { findCommandStates } from "../src/home/command-state-store.js";
import { textContent } from "../src/context_control/types.js";
const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
async function fixture(t: test.TestContext) {
  const f = await businessFixture(t, {});
  const invoke = (...args: string[]) => exec(process.execPath, [cli, "--project", "test-project", ...args], { cwd: f.cwd, env: { ...process.env, MEMSPHERE_HOME: f.home } });
  const call = async (...args: string[]) => JSON.parse((await invoke(...args, "--output", "json")).stdout);
  return { ...f, invoke, call };
}

test("native CLI finishes current outputs and lists/restores archived exploration records", { timeout: 60000 }, async t => {
  const f = await fixture(t), run = await f.call("run", "start", "--name", "结束归档");
  await assert.rejects(f.invoke("archive", "run", run.id), /Finish or abandon/);
  const a = await f.call("run", "report", "--run", run.id, "--name", "A", "--artifact", "A");
  await f.call("run", "finish", "--run", run.id, "--authorization", "用户检查 A 后明确确认结束");
  const snapshot = await f.call("run", "status", "--run", run.id);
  assert.equal(snapshot.run.status, "done"); assert.deepEqual(snapshot.outputArtifactIds, [a.artifactId]);
  assert.equal(snapshot.commandStates[0].status, "closed");
  await f.invoke("archive", "run", run.id);
  assert.equal((await f.call("run", "status")).runs.some((r: any) => r.id === run.id), false);
  assert.ok((await f.call("archive", "list", "runs")).items.some((r: any) => r.id === run.id));
  await f.invoke("archive", "restore", "run", run.id);
  assert.equal((await f.call("run", "status", "--run", run.id)).run.status, "done");
  assert.ok((await f.call("run", "status")).runs.some((r: any) => r.id === run.id));
});

test("direct production, Continue, independent reads, repeated comments and immutable revision", { timeout: 60000 }, async t => {
  const f = await fixture(t); const run = await f.call("run", "start", "--name", "CLI探索");
  assert.match(run.contextId, /^context-/);
  const help = await f.invoke("continue", run.contextId, "--help"); assert.match(help.stdout, /report.*review create/);
  await assert.rejects(f.invoke("continue", "missing", "--help"), /not found/);
  const a = await f.call("continue", run.contextId, "report", "--name", "要求", "--artifact", "离线查询", "--tag", "requirements");
  const out = join(f.directory, "input.md");
  await f.call("run", "artifact", "show", "--run", run.id, "--artifact", a.artifactId, "--out", out);
  assert.equal(await readFile(out, "utf8"), "离线查询");
  const b = await f.call("continue", run.contextId, "report", "--name", "方案", "--artifact", "快照", "--depends-on", "tag:requirements");
  assert.deepEqual(b.candidates, []);
  const review = await f.call("continue", run.contextId, "review", "create", "--artifact", b.artifactId, "--reviewer", "human", "--comment", "恢复路径", "--comment", "补充测试");
  assert.equal(review.comments.length, 2);
  const revised = await f.call("continue", run.contextId, "report", "--revised-from", b.artifactId, "--artifact", "完整快照");
  const snapshot = await f.call("run", "show", "--run", run.id);
  assert.equal(snapshot.steps.length, 3); assert.equal(snapshot.artifacts.length, 3);
  assert.ok(snapshot.steps.find((s: any) => s.id === b.stepId).reads[`artifact:${a.artifactId}`]);
  assert.deepEqual(snapshot.outputArtifactIds, [revised.artifactId]);
  assert.equal(snapshot.commandStates[0].contextId, run.contextId);
  assert.ok((await f.call("run", "status")).runs.some((r: any) => r.id === run.id));
  await f.call("continue", run.contextId, "finish", "--artifact", revised.artifactId, "--authorization", "用户明确确认修订版并同意结束");
  assert.match((await f.invoke("continue", run.contextId, "--help")).stdout, /No further transitions/);
  await assert.rejects(f.call("continue", run.contextId, "report", "--name", "late", "--artifact", "no"), /No transitions/);
  const record = JSON.parse(await readFile(join(f.root, "data/context_control/artifacts", run.id, `${b.artifactId}.json`), "utf8"));
  assert.equal(record.id, `${run.id}/${b.artifactId}`); assert.equal(record.value.content.payload.content, "快照");
});

for (const entry of ["native", "continue"] as const) {
  test(`${entry} finish requires authorization and preserves feedback/revision until confirmed`, { timeout: 60000 }, async t => {
    const f = await fixture(t), run = await f.call("run", "start", "--name", "等待确认");
    const service = (await openContextControl(f.root))!;
    const original = (await service.report(run.id, { name: "初版", content: textContent("初版结论") })).artifact;
    const finish = entry === "native" ? ["run", "finish", "--run", run.id] : ["continue", run.contextId, "finish"];
    const before = await service.snapshot(run.id);
    const assertOpen = async () => {
      assert.deepEqual(await service.snapshot(run.id), before);
      const contexts = await findCommandStates("test-project", run.id, f.home);
      assert.equal(contexts.length, 1); assert.equal(contexts[0].value.status, "active");
    };
    const help = (await f.invoke(...finish, "--help")).stdout;
    assert.match(help, /--authorization <text>/);
    assert.doesNotMatch(help, /--authorization-note/);
    for (const options of [[], ["--authorization", " \t\n "]]) {
      await assert.rejects(f.call(...finish, ...options), (error: any) => {
        const result = JSON.parse(error.stderr);
        assert.equal(result.error.code, "HUMAN_CONFIRMATION_REQUIRED");
        assert.match(result.error.message, /--authorization/);
        return true;
      });
      await assertOpen();
    }
    for (const option of ["--authorization-note", "--authorization-note-file"]) {
      await assert.rejects(f.call(...finish, "--authorization", "确认", option, "unused"));
      await assertOpen();
    }
    await f.call("continue", run.contextId, "review", "create", "--artifact", original.id, "--reviewer", "human", "--comment", "补充结论边界");
    const revised = await f.call("continue", run.contextId, "report", "--revised-from", original.id, "--artifact", "修订结论及边界");
    await f.call(...finish, "--artifact", revised.artifactId, "--authorization", "用户确认修订版并明确同意结束");
    const ended = await service.snapshot(run.id);
    assert.equal(ended.run.status, "done"); assert.deepEqual(ended.outputArtifactIds, [revised.artifactId]);
    assert.equal(ended.reviews[0].comments[0].body, "补充结论边界");
    assert.equal(ended.artifacts.find(a => a.id === revised.artifactId)!.revisedFrom, original.id);
    assert.equal((await findCommandStates("test-project", run.id, f.home))[0].value.status, "closed");
  });
}

for (const kind of ["artifact", "external"]) for (const length of [199, 200, 201]) {
  test(`${kind} previews ${length} Unicode chars and exports original bytes`, { timeout: 30000 }, async t => {
    const f = await fixture(t); const run = await f.call("run", "start", "--name", "preview");
    const content = "中a😀".repeat(67).slice(0); const value = Array.from(content).slice(0, length).join("");
    const saved = kind === "artifact" ? await f.call("run", "report", "--run", run.id, "--name", "正文", "--artifact", value) : await f.call("run", "external", "add", "--run", run.id, "--source", "来源", "--content", value);
    const id = saved.artifactId ?? saved.externalId;
    if (kind === "external") assert.deepEqual(Object.keys(saved).sort(), ["externalId", "runId"]);
    const args = ["run", kind, "show", "--run", run.id, `--${kind}`, id];
    const result = await f.call(...args);
    assert.equal(result.content, Array.from(value).slice(0, 200).join("") + (length > 200 ? "..." : ""));
    assert.equal(result.truncated, length > 200);
    assert.equal(!!result.exportCommand, length > 200);
    const text = await f.invoke(...args); assert.equal(text.stdout, result.content);
    assert.equal(text.stderr.includes("Export full content"), length > 200);
    const out = join(f.directory, "original.txt"); await f.call(...args, "--out", out);
    assert.equal(await readFile(out, "utf8"), value);
    await assert.rejects(f.call(...args, "--out", out), (error: any) => JSON.parse(error.stderr).error.code === "ALREADY_EXISTS");
  });
}

test("derived outputs retain manual removals and removed production-boundary flags are rejected", { timeout: 30000 }, async t => {
  const f = await fixture(t); const r = await f.call("run", "start", "--name", "outputs");
  const a = await f.call("continue", r.contextId, "report", "--name", "A", "--artifact", "A");
  await f.call("continue", r.contextId, "outputs", "update", "--remove", a.artifactId);
  const b = await f.call("continue", r.contextId, "report", "--name", "B", "--artifact", "B");
  const outputs = await f.call("run", "outputs", "list", "--run", r.id); assert.deepEqual(outputs.items.map((a: any) => a.id), [b.artifactId]);
  await f.call("continue", r.contextId, "outputs", "update", "--remove", b.artifactId, "--add", a.artifactId);
  await assert.rejects(f.call("continue", r.contextId, "outputs", "update", "--remove", a.artifactId, "--add", a.artifactId));
  await assert.rejects(f.call("run", "artifact", "create", "--run", r.id, "--name", "no"));
  await assert.rejects(f.call("run", "artifact", "show", "--run", r.id, "--artifact", a.artifactId, "--for", b.artifactId));
  await assert.rejects(f.call("run", "report", "--run", r.id, "--target", a.artifactId, "--artifact", "no"));
  const invalid = join(f.directory, "invalid.json"); await writeFile(invalid, JSON.stringify({ id: "caller", content: {} }));
  await assert.rejects(f.call("run", "report", "--run", r.id, "--file", invalid));
});
