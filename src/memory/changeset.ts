import { createHash, randomBytes } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { atomicWriteJson, withFileLock } from "../persistence.js";
import { gitOutput, gitOutputRaw, runGit } from "../git.js";
import { memoryKinds, type MemoryKind } from "./kinds.js";
import { readAllMemoryFiles } from "./store.js";
import { currentMemorySyntax } from "./syntax.js";
import { serializeMemoryYaml } from "./serializer.js";
import { validateMemoryRoot, type ValidationIssue } from "../validation.js";
import { resolveProjectContext, type ResolvedProject } from "../project/resolver.js";
import { resolveWorkspaceIdentity, type WorkspaceIdentity } from "../project/workspace.js";
import { projectConfigSchema } from "../project/model.js";
import { GitRevisionMemoryProvider } from "./git-provider.js";
import {
  assertCanonicalMemoryName,
  normalizeMemoryName,
  parseLogicalMemoryReference
} from "./logical-reference.js";

const changeTargetSchema = z.object({
  operation: z.enum(["create", "update", "delete", "rename"]),
  reference: z.string().min(1),
  path: z.string().min(1).refine(isSafeMemoryPath, "invalid or escaping Memory path"),
  destination_path: z.string().min(1).refine(isSafeMemoryPath, "invalid or escaping Memory path").optional(),
  base_digest: z.string().min(1).optional(),
  added_revision: z.string().min(1)
}).strict();

const persistedValidationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  migration: z.string().optional()
}).strict();

const changeCheckpointSchema = z.object({
  digest: z.string().min(1),
  base_revision: z.string().min(1),
  created_at: z.string().datetime(),
  valid: z.boolean(),
  issues: z.array(persistedValidationIssueSchema)
}).strict();

const sourceWorktreeSchema = z.object({
  instance_key: z.string().min(1),
  root: z.string().min(1),
  repository_root: z.string().min(1),
  memory_path: z.string().min(1)
}).strict();

