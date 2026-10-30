import { mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { withNativeFileLock } from "./file-lock.js";

/** Coordinates a config file's read/modify/write, never ordinary Project operations. */
export async function withConfigFileLock<T>(configPath: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const file = resolve(configPath);
  const directory = await realpath(dirname(file));
  const lockPath = join(directory, ".runtime", `${basename(file)}.lock`);
  await mkdir(dirname(lockPath), { recursive: true });
  return withNativeFileLock(lockPath, action, { signal });
}
