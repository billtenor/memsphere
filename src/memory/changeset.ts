import { createHash, randomBytes } from "node:crypto";
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { atomicWriteJson, withFileLock } from "../persistence.js";
import { archiveChangeDirectory, type ArchiveEntry } from "../archive/store.js";
import { gitHashObject, gitOutput, gitOutputRaw, runGit } from "../git.js";
import { memoryKinds, type MemoryKind } from "./kinds.js";
import { readAllMemoryFiles, readMemoryFile } from "./store.js";
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

export const memoryChangeActorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("human"),
    id: z.string().min(1),
    name: z.string().min(1)
  }).strict(),
  z.object({
    kind: z.literal("browser"),
    id: z.string().uuid(),
    name: z.literal("Browser user")
  }).strict(),
  z.object({
    kind: z.literal("workspace"),
    id: z.string().min(1),
    name: z.string().min(1)
  }).strict()
]);

const changeScopeSchema = z.object({
  reference: z.string().min(1),
  path: z.string().min(1).refine(isSafeMemoryPath, "invalid or escaping Memory path"),
  base_digest: z.string().min(1),
  added_revision: z.string().min(1).optional(),
  added_at: z.string().datetime()
}).strict();

const changeCommentLocationSchema = z.object({
  anchor: z.string().min(1),
  line: z.number().int().positive(),
  hash: z.string().min(1).optional()
}).strict();

export const memoryChangeCommentSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["pending", "processing", "completed"]),
  submitted_by: memoryChangeActorSchema,
  memory_reference: z.string().min(1),
  path: z.string().min(1).refine(isSafeMemoryPath, "invalid or escaping Memory path"),
  target: z.string().min(1).optional(),
  location: changeCommentLocationSchema.optional(),
  snapshot: z.string().optional(),
  checkpoint_digest: z.string().min(1).optional(),
  base_revision: z.string().min(1),
  body: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
}).strict();

const changeClaimSchema = z.object({
  workspace_key: z.string().min(1),
  instance_key: z.string().min(1),
  root: z.string().min(1),
  claimed_at: z.string().datetime()
}).strict();

const changeFailureSchema = z.object({
  stage: z.enum(["prepare", "validate", "publish"]),
  failed_at: z.string().datetime(),
  summary: z.string().min(1)
}).strict();

export const memoryChangeSetSchema = z.object({
  format_version: z.literal(1),
  id: z.string().min(1),
  project: z.string().min(1),
  workspace_key: z.string().min(1),
  base_revision: z.string().min(1),
  status: z.enum(["active", "completed", "abandoned"]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  published_revision: z.string().min(1).optional(),
  candidate_revision: z.string().min(1).optional(),
  merge_parent: z.string().min(1).optional(),
  store_type: z.enum(["managed", "embedded"]),
  source_worktree: sourceWorktreeSchema.optional(),
  checkpoint: changeCheckpointSchema.optional(),
  failure: changeFailureSchema.optional(),
  targets: z.array(changeTargetSchema),
  origin: z.enum(["cli", "view"]).default("cli"),
  intent: z.literal("market_import").optional(),
  created_by: memoryChangeActorSchema.optional(),
  scope: z.array(changeScopeSchema).default([]),
  comments: z.array(memoryChangeCommentSchema).default([]),
  claim: changeClaimSchema.optional()
}).strict().superRefine((change, context) => {
  if (change.status !== "abandoned" && change.failure) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["failure"],
      message: "only an abandoned ChangeSet may contain failure diagnostics"
    });
  }
});

export type MemoryChangeSet = z.infer<typeof memoryChangeSetSchema>;
export type MemoryChangeOperation = z.infer<typeof changeTargetSchema>["operation"];
export type MemoryChangeActor = z.infer<typeof memoryChangeActorSchema>;
export type MemoryChangeComment = z.infer<typeof memoryChangeCommentSchema>;

export class MemoryChangeIntegrityError extends Error {
  readonly code = "changeset_integrity_error";

  constructor(readonly changeId: string, message: string) {
    super(`ChangeSet ${changeId} has invalid persisted data: ${message}`);
    this.name = "MemoryChangeIntegrityError";
  }
}

export type EmbeddedMemoryEditResult = {
  repositoryRoot: string;
  workspaceRoot: string;
  memoryRoot: string;
  targets: Array<{ reference: string; path: string; operation: "create" | "update" }>;
};

export type MemoryChangeValidationResult = {
  changeId: string;
  memoryRoot: string;
  candidateRoot: string;
  storeType: "managed" | "embedded";
  baseRevision: string;
  checkpointDigest: string;
  completedChangeIds: string[];
  issues: ValidationIssue[];
};

export type MemoryChangePreview = {
  change: MemoryChangeSet;
  memoryRoot: string;
};

export type MemoryChangeReviewSnapshot = MemoryChangePreview & {
  files: Array<{ label: string; path: string; operation: MemoryChangeOperation }>;
};

export type MemoryChangeDetailSnapshot = MemoryChangePreview & {
  files: Array<{
    reference: string;
    label: string;
    path: string;
    operation: MemoryChangeOperation | "unchanged";
  }>;
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
    const entry = await withMemoryChangeCheckpointLock(input, async () => {
      const prepared = await prepareMemoryChangePreview(input);
      await this.#invalidateOlderVersions(prepared.changeKey, prepared.cacheKey);
      let current = this.#entries.get(prepared.cacheKey);
      if (!current) {
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
          current = await pending;
          this.#entries.set(prepared.cacheKey, current);
        } finally {
          if (this.#pending.get(prepared.cacheKey) === pending) this.#pending.delete(prepared.cacheKey);
        }
        await this.#evictOverflow();
      }
      current.preview = { ...current.preview, change: prepared.change };
      current.refs += 1;
      current.lastUsed = Date.now();
      return current;
    });
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
  const preview = await withMemoryChangeCheckpointLock(input, async () => {
    const prepared = await prepareMemoryChangePreview(input);
    return materializePreparedMemoryChangePreview(prepared);
  });
  try {
    return await input.use(preview);
  } finally {
    await rm(preview.memoryRoot, { recursive: true, force: true });
  }
}

export async function withMemoryChangeReviewSnapshot<T>(input: {
  home?: string;
  project: string;
  changeId: string;
  use: (snapshot: MemoryChangeReviewSnapshot) => Promise<T>;
}): Promise<T> {
  return withMemoryChangeCheckpointLock(input, async () => {
    const prepared = await prepareMemoryChangePreview(input);
    const preview = await materializePreparedMemoryChangePreview(prepared);
    let baseRoot: string | undefined;
    try {
      if (prepared.change.targets.some((target) => target.operation === "delete")) {
        baseRoot = await mkdtemp(join(tmpdir(), "memsphere-review-change-base-"));
        if (prepared.change.store_type === "managed") {
          await materializeGitMemoryRoot(prepared.project.memoryRoot, prepared.change.checkpoint!.base_revision, ".", baseRoot);
        } else {
          const source = prepared.change.source_worktree;
          if (!source) throw new Error(`Embedded ChangeSet ${prepared.change.id} has no source metadata`);
          await materializeGitMemoryRoot(source.repository_root, prepared.change.checkpoint!.base_revision, source.memory_path, baseRoot);
        }
      }
      const files = prepared.change.targets.map((target) => ({
        label: target.destination_path ?? target.path,
        path: join(target.operation === "delete" ? baseRoot! : preview.memoryRoot, target.destination_path ?? target.path),
        operation: target.operation
      }));
      return await input.use({ ...preview, files });
    } finally {
      await rm(preview.memoryRoot, { recursive: true, force: true });
      if (baseRoot) await rm(baseRoot, { recursive: true, force: true });
    }
  });
}