export const memoryChangeSetSchema = z.object({
  format_version: z.literal(1),
  id: z.string().min(1),
  project: z.string().min(1),
  workspace_key: z.string().min(1),
  base_revision: z.string().min(1),
  status: z.enum(["draft", "published"]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  published_revision: z.string().min(1).optional(),
  merge_parent: z.string().min(1).optional(),
  store_type: z.enum(["managed", "embedded"]).optional(),
  source_worktree: sourceWorktreeSchema.optional(),
  checkpoint: changeCheckpointSchema.optional(),
  targets: z.array(changeTargetSchema)
}).strict();

export type MemoryChangeSet = z.infer<typeof memoryChangeSetSchema>;
export type MemoryChangeOperation = z.infer<typeof changeTargetSchema>["operation"];

export type MemoryChangeValidationResult = {
  changeId: string;
  memoryRoot: string;
  candidateRoot: string;
  storeType: "managed" | "embedded";
  baseRevision: string;
  checkpointDigest: string;
  issues: ValidationIssue[];
};

export type MemoryChangePreview = {
  change: MemoryChangeSet;
  memoryRoot: string;
};

type PreparedMemoryChangePreview = {
  cacheKey: string;
  changeKey: string;
  change: MemoryChangeSet;
  project: ResolvedProject;
  candidateRoot: string;
};

type CachedMemoryChangePreview = {
  preview: MemoryChangePreview;
  refs: number;
  stale: boolean;
  lastUsed: number;
};

export class MemoryChangePreviewCache {
  readonly #entries = new Map<string, CachedMemoryChangePreview>();
  readonly #pending = new Map<string, Promise<CachedMemoryChangePreview>>();

  constructor(readonly maxEntries = 4) {}

  async use<T>(input: {
    home?: string;
    project: string;
    changeId: string;
    use: (preview: MemoryChangePreview) => Promise<T>;
  }): Promise<T> {
    const prepared = await prepareMemoryChangePreview(input);
    await this.#invalidateOlderVersions(prepared.changeKey, prepared.cacheKey);
    let entry = this.#entries.get(prepared.cacheKey);
    if (!entry) {
      let pending = this.#pending.get(prepared.cacheKey);
      if (!pending) {
        pending = materializePreparedMemoryChangePreview(prepared).then((preview) => ({
          preview,
          refs: 0,
          stale: false,
          lastUsed: Date.now()
        }));
        this.#pending.set(prepared.cacheKey, pending);
      }
      try {
        entry = await pending;
        this.#entries.set(prepared.cacheKey, entry);
      } finally {
        if (this.#pending.get(prepared.cacheKey) === pending) this.#pending.delete(prepared.cacheKey);
      }
      await this.#evictOverflow();
    }
    entry.preview = { ...entry.preview, change: prepared.change };
    entry.refs += 1;
    entry.lastUsed = Date.now();
    try {
      return await input.use(entry.preview);
    } finally {
      entry.refs -= 1;
      if (entry.stale && entry.refs === 0) await removeCachedMemoryChangePreview(entry);
    }
  }

  async clear(): Promise<void> {
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    for (const entry of entries) {
      entry.stale = true;
      if (entry.refs === 0) await removeCachedMemoryChangePreview(entry);
    }
  }

  async dispose(): Promise<void> {
    await this.clear();
  }

  async #invalidateOlderVersions(changeKey: string, currentKey: string): Promise<void> {
    for (const [key, entry] of this.#entries) {
      if (key === currentKey || !key.startsWith(`${changeKey}\0`)) continue;
      this.#entries.delete(key);
      entry.stale = true;
      if (entry.refs === 0) await removeCachedMemoryChangePreview(entry);
    }
  }

  async #evictOverflow(): Promise<void> {
    if (this.#entries.size <= this.maxEntries) return;
    const candidates = [...this.#entries.entries()].sort((left, right) => left[1].lastUsed - right[1].lastUsed);
    for (const [key, entry] of candidates) {
      if (this.#entries.size <= this.maxEntries) break;
      this.#entries.delete(key);
      entry.stale = true;
      if (entry.refs === 0) await removeCachedMemoryChangePreview(entry);
    }
  }
}

export async function withMemoryChangePreview<T>(input: {
  home?: string;
  project: string;
  changeId: string;
  use: (preview: MemoryChangePreview) => Promise<T>;
}): Promise<T> {
  const prepared = await prepareMemoryChangePreview(input);
  const preview = await materializePreparedMemoryChangePreview(prepared);
  try {
    return await input.use(preview);
  } finally {
    await rm(preview.memoryRoot, { recursive: true, force: true });
  }
}

async function prepareMemoryChangePreview(input: {
  home?: string;
  project: string;
  changeId: string;
}): Promise<PreparedMemoryChangePreview> {
  const context = await resolveProjectContext({ home: input.home, project: input.project });
  const change = await readChange(context.primary, input.changeId);
  if (change.project !== context.primary.name) throw new Error(`ChangeSet belongs to Project "${change.project}"`);
  if (!change.checkpoint) throw new Error(`ChangeSet ${change.id} has no validated checkpoint`);
  const candidateRoot = checkpointMemoryRoot(context.primary, change.id, change.checkpoint.digest);
  if (!await exists(candidateRoot)) throw new Error(`ChangeSet checkpoint is missing: ${change.id}`);
  if (await checkpointDigest(change.targets, candidateRoot) !== change.checkpoint.digest) {
    throw new Error(`ChangeSet checkpoint digest does not match: ${change.id}`);
  }
  const changeKey = `${context.primary.memoryRoot}\0${change.id}`;
  return {
    cacheKey: `${changeKey}\0${change.checkpoint.digest}`,
    changeKey,
    change,
    project: context.primary,
    candidateRoot
  };
}

async function materializePreparedMemoryChangePreview(
  prepared: PreparedMemoryChangePreview
): Promise<MemoryChangePreview> {
  const { change, project, candidateRoot } = prepared;
  const staging = await mkdtemp(join(tmpdir(), "memsphere-view-change-"));
  try {
    if (changeStoreType(change) === "managed") {
      await materializeGitMemoryRoot(project.memoryRoot, change.checkpoint!.base_revision, ".", staging);
    } else {
      const source = change.source_worktree;
      if (!source) throw new Error(`Embedded ChangeSet ${change.id} has no source metadata`);
      await materializeGitMemoryRoot(source.repository_root, change.checkpoint!.base_revision, source.memory_path, staging);
    }
    await applyTargets(staging, candidateRoot, change.targets);
    return { change, memoryRoot: staging };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function removeCachedMemoryChangePreview(entry: CachedMemoryChangePreview): Promise<void> {
  await rm(entry.preview.memoryRoot, { recursive: true, force: true });
}

export async function editMemories(input: {
  references: string[];
  changeId?: string;
  operation?: "edit" | "delete";
  /** Internal-only storage paths for callers, such as bootstrap, that already own a stable path. */
  createPaths?: ReadonlyMap<string, string>;
}): Promise<{ change: MemoryChangeSet; candidateRoot: string }> {
  if (input.references.length === 0) throw new Error("provide at least one Memory reference");
  if (input.createPaths) {
    if (input.operation === "delete") throw new Error("explicit create paths cannot be used when deleting Memory");
    const references = new Set(input.references);
    for (const [reference, path] of input.createPaths) {
      if (!references.has(reference)) throw new Error(`explicit create path has no matching Memory reference: ${reference}`);
      assertSafeCreatePath(reference, path);
    }
  }
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  assertManaged(context.primary);
  const workspace = await resolveWorkspaceIdentity();
  const targets: Array<z.infer<typeof changeTargetSchema>> = [];
  for (const reference of input.references) {
    const createPath = input.createPaths?.get(reference);
    targets.push(await resolveTarget(
      context.primary,
      reference,
      input.operation === "delete" ? "delete" : "edit",
      createPath
    ));
  }
  const targetReferencesByPath = new Map<string, string>();
  for (const target of targets) {
    const existingReference = targetReferencesByPath.get(target.path);
    if (existingReference !== undefined && existingReference !== target.reference) {
      throw new Error(`Memory path is targeted by multiple references: ${target.path}`);
    }
    targetReferencesByPath.set(target.path, target.reference);
  }
  const change = input.changeId
    ? await readChange(context.primary, input.changeId)
    : await createChange(context.primary, workspace.key);
  assertDraftOwner(change, context.primary.name, workspace.key);
  const candidateRoot = workspaceCandidateRoot(workspace.path, change.id);
  await mkdir(candidateRoot, { recursive: true });

  for (const target of targets) {
    const existingTarget = change.targets.find((current) => current.path === target.path);
    if (existingTarget) {
      if (existingTarget.reference !== target.reference) {
        throw new Error(`Memory path is already targeted by ChangeSet: ${target.path}`);
      }
      continue;
    }
    change.targets.push(target);
    const source = join(context.primary.memoryRoot, target.path);
    const candidate = join(candidateRoot, target.path);
    await mkdir(dirname(candidate), { recursive: true });
    if (target.operation === "create") await writeFile(candidate, newMemoryTemplate(target.reference), "utf8");
    else await cp(source, candidate);
  }
  change.updated_at = new Date().toISOString();
  await writeChange(context.primary, change);
  return { change, candidateRoot };
}

export async function renameMemory(input: {
  reference: string;
  newName: string;
  changeId?: string;
}): Promise<{ change: MemoryChangeSet; candidateRoot: string }> {
  assertCanonicalMemoryName(input.newName);
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  assertManaged(context.primary);
  const workspace = await resolveWorkspaceIdentity();
  const change = input.changeId ? await readChange(context.primary, input.changeId) : await createChange(context.primary, workspace.key);
  assertDraftOwner(change, context.primary.name, workspace.key);
  const target = await resolveTarget(context.primary, input.reference, "rename");
  if (change.targets.some((current) => current.path === target.path)) throw new Error(`Memory is already targeted by ChangeSet: ${input.reference}`);
  change.targets.push(target);
  const file = (await readAllMemoryFiles(context.primary.memoryRoot)).find((item) => (
    relative(context.primary.memoryRoot, item.path).replaceAll("\\", "/") === target.path
  ));
  if (!file) throw new Error(`Memory was not found: ${input.reference}`);
  const newName = input.newName;
  file.entity.names = [...new Set([newName, ...file.entity.names])];
  const candidateRoot = workspaceCandidateRoot(workspace.path, change.id);
  const candidate = join(candidateRoot, target.path);
  await mkdir(dirname(candidate), { recursive: true });
  await writeFile(candidate, serializeMemoryYaml(file.entity), "utf8");
  change.updated_at = new Date().toISOString();
  await writeChange(context.primary, change);
  return { change, candidateRoot };
}

export async function checkpointWorkspaceChanges(): Promise<number> {
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  if (context.primary.config.store.type !== "managed") return 0;
  const workspace = await resolveWorkspaceIdentity();
  const workspaceChanges = resolve(workspace.path, ".memsphere-work", "changes");
  let entries;
  try {
    entries = await readdir(workspaceChanges, { withFileTypes: true });
  } catch (error) {
    if (isCode(error, "ENOENT")) return 0;
    throw error;
  }
  let saved = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const change = await readChange(context.primary, entry.name).catch(() => undefined);
    if (!change || change.status !== "draft" || change.workspace_key !== workspace.key) continue;
    const source = join(workspaceChanges, entry.name, "memory");
    if (!await exists(source)) continue;
    const recovery = recoveryRoot(context.primary, entry.name);
    const temporary = `${recovery}.saving-${process.pid}`;
    await rm(temporary, { recursive: true, force: true });
    await cp(source, temporary, { recursive: true });
    await rm(recovery, { recursive: true, force: true });
    await rename(temporary, recovery);
    saved += 1;
  }
  return saved;
}

export async function resumeMemoryChange(changeId: string): Promise<string> {
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  assertManaged(context.primary);
  const workspace = await resolveWorkspaceIdentity();
  const change = await readChange(context.primary, changeId);
  assertDraftOwner(change, context.primary.name, workspace.key);
  const recovery = recoveryRoot(context.primary, changeId);
  if (!await exists(recovery)) throw new Error(`ChangeSet ${changeId} has no Validate recovery copy`);
  const candidate = workspaceCandidateRoot(workspace.path, changeId);
  await rm(candidate, { recursive: true, force: true });
  await cp(recovery, candidate, { recursive: true });
  return candidate;
}

export async function publishMemoryChange(
  changeId: string,
  message?: string,
  options: { expectedKind?: "regular" | "sync" } = {}
): Promise<MemoryChangeSet> {
  const initialContext = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  assertManaged(initialContext.primary);
  const workspace = await resolveWorkspaceIdentity();
  return withFileLock(memoryMutationLock(initialContext.primary), async () => {
    const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
    assertManaged(context.primary);
    const change = await readChange(context.primary, changeId);
    assertDraftOwner(change, context.primary.name, workspace.key);
    if (options.expectedKind === "sync" && !change.merge_parent) {
      throw new Error(`ChangeSet ${change.id} is not a Sync ChangeSet`);
    }
    if (options.expectedKind === "regular" && change.merge_parent) {
      throw new Error(`ChangeSet ${change.id} is a Sync ChangeSet; use memsphere memory sync publish`);
    }
    const candidateRoot = workspaceCandidateRoot(workspace.path, changeId);
    if (!await exists(candidateRoot)) throw new Error(`ChangeSet candidate is missing: ${candidateRoot}`);
    return publishLocked(context.primary, change, candidateRoot, message);
  });
}

export async function validateMemoryChange(changeId?: string): Promise<MemoryChangeValidationResult> {
  const initialContext = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  const workspace = await resolveWorkspaceIdentity();
  return withFileLock(memoryMutationLock(initialContext.primary), async () => {
    const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
    if (context.primary.config.store.type === "managed") {
      await assertManagedHealthy(context.primary);
      const resolvedId = changeId ?? await resolveSingleManagedDraft(context.primary, workspace);
      const change = await readChange(context.primary, resolvedId);
      assertDraftOwner(change, context.primary.name, workspace.key);
      if (changeStoreType(change) !== "managed") throw new Error(`ChangeSet ${change.id} is not a Managed ChangeSet`);
      const candidateRoot = workspaceCandidateRoot(workspace.path, resolvedId);
      if (!await exists(candidateRoot)) throw new Error(`ChangeSet candidate is missing: ${candidateRoot}`);
      const effectiveChange = await resolveEffectiveSyncTargets(change, candidateRoot);
      await assertChangeTargetsCurrent(context.primary, effectiveChange);
      const checkpointCandidate = await snapshotSparseCandidate(candidateRoot, effectiveChange.targets);
      try {
        const issues = await validateEffectiveMemoryChange(
          context.primary,
          effectiveChange,
          checkpointCandidate,
          candidateRoot
        );
        effectiveChange.store_type = "managed";
        const checkpointRoot = await persistValidatedCheckpoint(
          context.primary,
          effectiveChange,
          checkpointCandidate,
          context.primary.config.store.published_revision,
          issues,
          context.primary.memoryRoot,
          candidateRoot
        );
        return validationResult(
          effectiveChange,
          context.primary.memoryRoot,
          candidateRoot,
          checkpointRoot,
          context.primary.config.store.published_revision,
          issues
        );
      } finally {
        await rm(resolve(checkpointCandidate, ".."), { recursive: true, force: true });
      }
    }

    const captured = await captureEmbeddedWorkingChange(context.primary, workspace, changeId);
    try {
      const issues = await validateEmbeddedEffectiveMemory(captured.change, captured.candidateRoot);
      const checkpointRoot = await persistValidatedCheckpoint(
        context.primary,
        captured.change,
        captured.candidateRoot,
        captured.change.base_revision,
        issues,
        captured.memoryRoot
      );
      return validationResult(
        captured.change,
        captured.memoryRoot,
        checkpointRoot,
        checkpointRoot,
        captured.change.base_revision,
        issues
      );
    } finally {
      await rm(resolve(captured.candidateRoot, ".."), { recursive: true, force: true });
    }
  });
}

async function resolveSingleManagedDraft(project: ResolvedProject, workspace: WorkspaceIdentity): Promise<string> {
  const root = resolve(workspace.path, ".memsphere-work", "changes");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isCode(error, "ENOENT")) {
      throw new Error("no Managed draft ChangeSet was found in the current Workspace; run memsphere memory edit or provide a change id");
    }
    throw error;
  }
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^change-[a-zA-Z0-9-]+$/.test(entry.name)) continue;
    const change = await readChange(project, entry.name).catch(() => undefined);
    if (
      change?.status === "draft"
      && change.project === project.name
      && change.workspace_key === workspace.key
      && changeStoreType(change) === "managed"
      && await exists(join(root, entry.name, "memory"))
    ) ids.push(entry.name);
  }
  ids.sort();
  if (ids.length === 1) return ids[0];
  if (ids.length === 0) {
    throw new Error("no Managed draft ChangeSet was found in the current Workspace; run memsphere memory edit or provide a change id");
  }
  throw new Error(`multiple Managed draft ChangeSets were found; provide one explicitly: ${ids.join(", ")}`);
}

