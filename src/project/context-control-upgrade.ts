import { automaticOutputs, outputOverrides } from "../context_control/outputs.js";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readBusinessProject, openBusinessStore } from "./business-stores.js";
import { createProjectModelHost } from "./models.js";
import { validateModelStoragePaths } from "./model-storage-paths.js";
import { commitModelOperation, optionalFileBytes, type ModelOperationHooks } from "./model-operation.js";
import { underContextControlAccess } from "./context-control-access.js";
import { openContextControl } from "./context-control.js";
import { definitionHash, readContextControlModels, storeId } from "../context_control/model-assets.js";
import { checkModelDefinition } from "./model-validation.js";
import { failure } from "../context_control/service.js";
import type { Artifact, Step } from "../context_control/types.js";

export const CONTEXT_OUTPUTS_UPGRADE = "context-control.outputs-upgrade";
const previous = {
  run: ["7d0612cb7ece147e5475fba998cabd5fb35f6f58a315db4c8ac4014e247990a3", "e8766633d676456f375c3bca66ab43d7ce02917d0d49ff3aafa193b9e201bc02"],
  artifact: ["fd4b6bcad2dc712fe0e99d0c8a92fc2bd98acabf3e7ea62c2c8f90e9cbadc9b5", "f029c436c88238c2f3df3faf804a65c2725e1d99758eb8fbd93384c37ec74c9c"]
};
/** Caller owns the Project settings lock. This is one known release conversion, not generic schema migration. */
export function upgradeContextControlOutputs(root: string, hooks: ModelOperationHooks = {}) {
  return underContextControlAccess(root, async () => {
    const config = await readBusinessProject(root);
    if (!config.dataStores?.[storeId("run")]) return undefined;
    const assets = readContextControlModels();
    const host = await createProjectModelHost({}, { root, ...config });
    const changes: Array<{ path: string; before: Buffer | undefined; after: Buffer }> = [];
    const paths = await validateModelStoragePaths({ root, ...config });
    let oldRun = false;
    for (const asset of assets) {
      const installed = await host.definition(asset.id);
      if (isDeepStrictEqual(installed.definition, asset.definition)) continue;
      if (!(asset.entity in previous) || !previous[asset.entity as keyof typeof previous].includes(definitionHash(installed.definition))) throw failure("MODEL_INCOMPATIBLE", `Unsupported customized context model: ${asset.id}`);
      if (asset.entity === "run") oldRun = true;
      const path = join(paths.modelsDirectory, asset.id);
      changes.push({ path, before: await optionalFileBytes(path), after: Buffer.from(asset.source) });
    }
    if (!changes.length) return { changed: false, records: 0 };
    let count = 0;
    if (oldRun) {
      // Redo only completes pending Steps, without mutating old or new Run records.
      const service = await openContextControl(root, false, true);
      if (!service) throw failure("INITIALIZATION_INCOMPLETE", "Context control Stores missing");
      // Preserve the old report transition if it stopped before its Run-root write.
      // Capture pending identities before redo completes their Steps; do not write old Runs.
      const pending = new Map<string, Artifact[]>(); let cursor: string | undefined;
      do {
        const page = await service.stores.artifact.list({}, { limit: 1000, cursor });
        for (const item of page.items) {
          const artifact = (await service.stores.artifact.get({}, item.id))?.value as Artifact | undefined;
          if (artifact?.status !== "submitted") continue;
          const runId = item.id.split("/")[0];
          const step = (await service.stores.step.get({}, `${runId}/${artifact.stepId}`))?.value as Step | undefined;
          if (step?.status !== "done") pending.set(runId, [...(pending.get(runId) ?? []), artifact]);
        }
        cursor = page.nextCursor;
      } while (cursor);
      const runs = await service.listRuns();
      const opened = await openBusinessStore({}, root, storeId("run"));
      if (opened.store.kind !== "ValueStore" || opened.binding.factory !== "memsphere/filesystem-json") throw failure("UNSUPPORTED_CAPABILITY", "This upgrade requires filesystem-json");
      const asset = assets.find(a => a.entity === "run")!;
      const { runtime } = await checkModelDefinition({}, { modelRef: asset.id, definition: asset.definition, source: asset.source });
      for (const run of runs) {
        const row = await opened.store.get({}, run.id);
        if (!row) throw failure("NOT_FOUND", `Run disappeared: ${run.id}`);
        const old = row.value as Record<string, unknown>;
        const snapshot = await service.snapshot(run.id);
        const automatic = automaticOutputs(snapshot.artifacts, snapshot.completeIds);
        // Preserve all previously visible roots, including deliberately empty or terminal selections.
        let selected = Object.hasOwn(old, "outputArtifactIds") ? old.outputArtifactIds
          : run.status === "running" ? automatic : old.finalArtifactIds;
        if (!Array.isArray(selected) || selected.some(id => typeof id !== "string" || !snapshot.completeIds.includes(id))) throw failure("INVALID_STATE", `Invalid old output roots: ${run.id}`);
        if (Object.hasOwn(old, "outputArtifactIds") && run.status === "running") {
          const resumed = pending.get(run.id) ?? [];
          const replaced = new Set(resumed.flatMap(a => [a.revisedFrom, ...a.dependencies.filter(r => r.kind === "artifact").map(r => r.id)]));
          selected = [...new Set([...(selected as string[]).filter(id => !replaced.has(id)), ...automatic.filter(id => resumed.some(a => a.id === id))])];
        }
        const overrides = outputOverrides(automatic, selected as string[]);
        const value: Record<string, unknown> = { ...old };
        delete value.outputArtifactIds; delete value.finalArtifactIds;
        if (overrides.addedArtifactIds.length || overrides.removedArtifactIds.length) value.outputOverrides = overrides;
        runtime!.reflect(value);
        if (!row.revision || row.revision === Number.MAX_SAFE_INTEGER) throw failure("REVISION_OVERFLOW", `Invalid Run revision: ${run.id}`);
        const path = join(opened.directory, `${run.id}.json`);
        const before = await optionalFileBytes(path);
        changes.push({ path, before, after: Buffer.from(JSON.stringify({ ...row, value, revision: row.revision + 1, updatedAt: Date.now() }, null, 2) + "\n") });
        count++;
      }
    }
    await commitModelOperation(root, CONTEXT_OUTPUTS_UPGRADE, changes, hooks);
    return { changed: true, records: count };
  });
}
