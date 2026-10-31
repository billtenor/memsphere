import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import type { BrowserServer } from "playwright";
import { processTable, terminateTestProcesses } from "../../scripts/ci/test-processes.mjs";

// BrowserServer.process() supplies the real browser PID through the controlled
// fixture handshake. No sleep or guessed output interval establishes readiness.
type Ready = { worker: number; wrapper: number; browser: NonNullable<ReturnType<BrowserServer["process"]>["pid"]>; stubborn?: number; home: string };
for (const signal of [undefined, "SIGINT", "SIGTERM"] as const) {
  test(`test runner ${signal ? `cancellation (${signal}) reclaims tests and browsers` : "normal completion closes its processes"}`, { timeout: 60000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), "memsphere-runner-lifecycle-"));
    const events: string[] = [], ready: Ready[] = [];
    const barriers: Array<import("node:http").ServerResponse> = [];
    let notify = () => {};
    const count = signal === "SIGTERM" ? 2 : 1;
    const server = createServer(async (request, response) => {
      let body = ""; for await (const data of request) body += data;
      events.push(request.url!);
      if (request.url === "/ready") { ready.push(JSON.parse(body)); barriers.push(response); }
      else response.end();
      notify();
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    let runner: ReturnType<typeof spawn> | undefined;
    let verified = false;
    t.after(async () => {
      if (!verified) {
        // A failing regression must reclaim its fixture even if the broken
        // runner has already exited and orphaned the recorded browser/workers.
        const roots = ready.flatMap(fixture => [fixture.wrapper, fixture.worker, fixture.browser, fixture.stubborn])
          .filter((pid): pid is number => pid !== undefined).map(pid => ({ pid }));
        if (runner?.pid) roots.push({ pid: runner.pid });
        await terminateTestProcesses(new Set(roots), "SIGTERM");
      }
      server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
      await rm(directory, { recursive: true, force: true });
    });
    await mkdir(join(directory, "scripts/ci"), { recursive: true }); await mkdir(join(directory, "test"));
    // Run the actual runner code against a tiny isolated suite, never the whole
    // repository recursively. All four files are copied without modification.
    for (const file of ["run-tests.mjs", "test-processes.mjs", "test-plan.mjs", "test-durations.json"]) {
      await copyFile(resolve("scripts/ci", file), join(directory, "scripts/ci", file));
    }
    for (let i = 0; i < count; i++) await copyFile(resolve("test/fixtures/runner-process-tree.mjs"), join(directory, "test", `a-${i}.test.ts`));
    if (signal) await writeFile(join(directory, "test/z-queued.test.ts"),
      'import test from "node:test";test("must stay queued",()=>fetch(process.env.RUNNER_PROBE+"/unexpected",{method:"POST"}));');
    // Windows cannot deliver POSIX signals with child.kill(). Dispatch the same
    // signal event over a controlled preload IPC bridge there; production runner
    // signal handling and native Windows tree cleanup remain the real code.
    const bridge = join(directory, "signal.mjs");
    await writeFile(bridge, 'process.on("message", signal=>process.emit(signal));process.channel?.unref();');
    const env = { ...process.env, RUNNER_PROBE: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      RUNNER_BROWSER_MODULE: pathToFileURL(resolve("node_modules/playwright/index.mjs")).href,
      RUNNER_STUBBORN: signal === "SIGTERM" ? "yes" : "no", CI_TEST_RESULTS: join(directory, "results.json") };
    // This subprocess is a new runner invocation, not the current node:test worker.
    delete env.NODE_TEST_CONTEXT;
    runner = spawn(process.execPath, ["--import", pathToFileURL(bridge).href, join(directory, "scripts/ci/run-tests.mjs"), `--test-concurrency=${count}`], {
      env,
      detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe", "ipc"]
    });
    let output = ""; runner.stdout!.on("data", data => { output += data; }); runner.stderr!.on("data", data => { output += data; });
    const closed = once(runner, "close", { signal: t.signal });
    const allReady = async () => {
      while (ready.length < count) {
        const changed = new Promise<void>(done => { notify = done; });
        if (ready.length < count) await changed;
      }
    };
    await Promise.race([allReady(), closed.then(() => { throw new Error(`Runner exited before fixture ready: ${output}`); })]);
    const before = await processTable();
    const parents = new Map(before.map(row => [row.pid, row.parent]));
    const expected = before.filter(row => {
      let pid = row.pid;
      while (pid && parents.has(pid) && pid !== runner!.pid) pid = parents.get(pid)!;
      return pid === runner!.pid;
    }).map(row => row.pid);
    for (const fixture of ready) assert.ok(expected.includes(fixture.browser), "snapshot includes the real detached browser");
    for (const response of barriers) response.end(signal ? "hold" : "finish");
    if (signal) {
      if (process.platform === "win32") runner.send!(signal);
      else runner.kill(signal);
    }
    const [code, exitSignal] = await closed;
    assert.equal(exitSignal, null, output);
    assert.equal(code, signal === "SIGTERM" ? 143 : signal === "SIGINT" ? 130 : 0, output);
    assert.ok(!events.includes("/unexpected"), "cancellation must stop scheduling queued tests");
    if (!signal) assert.equal(events.filter(event => event === "/cleanup").length, count);
    const live = new Set((await processTable()).filter(row => !row.zombie).map(row => row.pid));
    for (const pid of expected) assert.ok(!live.has(pid), `runner returned with descendant ${pid} still alive`);
    for (const fixture of ready) {
      for (const pid of [fixture.worker, fixture.wrapper, fixture.browser, fixture.stubborn].filter(Boolean)) {
        assert.ok(!live.has(pid!), `runner returned with process ${pid} still alive`);
      }
      await assert.rejects(stat(fixture.home), { code: "ENOENT" });
    }
    const results = JSON.parse(await readFile(join(directory, "results.json"), "utf8"));
    assert.equal(results.results.length, count);
    assert.ok(results.results.every((result: { exitCode: number }) => signal ? result.exitCode !== 0 : result.exitCode === 0));
    verified = true;
  });
}
