import type { DefinitionPart, MemoryEntity } from "./ast.js";
import type { MemoryKind } from "./kinds.js";
import {
  canonicalMemoryReference,
  normalizeMemoryName,
  parseLogicalMemoryReference
} from "./logical-reference.js";
import type { MemoryProvider, ProviderMemoryDescriptor } from "./provider.js";

export type MemoryDescriptor = {
  reference: string;
  kind: MemoryKind;
  names: string[];
  defines: string[];
  structured_defines?: {
    statement?: number;
    schema?: number;
  };
  project_name?: string;
  revision?: string;
  frozen?: string;
};

export type MemoryListQuery = {
  kind?: MemoryKind;
  query?: string;
};

export type MemoryListPage = {
  memories: MemoryDescriptor[];
  next_cursor: null;
};

export type MemoryResolveQuery = {
  kind?: MemoryKind;
};

export interface MemoryCatalog {
  list(query?: MemoryListQuery): Promise<MemoryListPage>;
  resolve(referenceOrName: string, query?: MemoryResolveQuery): Promise<MemoryDescriptor>;
  read(referenceOrName: string, query?: MemoryResolveQuery): Promise<MemoryEntity>;
}

export type MemoryCatalogIssue = {
  kind: MemoryKind;
  name?: string;
  references: string[];
  message: string;
};

type IndexedMemory = {
  providerId: string;
  descriptor: MemoryDescriptor;
};

type CatalogIndex = {
  entries: IndexedMemory[];
  issues: MemoryCatalogIssue[];
};

export class MemoryNotFoundError extends Error {
  constructor(readonly input: string, readonly kind?: MemoryKind) {
    super(`memory "${input}" was not found${kind ? ` in ${kind}` : ""}. Run memsphere memory list to discover available memories.`);
    this.name = "MemoryNotFoundError";
  }
}

export class MemoryAmbiguityError extends Error {
  constructor(readonly input: string, readonly candidates: string[]) {
    const projects = new Set(candidates.flatMap((candidate) => {
      const separator = candidate.indexOf(":");
      return separator > 0 ? [candidate.slice(0, separator)] : [];
    }));
    const guidance = projects.size > 1
      ? "Select one Project with --project <name>."
      : "Read a logical reference or narrow the search with --kind.";
    super(`memory "${input}" is ambiguous. Candidates: ${candidates.join(", ")}. ${guidance}`);
    this.name = "MemoryAmbiguityError";
  }
}

export class MemoryCatalogDataError extends Error {
  constructor(message: string) {
    super(`${message}. Run memsphere validate.`);
    this.name = "MemoryCatalogDataError";
  }
}

export class MemoryReferenceKindError extends Error {
  constructor(referenceKind: MemoryKind, requestedKind: MemoryKind) {
    super(`memory reference kind "${referenceKind}" conflicts with --kind "${requestedKind}"`);
    this.name = "MemoryReferenceKindError";
  }
}

export class DefaultMemoryCatalog implements MemoryCatalog {
  readonly #provider: MemoryProvider;

  constructor(provider: MemoryProvider) {
    this.#provider = provider;
  }

  async list(query: MemoryListQuery = {}): Promise<MemoryListPage> {
    const index = await this.#loadIndex(query.kind);
    const normalizedQuery = query.query === undefined ? undefined : normalizeMemoryName(query.query);
    const memories = index.entries
      .filter((entry) => normalizedQuery === undefined || entry.descriptor.names.includes(normalizedQuery))
      .map((entry) => entry.descriptor)
      .sort(compareDescriptors);

    return { memories, next_cursor: null };
  }

  async resolve(referenceOrName: string, query: MemoryResolveQuery = {}): Promise<MemoryDescriptor> {
    const index = await this.#loadIndex(query.kind);
    return resolveEntry(index.entries, referenceOrName, query).descriptor;
  }

  async read(referenceOrName: string, query: MemoryResolveQuery = {}): Promise<MemoryEntity> {
    const index = await this.#loadIndex(query.kind);
    const entry = resolveEntry(index.entries, referenceOrName, query);
    if (entry.descriptor.frozen) throw new MemoryFrozenError(entry.descriptor.reference, entry.descriptor.frozen);
    try {
      return await this.#provider.read(entry.providerId);
    } catch {
      throw new MemoryCatalogDataError("memory body could not be read from the configured provider");
    }
  }

  async #loadIndex(kind?: MemoryKind): Promise<CatalogIndex> {
    let descriptors: ProviderMemoryDescriptor[];
    try {
      descriptors = await this.#provider.list({ kind });
    } catch {
      throw new MemoryCatalogDataError("standard memory store could not be loaded");
    }
    const index = buildCatalogIndex(descriptors);
    const fatalIssue = index.issues.find((issue) => issue.message.startsWith("invalid "));
    if (fatalIssue) throw new MemoryCatalogDataError(fatalIssue.message);
    return index;
  }
}

export class MemoryFrozenError extends Error {
  constructor(readonly reference: string, readonly reason: string) {
    super(`memory "${reference}" is frozen: ${reason}`);
    this.name = "MemoryFrozenError";
  }
}

