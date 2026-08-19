import { lstat, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { isMemoryKind, memoryKinds, type MemoryKind } from "../memory/kinds.js";
import { readMemoryFile } from "../memory/store.js";
import { currentMemorySyntax } from "../memory/syntax.js";

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

export type BundledSystemMemoryDescriptor = {
  path: string;
  kind: MemoryKind;
  reference: string;
  names: string[];
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(moduleDir, "../..");

export function bundledReservedMemoryRoot(): string {
  return join(packageRoot, reservedMemoryDirectoryName);
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

export async function readBundledSystemMemories(
  sourceRoot = bundledReservedMemoryRoot()
): Promise<BundledSystemMemoryDescriptor[]> {
  const manifest = await readReservedMemoryManifest(sourceRoot);
  return Promise.all(manifest.system_memory.install.map(async (path) => {
    const kind = path.split("/", 1)[0];
    if (!isMemoryKind(kind)) throw new Error(`invalid system Memory kind: ${path}`);
    const file = await readMemoryFile(kind, resolveMemoryPath(sourceRoot, path));
    const names = [...file.entity.names];
    return { path, kind, reference: `${kind}/${names[0]}`, names };
  }));
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

function resolveMemoryPath(root: string, relativePath: string): string {
  assertSafeMemoryRelativePath(relativePath);
  const path = resolve(root, relativePath);
  assertInsideDirectory(path, root);
  return path;
}

function assertInsideDirectory(path: string, root: string): void {
  const rel = relative(resolve(root), resolve(path));
  if (rel.startsWith("..") || rel === "" || rel.includes(`..${sep}`)) {
    throw new Error(`path escapes directory: ${path}`);
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
