import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Context } from "../data/api/context.js";
import { atomicPublish, readFileSnapshot, validateFilename } from "../data/extensions/shared/filesystem.js";
import { atomicWriteJson } from "../persistence.js";
import { readBundledMarketModelPackages } from "../reserved/models.js";
import { exampleRelocationBaseline } from "./example-relocation-baseline.js";
import { projectConfigSchema, projectManifestSchema } from "./model.js";
import { readModelRegistrations, withModelRegistrationLock } from "./model-registration.js";
import type { ProjectModelInput } from "./model-registration-contract.js";
import { validateModelStoragePaths, assertModelPath, discoverModelIds, canonicalPath } from "./model-storage-paths.js";
import { createProjectModelHost } from "./models.js";
import { collectExternalSchemaReferences } from "./model-schema-references.js";

export { exampleRelocationBaseline } from "./example-relocation-baseline.js";
const CHANGE = "20261003-model-catalogs";
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const planSchema = z.object({
  version: z.literal(1), operationId: z.string().uuid(), createdAt: z.string().datetime(),
  project: z.object({ name: z.literal("memsphere"), root: z.string() }).strict(),
  configDigest: digestSchema, projectManifestDigest: digestSchema,
  paths: z.object({ modelsDirectory: z.string(), registrationDirectory: z.string(), backupDirectory: z.string(), excludedDirectories: z.array(z.string()) }).strict(),
  targets: z.array(z.object({ modelRef: z.string(), definitionDigest: digestSchema, recordId: z.string(), recordDigest: digestSchema }).strict()).length(8),
  marketDigest: digestSchema, preservedDigest: digestSchema
}).strict();
export type ExampleRelocationPlan = z.infer<typeof planSchema>;
export type ExampleRelocationTarget = { name: string; root: string };
type Paths = Awaited<ReturnType<typeof validateModelStoragePaths>>;
type FileEntry = { modelRef: string; kind: "definition" | "registration"; original: string; backup: string; digest: string };
type Backup = { root: string; plan: ExampleRelocationPlan; entries: FileEntry[] };
export type RelocationReceipt = { status: "applied" | "unchanged" | "restored" | "failed"; backup: string; operationId: string; restoreCommand: string; [key: string]: unknown };
/** Failure hooks are private test seams, never supplied by the maintenance CLI. */
export type ExampleRelocationHooks = {
  afterBackup?: (backup: string) => Promise<void>;
  afterRehearsal?: (backup: string) => Promise<void>;
  beforeMove?: (index: number, path: string) => Promise<void>;
  afterMove?: (index: number, path: string) => Promise<void>;
  beforeRestore?: (index: number, path: string) => Promise<void>;
};
function digest(bytes: string | Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function failure(message: string, details: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { code: "EXAMPLE_RELOCATION_CONFLICT", ...details });
}
async function optionalBytes(path: string): Promise<Buffer | undefined> {
  try {
    const snapshot = await readFileSnapshot({}, dirname(path), basename(path));
    return snapshot && Buffer.from(snapshot.bytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
async function bytes(path: string): Promise<Buffer> {
  const result = await optionalBytes(path);
  if (!result) throw failure(`Missing relocation file: ${path}`);
  return result;
}
async function publish(path: string, content: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await atomicPublish({}, dirname(path), basename(path), content, "create");
}
function parsePlan(value: unknown): ExampleRelocationPlan {
  const plan = planSchema.parse(value);
  if (plan.project.root !== resolve(plan.project.root)) throw failure("Project root must be absolute");
  const recordIds = new Set<string>();
  for (const [index, target] of plan.targets.entries()) {
    const baseline = exampleRelocationBaseline[index]!;
    validateFilename(`${target.recordId}.json`);
    if (target.modelRef !== baseline.modelRef || target.definitionDigest !== baseline.sourceDigest || recordIds.has(target.recordId)) {
      throw failure("Relocation plan does not match the fixed eight-model baseline");
    }
    recordIds.add(target.recordId);
  }
  return plan;
}
function marketSources() {
  const pack = readBundledMarketModelPackages().find(pack => pack.id === "memsphere.examples");
  if (!pack || pack.models.length !== 8) throw failure("The complete example market package is required before relocation");
  const sources = exampleRelocationBaseline.map(baseline => {
    const model = pack.models.find(model => model.registration.modelRef === baseline.modelRef);
    if (!model || digest(model.source) !== baseline.sourceDigest) throw failure(`Market source differs from approved example: ${baseline.modelRef}`);
    return model;
  });
  return { sources, digest: digest(JSON.stringify(sources.map(model => [model.registration.modelRef, digest(model.source)]))) };
}
async function readTarget(target: ExampleRelocationTarget) {
  if (target.name !== "memsphere") throw failure("This one-time maintenance operation only targets Project memsphere");
  const root = await realpath(target.root);
  const manifestBytes = await bytes(join(root, "project.json"));
  const manifest = projectManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  if (manifest.name !== target.name) throw failure("Project manifest identity changed");
  const configBytes = await bytes(join(root, "config.json"));
  const config = projectConfigSchema.parse(JSON.parse(configBytes.toString("utf8")));
  const input: ProjectModelInput = { root, modelsDirectory: config.modelsDirectory, modelRegistration: config.modelRegistration };
  return { input, paths: await validateModelStoragePaths(input), configDigest: digest(configBytes), projectManifestDigest: digest(manifestBytes) };
}
async function treeFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw failure(`Unsupported model storage entry: ${path}`);
    if (entry.isDirectory()) result.push(...await treeFiles(path));
    else result.push(path);
  }
  return result;
}
function fileEntries(plan: ExampleRelocationPlan, backupRoot: string, paths = plan.paths): FileEntry[] {
  return plan.targets.flatMap(target => [
    { modelRef: target.modelRef, kind: "definition" as const, original: join(paths.modelsDirectory, target.modelRef), backup: join(backupRoot, "definitions", target.modelRef), digest: target.definitionDigest },
    { modelRef: target.modelRef, kind: "registration" as const, original: join(paths.registrationDirectory, "project", `${target.recordId}.json`), backup: join(backupRoot, "registrations", `${target.recordId}.json`), digest: target.recordDigest }
  ]);
}
async function preservedDigest(paths: Paths, targets: ExampleRelocationPlan["targets"]): Promise<string> {
  const excluded = new Set(fileEntries({ targets, paths } as ExampleRelocationPlan, "").map(entry => entry.original));
  const ids = await discoverModelIds({}, paths.modelsDirectory, paths.excludedDirectories);
  const pathsToHash = [...ids.map(id => join(paths.modelsDirectory, id)), ...await treeFiles(paths.registrationDirectory)].filter(path => !excluded.has(path));
  return digest(JSON.stringify(await Promise.all([...new Set(pathsToHash)].sort().map(async path => [path, digest(await bytes(path))]))));
}
async function assertNoRetainedReferences(context: Context, input: ProjectModelInput): Promise<void> {
  const host = await createProjectModelHost(context, input);
  const targetRefs = new Set(exampleRelocationBaseline.map(item => item.modelRef));
  for (const summary of await host.list()) {
    if (targetRefs.has(summary.id)) continue;
    if (summary.status !== "available") throw failure(`Cannot inspect retained model: ${summary.id}`);
    if (summary.metaModel !== "json-schema/draft-07") continue;
    const model = await host.definition(summary.id);
    const refs = collectExternalSchemaReferences(model.definition, model.id).filter(ref => targetRefs.has(ref));
    if (refs.length) throw failure(`Retained model ${summary.id} depends on examples: ${refs.join(", ")}`, { modelRef: summary.id, references: refs });
  }
}
async function inspect(context: Context, target: ExampleRelocationTarget, identity: { operationId: string; createdAt: string }): Promise<ExampleRelocationPlan> {
  const current = await readTarget(target);
  const state = await readModelRegistrations(context, current.input);
  if (state.diagnostics.length) throw failure("Cannot relocate damaged or duplicate model registrations", { diagnostics: state.diagnostics });
  const targets: ExampleRelocationPlan["targets"] = [];
  for (const baseline of exampleRelocationBaseline) {
    const matches = state.records.filter(record => record.registration.modelRef === baseline.modelRef);
    const record = matches[0];
    if (matches.length !== 1 || !record || record.origin !== "project" || !isDeepStrictEqual(record.registration, baseline.registration)) {
      throw failure(`Example registration differs from the approved baseline: ${baseline.modelRef}`);
    }
    await assertModelPath(current.paths.modelsDirectory, baseline.modelRef, current.paths.excludedDirectories);
    const source = await bytes(join(current.paths.modelsDirectory, baseline.modelRef));
    if (digest(source) !== baseline.sourceDigest) throw failure(`Example definition differs from the approved bytes: ${baseline.modelRef}`);
    targets.push({ modelRef: baseline.modelRef, definitionDigest: baseline.sourceDigest, recordId: record.id,
      recordDigest: digest(await bytes(join(current.paths.registrationDirectory, "project", `${record.id}.json`))) });
  }
  await assertNoRetainedReferences(context, current.input);
  return parsePlan({ version: 1, ...identity, project: { name: target.name, root: current.input.root },
    configDigest: current.configDigest, projectManifestDigest: current.projectManifestDigest, paths: current.paths,
    targets, marketDigest: marketSources().digest, preservedDigest: await preservedDigest(current.paths, targets) });
}
/** Read-only: planning never initializes models, creates directories, or changes a Project. */
export async function planExampleRelocation(context: Context, target: ExampleRelocationTarget): Promise<ExampleRelocationPlan> {
  return inspect(context, target, { operationId: randomUUID(), createdAt: new Date().toISOString() });
}
async function assertTargetMapping(plan: ExampleRelocationPlan) {
  const current = await readTarget(plan.project);
  if (current.configDigest !== plan.configDigest || current.projectManifestDigest !== plan.projectManifestDigest
    || !isDeepStrictEqual(current.paths, plan.paths) || current.input.root !== plan.project.root) throw failure("Project identity, configuration or storage mapping changed since the plan");
  return current;
}
async function loadBackup(backupRoot: string, requireAllMoved = false): Promise<Backup> {
  const root = await realpath(backupRoot);
  const plan = parsePlan(JSON.parse((await bytes(join(root, "manifest.json"))).toString("utf8")));
  const expected = join(plan.paths.backupDirectory, CHANGE, plan.operationId);
  if (root !== await canonicalPath(expected)) throw failure("Backup location does not match its original operation");
  const entries = fileEntries(plan, root);
  for (const [index, entry] of entries.entries()) {
    const source = await bytes(entry.backup);
    if (digest(source) !== entry.digest) throw failure(`Backup checksum failed: ${entry.backup}`);
    const movedOriginal = await optionalBytes(join(root, "removed", String(index)));
    if (requireAllMoved && movedOriginal === undefined) throw failure(`Moved original is missing: ${join(root, "removed", String(index))}`);
    if (movedOriginal && digest(movedOriginal) !== entry.digest) {
      throw failure(`Moved original has changed; preserve it for manual recovery: ${join(root, "removed", String(index))}`);
    }
    if (entry.kind === "registration") {
      const target = plan.targets.find(target => target.modelRef === entry.modelRef)!;
      const record = JSON.parse(source.toString("utf8"));
      if (record.id !== target.recordId || !isDeepStrictEqual(record.value, exampleRelocationBaseline.find(item => item.modelRef === entry.modelRef)!.registration)) throw failure(`Backup registration identity failed: ${entry.modelRef}`);
    }
  }
  return { root, plan, entries };
}
async function assertRestorePreflight(entries: FileEntry[]): Promise<void> {
  const conflicts: string[] = [];
  for (const entry of entries) {
    // Reject symlink ancestors, including ones created after the original operation.
    if (await canonicalPath(entry.original) !== entry.original) throw failure(`Restore path is no longer canonical: ${entry.original}`);
    const existing = await optionalBytes(entry.original);
    if (existing && digest(existing) !== entry.digest) conflicts.push(entry.original);
  }
  if (conflicts.length) throw failure(`Restore would overwrite different content: ${conflicts.join(", ")}`, { conflicts });
}
async function assertRestoreRegistrations(backup: Backup, modelRef?: string): Promise<void> {
  const current = await readTarget(backup.plan.project);
  const state = await readModelRegistrations({}, current.input);
  if (state.diagnostics.length) throw failure("Cannot restore into damaged or duplicate registrations", { diagnostics: state.diagnostics });
  for (const record of state.records) {
    const target = backup.plan.targets.find(target => target.modelRef === record.registration.modelRef && (modelRef === undefined || target.modelRef === modelRef));
    if (target && (record.origin !== "project" || record.id !== target.recordId)) {
      throw failure(`Restore model identity is already registered elsewhere: ${target.modelRef}`);
    }
  }
}
/** Shared by real recovery and the mandatory isolated rehearsal. */
async function restoreEntries(backup: Backup, entries = backup.entries, hooks: ExampleRelocationHooks = {}) {
  await assertRestorePreflight(entries);
  const restored: string[] = [];
  for (const [index, entry] of entries.entries()) {
    await hooks.beforeRestore?.(index, entry.original);
    const content = await bytes(entry.backup);
    if (digest(content) !== entry.digest) throw failure(`Backup changed during restore: ${entry.backup}`);
    const existing = await optionalBytes(entry.original);
    if (existing) {
      if (digest(existing) !== entry.digest) throw failure(`Restore conflict: ${entry.original}`);
      continue;
    }
    if (await canonicalPath(entry.original) !== entry.original) throw failure(`Restore path changed: ${entry.original}`);
    await publish(entry.original, content);
    restored.push(entry.original);
    if (digest(await bytes(entry.original)) !== entry.digest) throw failure(`Restored file verification failed: ${entry.original}`);
  }
  return restored;
}
async function rehearse(backup: Backup): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "memsphere-example-restore-"));
  try {
    const input = { root };
    const paths = await validateModelStoragePaths(input);
    const entries = fileEntries(backup.plan, backup.root, paths);
    await restoreEntries(backup, entries);
    const state = await readModelRegistrations({}, input);
    if (state.diagnostics.length || state.records.length !== 8) throw failure("Isolated restore did not recover exactly eight valid registrations");
    const host = await createProjectModelHost({}, input);
    for (const item of backup.plan.targets) {
      const model = await host.definition(item.modelRef);
      if (model.origin !== "project" || digest(model.source) !== item.definitionDigest) throw failure(`Isolated restore failed: ${item.modelRef}`);
    }
    const references = collectExternalSchemaReferences((await host.definition("examples/06-references-and-recursion.json")).definition, "examples/06-references-and-recursion.json");
    if (!references.includes("examples/07-scalar-enum-root.json")) throw failure("Isolated restore lost the 06 to 07 reference");
    for (const entry of entries) if (digest(await bytes(entry.original)) !== entry.digest) throw failure(`Isolated restore byte mismatch: ${entry.modelRef}`);
  } finally { await rm(root, { recursive: true, force: true }); }
}
function restoreCommand(backup: string): string {
  const script = fileURLToPath(new URL("../../scripts/relocate-example-models.mjs", import.meta.url));
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return `node ${quote(script)} restore --backup ${quote(backup)}`;
}
async function receipt(backup: string, plan: ExampleRelocationPlan, status: RelocationReceipt["status"], extra: Record<string, unknown> = {}): Promise<RelocationReceipt> {
  const result = { status, backup, operationId: plan.operationId, restoreCommand: restoreCommand(backup), at: new Date().toISOString(), ...extra };
  await atomicWriteJson(join(backup, "receipt.json"), result);
  return result;
}
/** Explicit, fixed-scope write. Callers never invoke this from model discovery or Project creation. */
export async function applyExampleRelocation(context: Context, value: unknown, hooks: ExampleRelocationHooks = {}): Promise<RelocationReceipt> {
  const plan = parsePlan(value);
  await assertTargetMapping(plan);
  return withModelRegistrationLock(plan.project.root, async () => {
    const backupRoot = join(plan.paths.backupDirectory, CHANGE, plan.operationId);
    const current = await assertTargetMapping(plan);
    const previousReceipt = await optionalBytes(join(backupRoot, "receipt.json"));
    if (previousReceipt) {
      const previous = JSON.parse(previousReceipt.toString("utf8"));
      const saved = await loadBackup(backupRoot);
      if (!isDeepStrictEqual(saved.plan, plan)) throw failure("Backup belongs to a different plan");
      if (previous.status === "applied" && marketSources().digest === plan.marketDigest && await preservedDigest(current.paths, plan.targets) === plan.preservedDigest
        && (await Promise.all(saved.entries.map(entry => optionalBytes(entry.original)))).every(value => value === undefined)) {
        return { ...previous, status: "unchanged" } as RelocationReceipt;
      }
      throw failure(`Operation already has a receipt; inspect or restore before preparing another plan: ${backupRoot}`, { backup: backupRoot });
    }
    const latest = await inspect(context, plan.project, plan);
    if (!isDeepStrictEqual(latest, plan)) throw failure("Models or registrations changed since planning");
    const backupParent = join(plan.paths.backupDirectory, CHANGE);
    await mkdir(backupParent, { recursive: true });
    if (await canonicalPath(backupParent) !== backupParent) throw failure("Backup parent path changed");
    const sourceEntries = fileEntries(plan, backupRoot);
    const device = (await lstat(backupParent)).dev;
    for (const entry of sourceEntries) if ((await lstat(entry.original)).dev !== device) throw failure("Relocation requires source and backup on the same filesystem");
    await mkdir(backupRoot, { mode: 0o700 });
    const journal: { at: string; phase: string; index?: number; path?: string }[] = [];
    const log = async (phase: string, index?: number, path?: string) => {
      journal.push({ at: new Date().toISOString(), phase, ...(index === undefined ? {} : { index }), ...(path ? { path } : {}) });
      await atomicWriteJson(join(backupRoot, "operation-log.json"), journal);
    };
    let backup: Backup | undefined;
    let hasMoved = false;
    try {
      await atomicWriteJson(join(backupRoot, "manifest.json"), plan);
      for (const entry of sourceEntries) {
        const source = await bytes(entry.original);
        if (digest(source) !== entry.digest) throw failure(`Source changed before backup: ${entry.original}`);
        await publish(entry.backup, source);
      }
      await hooks.afterBackup?.(backupRoot);
      backup = await loadBackup(backupRoot);
      await log("backup-verified");
      await rehearse(backup);
      await log("isolated-restore-passed");
      await hooks.afterRehearsal?.(backupRoot);
      const beforeMove = await inspect(context, plan.project, plan);
      if (!isDeepStrictEqual(beforeMove, plan)) throw failure("Project changed during backup or restore rehearsal");
      // Every source is retained twice: immutable backup plus moved original; no original file is unlinked.
      await mkdir(join(backupRoot, "removed"));
      for (const [index, entry] of backup.entries.entries()) {
        context.signal?.throwIfAborted();
        await hooks.beforeMove?.(index, entry.original);
        await assertTargetMapping(plan);
        if (await canonicalPath(entry.original) !== entry.original || digest(await bytes(entry.original)) !== entry.digest) throw failure(`Source changed before relocation: ${entry.original}`);
        const destination = join(backupRoot, "removed", String(index));
        await log("moving", index, entry.original);
        await rename(entry.original, destination);
        hasMoved = true;
        if (digest(await bytes(destination)) !== entry.digest) throw failure(`Source changed while relocating; moved original is preserved at ${destination}`);
        await log("moved", index, entry.original);
        await hooks.afterMove?.(index, entry.original);
      }
      await assertTargetMapping(plan);
      if (await preservedDigest(current.paths, plan.targets) !== plan.preservedDigest) throw failure("Retained model content changed during relocation");
      if ((await Promise.all(backup.entries.map(entry => optionalBytes(entry.original)))).some(value => value !== undefined)) throw failure("A removed model reappeared during relocation");
      if (marketSources().digest !== plan.marketDigest) throw failure("Market assets changed during relocation");
      // An external writer can retain an open handle across rename and change an earlier
      // moved original while later files are processed. Recheck the whole recovery set.
      await loadBackup(backupRoot, true);
      await log("complete");
      return await receipt(backupRoot, plan, "applied", { modelRefs: plan.targets.map(item => item.modelRef), rehearsalPassed: true, preservedDigest: plan.preservedDigest });
    } catch (error) {
      const rollbackErrors: string[] = [];
      if (hasMoved && backup) {
        // Roll back all target pairs in reverse order, preserving concurrent different content.
        for (const entry of [...backup.entries].reverse()) {
          try {
            // Another writer may register this identity after its original record moved.
            // Do not restore either member of that pair behind a new registration owner.
            await assertRestoreRegistrations(backup, entry.modelRef);
            const movedPath = join(backupRoot, "removed", String(backup.entries.indexOf(entry)));
            const moved = await optionalBytes(movedPath);
            if (moved && digest(moved) !== entry.digest) throw failure(`Moved original changed; preserve for manual recovery: ${movedPath}`);
            await restoreEntries(backup, [entry], hooks);
          }
          catch (rollbackError) { rollbackErrors.push(`${entry.original}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`); }
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      const details = { error: message, rollbackErrors, originalFilesMoved: hasMoved, rollbackComplete: rollbackErrors.length === 0 };
      try { await log("failed"); await receipt(backupRoot, plan, "failed", details); }
      catch (receiptError) { rollbackErrors.push(`Failed to persist receipt: ${String(receiptError)}`); }
      throw Object.assign(new Error(`Example relocation failed: ${message}; backup: ${backupRoot}${rollbackErrors.length ? `; recovery required: ${rollbackErrors.join("; ")}` : ""}`),
        { code: "EXAMPLE_RELOCATION_FAILED", backup: backupRoot, restoreCommand: restoreCommand(backupRoot), rollbackErrors, cause: error });
    }
  });
}
/** Restores exact original record envelopes; never overwrites newer content or restores global configuration. */
export async function restoreExampleRelocation(context: Context, backupRoot: string, hooks: ExampleRelocationHooks = {}): Promise<RelocationReceipt> {
  const initial = await loadBackup(backupRoot).catch(error => {
    throw Object.assign(error, { backup: resolve(backupRoot), restoreCommand: restoreCommand(resolve(backupRoot)) });
  });
  await assertTargetMapping(initial.plan);
  return withModelRegistrationLock(initial.plan.project.root, async () => {
    try {
      context.signal?.throwIfAborted();
      const backup = await loadBackup(backupRoot);
      await assertTargetMapping(backup.plan);
      await assertRestoreRegistrations(backup);
      const restored = await restoreEntries(backup, backup.entries, hooks);
      const state = await readModelRegistrations({}, (await readTarget(backup.plan.project)).input);
      if (state.diagnostics.length) throw failure("Restored Project has registration diagnostics", { diagnostics: state.diagnostics });
      for (const entry of backup.entries) if (digest(await bytes(entry.original)) !== entry.digest) throw failure(`Restore verification failed: ${entry.original}`);
      const result = await receipt(backup.root, backup.plan, "restored", { restored, unchanged: restored.length === 0 });
      await atomicWriteJson(join(backup.root, "recovery-receipt.json"), result);
      return result;
    } catch (error) {
      const details = { status: "failed", phase: "restore", at: new Date().toISOString(), backup: initial.root,
        error: error instanceof Error ? error.message : String(error), restoreCommand: restoreCommand(initial.root) };
      await atomicWriteJson(join(initial.root, "recovery-receipt.json"), details).catch(() => undefined);
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { backup: initial.root, restoreCommand: details.restoreCommand });
    }
  });
}
