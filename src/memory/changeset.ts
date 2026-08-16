import { createHash, randomBytes } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { atomicWriteJson, withFileLock } from "../persistence.js";
import { gitOutput, runGit } from "../git.js";
import { memoryKinds, type MemoryKind } from "./kinds.js";
import { readAllMemoryFiles } from "./store.js";
import { currentMemorySyntax } from "./syntax.js";
import { serializeMemoryYaml } from "./serializer.js";
import { validateMemoryRoot } from "../validation.js";
import { resolveProjectContext, type ResolvedProject } from "../project/resolver.js";
import { resolveWorkspaceIdentity } from "../project/workspace.js";
import { projectConfigSchema } from "../project/model.js";
import { GitRevisionMemoryProvider } from "./git-provider.js";

const changeTargetSchema = z.object({
  operation: z.enum(["create", "update", "delete", "rename"]),
  reference: z.string().min(1),
  path: z.string().min(1).refine(isSafeMemoryPath, "invalid or escaping Memory path"),
  destination_path: z.string().min(1).refine(isSafeMemoryPath, "invalid or escaping Memory path").optional(),
  base_digest: z.string().min(1).optional(),
  added_revision: z.string().min(1)
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
  targets: z.array(changeTargetSchema)
}).strict();

export type MemoryChangeSet = z.infer<typeof memoryChangeSetSchema>;
export type MemoryChangeOperation = z.infer<typeof changeTargetSchema>["operation"];

