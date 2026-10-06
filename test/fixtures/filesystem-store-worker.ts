import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Config } from "../../src/data/api/config.js";
import { FilesystemJsonValueStoreFactory } from "../../src/data/extensions/filesystem-json-valuestore/index.js";
import { createPlainRuntime } from "../../src/data/extensions/shared/reflection.js";
import { withNativeFileLock } from "../../src/file-lock.js";

type Request = { operation: "create" | "update" | "delete" | "lock"; expectedRevision?: number; pause?: "after-lock" | "before-publish" | "after-publish" | "after-history"; timeoutMs?: number; value?: unknown };
const directory = await fs.realpath(process.argv[2]);
const request = JSON.parse(process.argv[3]) as Request;
const locks = createRequire(import.meta.url)("fs-native-extensions");
const originalTryLock = locks.tryLock;
let acquired = false;
let reportedWaiting = false;
locks.tryLock = (...args: unknown[]) => {
  const result = originalTryLock(...args);
  if (result) acquired = true;
  else if (!reportedWaiting) { reportedWaiting = true; process.send!({ type: "waiting" }); }
  return result;
};

let release!: () => void;
const released = new Promise<void>((resolve) => { release = resolve; });
let paused = false;
async function barrier(phase: Request["pause"]): Promise<void> {
  if (paused || request.pause !== phase) return;
  paused = true;
  process.send!({ type: "paused", phase });
  await released;
}

const originalReaddir = fs.readdir.bind(fs);
fs.readdir = (async (...args: Parameters<typeof fs.readdir>) => {
  if (acquired && String(args[0]) === directory) await barrier("after-lock");
  return originalReaddir(...args);
}) as typeof fs.readdir;
for (const method of ["link", "rename", "unlink"] as const) {
  const original = fs[method].bind(fs) as (...args: string[]) => Promise<void>;
  (fs as unknown as Record<string, unknown>)[method] = async (...args: string[]) => {
    if (args[method === "unlink" ? 0 : 1] === join(directory, "item.json")) {
      await barrier(method === "unlink" ? "after-history" : "before-publish");
    }
    await original(...args);
    if (method !== "unlink" && args[1] === join(directory, "item.json")) await barrier("after-publish");
  };
}

const runtime = createPlainRuntime({ id: "test/record.json", root: { kind: "object", fields: [], field: () => undefined } });
const store = request.operation === "lock" ? undefined : await new FilesystemJsonValueStoreFactory().openExisting({}, "test/records", runtime, new Config({ directory }));
process.on("message", async (message) => {
  if (message === "continue") { release(); return; }
  if (message !== "start") return;
  try {
    let value: unknown;
    if (request.operation === "lock") {
      value = await withNativeFileLock(join(directory, "coordination.lock"), async () => {
        process.send!({ type: "locked" });
        await released;
        return true;
      }, { timeoutMs: request.timeoutMs ?? 5_000 });
    } else if (request.operation === "create") value = await store!.create({}, "item", request.value ?? { value: "created" });
    else if (request.operation === "update") value = await store!.update({}, "item", request.value ?? { value: "updated" }, { expectedRevision: request.expectedRevision });
    else value = await store!.delete({}, "item", { expectedRevision: request.expectedRevision });
    process.send!({ type: "result", ok: true, value });
  } catch (error) {
    const failure = error as Error & { code?: string };
    process.send!({ type: "result", ok: false, code: failure.code, message: failure.message });
  } finally {
    process.disconnect();
  }
});
process.send!({ type: "ready" });