async function snapshotSparseCandidate(
  candidateRoot: string,
  targets: MemoryChangeSet["targets"]
): Promise<string> {
  const temporary = await mkdtemp(join(tmpdir(), "memsphere-checkpoint-"));
  const memoryRoot = join(temporary, "memory");
  await mkdir(memoryRoot, { recursive: true });
  for (const target of targets) {
    if (target.operation === "delete") continue;
    try {
      await assertRegularFileInside(candidateRoot, target.path);
    } catch (error) {
      if (isCode(error, "ENOENT")) throw new Error(`candidate file is missing: ${target.path}`);
      throw error;
    }
    const destination = join(memoryRoot, target.path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(candidateRoot, target.path), destination);
  }
  return memoryRoot;
}

async function persistValidatedCheckpoint(
  project: ResolvedProject,
  change: MemoryChangeSet,
  candidateRoot: string,
  baseRevision: string,
  issues: ValidationIssue[],
  effectiveMemoryRoot: string,
  issueCandidateRoot = candidateRoot
): Promise<string> {
  const digest = await checkpointDigest(change.targets, candidateRoot);
  const checkpoints = checkpointsRoot(project, change.id);
  const revisionRoot = join(checkpoints, digest);
  const finalMemoryRoot = join(revisionRoot, "memory");
  if (!await exists(finalMemoryRoot)) {
    await mkdir(checkpoints, { recursive: true });
    const temporary = join(checkpoints, `.writing-${digest}-${process.pid}-${randomBytes(4).toString("hex")}`);
    await rm(temporary, { recursive: true, force: true });
    await mkdir(temporary, { recursive: true });
    await cp(candidateRoot, join(temporary, "memory"), { recursive: true });
    try {
      await rename(temporary, revisionRoot);
    } catch (error) {
      if (!await exists(finalMemoryRoot)) throw error;
      await rm(temporary, { recursive: true, force: true });
    }
  }
  change.checkpoint = {
    digest,
    base_revision: baseRevision,
    created_at: new Date().toISOString(),
    valid: issues.length === 0,
    issues: issues.map((issue) => persistedValidationIssue(issue, effectiveMemoryRoot, issueCandidateRoot))
  };
  change.updated_at = new Date().toISOString();
  await writeChange(project, change);
  for (const entry of await readdir(checkpoints, { withFileTypes: true })) {
    if (entry.name === digest || !entry.isDirectory()) continue;
    await rm(join(checkpoints, entry.name), { recursive: true, force: true });
  }
  return finalMemoryRoot;
}

async function checkpointDigest(targets: MemoryChangeSet["targets"], candidateRoot: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(targets));
  for (const target of targets) {
    hash.update(`\0${target.path}\0${target.destination_path ?? ""}\0`);
    if (target.operation !== "delete") hash.update(await readFile(join(candidateRoot, target.path)));
  }
  return hash.digest("hex");
}

