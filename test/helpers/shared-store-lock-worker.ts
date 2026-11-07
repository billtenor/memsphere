import { withSharedStoreLock } from "../../src/project/shared-store-lock.js";
import { removeBusinessStore } from "../../src/project/business-stores.js";
import { readBusinessProject } from "../../src/project/business-stores.js";
import { projectPaths } from "../../src/project/paths.js";
import { invokeAppOperation } from "../../src/app/backend.js";
import { join } from "node:path";
import type { AppProject } from "../../src/app/state.js";
import { mutateModel } from "../../src/project/model-service.js";
import { withModelMaintenance } from "../../src/project/model-operation.js";

const [mode, root, argument] = process.argv.slice(2);
if (!root) throw new Error("missing Project root");
if (mode === "hold") {
  await withSharedStoreLock(root, async () => {
    process.send?.({ event: "locked" });
    await new Promise<void>(resolve => process.once("message", () => resolve()));
  });
  process.send?.({ event: "released" });
} else if (mode === "remove") {
  process.send?.({ event: "started" });
  try {
    await removeBusinessStore({ signal: AbortSignal.timeout(300) }, root, argument ?? "records");
    process.send?.({ event: "removed" });
  } catch (error) {
    process.send?.({ event: "failed", name: (error as Error).name });
  }
} else if (mode === "invoke") {
  const project = { name: "test-project", paths: projectPaths(root), memoryRoot: join(root, "memory"), config: await readBusinessProject(root) } as AppProject;
  try { await invokeAppOperation(project, "example.app", "hold", { token: argument }); process.send?.({ event: "finished" }); }
  catch (error) { process.send?.({ event: "failed", code: (error as { code?: string }).code }); }
} else if (mode === "model") {
  process.send?.({ event: "started" });
  try {
    await mutateModel({ signal: AbortSignal.timeout(300) }, root, "update", "record.json", { fields: { description: "updated" } });
    process.send?.({ event: "updated" });
  } catch (error) { process.send?.({ event: "failed", name: (error as Error).name }); }
} else if (mode === "recovery") {
  process.send?.({ event: "started" });
  try {
    await withModelMaintenance(root, async () => undefined, AbortSignal.timeout(300));
    process.send?.({ event: "recovered" });
  } catch (error) { process.send?.({ event: "failed", name: (error as Error).name }); }
}
process.disconnect?.();
