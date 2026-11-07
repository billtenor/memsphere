import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { bounded, stopFixtureChild } from "./fixture-process.js";

/** Per-test, read-only CIM host. The parent owns its original ChildProcess. */
export async function windowsProcessObserver(signal?: AbortSignal) {
  signal?.throwIfAborted();
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
    fileURLToPath(new URL("../fixtures/windows-process-observer.ps1", import.meta.url))], { windowsHide: true, stdio: "pipe" });
  return ownedProcessObserver(child, signal);
}

/** Own the transport lifetime; any response failure permanently invalidates it. */
export async function ownedProcessObserver(child: ChildProcessWithoutNullStreams, signal?: AbortSignal, responseTimeoutMs = 15_000) {
  const closed = once(child, "close");
  let stderr = "";
  child.stderr.on("data", value => { stderr += String(value); });
  let failTransport!: (error: Error) => void;
  const transportFailure = new Promise<never>((_, reject) => { failTransport = reject; });
  void transportFailure.catch(() => {});
  child.stdin.on("error", error => { stderr += String(error); failTransport(error); });
  const lines = createInterface({ input: child.stdout });
  const messages: string[] = [];
  let deliver: ((line: string) => void) | undefined;
  let failed: unknown;
  lines.on("line", line => {
    if (failed) return;
    if (deliver) { const resolve = deliver; deliver = undefined; resolve(line); } else messages.push(line);
  });
  const abort = () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
  signal?.addEventListener("abort", abort, { once: true });
  let disposing: Promise<void> | undefined;
  const dispose = () => disposing ??= (async () => {
    signal?.removeEventListener("abort", abort);
    deliver = undefined;
    messages.length = 0;
    lines.close();
    await stopFixtureChild(child);
  })();
  const next = async (timeoutMs = 15_000) => {
    try {
      return await bounded(Promise.race([
        messages.length ? Promise.resolve(messages.shift()!) : new Promise<string>(resolve => { deliver = resolve; }),
        transportFailure,
        closed.then(([code]) => { throw Error(`CIM observer closed (${code}): ${stderr}`); })
      ]), "fresh fixture CIM response", timeoutMs);
    } catch (error) {
      failed = error;
      try { await dispose(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "CIM observer failure and cleanup"); }
      throw error;
    }
  };
  try {
    if (JSON.parse(await next()).ready !== true) throw Error("CIM observer did not become ready");
    let queue = Promise.resolve();
    let stopped = false;
    return {
      query(pids: number[]) {
        const response = queue.then(async () => {
          if (failed) throw failed;
          if (stopped) throw Error("CIM observer is closed");
          if (!pids.length || pids.some(pid => !Number.isSafeInteger(pid) || pid < 1)) throw Error("Invalid fixture PIDs");
          const result = next(responseTimeoutMs); // Attach the reader before sending the request.
          try {
            child.stdin.write(JSON.stringify({ pids }) + "\n", error => { if (error) failTransport(error); });
          } catch (error) { failTransport(error as Error); }
          return result;
        });
        queue = response.then(() => undefined, () => undefined);
        return response;
      },
      async close() {
        if (stopped || failed) { await dispose(); return; }
        stopped = true;
        try {
          await queue;
          child.stdin.end('{"close":true}\n');
          const [code] = await bounded(closed, "owned CIM observer exit");
          if (code !== 0) throw Error(`CIM observer failed (${code}): ${stderr}`);
        } finally { await dispose(); }
      }
    };
  } catch (error) { child.stdin.end(); await dispose(); throw error; }
}
