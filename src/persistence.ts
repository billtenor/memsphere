import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const inProcessLocks = new Map<string, Promise<void>>();

export async function atomicWriteFile(path: string, content: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const handle = await open(temporaryPath, "wx", mode);
  let moved = false;
  try {
    await handle.writeFile(content, "utf8");
    if (process.platform !== "win32") await handle.sync();
    await handle.close();
    await replaceFile(temporaryPath, path);
    moved = true;
    if (process.platform !== "win32") {
      const directory = await open(dirname(path), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } finally {
    await handle.close().catch(() => undefined);
    if (!moved) await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function replaceFile(temporaryPath: string, path: string): Promise<void> {
  const attempts = process.platform === "win32" ? 20 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rename(temporaryPath, path);
      return;
    } catch (error) {
      if (!isReplaceRetryable(error) || attempt === attempts - 1) throw error;
      await sleep(10 * (attempt + 1));
    }
  }
}

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function withFileLock<T>(
  lockPath: string,
  action: () => Promise<T>,
  options: { timeoutMs?: number; staleMs?: number } = {}
): Promise<T> {
  const key = resolve(lockPath);
  const previous = inProcessLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent;
  });
  const tail = previous.then(() => current);
  inProcessLocks.set(key, tail);
  await previous;
  try {
    return await withFilesystemLock(lockPath, action, options);
  } finally {
    release();
    if (inProcessLocks.get(key) === tail) inProcessLocks.delete(key);
  }
}

async function withFilesystemLock<T>(
  lockPath: string,
  action: () => Promise<T>,
  options: { timeoutMs?: number; staleMs?: number }
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const staleMs = options.staleMs ?? 60_000;
  const owner = { pid: process.pid, token: randomBytes(12).toString("hex"), created_at: new Date().toISOString() };
  await mkdir(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
      await handle.close();
      break;
    } catch (error) {
      if (!isCode(error, "EEXIST")) throw error;
      await removeStaleLock(lockPath, staleMs);
      if (Date.now() >= deadline) throw new Error(`timed out waiting for lock: ${lockPath}`);
      await sleep(25);
    }
  }

  try {
    return await action();
  } finally {
    const current = await readLock(lockPath);
    if (current?.token === owner.token) await rm(lockPath, { force: true });
  }
}

async function removeStaleLock(lockPath: string, staleMs: number): Promise<void> {
  const current = await readLock(lockPath);
  if (current && processExists(current.pid)) return;
  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs < staleMs) return;
  } catch (error) {
    if (isCode(error, "ENOENT")) return;
    throw error;
  }
  await rm(lockPath, { force: true });
}

async function readLock(path: string): Promise<{ pid: number; token: string } | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    if (typeof value.pid !== "number" || typeof value.token !== "string") return undefined;
    return { pid: value.pid, token: value.token };
  } catch (error) {
    if (isCode(error, "ENOENT") || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isCode(error, "EPERM");
  }
}

function isCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function isReplaceRetryable(error: unknown): boolean {
  return ["EACCES", "EBUSY", "EPERM"].some((code) => isCode(error, code));
}
