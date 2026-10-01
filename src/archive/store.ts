import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { readRun, type RunState } from "../run/store.js";
import { ensureRunWorkersExited } from "./worker-guard.js";
import { runContentManifest, type RunContentRef } from "../run/content-manifest.js";
import { prepareRunData, runDataStore } from "../project/run-data.js";
import { consumeContent } from "../data/extensions/shared/payload.js";
import type { PayloadContent } from "../data/api/payload.js";

export const archiveKinds = ["runs", "changes"] as const;
export type ArchiveKind = (typeof archiveKinds)[number];
export type ArchiveObjectType = "run";

export type ArchiveEntry = {
  kind: ArchiveKind;
  id: string;
  path: string;
  archivedAt?: string;
};

type ArchiveLayout = "directory" | "legacy-file";

type ArchiveMetadata = {
  kind: ArchiveKind;
  id: string;
  archivedAt: string;
  layout: ArchiveLayout;
};

type ArchiveRoots = {
  archiveRoot: string;
  runsRoot: string;
  changesRoot: string;
};

export function archiveRootForScope(scopeRoot: string): string {
  return join(scopeRoot, "archives");
}

export async function listArchived(input: { archiveRoot: string; kind?: ArchiveKind }): Promise<ArchiveEntry[]> {
  const kinds = input.kind ? [input.kind] : [...archiveKinds];
  const entries: ArchiveEntry[] = [];

  for (const kind of kinds) {
    const kindRoot = archiveKindRoot(input.archiveRoot, kind);
    if (!(await pathExists(kindRoot))) continue;
    for (const entry of await readdir(kindRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const path = join(kindRoot, id);
      if (kind === "runs" && !await pathExists(join(path, `${id}.json`))) continue;
      const metadata = await readArchiveMetadata(path);
      entries.push({ kind, id, path, archivedAt: metadata?.archivedAt });
    }
  }

  return entries.sort((a, b) => (b.archivedAt ?? b.id).localeCompare(a.archivedAt ?? a.id));
}

export async function archiveRun(input: Pick<ArchiveRoots, "archiveRoot" | "runsRoot"> & { id: string }): Promise<ArchiveEntry> {
  const archivePath = archiveItemPath(input.archiveRoot, "runs", input.id);
  await transferRun(input, "archive");
  const metadata = await readArchiveMetadata(archivePath);
  return { kind: "runs", id: input.id, path: archivePath, archivedAt: metadata?.archivedAt };
}

export async function archiveChangeDirectory(
  input: Pick<ArchiveRoots, "archiveRoot" | "changesRoot"> & { id: string }
): Promise<ArchiveEntry> {
  if (!/^change-[a-zA-Z0-9-]+$/.test(input.id)) throw new Error(`invalid ChangeSet id: ${input.id}`);
  const source = join(input.changesRoot, input.id);
  const archivePath = archiveItemPath(input.archiveRoot, "changes", input.id);
  if (await pathExists(archivePath)) throw new Error(`archive already exists: ${input.id}`);
  await ensureCanMove(source, archivePath);
  await mkdir(archiveKindRoot(input.archiveRoot, "changes"), { recursive: true });
  await rename(source, archivePath);
  try {
    const metadata = await writeArchiveMetadata(archivePath, "changes", input.id, "directory");
    return { kind: "changes", id: input.id, path: archivePath, archivedAt: metadata.archivedAt };
  } catch (error) {
    await rename(archivePath, source).catch(() => undefined);
    throw error;
  }
}

export async function restoreRun(input: Pick<ArchiveRoots, "archiveRoot" | "runsRoot"> & { id: string }): Promise<RunState> {
  await transferRun(input, "restore");
  return readRun(input.runsRoot, input.id);
}

async function transferRun(input: Pick<ArchiveRoots, "archiveRoot" | "runsRoot"> & { id: string }, direction: "archive" | "restore"): Promise<void> {
  if (!/^run-[a-zA-Z0-9-]+$/.test(input.id)) throw new Error(`invalid Run id: ${input.id}`);
  const archivedRoot = archiveKindRoot(input.archiveRoot, "runs");
  const sourceRoot = direction === "archive" ? input.runsRoot : archivedRoot;
  const targetRoot = direction === "archive" ? archivedRoot : input.runsRoot;
  const source = await findRunState(sourceRoot, input.id);
  const target = await findRunState(targetRoot, input.id);
  if (!source && !target) throw new Error(`run not found: ${input.id}`);
  const run = (source ?? target)!.run;
  ensureTerminalRun(run);
  ensureRunWorkersExited(run);
  // Do not overwrite an independently active Run with an archived terminal copy.
  if (source && target) ensureTerminalRun(target.run);
  const manifest = runContentManifest(run);
  prepareRunData(input);
  const archivePath = archiveItemPath(input.archiveRoot, "runs", input.id);
  let metadata = await readArchiveMetadata(archivePath);
  if (source) {
    const present: RunContentRef[] = [];
    for (const ref of manifest) {
      const from = await runDataStore(sourceRoot, ref.kind);
      const stored = await from.get({}, ref.id);
      if (!stored) {
        if (ref.required) throw new Error(`Run content not found: ${ref.id}`);
        continue;
      }
      present.push(ref);
      const to = await runDataStore(targetRoot, ref.kind);
      if (await to.has({}, ref.id)) await to.update({}, stored.data);
      else await to.create({}, stored.data);
    }
    for (const ref of present) {
      const from = await (await runDataStore(sourceRoot, ref.kind)).get({}, ref.id);
      const to = await (await runDataStore(targetRoot, ref.kind)).get({}, ref.id);
      if (!from || !to) throw new Error(`Run content disappeared during transfer: ${ref.id}`);
      if (from.data.payload.contentType !== to.data.payload.contentType
        || await contentDigest(from.data.payload.content) !== await contentDigest(to.data.payload.content)) throw new Error(`Run content verification failed: ${ref.id}`);
    }
    let targetPath: string;
    if (direction === "archive") {
      await mkdir(archivePath, { recursive: true });
      // Existing business state, saved before the status commit so legacy layout survives redo.
      metadata ??= await writeArchiveMetadata(archivePath, "runs", input.id, source.layout);
      targetPath = join(archivePath, `${input.id}.json`);
    } else {
      const layout = metadata?.layout ?? "directory";
      targetPath = layout === "legacy-file" ? join(targetRoot, `${input.id}.json`) : join(targetRoot, input.id, `${input.id}.json`);
      await mkdir(dirname(targetPath), { recursive: true });
      if (layout === "directory" && metadata) await saveArchiveMetadata(join(targetRoot, input.id), metadata);
    }
    await rename(source.path, targetPath);
  }
  // After status commit, the target is authoritative. Never copy stale source remnants back.
  for (const ref of manifest) {
    const stored = await (await runDataStore(targetRoot, ref.kind)).get({}, ref.id);
    if (!stored) {
      if (ref.required || await (await runDataStore(sourceRoot, ref.kind)).has({}, ref.id)) throw new Error(`Committed Run content is missing: ${ref.id}; source retained`);
      continue;
    }
    // Consume once to detect an unreadable target before deleting its source.
    await contentDigest(stored.data.payload.content);
  }
  for (const ref of manifest) await (await runDataStore(sourceRoot, ref.kind)).delete({}, ref.id);
  await rm(join(sourceRoot, input.id, ".archive.json"), { force: true });
  await removeEmptyRunDirectories(join(sourceRoot, input.id), join(sourceRoot, input.id, "memory"));
}

async function contentDigest(content: PayloadContent): Promise<string> {
  const hash = createHash("sha256");
  await consumeContent({}, content, async (chunk) => { hash.update(chunk); });
  return hash.digest("hex");
}

async function findRunState(root: string, id: string): Promise<{ path: string; layout: ArchiveLayout; run: RunState } | undefined> {
  for (const [layout, path] of [["directory", join(root, id, `${id}.json`)], ["legacy-file", join(root, `${id}.json`)]] as const) {
    if (await pathExists(path)) return { path, layout, run: await readRun(root, id) };
  }
  return undefined;
}

/** Hygiene only: remove empty directories, never recursively delete unknown content. */
async function removeEmptyRunDirectories(path: string, memoryPath: string): Promise<void> {
  if (!await pathExists(path)) return;
  if (!(await lstat(path)).isDirectory()) throw new Error(`Unmanaged Run path retained: ${path}`);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    // Old directory snapshots also copied Git placeholders, which are discardable.
    if (entry.isFile() && entry.name === ".gitkeep" && (path === memoryPath || path.startsWith(`${memoryPath}${sep}`))) {
      await rm(join(path, entry.name));
      continue;
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Unmanaged Run file retained: ${join(path, entry.name)}`);
    await removeEmptyRunDirectories(join(path, entry.name), memoryPath);
  }
  await rmdir(path);
}

function archiveKindRoot(archiveRoot: string, kind: ArchiveKind): string {
  return join(archiveRoot, kind);
}

function archiveItemPath(archiveRoot: string, kind: ArchiveKind, id: string): string {
  return join(archiveKindRoot(archiveRoot, kind), id);
}

function ensureTerminalRun(run: Pick<RunState, "id" | "status">): void {
  if (run.status !== "done" && run.status !== "abandoned") {
    throw new Error(`only done or abandoned runs can be archived: ${run.id}`);
  }
}

async function ensureCanMove(source: string, target: string): Promise<void> {
  if (!(await pathExists(source))) {
    throw new Error(`source does not exist: ${source}`);
  }
  if (await pathExists(target)) {
    throw new Error(`target already exists: ${target}`);
  }
}

async function writeArchiveMetadata(path: string, kind: ArchiveKind, id: string, layout: ArchiveLayout): Promise<ArchiveMetadata> {
  const metadata = { kind, id, archivedAt: new Date().toISOString(), layout };
  await saveArchiveMetadata(path, metadata);
  return metadata;
}

async function saveArchiveMetadata(path: string, metadata: ArchiveMetadata): Promise<void> {
  const temporary = join(path, `.archive.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    await rename(temporary, join(path, ".archive.json"));
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readArchiveMetadata(path: string): Promise<ArchiveMetadata | undefined> {
  try {
    return JSON.parse(await readFile(join(path, ".archive.json"), "utf8")) as ArchiveMetadata;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
