import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rm, rmdir, lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { atomicWriteJson, atomicWriteFile } from "../persistence.js";
import { withNativeFileLock } from "../file-lock.js";
import { canonicalPath, validateModelStoragePaths, within } from "./model-storage-paths.js";

const mutationSchema = z.object({
  path: z.string(), before: z.string().nullable(), after: z.string().nullable(),
  beforeHash: z.string().nullable(), afterHash: z.string().nullable()
}).strict();
const operationSchema = z.object({
  version: z.literal(1), operationId: z.string().uuid(), root: z.string(), kind: z.string(),
  phase: z.enum(["pending", "recovering", "committed", "recovered"]),
  changes: z.array(mutationSchema), createdDirectories: z.array(z.string())
}).strict();
type Operation = z.infer<typeof operationSchema>;
export type ModelFileChange = { path: string; before: Buffer | undefined; after: Buffer | undefined };
export type ModelOperationHooks = { afterFile?: (index: number) => Promise<void>; afterPending?: () => Promise<void> };
const statePath = (root: string) => join(root, ".runtime/model-operation.json");
const failure = (code: string, message: string, details?: unknown) => Object.assign(new Error(message), { code, details });
const digest = (bytes: Buffer | undefined) => bytes === undefined ? null : createHash("sha256").update(bytes).digest("hex");
const same = (a: Buffer | undefined, b: Buffer | undefined) => a === undefined ? b === undefined : b !== undefined && a.equals(b);

export async function optionalFileBytes(path: string): Promise<Buffer | undefined> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw failure("MODEL_OPERATION_CONFLICT", `Refusing symbolic link: ${path}`);
    return await readFile(path);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
async function readOperation(root: string): Promise<Operation | undefined> {
  const bytes = await optionalFileBytes(statePath(root));
  if (!bytes) return undefined;
  try {
    const operation = operationSchema.parse(JSON.parse(bytes.toString("utf8")));
    // Project creation publishes a fully committed staging tree by directory rename.
    // Only an unfinished record may act on its original absolute target paths.
    if (operation.root !== resolve(root) && ["pending", "recovering"].includes(operation.phase)) throw new TypeError("Wrong Project in unfinished operation record");
    for (const change of operation.changes) {
      for (const side of ["before", "after"] as const) {
        const content = change[side];
        if (digest(content === null ? undefined : Buffer.from(content, "base64")) !== change[`${side}Hash`])
          throw new TypeError(`Invalid ${side} digest: ${change.path}`);
      }
    }
    return operation;
  } catch (cause) { throw failure("MODEL_OPERATION_DAMAGED", `Damaged model operation record: ${statePath(root)}`, { cause: String(cause) }); }
}

/** Persistent stamp retained after commit/recovery; pure reads never create a lock or directory. */
export async function readModelOperationStamp(root: string): Promise<string> {
  const operation = await readOperation(root);
  if (operation && ["pending", "recovering"].includes(operation.phase)) {
    throw failure("MODEL_OPERATION_PENDING", "A model write is unfinished; wait for it, or retry the original write command after interruption", {
      operation: operation.kind, record: statePath(root)
    });
  }
  return operation ? `${operation.operationId}:${operation.phase}` : "absent";
}
export async function assertModelOperationStamp(root: string, expected: string): Promise<void> {
  if (await readModelOperationStamp(root) !== expected) throw failure("MODEL_READ_CONFLICT", "Models changed while reading; retry the read command");
}
/** Only pure reads may retry; each attempt must rebuild its host from the current state. */
export async function withConsistentModelRead<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await read(); }
    catch (error) {
      if (attempt >= 2 || (error as { code?: string })?.code !== "MODEL_READ_CONFLICT") throw error;
    }
  }
}
export async function withProjectSettingsLock<T>(root: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const lock = join(root, ".runtime/settings.lock");
  await mkdir(dirname(lock), { recursive: true });
  return withNativeFileLock(lock, action, { signal });
}
export async function withProjectModelWrite<T>(root: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return withProjectSettingsLock(root, async () => {
    await recoverModelOperation(root);
    return action();
  }, signal);
}

