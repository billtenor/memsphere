import { copyFile, lstat, mkdir, readFile, readdir, rm, stat, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { memoryKinds, type MemoryKind } from "../memory/kinds.js";
import { listMemoryFiles, readMemoryFile, type MemoryFile } from "../memory/store.js";
import { currentMemorySyntax } from "../memory/syntax.js";

export type ReservedMemoryListItem = {
  kind: MemoryKind;
  path: string;
  imported: boolean;
  file?: MemoryFile;
  error?: unknown;
};

export const reservedMemoryDirectoryName = "reserved-memory";
export const reservedMemoryManifestFileName = "manifest.json";

const memoryPathSchema = z.string().min(1).superRefine((value, context) => {
  try {
    assertSafeMemoryRelativePath(value);
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : "invalid memory path"
    });
  }
});

const uniqueMemoryPathsSchema = z.array(memoryPathSchema).superRefine((paths, context) => {
  const seen = new Set<string>();
  for (const [index, path] of paths.entries()) {
    if (seen.has(path)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: `duplicate memory path: ${path}`
      });
    }
    seen.add(path);
  }
});

const manifestSystemMemorySchema = z.object({
  install: uniqueMemoryPathsSchema,
  remove: uniqueMemoryPathsSchema
}).strict();

export const reservedMemoryManifestSchema = z.discriminatedUnion("version", [
  z.object({
    version: z.literal(1),
    system_memory: manifestSystemMemorySchema
  }).strict(),
  z.object({
    version: z.literal(2),
    memory_syntax: z.literal(currentMemorySyntax),
    system_memory: manifestSystemMemorySchema
  }).strict()
]).superRefine((manifest, context) => {
  const install = new Set(manifest.system_memory.install);
  for (const [index, path] of manifest.system_memory.remove.entries()) {
    if (install.has(path)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["system_memory", "remove", index],
        message: `memory path cannot be installed and removed: ${path}`
      });
    }
  }
});

export type ReservedMemoryManifest = z.infer<typeof reservedMemoryManifestSchema>;

export type ReservedMemoryInstallResult = {
  reservedMemoryRoot: string;
  installedSystemMemories: number;
  removedSystemMemories: number;
  installedReservedMemories: number;
};

type InstallReservedMemoryOptions = {
  memoryRoot?: string;
  sourceRoot?: string;
};

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

export async function readReservedMemoryManifest(sourceRoot = bundledReservedMemoryRoot()): Promise<ReservedMemoryManifest> {
  const manifestPath = join(sourceRoot, reservedMemoryManifestFileName);
  const source = await readFile(manifestPath, "utf8");
  const parsed: unknown = JSON.parse(source);
  const manifest = reservedMemoryManifestSchema.parse(parsed);

  for (const relativePath of manifest.system_memory.install) {
    const sourcePath = resolveMemoryPath(sourceRoot, relativePath);
    const sourceStat = await lstat(sourcePath).catch((error: unknown) => {
      if (isNodeError(error, "ENOENT")) {
        throw new Error(`system memory source not found: ${relativePath}`);
      }
      throw error;
    });
    if (!sourceStat.isFile()) {
      throw new Error(`system memory source is not a regular file: ${relativePath}`);
    }
  }

  return manifest;
}

export async function installReservedMemories(
  scopeRoot: string,
  options: InstallReservedMemoryOptions = {}
): Promise<ReservedMemoryInstallResult> {
  const sourceRoot = options.sourceRoot ?? bundledReservedMemoryRoot();
  const memoryRoot = options.memoryRoot ?? join(scopeRoot, "memory");
  const targetRoot = reservedMemoryRoot(scopeRoot);
  const manifest = await readReservedMemoryManifest(sourceRoot);
  const sourcePaths = await listBundledMemoryPaths(sourceRoot);
  if (manifest.version === 2) {
    for (const relativePath of sourcePaths) {
      const kind = relativePath.split("/")[0] as MemoryKind;
      const file = await readMemoryFile(kind, resolveMemoryPath(sourceRoot, relativePath));
      if (file.entity.syntax !== manifest.memory_syntax) {
        throw new Error(
          `reserved Memory ${relativePath} uses syntax ${file.entity.syntax}; expected ${manifest.memory_syntax}`
        );
      }
    }
  }
  const systemMemoryPaths = new Set(manifest.system_memory.install);

  for (const relativePath of manifest.system_memory.remove) {
    await validateRemovalTarget(memoryRoot, relativePath);
  }
  for (const relativePath of manifest.system_memory.install) {
    await validateInstallTarget(memoryRoot, relativePath);
  }

  let removedSystemMemories = 0;
  for (const relativePath of manifest.system_memory.remove) {
    if (await removeMemoryFile(memoryRoot, relativePath)) {
      removedSystemMemories += 1;
    }
  }

  for (const relativePath of manifest.system_memory.install) {
    await copyMemoryFile(sourceRoot, memoryRoot, relativePath);
  }

  await rm(targetRoot, { recursive: true, force: true });
  await ensureReservedMemoryDirectories(targetRoot);

  let installedReservedMemories = 0;
  for (const relativePath of sourcePaths) {
    if (systemMemoryPaths.has(relativePath)) continue;
    await copyMemoryFile(sourceRoot, targetRoot, relativePath);
    installedReservedMemories += 1;
  }

  return {
    reservedMemoryRoot: targetRoot,
    installedSystemMemories: manifest.system_memory.install.length,
    removedSystemMemories,
    installedReservedMemories
  };
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
      const relativePath = relative(root, path).split(sep).join("/");
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
  try {
    assertSafeMemoryRelativePath(relativePath);
  } catch {
    throw new Error(`invalid reserved memory path: ${relativePath}`);
  }
}

