import { fork } from "node:child_process";
import { ownTestProcess } from "./owned-process.js";

type Reply = { type: "result"; stdout: string; stderr: string; error?: string; code?: number };
type Pending = { finish(reply: Reply): void; reject(error: unknown): void };

/** Reuse loaded CLI modules in one owned process with serial, bounded commands. */
export function cliModuleProcess(options: {
  cwd: string; env: NodeJS.ProcessEnv; entrypoint: string; signal: AbortSignal; timeout: number;
  beforeCleanup: (cleanup: () => Promise<void>) => void;
}) {
  const stop = new AbortController();
  const signal = AbortSignal.any([options.signal, stop.signal]);
  signal.throwIfAborted();
  const child = fork(new URL("../fixtures/cli-module-worker.ts", import.meta.url), [options.entrypoint], {
    cwd: options.cwd, env: options.env, execArgv: ["--import", import.meta.resolve("tsx")],
    stdio: ["ignore", "ignore", "inherit", "ipc"]
  });
  ownTestProcess(child, signal, options.beforeCleanup);
  let pending: Pending | undefined;
  let exited: Error | undefined;
  child.on("error", error => stop.abort(error));
  child.on("message", (reply: Reply) => {
    if (reply.type === "result" && !signal.aborted) pending?.finish(reply);
  });
  child.once("close", (code, killedBy) => {
    exited = new Error(`CLI worker exited (${killedBy ?? code})`);
    pending?.reject(signal.aborted ? signal.reason : exited);
  });

  async function invoke(args: string[]) {
    signal.throwIfAborted();
    if (exited) throw exited;
    if (pending) throw new Error("CLI worker commands must run serially");
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const deadline = setTimeout(() => stop.abort(new Error(`CLI command timed out after ${options.timeout} ms`)), options.timeout);
      const settle = () => {
        clearTimeout(deadline);
        pending = undefined;
      };
      pending = {
        finish({ stdout, stderr, error, code }) {
          settle();
          if (error !== undefined) reject(Object.assign(new Error(error), { stdout, stderr, code }));
          else resolve({ stdout, stderr });
        },
        reject(error) {
          settle();
          reject(error);
        }
      };
      child.send(args, error => { if (error) stop.abort(error); });
    });
  }
  return { child, invoke };
}
