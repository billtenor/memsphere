import type { TestContext } from "node:test";
import { readContextControlModels, ENTITIES } from "../../src/context_control/model-assets.js";
import { ContextControl, type Stores, type ContentReader } from "../../src/context_control/service.js";
import { checkModelDefinition } from "../../src/project/model-validation.js";
import { MemoryValueStore } from "../support/memory-value-store.js";
import { ManualClock } from "../support/manual-clock.js";
import { FakeWorkers } from "../support/fake-workers.js";

// Share immutable model validators, never records, clocks or process observations.
const runtimes = Promise.all(readContextControlModels().map(async asset => ({
  entity: asset.entity,
  runtime: (await checkModelDefinition({}, { modelRef: asset.id, source: asset.source, definition: asset.definition })).runtime!
})));
export async function contextModuleFixture(_t?: TestContext, contentReader: ContentReader = async () => { throw new Error("No external content fixture"); }) {
  const clock = new ManualClock(), workers = new FakeWorkers();
  const stores = {} as Stores;
  for (const { entity, runtime } of await runtimes) stores[entity] = new MemoryValueStore(entity, runtime.descriptor.id, value => { runtime.reflect(value); }, clock.now);
  const runtime = { now: clock.iso, workers };
  const reopen = () => {
    const handles = {} as Stores;
    for (const entity of ENTITIES) handles[entity] = (stores[entity] as MemoryValueStore).fork();
    return new ContextControl(handles, contentReader, runtime);
  };
  return { stores, clock, workers, service: new ContextControl(stores, contentReader, runtime), reopen };
}