export async function withMemoryChangeDetailSnapshot<T>(input: {
  home?: string;
  project: string;
  changeId: string;
  use: (snapshot: MemoryChangeDetailSnapshot) => Promise<T>;
}): Promise<T> {
  return withMemoryChangeCheckpointLock(input, async () => {
    const context = await resolveProjectContext({
      home: input.home,
      project: input.project,
      memoryScope: "canonical"
    });
    const change = await readReconciledChange(context.primary, input.changeId);
    const baseRoot = await mkdtemp(join(tmpdir(), "memsphere-change-detail-base-"));
    const previewRoot = await mkdtemp(join(tmpdir(), "memsphere-change-detail-preview-"));
    const scopeRevisionRoots: string[] = [];
    try {
      if (change.store_type === "managed") {
        await materializeGitMemoryRoot(context.primary.memoryRoot, change.base_revision, ".", baseRoot);
      } else {
        const source = change.source_worktree;
        if (!source) throw new Error(`Embedded ChangeSet ${change.id} has no source metadata`);
        await materializeGitMemoryRoot(source.repository_root, change.base_revision, source.memory_path, baseRoot);
      }
      await cp(baseRoot, previewRoot, { recursive: true });
      const materializedRevisions = new Map<string, string>();
      for (const scope of change.scope) {
        const revision = scope.added_revision ?? change.base_revision;
        if (revision === change.base_revision) continue;
        let revisionRoot = materializedRevisions.get(revision);
        if (!revisionRoot) {
          revisionRoot = await mkdtemp(join(tmpdir(), "memsphere-change-scope-revision-"));
          scopeRevisionRoots.push(revisionRoot);
          if (change.store_type === "managed") {
            await materializeGitMemoryRoot(context.primary.memoryRoot, revision, ".", revisionRoot);
          } else {
            const source = change.source_worktree;
            if (!source) throw new Error(`Embedded ChangeSet ${change.id} has no source metadata`);
            await materializeGitMemoryRoot(source.repository_root, revision, source.memory_path, revisionRoot);
          }
          materializedRevisions.set(revision, revisionRoot);
        }
        const sourcePath = join(revisionRoot, scope.path);
        if (!await exists(sourcePath)) {
          throw new Error(`scoped Memory is unavailable at its added revision: ${scope.path}`);
        }
        for (const destinationRoot of [baseRoot, previewRoot]) {
          const destination = join(destinationRoot, scope.path);
          await mkdir(dirname(destination), { recursive: true });
          await cp(sourcePath, destination);
        }
      }
      if (change.targets.length > 0) {
        const candidateRoot = change.checkpoint
          ? checkpointMemoryRoot(context.primary, change.id, change.checkpoint.digest)
          : change.intent === "market_import" ? marketCandidateRoot(context.primary, change.id) : undefined;
        if (candidateRoot && await exists(candidateRoot)) {
          await applyTargets(previewRoot, candidateRoot, change.targets);
        }
      }
      const targetsByPath = new Map(change.targets.map((target) => [target.destination_path ?? target.path, target]));
      const scopeByPath = new Map(change.scope.map((scope) => [scope.path, scope]));
      for (const target of change.targets) {
        const path = target.destination_path ?? target.path;
        if (!scopeByPath.has(path)) {
          scopeByPath.set(path, {
            reference: target.reference,
            path,
            base_digest: target.base_digest ?? "created",
            added_revision: target.added_revision,
            added_at: change.updated_at
          });
        }
      }
      const files = [...scopeByPath.values()].map((scope) => {
        const target = targetsByPath.get(scope.path);
        return {
          reference: scope.reference,
          label: scope.path,
          path: join(target?.operation === "delete" ? baseRoot : previewRoot, scope.path),
          operation: target?.operation ?? "unchanged" as const
        };
      }).sort((left, right) => {
        const changed = Number(right.operation !== "unchanged") - Number(left.operation !== "unchanged");
        return changed || left.label.localeCompare(right.label);
      });
      return await input.use({ change, memoryRoot: previewRoot, files });
    } finally {
      await rm(baseRoot, { recursive: true, force: true });
      await rm(previewRoot, { recursive: true, force: true });
      await Promise.all(scopeRevisionRoots.map((root) => rm(root, { recursive: true, force: true })));
    }
  });
}

export async function withMemoryChangeCheckpointLock<T>(
  input: { home?: string; project: string },
  action: () => Promise<T>
): Promise<T> {
  const context = await resolveProjectContext({ home: input.home, project: input.project });
  return withFileLock(memoryMutationLock(context.primary), action);
}

async function prepareMemoryChangePreview(input: {
  home?: string;
  project: string;
  changeId: string;
}): Promise<PreparedMemoryChangePreview> {
  const context = await resolveProjectContext({ home: input.home, project: input.project });
  const change = await readReconciledChange(context.primary, input.changeId);
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
    if (change.store_type === "managed") {
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
  /** Internal lifecycle hook for callers that must persist diagnostics after any post-create failure. */
  onChangeCreated?: (created: { change: MemoryChangeSet; candidateRoot: string }) => void;
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
  input.onChangeCreated?.({ change, candidateRoot });
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

export async function createMarketMemoryChange(input: {
  home?: string;
  project: string;
  actor: MemoryChangeActor;
  targets: Array<{ reference: string; path: string; source: Buffer }>;
}): Promise<MemoryChangeSet> {
  if (input.targets.length === 0) throw new Error("market import requires at least one Memory");
  const initial = await resolveProjectContext({ home: input.home, project: input.project, memoryScope: "canonical" });
  return withFileLock(memoryMutationLock(initial.primary), async () => {
    const project = (await resolveProjectContext({
      home: input.home,
      project: input.project,
      memoryScope: "canonical"
    })).primary;
    const actor = memoryChangeActorSchema.parse(input.actor);
    const existing = (await listProjectChangesBestEffort(project)).changes.find((change) => (
      change.status === "active"
      && change.intent === "market_import"
    ));
    const identity = await canonicalChangeIdentity(project);
    const change = existing ?? newChange(project, identity.workspace.key, {
        origin: "view",
        actor,
        baseRevision: identity.baseRevision
      });
    if (existing?.claim) {
      throw new Error("cannot import another market Memory while the ChangeSet is claimed; finish the claim, then import again");
    }
    if (!existing) {
      change.intent = "market_import";
      change.store_type = project.config.store.type;
      if (identity.source) change.source_worktree = identity.source;
    }
    const candidateRoot = marketCandidateRoot(project, change.id);
    const writtenCandidates: string[] = [];
    try {
      const files = await readAllMemoryFiles(project.memoryRoot);
      for (const source of input.targets) {
        if (change.targets.some((target) => target.reference === source.reference)) continue;
        const logical = parseLogicalMemoryReference(source.reference);
        if (!logical) throw new Error(`invalid market Memory reference: ${source.reference}`);
        assertSafeCreatePath(source.reference, source.path);
        const existsByReference = files.some((file) => (
          file.kind === logical.kind && file.entity.names[0] === logical.name
        ));
        const target = await resolveTarget(
          project,
          source.reference,
          "edit",
          existsByReference ? undefined : source.path,
          change.base_revision
        );
        if (change.targets.some((item) => item.path === target.path)) {
          throw new Error(`market import targets the same Memory path more than once: ${target.path}`);
        }
        const candidate = join(candidateRoot, target.path);
        await mkdir(dirname(candidate), { recursive: true });
        await writeFile(candidate, source.source);
        writtenCandidates.push(candidate);
        const parsed = await readMemoryFile(logical.kind, candidate);
        if (parsed.entity.names[0] !== logical.name) {
          throw new Error(`market Memory identity does not match source content: ${source.reference}`);
        }
        change.targets.push(target);
      }
      if (writtenCandidates.length === 0) return change;
      change.targets.sort((left, right) => left.path.localeCompare(right.path));
      delete change.checkpoint;
      delete change.candidate_revision;
      change.updated_at = new Date().toISOString();
      await writeChange(project, change);
      return change;
    } catch (error) {
      if (existing) {
        await Promise.all(writtenCandidates.map((candidate) => rm(candidate, { force: true }).catch(() => undefined)));
      } else {
        await rm(join(project.paths.changesRoot, change.id), { recursive: true, force: true }).catch(() => undefined);
      }
      throw error;
    }
  });
}

/** Internal-only edit entrypoint for a caller that already resolved canonical identity and storage path. */
export async function editMemoriesByIdentity(input: {
  targets: Array<{
    reference: string;
    path: string;
    operation: "create" | "update";
    baseDigest?: string;
  }>;
  changeId?: string;
  onChangeCreated?: (created: { change: MemoryChangeSet; candidateRoot: string }) => void;
}): Promise<{ change: MemoryChangeSet; candidateRoot: string }> {
  if (input.targets.length === 0) throw new Error("provide at least one Memory identity target");
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  assertManaged(context.primary);
  const workspace = await resolveWorkspaceIdentity();
  const revision = context.primary.config.store.published_revision;
  const targets: Array<z.infer<typeof changeTargetSchema>> = [];
  const seen = new Set<string>();
  for (const target of input.targets) {
    assertSafeCreatePath(target.reference, target.path);
    if (seen.has(target.path)) throw new Error(`duplicate Memory identity path: ${target.path}`);
    seen.add(target.path);
    const source = join(context.primary.memoryRoot, target.path);
    if (target.operation === "create") {
      if (await exists(source)) throw new Error(`explicit create path already exists: ${target.path}`);
      targets.push({
        operation: "create",
        reference: target.reference,
        path: target.path,
        added_revision: revision
      });
      continue;
    }
    if (!target.baseDigest) throw new Error(`update identity requires a base digest: ${target.reference}`);
    if (!await exists(source)) throw new Error(`Memory identity path is missing: ${target.path}`);
    const currentDigest = await gitBlobDigest(context.primary.memoryRoot, target.path);
    if (currentDigest !== target.baseDigest) {
      throw new Error(`Memory identity changed before update: ${target.reference}`);
    }
    targets.push({
      operation: "update",
      reference: target.reference,
      path: target.path,
      base_digest: target.baseDigest,
      added_revision: revision
    });
  }
  const change = input.changeId
    ? await readChange(context.primary, input.changeId)
    : await createChange(context.primary, workspace.key);
  assertDraftOwner(change, context.primary.name, workspace.key);
  const candidateRoot = workspaceCandidateRoot(workspace.path, change.id);
  input.onChangeCreated?.({ change, candidateRoot });
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
    const candidate = join(candidateRoot, target.path);
    await mkdir(dirname(candidate), { recursive: true });
    if (target.operation === "update") await cp(join(context.primary.memoryRoot, target.path), candidate);
    else await writeFile(candidate, newMemoryTemplate(target.reference), "utf8");
  }
  change.updated_at = new Date().toISOString();
  await writeChange(context.primary, change);
  return { change, candidateRoot };
}

/** Internal-only deletion entrypoint for a caller that already verified historical path and canonical identity. */
export async function deleteMemoriesByIdentity(input: {
  targets: Array<{ reference: string; path: string; baseDigest: string }>;
  changeId?: string;
  onChangeCreated?: (created: { change: MemoryChangeSet; candidateRoot: string }) => void;
}): Promise<{ change: MemoryChangeSet; candidateRoot: string }> {
  if (input.targets.length === 0) throw new Error("provide at least one Memory identity target");
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  assertManaged(context.primary);
  const workspace = await resolveWorkspaceIdentity();
  const revision = context.primary.config.store.published_revision;
  const targets: Array<z.infer<typeof changeTargetSchema>> = [];
  const seen = new Set<string>();
  for (const target of input.targets) {
    assertSafeMemoryPath(target.path);
    if (!target.reference.trim() || target.reference.includes("\0")) {
      throw new Error(`invalid historical Memory identity: ${target.reference}`);
    }
    if (seen.has(target.path)) throw new Error(`duplicate historical Memory path: ${target.path}`);
    seen.add(target.path);
    const source = join(context.primary.memoryRoot, target.path);
    if (!await exists(source)) throw new Error(`historical Memory path is missing: ${target.path}`);
    const currentDigest = await gitBlobDigest(context.primary.memoryRoot, target.path);
    if (currentDigest !== target.baseDigest) {
      throw new Error(`historical Memory identity changed before deletion: ${target.reference}`);
    }
    targets.push({
      operation: "delete",
      reference: target.reference,
      path: target.path,
      base_digest: target.baseDigest,
      added_revision: revision
    });
  }
  const change = input.changeId
    ? await readChange(context.primary, input.changeId)
    : await createChange(context.primary, workspace.key);
  assertDraftOwner(change, context.primary.name, workspace.key);
  const candidateRoot = workspaceCandidateRoot(workspace.path, change.id);
  input.onChangeCreated?.({ change, candidateRoot });
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
    const candidate = join(candidateRoot, target.path);
    await mkdir(dirname(candidate), { recursive: true });
    await cp(join(context.primary.memoryRoot, target.path), candidate);
  }
  change.updated_at = new Date().toISOString();
  await writeChange(context.primary, change);
  return { change, candidateRoot };
}

