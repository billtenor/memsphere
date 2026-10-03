import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "../data/api/context.js";
import { bytesContent, readAll } from "../data/extensions/shared/payload.js";
import { RawModelRuntime } from "../data/extensions/raw/index.js";
import { readBundledSystemModels } from "../reserved/models.js";
import { createModelRegistrationStore, pathExists, readModelRegistrations } from "./model-registration.js";
import { DEFAULT_MODEL_REGISTRATION_CONFIG, SYSTEM_JSON_SCHEMA_MODELS_STORE, SYSTEM_RAW_MODELS_STORE, type ProjectModelInput } from "./model-registration-contract.js";
import { modelDefinitionStore } from "./system-model-store.js";
import { discoverModelIds } from "./model-storage-paths.js";

export type SystemModelInstallation = { status: "installed" | "unchanged"; created: number; retained: number };
export type SystemModelInstallOptions = { beforePublish?: () => Promise<void> };

/** Caller owns the Project settings lock or an unpublished Project staging root. */
export async function installBundledSystemModels(context: Context, input: ProjectModelInput, options: SystemModelInstallOptions = {}): Promise<SystemModelInstallation> {
  const models = readBundledSystemModels();
  const state = await readModelRegistrations(context, input);
  if (state.diagnostics.length) throw new TypeError(`Damaged model registrations: ${state.diagnostics.map(d => d.message).join(", ")}`);
  const ids = await discoverModelIds(context, state.paths.modelsDirectory, state.paths.excludedDirectories);
  const systemRoot = join(state.paths.registrationDirectory, "system");
  const installed = await pathExists(systemRoot);
  const persisted = state.records.filter(record => record.origin === "system");
  for (const model of models) {
    const ref = model.registration.modelRef;
    if (ids.includes(ref) || state.records.some(record => record.origin !== "system" && record.registration.modelRef === ref))
      throw new TypeError(`System model identity conflict: ${ref}`);
    if (installed) {
      const record = persisted.find(record => record.registration.modelRef === ref);
      if (!record || record.registration.storage !== "store" || record.registration.store_id !== model.registration.store_id
        || record.registration.package !== model.registration.package)
        throw new TypeError(`System model registration conflict or missing: ${ref}`);
      const stored = await systemStore(systemRoot, model.metaModel).get(context, ref);
      if (!stored || !Buffer.from(await readAll(context, stored.data.payload.content)).equals(Buffer.from(model.source)))
        throw new TypeError(`System model definition conflict or missing: ${ref}`);
    }
  }
  if (installed) {
    if (persisted.length !== models.length) throw new TypeError("Unexpected system model registrations");
    return { status: "unchanged", created: 0, retained: models.length };
  }
  const stage = join(state.paths.registrationDirectory, `.memsphere-system-${randomUUID()}`);
  await mkdir(stage, { recursive: true });
  try {
    const records = await createModelRegistrationStore(context, `${(input.modelRegistration ?? DEFAULT_MODEL_REGISTRATION_CONFIG).storeId}/system`, join(stage, "registrations"));
    for (const model of models) {
      const store = systemStore(stage, model.metaModel);
      const data = { id: model.registration.modelRef, model: model.metaModel, payload: { contentType: "application/json", content: bytesContent(Buffer.from(model.source)) } };
      await store.create(context, data);
      const saved = await store.get(context, data.id);
      if (!saved || !Buffer.from(await readAll(context, saved.data.payload.content)).equals(Buffer.from(model.source)))
        throw new Error(`System model byte verification failed: ${data.id}`);
      if (model.metaModel === "raw") new RawModelRuntime({ data, definition: model.definition });
      const recordId = randomUUID();
      await records.create(context, recordId, structuredClone(model.registration));
      if (!await records.get(context, recordId)) throw new Error(`System model registration verification failed: ${data.id}`);
    }
    await options.beforePublish?.();
    context.signal?.throwIfAborted();
    if (await pathExists(systemRoot)) throw new TypeError("System models changed during installation");
    await rename(stage, systemRoot);
    return { status: "installed", created: models.length, retained: 0 };
  } catch (error) {
    try { await rm(stage, { recursive: true, force: true }); }
    catch (cleanup) { throw new AggregateError([error, cleanup], `System model installation failed; candidate cleanup required: ${stage}`); }
    throw error;
  }
}
function systemStore(root: string, metaModel: string) {
  if (metaModel !== "raw" && metaModel !== "json-schema/draft-07") throw new TypeError(`Unsupported system model standard: ${metaModel}`);
  const id = metaModel === "raw" ? SYSTEM_RAW_MODELS_STORE : SYSTEM_JSON_SCHEMA_MODELS_STORE;
  return modelDefinitionStore(id, metaModel, join(root, "definitions", metaModel), true);
}
