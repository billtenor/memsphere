import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { withNativeFileLock } from "../file-lock.js";

const active = new AsyncLocalStorage<{ root: string; open: boolean; forbidNested: boolean }>();

/** Project-wide admission lock. Take this before App, model journal or config locks. */
export async function withSharedStoreLock<T>(root: string, action: () => Promise<T>, signal?: AbortSignal, forbidNested = false): Promise<T> {
  root = await realpath(root);
  const parent = active.getStore();
  if (parent?.open && parent.root === root) {
    if (parent.forbidNested) throw Object.assign(new Error("Project maintenance cannot run inside a shared App operation"), { code: "SHARED_STORE_LOCK_REENTRY" });
    return action();
  }
  const directory = join(root, ".runtime");
  await mkdir(directory, { recursive: true });
  return withNativeFileLock(join(directory, "shared-store.lock"), async () => {
    const scope = { root, open: true, forbidNested };
    try { return await active.run(scope, action); }
    finally { scope.open = false; }
  }, { signal });
}
