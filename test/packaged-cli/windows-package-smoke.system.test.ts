import crossSpawn from "cross-spawn";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { terminateTestProcesses } from "../../scripts/ci/test-processes.mjs";

test("installed Windows CLI completes a Run and exercises the View and daemon lifecycle", async t => {
  if (!process.env.MEMSPHERE_HOME) throw new Error("The packaged CLI test requires a dedicated MEMSPHERE_HOME");
  const testSignal = AbortSignal.any([t.signal, AbortSignal.timeout(5 * 60_000)]);
  const workspace = process.cwd();
  const project = resolve(workspace, ".ci windows project");
  const cli = resolve(workspace, ".ci-install", "node_modules", ".bin", "memsphere.cmd");
  let activeCommand: Promise<string> | undefined;
  const daemon = JSON.parse(await run(["daemon", "status", "--output", "json"], workspace));
  if (daemon.running !== false) throw new Error("The packaged CLI test requires a stopped daemon in its Home");

  await Promise.all(
    ["concepts", "statements", "schemas", "procedures"].map((kind) =>
      mkdir(resolve(project, kind), { recursive: true })
    )
  );
  await writeFile(resolve(project, "procedures", "windows-ci-smoke.yaml"), `!procedure
syntax: memsphere-20260721-stable
names:
  - windows-ci-smoke
  - Windows CI smoke
goals:
  - Verify the packaged Windows CLI Run path.
flow:
  - !action
    action: Report one Windows smoke Artifact.
    artifact: !artifact
      name: Windows smoke result
      format: markdown
`, { encoding: "utf8", signal: testSignal });
  await run(["project", "create", "windows-ci", "--embedded", project, "--bind"], workspace);

  await run(["validate"]);
  await run(["memory", "list", "--kind", "procedures", "--output", "json"]);
  await run(["memory", "read", "Windows CI smoke", "--output", "json"]);

  const started = await run(["run", "start", "Windows CI smoke", "--name", "Windows packaged smoke"]);
  const runId = started.match(/\b(run-[a-z0-9-]+)\b/i)?.[1];
  if (!runId) throw new Error(`Could not read Run id from output:\n${started}`);
  await run(["run", "report", "--run", runId, "--artifact", "Windows packaged CLI passed."]);
  const completed = JSON.parse(await run(["run", "show", "--run", runId, "--output", "json"]));
  if (completed.run?.status !== "done") throw new Error(`Windows smoke Run did not complete: ${completed.run?.status}`);

  let daemonStopped = false;
  t.after(async () => {
    // An aborted test can reach its after hook while its command is still closing.
    await activeCommand?.catch(() => undefined);
    if (daemonStopped) return;
    try {
      // The packaged daemon stop can wait up to a minute for shutdown.
      await invoke(["daemon", "stop"], project, AbortSignal.timeout(75_000));
    } catch (error) {
      t.diagnostic(`Could not stop the packaged test daemon: ${error}`);
      throw error;
    }
  });
  await run(["daemon", "start"]);
  await run(["daemon", "status"]);
  const startedView = JSON.parse(await run(["view", "start", "--output", "json"]));
  const origin = startedView.view?.url;
  if (!origin) throw new Error("View start did not return view.url");
  await run(["view", "status"]);
  const httpSignal = AbortSignal.any([testSignal, AbortSignal.timeout(15_000)]);
  const response = await fetch(origin, { signal: httpSignal }).catch(error => {
    if (!httpSignal.aborted) throw error;
    throw new Error(`View HTTP request cancelled: ${httpSignal.reason}`, { cause: error });
  });
  const status = response.status;
  await response.body?.cancel();
  if (!response.ok) throw new Error(`View request failed with HTTP ${status}`);
  await run(["view", "restart"]);
  await run(["view", "status"]);
  await run(["daemon", "restart"]);
  await run(["view", "status"]);
  await run(["view", "stop"]);
  await run(["view", "status"]);
  await run(["daemon", "stop"]);
  daemonStopped = true;

  async function run(args: string[], cwd = project) {
    activeCommand = invoke(args, cwd, AbortSignal.any([testSignal, AbortSignal.timeout(45_000)]));
    try { return await activeCommand; }
    finally { activeCommand = undefined; }
  }

  async function invoke(args: string[], cwd: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const child = crossSpawn(cli, args, {
      cwd,
      env: process.env,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", chunk => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.pipe(process.stderr, { end: false });
    let spawnError: Error | undefined;
    child.on("error", error => { spawnError = error; });
    let childClosed = false;
    const closed = new Promise<number | null>(resolve => child.once("close", code => {
      childClosed = true;
      resolve(code);
    }));
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason);
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const command = `${cli} ${args.join(" ")}`;
    try {
      const status = await Promise.race([closed, cancelled]);
      signal.throwIfAborted();
      if (spawnError) throw spawnError;
      if (status !== 0) throw new Error(`${command} exited ${status}`);
      return stdout;
    } catch (error) {
      if (!signal.aborted) throw error;
      const failure = new Error(`${command} cancelled: ${signal.reason}`, { cause: error });
      if (!childClosed) {
        try {
          await terminateTestProcesses([child], "SIGTERM", { signal: AbortSignal.timeout(25_000) });
          await Promise.race([closed, delay(5_000, undefined, { ref: false }).then(() => {
            throw new Error("Cancelled command streams did not close");
          })]);
        } catch (terminationError) {
          throw new AggregateError([failure, terminationError], `${failure.message}; could not confirm command termination`);
        }
      }
      throw failure;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
});
