import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";
import { withProjectSettingsLock, readModelOperationStamp } from "./model-operation.js";

const current = new AsyncLocalStorage<string>();
/** A short Project operation, never an Agent/LLM lifetime. Lock order: Project, Run, record. */
export function withContextControlAccess<T>(root: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const key = resolve(root);
  if (current.getStore() === key) return action();
  return withProjectSettingsLock(root, () => current.run(key, async () => {
    await readModelOperationStamp(root);
    return action();
  }), signal);
}
/** For a caller that already owns the Project model/settings lock. */
export function underContextControlAccess<T>(root: string, action: () => Promise<T>): Promise<T> {
  return current.run(resolve(root), action);
}
export const isContextControlStore = (id: string) => /^context_control\/(runs|steps|artifacts|externals|reviews)$/.test(id);
