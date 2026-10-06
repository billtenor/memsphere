import type { RunState } from "../run/store.js";
import { requireRunContent } from "../project/run-data.js";
import type { MemoryEntity } from "./ast.js";
import { memoryKinds, type MemoryKind } from "./kinds.js";
import type { MemoryProvider, MemoryProviderQuery, ProviderMemoryDescriptor } from "./provider.js";
import { parseMemoryEntity } from "./store.js";
import { assertExpectedTag, parseMemoryYaml } from "./yaml.js";

/** The Run owns discovery; the Store owns content, not directory enumeration. */
export function runMemoryFiles(run: Pick<RunState, "id" | "memorySnapshot">): readonly string[] {
  if (!run.memorySnapshot) return [];
  if (!Array.isArray(run.memorySnapshot.files)) throw new Error(`Run ${run.id} needs a Memory file manifest; run scripts/backfill-run-memory-manifest.mjs --run-file <Run status JSON> --write first`);
  const prefix = `${run.id}/memory/`;
  const seen = new Set<string>();
  for (const id of run.memorySnapshot.files) {
    const tail = id.slice(prefix.length);
    if (!id.startsWith(prefix) || !tail || tail.includes("\\") || tail.split("/").some((part) => !part || part === "." || part === "..") || !memoryKinds.includes(tail.split("/")[0] as MemoryKind)) {
      throw new Error(`Invalid Run Memory file identity: ${id}`);
    }
    if (seen.has(id)) throw new Error(`Duplicate Run Memory file identity: ${id}`);
    seen.add(id);
  }
  return run.memorySnapshot.files;
}

export class RunMemoryProvider implements MemoryProvider {
  private readonly files: readonly string[];
  private readonly entities = new Map<string, MemoryEntity>();
  constructor(private readonly runsRoot: string, private readonly run: Pick<RunState, "id" | "memorySnapshot">) {
    this.files = [...runMemoryFiles(run)];
  }
  async list(query: MemoryProviderQuery = {}): Promise<ProviderMemoryDescriptor[]> {
    this.entities.clear();
    const descriptors: ProviderMemoryDescriptor[] = [];
    for (const id of this.files) {
      if (!/\.ya?ml$/i.test(id)) continue;
      const kind = id.split("/")[2] as MemoryKind;
      if (query.kind && kind !== query.kind) continue;
      const source = (await requireRunContent(this.runsRoot, "memory", id)).toString("utf8");
      const raw = parseMemoryYaml(source);
      assertExpectedTag(raw, kind, id);
      const entity = parseMemoryEntity(kind, raw);
      this.entities.set(id, entity);
      const owner = this.run.memorySnapshot?.appOwnership?.[id.slice(`${this.run.id}/memory/`.length)];
      descriptors.push({ id, kind, names: [...entity.names], defines: structuredClone(entity.defines), ...(owner ? { app: owner } : {}) });
    }
    return descriptors;
  }
  async read(id: string): Promise<MemoryEntity> {
    const entity = this.entities.get(id);
    if (!entity) throw new Error("memory provider id was not returned by the current list operation");
    return entity;
  }
}