export function analyzeMemoryDescriptors(descriptors: ProviderMemoryDescriptor[]): MemoryCatalogIssue[] {
  return buildCatalogIndex(descriptors).issues;
}

function buildCatalogIndex(descriptors: ProviderMemoryDescriptor[]): CatalogIndex {
  const entries: IndexedMemory[] = [];
  const issues: MemoryCatalogIssue[] = [];
  const providerIds = new Set<string>();

  for (const source of descriptors) {
    if (providerIds.has(source.id)) {
      issues.push({
        kind: source.kind,
        references: [],
        message: "invalid memory provider data: duplicate provider id"
      });
      continue;
    }
    providerIds.add(source.id);

    const names = source.names.map(normalizeMemoryName);
    const canonicalName = names[0];
    if (!canonicalName) {
      issues.push({
        kind: source.kind,
        references: [],
        message: "invalid memory name: canonical name is empty after trimming"
      });
      continue;
    }

    const reference = canonicalMemoryReference(source.kind, canonicalName)!;
    const emptyAlias = names.findIndex((name, index) => index > 0 && name.length === 0);
    if (emptyAlias !== -1) {
      issues.push({
        kind: source.kind,
        references: [reference],
        message: `invalid memory name: alias at names[${emptyAlias}] is empty after trimming`
      });
    }

    const duplicates = duplicateValues(names.filter(Boolean));
    for (const name of duplicates) {
      issues.push({
        kind: source.kind,
        name,
        references: [reference],
        message: `memory ${reference} repeats the normalized name "${name}"`
      });
    }

    const definitionSummary = summarizeDefinitions(source.defines);
    entries.push({
      providerId: source.id,
      descriptor: {
        reference,
        kind: source.kind,
        names,
        ...definitionSummary,
        ...(source.project_name ? { project_name: source.project_name } : {}),
        ...(source.revision ? { revision: source.revision } : {}),
        ...(source.frozen ? { frozen: source.frozen } : {})
      }
    });
  }

  const namesByKind = new Map<string, IndexedMemory[]>();
  for (const entry of entries) {
    for (const name of new Set(entry.descriptor.names.filter(Boolean))) {
      const key = `${entry.descriptor.kind}\0${name}`;
      const matches = namesByKind.get(key) ?? [];
      matches.push(entry);
      namesByKind.set(key, matches);
    }
  }

  for (const [key, matches] of namesByKind) {
    if (matches.length < 2) continue;
    const separator = key.indexOf("\0");
    const kind = key.slice(0, separator) as MemoryKind;
    const name = key.slice(separator + 1);
    const references = matches.map((entry) => entry.descriptor.reference).sort(compareStrings);
    issues.push({
      kind,
      name,
      references,
      message: `memory name "${name}" conflicts within ${kind}: ${references.join(", ")}`
    });
  }

  entries.sort((a, b) => compareDescriptors(a.descriptor, b.descriptor));
  issues.sort((a, b) => compareStrings(`${a.kind}/${a.name ?? ""}/${a.message}`, `${b.kind}/${b.name ?? ""}/${b.message}`));
  return { entries, issues };
}

function summarizeDefinitions(defines: DefinitionPart[]): Pick<MemoryDescriptor, "defines" | "structured_defines"> {
  const text = defines.filter((part): part is string => typeof part === "string");
  let statement = 0;
  let schema = 0;

  for (const part of defines) {
    if (typeof part === "string") continue;
    if (part.tag === "!statement") statement += 1;
    if (part.tag === "!schema") schema += 1;
  }

  const structured_defines = {
    ...(statement > 0 ? { statement } : {}),
    ...(schema > 0 ? { schema } : {})
  };

  return {
    defines: [...text],
    ...(statement > 0 || schema > 0 ? { structured_defines } : {})
  };
}

function resolveEntry(
  entries: IndexedMemory[],
  referenceOrName: string,
  query: MemoryResolveQuery
): IndexedMemory {
  const input = normalizeMemoryName(referenceOrName);
  const explicit = parseLogicalMemoryReference(input);
  if (explicit && query.kind && explicit.kind !== query.kind) {
    throw new MemoryReferenceKindError(explicit.kind, query.kind);
  }

  const matches = entries.filter((entry) => {
    if (query.kind && entry.descriptor.kind !== query.kind) return false;
    if (explicit) {
      return entry.descriptor.kind === explicit.kind && entry.descriptor.names.includes(explicit.name);
    }
    return entry.descriptor.names.includes(input);
  });

  if (matches.length === 0) throw new MemoryNotFoundError(input, query.kind);
  if (matches.length > 1) {
    throw new MemoryAmbiguityError(
      input,
      matches.map((entry) => `${entry.descriptor.project_name ? `${entry.descriptor.project_name}:` : ""}${entry.descriptor.reference}`).sort(compareStrings)
    );
  }
  return matches[0];
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort(compareStrings);
}

function compareDescriptors(a: MemoryDescriptor, b: MemoryDescriptor): number {
  return compareStrings(`${a.reference}\0${a.project_name ?? ""}`, `${b.reference}\0${b.project_name ?? ""}`);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
