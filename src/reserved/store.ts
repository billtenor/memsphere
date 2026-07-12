import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { memoryKinds, type MemoryKind } from "../memory/kinds.js";
import { listMemoryFiles, readMemoryFile, type MemoryFile } from "../memory/store.js";

export type ReservedMemoryListItem = {
  kind: MemoryKind;
  path: string;
  imported: boolean;
  file?: MemoryFile;
  error?: unknown;
};

export const reservedMemoryDirectoryName = "reserved-memory";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(moduleDir, "../..");

export function bundledReservedMemoryRoot(): string {
  return join(packageRoot, reservedMemoryDirectoryName);
}

export function reservedMemoryRoot(scopeRoot: string): string {
  return join(scopeRoot, reservedMemoryDirectoryName);
}

export async function ensureReservedMemoryDirectories(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  for (const kind of memoryKinds) {
    await mkdir(join(root, kind), { recursive: true });
  }
}

export async function installReservedMemories(
  scopeRoot: string,
  options: { force?: boolean } = {}
): Promise<string> {
  const sourceRoot = bundledReservedMemoryRoot();
  const targetRoot = reservedMemoryRoot(scopeRoot);
  if (options.force) {
    await rm(targetRoot, { recursive: true, force: true });
  }
  await ensureReservedMemoryDirectories(targetRoot);

  if (!(await pathExists(sourceRoot))) {
    return targetRoot;
  }

  for (const kind of memoryKinds) {
    const sourceKindRoot = join(sourceRoot, kind);
    const targetKindRoot = join(targetRoot, kind);
    if (!(await pathExists(sourceKindRoot))) continue;
    await copyMissingFiles(sourceKindRoot, targetKindRoot);
  }

  return targetRoot;
}

export async function importReservedMemory(scopeRoot: string, memoryRoot: string, relativePath: string): Promise<string> {
  assertSafeReservedRelativePath(relativePath);
  const sourcePath = resolveReservedMemoryPath(scopeRoot, relativePath);
  const targetPath = resolveUserMemoryPath(memoryRoot, relativePath);
  if (!(await pathExists(sourcePath))) {
    throw new Error(`reserved memory not found: ${relativePath}`);
  }
  if (await pathExists(targetPath)) {
    throw new Error(`memory already exists: ${relativePath}`);
  }
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
  return targetPath;
}

export async function listReservedMemories(scopeRoot: string, memoryRoot?: string, kind?: MemoryKind): Promise<ReservedMemoryListItem[]> {
  const root = reservedMemoryRoot(scopeRoot);
  const kinds = kind ? [kind] : memoryKinds;
  const items: ReservedMemoryListItem[] = [];

  for (const currentKind of kinds) {
    const paths = await listMemoryFiles(root, currentKind);
    for (const path of paths) {
      const relativePath = relative(root, path);
      const imported = memoryRoot ? await pathExists(resolveUserMemoryPath(memoryRoot, relativePath)) : false;
      try {
        const file = await readMemoryFile(currentKind, path);
        items.push({
          kind: currentKind,
          path: relativePath,
          imported,
          file
        });
      } catch (error) {
        items.push({
          kind: currentKind,
          path: relativePath,
          imported,
          error
        });
      }
    }
  }

  return items.sort((a, b) => a.path.localeCompare(b.path));
}

export function assertSafeReservedRelativePath(relativePath: string): void {
  const normalized = relativePath.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").includes("..") ||
    !memoryKinds.some((kind) => normalized.startsWith(`${kind}/`))
  ) {
    throw new Error(`invalid reserved memory path: ${relativePath}`);
  }
}

async function copyMissingFiles(sourceRoot: string, targetRoot: string): Promise<void> {
  await mkdir(targetRoot, { recursive: true });
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(sourceRoot, entry.name);
    const targetPath = join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      await copyMissingFiles(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile() || ![".yaml", ".yml"].some((suffix) => entry.name.endsWith(suffix))) continue;
    assertInsideDirectory(targetPath, targetRoot);
    if (await pathExists(targetPath)) continue;
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
}

function resolveReservedMemoryPath(scopeRoot: string, relativePath: string): string {
  const root = reservedMemoryRoot(scopeRoot);
  const path = resolve(root, relativePath);
  assertInsideDirectory(path, root);
  return path;
}

function resolveUserMemoryPath(memoryRoot: string, relativePath: string): string {
  const path = resolve(memoryRoot, relativePath);
  assertInsideDirectory(path, memoryRoot);
  return path;
}

function assertInsideDirectory(path: string, root: string): void {
  const rel = relative(resolve(root), resolve(path));
  if (rel.startsWith("..") || rel === "" || rel.includes(`..${sep}`)) {
    throw new Error(`path escapes directory: ${path}`);
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
