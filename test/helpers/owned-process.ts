import type { ChildProcess } from "node:child_process";

/** Cancellation stops fixture-owned children; failed termination must block deletion. */
export function ownTestProcess(
  child: ChildProcess,
  signal: AbortSignal,
  beforeCleanup: (cleanup: () => Promise<void>) => void
) {
  let exited = child.exitCode !== null || child.signalCode !== null;
  let terminationError: unknown;
  let notify: () => void;
  const settled = new Promise<void>(resolve => { notify = resolve; });
  const finished = () => {
    exited = true;
    signal.removeEventListener("abort", stop);
    notify();
  };
  const failed = (error: Error) => {
    // An unsuccessful spawn has no owned PID. An error from an enrolled child
    // (kill/send failures included) is not evidence that the process exited.
    if (child.pid === undefined) finished();
    else { terminationError ??= error; notify(); }
  };
  const stop = () => {
    if (exited) return;
    try {
      if (!child.kill("SIGKILL")) failed(new Error(`Could not terminate owned process ${child.pid}`));
    } catch (error) { failed(error as Error); }
  };
  child.once("exit", finished);
  child.on("error", failed);
  if (exited) finished();
  else {
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
  }
  beforeCleanup(async () => {
    stop();
    await settled;
    if (!exited) throw terminationError ?? new Error(`Owned process ${child.pid} has not exited`);
    // Only a confirmed exit (or failed spawn) permits fixture reclamation.
    child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy();
  });
}
