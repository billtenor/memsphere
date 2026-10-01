import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Config } from "../../api/config.js";
import type { Context } from "../../api/context.js";
import type { PayloadContent } from "../../api/payload.js";
import type { ListOptions, ListResult } from "../../api/store.js";
import { consumeContent, throwIfAborted } from "./payload.js";

/** Reserved for short-lived implementation files, never for data records. */
export const INTERNAL_PREFIX = ".memsphere-";

export function requireString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

export function requirePositiveInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

export function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/** A conservative, locale-independent key for portable filename collisions. */
export function portableNameKey(name: string): string {
  return name.normalize("NFC").toUpperCase().normalize("NFC");
}

/** Keep IDs readable and valid on Linux, Windows and macOS; never encode them. */
export function validateFilename(name: string): void {
  requireString(name, "filename");
  if (name !== name.normalize("NFC")) throw new TypeError("filename must use NFC Unicode normalization");
  if (/[\u0000-\u001f\u007f-\u009f<>:"/\\|?*]/u.test(name) || /[. ]$/u.test(name) || name === "." || name === "..") {
    throw new TypeError(`filename is not portable: ${JSON.stringify(name)}`);
  }
  // Lone surrogates have no stable UTF-8 representation. Paired surrogates are fine.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(name)) {
    throw new TypeError("filename contains malformed Unicode");
  }
  const base = name.split(".", 1)[0].replace(/ +$/u, "");
  if (/^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/iu.test(base)) {
    throw new TypeError(`filename uses a reserved Windows device name: ${name}`);
  }
  if (name.toLowerCase().startsWith(INTERNAL_PREFIX)) throw new TypeError("filename uses the reserved internal prefix");
  if (name.length > 255 || Buffer.byteLength(name, "utf8") > 255) throw new TypeError("filename exceeds the portable 255-byte/character limit");
}

/** A portable relative file ID uses '/' on every OS, with no traversal or empty segments. */
export function validateRelativeFilePath(path: string): void {
  requireString(path, "relative file path");
  for (const segment of path.split("/")) validateFilename(segment);
}

export async function prepareDirectory(context: Context, config: Config): Promise<string> {
  throwIfAborted(context);
  const directory = config.json.directory;
  requireString(directory, "directory");
  const path = resolve(directory);
  await fs.mkdir(path, { recursive: true });
  const canonical = await fs.realpath(path);
  throwIfAborted(context);
  return canonical;
}

type Entry = { name: string; actual: string; regular: boolean };

async function entries(context: Context, directory: string): Promise<Entry[]> {
  throwIfAborted(context);
  const result: Entry[] = [];
  const keys = new Map<string, string>();
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name.toLowerCase().startsWith(INTERNAL_PREFIX)) continue;
    // Some macOS filesystems return decomposed names even for an NFC input.
    const name = entry.name.normalize("NFC");
    const key = portableNameKey(name);
    const previous = keys.get(key);
    if (previous !== undefined) {
      throw new Error(`Ambiguous filenames: ${JSON.stringify(previous)} and ${JSON.stringify(entry.name)}`);
    }
    keys.set(key, entry.name);
    result.push({ name, actual: entry.name, regular: entry.isFile() });
  }
  throwIfAborted(context);
  return result;
}

/** Enumerate names only: payload contents are never opened by list(). */
export async function listFilenames(context: Context, directory: string): Promise<string[]> {
  const names = (await entries(context, directory)).filter((entry) => entry.regular).map((entry) => entry.name);
  for (const name of names) validateFilename(name);
  return names;
}

