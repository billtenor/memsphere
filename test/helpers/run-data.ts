import assert from "node:assert/strict";
import { runDataModels, runDataStoreIds, type RunDataKind } from "../../src/project/run-data.js";
import type { DataManager } from "../../src/data/api/data-manager.js";
import type { AppendableDataStore, StoredData } from "../../src/data/api/data-store.js";
import type { Data } from "../../src/data/api/data.js";
import { bytesContent, readAll } from "../../src/data/extensions/shared/payload.js";

export function opaqueRunData() {
  const records = new Map<string, { contentType: string; bytes: Uint8Array }>();
  const calls: string[] = [];
  let hook: ((operation: string, store: string, id: string) => Promise<void> | void) | undefined;
  const stores = new Map<string, AppendableDataStore>();
  const key = (store: string, id: string) => `${store}:${id}`;
  const manager: DataManager = {
    async getModel() { throw new Error("Model load is not needed for content storage"); },
    async getRuntime() { throw new Error("Runtime load is not needed for content storage"); },
    async getStore(_context, id) {
      if (stores.has(id)) return stores.get(id)!;
      const prefix = id.slice(0, id.lastIndexOf("/"));
      const kind = (Object.keys(runDataStoreIds) as RunDataKind[]).find(kind => runDataStoreIds[kind] === prefix);
      assert(kind, `Unknown Run Store fixture: ${id}`);
      const model = runDataModels[kind];
      const save = async (data: Data, append: boolean) => {
        assert.equal(data.model, model);
        const bytes = await readAll({}, data.payload.content);
        const before = records.get(key(id, data.id));
        records.set(key(id, data.id), { contentType: data.payload.contentType, bytes: append ? Uint8Array.from([...before!.bytes, ...bytes]) : bytes });
      };
      const store: AppendableDataStore = {
        kind: "DataStore", id, model,
        async get(_context, dataId): Promise<StoredData | undefined> {
          calls.push(`get:${id}:${dataId}`);
          await hook?.("get", id, dataId);
          const value = records.get(key(id, dataId));
          return value && { data: { id: dataId, model, payload: { contentType: value.contentType, content: bytesContent(value.bytes) } } };
        },
        async has(_context, dataId) { await hook?.("has", id, dataId); return records.has(key(id, dataId)); },
        async create(_context, data) {
          calls.push(`create:${id}:${data.id}`);
          await hook?.("create", id, data.id);
          assert(!records.has(key(id, data.id)), "create cannot overwrite");
          await save(data, false);
        },
        async update(_context, data) {
          calls.push(`update:${id}:${data.id}`);
          await hook?.("update", id, data.id);
          assert(records.has(key(id, data.id)), "update requires existence");
          await save(data, false);
        },
        async append(_context, data) {
          calls.push(`append:${id}:${data.id}`);
          await hook?.("append", id, data.id);
          assert(records.has(key(id, data.id)), "append requires existence");
          await save(data, true);
        },
        async delete(_context, dataId) {
          calls.push(`delete:${id}:${dataId}`);
          await hook?.("delete", id, dataId);
          return records.delete(key(id, dataId));
        },
        async list() { assert.fail("Run business queries must not enumerate the Store"); }
      };
      stores.set(id, store);
      return store;
    }
  };
  return { manager, records, calls, key, setHook(value: typeof hook) { hook = value; } };
}