function assertSafeMemoryRelativePath(relativePath: string): void {
  const segments = relativePath.split("/");
  if (
    !relativePath ||
    relativePath.includes("\\") ||
    relativePath.startsWith("/") ||
    relativePath.includes("\0") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
    !memoryKinds.some((kind) => relativePath.startsWith(`${kind}/`)) ||
    ![".yaml", ".yml"].some((suffix) => relativePath.endsWith(suffix))
  ) {
    throw new Error(`invalid memory path: ${relativePath}`);
  }
}

async function listBundledMemoryPaths(sourceRoot: string): Promise<string[]> {
  const paths: string[] = [];
  for (const kind of memoryKinds) {
    const kindRoot = join(sourceRoot, kind);
    if (!(await pathExists(kindRoot))) continue;
    await collectBundledMemoryPaths(sourceRoot, kindRoot, paths);
  }
  return paths.sort((a, b) => a.localeCompare(b));
}

async function collectBundledMemoryPaths(sourceRoot: string, currentRoot: string, paths: string[]): Promise<void> {
  const entries = await readdir(currentRoot, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(currentRoot, entry.name);
    if (entry.isDirectory()) {
      await collectBundledMemoryPaths(sourceRoot, path, paths);
      continue;
    }
    if (!entry.isFile() || ![".yaml", ".yml"].some((suffix) => entry.name.endsWith(suffix))) continue;
    paths.push(relative(sourceRoot, path).split(sep).join("/"));
  }
}

async function copyMemoryFile(sourceRoot: string, targetRoot: string, relativePath: string): Promise<void> {
  const sourcePath = resolveMemoryPath(sourceRoot, relativePath);
  const targetPath = resolveMemoryPath(targetRoot, relativePath);
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}

async function removeMemoryFile(memoryRoot: string, relativePath: string): Promise<boolean> {
  const path = resolveMemoryPath(memoryRoot, relativePath);
  let targetStat;
  try {
    targetStat = await lstat(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
  if (!targetStat.isFile() && !targetStat.isSymbolicLink()) {
    throw new Error(`system memory removal target is not a file: ${relativePath}`);
  }
  await unlink(path);
  return true;
}

async function validateRemovalTarget(memoryRoot: string, relativePath: string): Promise<void> {
  const path = resolveMemoryPath(memoryRoot, relativePath);
  const targetStat = await lstatIfExists(path);
  if (targetStat && !targetStat.isFile() && !targetStat.isSymbolicLink()) {
    throw new Error(`system memory removal target is not a file: ${relativePath}`);
  }
}

async function validateInstallTarget(memoryRoot: string, relativePath: string): Promise<void> {
  const path = resolveMemoryPath(memoryRoot, relativePath);
  const targetStat = await lstatIfExists(path);
  if (targetStat?.isSymbolicLink()) {
    throw new Error(`system memory install target is a symbolic link: ${relativePath}`);
  }
  if (targetStat && !targetStat.isFile()) {
    throw new Error(`system memory install target is not a file: ${relativePath}`);
  }
}

async function lstatIfExists(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  }
}

function resolveMemoryPath(root: string, relativePath: string): string {
  assertSafeMemoryRelativePath(relativePath);
  const path = resolve(root, relativePath);
  assertInsideDirectory(path, root);
  return path;
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

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
