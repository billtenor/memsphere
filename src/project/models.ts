import { resolve } from "node:path";
import { assertModelPath, discoverModelIds } from "./model-storage-paths.js";
import { readModelRegistrations, IMPORTED_MODEL_DEFINITIONS_STORE, type ModelRegistration, type ModelOrigin, type ProjectModelInput } from "./model-registration.js";
import type { Context } from "../data/api/context.js";
import type { Data } from "../data/api/data.js";
import type { DataStore } from "../data/api/data-store.js";
import { filesystemDataStoreExtension, jsonSchemaExtension, jsonSchemaMetaModelExtension, jsonSerializerExtension, rawExtension, JSON_SCHEMA_DRAFT_07 } from "../data/extensions/index.js";
import { bytesContent, readAll } from "../data/extensions/shared/payload.js";
import { DefaultDataManager, type ModelBinding } from "../data/management/data-manager.js";
import { DefaultDataExtensionRegistry } from "../data/management/extension-registry.js";
import { modelDefinitionStore } from "./system-model-store.js";
import { assertModelRef, SYSTEM_JSON_SCHEMA_MODELS_STORE, SYSTEM_RAW_MODELS_STORE } from "./model-registration-contract.js";
import { readBundledSystemModels } from "../reserved/models.js";
import { RAW_MODEL } from "../data/extensions/raw/index.js";
import { checkModelDefinition, type CheckedModel, type ModelCheck } from "./model-validation.js";
import { readModelOperationStamp, assertModelOperationStamp } from "./model-operation.js";
export const DEFAULT_MODELS_DIRECTORY = "models/json-schema/draft-07";
export const MODEL_DEFINITIONS_STORE = "models/json-schema/draft-07";
export type ProjectModelSummary = {
  id: string;
  metaModel: string;
  builtin: boolean;
  title?: string;
  description?: string;
  status: "available" | "unavailable";
  error?: string;
  errorCode?: string;
  errorDetails?: unknown;
  registration?: ModelRegistration;
  origin?: ModelOrigin;
};
const extensions = new DefaultDataExtensionRegistry([
  filesystemDataStoreExtension, jsonSerializerExtension, jsonSchemaExtension, jsonSchemaMetaModelExtension, rawExtension
]);
/** A fresh host per explicit operation; no stale directory or model cache crosses refreshes. */
export async function createProjectModelHost(context: Context, input: ProjectModelInput) {
  const operationStamp = await readModelOperationStamp(input.root);
  const assertSnapshot = () => assertModelOperationStamp(input.root, operationStamp);
  const registrationState = await readModelRegistrations(context, input);
  const paths = registrationState.paths;
  const directory = paths.modelsDirectory;
  const dataStores = new Map<string, DataStore>([
    [MODEL_DEFINITIONS_STORE, modelDefinitionStore(MODEL_DEFINITIONS_STORE, JSON_SCHEMA_DRAFT_07, directory)],
    [IMPORTED_MODEL_DEFINITIONS_STORE, modelDefinitionStore(IMPORTED_MODEL_DEFINITIONS_STORE, JSON_SCHEMA_DRAFT_07, resolve(paths.registrationDirectory, "imported-definitions"))],
    [SYSTEM_JSON_SCHEMA_MODELS_STORE, modelDefinitionStore(SYSTEM_JSON_SCHEMA_MODELS_STORE, JSON_SCHEMA_DRAFT_07, resolve(paths.registrationDirectory, "system/definitions/json-schema/draft-07"), true)],
    [SYSTEM_RAW_MODELS_STORE, modelDefinitionStore(SYSTEM_RAW_MODELS_STORE, RAW_MODEL, resolve(paths.registrationDirectory, "system/definitions/raw"), true)]
  ]);
  const store = dataStores.get(MODEL_DEFINITIONS_STORE)!;
  const ids = await discoverModelIds(context, directory, paths.excludedDirectories);
  const registrations = new Map<string, {
    registration: ModelRegistration;
    origin: ModelOrigin;
  }>();
  const errors = new Map<string, string>();
  for (const diagnostic of registrationState.diagnostics)
    if (diagnostic.modelRef)
      errors.set(diagnostic.modelRef, diagnostic.message);
  const systemCatalog = new Map(readBundledSystemModels().map(model => [model.registration.modelRef, model]));
  for (const record of registrationState.records) {
    const v = record.registration;
    const validStores = record.origin === "system" ? [SYSTEM_JSON_SCHEMA_MODELS_STORE, SYSTEM_RAW_MODELS_STORE]
      : [record.origin === "project" ? MODEL_DEFINITIONS_STORE : IMPORTED_MODEL_DEFINITIONS_STORE];
    const system = record.origin === "system" ? systemCatalog.get(v.modelRef) : undefined;
    if (v.storage !== "store" || !validStores.includes(v.store_id!)
      || record.origin === "system" && (!system || v.store_id !== system.registration.store_id || v.package !== system.registration.package))
      errors.set(v.modelRef, `Invalid model storage binding: ${v.modelRef} (${v.store_id ?? v.storage})`);
    registrations.set(v.modelRef, { registration: v, origin: record.origin });
  }
  for (const record of registrationState.records) {
    if (record.origin !== "project" && ids.includes(record.registration.modelRef))
      errors.set(record.registration.modelRef, `Duplicate modelRef: ${record.registration.modelRef}`);
  }
  const allStoredIds = [...new Set([...ids, ...registrationState.records.map(r => r.registration.modelRef)])];
  const known = new Set(allStoredIds);
  const meta: ModelBinding = { model: {
      data: { id: JSON_SCHEMA_DRAFT_07, model: JSON_SCHEMA_DRAFT_07,
        payload: { contentType: "application/json", content: bytesContent(Buffer.from('{"type":"object"}')) } },
      definition: { type: "object" }
    } };
  const snapshots = new Map<string, Promise<{
    data: Data;
    source: string;
  }>>();
  const snapshot = (id: string) => {
    let pending = snapshots.get(id);
    if (!pending) {
      pending = (async () => {
        await assertSnapshot();
        if (errors.has(id))
          throw new TypeError(errors.get(id));
        const registered = registrations.get(id);
        const storeId = registered?.registration.store_id ?? MODEL_DEFINITIONS_STORE;
        const sourceStore = dataStores.get(storeId!);
        if (!sourceStore) throw new TypeError(`Unknown model Store: ${storeId}`);
        if (registered?.origin !== "system") {
          const sourceDirectory = storeId === MODEL_DEFINITIONS_STORE ? directory : resolve(paths.registrationDirectory, "imported-definitions");
          await assertModelPath(sourceDirectory, id, storeId === MODEL_DEFINITIONS_STORE ? paths.excludedDirectories : []);
        }
        const stored = await sourceStore.get(context, id);
        if (!stored)
          throw Object.assign(new Error(`Model not found: ${id}`), { code: "MODEL_NOT_FOUND" });
        const bytes = await readAll(context, stored.data.payload.content);
        const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        await assertSnapshot();
        return { source, data: { ...stored.data, payload: { contentType: "application/json", content: bytesContent(bytes) } } };
      })();
      snapshots.set(id, pending);
    }
    return pending;
  };
  const preparedManager = new DefaultDataManager({ extensions, models: [meta] });
  const checks = new Map<string, Promise<CheckedModel>>();
  async function checked(id: string, check: ModelCheck = "runtime"): Promise<CheckedModel> {
    await assertSnapshot();
    assertId(id);
    const key = `${check}:${id}`;
    let pending = checks.get(key);
    if (!pending) {
      pending = (async () => {
        const saved = await snapshot(id);
        let definition: unknown;
        try { definition = JSON.parse(saved.source.replace(/^\uFEFF/, "")); }
        catch (cause) {
          throw Object.assign(new TypeError(`Invalid model JSON: ${id}`, { cause }), {
            code: "MODEL_DEFINITION_INVALID", details: { modelRef: id, path: "#" }
          });
        }
        return checkModelDefinition(context, { modelRef: id, metaModel: saved.data.model, source: saved.source, definition }, check);
      })();
      checks.set(key, pending);
    }
    const result = await pending;
    await assertSnapshot();
    return result;
  }
  const manager = {
    async getModel(ctx: Context, ref: string) {
      ctx.signal?.throwIfAborted();
      await assertSnapshot();
      if (ref === JSON_SCHEMA_DRAFT_07) {
        const model = await preparedManager.getModel(ctx, ref);
        await assertSnapshot();
        return model;
      }
      return (await checked(ref)).model;
    },
    async getRuntime(ctx: Context, ref: string) {
      ctx.signal?.throwIfAborted();
      await assertSnapshot();
      if (ref === JSON_SCHEMA_DRAFT_07) {
        const runtime = await preparedManager.getRuntime(ctx, ref);
        await assertSnapshot();
        return runtime;
      }
      return (await checked(ref)).runtime!;
    },
    async getStore(ctx: Context, id: string) {
      await assertSnapshot();
      const store = dataStores.get(id);
      if (store) return store;
      return preparedManager.getStore(ctx, id);
    }
  };
  function assertId(id: string) {
    assertModelRef(id);
    if (!known.has(id)) {
      throw Object.assign(new Error(`Model not found: ${id}; use project models initialize if system models are not installed`), { code: "MODEL_NOT_FOUND" });
    }
  }
  const describe = async (id: string, check: ModelCheck) => {
    const { model } = await checked(id, check);
    const isBuiltin = registrations.get(id)?.origin === "system";
    const source = (await snapshot(id)).source;
    const value = model.definition as Record<string, unknown>;
    const managed: { origin: ModelOrigin; registration: ModelRegistration } = registrations.get(id)
      ?? { origin: "project", registration: { modelRef: id, storage: "store", store_id: MODEL_DEFINITIONS_STORE } };
    await assertSnapshot();
    return { id, registration: managed.registration, origin: managed.origin, metaModel: model.data.model, builtin: isBuiltin, definition: model.definition, source,
      ...(typeof value.title === "string" ? { title: value.title } : {}),
      ...(typeof value.description === "string" ? { description: value.description } : {}) };
  };
  const definition = (id: string) => describe(id, "runtime");
  const inspect = (id: string) => describe(id, "definition");
  await assertSnapshot();
  return {
    directory, store, manager, definition, inspect, initialized: registrationState.initialized, diagnostics: registrationState.diagnostics,
    /** Internal repair/delete input: retain storage and snapshot checks without approving an old definition. */
    async source(id: string) {
      assertId(id);
      const saved = await snapshot(id);
      await assertSnapshot();
      return { source: saved.source, metaModel: saved.data.model };
    },
    async list(): Promise<ProjectModelSummary[]> {
      const result: ProjectModelSummary[] = [];
      for (const id of [...allStoredIds].sort()) {
        try {
          const { source: _source, definition: _definition, ...summary } = await definition(id);
          result.push({ ...summary, status: "available" });
        }
        catch (error) {
          context.signal?.throwIfAborted();
          if (["MODEL_OPERATION_PENDING", "MODEL_READ_CONFLICT"].includes((error as { code?: string })?.code ?? "")) throw error;
          // Invalid content is isolated; storage I/O failures are not reclassified as corrupt models.
          if (!(error instanceof SyntaxError) && !(error instanceof TypeError)
            && !(error && typeof error === "object" && "code" in error && error.code === "MODEL_NOT_FOUND"))
            throw error;
          const details = error && typeof error === "object" ? error as { code?: string; details?: unknown } : undefined;
          result.push({ id, ...(registrations.get(id) ?? {}), metaModel: registrations.get(id)?.registration.store_id === SYSTEM_RAW_MODELS_STORE ? RAW_MODEL : JSON_SCHEMA_DRAFT_07, builtin: registrations.get(id)?.origin === "system", status: "unavailable",
            error: error instanceof Error ? error.message : String(error), errorCode: details?.code, errorDetails: details?.details });
        }
      }
      await assertSnapshot();
      return result;
    },
    async runtime(id: string) {
      return (await checked(id)).runtime!;
    }
  };
}
