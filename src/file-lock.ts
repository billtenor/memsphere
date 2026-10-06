import { constants } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

export interface NativeFileLockOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

type NativeLocks = { tryLock(fd: number): boolean; unlock(fd: number): void };
let nativeLocks: NativeLocks | undefined;

function loadNativeLocks(): NativeLocks {
  if (nativeLocks) return nativeLocks;
  try {
    const loaded = createRequire(import.meta.url)("fs-native-extensions") as NativeLocks;
    if (typeof loaded.tryLock !== "function" || typeof loaded.unlock !== "function") throw new TypeError("Missing native lock functions");
    return nativeLocks = loaded;
  } catch (cause) {
    throw Object.assign(new Error("Native file locking is unavailable; no write was attempted", { cause }), { code: "UNSUPPORTED_CAPABILITY" });
  }
}

/**
 * Lock a permanent coordination file, never a file published by rename. The
 * caller creates its parent directory. Nobody may unlink or replace this file:
 * all processes must keep locking the same inode. Kernel ownership ends on
 * close/process death; there is no timestamp-based lock stealing or stale file.
 */
export async function withNativeFileLock<T>(
  file: string,
  action: () => Promise<T>,
  options: NativeFileLockOptions = {}
): Promise<T> {
  const { timeoutMs = 10_000, pollIntervalMs = 25, signal } = options;
  for (const [name, value] of [["timeoutMs", timeoutMs], ["pollIntervalMs", pollIntervalMs]] as const) {
    if (!Number.isFinite(value) || value < 0 || (name === "pollIntervalMs" && value === 0)) throw new RangeError(`${name} must be ${name === "timeoutMs" ? "nonnegative" : "positive"} and finite`);
  }
  signal?.throwIfAborted();
  const locks = loadNativeLocks();
  const flags = constants.O_CREAT | constants.O_RDWR | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW);
  const handle = await fs.open(file, flags, 0o600);
  let held = false;
  try {
    if (!(await handle.stat()).isFile() || (await fs.lstat(file)).isSymbolicLink()) throw new TypeError(`Lock must be a regular file: ${file}`);
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      signal?.throwIfAborted();
      try {
        held = locks.tryLock(handle.fd);
      } catch (cause) {
        throw Object.assign(new Error(`Native file locking is unavailable for ${file}`, { cause }), { code: "UNSUPPORTED_CAPABILITY" });
      }
      if (held) break;
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw Object.assign(new Error(`Timed out waiting for file lock: ${file}`), { code: "LOCK_TIMEOUT", details: { file, timeoutMs } });
      try {
        await delay(Math.min(pollIntervalMs, remaining), undefined, { signal });
      } catch (error) {
        signal?.throwIfAborted();
        throw error;
      }
    }
    signal?.throwIfAborted();
    return await action();
  } finally {
    try {
      if (held) locks.unlock(handle.fd);
    } finally {
      await handle.close();
    }
  }
}
