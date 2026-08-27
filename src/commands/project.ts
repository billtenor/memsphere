import { createHash } from "node:crypto";
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { homePaths, resolveMemsphereHome } from "../home.js";
import { atomicWriteFile, atomicWriteJson, withFileLock } from "../persistence.js";
import { gitOutput, runGit } from "../git.js";
import { projectConfigSchema, projectManifestSchema, assertProjectName, type ProjectConfigFile } from "../project/model.js";
import { ensureMemoryDirectories, validateMemoryRoot } from "../validation.js";
import { projectPaths } from "../project/paths.js";
import { listRegisteredProjects, pathExists, readProjectRegistry, updateProjectRegistry } from "../project/registry.js";
import { resolveProjectContext, resolveRegisteredProject } from "../project/resolver.js";
import { resolveMainWorkspacePath, resolveWorkspaceIdentity } from "../project/workspace.js";
import {
  assertManagedProjectHealthy,
  deleteMemoriesByIdentity,
  editMemories,
  editMemoriesByIdentity,
  failMemoryChange,
  publishMemoryChange,
  validateMemoryChange
} from "../memory/changeset.js";
import {
  bundledReservedMemoryRoot,
  readBundledSystemMemories,
  readReservedMemoryManifest,
  reservedSystemMemoryRemovalTombstones,
  type BundledSystemMemoryDescriptor
} from "../reserved/store.js";
import { isMemoryKind, memoryKinds, memoryKindTags, type MemoryKind } from "../memory/kinds.js";
import { parseMemoryYaml } from "../memory/yaml.js";
import { listMemoryFiles } from "../memory/store.js";
import { assertWindowsPrerequisites } from "../windows-prerequisites.js";

type BindOption = { bind?: boolean };
type OutputOption = { output?: "text" | "json" };