async function findDirectory(context: Context, directory: string, name: string): Promise<string | undefined> {
  const key = portableNameKey(name);
  const found = (await entries(context, directory)).find((entry) => portableNameKey(entry.name) === key);
  if (!found) return undefined;
  if (found.name !== name) throw new Error(`Directory case alias is not allowed: ${JSON.stringify(name)} conflicts with ${JSON.stringify(found.name)}`);
  const path = join(directory, found.actual);
  try {
    const stat = await fs.lstat(path);
    throwIfAborted(context);
    if (!stat.isDirectory()) throw new Error(`Path parent must be a directory, not a symlink or file: ${name}`);
    return path;
  } catch (error) {
    if (isCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

/**
 * Resolve a relative ID's parent without following directory symlinks.
 * Validate every segment before creating anything. Physical NFD spellings are preserved.
 * The configured root is trusted; this does not defend against hostile concurrent path swaps.
 */
export async function resolveFileParent(
  context: Context,
  root: string,
  relativePath: string,
  createDirectories = false,
  createdDirectories?: string[]
): Promise<{ directory: string; filename: string } | undefined> {
  validateRelativeFilePath(relativePath);
  throwIfAborted(context);
  const segments = relativePath.split("/");
  const filename = segments.pop()!;
  let directory = root;
  for (const segment of segments) {
    let child = await findDirectory(context, directory, segment);
    if (child === undefined) {
      if (!createDirectories) return undefined;
      throwIfAborted(context);
      try {
        await fs.mkdir(join(directory, segment));
        createdDirectories?.push(join(directory, segment));
      } catch (error) {
        if (!isCode(error, "EEXIST")) throw error;
      }
      // A cooperating creator may have won mkdir; inspect its actual spelling and type.
      child = await findDirectory(context, directory, segment);
      if (child === undefined) throw fileError("ENOENT", `Parent directory disappeared: ${segment}`);
    }
    directory = child;
  }
  throwIfAborted(context);
  return { directory, filename };
}

/** Recursively enumerate readable '/' IDs without opening payloads or following symlinks. */
export async function listRelativeFilenames(context: Context, root: string): Promise<string[]> {
  const result: string[] = [];
  const pending = [{ directory: root, relative: "" }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of await entries(context, current.directory)) {
      const path = join(current.directory, entry.actual);
      let stat: Stats;
      try {
        stat = await fs.lstat(path);
      } catch (error) {
        if (isCode(error, "ENOENT")) continue;
        throw error;
      }
      throwIfAborted(context);
      if (!stat.isDirectory() && !stat.isFile()) continue;
      validateFilename(entry.name);
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      if (stat.isDirectory()) pending.push({ directory: path, relative });
      else result.push(relative);
    }
  }
  return result;
}

/** Reject aliases instead of silently targeting a different ID on a case-insensitive filesystem. */
export async function findFile(context: Context, directory: string, name: string): Promise<{ path: string; stat: Stats } | undefined> {
  validateFilename(name);
  const key = portableNameKey(name);
  const found = (await entries(context, directory)).find((entry) => portableNameKey(entry.name) === key);
  if (!found) return undefined;
  if (found.name !== name) throw new Error(`Filename case alias is not allowed: ${JSON.stringify(name)} conflicts with ${JSON.stringify(found.name)}`);
  const path = join(directory, found.actual);
  try {
    const stat = await fs.lstat(path);
    throwIfAborted(context);
    if (!stat.isFile()) throw new Error(`Record must be a regular file, not a symlink or directory: ${name}`);
    return { path, stat };
  } catch (error) {
    if (isCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

/** Trusted directory/cooperating writers: this is not a hostile-filesystem sandbox. */
export async function readFileSnapshot(context: Context, directory: string, name: string): Promise<{ bytes: Uint8Array; stat: Stats } | undefined> {
  const found = await findFile(context, directory, name);
  if (!found) return undefined;
  let handle;
  try {
    const flags = constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW);
    handle = await fs.open(found.path, flags);
  } catch (error) {
    if (isCode(error, "ENOENT")) return undefined;
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`Record must be a regular file: ${name}`);
    const bytes = await handle.readFile({ signal: context.signal });
    throwIfAborted(context);
    return { bytes, stat };
  } finally {
    await handle.close();
  }
}

function fileError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

async function retryWindowsMutation(context: Context, action: () => Promise<void>): Promise<void> {
  const attempts = process.platform === "win32" ? 20 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    throwIfAborted(context);
    try {
      await action();
      return;
    } catch (error) {
      if (attempt === attempts - 1 || !["EACCES", "EPERM", "EBUSY"].some((code) => isCode(error, code))) throw error;
      await sleep(10 * (attempt + 1), undefined, { signal: context.signal });
    }
  }
}

/**
 * Consume bytes or a single input stream into a temporary file, then publish it.
 * No partially written destination and no file lock.
 * create uses an exclusive hard link; replace uses same-directory rename.
 * Replacement has no CAS and may recreate a record concurrently deleted after its existence check.
 * Atomic creation requires a filesystem supporting local hard links.
 */
export async function atomicPublish(
  context: Context,
  directory: string,
  name: string,
  content: Uint8Array | PayloadContent,
  mode: "create" | "replace"
): Promise<Stats> {
  const found = await findFile(context, directory, name);
  if (mode === "create" && found) throw fileError("EEXIST", `Record already exists: ${name}`);
  if (mode === "replace" && !found) throw fileError("ENOENT", `Record does not exist: ${name}`);
  const destination = found?.path ?? join(directory, name);
  const temporary = join(directory, `${INTERNAL_PREFIX}${randomUUID()}.tmp`);
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    if (content instanceof Uint8Array) {
      await handle.writeFile(content, { signal: context.signal });
    } else {
      await writeContent(context, handle, content);
    }
    await handle.sync();
    const stat = await handle.stat();
    await handle.close();
    throwIfAborted(context);
    if (mode === "create") {
      await fs.link(temporary, destination);
    } else {
      await retryWindowsMutation(context, () => fs.rename(temporary, destination));
    }
    // Return metadata for these committed bytes, not a subsequent writer's destination.
    return stat;
  } finally {
    await handle.close().catch(() => undefined);
    await fs.unlink(temporary).catch(() => undefined);
  }
}

/** Write each chunk completely before consuming the next; a file write may be short. */
async function writeContent(context: Context, handle: FileHandle, content: PayloadContent): Promise<void> {
  await consumeContent(context, content, async (chunk) => {
    let offset = 0;
    while (offset < chunk.byteLength) {
      throwIfAborted(context);
      const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset, null);
      if (bytesWritten === 0) throw new Error("File write made no progress");
      offset += bytesWritten;
    }
  });
}

