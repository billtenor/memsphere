import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { ValueStore } from "../data/api/value-store.js";
import { failure } from "../context_control/service.js";
import { ENTITIES, modelId, readContextControlModels, storeId } from "../context_control/model-assets.js";
import type { Run } from "../context_control/types.js";
import { openBusinessStore, readBusinessProject } from "./business-stores.js";
import { withContextControlViewRead } from "./context-control-access.js";
import { readModelOperationStamp } from "./model-operation.js";
import { createProjectModelHost } from "./models.js";

/** View summary index: validate changed records, retain only their lightweight summary. */
export function createContextRunReader(projectRoot: string, options: { isolateCorruptRecords?: boolean } = {}): () => Promise<Array<Run & { unavailable?: boolean; error?: string }>> {
  const root = resolve(projectRoot);
  let fingerprint: string | undefined;
  let store: ValueStore | undefined;
  let directory="";
  const records=new Map<string,{stamp:string;run:Run}>();
  const stamp=async(id:string)=>{const s=await lstat(join(directory,`${id}.json`),{bigint:true});return s.isFile()&&!s.isSymbolicLink()?`${s.dev}:${s.ino}:${s.mtimeNs}:${s.ctimeNs}:${s.size}`:"";};
  return () => withContextControlViewRead(root, async () => {
    const project = await readBusinessProject(root);
    const current = JSON.stringify([await readModelOperationStamp(root), project]);
    if (current !== fingerprint) {
      // A failed replacement must never leave an old binding usable.
      store = undefined;records.clear();directory="";
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
        store = opened.store;directory=opened.directory;
      }
      fingerprint = current;
    }
    if (!store) return [];
    const runs: Array<Run & { unavailable?: boolean; error?: string }> = [];
    let cursor: string | undefined;
    const seen=new Set<string>();
    do {
      const page = await store.list({}, { limit: 1000, cursor });
      for (const item of page.items) {
        seen.add(item.id);
        try {
          const before=await stamp(item.id);const cached=records.get(item.id);
          if(before&&cached?.stamp===before){runs.push(cached.run);continue;}
          const row = await store.get({}, item.id);
          if (!row) continue;
          const run = row.value as Run;
          if (run.id !== item.id) throw failure("INVALID_STATE", `Stored identity mismatch: ${item.id}`);
          if (run.status === "running" && run.archived) throw failure("INVALID_STATE", "Running Run cannot be archived");
          const summary:Run={id:run.id,name:run.name,status:run.status,language:run.language,createdAt:run.createdAt,endedAt:run.endedAt,archived:run.archived};
          if(before&&before===await stamp(item.id))records.set(item.id,{stamp:before,run:summary});
          runs.push(summary);
        } catch (error) {
          if((error as NodeJS.ErrnoException).code==="ENOENT"){records.delete(item.id);continue;}
          if (!options.isolateCorruptRecords) throw error;
          runs.push({ id: item.id, name: item.id, status: "running", createdAt: "", language: "zh-CN", unavailable: true, error: error instanceof Error ? error.message : String(error) });
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
    for(const id of records.keys())if(!seen.has(id))records.delete(id);
    return runs;
  });
}