export async function editEmbeddedMemories(references: string[]): Promise<EmbeddedMemoryEditResult> {
  if (references.length === 0) throw new Error("provide at least one Memory reference");
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  if (context.primary.config.store.type !== "embedded") {
    throw new Error("Embedded Memory editing is only available for an Embedded Project");
  }
  const targets = await Promise.all(references.map(async (reference) => {
    const target = await resolveTarget(context.primary, reference, "edit");
    if (target.operation !== "create" && target.operation !== "update") {
      throw new Error(`unsupported Embedded Memory edit operation: ${target.operation}`);
    }
    return { reference: target.reference, path: target.path, operation: target.operation };
  }));
  const seen = new Map<string, string>();
  for (const target of targets) {
    const existing = seen.get(target.path);
    if (existing && existing !== target.reference) {
      throw new Error(`Memory path is targeted by multiple references: ${target.path}`);
    }
    seen.set(target.path, target.reference);
  }
  for (const target of targets) {
    if (target.operation !== "create") continue;
    const destination = join(context.primary.memoryRoot, target.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, newMemoryTemplate(target.reference), "utf8");
  }
  return {
    repositoryRoot: context.primary.config.store.repository_path,
    workspaceRoot: context.workspace.path,
    memoryRoot: context.primary.memoryRoot,
    targets
  };
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
    if (!change || change.status !== "active" || change.workspace_key !== workspace.key) continue;
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
  const workspace = await resolveWorkspaceIdentity();
  return withFileLock(memoryMutationLock(initialContext.primary), async () => {
    const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
    const change = await readReconciledChange(context.primary, changeId);
    if (context.primary.config.store.type === "embedded") {
      if (change.intent !== "market_import") {
        throw new Error("Managed Memory ChangeSets are not available for an Embedded Project");
      }
      return applyEmbeddedMarketChange(context.primary, change, workspace);
    }
    assertManaged(context.primary);
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

export async function failMemoryChange(
  changeId: string,
  stage: "prepare" | "validate" | "publish",
  error: unknown
): Promise<MemoryChangeSet> {
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  assertManaged(context.primary);
  const workspace = await resolveWorkspaceIdentity();
  const change = await readChange(context.primary, changeId);
  assertDraftOwner(change, context.primary.name, workspace.key);
  const failed = memoryChangeSetSchema.parse({
    ...change,
    status: "abandoned",
    claim: undefined,
    failure: {
      stage,
      failed_at: new Date().toISOString(),
      summary: safeFailureSummary(error)
    },
    updated_at: new Date().toISOString()
  });
  await writeChange(context.primary, failed);
  return failed;
}

export async function validateMemoryChange(
  changeId?: string,
  options: { onLockWait?: () => void } = {}
): Promise<MemoryChangeValidationResult> {
  const initialContext = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  const workspace = await resolveWorkspaceIdentity();
  return withFileLock(memoryMutationLock(initialContext.primary), async () => {
    const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
    if (context.primary.config.store.type === "managed") {
      await assertManagedHealthy(context.primary);
      const resolvedId = changeId ?? await resolveSingleManagedActive(context.primary, workspace);
      const change = await readReconciledChange(context.primary, resolvedId);
      assertDraftOwner(change, context.primary.name, workspace.key);
      if (change.store_type !== "managed") throw new Error(`ChangeSet ${change.id} is not a Managed ChangeSet`);
      const candidateRoot = workspaceCandidateRoot(workspace.path, resolvedId);
      if (!await exists(candidateRoot)) throw new Error(`ChangeSet candidate is missing: ${candidateRoot}`);
      const effectiveChange = change.origin === "view"
        ? await resolveViewManagedTargets(change, candidateRoot, context.primary.memoryRoot)
        : await resolveEffectiveSyncTargets(change, candidateRoot);
      await assertChangeTargetsCurrent(context.primary, effectiveChange);
      const checkpointCandidate = await snapshotSparseCandidate(candidateRoot, effectiveChange.targets);
      try {
        const issues = await validateEffectiveMemoryChange(
          context.primary,
          effectiveChange,
          checkpointCandidate,
          candidateRoot
        );
        if (change.intent === "market_import") {
          const centralCandidateRoot = marketCandidateRoot(context.primary, change.id);
          await rm(centralCandidateRoot, { recursive: true, force: true });
          await mkdir(dirname(centralCandidateRoot), { recursive: true });
          await cp(candidateRoot, centralCandidateRoot, { recursive: true });
        }
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

    if (changeId) {
      const marketChange = await readReconciledChange(context.primary, changeId);
      if (marketChange.intent === "market_import") {
        if (marketChange.status !== "active") throw new Error(`ChangeSet ${marketChange.id} is already ${marketChange.status}`);
        if (marketChange.store_type !== "embedded") throw new Error(`ChangeSet ${marketChange.id} is not an Embedded ChangeSet`);
        const source = marketChange.source_worktree;
        if (!source || workspace.kind !== "git" || workspace.key !== marketChange.workspace_key) {
          throw new Error(`Embedded market ChangeSet ${marketChange.id} belongs to another Git workspace`);
        }
        const centralCandidateRoot = marketCandidateRoot(context.primary, marketChange.id);
        const claimedCandidateRoot = marketChange.claim?.instance_key === workspace.instanceKey
          ? workspaceCandidateRoot(workspace.path, marketChange.id)
          : undefined;
        const candidateRoot = claimedCandidateRoot && await exists(claimedCandidateRoot)
          ? claimedCandidateRoot
          : centralCandidateRoot;
        if (!await exists(candidateRoot)) throw new Error(`ChangeSet candidate is missing: ${candidateRoot}`);
        const checkpointCandidate = await snapshotSparseCandidate(candidateRoot, marketChange.targets);
        try {
          const issues = await validateEffectiveMemoryChange(
            context.primary,
            marketChange,
            checkpointCandidate,
            candidateRoot
          );
          if (candidateRoot !== centralCandidateRoot) {
            await rm(centralCandidateRoot, { recursive: true, force: true });
            await mkdir(dirname(centralCandidateRoot), { recursive: true });
            await cp(candidateRoot, centralCandidateRoot, { recursive: true });
          }
          const checkpointRoot = await persistValidatedCheckpoint(
            context.primary,
            marketChange,
            checkpointCandidate,
            marketChange.base_revision,
            issues,
            context.primary.memoryRoot,
            candidateRoot
          );
          return validationResult(
            marketChange,
            context.primary.memoryRoot,
            candidateRoot,
            checkpointRoot,
            marketChange.base_revision,
            issues
          );
        } finally {
          await rm(resolve(checkpointCandidate, ".."), { recursive: true, force: true });
        }
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
        issues,
        captured.completedChangeIds
      );
    } finally {
      await rm(resolve(captured.candidateRoot, ".."), { recursive: true, force: true });
    }
  }, { onWait: options.onLockWait });
}

async function resolveSingleManagedActive(project: ResolvedProject, workspace: WorkspaceIdentity): Promise<string> {
  const root = resolve(workspace.path, ".memsphere-work", "changes");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isCode(error, "ENOENT")) {
      throw new Error("no active Managed ChangeSet was found in the current Workspace; run memsphere memory edit or provide a change id");
    }
    throw error;
  }
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^change-[a-zA-Z0-9-]+$/.test(entry.name)) continue;
    const change = await readChange(project, entry.name).catch(() => undefined);
    if (
      change?.status === "active"
      && change.project === project.name
      && change.workspace_key === workspace.key
      && change.store_type === "managed"
      && await exists(join(root, entry.name, "memory"))
    ) ids.push(entry.name);
  }
  ids.sort();
  if (ids.length === 1) return ids[0];
  if (ids.length === 0) {
    throw new Error("no active Managed ChangeSet was found in the current Workspace; run memsphere memory edit or provide a change id");
  }
  throw new Error(`multiple active Managed ChangeSets were found; provide one explicitly: ${ids.join(", ")}`);
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

async function resolveViewManagedTargets(
  change: MemoryChangeSet,
  candidateRoot: string,
  gitRoot: string
): Promise<MemoryChangeSet> {
  const scopedPaths = new Set(change.scope.map((item) => item.path));
  const targets = change.targets.filter((target) => !scopedPaths.has(target.path));
  for (const scoped of change.scope) {
    const candidate = join(candidateRoot, scoped.path);
    if (!await exists(candidate)) {
      targets.push({
        operation: "delete",
        reference: scoped.reference,
        path: scoped.path,
        base_digest: scoped.base_digest,
        added_revision: scoped.added_revision ?? change.base_revision
      });
      continue;
    }
    await assertRegularFileInside(candidateRoot, scoped.path);
    const digest = await gitOutput(["hash-object", "--", candidate], gitRoot);
    if (digest === scoped.base_digest) continue;
    targets.push({
      operation: "update",
      reference: scoped.reference,
      path: scoped.path,
      base_digest: scoped.base_digest,
      added_revision: scoped.added_revision ?? change.base_revision
    });
  }
  targets.sort((left, right) => left.path.localeCompare(right.path));
  return memoryChangeSetSchema.parse({ ...change, targets });
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
  const checkpointChanged = change.checkpoint?.digest !== digest;
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
  if (checkpointChanged && change.store_type === "embedded") delete change.candidate_revision;
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
  issues: ValidationIssue[],
  completedChangeIds: string[] = []
): MemoryChangeValidationResult {
  if (!change.checkpoint) throw new Error(`ChangeSet ${change.id} checkpoint was not persisted`);
  return {
    changeId: change.id,
    memoryRoot,
    candidateRoot,
    storeType: change.store_type,
    baseRevision,
    checkpointDigest: change.checkpoint.digest,
    completedChangeIds,
    issues
  };
}

type EmbeddedCapture = {
  change: MemoryChangeSet;
  candidateRoot: string;
  memoryRoot: string;
  completedChangeIds: string[];
};

async function captureEmbeddedWorkingChange(
  project: ResolvedProject,
  workspace: WorkspaceIdentity,
  requestedId?: string
): Promise<EmbeddedCapture> {
  if (project.config.store.type !== "embedded") throw new Error("Embedded ChangeSet capture requires an Embedded Project");
  if (workspace.kind !== "git") throw new Error("Embedded ChangeSet validation must run inside a Git worktree");
  const configuredRepository = await resolveWorkspaceIdentity(project.config.store.repository_path);
  if (configuredRepository.kind !== "git" || configuredRepository.key !== workspace.key) {
    throw new Error(`Embedded Project "${project.name}" does not belong to the current Git repository`);
  }
  const memoryPath = project.config.store.memory_path;
  const memoryRoot = project.memoryRoot;
  if (!await exists(memoryRoot)) throw new Error(`Embedded Memory root is missing in the current worktree: ${memoryRoot}`);
  const baseRevision = await gitOutput(["rev-parse", "HEAD"], workspace.path);
  const source = {
    instance_key: workspace.instanceKey,
    root: workspace.path,
    repository_root: configuredRepository.path,
    memory_path: memoryPath
  };
  const captured = await captureEmbeddedTargets(workspace.path, memoryRoot, memoryPath, baseRevision);
  if (captured.targets.length === 0) {
    await rm(resolve(captured.candidateRoot, ".."), { recursive: true, force: true });
    throw new Error("no Embedded Memory changes were found relative to the current HEAD");
  }

  let change: MemoryChangeSet;
  try {
    if (requestedId) {
      change = await readReconciledChange(project, requestedId);
      assertDraftOwner(change, project.name, workspace.key);
      if (change.store_type !== "embedded") throw new Error(`ChangeSet ${change.id} is not an Embedded ChangeSet`);
      if (change.base_revision !== baseRevision) {
        if (change.origin !== "view") {
          throw new Error(`Embedded ChangeSet ${change.id} belongs to another Git base revision`);
        }
        await forwardEmbeddedViewBase(change, workspace.path, memoryPath, baseRevision);
      }
    } else {
      const projectChanges = await listProjectChanges(project, true);
      const completedChangeIds: string[] = [];
      const matches = projectChanges.filter((candidate) => (
        candidate.status === "active"
        && candidate.store_type === "embedded"
        && candidate.workspace_key === workspace.key
        && candidate.base_revision === baseRevision
      ));
      if (matches.length > 1) {
        const digest = await checkpointDigest(captured.targets, captured.candidateRoot);
        const exact = matches.filter((candidate) => candidate.checkpoint?.digest === digest)
          .sort((left, right) => left.created_at.localeCompare(right.created_at));
        if (exact.length !== matches.length) {
          throw new Error(`multiple divergent Embedded ChangeSets were found for the current repository and Git base: ${matches.map((item) => item.id).sort().join(", ")}`);
        }
        change = exact[0];
        for (const duplicate of matches) {
          if (duplicate.id === change.id) continue;
          if (duplicate.comments.length > 0 || duplicate.scope.length > 0 || duplicate.claim || duplicate.origin === "view") {
            throw new Error(`duplicate Embedded ChangeSet ${duplicate.id} contains user data and must be resolved explicitly`);
          }
          duplicate.status = "abandoned";
          duplicate.updated_at = new Date().toISOString();
          await writeChange(project, duplicate);
        }
      } else {
        change = matches[0] ?? newChange(project, workspace.key);
      }
      change.store_type = "embedded";
      change.base_revision = baseRevision;
      change.source_worktree = source;
      change.targets = captured.targets;
      return { change, candidateRoot: captured.candidateRoot, memoryRoot, completedChangeIds };
    }
    change.store_type = "embedded";
    change.base_revision = baseRevision;
    change.source_worktree = source;
    change.targets = captured.targets;
    return { change, candidateRoot: captured.candidateRoot, memoryRoot, completedChangeIds: [] };
  } catch (error) {
    await rm(resolve(captured.candidateRoot, ".."), { recursive: true, force: true });
    throw error;
  }
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

function embeddedRepositoryPath(memoryPath: string, memoryRelativePath: string): string {
  const normalizedRoot = memoryPath === "." ? "" : memoryPath.replace(/^\.\//, "").replace(/\/$/, "");
  return normalizedRoot ? `${normalizedRoot}/${memoryRelativePath}` : memoryRelativePath;
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

async function listProjectChanges(project: ResolvedProject, reconcile = false): Promise<MemoryChangeSet[]> {
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
    const change = await (reconcile ? readReconciledChange(project, entry.name) : readChange(project, entry.name));
    changes.push(change);
  }
  return changes;
}

async function listProjectChangesBestEffort(project: ResolvedProject): Promise<{
  changes: MemoryChangeSet[];
  failures: Array<{ id: string; error: string }>;
}> {
  let entries;
  try {
    entries = await readdir(project.paths.changesRoot, { withFileTypes: true });
  } catch (error) {
    if (isCode(error, "ENOENT")) return { changes: [], failures: [] };
    throw error;
  }
  const changes: MemoryChangeSet[] = [];
  const failures: Array<{ id: string; error: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^change-[a-zA-Z0-9-]+$/.test(entry.name)) continue;
    try {
      changes.push(await readReconciledChange(project, entry.name));
    } catch (error) {
      if (!(error instanceof MemoryChangeIntegrityError)) throw error;
      failures.push({
        id: entry.name,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { changes, failures };
}

function sortMemoryChanges(changes: MemoryChangeSet[]): MemoryChangeSet[] {
  return changes.sort((left, right) => {
    const activity = Number(right.status === "active") - Number(left.status === "active");
    return activity || right.updated_at.localeCompare(left.updated_at);
  });
}

export async function listMemoryChanges(input: { home?: string; project: string }): Promise<MemoryChangeSet[]> {
  const context = await resolveProjectContext({ home: input.home, project: input.project });
  return withFileLock(memoryMutationLock(context.primary), async () => {
    const changes = await listProjectChanges(context.primary, true);
    return sortMemoryChanges(changes);
  });
}

export async function listMemoryChangesBestEffort(input: { home?: string; project: string }): Promise<{
  changes: MemoryChangeSet[];
  failures: Array<{ id: string; error: string }>;
}> {
  const context = await resolveProjectContext({ home: input.home, project: input.project });
  return withFileLock(memoryMutationLock(context.primary), async () => {
    const result = await listProjectChangesBestEffort(context.primary);
    return {
      changes: sortMemoryChanges(result.changes),
      failures: result.failures.sort((left, right) => right.id.localeCompare(left.id))
    };
  });
}

export async function readMemoryChange(input: { home?: string; project: string; changeId: string }): Promise<MemoryChangeSet> {
  const context = await resolveProjectContext({ home: input.home, project: input.project });
  return withFileLock(memoryMutationLock(context.primary), () => readReconciledChange(context.primary, input.changeId));
}

export async function createViewMemoryChange(input: {
  home?: string;
  project: string;
  reference: string;
  actor: MemoryChangeActor;
}): Promise<MemoryChangeSet> {
  const context = await resolveProjectContext({
    home: input.home,
    project: input.project,
    memoryScope: "canonical"
  });
  return withFileLock(memoryMutationLock(context.primary), async () => {
    const project = (await resolveProjectContext({
      home: input.home,
      project: input.project,
      memoryScope: "canonical"
    })).primary;
    const actor = memoryChangeActorSchema.parse(input.actor);
    const identity = await canonicalChangeIdentity(project);
    const target = await resolveTarget(project, input.reference, "edit", undefined, identity.baseRevision);
    if (target.operation !== "update" || !target.base_digest) {
      throw new Error("View can only create a ChangeSet from an existing Memory");
    }
    const change = newChange(project, identity.workspace.key, {
      origin: "view",
      actor,
      baseRevision: identity.baseRevision
    });
    change.store_type = project.config.store.type;
    change.scope.push({
      reference: target.reference,
      path: target.path,
      base_digest: target.base_digest,
      added_revision: target.added_revision,
      added_at: change.created_at
    });
    if (identity.source) change.source_worktree = identity.source;
    await writeChange(project, change);
    return change;
  });
}

export async function addMemoryChangeScope(input: {
  home?: string;
  project: string;
  changeId: string;
  reference: string;
  expectedUpdatedAt?: string;
}): Promise<MemoryChangeSet> {
  const initial = await resolveProjectContext({ home: input.home, project: input.project, memoryScope: "canonical" });
  return withFileLock(memoryMutationLock(initial.primary), async () => {
    const project = (await resolveProjectContext({
      home: input.home,
      project: input.project,
      memoryScope: "canonical"
    })).primary;
    const change = await readReconciledChange(project, input.changeId);
    assertMutableChange(change, input.expectedUpdatedAt);
    if (change.claim) {
      throw new Error("cannot add Memory while the ChangeSet is claimed; finish the claim, add Memory, then claim again");
    }
    const identity = await canonicalChangeIdentity(project);
    const target = await resolveTarget(project, input.reference, "edit", undefined, identity.baseRevision);
    if (target.operation !== "update" || !target.base_digest) {
      throw new Error("View can only add an existing Memory to a ChangeSet");
    }
    if (!change.scope.some((item) => item.path === target.path)) {
      change.scope.push({
        reference: target.reference,
        path: target.path,
        base_digest: target.base_digest,
        added_revision: target.added_revision,
        added_at: new Date().toISOString()
      });
      change.updated_at = new Date().toISOString();
      await writeChange(project, change);
    }
    return change;
  });
}

export async function abandonMemoryChange(input: {
  home?: string;
  project: string;
  changeId: string;
  expectedUpdatedAt?: string;
}): Promise<MemoryChangeSet> {
  const initial = await resolveProjectContext({ home: input.home, project: input.project, memoryScope: "canonical" });
  return withFileLock(memoryMutationLock(initial.primary), async () => {
    const project = (await resolveProjectContext({
      home: input.home,
      project: input.project,
      memoryScope: "canonical"
    })).primary;
    const change = await readReconciledChange(project, input.changeId);
    assertMutableChange(change, input.expectedUpdatedAt);
    change.status = "abandoned";
    delete change.claim;
    change.updated_at = new Date().toISOString();
    await writeChange(project, change);
    return change;
  });
}

export async function archiveMemoryChange(input: {
  home?: string;
  project: string;
  changeId: string;
  expectedUpdatedAt?: string;
}): Promise<ArchiveEntry> {
  const initial = await resolveProjectContext({ home: input.home, project: input.project, memoryScope: "canonical" });
  return withFileLock(memoryMutationLock(initial.primary), async () => {
    const project = (await resolveProjectContext({
      home: input.home,
      project: input.project,
      memoryScope: "canonical"
    })).primary;
    const change = await readReconciledChange(project, input.changeId);
    if (change.status === "active") throw new Error("only terminal ChangeSets can be archived");
    if (input.expectedUpdatedAt && change.updated_at !== input.expectedUpdatedAt) {
      throw new Error(`ChangeSet ${change.id} was modified by another operation`);
    }
    return archiveChangeDirectory({
      archiveRoot: project.paths.archiveRoot,
      changesRoot: project.paths.changesRoot,
      id: change.id
    });
  });
}

export async function createMemoryChangeComment(input: {
  home?: string;
  project: string;
  changeId: string;
  actor: MemoryChangeActor;
  memoryReference: string;
  path: string;
  target?: string;
  location?: { anchor: string; line: number; hash?: string };
  snapshot?: string;
  body: string;
  expectedUpdatedAt?: string;
}): Promise<{ change: MemoryChangeSet; comment: MemoryChangeComment }> {
  const initial = await resolveProjectContext({ home: input.home, project: input.project, memoryScope: "canonical" });
  return withFileLock(memoryMutationLock(initial.primary), async () => {
    const project = (await resolveProjectContext({
      home: input.home,
      project: input.project,
      memoryScope: "canonical"
    })).primary;
    const change = await readReconciledChange(project, input.changeId);
    assertMutableChange(change, input.expectedUpdatedAt);
    const actor = memoryChangeActorSchema.parse(input.actor);
    const body = input.body.trim();
    if (!body) throw new Error("Comment body is required");
    assertSafeMemoryPath(input.path);
    const scoped = change.scope.some((item) => item.path === input.path)
      || change.targets.some((item) => (item.destination_path ?? item.path) === input.path);
    if (!scoped) throw new Error(`Memory is not part of ChangeSet ${change.id}: ${input.path}`);
    const now = new Date().toISOString();
    const comment = memoryChangeCommentSchema.parse({
      id: changeCommentId(),
      status: "pending",
      submitted_by: actor,
      memory_reference: input.memoryReference,
      path: input.path,
      ...(input.target ? { target: input.target } : {}),
      ...(input.location ? { location: input.location } : {}),
      ...(input.snapshot !== undefined ? { snapshot: input.snapshot } : {}),
      ...(change.checkpoint ? { checkpoint_digest: change.checkpoint.digest } : {}),
      base_revision: change.checkpoint?.base_revision ?? change.base_revision,
      body,
      created_at: now,
      updated_at: now
    });
    change.comments.push(comment);
    change.updated_at = now;
    await writeChange(project, change);
    return { change, comment };
  });
}

export async function updateMemoryChangeComment(input: {
  home?: string;
  project: string;
  changeId: string;
  commentId: string;
  actor: MemoryChangeActor;
  body?: string;
  withdraw?: boolean;
  expectedUpdatedAt?: string;
}): Promise<{ change: MemoryChangeSet; comment: MemoryChangeComment }> {
  const initial = await resolveProjectContext({ home: input.home, project: input.project, memoryScope: "canonical" });
  return withFileLock(memoryMutationLock(initial.primary), async () => {
    const project = (await resolveProjectContext({
      home: input.home,
      project: input.project,
      memoryScope: "canonical"
    })).primary;
    const change = await readReconciledChange(project, input.changeId);
    assertMutableChange(change, input.expectedUpdatedAt);
    const actor = memoryChangeActorSchema.parse(input.actor);
    const comment = change.comments.find((item) => item.id === input.commentId);
    if (!comment) throw new Error(`Comment not found: ${input.commentId}`);
    assertSameChangeActor(comment.submitted_by, actor);
    if (input.withdraw) {
      if (comment.status !== "processing") throw new Error("only processing Comments can be withdrawn");
      comment.status = "completed";
    } else {
      if (comment.status !== "pending") throw new Error("only pending Comments can be edited");
      const body = input.body?.trim();
      if (!body) throw new Error("Comment body is required");
      comment.body = body;
    }
    const now = new Date().toISOString();
    comment.updated_at = now;
    change.updated_at = now;
    await writeChange(project, change);
    return { change, comment };
  });
}

export async function deleteMemoryChangeComment(input: {
  home?: string;
  project: string;
  changeId: string;
  commentId: string;
  actor: MemoryChangeActor;
  expectedUpdatedAt?: string;
}): Promise<MemoryChangeSet> {
  const initial = await resolveProjectContext({ home: input.home, project: input.project, memoryScope: "canonical" });
  return withFileLock(memoryMutationLock(initial.primary), async () => {
    const project = (await resolveProjectContext({
      home: input.home,
      project: input.project,
      memoryScope: "canonical"
    })).primary;
    const change = await readReconciledChange(project, input.changeId);
    assertMutableChange(change, input.expectedUpdatedAt);
    const actor = memoryChangeActorSchema.parse(input.actor);
    const index = change.comments.findIndex((item) => item.id === input.commentId);
    if (index < 0) throw new Error(`Comment not found: ${input.commentId}`);
    const comment = change.comments[index];
    assertSameChangeActor(comment.submitted_by, actor);
    if (comment.status !== "pending") throw new Error("only pending Comments can be deleted");
    change.comments.splice(index, 1);
    change.updated_at = new Date().toISOString();
    await writeChange(project, change);
    return change;
  });
}

export async function claimMemoryChange(input: {
  changeId: string;
  force?: boolean;
}): Promise<{ change: MemoryChangeSet; candidateRoot: string; warnings: string[] }> {
  const initial = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  const workspace = await resolveWorkspaceIdentity();
  return withFileLock(memoryMutationLock(initial.primary), async () => {
    const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
    const change = await readReconciledChange(context.primary, input.changeId);
    if (change.status !== "active") throw new Error(`ChangeSet ${change.id} is already ${change.status}`);
    if (change.project !== context.primary.name) throw new Error(`ChangeSet belongs to Project "${change.project}"`);
    if (change.claim && change.claim.instance_key !== workspace.instanceKey && !input.force) {
      throw new Error(`ChangeSet ${change.id} is already claimed by ${change.claim.root}; use --force to take over`);
    }
    if (change.claim?.instance_key === workspace.instanceKey) {
      const candidateRoot = change.store_type === "managed"
        ? workspaceCandidateRoot(workspace.path, change.id)
        : change.intent === "market_import"
          ? workspaceCandidateRoot(workspace.path, change.id)
          : context.primary.memoryRoot;
      if (await exists(candidateRoot)) {
        return {
          change,
          candidateRoot,
          warnings: ["ChangeSet is already claimed by this Workspace; the existing candidate was preserved"]
        };
      }
    }
    if (change.origin === "view") change.workspace_key = workspace.key;
    else if (change.workspace_key !== workspace.key) throw new Error(`ChangeSet ${change.id} belongs to another Workspace`);
    const warnings = await prepareClaimCandidate(context.primary, change, workspace);
    const now = new Date().toISOString();
    change.claim = {
      workspace_key: workspace.key,
      instance_key: workspace.instanceKey,
      root: workspace.path,
      claimed_at: now
    };
    for (const comment of change.comments) {
      if (comment.status === "pending") {
        comment.status = "processing";
        comment.updated_at = now;
      }
    }
    change.updated_at = now;
    await writeChange(context.primary, change);
    return {
      change,
      candidateRoot: change.store_type === "managed"
        ? workspaceCandidateRoot(workspace.path, change.id)
        : change.intent === "market_import"
          ? workspaceCandidateRoot(workspace.path, change.id)
          : context.primary.memoryRoot,
      warnings
    };
  });
}

export async function finishMemoryChange(input: {
  changeId: string;
  commentIds?: string[];
  reason?: "fixed" | "rejected";
}): Promise<MemoryChangeSet> {
  const initial = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  const workspace = await resolveWorkspaceIdentity();
  return withFileLock(memoryMutationLock(initial.primary), async () => {
    const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
    const change = await readReconciledChange(context.primary, input.changeId);
    assertClaimOwner(change, context.primary.name, workspace);
    const ids = new Set(input.commentIds ?? []);
    if (ids.size > 0 && !input.reason) throw new Error("--reason is required when completing Comments");
    if (input.reason === "fixed" && !change.checkpoint?.valid) {
      throw new Error("fixed Comments require a valid ChangeSet checkpoint");
    }
    for (const id of ids) {
      const comment = change.comments.find((item) => item.id === id);
      if (!comment) throw new Error(`Comment not found: ${id}`);
      if (comment.status !== "processing") throw new Error(`Comment is not processing: ${id}`);
    }
    const unfinished = change.comments.filter((comment) => comment.status === "processing" && !ids.has(comment.id));
    if (unfinished.length > 0) {
      throw new Error(`finish must complete every processing Comment: ${unfinished.map((comment) => comment.id).join(", ")}`);
    }
    const now = new Date().toISOString();
    for (const comment of change.comments) {
      if (ids.has(comment.id)) {
        comment.status = "completed";
        comment.updated_at = now;
      }
    }
    delete change.claim;
    change.updated_at = now;
    await writeChange(context.primary, change);
    return change;
  });
}

export async function completeMemoryChange(changeId: string): Promise<MemoryChangeSet> {
  const initial = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  return withFileLock(memoryMutationLock(initial.primary), async () => {
    const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
    const change = await readReconciledChange(context.primary, changeId);
    if (change.status !== "active") throw new Error(`ChangeSet ${change.id} is already ${change.status}`);
    if (change.targets.length > 0) throw new Error("only a ChangeSet without actual Memory differences can be completed explicitly");
    if (change.comments.some((comment) => comment.status !== "completed")) {
      throw new Error("all ChangeSet Comments must be completed first");
    }
    change.status = "completed";
    delete change.claim;
    change.updated_at = new Date().toISOString();
    await writeChange(context.primary, change);
    return change;
  });
}

async function canonicalChangeIdentity(project: ResolvedProject): Promise<{
  workspace: WorkspaceIdentity;
  baseRevision: string;
  source?: z.infer<typeof sourceWorktreeSchema>;
}> {
  if (project.config.store.type === "managed") {
    return {
      workspace: await resolveWorkspaceIdentity(project.memoryRoot),
      baseRevision: project.config.store.published_revision
    };
  }
  const workspace = await resolveWorkspaceIdentity(project.config.store.repository_path);
  if (workspace.kind !== "git") throw new Error("Embedded Project repository must be a Git worktree");
  const baseRevision = await gitOutput(["rev-parse", "HEAD"], workspace.path);
  return {
    workspace,
    baseRevision,
    source: {
      instance_key: workspace.instanceKey,
      root: workspace.path,
      repository_root: workspace.path,
      memory_path: project.config.store.memory_path
    }
  };
}

function assertMutableChange(change: MemoryChangeSet, expectedUpdatedAt?: string): void {
  if (change.status !== "active") throw new Error(`ChangeSet ${change.id} is already ${change.status}`);
  if (expectedUpdatedAt && change.updated_at !== expectedUpdatedAt) {
    throw new Error(`ChangeSet ${change.id} was modified by another operation`);
  }
}

function assertSameChangeActor(expected: MemoryChangeActor, actual: MemoryChangeActor): void {
  if (expected.kind !== actual.kind || expected.id !== actual.id) {
    throw new Error("only the Comment submitter can modify it");
  }
}

function assertClaimOwner(change: MemoryChangeSet, project: string, workspace: WorkspaceIdentity): void {
  if (change.project !== project) throw new Error(`ChangeSet belongs to Project "${change.project}"`);
  if (change.status !== "active") throw new Error(`ChangeSet ${change.id} is already ${change.status}`);
  if (!change.claim) throw new Error(`ChangeSet ${change.id} is not claimed`);
  if (change.claim.instance_key !== workspace.instanceKey) {
    throw new Error(`ChangeSet ${change.id} is claimed by ${change.claim.root}`);
  }
}

async function prepareClaimCandidate(
  project: ResolvedProject,
  change: MemoryChangeSet,
  workspace: WorkspaceIdentity
): Promise<string[]> {
  const warnings: string[] = [];
  if (change.store_type === "embedded") {
    if (project.config.store.type !== "embedded" || workspace.kind !== "git") {
      throw new Error(`Embedded ChangeSet ${change.id} must be claimed inside its Git repository`);
    }
    const configured = await resolveWorkspaceIdentity(project.config.store.repository_path);
    if (configured.kind !== "git" || configured.key !== workspace.key) {
      throw new Error(`Embedded ChangeSet ${change.id} belongs to another Git repository`);
    }
    const currentBase = await gitOutput(["rev-parse", "HEAD"], workspace.path);
    if (change.intent === "market_import") {
      if (change.base_revision !== currentBase) {
        throw new Error(`Embedded market ChangeSet ${change.id} belongs to another Git base revision`);
      }
      const source = marketCandidateRoot(project, change.id);
      if (!await exists(source)) throw new Error(`ChangeSet candidate is missing: ${source}`);
      const candidateRoot = workspaceCandidateRoot(workspace.path, change.id);
      await rm(candidateRoot, { recursive: true, force: true });
      await mkdir(dirname(candidateRoot), { recursive: true });
      await cp(source, candidateRoot, { recursive: true });
      change.source_worktree = {
        instance_key: workspace.instanceKey,
        root: workspace.path,
        repository_root: configured.path,
        memory_path: project.config.store.memory_path
      };
      return warnings;
    }
    if (change.origin === "view" && change.base_revision !== currentBase) {
      await forwardEmbeddedViewBase(change, workspace.path, project.config.store.memory_path, currentBase);
    }
    const dirty = await gitOutput(
      ["status", "--porcelain", "--", project.config.store.memory_path],
      workspace.path
    );
    if (dirty) warnings.push("the current worktree already contains Memory changes; claiming may mix ChangeSets");
    if (change.checkpoint && change.targets.length > 0) {
      await applyTargets(
        project.memoryRoot,
        checkpointMemoryRoot(project, change.id, change.checkpoint.digest),
        change.targets
      );
    }
    change.source_worktree = {
      instance_key: workspace.instanceKey,
      root: workspace.path,
      repository_root: configured.path,
      memory_path: project.config.store.memory_path
    };
    return warnings;
  }

  if (project.config.store.type !== "managed") {
    throw new Error(`Managed ChangeSet ${change.id} cannot be claimed in an Embedded Project`);
  }
  const candidateRoot = workspaceCandidateRoot(workspace.path, change.id);
  if (change.origin === "cli" && await exists(candidateRoot)) return warnings;
  if (await exists(candidateRoot)) warnings.push("the current Workspace already contains a candidate for this ChangeSet");
  if (change.intent === "market_import") {
    const source = change.checkpoint?.valid
      ? checkpointMemoryRoot(project, change.id, change.checkpoint.digest)
      : marketCandidateRoot(project, change.id);
    if (!await exists(source)) throw new Error(`ChangeSet candidate is missing: ${source}`);
    await rm(candidateRoot, { recursive: true, force: true });
    await mkdir(dirname(candidateRoot), { recursive: true });
    await cp(source, candidateRoot, { recursive: true });
    return warnings;
  }
  for (const scoped of change.scope) {
    const current = join(project.memoryRoot, scoped.path);
    if (!await exists(current)) {
      throw new Error(`edit conflict: scoped Memory changed or was deleted since ChangeSet creation: ${scoped.path}`);
    }
    if (await gitBlobDigest(project.memoryRoot, scoped.path) !== scoped.base_digest) {
      throw new Error(`edit conflict: scoped Memory changed since ChangeSet creation: ${scoped.path}`);
    }
  }
  await rm(candidateRoot, { recursive: true, force: true });
  await mkdir(candidateRoot, { recursive: true });
  for (const scoped of change.scope) {
    const source = join(project.memoryRoot, scoped.path);
    const destination = join(candidateRoot, scoped.path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination);
  }
  if (change.checkpoint && change.targets.length > 0) {
    await applyTargets(
      candidateRoot,
      checkpointMemoryRoot(project, change.id, change.checkpoint.digest),
      change.targets
    );
  }
  return warnings;
}

async function forwardEmbeddedViewBase(
  change: MemoryChangeSet,
  workspaceRoot: string,
  memoryPath: string,
  baseRevision: string
): Promise<void> {
  for (const scoped of change.scope) {
    const repositoryPath = embeddedRepositoryPath(memoryPath, scoped.path);
    let currentDigest = "";
    try {
      currentDigest = await gitOutput(["rev-parse", `${baseRevision}:${repositoryPath}`], workspaceRoot);
    } catch {
      throw new Error(`edit conflict: scoped Memory changed or was deleted since ChangeSet creation: ${scoped.path}`);
    }
    if (currentDigest !== scoped.base_digest) {
      throw new Error(`edit conflict: scoped Memory changed since ChangeSet creation: ${scoped.path}`);
    }
  }
  change.base_revision = baseRevision;
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

export async function syncMemory(
  options: { onLockWait?: () => void } = {}
): Promise<{ revision?: string; change?: MemoryChangeSet; candidateRoot?: string }> {
  const initialContext = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  assertManaged(initialContext.primary);
  const source = await prepareSync(initialContext.primary);
  return withFileLock(memoryMutationLock(initialContext.primary), async () => {
    const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
    assertManaged(context.primary);
    return syncMemoryLocked(context.primary, source);
  }, { onWait: options.onLockWait });
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

async function applyEmbeddedMarketChange(
  project: ResolvedProject,
  change: MemoryChangeSet,
  workspace: WorkspaceIdentity
): Promise<MemoryChangeSet> {
  if (project.config.store.type !== "embedded") throw new Error("Embedded market apply requires an Embedded Project");
  const embeddedStore = project.config.store;
  if (workspace.kind !== "git" || workspace.key !== change.workspace_key) {
    throw new Error(`Embedded market ChangeSet ${change.id} belongs to another Git workspace`);
  }
  if (change.status !== "active") throw new Error(`ChangeSet ${change.id} is already ${change.status}`);
  if (!change.checkpoint?.valid) throw new Error(`ChangeSet ${change.id} does not have a valid checkpoint`);
  if (change.targets.length === 0) throw new Error(`ChangeSet ${change.id} has no Memory targets`);
  const head = await gitOutput(["rev-parse", "HEAD"], workspace.path);
  if (head !== change.base_revision) throw new Error(`Embedded market ChangeSet ${change.id} belongs to another Git base revision`);
  const checkpointRoot = checkpointMemoryRoot(project, change.id, change.checkpoint.digest);
  if (!await exists(checkpointRoot)) throw new Error(`ChangeSet checkpoint is missing: ${change.id}`);
  if (await checkpointDigest(change.targets, checkpointRoot) !== change.checkpoint.digest) {
    throw new Error(`ChangeSet checkpoint digest does not match: ${change.id}`);
  }
  const pendingTargets = await pendingEmbeddedMarketTargets(project, change, checkpointRoot);
  const repositoryPaths = pendingTargets.map((target) => embeddedRepositoryPath(embeddedStore.memory_path, target.path));
  const dirty = repositoryPaths.length > 0
    ? await gitOutput(["status", "--porcelain", "--", ...repositoryPaths], workspace.path)
    : "";
  if (dirty) throw new Error(`Embedded market targets have uncommitted changes: ${repositoryPaths.join(", ")}`);
  await assertChangeTargetsCurrent(project, memoryChangeSetSchema.parse({ ...change, targets: pendingTargets }));
  const staging = await mkdtemp(join(tmpdir(), "memsphere-embedded-market-"));
  const snapshots = new Map<string, { source?: Buffer; mode?: number }>();
  try {
    await copyWorkingTree(project.memoryRoot, staging);
    await applyTargets(staging, checkpointRoot, pendingTargets);
    const candidateValidation = await validateMemoryRoot(staging);
    if (candidateValidation.issues.length > 0) {
      throw new Error(`ChangeSet validation failed: ${candidateValidation.issues[0]?.path}: ${candidateValidation.issues[0]?.message}`);
    }
    for (const target of pendingTargets) {
      const livePath = join(project.memoryRoot, target.path);
      const source = await readFile(livePath).catch((error: unknown) => {
        if (isCode(error, "ENOENT")) return undefined;
        throw error;
      });
      const mode = source === undefined ? undefined : (await lstat(livePath)).mode;
      snapshots.set(target.path, { source, mode });
    }
    await applyTargets(project.memoryRoot, checkpointRoot, pendingTargets);
    const formalValidation = await validateMemoryRoot(project.memoryRoot);
    if (formalValidation.issues.length > 0) {
      throw new Error(`Embedded market apply validation failed: ${formalValidation.issues[0]?.path}: ${formalValidation.issues[0]?.message}`);
    }
    return change;
  } catch (error) {
    for (const [path, snapshot] of snapshots) {
      const target = join(project.memoryRoot, path);
      if (snapshot.source === undefined) await rm(target, { force: true }).catch(() => undefined);
      else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, snapshot.source);
        if (snapshot.mode !== undefined) await chmod(target, snapshot.mode);
      }
    }
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function pendingEmbeddedMarketTargets(
  project: ResolvedProject,
  change: MemoryChangeSet,
  checkpointRoot: string
): Promise<MemoryChangeSet["targets"]> {
  const pending: MemoryChangeSet["targets"] = [];
  for (const target of change.targets) {
    if (target.operation !== "create" && target.operation !== "update") {
      throw new Error(`Embedded market ChangeSet has an unsupported target operation: ${target.operation}`);
    }
    const destinationPath = target.destination_path ?? target.path;
    const current = join(project.memoryRoot, destinationPath);
    if (await exists(current)) {
      const [currentDigest, candidateDigest] = await Promise.all([
        gitBlobDigest(project.memoryRoot, destinationPath),
        gitBlobDigest(checkpointRoot, target.path)
      ]);
      if (currentDigest === candidateDigest) continue;
    }
    pending.push(target);
  }
  return pending;
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
      status: "completed",
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

function newChange(
  project: ResolvedProject,
  workspaceKey: string,
  options: { origin?: "cli" | "view"; actor?: MemoryChangeActor; baseRevision?: string } = {}
): MemoryChangeSet {
  const id = changeId();
  const revision = options.baseRevision
    ?? (project.config.store.type === "managed" ? project.config.store.published_revision : "embedded");
  const now = new Date().toISOString();
  return {
    format_version: 1,
    id,
    project: project.name,
    workspace_key: workspaceKey,
    base_revision: revision,
    status: "active",
    created_at: now,
    updated_at: now,
    store_type: project.config.store.type,
    targets: [],
    origin: options.origin ?? "cli",
    ...(options.actor ? { created_by: options.actor } : {}),
    scope: [],
    comments: []
  };
}

async function resolveTarget(
  project: ResolvedProject,
  referenceInput: string,
  operation: "edit" | "delete" | "rename",
  createPath?: string,
  addedRevision?: string
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
  const revision = addedRevision
    ?? (project.config.store.type === "managed" ? project.config.store.published_revision : "embedded");
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

export async function assertManagedProjectHealthy(project: ResolvedProject): Promise<void> {
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

const assertManagedHealthy = assertManagedProjectHealthy;

function assertManaged(project: ResolvedProject): asserts project is ResolvedProject & { config: { store: { type: "managed"; branch: string; upstream?: string; published_revision: string }; control_plane?: ResolvedProject["config"]["control_plane"] } } {
  if (project.config.store.type !== "managed") throw new Error("Managed Memory ChangeSets are not available for an Embedded Project");
}

function memoryMutationLock(project: ResolvedProject): string {
  return join(project.paths.runtimeRoot, "memory-publish.lock");
}

async function readChange(project: ResolvedProject, id: string): Promise<MemoryChangeSet> {
  const source = await readFile(changePath(project, id), "utf8");
  let change: MemoryChangeSet;
  try {
    change = memoryChangeSetSchema.parse(JSON.parse(source));
  } catch (error) {
    throw new MemoryChangeIntegrityError(id, error instanceof Error ? error.message : String(error));
  }
  if (change.store_type !== project.config.store.type) {
    throw new MemoryChangeIntegrityError(
      id,
      `store_type is ${change.store_type}, but Project ${project.name} uses ${project.config.store.type}`
    );
  }
  return change;
}

async function readReconciledChange(project: ResolvedProject, id: string): Promise<MemoryChangeSet> {
  const change = await readChange(project, id);
  const reconciled = await reconcileEmbeddedChange(project, change);
  if (reconciled !== change) await writeChange(project, reconciled);
  return reconciled;
}

async function writeChange(project: ResolvedProject, change: MemoryChangeSet): Promise<void> {
  await atomicWriteJson(changePath(project, change.id), memoryChangeSetSchema.parse(change));
}

function assertDraftOwner(change: MemoryChangeSet, project: string, workspaceKey: string): void {
  if (change.project !== project) throw new Error(`ChangeSet belongs to Project "${change.project}"`);
  if (change.status !== "active") throw new Error(`ChangeSet ${change.id} is already ${change.status}`);
  if (change.workspace_key !== workspaceKey) throw new Error(`ChangeSet ${change.id} belongs to another Workspace`);
}

function safeFailureSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split(/\r?\n/, 1)[0]?.trim() || "Unknown System Memory repair failure";
  return firstLine.slice(0, 500);
}

function changePath(project: ResolvedProject, id: string): string {
  assertSafeId(id);
  return join(project.paths.changesRoot, id, "change.json");
}

function recoveryRoot(project: ResolvedProject, id: string): string {
  assertSafeId(id);
  return join(project.paths.changesRoot, id, "memory");
}

function marketCandidateRoot(project: ResolvedProject, id: string): string {
  assertSafeId(id);
  return join(project.paths.changesRoot, id, "market-candidate");
}

function checkpointsRoot(project: ResolvedProject, id: string): string {
  assertSafeId(id);
  return join(project.paths.changesRoot, id, "checkpoints");
}

function checkpointMemoryRoot(project: ResolvedProject, id: string, digest: string): string {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`invalid ChangeSet checkpoint digest: ${digest}`);
  return join(checkpointsRoot(project, id), digest, "memory");
}

async function reconcileEmbeddedChange(
  project: ResolvedProject,
  change: MemoryChangeSet
): Promise<MemoryChangeSet> {
  if (
    change.status !== "active"
    || change.store_type !== "embedded"
    || !change.checkpoint?.valid
    || change.targets.length === 0
    || !change.source_worktree
  ) return change;

  const source = change.source_worktree;
  let candidateRevision = change.candidate_revision;
  if (!candidateRevision) {
    const sourceHead = await gitOutput(["rev-parse", "HEAD"], source.root).catch(() => undefined);
    if (sourceHead && await revisionMatchesCheckpoint(project, change, sourceHead)) {
      candidateRevision = sourceHead;
    }
  }

  const masterRevision = await gitOutput(["rev-parse", "master"], source.repository_root).catch(() => undefined);
  const completed = Boolean(masterRevision && (
    await revisionMatchesCheckpoint(project, change, masterRevision)
    || candidateRevision && await isAncestor(candidateRevision, masterRevision, source.repository_root)
  ));
  const candidateChanged = candidateRevision !== change.candidate_revision;
  const statusChanged = completed;
  if (!candidateChanged && !statusChanged) return change;

  return memoryChangeSetSchema.parse({
    ...change,
    ...(candidateRevision ? { candidate_revision: candidateRevision } : {}),
    ...(completed ? { status: "completed" as const } : {}),
    updated_at: new Date().toISOString()
  });
}

async function revisionMatchesCheckpoint(
  project: ResolvedProject,
  change: MemoryChangeSet,
  revision: string
): Promise<boolean> {
  if (!change.checkpoint || !change.source_worktree) return false;
  const candidateRoot = checkpointMemoryRoot(project, change.id, change.checkpoint.digest);
  if (!await exists(candidateRoot)) return false;
  const source = change.source_worktree;
  for (const target of change.targets) {
    const destinationPath = embeddedRepositoryPath(source.memory_path, target.destination_path ?? target.path);
    const destinationDigest = await gitOutput(
      ["rev-parse", `${revision}:${destinationPath}`],
      source.repository_root
    ).catch(() => undefined);
    if (target.operation === "delete") {
      if (destinationDigest) return false;
      continue;
    }
    const candidatePath = join(candidateRoot, target.path);
    if (!await exists(candidatePath)) return false;
    const candidateDigest = await gitOutput(
      ["hash-object", "--", candidatePath],
      source.repository_root
    ).catch(() => undefined);
    if (!candidateDigest || destinationDigest !== candidateDigest) return false;
    if (target.operation === "rename") {
      const originalPath = embeddedRepositoryPath(source.memory_path, target.path);
      const originalDigest = await gitOutput(
        ["rev-parse", `${revision}:${originalPath}`],
        source.repository_root
      ).catch(() => undefined);
      if (originalPath !== destinationPath && originalDigest) return false;
    }
  }
  return true;
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

function changeCommentId(): string {
  return `comment-${new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "z")}-${randomBytes(4).toString("hex")}`;
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
  return gitHashObject(await readFile(join(root, path)), root, path);
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
