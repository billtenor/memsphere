import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { MemoryEntity } from "../memory/ast.js";
import { collectMemoryReferenceTargets } from "../memory/references.js";
import {
  listMemoryFiles,
  readMemoryFileSummary,
  type MemoryFileSummary
} from "../memory/store.js";
import { memoryKinds } from "../memory/kinds.js";
import {
  readBundledMarketMemories,
  type BundledMarketMemoryDescriptor
} from "../reserved/store.js";

export type MarketMemoryStatus = "not_imported" | "consistent" | "different" | "name_conflict";

export type MarketMemoryItem = {
  reference: string;
  kind: BundledMarketMemoryDescriptor["kind"];
  names: string[];
  entity: MemoryEntity;
  status: MarketMemoryStatus;
  conflict?: string;
};

export type MarketImportTarget = {
  reference: string;
  path: string;
  source: Buffer;
};

export async function listMemoryMarket(memoryRoot: string): Promise<MarketMemoryItem[]> {
  const [market, projectFiles] = await Promise.all([
    readBundledMarketMemories(),
    readProjectMemoryIdentities(memoryRoot)
  ]);
  return Promise.all(market.map((item) => marketItem(item, projectFiles)));
}

export async function countMemoryMarket(): Promise<number> {
  return (await readBundledMarketMemories()).length;
}

export async function planMemoryMarketImport(
  memoryRoot: string,
  reference: string
): Promise<{ item: MarketMemoryItem; targets: MarketImportTarget[] }> {
  const [market, projectFiles] = await Promise.all([
    readBundledMarketMemories(),
    readProjectMemoryIdentities(memoryRoot)
  ]);
  const byReference = new Map(market.map((item) => [item.reference, item]));
  const selected = byReference.get(reference);
  if (!selected) throw new Error(`market Memory was not found: ${reference}`);
  const item = await marketItem(selected, projectFiles);
  if (item.status === "consistent") throw new Error(`market Memory is already consistent: ${reference}`);
  if (item.status === "name_conflict") throw new MarketMemoryNameConflictError(item.conflict ?? `Memory name conflict: ${reference}`);

  const projectReferences = new Set(projectFiles.map(logicalReference));
  const planned = new Map<string, BundledMarketMemoryDescriptor>([[selected.reference, selected]]);
  const visit = (current: BundledMarketMemoryDescriptor): void => {
    for (const target of collectMemoryReferenceTargets(current.entity)) {
      if (projectReferences.has(target) || planned.has(target)) continue;
      const dependency = byReference.get(target);
      if (!dependency) throw new Error(`market Memory dependency was not found in Project or market: ${target}`);
      planned.set(target, dependency);
      visit(dependency);
    }
  };
  visit(selected);
  for (const candidate of planned.values()) {
    const state = await marketItem(candidate, projectFiles);
    if (state.status === "name_conflict") {
      throw new MarketMemoryNameConflictError(state.conflict ?? `Memory name conflict: ${candidate.reference}`);
    }
  }
  return {
    item,
    targets: [...planned.values()]
      .sort((left, right) => left.reference.localeCompare(right.reference))
      .map((target) => ({ reference: target.reference, path: target.path, source: target.source }))
  };
}

export class MarketMemoryNameConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketMemoryNameConflictError";
  }
}

async function marketItem(
  market: BundledMarketMemoryDescriptor,
  projectFiles: readonly MemoryFileSummary[]
): Promise<MarketMemoryItem> {
  const canonical = projectFiles.find((file) => logicalReference(file) === market.reference);
  const collision = projectFiles.find((file) => file !== canonical
    && file.kind === market.kind
    && market.names.some((name) => file.names.includes(name)));
  if (collision) {
    return {
      reference: market.reference,
      kind: market.kind,
      names: [...market.names],
      entity: market.entity,
      status: "name_conflict",
      conflict: `${market.reference} conflicts with ${logicalReference(collision)}`
    };
  }
  let status: MarketMemoryStatus = "not_imported";
  if (canonical) {
    const source = await readFile(canonical.path);
    const digest = createHash("sha256").update(source).digest("hex");
    status = digest === market.digest ? "consistent" : "different";
  }
  return {
    reference: market.reference,
    kind: market.kind,
    names: [...market.names],
    entity: market.entity,
    status
  };
}

async function readProjectMemoryIdentities(memoryRoot: string): Promise<MemoryFileSummary[]> {
  const files: MemoryFileSummary[] = [];
  for (const kind of memoryKinds) {
    for (const path of await listMemoryFiles(memoryRoot, kind)) {
      const summary = await readMemoryFileSummary(kind, path).catch(() => undefined);
      if (summary) files.push(summary);
    }
  }
  return files;
}

function logicalReference(file: MemoryFileSummary): string {
  return `${file.kind}/${file.names[0]}`;
}
