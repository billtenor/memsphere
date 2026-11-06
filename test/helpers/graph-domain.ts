import { join } from "node:path";
import type { ValueStore, StoredValue } from "../../src/data/api/value-store.js";
import type { ModelRuntime } from "../../src/data/api/model-runtime.js";
import type { TestContext } from "node:test";
import { Config } from "../../src/data/api/config.js";
import { FilesystemJsonValueStoreFactory } from "../../src/data/extensions/filesystem-json-valuestore/index.js";
import { readContextControlModels, type Entity } from "../../src/context_control/model-assets.js";
import { ContextControl, failure, type Stores } from "../../src/context_control/service.js";
import { checkModelDefinition } from "../../src/project/model-validation.js";
import { businessFixture } from "./business-data.js";

// Domain tests share immutable validators only; each scenario owns its records.
// Persistence representatives opt into the real filesystem implementation.
const runtimes = Promise.all(readContextControlModels().map(async asset => ({
  entity: asset.entity,
  runtime: (await checkModelDefinition({}, { modelRef: asset.id, source: asset.source, definition: asset.definition })).runtime!
})));

function memoryStore(entity: string, runtime: ModelRuntime): ValueStore {
  const rows = new Map<string, StoredValue>();
  const revisions = new Map<string, number>();
  return {
    id: entity, model: runtime.descriptor.id, kind: "ValueStore",
    async get(context, id) { context.signal?.throwIfAborted(); const row = rows.get(id); return row && structuredClone(row); },
    async has(context, id) { context.signal?.throwIfAborted(); return rows.has(id); },
    async list(context, options) {
      context.signal?.throwIfAborted();
      const ids = [...rows.keys()].sort().filter(id => !options?.cursor || id > options.cursor);
      const size = options?.limit ?? 1000;
      return { items: ids.slice(0, size).map(id => ({ id })), ...(ids.length > size ? { nextCursor: ids[size - 1] } : {}) };
    },
    async create(context, id, value) {
      context.signal?.throwIfAborted(); runtime.reflect(value);
      if (rows.has(id)) throw failure("ALREADY_EXISTS", id);
      const revision = (revisions.get(id) ?? 0) + 1;
      const row = { id, value: structuredClone(value), revision };
      rows.set(id, row); revisions.set(id, revision); return structuredClone(row);
    },
    async update(context, id, value, options) {
      context.signal?.throwIfAborted(); runtime.reflect(value);
      const before = rows.get(id);
      if (options?.expectedRevision !== undefined && before?.revision !== options.expectedRevision) throw failure("REVISION_CONFLICT", id);
      if (!before) throw failure("NOT_FOUND", id);
      const revision = before.revision! + 1;
      const row = { id, value: structuredClone(value), revision };
      rows.set(id, row); revisions.set(id, revision); return structuredClone(row);
    },
    async delete(context, id, options) {
      context.signal?.throwIfAborted();
      if (options?.expectedRevision !== undefined && rows.get(id)?.revision !== options.expectedRevision) throw failure("REVISION_CONFLICT", id);
      return rows.delete(id);
    }
  };
}

export async function graphDomainFixture(t: TestContext, filesystem = false) {
  const directory = filesystem ? (await businessFixture(t, {})).root : undefined;
  const factory = new FilesystemJsonValueStoreFactory();
  const entries = await Promise.all((await runtimes).map(async ({ entity, runtime }) => [entity,
    directory
      ? await factory.createStore({}, entity, runtime, new Config({ directory: join(directory, "data", "context_control", `${entity}s`) }))
      : memoryStore(entity, runtime)
  ] as const));
  const stores = Object.fromEntries(entries) as Record<Entity, Stores[Entity]>;
  const service = new ContextControl(stores, async () => { throw new Error("No external content references in graph domain fixture"); });
  return { service };
}
