import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { bounded, stopFixtureChild } from "./fixture-process.js";

/** Per-test, read-only CIM host. The parent owns its original ChildProcess. */
export async function windowsProcessObserver(signal?: AbortSignal) {
  signal?.throwIfAborted();
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
    fileURLToPath(new URL("../fixtures/windows-process-observer.ps1", import.meta.url))], { windowsHide: true, stdio: "pipe" });
  const closed = once(child, "close");
  let stderr = "";
  child.stderr.on("data", value => { stderr += String(value); });
  child.stdin.on("error", error => { stderr += String(error); });
  const lines = createInterface({ input: child.stdout });
  const messages: string[] = [];
  let deliver: ((line: string) => void) | undefined;
  lines.on("line", line => {
    if (deliver) { const resolve = deliver; deliver = undefined; resolve(line); } else messages.push(line);
  });
  const next = () => bounded(Promise.race([
    messages.length ? Promise.resolve(messages.shift()!) : new Promise<string>(resolve => { deliver = resolve; }),
    closed.then(([code]) => { throw Error(`CIM observer closed (${code}): ${stderr}`); })
  ]), "fresh fixture CIM response");
  const abort = () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
  signal?.addEventListener("abort", abort, { once: true });
  const dispose = async () => {
    signal?.removeEventListener("abort", abort);
    lines.close();
    await stopFixtureChild(child);
  };
  try {
    if (JSON.parse(await next()).ready !== true) throw Error("CIM observer did not become ready");
    let queue = Promise.resolve();
    let stopped = false;
    return {
      query(pids: number[]) {
        const response = queue.then(async () => {
          if (stopped) throw Error("CIM observer is closed");
          if (!pids.length || pids.some(pid => !Number.isSafeInteger(pid) || pid < 1)) throw Error("Invalid fixture PIDs");
          const result = next(); // Attach the reader before sending the request.
          child.stdin.write(JSON.stringify({ pids }) + "\n");
          return result;
        });
        queue = response.then(() => undefined, () => undefined);
        return response;
      },
      async close() {
        if (stopped) return;
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
