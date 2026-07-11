import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getReview, type ReviewFile } from "../review/store.js";
import { readRun, type RunState } from "../run/store.js";

export const archiveKinds = ["reviews", "runs"] as const;
export type ArchiveKind = (typeof archiveKinds)[number];
export type ArchiveObjectType = "review" | "run";

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
  reviewsRoot: string;
  runsRoot: string;
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
      const metadata = await readArchiveMetadata(path);
      entries.push({ kind, id, path, archivedAt: metadata?.archivedAt });
    }
  }

  return entries.sort((a, b) => (b.archivedAt ?? b.id).localeCompare(a.archivedAt ?? a.id));
}

export async function archiveReview(input: Pick<ArchiveRoots, "archiveRoot" | "reviewsRoot"> & { id: string }): Promise<ArchiveEntry> {
  const review = await getReview(input.reviewsRoot, input.id);
  if (!review) throw new Error(`review not found: ${input.id}`);
  ensureDone("review", review);

  const activePath = join(input.reviewsRoot, input.id);
  const archivePath = archiveItemPath(input.archiveRoot, "reviews", input.id);
  await ensureCanMove(activePath, archivePath);
  await mkdir(archiveKindRoot(input.archiveRoot, "reviews"), { recursive: true });
  await rename(activePath, archivePath);
  const metadata = await writeArchiveMetadata(archivePath, "reviews", input.id, "directory");
  return { kind: "reviews", id: input.id, path: archivePath, archivedAt: metadata.archivedAt };
}

export async function archiveRun(input: Pick<ArchiveRoots, "archiveRoot" | "runsRoot"> & { id: string }): Promise<ArchiveEntry> {
  const run = await readRun(input.runsRoot, input.id);
  ensureDone("run", run);

  const layout = await resolveActiveRunLayout(input.runsRoot, input.id);
  const archivePath = archiveItemPath(input.archiveRoot, "runs", input.id);
  if (await pathExists(archivePath)) throw new Error(`archive already exists: ${input.id}`);
  await mkdir(archiveKindRoot(input.archiveRoot, "runs"), { recursive: true });

  if (layout.layout === "directory") {
    await rename(layout.path, archivePath);
  } else {
    await mkdir(archivePath, { recursive: true });
    await rename(layout.path, join(archivePath, basename(layout.path)));
  }

  const metadata = await writeArchiveMetadata(archivePath, "runs", input.id, layout.layout);
  return { kind: "runs", id: input.id, path: archivePath, archivedAt: metadata.archivedAt };
}

export async function restoreReview(input: Pick<ArchiveRoots, "archiveRoot" | "reviewsRoot"> & { id: string }): Promise<ReviewFile> {
  const archivePath = archiveItemPath(input.archiveRoot, "reviews", input.id);
  const activePath = join(input.reviewsRoot, input.id);
  await ensureCanMove(archivePath, activePath);
  await mkdir(input.reviewsRoot, { recursive: true });
  await rename(archivePath, activePath);
  const review = await getReview(input.reviewsRoot, input.id);
  if (!review) throw new Error(`restored review is invalid: ${input.id}`);
  return review;
}

export async function restoreRun(input: Pick<ArchiveRoots, "archiveRoot" | "runsRoot"> & { id: string }): Promise<RunState> {
  const archivePath = archiveItemPath(input.archiveRoot, "runs", input.id);
  if (!(await pathExists(archivePath))) throw new Error(`archive not found: ${input.id}`);

  const metadata = await readArchiveMetadata(archivePath);
  const layout = metadata?.layout === "legacy-file" ? "legacy-file" : "directory";
  await mkdir(input.runsRoot, { recursive: true });

  if (layout === "legacy-file") {
    const source = join(archivePath, `${input.id}.json`);
    const target = join(input.runsRoot, `${input.id}.json`);
    await ensureCanMove(source, target);
    await rename(source, target);
    await rm(archivePath, { recursive: true, force: true });
  } else {
    const target = join(input.runsRoot, input.id);
    await ensureCanMove(archivePath, target);
    await rename(archivePath, target);
  }

  return readRun(input.runsRoot, input.id);
}

function archiveKindRoot(archiveRoot: string, kind: ArchiveKind): string {
  return join(archiveRoot, kind);
}

function archiveItemPath(archiveRoot: string, kind: ArchiveKind, id: string): string {
  return join(archiveKindRoot(archiveRoot, kind), id);
}

async function resolveActiveRunLayout(runsRoot: string, id: string): Promise<{ layout: ArchiveLayout; path: string }> {
  const directoryPath = join(runsRoot, id);
  if (await pathExists(join(directoryPath, `${id}.json`))) {
    return { layout: "directory", path: directoryPath };
  }

  const legacyPath = join(runsRoot, `${id}.json`);
  if (await pathExists(legacyPath)) {
    return { layout: "legacy-file", path: legacyPath };
  }

  throw new Error(`run not found: ${id}`);
}

function ensureDone(type: ArchiveObjectType, item: { id: string; status: string }): void {
  if (item.status !== "done") {
    throw new Error(`only done ${type}s can be archived: ${item.id}`);
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
  await writeFile(join(path, ".archive.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return metadata;
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
