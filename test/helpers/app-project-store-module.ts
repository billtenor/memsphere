import assert from "node:assert/strict";
import type { ProjectStoreBindingAdapters } from "../../src/app/project-stores.js";
import { MemoryValueStore } from "../support/memory-value-store.js";
import { MemoryDataStore } from "../support/memory-data-store.js";

/** App binding is real; external Project registry, Store and canonical paths are in memory. */
export function appStoreModuleFixture() {
  const root = "/module-project";
  type Binding = Awaited<ReturnType<ProjectStoreBindingAdapters["getBinding"]>>["binding"];
  const registry = new Map<string, Binding>();
  const stores = new Map<string, MemoryValueStore | MemoryDataStore>();
  let registration = 0;
  const target = (id: string) => {
    const binding = registry.get(id);
    if (!binding) throw Object.assign(new Error(`Missing Store ${id}`), {code:"STORE_NOT_FOUND"});
    return binding;
  };
  const adapters: ProjectStoreBindingAdapters = {
    async getBinding(project, id) { assert.equal(project,root); return {binding:target(id)}; },
    async openStore(_context, project, id) { assert.equal(project,root); target(id); return {store:stores.get(id)!.fork()}; },
    async realpath(path) { assert([root,`${root}/memory`].includes(path)); return path; }
  };
  return {root,adapters,
    createStore(id="records",model="record.json",kind:"value"|"data"="value") {
      registry.set(id,{model,kind,factory:kind==="value"?"memsphere/filesystem-json":"memsphere/filesystem",config:{directory:`data/${id}`},registrationId:`registration-${++registration}`});
      if (!stores.has(id)) stores.set(id,kind==="value"?new MemoryValueStore(id,model):new MemoryDataStore(id,model));
    },
    remove(id:string) { registry.delete(id); }
  };
}
