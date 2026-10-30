import { AsyncLocalStorage } from "node:async_hooks";
import { withConfigFileLock } from "../config-file-lock.js";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rm, rmdir, lstat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
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
    // Completed journals may move with a Project directory. Only an unfinished
    // record may act on its original absolute target paths.
    if (operation.root !== await canonicalPath(root) && ["pending", "recovering"].includes(operation.phase)) throw new TypeError("Wrong Project in unfinished operation record");
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
// This admission claim belongs only to the single recovery journal. It never
// waits, and kernel ownership disappears when the process exits. Keep the claim
// inode permanent: the journal itself is atomically replaced on every phase.
const maintenance = new AsyncLocalStorage<{ root: string; active: boolean }>();
async function withJournalClaim<T>(root: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  root = await canonicalPath(root);
  const parent = maintenance.getStore();
  if (parent?.active && parent.root === root) return action();
  const claim = join(root, ".runtime/model-operation.claim");
  await mkdir(dirname(claim), { recursive: true });
  let entered = false;
  try {
    return await withNativeFileLock(claim, async () => {
      entered = true;
      const scope = { root, active: true };
      try { return await maintenance.run(scope, action); }
      finally { scope.active = false; }
    }, { timeoutMs: 0, signal });
  } catch (error) {
    if (!entered && (error as { code?: string }).code === "LOCK_TIMEOUT")
      throw failure("MODEL_OPERATION_BUSY", "A model maintenance operation or recovery is running; retry after it finishes", { record: statePath(root) });
    throw error;
  }
}
/** Claim journal execution before recovery and preflight; overlapping requests fail immediately. */
export async function withModelMaintenance<T>(root: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return withJournalClaim(root, async () => {
    await recoverModelOperation(root);
    return action();
  }, signal);
}

/** The roots are derived from config, never accepted from the recovery record. */
async function allowedPaths(root: string, operation?: Operation) {
  root = await canonicalPath(root);
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
  let contextRunRoot: string | undefined;
  for (const value of candidates) {
    if (!value || typeof value !== "object") throw new TypeError("Invalid Project config for recovery");
    const input = value as { modelsDirectory?: string; modelRegistration?: import("./model-registration-contract.js").ModelRegistrationConfig };
    const paths = await validateModelStoragePaths({ root, ...input });
    roots.add(paths.modelsDirectory); roots.add(paths.registrationDirectory);
    if (operation?.kind === "context-control.outputs-upgrade") {
      const binding = (value as { dataStores?: Record<string, { kind?: string; factory?: string; model?: string; config?: { directory?: string } }> }).dataStores?.["context_control/runs"];
      if (binding?.kind !== "value" || binding.factory !== "memsphere/filesystem-json" || binding.model !== "memsphere/context_control/run.json" || !binding.config?.directory) throw failure("MODEL_OPERATION_DAMAGED", "Invalid context Run upgrade binding");
      contextRunRoot = await canonicalPath(resolve(root, binding.config.directory));
      roots.add(contextRunRoot);
    }
  }
  return { configPath, roots: [...roots], contextRunRoot };
}
async function assertAllowed(path: string, allowed: Awaited<ReturnType<typeof allowedPaths>>, directory = false) {
  const canonical = await canonicalPath(path);
  if (resolve(path) !== canonical) throw failure("MODEL_OPERATION_CONFLICT", `Symbolic link or path alias in model operation: ${path}`);
  if (allowed.contextRunRoot && within(path, allowed.contextRunRoot) && !directory) {
    const name = relative(allowed.contextRunRoot, path).replaceAll("\\", "/");
    if (!name.endsWith(".json") || name.split("/").some(segment => segment.startsWith(".memsphere-"))) throw failure("MODEL_OPERATION_DAMAGED", `Not a context Run record: ${path}`);
  }
  if (path !== allowed.configPath && !allowed.roots.some(root => within(path, root) || directory && dirname(path) !== path && within(root, path)))
    throw failure("MODEL_OPERATION_DAMAGED", `Path outside model storage: ${path}`);
}
async function apply(path: string, bytes: Buffer | undefined) {
  if (bytes === undefined) await rm(path, { force: true });
  else await atomicWriteFile(path, bytes.toString("utf8"));
}

/** Recovery claims the same journal as writers. Never replays the interrupted request. */
export async function recoverModelOperation(root: string, hooks: ModelOperationHooks = {}): Promise<void> {
  return withJournalClaim(root, async () => {
    const operation = await readOperation(root);
    const configPath = await canonicalPath(join(root, "config.json"));
    const execute = () => recoverModelOperationUnlocked(root, hooks);
    return operation?.changes.some(change => change.path === configPath)
      ? withConfigFileLock(join(root, "config.json"), execute) : execute();
  });
}
async function recoverModelOperationUnlocked(root: string, hooks: ModelOperationHooks): Promise<void> {
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
export async function commitModelOperation(root: string, kind: string, changes: ModelFileChange[], hooks: ModelOperationHooks = {}): Promise<void> {
  return withJournalClaim(root, async () => {
    await recoverModelOperation(root);
    const configPath = resolve(root, "config.json");
    const execute = () => commitModelOperationUnlocked(root, kind, changes, hooks);
    return changes.some(change => resolve(change.path) === configPath)
      ? withConfigFileLock(configPath, execute) : execute();
  });
}
async function commitModelOperationUnlocked(root: string, kind: string, changes: ModelFileChange[], hooks: ModelOperationHooks) {
  if (!changes.length) return;
  // The Registry root is trusted and may have an aliased ancestor (e.g. macOS
  // /var -> /private/var). Normalize that prefix only; aliases inside model
  // storage must still fail assertAllowed rather than redirecting a write.
  const configuredRoot = resolve(root);
  root = await canonicalPath(root);
  changes = changes.map(change => ({ ...change, path: within(resolve(change.path), configuredRoot)
    ? resolve(root, relative(configuredRoot, resolve(change.path))) : resolve(change.path) }));
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
    try { await recoverModelOperationUnlocked(root, {}); }
    catch (cause) { throw failure("MODEL_RECOVERY_REQUIRED", "Model write failed and recovery requires attention", { record: statePath(root), error: String(error), recoveryError: String(cause) }); }
    throw error;
  }
}