function persistedValidationIssue(
  issue: ValidationIssue,
  effectiveMemoryRoot: string,
  candidateRoot: string
): z.infer<typeof persistedValidationIssueSchema> {
  const candidates = [
    relative(candidateRoot, issue.path).replaceAll("\\", "/"),
    relative(effectiveMemoryRoot, issue.path).replaceAll("\\", "/")
  ];
  const path = candidates.find((candidate) => candidate !== "" && candidate !== ".." && !candidate.startsWith("../"))
    ?? issue.path;
  return {
    path,
    message: issue.message,
    ...(issue.line ? { line: issue.line } : {}),
    ...(issue.column ? { column: issue.column } : {}),
    ...(issue.migration ? { migration: issue.migration } : {})
  };
}

function validationResult(
  change: MemoryChangeSet,
  memoryRoot: string,
  candidateRoot: string,
  _checkpointRoot: string,
  baseRevision: string,
  issues: ValidationIssue[]
): MemoryChangeValidationResult {
  if (!change.checkpoint) throw new Error(`ChangeSet ${change.id} checkpoint was not persisted`);
  return {
    changeId: change.id,
    memoryRoot,
    candidateRoot,
    storeType: changeStoreType(change),
    baseRevision,
    checkpointDigest: change.checkpoint.digest,
    issues
  };
}

type EmbeddedCapture = {
  change: MemoryChangeSet;
  candidateRoot: string;
  memoryRoot: string;
};

async function captureEmbeddedWorkingChange(
  project: ResolvedProject,
  workspace: WorkspaceIdentity,
  requestedId?: string
): Promise<EmbeddedCapture> {
  if (project.config.store.type !== "embedded") throw new Error("Embedded ChangeSet capture requires an Embedded Project");
  if (workspace.kind !== "git") throw new Error("Embedded ChangeSet validation must run inside a Git worktree");
  const configuredWorkspace = await resolveWorkspaceIdentity(project.config.store.memory_path);
  if (configuredWorkspace.kind !== "git" || configuredWorkspace.key !== workspace.key) {
    throw new Error(`Embedded Project "${project.name}" does not belong to the current Git repository`);
  }
  const relativeMemoryPath = relative(configuredWorkspace.path, resolve(project.config.store.memory_path)).replaceAll("\\", "/");
  if (relativeMemoryPath === ".." || relativeMemoryPath.startsWith("../") || posix.isAbsolute(relativeMemoryPath)) {
    throw new Error("Embedded Memory path cannot be resolved inside the current Git worktree");
  }
  const memoryPath = relativeMemoryPath || ".";
  const memoryRoot = resolve(workspace.path, memoryPath);
  if (relative(workspace.path, memoryRoot).startsWith("..")) throw new Error("Embedded Memory path escapes the current worktree");
  if (!await exists(memoryRoot)) throw new Error(`Embedded Memory root is missing in the current worktree: ${memoryRoot}`);
  const baseRevision = await gitOutput(["rev-parse", "HEAD"], workspace.path);
  const source = {
    instance_key: workspace.instanceKey,
    root: workspace.path,
    repository_root: configuredWorkspace.path,
    memory_path: memoryPath
  };
  const captured = await captureEmbeddedTargets(workspace.path, memoryRoot, memoryPath, baseRevision);
  if (captured.targets.length === 0) {
    await rm(resolve(captured.candidateRoot, ".."), { recursive: true, force: true });
    throw new Error("no Embedded Memory changes were found relative to the current HEAD");
  }

  let change: MemoryChangeSet;
  if (requestedId) {
    change = await readChange(project, requestedId);
    assertDraftOwner(change, project.name, workspace.key);
    if (changeStoreType(change) !== "embedded") throw new Error(`ChangeSet ${change.id} is not an Embedded ChangeSet`);
    if (change.source_worktree?.instance_key !== workspace.instanceKey || change.base_revision !== baseRevision) {
      throw new Error(`Embedded ChangeSet ${change.id} belongs to another worktree or HEAD`);
    }
  } else {
    const matches = (await listProjectChanges(project)).filter((candidate) => (
      candidate.status === "draft"
      && changeStoreType(candidate) === "embedded"
      && candidate.workspace_key === workspace.key
      && candidate.source_worktree?.instance_key === workspace.instanceKey
      && candidate.base_revision === baseRevision
    ));
    if (matches.length > 1) {
      throw new Error(`multiple active Embedded ChangeSets were found; provide one explicitly: ${matches.map((item) => item.id).sort().join(", ")}`);
    }
    change = matches[0] ?? newChange(project, workspace.key);
  }
  change.store_type = "embedded";
  change.base_revision = baseRevision;
  change.source_worktree = source;
  change.targets = captured.targets;
  return { change, candidateRoot: captured.candidateRoot, memoryRoot };
}

async function captureEmbeddedTargets(
  repositoryRoot: string,
  memoryRoot: string,
  memoryPath: string,
  baseRevision: string
): Promise<{ targets: MemoryChangeSet["targets"]; candidateRoot: string }> {
  let changes = parseNameStatus(await gitOutput(
    ["diff", "--name-status", "-z", "-M", "HEAD", "--", memoryPath],
    repositoryRoot
  ));
  const untracked = (await gitOutput(
    ["ls-files", "--others", "--exclude-standard", "-z", "--", memoryPath],
    repositoryRoot
  )).split("\0").filter(Boolean);
  for (const path of untracked) changes.push({ status: "A", path });
  changes = await coalesceUntrackedRenames(changes, repositoryRoot, baseRevision);
  const temporary = await mkdtemp(join(tmpdir(), "memsphere-embedded-change-"));
  const candidateRoot = join(temporary, "memory");
  await mkdir(candidateRoot, { recursive: true });
  const targets: MemoryChangeSet["targets"] = [];
  for (const change of changes) {
    const sourceRepoPath = change.oldPath ?? change.path;
    const sourcePath = embeddedMemoryPath(memoryPath, sourceRepoPath);
    const destinationPath = change.oldPath ? embeddedMemoryPath(memoryPath, change.path) : undefined;
    const relevantPath = destinationPath ?? sourcePath;
    if (!isSafeMemoryPath(relevantPath)) continue;
    if (!isSafeMemoryPath(sourcePath)) throw new Error(`invalid Embedded Memory path: ${sourcePath}`);
    if (change.status === "U" || change.status === "T") {
      throw new Error(`unsupported Git status ${change.status} for Embedded Memory: ${relevantPath}`);
    }
    const operation = change.oldPath
      ? "rename" as const
      : change.status === "A" ? "create" as const
        : change.status === "D" ? "delete" as const
          : "update" as const;
    const target: z.infer<typeof changeTargetSchema> = {
      operation,
      reference: fallbackReference(sourcePath),
      path: sourcePath,
      ...(destinationPath ? { destination_path: destinationPath } : {}),
      ...(operation === "create" ? {} : {
        base_digest: await gitOutput(["rev-parse", `${baseRevision}:${sourceRepoPath}`], repositoryRoot)
      }),
      added_revision: baseRevision
    };
    if (operation !== "delete") {
      const livePath = join(memoryRoot, destinationPath ?? sourcePath);
      await assertRegularFileInside(memoryRoot, destinationPath ?? sourcePath);
      const candidate = join(candidateRoot, sourcePath);
      await mkdir(dirname(candidate), { recursive: true });
      await cp(livePath, candidate);
    }
    targets.push(target);
  }
  targets.sort((a, b) => a.path.localeCompare(b.path));
  return { targets, candidateRoot };
}

