import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { ValueStore } from "../data/api/value-store.js";
import { failure } from "../context_control/service.js";
import { ENTITIES, modelId, readContextControlModels, storeId } from "../context_control/model-assets.js";
import type { Run } from "../context_control/types.js";
import { openBusinessStore, readBusinessProject } from "./business-stores.js";
import { withContextControlAccess } from "./context-control-access.js";
import { readModelOperationStamp } from "./model-operation.js";
import { createProjectModelHost } from "./models.js";

/** A View-owned reader: cache validated resources, never records or recovery work. */
export function createContextRunReader(projectRoot: string): () => Promise<Run[]> {
  const root = resolve(projectRoot);
  let fingerprint: string | undefined;
  let store: ValueStore | undefined;
  return () => withContextControlAccess(root, async () => {
    const project = await readBusinessProject(root);
    const current = JSON.stringify([await readModelOperationStamp(root), project]);
    if (current !== fingerprint) {
      // A failed replacement must never leave an old binding usable.
      store = undefined;
      fingerprint = undefined;
      const bindings = ENTITIES.map(entity => project.dataStores?.[storeId(entity)]);
      if (bindings.some(Boolean)) {
        if (bindings.some(binding => !binding)) throw failure("INITIALIZATION_INCOMPLETE", "Context control Store bindings are incomplete; start a free exploration to initialize");
        const host = await createProjectModelHost({}, { root, ...project });
        const asset = readContextControlModels().find(asset => asset.entity === "run")!;
        if (!isDeepStrictEqual((await host.definition(asset.id)).definition, asset.definition)) {
          throw failure("MODEL_INCOMPATIBLE", `Context control models need an explicit upgrade: memsphere project models initialize (${asset.id})`);
        }
        const opened = await openBusinessStore({}, root, storeId("run"));
        if (opened.store.kind !== "ValueStore" || opened.binding.model !== modelId("run")) {
          throw failure("STORE_INCOMPATIBLE", `Wrong context control Store: ${storeId("run")}`);
        }
        store = opened.store;
      }
      fingerprint = current;
    }
    if (!store) return [];
    const runs: Run[] = [];
    let cursor: string | undefined;
    do {
      const page = await store.list({}, { limit: 1000, cursor });
      for (const item of page.items) {
        const row = await store.get({}, item.id);
        if (!row) continue;
        const run = row.value as Run;
        if (run.id !== item.id) throw failure("INVALID_STATE", `Stored identity mismatch: ${item.id}`);
        if (run.status === "running" && run.archived) throw failure("INVALID_STATE", "Running Run cannot be archived");
        runs.push(run);
      }
      cursor = page.nextCursor;
    } while (cursor);
    return runs;
  });
}
