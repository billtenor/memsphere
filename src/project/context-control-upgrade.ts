import { readModelRegistrations, modelDefinitionHash } from "./model-registration.js";
import { automaticOutputs, outputOverrides } from "../context_control/outputs.js";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readBusinessProject, openBusinessStore, getBusinessBinding } from "./business-stores.js";
import { createProjectModelHost } from "./models.js";
import { validateModelStoragePaths } from "./model-storage-paths.js";
import { commitModelOperation, optionalFileBytes, withModelMaintenance, type ModelOperationHooks } from "./model-operation.js";
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
// Known pre-graph release and the locally installed graph review candidates.
const beforeGraph = {
  run: ["8b4604ece26b05fc674f5de3ff24a8dc95a9650fbbedbbefcad81783128b676b", "594768274b52adbb4897cb50a84f9346b4784cdfdc58330e1eab51bfc40e5835", "d8e723a1995158102a7d66ead4e8d793d8f6c1f450b88880d0671fcce599d9ba"],
  step: ["a8bcdf5da03ef45a813c4d956c545067686e49cee99047426fb0a3c4fa63eecd", "9a39b10e98c9d5a3f2d48d4caf8dad5f18e0b1b04cebd45ab8014ffecf295a9a", "43f43c0a5470b3f07f43702a9ac7c6d83a23a7678230a8a2816b989e5ded1053", "7dc7c88dd1d0908628385179c460c523e9ee4ca184156238fd665242c077056c"]
};
/** Journal admission protects this known release conversion, not generic schema migration. */
export function upgradeContextControlOutputs(root: string, hooks: ModelOperationHooks = {}) {
  return withModelMaintenance(root, () => underContextControlAccess(root, async () => {
    const config = await readBusinessProject(root);
    if (!config.dataStores?.[storeId("run")]) return undefined;
    const assets = readContextControlModels();
    const host = await createProjectModelHost({}, { root, ...config });
    const changes: Array<{ path: string; before: Buffer | undefined; after: Buffer }> = [];
    const paths = await validateModelStoragePaths({ root, ...config });
    let oldRun = false, oldArchive = false;
    const additive = [] as typeof assets;
    for (const asset of assets) {
      const installed = { definition: JSON.parse((await host.source(asset.id)).source.replace(/^\uFEFF/, "")) };
      if (isDeepStrictEqual(installed.definition, asset.definition)) continue;
      if (asset.entity in beforeGraph && beforeGraph[asset.entity as keyof typeof beforeGraph].includes(definitionHash(installed.definition))) {
        additive.push(asset);
        const path = join(paths.modelsDirectory, asset.id);
        changes.push({ path, before: await optionalFileBytes(path), after: Buffer.from(asset.source) });
        continue;
      }
      const archiveCandidate = asset.entity === "run" && definitionHash(installed.definition) === "a40aab6755c9b48e29a453125d71f96c5bea758552d46e3ab761003550b814a7";
      if (archiveCandidate) oldArchive = true;
      const archiveCompatible = asset.entity === "run" && definitionHash(installed.definition) === "afbb72e1e4ad2a4f66b39d0f1a2ccd10d26a5b9dab668cc62cfefd0e8fe8b396";
      if (!archiveCandidate && !archiveCompatible && (!(asset.entity in previous) || !previous[asset.entity as keyof typeof previous].includes(definitionHash(installed.definition)))) throw failure("MODEL_INCOMPATIBLE", `Unsupported customized context model: ${asset.id}`);
      if (asset.entity === "run" && !archiveCompatible && !archiveCandidate) oldRun = true;
      const path = join(paths.modelsDirectory, asset.id);
      changes.push({ path, before: await optionalFileBytes(path), after: Buffer.from(asset.source) });
    }
    if (!changes.length) return { changed: false, records: 0 };
    // Publish definitions only after every existing record satisfies the new model.
    // In particular, unsupported historical Step states are never silently renamed.
    for (const asset of additive) {
      const oldSource = (await host.source(asset.id)).source;
      const oldModel = await checkModelDefinition({}, { modelRef: asset.id, source: oldSource, definition: JSON.parse(oldSource.replace(/^\uFEFF/, "")) });
      const opened = await openBusinessStore({}, root, storeId(asset.entity), { runtime: oldModel.runtime! });
      if (opened.store.kind !== "ValueStore") throw failure("STORE_INCOMPATIBLE", `Expected ValueStore: ${asset.id}`);
      const { runtime } = await checkModelDefinition({}, { modelRef: asset.id, definition: asset.definition, source: asset.source });
      let cursor: string | undefined;
      do {
        const page = await opened.store.list({}, { limit: 1000, cursor });
        for (const item of page.items) {
          const row = await opened.store.get({}, item.id);
          if (!row) throw failure("NOT_FOUND", `Record disappeared: ${item.id}`);
          runtime!.reflect(row.value);
        }
        cursor = page.nextCursor;
      } while (cursor);
    }
    let count = 0;
    if (oldRun || oldArchive) {
      // Redo only completes pending Steps, without mutating old or new Run records.
      const service = await openContextControl(root, false, true);
      if (!service) throw failure("INITIALIZATION_INCOMPLETE", "Context control Stores missing");
      // Preserve the old report transition if it stopped before its Run-root write.
      // Capture pending identities before redo completes their Steps; do not write old Runs.
      const pending = new Map<string, Artifact[]>(); let cursor: string | undefined;
      if (oldRun) do {
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
      const opened = { store: service.stores.run, binding: config.dataStores![storeId("run")]!, directory: (await getBusinessBinding(root, storeId("run"))).directory };
      if (opened.store.kind !== "ValueStore" || opened.binding.factory !== "memsphere/filesystem-json") throw failure("UNSUPPORTED_CAPABILITY", "This upgrade requires filesystem-json");
      const asset = assets.find(a => a.entity === "run")!;
      const { runtime } = await checkModelDefinition({}, { modelRef: asset.id, definition: asset.definition, source: asset.source });
      for (const run of runs) {
        const row = await opened.store.get({}, run.id);
        if (!row) throw failure("NOT_FOUND", `Run disappeared: ${run.id}`);
        const old = row.value as Record<string, unknown>;
        const value: Record<string, unknown> = { ...old };
        if (oldRun) {
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

          delete value.outputArtifactIds; delete value.finalArtifactIds;
          if (overrides.addedArtifactIds.length || overrides.removedArtifactIds.length) value.outputOverrides = overrides;
        }
        if (oldArchive && Object.hasOwn(value, "archivedAt")) { value.archived = true; delete value.archivedAt; }
        if (isDeepStrictEqual(old, value)) continue;
        runtime!.reflect(value);
        if (!row.revision || row.revision === Number.MAX_SAFE_INTEGER) throw failure("REVISION_OVERFLOW", `Invalid Run revision: ${run.id}`);
        const path = join(opened.directory, `${run.id}.json`);
        const before = await optionalFileBytes(path);
        changes.push({ path, before, after: Buffer.from(JSON.stringify({ ...row, value, revision: row.revision + 1, updatedAt: Date.now() }, null, 2) + "\n") });
        count++;
      }
    }
    const registrations = await readModelRegistrations({}, { root, ...config });
    for (const asset of assets) {
      const definition = changes.find(change => change.path === join(paths.modelsDirectory, asset.id));
      if (!definition) continue;
      const record = registrations.records.find(record => record.registration.modelRef === asset.id);
      if (!record || record.origin !== "project") throw failure("MODEL_INCOMPATIBLE", `Missing context model registration: ${asset.id}`);
      const path = join(paths.registrationDirectory, "project", `${record.id}.json`);
      const before = (await optionalFileBytes(path))!;
      const row = JSON.parse(before.toString("utf8"));
      changes.push({ path, before, after: Buffer.from(JSON.stringify({ ...row, revision: row.revision + 1, updatedAt: Date.now(), value: { ...row.value, definition_sha256: modelDefinitionHash(definition.after) } }, null, 2) + "\n") });
    }
    await commitModelOperation(root, CONTEXT_OUTPUTS_UPGRADE, changes, hooks);
    return { changed: true, records: count };
  }));
}
