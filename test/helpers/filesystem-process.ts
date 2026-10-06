import { fork } from "node:child_process";
import type { TestContext } from "node:test";

export type WorkerMessage = { type: string; ok?: boolean; value?: any; code?: string; message?: string };

/** IPC barriers observe actual lock acquisition/contending calls, never elapsed time. */
export async function filesystemWorker(t: TestContext, directory: string, request: object) {
  const child = fork(new URL("../fixtures/filesystem-store-worker.ts", import.meta.url), [directory, JSON.stringify(request)], {
    execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"]
  });
  const messages: WorkerMessage[] = [];
  const waiting = new Map<string, { resolve: (message: WorkerMessage) => void; reject: (error: Error) => void }>();
  let stderr = "";
  let exited = false;
  child.stderr!.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.on("message", (message: WorkerMessage) => {
    const waiter = waiting.get(message.type);
    if (waiter) { waiting.delete(message.type); waiter.resolve(message); }
    else messages.push(message);
  });
  const exit = new Promise<void>((resolve) => child.once("exit", () => {
    exited = true;
    for (const waiter of waiting.values()) waiter.reject(new Error(`Worker exited before expected IPC message: ${stderr}`));
    waiting.clear();
    resolve();
  }));
  t.after(async () => { if (!exited) child.kill("SIGKILL"); await exit; });
  function next(type: string): Promise<WorkerMessage> {
    const index = messages.findIndex((message) => message.type === type);
    if (index !== -1) return Promise.resolve(messages.splice(index, 1)[0]);
    if (exited) return Promise.reject(new Error(`Worker exited before ${type}: ${stderr}`));
    return new Promise((resolve, reject) => { waiting.set(type, { resolve, reject }); });
  }
  await next("ready");
  return { child, next, exit, send: (message: string) => child.send(message) };
}
