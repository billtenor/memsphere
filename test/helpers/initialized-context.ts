import { cp } from "node:fs/promises";
import { join } from "node:path";
import { after, type TestContext } from "node:test";
import { openContextControl } from "../../src/project/context-control.js";
import { businessFixture } from "./business-data.js";

const cleanups: Array<() => unknown> = [];
after(async () => { for (const cleanup of cleanups) await cleanup(); });
let baseline: Promise<string> | undefined;
function installedBaseline() {
  return baseline ??= (async () => {
    const f = await businessFixture({ after: cleanup => { cleanups.push(cleanup); } } as TestContext, {});
    await openContextControl(f.root, true);
    return f.root;
  })();
}

/** Graph tests exercise existing Stores; installation has its own integration tests.
 * Copy the real installed definitions, registrations and empty filesystem Stores.
 * Each test still opens/validates its own bindings and persists its own records.
 */
export async function initializedContextFixture(t: TestContext, schemas: Record<string, unknown> = {}) {
  const f = await businessFixture(t, schemas);
  const source = await installedBaseline();
  for (const entry of ["config.json", "models", "data"]) {
    await cp(join(source, entry), join(f.root, entry), { recursive: true });
  }
  return f;
}

/** Legacy model-backed Artifact tests need installed models, without bindings
 * to unrelated Context Control Stores that change Run source discovery. */
export async function initializedModelFixture(t: TestContext, schemas: Record<string, unknown>) {
  const f = await businessFixture(t, schemas);
  const source = await installedBaseline();
  await cp(join(source, "models"), join(f.root, "models"), { recursive: true });
  return f;
}
