import { createHash } from "node:crypto";
import { z } from "zod";
import { openBusinessStore, serviceError } from "./business-stores.js";
import { createProjectModelHost } from "./models.js";
import { withProjectSettingsLock } from "./model-operation.js";
import { validateFilename } from "../data/extensions/shared/filesystem.js";
import { JSON_SCHEMA_DRAFT_07 } from "../data/extensions/index.js";

export const modelArtifactTargetSchema = z.object({
  storeId: z.string(), modelRef: z.string(), fingerprint: z.string()
}).strict();
export type ModelArtifactTarget = z.infer<typeof modelArtifactTargetSchema>;
export const modelArtifactCandidateTargetSchema = modelArtifactTargetSchema.extend({
  stepExecutionId: z.string().uuid(), dataId: z.string()
}).strict();
export type ModelArtifactCandidateTarget = z.infer<typeof modelArtifactCandidateTargetSchema>;

export function validateModelArtifactDataId(id: string): void {
  if (typeof id !== "string" || id.trim().length === 0) throw serviceError("INVALID_ARGUMENT", "data-id must be a non-empty, non-whitespace string");
  validateFilename(id);
  validateFilename(`${id}.json`);
}

export const modelArtifactReceiptSchema = modelArtifactTargetSchema.extend({
  stepExecutionId: z.string().uuid(), dataId: z.string(), digest: z.string(),
  committedAt: z.string(), revision: z.number().int().positive().optional()
}).strict();
export type ModelArtifactReceipt = z.infer<typeof modelArtifactReceiptSchema>;

// Stable object ordering avoids treating config property ordering as a binding change.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
async function inspect(root: string, storeId: string, expectedModel?: string) {
  const opened = await openBusinessStore({}, root, storeId);
  if (opened.binding.kind !== "value" || opened.binding.factory !== "memsphere/filesystem-json" || opened.store.kind !== "ValueStore" || !opened.store.upsert)
    throw serviceError("UNSUPPORTED_CAPABILITY", "Model Artifacts require a filesystem JSON ValueStore with atomic upsert");
  if (expectedModel && opened.binding.model !== expectedModel)
    throw serviceError("STORE_MODEL_MISMATCH", `Store ${storeId} does not use ${expectedModel}`);
  const host = await createProjectModelHost({}, { root, ...opened.project });
  const model = await host.definition(opened.binding.model);
  const metaDefinition = model.metaModel === JSON_SCHEMA_DRAFT_07 ? (await host.manager.getModel({}, JSON_SCHEMA_DRAFT_07)).definition : (await host.definition(model.metaModel)).definition;
  const fingerprint = createHash("sha256").update(canonical({
    binding: { ...opened.binding, config: { ...opened.binding.config, directory: opened.directory } },
    metaModel: model.metaModel, definition: model.definition, metaDefinition
  })).digest("hex");
  return { opened, target: { storeId, modelRef: opened.binding.model, fingerprint } };
}
export function freezeModelArtifactTargets(root: string, declarations: Array<{ store: string; model?: string }>) {
  return withProjectSettingsLock(root, async () => {
    const targets: Record<string, ModelArtifactTarget> = {};
    for (const declaration of declarations) {
      const { target } = await inspect(root, declaration.store, declaration.model);
      targets[declaration.store] = target;
    }
    return targets;
  });
}
/** Check and write under the same Project lock; no nested settings-lock acquisition. */
export function processModelArtifact(root: string, target: ModelArtifactTarget, value: unknown,
  commit?: { runId: string; stepExecutionId: string; digest: string; dataId?: string }): Promise<ModelArtifactReceipt | undefined> {
  return withProjectSettingsLock(root, async () => {
    const current = await inspect(root, target.storeId, target.modelRef);
    if (current.target.fingerprint !== target.fingerprint)
      throw serviceError("MODEL_ARTIFACT_TARGET_CHANGED", `Model Artifact target changed: ${target.storeId}; restore the original binding and model before retrying`);
    current.opened.runtime.reflect(value);
    if (!commit) return undefined;
    const dataId = commit.dataId ?? `${commit.runId}--${commit.stepExecutionId}`;
    validateModelArtifactDataId(dataId);
    const store = current.opened.store;
    if (store.kind !== "ValueStore" || !store.upsert) throw serviceError("UNSUPPORTED_CAPABILITY", "Store has no atomic upsert");
    const result = await store.upsert({}, dataId, value);
    return { ...target, stepExecutionId: commit.stepExecutionId, dataId, digest: commit.digest,
      committedAt: new Date().toISOString(), ...(result.revision === undefined ? {} : { revision: result.revision }) };
  });
}