export async function projectCreateCommand(
  nameInput: string,
  options: BindOption & { embedded?: string } = {}
): Promise<void> {
  const name = assertProjectName(nameInput);
  const home = resolveMemsphereHome();
  const root = resolve(homePaths(home).projectsRoot, name);
  await withProjectLock(home, name, async () => {
    await preflightNewProject({ home, name, root, bind: options.bind });
    const stagingRoot = `${root}.creating-${process.pid}-${Date.now()}`;
    let moved = false;
    let registered = false;
    let registryWritten = false;
    try {
      const config = options.embedded
        ? await createEmbeddedProject(stagingRoot, options.embedded)
        : await createManagedProject(stagingRoot);
      await writeProjectMetadata(stagingRoot, name, config);
      await rename(stagingRoot, root);
      moved = true;
      await registerCreatedProject(home, name, root, options.bind);
      registryWritten = true;
      if (options.embedded) await bootstrapEmbeddedSystemMemory(name);
      else await bootstrapManagedSystemMemory(name);
      registered = true;
    } finally {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      if (registryWritten && !registered) await rollbackCreatedRegistration(home, name, root);
      if (moved && !registered) await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });
  console.log(`Created Project: ${name}`);
  console.log(`Project Root: ${root}`);
}

async function bootstrapManagedSystemMemory(projectName: string): Promise<void> {
  const result = await runManagedSystemMemoryRepair(projectName, "Bootstrap Memsphere system Memory");
  if (result.created === 0) throw new Error("new Managed Project unexpectedly has no System Memory to bootstrap");
}

async function bootstrapEmbeddedSystemMemory(projectName: string): Promise<void> {
  await withSelectedProject(projectName, async () => {
    const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
    await runSelectedEmbeddedSystemMemoryRepair(context);
  });
}

export type SystemMemoryChangePreparation = {
  project: string;
  change: Awaited<ReturnType<typeof editMemories>>["change"];
  candidateRoot: string;
  created: number;
  updated: number;
  deleted: number;
};

type SystemMemoryReconcilePlan = {
  project: string;
  sourceRoot: string;
  currentDescriptors: SystemMemoryStoreDescriptor[];
  creates: BundledSystemMemoryDescriptor[];
  updates: SystemMemoryUpdateDescriptor[];
  deletes: SystemMemoryStoreDescriptor[];
};

type SystemMemoryStoreDescriptor = {
  id: string;
  kind: MemoryKind;
  names: string[];
  baseDigest: string;
};

type SystemMemoryUpdateDescriptor = BundledSystemMemoryDescriptor & {
  targetPath: string;
  baseDigest: string;
};

type SystemMemoryRepairResult = {
  project: string;
  storeType: "managed" | "embedded";
  created: number;
  updated: number;
  deleted: number;
  revision?: string;
  worktree?: string;
};

type EmbeddedRepairTarget = {
  operation: "create" | "update" | "delete";
  reference: string;
  path: string;
  sourcePath?: string;
  snapshot: EmbeddedFileSnapshot;
};

type EmbeddedFileSnapshot =
  | { exists: false }
  | { exists: true; content: Buffer; digest: string; mode: number };

export type EmbeddedSystemMemoryRepairPreparation = {
  project: string;
  memoryRoot: string;
  workspaceRoot: string;
  memoryPath: string;
  stagingRoot: string;
  targets: EmbeddedRepairTarget[];
  created: number;
  updated: number;
  deleted: number;
};

/** Build a controlled ChangeSet that reconciles a Managed Project with this package's System Memory. */
export async function prepareManagedSystemMemoryChange(projectName?: string): Promise<SystemMemoryChangePreparation | undefined> {
  return withSelectedProject(projectName, prepareSelectedManagedSystemMemoryChange);
}

async function prepareSelectedManagedSystemMemoryChange(): Promise<SystemMemoryChangePreparation | undefined> {
  const plan = await buildSelectedSystemMemoryReconcilePlan();
  if (plan.creates.length === 0 && plan.updates.length === 0 && plan.deletes.length === 0) return undefined;
  let result: Awaited<ReturnType<typeof editMemories>> | undefined;
  try {
    const installs = [...plan.creates, ...plan.updates];
    if (installs.length > 0) {
      result = await editMemoriesByIdentity({
        targets: [
          ...plan.creates.map((memory) => ({
            reference: memory.reference,
            path: memory.path,
            operation: "create" as const
          })),
          ...plan.updates.map((memory) => ({
            reference: memory.reference,
            path: memory.targetPath,
            operation: "update" as const,
            baseDigest: memory.baseDigest
          }))
        ],
        onChangeCreated: (created) => { result = created; }
      });
      for (const memory of installs) {
        const target = result.change.targets.find((candidate) => candidate.reference === memory.reference);
        if (!target) throw new Error(`System Memory ChangeSet target is missing: ${memory.reference}`);
        await cp(join(plan.sourceRoot, memory.path), join(result.candidateRoot, target.path));
      }
    }
    if (plan.deletes.length > 0) {
      result = await deleteMemoriesByIdentity({
        targets: plan.deletes.map((descriptor) => ({
          reference: memoryReference(descriptor),
          path: descriptor.id,
          baseDigest: descriptor.baseDigest
        })),
        changeId: result?.change.id,
        onChangeCreated: (created) => { result = created; }
      });
    }
    if (!result) throw new Error("System Memory reconciliation produced no ChangeSet");
    return {
      project: plan.project,
      change: result.change,
      candidateRoot: result.candidateRoot,
      created: plan.creates.length,
      updated: plan.updates.length,
      deleted: plan.deletes.length
    };
  } catch (error) {
    if (result) await failSystemMemoryChange(result, "prepare", error);
    throw error;
  }
}

async function buildSelectedSystemMemoryReconcilePlan(): Promise<SystemMemoryReconcilePlan> {
  const context = await resolveProjectContext({
    project: process.env.MEMSPHERE_PROJECT,
    memoryScope: "canonical"
  });
  if (context.primary.config.store.type !== "managed") {
    throw new Error(`Project "${context.primary.name}" uses Embedded Memory; System Memory repair requires a Managed Project`);
  }
  await assertManagedProjectHealthy(context.primary);
  const sourceRoot = bundledReservedMemoryRoot();
  const currentDescriptors = await listPublishedMemoryIdentities(
    context.primary.memoryRoot,
    context.primary.config.store.published_revision
  );
  return buildSystemMemoryReconcilePlan({
    project: context.primary.name,
    sourceRoot,
    memoryRoot: context.primary.memoryRoot,
    currentDescriptors
  });
}

async function buildSystemMemoryReconcilePlan(input: {
  project: string;
  sourceRoot: string;
  memoryRoot: string;
  currentDescriptors: SystemMemoryStoreDescriptor[];
}): Promise<SystemMemoryReconcilePlan> {
  const [memories, manifest] = await Promise.all([
    readBundledSystemMemories(input.sourceRoot),
    readReservedMemoryManifest(input.sourceRoot)
  ]);
  const currentDescriptors = input.currentDescriptors;
  const currentByReference = new Map(currentDescriptors.map((descriptor) => [memoryReference(descriptor), descriptor]));
  const currentByPath = new Map(currentDescriptors.map((descriptor) => [descriptor.id, descriptor]));
  const installReferences = new Set(memories.map((memory) => memory.reference));
  const creates: BundledSystemMemoryDescriptor[] = [];
  const updates: SystemMemoryUpdateDescriptor[] = [];
  for (const memory of memories) {
    const current = currentByReference.get(memory.reference);
    if (!current) {
      const occupant = currentByPath.get(memory.path);
      if (occupant) {
        throw new Error(
          `System Memory install path conflict at ${memory.path}: expected ${memory.reference}, found ${memoryReference(occupant)}`
        );
      }
      creates.push(memory);
      continue;
    }
    const [bundledSource, currentSource] = await Promise.all([
      readFile(join(input.sourceRoot, memory.path)),
      readFile(join(input.memoryRoot, current.id))
    ]);
    if (!bundledSource.equals(currentSource)) {
      updates.push({ ...memory, targetPath: current.id, baseDigest: current.baseDigest });
    }
  }
  const deletes: SystemMemoryStoreDescriptor[] = [];
  for (const tombstone of reservedSystemMemoryRemovalTombstones(manifest)) {
    const current = currentByPath.get(tombstone.path);
    if (!current) continue;
    const reference = memoryReference(current);
    if (!tombstone.references.includes(reference)) {
      throw new Error(
        `System Memory removal identity conflict at ${tombstone.path}: found ${reference}`
      );
    }
    if (!installReferences.has(reference)) deletes.push(current);
  }
  return {
    project: input.project,
    sourceRoot: input.sourceRoot,
    currentDescriptors,
    creates,
    updates,
    deletes
  };
}

export async function prepareEmbeddedSystemMemoryRepair(
  projectName?: string
): Promise<EmbeddedSystemMemoryRepairPreparation | undefined> {
  return withSelectedProject(projectName, async () => {
    const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
    return withProjectLock(context.home, context.primary.name, () => prepareSelectedEmbeddedSystemMemoryRepair(context));
  });
}

async function prepareSelectedEmbeddedSystemMemoryRepair(
  context: Awaited<ReturnType<typeof resolveProjectContext>>
): Promise<EmbeddedSystemMemoryRepairPreparation | undefined> {
  if (context.primary.config.store.type !== "embedded") {
    throw new Error(`Project "${context.primary.name}" uses Managed Memory; Embedded System Memory repair requires an Embedded Project`);
  }
  if (context.workspace.kind !== "git") throw new Error("Embedded System Memory repair must run inside a Git worktree");
  const sourceRoot = bundledReservedMemoryRoot();
  const plan = await buildSystemMemoryReconcilePlan({
    project: context.primary.name,
    sourceRoot,
    memoryRoot: context.primary.memoryRoot,
    currentDescriptors: await listWorkingMemoryIdentities(context.primary.memoryRoot)
  });
  if (plan.creates.length === 0 && plan.updates.length === 0 && plan.deletes.length === 0) return undefined;

  const targetInputs = [
    ...plan.creates.map((memory) => ({
      operation: "create" as const,
      reference: memory.reference,
      path: memory.path,
      sourcePath: join(plan.sourceRoot, memory.path)
    })),
    ...plan.updates.map((memory) => {
      const current = findPlanDescriptor(plan, memory.reference);
      return {
        operation: "update" as const,
        reference: memory.reference,
        path: current.id,
        sourcePath: join(plan.sourceRoot, memory.path)
      };
    }),
    ...plan.deletes.map((memory) => ({
      operation: "delete" as const,
      reference: memoryReference(memory),
      path: memory.id
    }))
  ];
  await assertEmbeddedRepairTargetsClean(
    context.workspace.path,
    context.primary.config.store.memory_path,
    targetInputs.map((target) => target.path)
  );
  const targets: EmbeddedRepairTarget[] = [];
  for (const target of targetInputs) {
    assertSystemMemoryPath(target.path);
    const snapshot = await snapshotEmbeddedFile(context.primary.memoryRoot, target.path);
    if (target.operation === "create" && snapshot.exists) {
      throw new Error(`Embedded System Memory create conflict: ${target.reference}`);
    }
    if (target.operation !== "create" && !snapshot.exists) {
      throw new Error(`Embedded System Memory changed or was deleted during repair: ${target.reference}`);
    }
    targets.push({ ...target, snapshot });
  }

  const stagingRoot = await mkdtemp(join(tmpdir(), "memsphere-embedded-system-repair-"));
  try {
    await copyMemoryKinds(context.primary.memoryRoot, stagingRoot);
    await applyEmbeddedRepairTargets(stagingRoot, targets);
    const validation = await validateMemoryRoot(stagingRoot);
    if (validation.issues.length > 0) {
      const issue = validation.issues[0]!;
      const issuePath = relative(stagingRoot, issue.path).replaceAll("\\", "/") || issue.path;
      throw new Error(`Embedded System Memory repair validation failed: ${issuePath}: ${issue.message}`);
    }
    return {
      project: context.primary.name,
      memoryRoot: context.primary.memoryRoot,
      workspaceRoot: context.workspace.path,
      memoryPath: context.primary.config.store.memory_path,
      stagingRoot,
      targets,
      created: plan.creates.length,
      updated: plan.updates.length,
      deleted: plan.deletes.length
    };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function findPlanDescriptor(
  plan: SystemMemoryReconcilePlan,
  reference: string
): SystemMemoryStoreDescriptor {
  const current = plan.currentDescriptors.find((descriptor) => memoryReference(descriptor) === reference);
  if (!current) throw new Error(`System Memory update target is missing: ${reference}`);
  return current;
}

export async function applyEmbeddedSystemMemoryRepair(
  prepared: EmbeddedSystemMemoryRepairPreparation
): Promise<SystemMemoryRepairResult> {
  try {
    return await withSelectedProject(prepared.project, async () => {
      const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
      return withProjectLock(context.home, prepared.project, () => applySelectedEmbeddedSystemMemoryRepair(context, prepared));
    });
  } catch (error) {
    await rm(prepared.stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function applySelectedEmbeddedSystemMemoryRepair(
  context: Awaited<ReturnType<typeof resolveProjectContext>>,
  prepared: EmbeddedSystemMemoryRepairPreparation
): Promise<SystemMemoryRepairResult> {
  try {
    if (context.primary.config.store.type !== "embedded") {
      throw new Error(`Project "${context.primary.name}" no longer uses Embedded Memory`);
    }
    if (
      context.primary.name !== prepared.project
      || context.primary.memoryRoot !== prepared.memoryRoot
      || context.workspace.path !== prepared.workspaceRoot
      || context.primary.config.store.memory_path !== prepared.memoryPath
    ) {
      throw new Error("Embedded System Memory repair context changed after preparation; retry the command");
    }
    await assertEmbeddedRepairSnapshotsCurrent(prepared);
    const applied: EmbeddedRepairTarget[] = [];
    try {
      for (const target of prepared.targets) {
        await applyEmbeddedRepairTarget(prepared.memoryRoot, prepared.stagingRoot, target);
        applied.push(target);
      }
      const validation = await validateMemoryRoot(prepared.memoryRoot);
      if (validation.issues.length > 0) {
        const issue = validation.issues[0]!;
        throw new Error(`Embedded System Memory repair post-write validation failed: ${issue.path}: ${issue.message}`);
      }
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      for (const target of applied.reverse()) {
        await restoreEmbeddedRepairTarget(prepared.memoryRoot, target)
          .catch((rollbackError) => rollbackErrors.push(rollbackError));
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError([error, ...rollbackErrors], "Embedded System Memory repair failed and rollback was incomplete");
      }
      throw error;
    }
    return {
      project: prepared.project,
      storeType: "embedded",
      created: prepared.created,
      updated: prepared.updated,
      deleted: prepared.deleted,
      worktree: prepared.workspaceRoot
    };
  } finally {
    await rm(prepared.stagingRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runEmbeddedSystemMemoryRepair(projectName?: string): Promise<SystemMemoryRepairResult> {
  return withSelectedProject(projectName, async () => {
    const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
    return withProjectLock(context.home, context.primary.name, () => runSelectedEmbeddedSystemMemoryRepair(context));
  });
}

async function runSelectedEmbeddedSystemMemoryRepair(
  context: Awaited<ReturnType<typeof resolveProjectContext>>
): Promise<SystemMemoryRepairResult> {
  const prepared = await prepareSelectedEmbeddedSystemMemoryRepair(context);
  if (prepared) return applySelectedEmbeddedSystemMemoryRepair(context, prepared);
  if (context.primary.config.store.type !== "embedded") {
    throw new Error(`Project "${context.primary.name}" uses Managed Memory; Embedded System Memory repair requires an Embedded Project`);
  }
  const validation = await validateMemoryRoot(context.primary.memoryRoot);
  if (validation.issues.length > 0) {
    const issue = validation.issues[0]!;
    throw new Error(`Embedded System Memory repair validation failed: ${issue.path}: ${issue.message}`);
  }
  return {
    project: context.primary.name,
    storeType: "embedded",
    created: 0,
    updated: 0,
    deleted: 0,
    worktree: context.workspace.path
  };
}

export async function projectRepairCommand(nameInput?: string): Promise<void> {
  const result = await withSelectedProject(nameInput, async () => {
    const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
    return context.primary.config.store.type === "managed"
      ? runManagedSystemMemoryRepair(context.primary.name, "Repair Memsphere system Memory")
      : runEmbeddedSystemMemoryRepair(context.primary.name);
  });
  console.log(`Project: ${result.project}`);
  console.log(`Store: ${result.storeType === "managed" ? "Managed" : "Embedded"}`);
  console.log(`System Memory changes: ${result.created} create, ${result.updated} update, ${result.deleted} delete`);
  if (result.revision) console.log(`Revision: ${result.revision}`);
  if (result.worktree) {
    console.log(`Worktree: ${result.worktree}`);
    console.log("Validation: passed");
  }
}

async function runManagedSystemMemoryRepair(
  projectName: string | undefined,
  message: string
): Promise<SystemMemoryRepairResult> {
  return withSelectedProject(projectName, async () => {
    const context = await resolveProjectContext({
      project: process.env.MEMSPHERE_PROJECT,
      memoryScope: "canonical"
    });
    if (context.primary.config.store.type !== "managed") {
      throw new Error(`Project "${context.primary.name}" uses Embedded Memory; System Memory repair requires a Managed Project`);
    }
    const prepared = await prepareSelectedManagedSystemMemoryChange();
    if (!prepared) {
      return {
        project: context.primary.name,
        storeType: "managed",
        created: 0,
        updated: 0,
        deleted: 0,
        revision: context.primary.config.store.published_revision
      };
    }
    let stage: "validate" | "publish" = "validate";
    try {
      const validation = await validateMemoryChange(prepared.change.id);
      if (validation.issues.length > 0) {
        throw new Error(
          `System Memory repair validation failed: ${validation.issues[0]?.path}: ${validation.issues[0]?.message}`
        );
      }
      stage = "publish";
      const published = await publishMemoryChange(prepared.change.id, message);
      await rm(resolve(prepared.candidateRoot, ".."), { recursive: true, force: true }).catch(() => undefined);
      return {
        project: prepared.project,
        storeType: "managed",
        created: prepared.created,
        updated: prepared.updated,
        deleted: prepared.deleted,
        revision: published.published_revision ?? context.primary.config.store.published_revision
      };
    } catch (error) {
      return await failSystemMemoryChange(prepared, stage, error);
    }
  });
}

async function failSystemMemoryChange(
  prepared: Pick<SystemMemoryChangePreparation, "change" | "candidateRoot">,
  stage: "prepare" | "validate" | "publish",
  error: unknown
): Promise<never> {
  const followupErrors: unknown[] = [];
  await failMemoryChange(prepared.change.id, stage, error).catch((failureError) => followupErrors.push(failureError));
  await rm(resolve(prepared.candidateRoot, ".."), { recursive: true, force: true })
    .catch((cleanupError) => followupErrors.push(cleanupError));
  if (followupErrors.length > 0) {
    throw new AggregateError([error, ...followupErrors], "System Memory repair failed and diagnostics or cleanup were incomplete");
  }
  throw error;
}

async function withSelectedProject<T>(projectName: string | undefined, operation: () => Promise<T>): Promise<T> {
  const selectedProject = projectName?.trim();
  if (selectedProject) assertProjectName(selectedProject);
  const previous = process.env.MEMSPHERE_PROJECT;
  try {
    if (selectedProject) process.env.MEMSPHERE_PROJECT = selectedProject;
    return await operation();
  } finally {
    if (previous === undefined) delete process.env.MEMSPHERE_PROJECT;
    else process.env.MEMSPHERE_PROJECT = previous;
  }
}

async function listPublishedMemoryIdentities(
  memoryRoot: string,
  revision: string
): Promise<SystemMemoryStoreDescriptor[]> {
  const output = await gitOutput(["ls-tree", "-r", "--name-only", revision], memoryRoot);
  const descriptors: SystemMemoryStoreDescriptor[] = [];
  for (const id of output.split("\n").filter(Boolean)) {
    if (!id.endsWith(".yaml") && !id.endsWith(".yml")) continue;
    const kind = id.split("/", 1)[0];
    if (!isMemoryKind(kind)) continue;
    const source = await gitOutput(["show", `${revision}:${id}`], memoryRoot);
    const parsed = parseMemoryYaml(`${source}\n`);
    if (!parsed || typeof parsed !== "object") throw new Error(`invalid historical Memory document: ${id}`);
    const record = parsed as Record<string, unknown>;
    if (record.tag !== memoryKindTags[kind]) {
      throw new Error(`${id} uses ${String(record.tag)} but expected ${memoryKindTags[kind]}`);
    }
    const rawNames = record.names ?? record.name;
    const names = typeof rawNames === "string"
      ? [rawNames]
      : Array.isArray(rawNames) && rawNames.every((name) => typeof name === "string")
        ? rawNames as string[]
        : [];
    if (!names[0]?.trim()) throw new Error(`historical Memory has no canonical name: ${id}`);
    const baseDigest = await gitOutput(["rev-parse", `${revision}:${id}`], memoryRoot);
    descriptors.push({ id, kind, names, baseDigest });
  }
  return descriptors;
}

async function listWorkingMemoryIdentities(memoryRoot: string): Promise<SystemMemoryStoreDescriptor[]> {
  const descriptors: SystemMemoryStoreDescriptor[] = [];
  for (const kind of memoryKinds) {
    for (const filePath of await listMemoryFiles(memoryRoot, kind)) {
      const id = relative(memoryRoot, filePath).replaceAll("\\", "/");
      assertSystemMemoryPath(id);
      const source = await readFile(filePath);
      const parsed = parseMemoryYaml(source.toString("utf8"));
      if (!parsed || typeof parsed !== "object") throw new Error(`invalid Embedded Memory document: ${id}`);
      const record = parsed as Record<string, unknown>;
      if (record.tag !== memoryKindTags[kind]) {
        throw new Error(`${id} uses ${String(record.tag)} but expected ${memoryKindTags[kind]}`);
      }
      const rawNames = record.names ?? record.name;
      const names = typeof rawNames === "string"
        ? [rawNames]
        : Array.isArray(rawNames) && rawNames.every((name) => typeof name === "string")
          ? rawNames as string[]
          : [];
      if (!names[0]?.trim()) throw new Error(`Embedded Memory has no canonical name: ${id}`);
      descriptors.push({ id, kind, names, baseDigest: digestBuffer(source) });
    }
  }
  return descriptors;
}

async function assertEmbeddedRepairTargetsClean(
  workspaceRoot: string,
  memoryPath: string,
  targetPaths: string[]
): Promise<void> {
  const repositoryPaths = [...new Set(targetPaths.map((path) => embeddedRepositoryPath(memoryPath, path)))];
  if (repositoryPaths.length === 0) return;
  const status = await gitOutput(
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching", "--", ...repositoryPaths.map(gitLiteralPathspec)],
    workspaceRoot
  );
  if (status) {
    throw new Error(`Embedded System Memory repair target has uncommitted changes: ${repositoryPaths.join(", ")}`);
  }
}

function gitLiteralPathspec(path: string): string {
  return `:(literal)${path}`;
}

function embeddedRepositoryPath(memoryPath: string, memoryRelativePath: string): string {
  const normalizedRoot = memoryPath === "." ? "" : memoryPath.replace(/^\.\//, "").replace(/\/$/, "");
  return normalizedRoot ? posix.join(normalizedRoot, memoryRelativePath) : memoryRelativePath;
}

async function snapshotEmbeddedFile(memoryRoot: string, path: string): Promise<EmbeddedFileSnapshot> {
  assertSystemMemoryPath(path);
  const target = join(memoryRoot, path);
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (isCode(error, "ENOENT")) return { exists: false };
    throw error;
  }
  if (!info.isFile()) throw new Error(`Embedded System Memory target must be a regular file: ${path}`);
  const [resolvedRoot, resolvedTarget] = await Promise.all([realpath(memoryRoot), realpath(target)]);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Embedded System Memory target escapes Memory Root through a symbolic link: ${path}`);
  }
  const content = await readFile(target);
  return { exists: true, content, digest: digestBuffer(content), mode: info.mode & 0o777 };
}

async function copyMemoryKinds(sourceRoot: string, destinationRoot: string): Promise<void> {
  for (const kind of memoryKinds) {
    const source = join(sourceRoot, kind);
    const destination = join(destinationRoot, kind);
    let info;
    try {
      info = await lstat(source);
    } catch (error) {
      if (isCode(error, "ENOENT")) {
        await mkdir(destination, { recursive: true });
        continue;
      }
      throw error;
    }
    if (!info.isDirectory()) {
      const reason = info.isSymbolicLink() ? "symbolic links are not allowed" : "expected a directory";
      throw new Error(`Cannot stage Embedded Memory kind ${kind}: ${reason}: ${source}`);
    }
    await copyEmbeddedMemoryTree(source, destination);
  }
}

async function copyEmbeddedMemoryTree(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    const info = await lstat(sourcePath);
    if (info.isSymbolicLink()) {
      throw new Error(`Cannot stage Embedded Memory: symbolic links are not allowed: ${sourcePath}`);
    }
    if (info.isDirectory()) {
      await copyEmbeddedMemoryTree(sourcePath, destinationPath);
      continue;
    }
    if (!info.isFile()) {
      throw new Error(`Cannot stage Embedded Memory: expected a regular file: ${sourcePath}`);
    }
    await copyFile(sourcePath, destinationPath);
  }
}

async function applyEmbeddedRepairTargets(root: string, targets: EmbeddedRepairTarget[]): Promise<void> {
  for (const target of targets) {
    const destination = join(root, target.path);
    if (target.operation === "delete") {
      await rm(destination, { force: true });
      continue;
    }
    if (!target.sourcePath) throw new Error(`Embedded System Memory source is missing: ${target.reference}`);
    await mkdir(dirname(destination), { recursive: true });
    await cp(target.sourcePath, destination);
  }
}

async function assertEmbeddedRepairSnapshotsCurrent(
  prepared: EmbeddedSystemMemoryRepairPreparation
): Promise<void> {
  for (const target of prepared.targets) {
    const current = await snapshotEmbeddedFile(prepared.memoryRoot, target.path);
    if (!sameEmbeddedSnapshot(current, target.snapshot)) {
      throw new Error(`Embedded System Memory target changed during repair: ${target.reference}`);
    }
  }
}

async function applyEmbeddedRepairTarget(
  memoryRoot: string,
  stagingRoot: string,
  target: EmbeddedRepairTarget
): Promise<void> {
  const destination = join(memoryRoot, target.path);
  if (target.operation === "delete") {
    await rm(destination, { force: true });
    return;
  }
  const source = join(stagingRoot, target.path);
  const [content, info] = await Promise.all([readFile(source, "utf8"), lstat(source)]);
  if (!info.isFile()) throw new Error(`Embedded System Memory candidate must be a regular file: ${target.path}`);
  await atomicWriteFile(destination, content, info.mode & 0o777);
}

async function restoreEmbeddedRepairTarget(memoryRoot: string, target: EmbeddedRepairTarget): Promise<void> {
  const destination = join(memoryRoot, target.path);
  if (!target.snapshot.exists) {
    await rm(destination, { force: true });
    return;
  }
  await atomicWriteFile(destination, target.snapshot.content.toString("utf8"), target.snapshot.mode);
}

function sameEmbeddedSnapshot(left: EmbeddedFileSnapshot, right: EmbeddedFileSnapshot): boolean {
  if (left.exists !== right.exists) return false;
  if (!left.exists) return true;
  const existingRight = right as Extract<EmbeddedFileSnapshot, { exists: true }>;
  return left.digest === existingRight.digest && left.mode === existingRight.mode;
}

function digestBuffer(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function assertSystemMemoryPath(path: string): void {
  if (
    path.includes("\\")
    || path !== posix.normalize(path)
    || path.startsWith("../")
    || path.startsWith("/")
    || !memoryKinds.includes(path.split("/", 1)[0] as MemoryKind)
    || path.split("/").length !== 2
    || !/\.ya?ml$/i.test(path)
  ) {
    throw new Error(`invalid or escaping System Memory path: ${path}`);
  }
}

function memoryReference(descriptor: SystemMemoryStoreDescriptor): string {
  return `${descriptor.kind}/${descriptor.names[0]}`;
}

function isCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

async function rollbackCreatedRegistration(home: string, name: string, root: string): Promise<void> {
  await updateProjectRegistry(home, (registry) => {
    if (registry.projects[name]?.root === root) delete registry.projects[name];
    for (const [key, binding] of Object.entries(registry.workspaces)) {
      if (binding.primary === name) delete registry.workspaces[key];
      else binding.mounted = binding.mounted.filter((mounted) => mounted !== name);
    }
  }).catch(() => undefined);
}

export async function projectCloneCommand(
  source: string,
  options: BindOption & { name?: string; branch?: string; upstream?: string } = {}
): Promise<void> {
  const name = assertProjectName(options.name?.trim() ?? "");
  const home = resolveMemsphereHome();
  const root = resolve(homePaths(home).projectsRoot, name);
  await withProjectLock(home, name, async () => {
    await preflightNewProject({ home, name, root, bind: options.bind });
    const stagingRoot = `${root}.creating-${process.pid}-${Date.now()}`;
    let moved = false;
    let registered = false;
    try {
      await mkdir(stagingRoot, { recursive: true });
      const memoryRoot = projectPaths(stagingRoot).memoryRoot;
      const cloneArgs = ["clone", ...(options.branch ? ["--branch", options.branch] : []), "--", source, memoryRoot];
      await runGit(cloneArgs);
      const revision = await gitOutput(["rev-parse", "HEAD"], memoryRoot).catch(() => "");
      if (!revision) throw new Error("cannot clone a completely empty Memory repository; create its root commit first");
      const branch = options.branch ?? await gitOutput(["branch", "--show-current"], memoryRoot);
      if (!branch) throw new Error("cloned Memory repository is not on a branch");
      const validation = await import("../validation.js").then(({ validateMemoryRoot }) => validateMemoryRoot(memoryRoot));
      if (validation.issues.length > 0) throw new Error(`cloned repository is not a valid Memory Store: ${validation.issues[0].message}`);
      await writeProjectMetadata(stagingRoot, name, {
        store: { type: "managed", branch, ...(options.upstream ? { upstream: options.upstream } : {}), published_revision: revision }
      });
      await rename(stagingRoot, root);
      moved = true;
      await registerCreatedProject(home, name, root, options.bind);
      registered = true;
    } finally {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      if (moved && !registered) await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });
  console.log(`Cloned Project: ${name}`);
  console.log(`Project Root: ${root}`);
}

export async function projectRegisterCommand(rootInput: string, options: BindOption = {}): Promise<void> {
  const root = await realpath(resolve(rootInput));
  const paths = projectPaths(root);
  const manifest = projectManifestSchema.parse(JSON.parse(await readFile(paths.manifestPath, "utf8")));
  projectConfigSchema.parse(JSON.parse(await readFile(paths.configPath, "utf8")));
  const home = resolveMemsphereHome();
  await withProjectLock(home, manifest.name, async () => {
    const registry = await readProjectRegistry(home);
    const existing = registry.projects[manifest.name];
    if (existing && await pathExists(existing.root)) {
      const current = await realpath(existing.root);
      if (current !== root) throw new Error(`Project "${manifest.name}" is already registered at ${current}`);
      throw new Error(`Project "${manifest.name}" is already registered`);
    }
    if (options.bind) await assertWorkspaceUnbound(registry);
    await registerCreatedProject(home, manifest.name, root, options.bind);
  });
  console.log(`Registered Project: ${manifest.name}`);
  console.log(`Project Root: ${root}`);
}

function withProjectLock<T>(home: string, name: string, action: () => Promise<T>): Promise<T> {
  return withFileLock(resolve(homePaths(home).runtimeRoot, "projects", `${name}.lock`), action);
}

export async function projectListCommand(options: OutputOption = {}): Promise<void> {
  const home = resolveMemsphereHome();
  const registry = await readProjectRegistry(home);
  const projects = await listRegisteredProjects(home);
  const workspace = await resolveWorkspaceIdentity();
  const binding = registry.workspaces[workspace.key];
  const result = projects.map((project) => ({
    ...project,
    primary: binding?.primary === project.name,
    mounted: binding?.mounted.includes(project.name) ?? false
  }));
  if (options.output === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.length === 0) {
    console.log("No registered Projects.");
    return;
  }
  for (const item of result) {
    const relation = item.primary ? "primary" : item.mounted ? "mounted" : "unbound";
    console.log(`${item.name}\t${item.missing ? "missing" : "available"}\t${relation}\t${item.root}`);
  }
}

export async function projectShowCommand(nameInput: string | undefined, options: OutputOption = {}): Promise<void> {
  const home = resolveMemsphereHome();
  const registry = await readProjectRegistry(home);
  const workspace = await resolveWorkspaceIdentity();
  const name = nameInput?.trim() || registry.workspaces[workspace.key]?.primary;
  if (!name) throw new Error("provide a Project name or bind the current Workspace");
  const project = await resolveRegisteredProject(name, registry.projects);
  const health = await projectHealth(project.memoryRoot, project.config);
  const effective = await resolveRegisteredProject(name, registry.projects, { workspace }).catch(() => undefined);
  const result = {
    name,
    root: project.paths.root,
    store: project.config.store,
    canonical_memory_root: project.memoryRoot,
    ...(effective ? { effective_memory_root: effective.memoryRoot } : {}),
    health
  };
  if (options.output === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    console.log(`Project: ${name}`);
    console.log(`Root: ${project.paths.root}`);
    console.log(`Store: ${project.config.store.type}`);
    console.log(`Canonical Memory Root: ${project.memoryRoot}`);
    if (effective) console.log(`Effective Memory Root: ${effective.memoryRoot}`);
    console.log(`Health: ${health.status}${health.detail ? ` (${health.detail})` : ""}`);
  }
}

export async function projectBindCommand(nameInput: string): Promise<void> {
  const name = assertProjectName(nameInput);
  const home = resolveMemsphereHome();
  const workspace = await resolveWorkspaceIdentity();
  await updateProjectRegistry(home, async (registry) => {
    if (!registry.projects[name]) throw new Error(`Project "${name}" is not registered`);
    await assertProjectWorkspaceCompatible(await resolveRegisteredProject(name, registry.projects), workspace);
    const current = registry.workspaces[workspace.key];
    if (current) {
      throw new Error(
        `Workspace is already bound to Primary Project "${current.primary}"; run memsphere project unbind before binding another Project`
      );
    }
    registry.workspaces[workspace.key] = { primary: name, mounted: [] };
  });
  console.log(`Bound Workspace to Primary Project: ${name}`);
}

export async function projectUnbindCommand(): Promise<void> {
  const home = resolveMemsphereHome();
  const workspace = await resolveWorkspaceIdentity();
  await updateProjectRegistry(home, (registry) => {
    if (!registry.workspaces[workspace.key]) throw new Error("current Workspace is not bound");
    delete registry.workspaces[workspace.key];
  });
  console.log("Unbound current Workspace.");
}

export async function projectMountCommand(nameInput: string): Promise<void> {
  const name = assertProjectName(nameInput);
  const home = resolveMemsphereHome();
  const workspace = await resolveWorkspaceIdentity();
  await updateProjectRegistry(home, async (registry) => {
    if (!registry.projects[name]) throw new Error(`Project "${name}" is not registered`);
    await assertProjectWorkspaceCompatible(await resolveRegisteredProject(name, registry.projects), workspace);
    const binding = registry.workspaces[workspace.key];
    if (!binding) throw new Error("current Workspace is not bound to a Primary Project");
    if (binding.primary === name) throw new Error(`Project "${name}" is already the Primary Project`);
    if (binding.mounted.includes(name)) throw new Error(`Project "${name}" is already mounted`);
    binding.mounted.push(name);
  });
  console.log(`Mounted read-only Project: ${name}`);
}

async function assertProjectWorkspaceCompatible(
  project: Awaited<ReturnType<typeof resolveRegisteredProject>>,
  workspace: Awaited<ReturnType<typeof resolveWorkspaceIdentity>>
): Promise<void> {
  if (project.config.store.type !== "embedded") return;
  const storeWorkspace = await resolveWorkspaceIdentity(project.config.store.repository_path);
  if (workspace.kind !== "git" || storeWorkspace.kind !== "git" || workspace.key !== storeWorkspace.key) {
    throw new Error(
      `Embedded Project "${project.name}" can only be used by worktrees of its own Git repository; use a Managed Project for cross-repository sharing`
    );
  }
}

export async function projectUnmountCommand(nameInput: string): Promise<void> {
  const name = assertProjectName(nameInput);
  const home = resolveMemsphereHome();
  const workspace = await resolveWorkspaceIdentity();
  await updateProjectRegistry(home, (registry) => {
    const binding = registry.workspaces[workspace.key];
    if (!binding) throw new Error("current Workspace is not bound to a Primary Project");
    const index = binding.mounted.indexOf(name);
    if (index < 0) throw new Error(`Project "${name}" is not mounted`);
    binding.mounted.splice(index, 1);
  });
  console.log(`Unmounted Project: ${name}`);
}

export async function projectPruneCommand(): Promise<void> {
  const home = resolveMemsphereHome();
  const missing = new Set((await listRegisteredProjects(home)).filter((project) => project.missing).map((project) => project.name));
  await updateProjectRegistry(home, (registry) => {
    for (const name of missing) delete registry.projects[name];
    for (const [key, binding] of Object.entries(registry.workspaces)) {
      if (missing.has(binding.primary)) {
        delete registry.workspaces[key];
        continue;
      }
      binding.mounted = binding.mounted.filter((name) => !missing.has(name));
    }
  });
  console.log(`Pruned missing Projects: ${missing.size}`);
}

async function preflightNewProject(input: { home: string; name: string; root: string; bind?: boolean }): Promise<void> {
  await assertWindowsPrerequisites();
  const registry = await readProjectRegistry(input.home);
  if (registry.projects[input.name]) throw new Error(`Project "${input.name}" is already registered`);
  if (await pathExists(input.root)) throw new Error(`Project Root already exists: ${input.root}`);
  if (input.bind) await assertWorkspaceUnbound(registry);
  await mkdir(dirname(input.root), { recursive: true });
}

async function assertWorkspaceUnbound(registry: Awaited<ReturnType<typeof readProjectRegistry>>): Promise<void> {
  const workspace = await resolveWorkspaceIdentity();
  const binding = registry.workspaces[workspace.key];
  if (binding) throw new Error(`Workspace is already bound to Primary Project "${binding.primary}"`);
}

async function createManagedProject(root: string): Promise<ProjectConfigFile> {
  await assertGitIdentity();
  const paths = projectPaths(root);
  await mkdir(paths.memoryRoot, { recursive: true });
  await runGit(["init", "-b", "master"], { cwd: paths.memoryRoot });
  await runGit(["commit", "--allow-empty", "-m", "Initialize Memsphere Memory Store"], { cwd: paths.memoryRoot });
  const revision = await gitOutput(["rev-parse", "HEAD"], paths.memoryRoot);
  await ensureMemoryDirectories(paths.memoryRoot);
  return { store: { type: "managed", branch: "master", published_revision: revision } };
}

async function createEmbeddedProject(root: string, memoryPathInput: string): Promise<ProjectConfigFile> {
  const memoryPath = await realpath(resolve(memoryPathInput));
  const workspace = await resolveWorkspaceIdentity(memoryPath);
  const current = await resolveWorkspaceIdentity();
  if (workspace.kind !== "git" || current.kind !== "git") throw new Error("Embedded Memory must be inside the current Git repository");
  if (workspace.key !== current.key) throw new Error("Embedded Memory must use the current Git repository; use a Managed Project for cross-repository sharing");
  const rel = relative(current.path, memoryPath);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Embedded Memory path escapes its Git Workspace");
  const memoryRelativePath = (rel || ".").replaceAll("\\", "/");
  const repositoryPath = await resolveMainWorkspacePath(current.path);
  const canonicalMemoryPath = await realpath(resolve(repositoryPath, memoryRelativePath));
  if (canonicalMemoryPath !== repositoryPath && !canonicalMemoryPath.startsWith(`${repositoryPath}${sep}`)) {
    throw new Error("Embedded Memory path escapes the main Git worktree through a symbolic link");
  }
  await mkdir(root, { recursive: true });
  return { store: { type: "embedded", repository_path: repositoryPath, memory_path: memoryRelativePath } };
}

async function writeProjectMetadata(root: string, name: string, config: ProjectConfigFile): Promise<void> {
  const paths = projectPaths(root);
  await Promise.all([
    mkdir(paths.changesRoot, { recursive: true }),
    mkdir(paths.runsRoot, { recursive: true }),
    mkdir(paths.archiveRoot, { recursive: true }),
    mkdir(paths.evalsRoot, { recursive: true }),
    mkdir(paths.runtimeRoot, { recursive: true })
  ]);
  await atomicWriteJson(paths.manifestPath, { format_version: 1, name, created_at: new Date().toISOString() });
  await atomicWriteJson(paths.configPath, projectConfigSchema.parse(config));
}

async function registerCreatedProject(home: string, name: string, root: string, bind?: boolean): Promise<void> {
  const workspace = bind ? await resolveWorkspaceIdentity() : undefined;
  await updateProjectRegistry(home, (registry) => {
    if (registry.projects[name]) throw new Error(`Project "${name}" became registered concurrently`);
    if (workspace && registry.workspaces[workspace.key]) throw new Error("Workspace became bound concurrently");
    registry.projects[name] = { root };
    if (workspace) registry.workspaces[workspace.key] = { primary: name, mounted: [] };
  });
}

async function assertGitIdentity(): Promise<void> {
  const [name, email] = await Promise.all([
    runGit(["config", "--get", "user.name"], { allowFailure: true }),
    runGit(["config", "--get", "user.email"], { allowFailure: true })
  ]);
  if (!name.stdout || !email.stdout) {
    throw new Error("Git identity is required. Configure git config --global user.name and git config --global user.email.");
  }
}

async function projectHealth(memoryRoot: string, config: ProjectConfigFile): Promise<{ status: "ok" | "unhealthy"; detail?: string }> {
  if (config.store.type === "embedded") return { status: await pathExists(memoryRoot) ? "ok" : "unhealthy", ...(!await pathExists(memoryRoot) ? { detail: "Memory path is missing" } : {}) };
  try {
    const [branch, revision, porcelain] = await Promise.all([
      gitOutput(["branch", "--show-current"], memoryRoot),
      gitOutput(["rev-parse", "HEAD"], memoryRoot),
      gitOutput(["status", "--porcelain"], memoryRoot)
    ]);
    if (branch !== config.store.branch) return { status: "unhealthy", detail: `expected branch ${config.store.branch}; found ${branch}` };
    if (revision !== config.store.published_revision) return { status: "unhealthy", detail: "HEAD differs from published revision" };
    if (porcelain) return { status: "unhealthy", detail: "Memory working tree is dirty" };
    return { status: "ok" };
  } catch (error) {
    return { status: "unhealthy", detail: error instanceof Error ? error.message : String(error) };
  }
}
