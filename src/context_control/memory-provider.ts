import type { MemoryProvider } from "../memory/provider.js";
import { DefaultMemoryCatalog } from "../memory/catalog.js";
import { parseMemoryEntity } from "../memory/store.js";
import { parseMemoryYaml } from "../memory/yaml.js";
import type { MemoryKind } from "../memory/kinds.js";
import type { Run } from "./types.js";
import { failure } from "./errors.js";

/** A graph Run resolves every Memory from its own snapshot, including App provenance. */
export function graphMemoryCatalog(run: Run) {
  const entries = run.memorySnapshot?.memories;
  if (!entries) throw failure("INVALID_STATE", "Graph Memory snapshot is missing");
  const read = (id: string) => {
    const item = entries[id];
    if (!item || item.memoryRef !== id) throw failure("NOT_FOUND", `Frozen Memory not found: ${id}`);
    return parseMemoryEntity(id.split("/")[0] as MemoryKind, parseMemoryYaml(item.payload.content));
  };
  const provider: MemoryProvider = {
    async list(query = {}) {
      return Object.entries(entries).map(([id, item]) => {
        const kind = id.split("/")[0] as MemoryKind, entity = read(id);
        return { id, kind, names: entity.names, defines: entity.defines ?? [], revision: `run:${run.id}`, ...(item.app ? { app: item.app } : {}) };
      }).filter(item => !query.kind || item.kind === query.kind);
    },
    async read(id) { return read(id); }
  };
  return new DefaultMemoryCatalog(provider, { runId: run.id });
}