/**
 * Append to an existing regular file without implicitly creating it.
 * Already written chunks can be visible before EOF and remain after failure.
 * No stream-level atomicity or ordering is promised between concurrent operations.
 */
export async function appendFileContent(
  context: Context,
  directory: string,
  name: string,
  content: PayloadContent
): Promise<void> {
  const found = await findFile(context, directory, name);
  if (!found) throw fileError("ENOENT", `Record does not exist: ${name}`);
  const flags = constants.O_WRONLY | constants.O_APPEND | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW);
  throwIfAborted(context);
  const handle = await fs.open(found.path, flags);
  try {
    if (!(await handle.stat()).isFile()) throw new Error(`Record must be a regular file: ${name}`);
    await writeContent(context, handle, content);
    await handle.sync();
    throwIfAborted(context);
  } finally {
    await handle.close();
  }
}

/** Remove only empty directories created by the failed operation, never recursively. */
export async function cleanupCreatedDirectories(directories: readonly string[]): Promise<void> {
  for (const directory of [...directories].reverse()) await fs.rmdir(directory).catch(() => undefined);
}

export async function deleteFile(context: Context, directory: string, name: string): Promise<boolean> {
  const found = await findFile(context, directory, name);
  if (!found) return false;
  throwIfAborted(context);
  try {
    await retryWindowsMutation(context, () => fs.unlink(found.path));
    return true;
  } catch (error) {
    if (isCode(error, "ENOENT")) return false;
    throw error;
  }
}

const recordQueues = new Map<string, Promise<void>>();

/**
 * Serialize one file's mutations in this JS realm, including across Store instances.
 * This is not a filesystem lock: other processes/worker isolates do not participate.
 * Abandoned waiters stay in the queue until their predecessor finishes.
 */
export async function withRecordLock<T>(
  context: Context,
  directory: string,
  filename: string,
  action: () => Promise<T>
): Promise<T> {
  validateFilename(filename);
  throwIfAborted(context);
  const canonical = await fs.realpath(directory);
  throwIfAborted(context);
  const key = portableNameKey(join(canonical, filename));
  const previous = recordQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveCurrent) => { release = resolveCurrent; });
  const tail = previous.then(() => current);
  recordQueues.set(key, tail);
  void tail.then(() => { if (recordQueues.get(key) === tail) recordQueues.delete(key); });
  let onAbort: (() => void) | undefined;
  try {
    await new Promise<void>((resolveTurn, reject) => {
      onAbort = () => reject(context.signal?.reason ?? new DOMException("Aborted", "AbortError"));
      context.signal?.addEventListener("abort", onAbort, { once: true });
      if (context.signal?.aborted) onAbort();
      void previous.then(resolveTurn);
    });
    throwIfAborted(context);
    return await action();
  } finally {
    if (onAbort) context.signal?.removeEventListener("abort", onAbort);
    release();
  }
}

/** Stable lexical pagination without reading record bodies. Scope binds a cursor to its Store. */
export function paginate(ids: readonly string[], options: ListOptions | undefined, scope: string): ListResult {
  const limit = options?.limit === undefined ? 100 : options.limit;
  requirePositiveInteger(limit, "limit");
  if (limit > 1000) throw new RangeError("limit must not exceed 1000");
  let after: string | undefined;
  if (options?.cursor !== undefined) {
    requireString(options.cursor, "cursor");
    try {
      const decoded = Buffer.from(options.cursor, "base64url");
      if (decoded.toString("base64url") !== options.cursor) throw new Error();
      const cursor = JSON.parse(decoded.toString("utf8")) as unknown;
      if (typeof cursor !== "object" || cursor === null || !("scope" in cursor) || cursor.scope !== scope || !("after" in cursor) || typeof cursor.after !== "string" || !("check" in cursor)) throw new Error();
      const check = createHash("sha256").update(JSON.stringify([scope, cursor.after])).digest("hex");
      if (cursor.check !== check) throw new Error();
      after = cursor.after;
    } catch {
      throw new TypeError("Invalid or foreign list cursor");
    }
  }
  const sorted = [...ids].sort();
  const start = after === undefined ? 0 : sorted.findIndex((id) => id > after!);
  const selected = start === -1 ? [] : sorted.slice(start, start + limit);
  const result: ListResult = { items: selected.map((id) => ({ id })) };
  if (start !== -1 && start + selected.length < sorted.length) {
    const last = selected[selected.length - 1];
    const check = createHash("sha256").update(JSON.stringify([scope, last])).digest("hex");
    result.nextCursor = Buffer.from(JSON.stringify({ scope, after: last, check }), "utf8").toString("base64url");
  }
  return result;
}
