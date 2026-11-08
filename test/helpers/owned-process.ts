import type { ChildProcess } from "node:child_process";

/** Stop fixture-owned children before removing their working directories.
 * Cancellation must stop the child immediately, rather than waiting for an
 * after hook while the timed-out test continues using its fixture.
 */
export function ownTestProcess(
  child: ChildProcess,
  signal: AbortSignal,
  beforeCleanup: (cleanup: () => Promise<void>) => void
) {
  let exited = child.exitCode !== null || child.signalCode !== null;
  const stop = () => { if (!exited) child.kill("SIGKILL"); };
  const exit = new Promise<void>(resolve => {
    const finished = () => {
      exited = true;
      signal.removeEventListener("abort", stop);
      resolve();
    };
    if (exited) finished();
    else { child.once("exit", finished); child.once("error", finished); }
  });
  if (!exited) {
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
  }
  beforeCleanup(async () => {
    stop();
    await exit;
    // Compiler descendants may inherit pipes on Windows. The owned child has
    // exited; fixture reclamation must not wait for inherited handles to close.
    child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy();
  });
}