async function coalesceUntrackedRenames(
  changes: GitNameStatus[],
  repositoryRoot: string,
  baseRevision: string
): Promise<GitNameStatus[]> {
  const consumed = new Set<number>();
  const renames: GitNameStatus[] = [];
  for (const [deletedIndex, deleted] of changes.entries()) {
    if (deleted.status !== "D") continue;
    const deletedDigest = await gitOutput(["rev-parse", `${baseRevision}:${deleted.path}`], repositoryRoot);
    for (const [addedIndex, added] of changes.entries()) {
      if (consumed.has(addedIndex) || added.status !== "A") continue;
      const addedDigest = await gitOutput(["hash-object", added.path], repositoryRoot);
      if (addedDigest !== deletedDigest) continue;
      consumed.add(deletedIndex);
      consumed.add(addedIndex);
      renames.push({ status: "R", oldPath: deleted.path, path: added.path });
      break;
    }
  }
  return [...changes.filter((_, index) => !consumed.has(index)), ...renames];
}

type GitNameStatus = { status: string; path: string; oldPath?: string };

function parseNameStatus(output: string): GitNameStatus[] {
  if (!output) return [];
  const tokens = output.split("\0");
  const result: GitNameStatus[] = [];
  for (let index = 0; index < tokens.length;) {
    const rawStatus = tokens[index++];
    if (!rawStatus) continue;
    const status = rawStatus[0];
    if (status === "R" || status === "C") {
      const oldPath = tokens[index++];
      const path = tokens[index++];
      if (!oldPath || !path) throw new Error("invalid Git rename status output");
      result.push({ status: "R", oldPath, path });
    } else {
      const path = tokens[index++];
      if (!path) throw new Error("invalid Git name-status output");
      result.push({ status, path });
    }
  }
  return result;
}