/** The roots are derived from config, never accepted from the recovery record. */
async function allowedPaths(root: string, operation?: Operation) {
  const configPath = join(root, "config.json");
  const candidates: unknown[] = [];
  const bytes = await optionalFileBytes(configPath);
  if (bytes) candidates.push(JSON.parse(bytes.toString("utf8")));
  const changedConfig = operation?.changes.find(change => change.path === configPath);
  if (changedConfig) for (const side of [changedConfig.before, changedConfig.after]) {
    if (side !== null) candidates.push(JSON.parse(Buffer.from(side, "base64").toString("utf8")));
  }
  if (!candidates.length) candidates.push({});
  const roots = new Set<string>();
  for (const value of candidates) {
    if (!value || typeof value !== "object") throw new TypeError("Invalid Project config for recovery");
    const input = value as { modelsDirectory?: string; modelRegistration?: import("./model-registration-contract.js").ModelRegistrationConfig };
    const paths = await validateModelStoragePaths({ root, ...input });
    roots.add(paths.modelsDirectory); roots.add(paths.registrationDirectory);
  }
  return { configPath, roots: [...roots] };
}
async function assertAllowed(path: string, allowed: Awaited<ReturnType<typeof allowedPaths>>, directory = false) {
  const canonical = await canonicalPath(path);
  if (resolve(path) !== canonical) throw failure("MODEL_OPERATION_CONFLICT", `Symbolic link or path alias in model operation: ${path}`);
  if (path !== allowed.configPath && !allowed.roots.some(root => within(path, root) || directory && dirname(path) !== path && within(root, path)))
    throw failure("MODEL_OPERATION_DAMAGED", `Path outside model storage: ${path}`);
}
async function apply(path: string, bytes: Buffer | undefined) {
  if (bytes === undefined) await rm(path, { force: true });
  else await atomicWriteFile(path, bytes.toString("utf8"));
}

/** Caller owns settings lock. Never replays the interrupted business request. */
export async function recoverModelOperation(root: string, hooks: ModelOperationHooks = {}): Promise<void> {
  const operation = await readOperation(root);
  if (!operation || operation.phase === "committed" || operation.phase === "recovered") return;
  const allowed = await allowedPaths(root, operation);
  for (const change of operation.changes) await assertAllowed(change.path, allowed);
  operation.phase = "recovering";
  await atomicWriteJson(statePath(root), operation);
  await hooks.afterPending?.();
  for (const [index, change] of [...operation.changes].reverse().entries()) {
    const before = change.before === null ? undefined : Buffer.from(change.before, "base64");
    const after = change.after === null ? undefined : Buffer.from(change.after, "base64");
    const current = await optionalFileBytes(change.path);
    if (same(current, before)) continue;
    if (!same(current, after)) throw failure("MODEL_OPERATION_CONFLICT", `Recovery conflict; newer content preserved: ${change.path}`, { file: change.path, record: statePath(root) });
    await apply(change.path, before);
    await hooks.afterFile?.(index);
  }
  for (const path of [...operation.createdDirectories].reverse()) {
    await assertAllowed(path, allowed, true);
    try { await rmdir(path); }
    catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
  }
  operation.phase = "recovered";
  await atomicWriteJson(statePath(root), operation);
}

/** Preflight every path and conflict before publishing any pending state or target bytes. */
export async function commitModelOperation(root: string, kind: string, changes: ModelFileChange[], hooks: ModelOperationHooks = {}) {
  if (!changes.length) return;
  const operation: Operation = { version: 1, operationId: randomUUID(), root: resolve(root), kind, phase: "pending", changes: changes.map(change => ({
    path: resolve(change.path), before: change.before?.toString("base64") ?? null, after: change.after?.toString("base64") ?? null,
    beforeHash: digest(change.before), afterHash: digest(change.after)
  })), createdDirectories: [] };
  if (new Set(operation.changes.map(change => change.path)).size !== changes.length) throw new TypeError("Duplicate model operation paths");
  const allowed = await allowedPaths(root, operation);
  for (const change of changes) {
    await assertAllowed(resolve(change.path), allowed);
    if (!same(await optionalFileBytes(change.path), change.before)) throw failure("MODEL_OPERATION_CONFLICT", `Model write conflict: ${change.path}`);
    if (change.after !== undefined) {
      let path = dirname(change.path);
      const pending: string[] = [];
      while (true) {
        try { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError(`Not a model directory: ${path}`); break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        pending.push(path); path = dirname(path);
      }
      operation.createdDirectories.push(...pending.reverse().filter(path => !operation.createdDirectories.includes(path)));
    }
  }
  await atomicWriteJson(statePath(root), operation);
  try {
    await hooks.afterPending?.();
    for (const [index, change] of changes.entries()) {
      await assertAllowed(resolve(change.path), allowed);
      if (!same(await optionalFileBytes(change.path), change.before)) throw failure("MODEL_OPERATION_CONFLICT", `Model write conflict: ${change.path}`);
      if (change.after !== undefined) await mkdir(dirname(change.path), { recursive: true });
      await apply(change.path, change.after);
      await hooks.afterFile?.(index);
    }
    operation.phase = "committed";
    await atomicWriteJson(statePath(root), operation);
  } catch (error) {
    // Commit marker publication may have completed even if its final fsync reported an error.
    const saved = await readOperation(root);
    if (saved?.operationId === operation.operationId && saved.phase === "committed") return;
    try { await recoverModelOperation(root); }
    catch (cause) { throw failure("MODEL_RECOVERY_REQUIRED", "Model write failed and recovery requires attention", { record: statePath(root), error: String(error), recoveryError: String(cause) }); }
    throw error;
  }
}