export async function editMemories(input: {
  references: string[];
  changeId?: string;
  operation?: "edit" | "delete";
}): Promise<{ change: MemoryChangeSet; candidateRoot: string }> {
  if (input.references.length === 0) throw new Error("provide at least one Memory reference");
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  assertManaged(context.primary);
  const workspace = await resolveWorkspaceIdentity();
  const change = input.changeId
    ? await readChange(context.primary, input.changeId)
    : await createChange(context.primary, workspace.key);
  assertDraftOwner(change, context.primary.name, workspace.key);
  const candidateRoot = workspaceCandidateRoot(workspace.path, change.id);
  await mkdir(candidateRoot, { recursive: true });

  for (const reference of input.references) {
    const target = await resolveTarget(context.primary, reference, input.operation === "delete" ? "delete" : "edit");
    if (change.targets.some((current) => current.path === target.path)) continue;
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
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  assertManaged(context.primary);
  const workspace = await resolveWorkspaceIdentity();
  const change = input.changeId ? await readChange(context.primary, input.changeId) : await createChange(context.primary, workspace.key);
  assertDraftOwner(change, context.primary.name, workspace.key);
  const target = await resolveTarget(context.primary, input.reference, "rename");
  if (change.targets.some((current) => current.path === target.path)) throw new Error(`Memory is already targeted by ChangeSet: ${input.reference}`);
  const destination = posix.join(posix.dirname(target.path), safeFileName(input.newName));
  if (await exists(join(context.primary.memoryRoot, destination))) throw new Error(`rename destination already exists: ${destination}`);
  target.destination_path = destination;
  change.targets.push(target);
  const file = (await readAllMemoryFiles(context.primary.memoryRoot)).find((item) => relative(context.primary.memoryRoot, item.path) === target.path);
  if (!file) throw new Error(`Memory was not found: ${input.reference}`);
  file.entity.names[0] = input.newName.trim();
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

export async function publishMemoryChange(changeId: string, message?: string): Promise<MemoryChangeSet> {
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  assertManaged(context.primary);
  const workspace = await resolveWorkspaceIdentity();
  const change = await readChange(context.primary, changeId);
  assertDraftOwner(change, context.primary.name, workspace.key);
  const candidateRoot = workspaceCandidateRoot(workspace.path, changeId);
  if (!await exists(candidateRoot)) throw new Error(`ChangeSet candidate is missing: ${candidateRoot}`);
  const lock = join(context.primary.paths.runtimeRoot, "memory-publish.lock");
  return withFileLock(lock, () => publishLocked(context.primary, change, candidateRoot, message));
}

export async function recoverMemory(
  reference: string,
  mode: "restore" | "create-change"
): Promise<{ change?: MemoryChangeSet; candidateRoot?: string }> {
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  assertManaged(context.primary);
  const project = context.primary;
  const provider = new GitRevisionMemoryProvider(project.memoryRoot, project.config.store.published_revision);
  const descriptors = await provider.list();
  const logical = parseReference(reference);
  const matches = descriptors.filter((descriptor) => {
    if (logical && descriptor.kind !== logical.kind) return false;
    return descriptor.names.includes(logical?.name ?? reference.trim());
  });
  if (matches.length > 1) throw new Error(`Memory reference is ambiguous: ${reference}`);
  const tracked = matches[0];
  const path = tracked?.id ?? (logical ? join(logical.kind, safeFileName(logical.name)) : undefined);
  if (!path) throw new Error(`Memory was not found in the published revision: ${reference}`);
  const absolute = join(project.memoryRoot, path);
  const externalExists = await exists(absolute);
  const external = externalExists ? await readFile(absolute) : undefined;
  const differs = tracked
    ? !externalExists || await gitBlobDigest(project.memoryRoot, path) !== await gitOutput(["rev-parse", `${project.config.store.published_revision}:${path}`], project.memoryRoot)
    : externalExists;
  if (!differs) throw new Error(`Memory has no external modification to recover: ${reference}`);

  if (tracked) await runGit(["checkout", project.config.store.published_revision, "--", path], { cwd: project.memoryRoot });
  else await rm(absolute, { force: true });
  if (mode === "restore") return {};

  const result = tracked
    ? await editMemories({ references: [logicalReferenceFromDescriptor(tracked)], operation: externalExists ? "edit" : "delete" })
    : await editMemories({ references: [reference] });
  if (external && result.change.targets[0]?.operation !== "delete") {
    const candidate = join(result.candidateRoot, result.change.targets[0].path);
    await mkdir(dirname(candidate), { recursive: true });
    await writeFile(candidate, external);
  }
  return { change: result.change, candidateRoot: result.candidateRoot };
}

export async function pushMemory(): Promise<void> {
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  assertManaged(context.primary);
  await assertManagedHealthy(context.primary);
  await runGit(["push", "origin", context.primary.config.store.branch], { cwd: context.primary.memoryRoot });
}

export async function syncMemory(): Promise<{ revision?: string; change?: MemoryChangeSet; candidateRoot?: string }> {
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  const project = context.primary;
  assertManaged(project);
  await assertManagedHealthy(project);
  const upstream = project.config.store.upstream;
  if (!upstream) throw new Error("Managed Project has no configured organization upstream");
  const slash = upstream.indexOf("/");
  if (slash <= 0) throw new Error(`invalid upstream; expected remote/branch: ${upstream}`);
  const remote = upstream.slice(0, slash);
  const branch = upstream.slice(slash + 1);
  await runGit(["fetch", remote, branch], { cwd: project.memoryRoot });
  const mergeParent = await gitOutput(["rev-parse", `${remote}/${branch}`], project.memoryRoot);
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
    const candidates = await Promise.all(conflicts.map(async (path) => ({ path, content: await readFile(join(project.memoryRoot, path)) })));
    await abortMerge(project);
    const provider = new GitRevisionMemoryProvider(project.memoryRoot, project.config.store.published_revision);
    const descriptors = await provider.list();
    const references = conflicts.map((path) => {
      const descriptor = descriptors.find((candidate) => candidate.id === path);
      if (!descriptor) throw new Error(`Sync conflict is not an existing Memory: ${path}`);
      return logicalReferenceFromDescriptor(descriptor);
    });
    const result = await editMemories({ references });
    for (const candidate of candidates) {
      const target = result.change.targets.find((item) => item.path === candidate.path);
      if (!target) throw new Error(`Sync ChangeSet target is missing: ${candidate.path}`);
      await writeFile(join(result.candidateRoot, target.path), candidate.content);
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
    await abortMerge(project);
    throw error;
  }
}

async function publishLocked(project: ResolvedProject, change: MemoryChangeSet, candidateRoot: string, message?: string): Promise<MemoryChangeSet> {
  await assertManagedHealthy(project);
  assertManaged(project);
  const publishedRevision = project.config.store.published_revision;
  for (const target of change.targets) {
    const current = join(project.memoryRoot, target.path);
    if (target.operation === "create") {
      if (await exists(current)) throw new Error(`Memory create conflict: ${target.reference}`);
      continue;
    }
    if (!await exists(current)) throw new Error(`Memory changed or was deleted since edit: ${target.reference}`);
    const digest = await gitBlobDigest(project.memoryRoot, target.path);
    if (digest !== target.base_digest) throw new Error(`Memory edit conflict: ${target.reference}`);
  }

  const staging = await mkdtemp(join(tmpdir(), "memsphere-publish-"));
  try {
    await copyWorkingTree(project.memoryRoot, staging);
    await applyTargets(staging, candidateRoot, change.targets);
    const validation = await validateMemoryRoot(staging);
    if (validation.issues.length > 0) {
      throw new Error(`ChangeSet validation failed:\n${validation.issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n")}`);
    }

    try {
      if (change.merge_parent) {
        await runGit(["merge", "--no-ff", "--no-commit", change.merge_parent], { cwd: project.memoryRoot }).catch(() => undefined);
      }
      await applyTargets(project.memoryRoot, candidateRoot, change.targets);
      await runGit(["add", "-A"], { cwd: project.memoryRoot });
      const formalValidation = await validateMemoryRoot(project.memoryRoot);
      if (formalValidation.issues.length > 0) throw new Error(`ChangeSet validation failed after merge: ${formalValidation.issues[0].message}`);
      await runGit(["commit", "-m", message?.trim() || `Publish Memsphere ChangeSet ${change.id}`], { cwd: project.memoryRoot });
    } catch (error) {
      await runGit(["reset", "--hard", publishedRevision], { cwd: project.memoryRoot }).catch(() => undefined);
      await runGit(["clean", "-fd"], { cwd: project.memoryRoot }).catch(() => undefined);
      throw error;
    }
    const revision = await updatePublishedRevision(project);
    change.status = "published";
    change.published_revision = revision;
    change.updated_at = new Date().toISOString();
    await writeChange(project, change);
    return change;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
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
  const id = changeId();
  const revision = project.config.store.type === "managed" ? project.config.store.published_revision : "embedded";
  const now = new Date().toISOString();
  const change: MemoryChangeSet = {
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
  await writeChange(project, change);
  return change;
}

async function resolveTarget(
  project: ResolvedProject,
  referenceInput: string,
  operation: "edit" | "delete" | "rename"
): Promise<z.infer<typeof changeTargetSchema>> {
  const reference = referenceInput.trim();
  const files = await readAllMemoryFiles(project.memoryRoot);
  const logical = parseReference(reference);
  const found = files.filter((file) => {
    if (logical && file.kind !== logical.kind) return false;
    const wanted = logical?.name ?? reference;
    return file.entity.names.includes(wanted);
  });
  if (found.length > 1) throw new Error(`Memory reference is ambiguous within Project: ${reference}`);
  const revision = project.config.store.type === "managed" ? project.config.store.published_revision : "embedded";
  if (found.length === 0) {
    if (operation !== "edit" || !logical) throw new Error(`Memory was not found: ${reference}`);
    return {
      operation: "create",
      reference: `${logical.kind}/${logical.name}`,
      path: posix.join(logical.kind, safeFileName(logical.name)),
      added_revision: revision
    };
  }
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
    if (target.operation === "rename") await rm(join(root, target.path), { force: true });
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

function parseReference(reference: string): { kind: MemoryKind; name: string } | undefined {
  const slash = reference.indexOf("/");
  if (slash <= 0) return undefined;
  const kind = reference.slice(0, slash);
  if (!(memoryKinds as readonly string[]).includes(kind)) throw new Error(`unknown Memory kind: ${kind}`);
  const name = reference.slice(slash + 1).trim();
  if (!name) throw new Error("Memory reference name is required");
  return { kind: kind as MemoryKind, name };
}

function safeFileName(name: string): string {
  const normalized = name.trim().toLowerCase();
  const slug = normalized.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const digest = createHash("sha256").update(name).digest("hex").slice(0, 12);
  const base = normalized === slug ? slug : `${slug || "memory"}-${digest}`;
  return `${base}.yaml`;
}

function newMemoryTemplate(reference: string): string {
  const parsed = parseReference(reference);
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
