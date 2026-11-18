import fs from "node:fs/promises";
import { join } from "node:path";
import { after, type TestContext } from "node:test";
import { openContextControl } from "../../src/project/context-control.js";
import { businessFixture } from "./business-data.js";

const cleanups: Array<() => unknown> = [];
const baselineController = new AbortController();
after(async () => {
  baselineController.abort();
  await Promise.allSettled([baseline]);
  for (const cleanup of cleanups) await cleanup();
});
let baseline: Promise<string> | undefined;
function installedBaseline() {
  return baseline ??= (async () => {
    const f = await businessFixture({ signal: baselineController.signal, after: cleanup => { cleanups.push(cleanup); } } as TestContext, {});
    await openContextControl(f.root, true);
    return f.root;
  })();
}

/** Graph tests exercise existing Stores; installation has its own integration tests.
 * Copy the real installed definitions, registrations and empty filesystem Stores.
 * Each test still opens/validates its own bindings and persists its own records.
 */
export function initializedContextFixture(t: TestContext, schemas: Record<string, unknown> = {}) {
  return businessFixture(t, schemas, async (f, acquire) => {
    const source = await acquire(installedBaseline);
    for (const entry of ["config.json", "models", "data"]) {
      await acquire(() => fs.cp(join(source, entry), join(f.root, entry), { recursive: true }));
    }
  });
}

/** Legacy model-backed Artifact tests need installed models, without bindings
 * to unrelated Context Control Stores that change Run source discovery. */
export function initializedModelFixture(t: TestContext, schemas: Record<string, unknown>) {
  return businessFixture(t, schemas, async (f, acquire) => {
    const source = await acquire(installedBaseline);
    await acquire(() => fs.cp(join(source, "models"), join(f.root, "models"), { recursive: true }));
  });
}
