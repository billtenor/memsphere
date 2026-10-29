import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";
import { withProjectSettingsLock, readModelOperationStamp, assertModelOperationStamp, withConsistentModelRead } from "./model-operation.js";

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

/** Pure View reads use optimistic model consistency, without queueing behind unrelated Run writes.
 * Callers must not recover or mutate records inside this scope. Run locks still protect snapshots.
 */
export function withContextControlViewRead<T>(root: string, read: () => Promise<T>): Promise<T> {
  return withConsistentModelRead(async () => {
    const stamp = await readModelOperationStamp(root);
    try {
      const result = await current.run(resolve(root), read);
      await assertModelOperationStamp(root, stamp);
      return result;
    } catch (error) {
      await assertModelOperationStamp(root, stamp);
      throw error;
    }
  });
}
