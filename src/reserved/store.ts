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

const legacyManifestSystemMemorySchema = z.object({
  install: uniqueMemoryPathsSchema,
  remove: uniqueMemoryPathsSchema
}).strict();

const memoryIdentityReferenceSchema = z.string().min(1).superRefine((reference, context) => {
  const separator = reference.indexOf("/");
  const kind = reference.slice(0, separator);
  const name = reference.slice(separator + 1);
  if (
    separator <= 0
    || !isMemoryKind(kind)
    || !name
    || name.trim() !== name
    || name.includes("/")
    || name.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(name)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `invalid canonical Memory reference: ${reference}`
    });
  }
});

const removalTombstoneSchema = z.object({
  path: memoryPathSchema,
  references: z.array(memoryIdentityReferenceSchema).min(1).superRefine((references, context) => {
    const seen = new Set<string>();
    for (const [index, reference] of references.entries()) {
      if (seen.has(reference)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `duplicate canonical Memory reference: ${reference}`
        });
      }
      seen.add(reference);
    }
  })
}).strict().superRefine((tombstone, context) => {
  const kind = tombstone.path.split("/", 1)[0];
  for (const [index, reference] of tombstone.references.entries()) {
    if (!reference.startsWith(`${kind}/`)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["references", index],
        message: `Memory reference kind does not match tombstone path: ${reference}`
      });
    }
  }
});

const identityRemovalSchema = z.array(removalTombstoneSchema).superRefine((tombstones, context) => {
  const seen = new Set<string>();
  for (const [index, tombstone] of tombstones.entries()) {
    if (seen.has(tombstone.path)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "path"],
        message: `duplicate removal tombstone path: ${tombstone.path}`
      });
    }
    seen.add(tombstone.path);
  }
});

const identityManifestSystemMemorySchema = z.object({
  install: uniqueMemoryPathsSchema,
  remove: identityRemovalSchema
}).strict();

export const reservedMemoryManifestSchema = z.discriminatedUnion("version", [
  z.object({
    version: z.literal(1),
    system_memory: legacyManifestSystemMemorySchema
  }).strict(),
  z.object({
    version: z.literal(2),
    memory_syntax: z.literal(currentMemorySyntax),
    system_memory: legacyManifestSystemMemorySchema
  }).strict(),
  z.object({
    version: z.literal(3),
    memory_syntax: z.literal(currentMemorySyntax),
    system_memory: identityManifestSystemMemorySchema
  }).strict()
]).superRefine((manifest, context) => {
  const install = new Set(manifest.system_memory.install);
  const removePaths = manifest.version === 3
    ? manifest.system_memory.remove.map((tombstone) => tombstone.path)
    : manifest.system_memory.remove;
  for (const [index, path] of removePaths.entries()) {
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

export type ReservedSystemMemoryRemovalTombstone = {
  path: string;
  references: string[];
};

export function reservedSystemMemoryRemovalTombstones(
  manifest: ReservedMemoryManifest
): ReservedSystemMemoryRemovalTombstone[] {
  if (manifest.version !== 3) return [];
  return manifest.system_memory.remove.map((tombstone) => ({
    path: tombstone.path,
    references: [...tombstone.references]
  }));
}

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
