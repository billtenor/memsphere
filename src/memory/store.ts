import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { memoryKinds, type MemoryKind } from "./kinds.js";
import { memorySchemas, type MemoryEntity } from "./schema.js";
import { assertExpectedTag, parseMemoryYaml } from "./yaml.js";

export type MemoryFile = {
  kind: MemoryKind;
  path: string;
  entity: MemoryEntity;
};

export async function readMemoryFile(kind: MemoryKind, filePath: string): Promise<MemoryFile> {
  const source = await readFile(filePath, "utf8");
  const entity = parseMemoryYaml(source);

  assertExpectedTag(entity, kind, filePath);

  const parsed = memorySchemas[kind].parse(entity) as MemoryEntity;

  return {
    kind,
    path: filePath,
    entity: parsed
  };
}

export async function listMemoryFiles(memoryRoot: string, kind: MemoryKind): Promise<string[]> {
  const dir = join(memoryRoot, kind);
  const entries = await readdir(dir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && [".yaml", ".yml"].some((suffix) => entry.name.endsWith(suffix)))
    .map((entry) => join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

export async function readAllMemoryFiles(memoryRoot: string, kind?: MemoryKind): Promise<MemoryFile[]> {
  const kinds = kind ? [kind] : memoryKinds;
  const files: MemoryFile[] = [];

  for (const currentKind of kinds) {
    const paths = await listMemoryFiles(memoryRoot, currentKind);

    for (const path of paths) {
      files.push(await readMemoryFile(currentKind, path));
    }
  }

  return files;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}
