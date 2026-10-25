import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { businessFixture } from "./helpers/business-data.js";
import { openContextControl } from "../src/project/context-control.js";
import { textContent } from "../src/context_control/types.js";
import { createHash } from "node:crypto";
import { withNativeFileLock } from "../src/file-lock.js";
const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

test("exploration CLI persists create/read/report, comments, revisions and delivery in model Stores", { timeout: 60000 }, async t => {
  const f = await businessFixture(t, {});
  const call = async (...args: string[]) => {
    const r = await exec(process.execPath, [cli, "--project", "test-project", "run", ...args, "--output", "json"], { cwd: f.cwd, env: { ...process.env, MEMSPHERE_HOME: f.home } });
    assert.equal(r.stderr, ""); assert.ok(r.stdout.trim(), `CLI returned no output: ${args.join(" ")}, fixture=${f.root}`); return JSON.parse(r.stdout);
  };
  const run = await call("start", "--name", "CLI探索"); const r = ["--run", run.id];
  const a = await call("report", ...r, "--name", "要求", "--artifact", "离线查询", "--tag", "requirements");
  const target = await call("artifact", "create", ...r, "--name", "方案", "--tag", "design");
  const out = join(f.directory, "input.md");
  await call("artifact", "show", ...r, "--artifact", a.artifactId, "--for", target.artifactId, "--out", out);
  assert.equal(await readFile(out, "utf8"), "离线查询");
  const b = await call("report", ...r, "--target", target.artifactId, "--artifact", "快照", "--depends-on", "tag:requirements");
  assert.equal(b.artifactId, target.artifactId);
  const review = await call("review", "create", ...r, "--artifact", b.artifactId, "--reviewer", "human", "--comment", "恢复路径", "--comment", "补充测试");
  assert.equal(review.comments.length, 2);
  const revised = await call("report", ...r, "--revised-from", b.artifactId, "--artifact", "完整快照");
  const snapshot = await call("show", ...r);
  assert.equal(snapshot.steps.length, 3); assert.equal(snapshot.artifacts.length, 3);
  assert.equal(snapshot.steps.find((s: any) => s.id === b.stepId).reads[`artifact:${a.artifactId}`] !== undefined, true);
  assert.equal((await call("status")).runs.some((v: any) => v.id === run.id), true);
  await call("finish", ...r, "--artifact", revised.artifactId);
  assert.equal((await call("status", ...r)).run.status, "done");
  const record = JSON.parse(await readFile(join(f.root, "data/context_control/artifacts", run.id, `${b.artifactId}.json`), "utf8"));
  assert.equal(record.id, `${run.id}/${b.artifactId}`); assert.equal(record.value.id, b.artifactId);
});

test("exploration CLI rejects caller system fields and preserves exclusive output files", { timeout: 30000 }, async t => {
  const f = await businessFixture(t, {});
  const invoke = (...args: string[]) => exec(process.execPath, [cli, "--project", "test-project", "run", ...args, "--output", "json"], { cwd: f.cwd, env: { ...process.env, MEMSPHERE_HOME: f.home } });
  const run = JSON.parse((await invoke("start", "--name", "边界")).stdout);
  const input = join(f.directory, "invalid.json"); await writeFile(input, JSON.stringify({ id: "caller-id", content: {} }));
  await assert.rejects(invoke("report", "--run", run.id, "--file", input), (error: any) => JSON.parse(error.stderr).error.code === "INVALID_ARGUMENT");
  const a = JSON.parse((await invoke("report", "--run", run.id, "--name", "内容", "--artifact", "正文")).stdout);
  const output = join(f.directory, "retained.txt"); await writeFile(output, "原文");
  await assert.rejects(invoke("artifact", "show", "--run", run.id, "--artifact", a.artifactId, "--out", output), (error: any) => JSON.parse(error.stderr).error.code === "ALREADY_EXISTS");
  assert.equal(await readFile(output, "utf8"), "原文");
});

for (const kind of ["artifact", "external"] as const) {
  test(`${kind} reads export exclusively and preserve output when accounting targets are invalid`, { timeout: 60000 }, async t => {
    const f = await businessFixture(t, {}); const s = (await openContextControl(f.root, true))!;
    const run = await s.start("读取矩阵"); const other = await s.start("其他Run");
    const source = kind === "artifact" ? (await s.report(run.id, { name: "来源", content: textContent("原始正文") })).artifact : await s.addExternal(run.id, "用户输入", { content: textContent("原始正文") });
    const invoke = (...args: string[]) => exec(process.execPath, [cli, "--project", "test-project", "run", kind, "show", "--run", run.id, `--${kind}`, source.id, ...args], { cwd: f.cwd, env: { ...process.env, MEMSPHERE_HOME: f.home } });
    for (const fileOutput of [false, true]) {
      const target = await s.createArtifact(run.id, { name: "生产目标" }); const out = join(f.directory, `${kind}-success-${fileOutput}.txt`);
      const response = await invoke("--for", target.id, ...(fileOutput ? ["--out", out] : []));
      assert.equal(response.stderr, ""); assert.equal(fileOutput ? await readFile(out, "utf8") : response.stdout, "原始正文");
      assert.ok((await s.snapshot(run.id)).steps.find(step => step.id === target.stepId)!.reads?.[`${kind}:${source.id}`]);
    }
    const crossRun = await s.createArtifact(other.id, { name: "跨Run目标" });
    const completed = (await s.report(run.id, { name: "已完成", content: textContent("完成") })).artifact;
    for (const target of ["missing", crossRun.id, completed.id]) for (const fileOutput of [false, true]) {
      const out = join(f.directory, `${kind}-${target}-${fileOutput}.txt`);
      const response = await invoke("--for", target, ...(fileOutput ? ["--out", out] : []));
      assert.match(response.stderr, /accounting skipped/);
      assert.equal(fileOutput ? await readFile(out, "utf8") : response.stdout, "原始正文");
    }
    assert.equal((await s.snapshot(other.id)).steps[0].reads, undefined);
    const target = await s.createArtifact(run.id, { name: "输出失败不记账" });
    const retained = join(f.directory, `${kind}-retained.txt`); await writeFile(retained, "保留原文");
    await assert.rejects(invoke("--for", target.id, "--out", retained));
    assert.equal(await readFile(retained, "utf8"), "保留原文");
    await assert.rejects(invoke("--for", target.id, "--out", join(f.directory, "missing-parent", "out.txt")));
    assert.equal((await s.snapshot(run.id)).steps.find(step => step.id === target.stepId)!.reads, undefined);
    const lock = join(f.root, ".runtime", "context-control", `${createHash("sha256").update(run.id).digest("hex")}.lock`);
    for (const fileOutput of [false, true]) {
      const out = join(f.directory, `${kind}-timeout-${fileOutput}.txt`);
      const response = await withNativeFileLock(lock, () => invoke("--for", target.id, ...(fileOutput ? ["--out", out] : [])));
      assert.match(response.stderr, /accounting skipped/);
      assert.equal(fileOutput ? await readFile(out, "utf8") : response.stdout, "原始正文");
    }
    assert.equal((await s.snapshot(run.id)).steps.find(step => step.id === target.stepId)!.reads, undefined);
  });
}
