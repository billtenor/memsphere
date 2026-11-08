import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ownTestProcess } from "../../helpers/owned-process.js";

for (const mode of ["abort", "fixture-cleanup"] as const) {
  test(`owned CLI process exits before fixture deletion on ${mode}`, { timeout: 15_000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), "memsphere-owned-process-"));
    const controller = new AbortController();
    const cleanups: Array<() => Promise<void>> = [];
    t.after(async () => {
      controller.abort();
      for (const cleanup of cleanups) await cleanup();
      await rm(directory, { recursive: true, force: true });
    });
    const child = spawn(process.execPath, ["-e", "process.send('ready'); setInterval(() => {}, 1000)"], {
      cwd: directory, stdio: ["ignore", "pipe", "pipe", "ipc"]
    });
    const ready = once(child, "message");
    const exit = once(child, "exit");
    ownTestProcess(child, controller.signal, cleanup => cleanups.push(cleanup));
    assert.deepEqual(await ready, ["ready", undefined]);
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, null);
    if (mode === "abort") controller.abort();
    else for (const cleanup of cleanups) await cleanup();
    await exit;
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    // Cancellation reclaims the process, not its fixture. The owner can now
    // remove the working directory without racing a live Windows process.
    assert.ok((await stat(directory)).isDirectory());
    await rm(directory, { recursive: true });
    await assert.rejects(stat(directory), { code: "ENOENT" });
  });
}
