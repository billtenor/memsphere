import { open, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { parse } from "yaml";
import { memoryKinds, memoryKindTags, type MemoryKind } from "./kinds.js";
import { canonicalMemoryNameIssue, memoryAliasIssue } from "./logical-reference.js";
import { memorySyntaxRegistry, type MemoryEntity } from "./schema.js";
import { readMemorySyntax } from "./syntax.js";
import { assertExpectedTag, parseMemoryYaml } from "./yaml.js";

export type MemoryFile = {
  kind: MemoryKind;
  path: string;
  entity: MemoryEntity;
};

export type MemoryFileSummary = {
  kind: MemoryKind;
  path: string;
  names: string[];
};

export async function readMemoryFile(kind: MemoryKind, filePath: string): Promise<MemoryFile> {
  const source = await readFile(filePath, "utf8");
  const entity = parseMemoryYaml(source);

  assertExpectedTag(entity, kind, filePath);
  const parsed = parseMemoryEntity(kind, entity);

  return {
    kind,
    path: filePath,
    entity: parsed
  };
}

export async function readMemoryFileSummary(kind: MemoryKind, filePath: string): Promise<MemoryFileSummary> {
  const handle = await open(filePath, "r");
  let source = "";
  let position = 0;
  const buffer = Buffer.allocUnsafe(4096);
  const decoder = new StringDecoder("utf8");
  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead > 0) {
        source += decoder.write(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
      if (bytesRead === 0) source += decoder.end();
      const names = memoryNamesFromPrefix(kind, source, bytesRead === 0);
      if (names) return { kind, path: filePath, names };
      if (bytesRead === 0) {
        const entity = parseMemoryYaml(source);
        assertExpectedTag(entity, kind, filePath);
        return { kind, path: filePath, names: parseMemoryEntity(kind, entity).names };
      }
    }
  } finally {
    await handle.close();
  }
}

function memoryNamesFromPrefix(kind: MemoryKind, source: string, eof: boolean): string[] | undefined {
  const lines = source.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^(?:names|name):(?:\s|$)/.test(line));
  if (headerIndex < 0) return undefined;
  const inline = lines[headerIndex]!;
  const key = inline.startsWith("names:") ? "names" : "name";
  let end = headerIndex + 1;
  if (inline.slice(inline.indexOf(":") + 1).trim()) {
    try {
      const parsed = parse(inline) as Record<string, unknown>;
      return validateSummaryHeader(kind, source, eof, normalizeSummaryNames(parsed[key]));
    } catch (error) {
      while (end < lines.length && (lines[end] === "" || /^\s/.test(lines[end]!) || /^\s*#/.test(lines[end]!))) end += 1;
      if (end === lines.length && !eof) return undefined;
      try {
        const parsed = parse(lines.slice(headerIndex, end).join("\n")) as Record<string, unknown>;
        return validateSummaryHeader(kind, source, eof, normalizeSummaryNames(parsed[key]));
      } catch {
        throw error;
      }
    }
  }
  while (end < lines.length && (lines[end] === "" || /^\s/.test(lines[end]!) || /^\s*#/.test(lines[end]!))) end += 1;
  if (end === lines.length && !eof) return undefined;
  const parsed = parse(lines.slice(headerIndex, end).join("\n")) as Record<string, unknown>;
  return validateSummaryHeader(kind, source, eof, normalizeSummaryNames(parsed[key]));
}

function validateSummaryHeader(kind: MemoryKind, source: string, eof: boolean, names: string[]): string[] | undefined {
  const tag = rootTagFromPrefix(source, eof);
  if (!tag) return undefined;
  const expectedTag = memoryKindTags[kind];
  if (tag !== expectedTag) throw new Error(`Expected ${expectedTag} Memory tag, received ${tag}`);

  const canonicalIssue = canonicalMemoryNameIssue(names[0]!);
  if (canonicalIssue) throw new Error(canonicalIssue);
  const seen = new Set<string>();
  for (const [index, name] of names.entries()) {
    if (seen.has(name)) throw new Error(`Memory names must be unique; duplicate at names[${index}]`);
    seen.add(name);
    if (index === 0) continue;
    const aliasIssue = memoryAliasIssue(name);
    if (aliasIssue) throw new Error(aliasIssue);
  }
  return names;
}

function rootTagFromPrefix(source: string, eof: boolean): string | undefined {
  const lines = source.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("%") || trimmed === "---") continue;
    if (index === lines.length - 1 && !eof && !source.endsWith("\n")) return undefined;
    const match = /^(?:---\s+)?(![A-Za-z][A-Za-z0-9_-]*)\s*(?:#.*)?$/.exec(trimmed);
    if (!match) throw new Error("Memory root must declare a supported tag");
    return match[1];
  }
  return eof ? "" : undefined;
}

function normalizeSummaryNames(value: unknown): string[] {
  const names = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  if (!names.length || !names.every((name) => typeof name === "string" && name.trim())) {
    throw new Error("Memory names must contain at least one non-empty string");
  }
  return names as string[];
}

export function parseMemoryEntity(kind: MemoryKind, entity: unknown): MemoryEntity {
  const syntax = readMemorySyntax(entity);
  return memorySyntaxRegistry.require(syntax).schemas[kind].parse(entity) as MemoryEntity;
}

export async function listMemoryFiles(memoryRoot: string, kind: MemoryKind): Promise<string[]> {
  const dir = join(memoryRoot, kind);
  let entries;

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const symbolicLink = entries.find((entry) => entry.isSymbolicLink());
  if (symbolicLink) {
    throw new Error(`symbolic links are not allowed in a Memory kind directory: ${join(dir, symbolicLink.name)}`);
  }

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
