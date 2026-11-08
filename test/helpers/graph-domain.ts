import { join } from "node:path";


import type { TestContext } from "node:test";
import { Config } from "../../src/data/api/config.js";
import { FilesystemJsonValueStoreFactory } from "../../src/data/extensions/filesystem-json-valuestore/index.js";
import { readContextControlModels, type Entity } from "../../src/context_control/model-assets.js";
import { ContextControl, type Stores } from "../../src/context_control/service.js";
import { checkModelDefinition } from "../../src/project/model-validation.js";
import { MemoryValueStore } from "../support/memory-value-store.js";
import { businessFixture } from "./business-data.js";

// Domain tests share immutable validators only; each scenario owns its records.
// Persistence representatives opt into the real filesystem implementation.
const runtimes = Promise.all(readContextControlModels().map(async asset => ({
  entity: asset.entity,
  runtime: (await checkModelDefinition({}, { modelRef: asset.id, source: asset.source, definition: asset.definition })).runtime!
})));


export async function graphDomainFixture(t: TestContext, filesystem = false) {
  const directory = filesystem ? (await businessFixture(t, {})).root : undefined;
  const factory = new FilesystemJsonValueStoreFactory();
  const entries = await Promise.all((await runtimes).map(async ({ entity, runtime }) => [entity,
    directory
      ? await factory.createStore({}, entity, runtime, new Config({ directory: join(directory, "data", "context_control", `${entity}s`) }))
      : new MemoryValueStore(entity, runtime.descriptor.id, value => { runtime.reflect(value); })
  ] as const));
  const stores = Object.fromEntries(entries) as Record<Entity, Stores[Entity]>;
  const service = new ContextControl(stores, async () => { throw new Error("No external content references in graph domain fixture"); });
  return { service };
}
