import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { isMemoryKind, memoryKinds, type MemoryKind } from "../memory/kinds.js";
import { collectMemoryReferenceTargets } from "../memory/references.js";
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

const marketMemorySchema = z.object({
  install: uniqueMemoryPathsSchema
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
  }).strict(),
  z.object({
    version: z.literal(4),
    memory_syntax: z.literal(currentMemorySyntax),
    system_memory: identityManifestSystemMemorySchema,
    market_memory: marketMemorySchema
  }).strict()
]).superRefine((manifest, context) => {
  const install = new Set(manifest.system_memory.install);
  const removePaths = manifest.version === 3 || manifest.version === 4
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
  if (manifest.version === 4) {
    for (const [index, path] of manifest.market_memory.install.entries()) {
      if (!install.has(path)) continue;
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["market_memory", "install", index],
        message: `memory path cannot be system and market memory: ${path}`
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
  if (manifest.version !== 3 && manifest.version !== 4) return [];
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

export type BundledMarketMemoryDescriptor = BundledSystemMemoryDescriptor & {
  source: Buffer;
  digest: string;
  entity: Awaited<ReturnType<typeof readMemoryFile>>["entity"];
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

  const sourcePaths = [
    ...manifest.system_memory.install,
    ...(manifest.version === 4 ? manifest.market_memory.install : [])
  ];
  for (const relativePath of sourcePaths) {
    const sourceType = manifest.version === 4 && manifest.market_memory.install.includes(relativePath)
      ? "market"
      : "system";
    const sourcePath = resolveMemoryPath(sourceRoot, relativePath);
    const sourceStat = await lstat(sourcePath).catch((error: unknown) => {
      if (isNodeError(error, "ENOENT")) {
        throw new Error(`${sourceType} memory source not found: ${relativePath}`);
      }
      throw error;
    });
    if (!sourceStat.isFile()) {
      throw new Error(`${sourceType} memory source is not a regular file: ${relativePath}`);
    }
  }

  if (manifest.version === 4) {
    const identities = new Map<string, string>();
    const bundled = new Map<string, Awaited<ReturnType<typeof readMemoryFile>>>();
    const canonicalReferences = new Set<string>();
    for (const relativePath of sourcePaths) {
      const kind = relativePath.split("/", 1)[0];
      if (!isMemoryKind(kind)) throw new Error(`invalid bundled Memory kind: ${relativePath}`);
      const file = await readMemoryFile(kind, resolveMemoryPath(sourceRoot, relativePath));
      bundled.set(relativePath, file);
      if (file.entity.syntax !== manifest.memory_syntax) {
        throw new Error(`bundled Memory ${relativePath} uses syntax ${file.entity.syntax}; expected ${manifest.memory_syntax}`);
      }
      for (const name of file.entity.names) {
        const identity = `${kind}/${name}`;
        const previous = identities.get(identity);
        if (previous) throw new Error(`duplicate bundled Memory identity ${identity}: ${previous}, ${relativePath}`);
        identities.set(identity, relativePath);
      }
      canonicalReferences.add(`${kind}/${file.entity.names[0]}`);
    }
    for (const relativePath of manifest.market_memory.install) {
      const file = bundled.get(relativePath);
      if (!file) throw new Error(`market memory source was not loaded: ${relativePath}`);
      for (const dependency of collectMemoryReferenceTargets(file.entity)) {
        if (canonicalReferences.has(dependency)) continue;
        throw new Error(`market Memory dependency is not declared by system_memory.install or market_memory.install: ${dependency} (${relativePath})`);
      }
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

export async function readBundledMarketMemories(
  sourceRoot = bundledReservedMemoryRoot()
): Promise<BundledMarketMemoryDescriptor[]> {
  const manifest = await readReservedMemoryManifest(sourceRoot);
  if (manifest.version !== 4) return [];
  return Promise.all(manifest.market_memory.install.map(async (path) => {
    const kind = path.split("/", 1)[0];
    if (!isMemoryKind(kind)) throw new Error(`invalid market Memory kind: ${path}`);
    const absolute = resolveMemoryPath(sourceRoot, path);
    const [file, source] = await Promise.all([readMemoryFile(kind, absolute), readFile(absolute)]);
    const names = [...file.entity.names];
    return {
      path,
      kind,
      reference: `${kind}/${names[0]}`,
      names,
      source,
      digest: createHash("sha256").update(source).digest("hex"),
      entity: file.entity
    };
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
