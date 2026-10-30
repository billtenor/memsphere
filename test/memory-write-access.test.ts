import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { withMemoryWriteAccess } from "../src/memory/write-access.js";
import { runGit } from "../src/git.js";

test("Publication admission follows the physical worktree across directories/processes and recovers after process death", { timeout: 30_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "memsphere-memory-write-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const main = join(directory, "main"), linked = join(directory, "linked");
  const firstMemory = join(main, "first"), secondMemory = join(main, "second");
  await mkdir(firstMemory, { recursive: true }); await mkdir(secondMemory);
  await writeFile(join(main, "baseline"), "baseline");
  await runGit(["init", "-b", "master"], { cwd: main });
  await runGit(["add", "."], { cwd: main });
  await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline"], { cwd: main });
  await runGit(["worktree", "add", "--detach", linked, "HEAD"], { cwd: main });
  const alias = join(directory, "alias");
  await symlink(main, alias, process.platform === "win32" ? "junction" : "dir");
  const child = fork(new URL("./fixtures/memory-write-worker.ts", import.meta.url), [firstMemory], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  let exited = false;
  const ended = once(child, "exit").then(() => { exited = true; });
  t.after(async () => { if (!exited) child.kill("SIGKILL"); await ended; });
  const [ready] = await once(child, "message"); assert.equal(ready.type, "ready");
  const claimed = once(child, "message"); child.send("start");
  assert.equal((await claimed)[0].type, "claimed");
  for (const root of [firstMemory, secondMemory, join(alias, "first")])
    await assert.rejects(withMemoryWriteAccess(root, async () => assert.fail("Overlapping publication ran")), { code: "MEMORY_PUBLISH_BUSY" });
  // Another worktree has its own index, even though both share the Git repository.
  await withMemoryWriteAccess(linked, async () => {});
  child.kill("SIGKILL"); await ended;
  await withMemoryWriteAccess(firstMemory, async () => {});
});
