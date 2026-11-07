import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { ProcessIdentity } from "../../src/context_control/review-process.js";
import { bounded, stopFixtureChild } from "./fixture-process.js";

/** Fixture-only controller: verifies and terminates through the SAME native handle. */
export async function pinWindowsProcess(identity: ProcessIdentity, signal?: AbortSignal) {
  if (process.platform !== "win32") throw Error("Windows handle fixture requires Windows");
  if (!/^\d+$/.test(identity.started)) throw Error("Invalid Windows creation identity");
  signal?.throwIfAborted();
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
    fileURLToPath(new URL("../fixtures/windows-process-handle.ps1", import.meta.url)),
    "-TargetPid", String(identity.pid), "-ExpectedTicks", identity.started], { windowsHide: true, stdio: "pipe" });
  const closed = once(child, "close");
  let stderr = "";
  child.stderr.on("data", data => { stderr += String(data); });
  child.stdin.on("error", error => { stderr += String(error); });
  const lines = createInterface({ input: child.stdout });
  const messages: unknown[] = [];
  let notify: ((value: unknown) => void) | undefined;
  lines.on("line", line => {
    let value: unknown;
    try { value = JSON.parse(line); } catch { value = { invalid: line }; }
    if (notify) { const resolve = notify; notify = undefined; resolve(value); } else messages.push(value);
  });
  const next = () => bounded(Promise.race([
    messages.length ? Promise.resolve(messages.shift()) : new Promise(resolve => { notify = resolve; }),
    closed.then(([code]) => { throw Error(`Handle controller exited (${code}): ${stderr}`); })
  ]), "Windows handle controller message");
  const abort = () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
  signal?.addEventListener("abort", abort, { once: true });
  const dispose = async () => {
    signal?.removeEventListener("abort", abort);
    lines.close();
    await stopFixtureChild(child);
  };
  try {
    const armed = await next() as { armed?: boolean; started?: string };
    if (armed.armed !== true || !armed.started) throw Error(`Controller did not arm: ${JSON.stringify(armed)}`);
    let done = false;
    const command = async (text: string | undefined, expectTermination: boolean) => {
      if (done) return;
      done = true;
      try {
        child.stdin.end(text === undefined ? undefined : text + "\n");
        if (expectTermination && (await next() as { terminated?: boolean }).terminated !== true) throw Error("Original handle termination was not acknowledged");
        const [code] = await bounded(closed, "Windows handle controller exit");
        if (code !== 0) throw Error(`Handle controller failed (${code}): ${stderr}`);
      } finally { await dispose(); }
    };
    return { started: armed.started, terminate: () => command("terminate", true), close: () => command("close", false),
      closeChannel: () => command(undefined, false) };
  } catch (error) {
    child.stdin.end();
    await dispose();
    throw error;
  }
}