function embeddedMemoryPath(memoryPath: string, repositoryPath: string): string {
  if (memoryPath === ".") return repositoryPath;
  const normalizedRoot = memoryPath.replace(/^\.\//, "").replace(/\/$/, "");
  const prefix = `${normalizedRoot}/`;
  if (!repositoryPath.startsWith(prefix)) throw new Error(`Git path is outside the Embedded Memory root: ${repositoryPath}`);
  return repositoryPath.slice(prefix.length);
}

function fallbackReference(path: string): string {
  const [kind, file] = path.split("/");
  return `${kind}/${file.replace(/\.ya?ml$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "invalid"}`;
}

async function validateEmbeddedEffectiveMemory(
  change: MemoryChangeSet,
  candidateRoot: string
): Promise<ValidationIssue[]> {
  const source = change.source_worktree;
  if (!source) throw new Error(`Embedded ChangeSet ${change.id} has no source worktree metadata`);
  const staging = await mkdtemp(join(tmpdir(), "memsphere-embedded-effective-"));
  try {
    await materializeGitMemoryRoot(source.repository_root, change.base_revision, source.memory_path, staging);
    await applyTargets(staging, candidateRoot, change.targets);
    const validation = await validateMemoryRoot(staging);
    return validation.issues.map((issue) => mapEffectiveValidationIssue(
      issue,
      staging,
      join(source.root, source.memory_path),
      join(source.root, source.memory_path),
      change.targets,
      true
    ));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function materializeGitMemoryRoot(
  repositoryRoot: string,
  revision: string,
  memoryPath: string,
  destination: string
): Promise<void> {
  await Promise.all(memoryKinds.map((kind) => mkdir(join(destination, kind), { recursive: true })));
  const normalizedRoot = memoryPath === "." ? "" : memoryPath.replace(/^\.\//, "").replace(/\/$/, "");
  const output = await gitOutput(
    ["ls-tree", "-r", "--name-only", revision, ...(normalizedRoot ? ["--", normalizedRoot] : [])],
    repositoryRoot
  );
  for (const repositoryPath of output.split("\n").filter(Boolean)) {
    const memoryRelative = normalizedRoot ? embeddedMemoryPath(normalizedRoot, repositoryPath) : repositoryPath;
    if (!isSafeMemoryPath(memoryRelative)) continue;
    const source = await gitOutputRaw(["show", `${revision}:${repositoryPath}`], repositoryRoot);
    const path = join(destination, memoryRelative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source, "utf8");
  }
}

async function listProjectChanges(project: ResolvedProject): Promise<MemoryChangeSet[]> {
  let entries;
  try {
    entries = await readdir(project.paths.changesRoot, { withFileTypes: true });
  } catch (error) {
    if (isCode(error, "ENOENT")) return [];
    throw error;
  }
  const changes: MemoryChangeSet[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^change-[a-zA-Z0-9-]+$/.test(entry.name)) continue;
    const change = await readChange(project, entry.name).catch(() => undefined);
    if (change) changes.push(change);
  }
  return changes;
}

function changeStoreType(change: MemoryChangeSet): "managed" | "embedded" {
  return change.store_type ?? "managed";
}

export async function recoverMemory(
  reference: string,
  mode: "restore" | "create-change"
): Promise<{ change?: MemoryChangeSet; candidateRoot?: string }> {
  const initialContext = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  assertManaged(initialContext.primary);
  return withFileLock(memoryMutationLock(initialContext.primary), async () => {
    const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
    assertManaged(context.primary);
    return recoverMemoryLocked(context.primary, reference, mode);
  });
}

async function recoverMemoryLocked(
  project: ResolvedProject & { config: { store: { type: "managed"; branch: string; upstream?: string; published_revision: string } } },
  reference: string,
  mode: "restore" | "create-change"
): Promise<{ change?: MemoryChangeSet; candidateRoot?: string }> {
  const provider = new GitRevisionMemoryProvider(project.memoryRoot, project.config.store.published_revision);
  const descriptors = await provider.list();
  const logical = parseLogicalMemoryReference(reference);
  const matches = descriptors.filter((descriptor) => {
    if (logical && descriptor.kind !== logical.kind) return false;
    return descriptor.names.includes(logical?.name ?? reference.trim());
  });
  if (matches.length > 1) throw new Error(`Memory reference is ambiguous: ${reference}`);
  const tracked = matches[0];
  const path = tracked?.id ?? (logical ? posix.join(logical.kind, safeFileName(logical.name)) : undefined);
  if (!path) throw new Error(`Memory was not found in the published revision: ${reference}`);
  const absolute = join(project.memoryRoot, path);
  const externalExists = await exists(absolute);
  const external = externalExists ? await readFile(absolute) : undefined;
  const differs = tracked
    ? !externalExists || await gitBlobDigest(project.memoryRoot, path) !== await gitOutput(["rev-parse", `${project.config.store.published_revision}:${path}`], project.memoryRoot)
    : externalExists;
  if (!differs) throw new Error(`Memory has no external modification to recover: ${reference}`);

  let result: { change: MemoryChangeSet; candidateRoot: string } | undefined;
  if (mode === "create-change") {
    const workspace = await resolveWorkspaceIdentity();
    const change = newChange(project, workspace.key);
    const target: z.infer<typeof changeTargetSchema> = tracked
      ? {
          operation: externalExists ? "update" : "delete",
          reference: logicalReferenceFromDescriptor(tracked),
          path,
          base_digest: await gitOutput(["rev-parse", `${project.config.store.published_revision}:${path}`], project.memoryRoot),
          added_revision: project.config.store.published_revision
        }
      : {
          operation: "create",
          reference: `${logical!.kind}/${logical!.name}`,
          path,
          added_revision: project.config.store.published_revision
        };
    const candidateRoot = workspaceCandidateRoot(workspace.path, change.id);
    try {
      await mkdir(candidateRoot, { recursive: true });
      if (external && target.operation !== "delete") {
        const candidate = join(candidateRoot, target.path);
        await mkdir(dirname(candidate), { recursive: true });
        await writeFile(candidate, external);
      }
      change.targets.push(target);
      change.updated_at = new Date().toISOString();
      await writeChange(project, change);
      result = { change, candidateRoot };
    } catch (error) {
      await rm(resolve(candidateRoot, ".."), { recursive: true, force: true }).catch(() => undefined);
      await rm(dirname(changePath(project, change.id)), { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  if (tracked) await runGit(["checkout", project.config.store.published_revision, "--", path], { cwd: project.memoryRoot });
  else await rm(absolute, { force: true });
  return result ?? {};
}

export async function pushMemory(): Promise<void> {
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  assertManaged(context.primary);
  await assertManagedHealthy(context.primary);
  await runGit(["push", "origin", context.primary.config.store.branch], { cwd: context.primary.memoryRoot });
}

export async function syncMemory(): Promise<{ revision?: string; change?: MemoryChangeSet; candidateRoot?: string }> {
  const initialContext = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  assertManaged(initialContext.primary);
  const source = await prepareSync(initialContext.primary);
  return withFileLock(memoryMutationLock(initialContext.primary), async () => {
    const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
    assertManaged(context.primary);
    return syncMemoryLocked(context.primary, source);
  });
}

type PreparedSync = { upstream: string; mergeParent: string };

async function prepareSync(
  project: ResolvedProject & { config: { store: { type: "managed"; branch: string; upstream?: string; published_revision: string } } }
): Promise<PreparedSync> {
  await assertManagedHealthy(project);
  const upstream = project.config.store.upstream;
  if (!upstream) throw new Error("Managed Project has no configured organization upstream");
  const slash = upstream.indexOf("/");
  if (slash <= 0) throw new Error(`invalid upstream; expected remote/branch: ${upstream}`);
  const remote = upstream.slice(0, slash);
  const branch = upstream.slice(slash + 1);
  await runGit(["fetch", remote, branch], { cwd: project.memoryRoot });
  return { upstream, mergeParent: await gitOutput(["rev-parse", `${remote}/${branch}`], project.memoryRoot) };
}

async function syncMemoryLocked(
  project: ResolvedProject & { config: { store: { type: "managed"; branch: string; upstream?: string; published_revision: string } } },
  source: PreparedSync
): Promise<{ revision?: string; change?: MemoryChangeSet; candidateRoot?: string }> {
  await assertManagedHealthy(project);
  if (project.config.store.upstream !== source.upstream) throw new Error("Managed Project upstream changed during sync; retry the command");
  const { upstream, mergeParent } = source;
  if (await isAncestor(mergeParent, project.config.store.published_revision, project.memoryRoot)) {
    return { revision: project.config.store.published_revision };
  }

  try {
    await runGit(["merge", "--no-ff", "--no-commit", mergeParent], { cwd: project.memoryRoot });
  } catch (error) {
    const conflicts = (await gitOutput(["diff", "--name-only", "--diff-filter=U"], project.memoryRoot)).split("\n").filter(Boolean);
    if (conflicts.length === 0) {
      await abortMerge(project);
      throw error;
    }
    const candidates = await Promise.all(conflicts.map(async (path) => ({
      path,
      content: await readSyncConflictCandidate(project.memoryRoot, path)
    })));
    await abortMerge(project);
    const [publishedDescriptors, upstreamDescriptors] = await Promise.all([
      new GitRevisionMemoryProvider(project.memoryRoot, project.config.store.published_revision).list(),
      new GitRevisionMemoryProvider(project.memoryRoot, mergeParent).list()
    ]);
    const createPaths = new Map<string, string>();
    const references = conflicts.map((path) => {
      const published = publishedDescriptors.find((candidate) => candidate.id === path);
      const descriptor = published ?? upstreamDescriptors.find((candidate) => candidate.id === path);
      if (!descriptor) throw new Error(`Sync conflict is not an existing Memory: ${path}`);
      const reference = logicalReferenceFromDescriptor(descriptor);
      if (!published) createPaths.set(reference, path);
      return reference;
    });
    const result = await editMemories({ references, createPaths });
    for (const candidate of candidates) {
      const target = result.change.targets.find((item) => item.path === candidate.path);
      if (!target) throw new Error(`Sync ChangeSet target is missing: ${candidate.path}`);
      const candidatePath = join(result.candidateRoot, target.path);
      if (candidate.content !== undefined) await writeFile(candidatePath, candidate.content);
      else await rm(candidatePath, { force: true });
    }
    result.change.merge_parent = mergeParent;
    result.change.updated_at = new Date().toISOString();
    await writeChange(project, result.change);
    return { change: result.change, candidateRoot: result.candidateRoot };
  }

  try {
    const validation = await validateMemoryRoot(project.memoryRoot);
    if (validation.issues.length > 0) throw new Error(`synchronized Memory validation failed: ${validation.issues[0].message}`);
    await runGit(["commit", "-m", `Merge ${upstream} into ${project.config.store.branch}`], { cwd: project.memoryRoot });
    const revision = await updatePublishedRevision(project);
    return { revision };
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    await abortMerge(project).catch((rollbackError) => rollbackErrors.push(rollbackError));
    await restoreJsonIfChanged(project.paths.configPath, project.config).catch((rollbackError) => rollbackErrors.push(rollbackError));
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], "Memory sync failed and rollback was incomplete");
    }
    throw error;
  }
}

async function readSyncConflictCandidate(root: string, path: string): Promise<Buffer | string | undefined> {
  const stages = new Map<number, string>();
  const unmerged = await gitOutput(["ls-files", "-u", "--", path], root);
  for (const line of unmerged.split("\n").filter(Boolean)) {
    const [metadata] = line.split("\t", 1);
    const [, digest, stage] = metadata.split(" ");
    if (digest && stage) stages.set(Number(stage), digest);
  }
  const ours = stages.get(2);
  const theirs = stages.get(3);
  if (ours && theirs) return readFile(join(root, path));
  if (!ours && !theirs) {
    return readFile(join(root, path)).catch((error) => {
      if (isCode(error, "ENOENT")) return undefined;
      throw error;
    });
  }
  const oursContent = ours ? `${await gitOutput(["cat-file", "-p", ours], root)}\n` : "";
  const theirsContent = theirs ? `${await gitOutput(["cat-file", "-p", theirs], root)}\n` : "";
  return [
    `<<<<<<< current${ours ? "" : " (deleted)"}\n`,
    oursContent,
    "=======\n",
    theirsContent,
    `>>>>>>> upstream${theirs ? "" : " (deleted)"}\n`
  ].join("");
}

async function publishLocked(project: ResolvedProject, change: MemoryChangeSet, candidateRoot: string, message?: string): Promise<MemoryChangeSet> {
  await assertManagedHealthy(project);
  assertManaged(project);
  const publishedRevision = project.config.store.published_revision;
  const effectiveChange = await resolveEffectiveSyncTargets(change, candidateRoot);
  await assertChangeTargetsCurrent(project, effectiveChange);
  const issues = await validateEffectiveMemoryChange(project, effectiveChange, candidateRoot);
  if (issues.length > 0) {
    throw new Error(`ChangeSet validation failed:\n${issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n")}`);
  }

  try {
    if (effectiveChange.merge_parent) {
      await runGit(["merge", "--no-ff", "--no-commit", effectiveChange.merge_parent], { cwd: project.memoryRoot }).catch(() => undefined);
    }
    await applyTargets(project.memoryRoot, candidateRoot, effectiveChange.targets);
    await runGit(["add", "-A"], { cwd: project.memoryRoot });
    const formalValidation = await validateMemoryRoot(project.memoryRoot);
    if (formalValidation.issues.length > 0) throw new Error(`ChangeSet validation failed after merge: ${formalValidation.issues[0].message}`);
    await runGit(["commit", "-m", message?.trim() || `Publish Memsphere ChangeSet ${effectiveChange.id}`], { cwd: project.memoryRoot });
    const revision = await updatePublishedRevision(project);
    const published = memoryChangeSetSchema.parse({
      ...effectiveChange,
      status: "published",
      published_revision: revision,
      updated_at: new Date().toISOString()
    });
    await writeChange(project, published);
    return published;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    await runGit(["reset", "--hard", publishedRevision], { cwd: project.memoryRoot }).catch((rollbackError) => rollbackErrors.push(rollbackError));
    await runGit(["clean", "-fd"], { cwd: project.memoryRoot }).catch((rollbackError) => rollbackErrors.push(rollbackError));
    await restoreJsonIfChanged(project.paths.configPath, project.config).catch((rollbackError) => rollbackErrors.push(rollbackError));
    await restoreJsonIfChanged(changePath(project, change.id), change).catch((rollbackError) => rollbackErrors.push(rollbackError));
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], "Memory publish failed and rollback was incomplete");
    }
    throw error;
  }
}

async function resolveEffectiveSyncTargets(change: MemoryChangeSet, candidateRoot: string): Promise<MemoryChangeSet> {
  if (!change.merge_parent) return change;
  const targets = await Promise.all(change.targets.map(async (target) => ({
    ...target,
    operation: await exists(join(candidateRoot, target.path))
      ? target.base_digest ? "update" as const : "create" as const
      : "delete" as const
  })));
  return memoryChangeSetSchema.parse({ ...change, targets });
}

async function restoreJsonIfChanged(path: string, value: unknown): Promise<void> {
  const expected = `${JSON.stringify(value, null, 2)}\n`;
  try {
    if (await readFile(path, "utf8") === expected) return;
  } catch (error) {
    if (!isCode(error, "ENOENT")) throw error;
  }
  await atomicWriteJson(path, value);
}

async function assertChangeTargetsCurrent(project: ResolvedProject, change: MemoryChangeSet): Promise<void> {
  for (const target of change.targets) {
    const current = join(project.memoryRoot, target.path);
    if (target.operation === "create") {
      if (await exists(current)) throw new Error(`Memory create conflict: ${target.reference}`);
      continue;
    }
    if (target.operation === "delete" && !target.base_digest) {
      if (await exists(current)) throw new Error(`Memory create conflict: ${target.reference}`);
      continue;
    }
    if (!await exists(current)) throw new Error(`Memory changed or was deleted since edit: ${target.reference}`);
    const digest = await gitBlobDigest(project.memoryRoot, target.path);
    if (digest !== target.base_digest) throw new Error(`Memory edit conflict: ${target.reference}`);
  }
}

async function validateEffectiveMemoryChange(
  project: ResolvedProject,
  change: MemoryChangeSet,
  candidateRoot: string,
  issueCandidateRoot = candidateRoot
): Promise<ValidationIssue[]> {
  const staging = await mkdtemp(join(tmpdir(), "memsphere-publish-"));
  try {
    await copyWorkingTree(project.memoryRoot, staging);
    await applyTargets(staging, candidateRoot, change.targets);
    const validation = await validateMemoryRoot(staging);
    return validation.issues.map((issue) => mapEffectiveValidationIssue(
      issue,
      staging,
      project.memoryRoot,
      issueCandidateRoot,
      change.targets
    ));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function mapEffectiveValidationIssue(
  issue: ValidationIssue,
  stagingRoot: string,
  memoryRoot: string,
  candidateRoot: string,
  targets: MemoryChangeSet["targets"],
  useEffectiveTargetPath = false
): ValidationIssue {
  const effectivePath = relative(stagingRoot, issue.path).replaceAll("\\", "/");
  if (effectivePath === "" || effectivePath.startsWith("../") || effectivePath === "..") return issue;
  const target = targets.find((item) => (item.destination_path ?? item.path) === effectivePath);
  return {
    ...issue,
    path: target && target.operation !== "delete"
      ? join(candidateRoot, useEffectiveTargetPath ? effectivePath : target.path)
      : join(memoryRoot, effectivePath)
  };
}

async function updatePublishedRevision(project: ResolvedProject): Promise<string> {
  assertManaged(project);
  const revision = await gitOutput(["rev-parse", "HEAD"], project.memoryRoot);
  const nextConfig = projectConfigSchema.parse({ ...project.config, store: { ...project.config.store, published_revision: revision } });
  await atomicWriteJson(project.paths.configPath, nextConfig);
  return revision;
}

async function abortMerge(project: ResolvedProject): Promise<void> {
  await runGit(["merge", "--abort"], { cwd: project.memoryRoot }).catch(async () => {
    assertManaged(project);
    await runGit(["reset", "--hard", project.config.store.published_revision], { cwd: project.memoryRoot });
  });
}

async function isAncestor(ancestor: string, descendant: string, cwd: string): Promise<boolean> {
  try {
    await runGit(["merge-base", "--is-ancestor", ancestor, descendant], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function createChange(project: ResolvedProject, workspaceKey: string): Promise<MemoryChangeSet> {
  const change = newChange(project, workspaceKey);
  await writeChange(project, change);
  return change;
}

function newChange(project: ResolvedProject, workspaceKey: string): MemoryChangeSet {
  const id = changeId();
  const revision = project.config.store.type === "managed" ? project.config.store.published_revision : "embedded";
  const now = new Date().toISOString();
  return {
    format_version: 1,
    id,
    project: project.name,
    workspace_key: workspaceKey,
    base_revision: revision,
    status: "draft",
    created_at: now,
    updated_at: now,
    targets: []
  };
}

async function resolveTarget(
  project: ResolvedProject,
  referenceInput: string,
  operation: "edit" | "delete" | "rename",
  createPath?: string
): Promise<z.infer<typeof changeTargetSchema>> {
  const reference = normalizeMemoryName(referenceInput);
  if (referenceInput !== reference && reference.includes("/")) {
    throw new Error(`invalid Memory reference "${referenceInput}"; explicit references must not contain surrounding whitespace`);
  }
  const files = await readAllMemoryFiles(project.memoryRoot);
  const logical = parseLogicalMemoryReference(reference);
  if (!logical && reference.includes("/")) {
    throw new Error(`invalid Memory reference "${reference}"; expected <kind>/<lowercase-kebab-case-canonical-name>`);
  }
  const found = files.filter((file) => {
    if (logical && file.kind !== logical.kind) return false;
    const wanted = logical?.name ?? reference;
    return logical ? file.entity.names[0] === wanted : file.entity.names.includes(wanted);
  });
  if (logical && found.length === 0 && files.some((file) =>
    file.kind === logical.kind && file.entity.names.slice(1).includes(logical.name)
  )) {
    throw new Error(`explicit Memory reference must use the canonical name: ${reference}`);
  }
  if (found.length > 1) throw new Error(`Memory reference is ambiguous within Project: ${reference}`);
  const revision = project.config.store.type === "managed" ? project.config.store.published_revision : "embedded";
  if (found.length === 0) {
    if (operation !== "edit" || !logical) throw new Error(`Memory was not found: ${reference}`);
    if (createPath !== undefined) assertSafeCreatePath(reference, createPath);
    if (createPath !== undefined && await exists(join(project.memoryRoot, createPath))) {
      throw new Error(`explicit create path already exists: ${createPath}`);
    }
    return {
      operation: "create",
      reference: `${logical.kind}/${logical.name}`,
      path: createPath ?? posix.join(logical.kind, safeFileName(logical.name)),
      added_revision: revision
    };
  }
  if (createPath !== undefined) throw new Error(`explicit create path requires a new Memory: ${reference}`);
  const file = found[0];
  const path = relative(project.memoryRoot, file.path).replaceAll("\\", "/");
  return {
    operation: operation === "edit" ? "update" : operation,
    reference: `${file.kind}/${file.entity.names[0]}`,
    path,
    base_digest: await gitBlobDigest(project.memoryRoot, path),
    added_revision: revision
  };
}

async function applyTargets(root: string, candidates: string, targets: MemoryChangeSet["targets"]): Promise<void> {
  for (const target of targets) {
    assertSafeMemoryPath(target.path);
    if (target.destination_path) assertSafeMemoryPath(target.destination_path);
    const destination = join(root, target.destination_path ?? target.path);
    if (target.operation === "delete") {
      await rm(join(root, target.path), { force: true });
      continue;
    }
    const candidate = join(candidates, target.path);
    if (!await exists(candidate)) throw new Error(`candidate file is missing: ${candidate}`);
    await assertRegularFileInside(candidates, target.path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(candidate, destination);
    if (target.operation === "rename" && target.destination_path && target.destination_path !== target.path) {
      await rm(join(root, target.path), { force: true });
    }
  }
}

function isSafeMemoryPath(path: string): boolean {
  if (path.includes("\\") || path !== posix.normalize(path) || path.startsWith("../") || path.startsWith("/")) return false;
  const [kind, ...rest] = path.split("/");
  return memoryKinds.includes(kind as MemoryKind)
    && rest.length === 1
    && rest.every((part) => part !== "" && part !== "." && part !== "..")
    && /\.ya?ml$/i.test(rest.at(-1) ?? "");
}

function assertSafeMemoryPath(path: string): void {
  if (!isSafeMemoryPath(path)) throw new Error(`invalid or escaping Memory path: ${path}`);
}

function assertSafeCreatePath(reference: string, path: string): void {
  assertSafeMemoryPath(path);
  const logical = parseLogicalMemoryReference(reference);
  if (!logical) throw new Error(`explicit create path requires a logical reference: ${reference}`);
  if (!path.startsWith(`${logical.kind}/`)) {
    throw new Error(`explicit create path kind does not match Memory reference: ${reference}`);
  }
}

async function assertRegularFileInside(root: string, path: string): Promise<void> {
  const candidate = join(root, path);
  const info = await lstat(candidate);
  if (!info.isFile()) throw new Error(`candidate must be a regular file: ${candidate}`);
  const [resolvedRoot, resolvedCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`candidate path escapes ChangeSet root through a symbolic link: ${path}`);
  }
}

async function copyWorkingTree(source: string, destination: string): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    await cp(join(source, entry.name), join(destination, entry.name), { recursive: true });
  }
}

async function assertManagedHealthy(project: ResolvedProject): Promise<void> {
  assertManaged(project);
  const [branch, revision, dirty] = await Promise.all([
    gitOutput(["branch", "--show-current"], project.memoryRoot),
    gitOutput(["rev-parse", "HEAD"], project.memoryRoot),
    gitOutput(["status", "--porcelain"], project.memoryRoot)
  ]);
  if (branch !== project.config.store.branch || revision !== project.config.store.published_revision || dirty) {
    throw new Error("Managed Memory Store is frozen because its branch, HEAD, or working tree was modified outside Memsphere");
  }
}

function assertManaged(project: ResolvedProject): asserts project is ResolvedProject & { config: { store: { type: "managed"; branch: string; upstream?: string; published_revision: string }; control_plane?: ResolvedProject["config"]["control_plane"] } } {
  if (project.config.store.type !== "managed") throw new Error("Managed Memory ChangeSets are not available for an Embedded Project");
}

function memoryMutationLock(project: ResolvedProject): string {
  return join(project.paths.runtimeRoot, "memory-publish.lock");
}

async function readChange(project: ResolvedProject, id: string): Promise<MemoryChangeSet> {
  return memoryChangeSetSchema.parse(JSON.parse(await readFile(changePath(project, id), "utf8")));
}

async function writeChange(project: ResolvedProject, change: MemoryChangeSet): Promise<void> {
  await atomicWriteJson(changePath(project, change.id), memoryChangeSetSchema.parse(change));
}

function assertDraftOwner(change: MemoryChangeSet, project: string, workspaceKey: string): void {
  if (change.project !== project) throw new Error(`ChangeSet belongs to Project "${change.project}"`);
  if (change.status !== "draft") throw new Error(`ChangeSet ${change.id} is already ${change.status}`);
  if (change.workspace_key !== workspaceKey) throw new Error(`ChangeSet ${change.id} belongs to another Workspace`);
}

function changePath(project: ResolvedProject, id: string): string {
  assertSafeId(id);
  return join(project.paths.changesRoot, id, "change.json");
}

function recoveryRoot(project: ResolvedProject, id: string): string {
  assertSafeId(id);
  return join(project.paths.changesRoot, id, "memory");
}

function checkpointsRoot(project: ResolvedProject, id: string): string {
  assertSafeId(id);
  return join(project.paths.changesRoot, id, "checkpoints");
}

function checkpointMemoryRoot(project: ResolvedProject, id: string, digest: string): string {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`invalid ChangeSet checkpoint digest: ${digest}`);
  return join(checkpointsRoot(project, id), digest, "memory");
}

function workspaceCandidateRoot(workspace: string, id: string): string {
  assertSafeId(id);
  return resolve(workspace, ".memsphere-work", "changes", id, "memory");
}

function assertSafeId(id: string): void {
  if (!/^change-[a-zA-Z0-9-]+$/.test(id)) throw new Error(`invalid ChangeSet id: ${id}`);
}

function changeId(): string {
  return `change-${new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "z")}-${randomBytes(4).toString("hex")}`;
}

function safeFileName(name: string): string {
  assertCanonicalMemoryName(name);
  return `${name}.yaml`;
}

function newMemoryTemplate(reference: string): string {
  const parsed = parseLogicalMemoryReference(reference);
  if (!parsed) throw new Error(`new Memory requires a logical reference: ${reference}`);
  const tag = `!${parsed.kind.slice(0, -1)}`;
  const body = parsed.kind === "statements" ? "asserts: []" : parsed.kind === "procedures" ? "flow: []" : "defines: []";
  return `${tag}\nsyntax: ${currentMemorySyntax}\nnames:\n  - ${JSON.stringify(parsed.name)}\n${body}\n`;
}

function logicalReferenceFromDescriptor(descriptor: { kind: MemoryKind; names: string[] }): string {
  return `${descriptor.kind}/${descriptor.names[0]}`;
}

async function gitBlobDigest(root: string, path: string): Promise<string> {
  return gitOutput(["hash-object", "--", path], root);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isCode(error, "ENOENT")) return false;
    throw error;
  }
}

function isCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
