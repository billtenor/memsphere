import assert from "node:assert/strict";
import { createDataService } from "../../src/project/data-service.js";
import { checkModelDefinition } from "../../src/project/model-validation.js";
import { MemoryValueStore } from "../support/memory-value-store.js";
import { MemoryDataStore } from "../support/memory-data-store.js";

/** Real service, model Runtime and serializer; Store and export IO stay in memory. */
export async function businessDataModule(definition: unknown, kind: "value" | "data" = "value") {
  const root = "module-project", modelRef = "record.json";
  const { runtime } = await checkModelDefinition({}, { modelRef, definition });
  assert.ok(runtime);
  const stores = new Map(["records", "other"].map(id => [id, kind === "value"
    ? new MemoryValueStore(id, modelRef, value => { runtime.reflect(value); })
    : new MemoryDataStore(id, modelRef)]));
  const exported = new Map<string, Uint8Array>();
  let stamp = "original";
  const service = createDataService({
    async openStore(_context, project, id) {
      assert.equal(project, root);
      const store = stores.get(id);
      if (!store) throw Object.assign(new Error(`Missing Store ${id}`), { code: "STORE_NOT_FOUND" });
      return { store: store.fork(), runtime, directory: `memory/${id}`, stamp: "original",
        binding: { kind, model: modelRef, factory: kind === "value" ? "memsphere/filesystem-json" : "memsphere/filesystem", config: { directory: `memory/${id}` } } };
    },
    async assertStamp(project, expected) {
      assert.equal(project, root);
      if (stamp !== expected) throw Object.assign(new Error("Models changed"), { code: "MODEL_READ_CONFLICT" });
    },
    async modelRuntime(_context, project, ref) {
      assert.equal(project, root); assert.equal(ref, modelRef); return runtime;
    },
    async exportBytes(bytes, out) {
      if (exported.has(out)) throw Object.assign(new Error("Export exists"), { code: "EEXIST" });
      exported.set(out, Uint8Array.from(bytes)); return out === "-" ? undefined : out;
    }
  });
  return { root, modelRef, service, exported, changeModel: () => { stamp = "changed"; } };
}
