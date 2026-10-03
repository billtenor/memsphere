import { resolve } from "node:path";
import { assertModelPath, discoverModelIds } from "./model-storage-paths.js";
import { readModelRegistrations, modelRegistrationBinding, builtinModelRegistrations, MODEL_REGISTRATION_MODEL, LEGACY_MODEL_REGISTRATION_MODEL, IMPORTED_MODEL_DEFINITIONS_STORE, type ModelRegistration, type ModelOrigin, type ProjectModelInput } from "./model-registration.js";
import { Config } from "../data/api/config.js";
import type { Context } from "../data/api/context.js";
import type { Data } from "../data/api/data.js";
import type { DataStore } from "../data/api/data-store.js";
import { filesystemDataStoreExtension, jsonSchemaExtension, jsonSchemaMetaModelExtension, jsonSerializerExtension, rawExtension, JSON_SCHEMA_DRAFT_07 } from "../data/extensions/index.js";
import { validateRelativeFilePath } from "../data/extensions/shared/filesystem.js";
import { bytesContent, readAll } from "../data/extensions/shared/payload.js";
import { DefaultDataManager, type ModelBinding } from "../data/management/data-manager.js";
import { DefaultDataExtensionRegistry } from "../data/management/extension-registry.js";
import { runModelBindings } from "./run-data.js";
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
  registration?: ModelRegistration;
  origin?: ModelOrigin;
};
const extensions = new DefaultDataExtensionRegistry([
  filesystemDataStoreExtension, jsonSerializerExtension, jsonSchemaExtension, jsonSchemaMetaModelExtension, rawExtension
]);
/** A fresh host per explicit operation; no stale directory or model cache crosses refreshes. */
export async function createProjectModelHost(context: Context, input: ProjectModelInput) {
  const registrationState = await readModelRegistrations(context, input);
  const paths = registrationState.paths;
  const directory = paths.modelsDirectory;
  const stores = [{ id: MODEL_DEFINITIONS_STORE, model: JSON_SCHEMA_DRAFT_07, kind: "DataStore" as const,
      factory: "memsphere/filesystem", config: new Config({ directory }) },
    { id: IMPORTED_MODEL_DEFINITIONS_STORE, model: JSON_SCHEMA_DRAFT_07, kind: "DataStore" as const, factory: "memsphere/filesystem", config: new Config({ directory: resolve(paths.registrationDirectory, "imported-definitions") }) }];
  const bootstrap = new DefaultDataManager({ extensions, stores });
  const store = await bootstrap.getStore(context, MODEL_DEFINITIONS_STORE) as DataStore;
  const ids = await discoverModelIds(context, directory, paths.excludedDirectories);
  const builtin = [...runModelBindings(), modelRegistrationBinding()];
  const registrations = new Map<string, {
    registration: ModelRegistration;
    origin: ModelOrigin;
  }>();
  const errors = new Map<string, string>();
  for (const diagnostic of registrationState.diagnostics)
    if (diagnostic.modelRef)
      errors.set(diagnostic.modelRef, diagnostic.message);
  for (const record of registrationState.records) {
    const v = record.registration;
    const expectedStore = record.origin === "project" ? MODEL_DEFINITIONS_STORE : IMPORTED_MODEL_DEFINITIONS_STORE;
    if (v.storage !== "store" || v.store_id !== expectedStore || builtin.some(b => b.model.data.id === v.modelRef))
      errors.set(v.modelRef, `Invalid model storage binding: ${v.modelRef} (${v.store_id ?? v.storage})`);
    registrations.set(v.modelRef, { registration: v, origin: record.origin });
  }
  for (const binding of builtin) {
    const id = binding.model.data.id;
    registrations.set(id, { origin: "system", registration: structuredClone(builtinModelRegistrations.find(r => r.modelRef === id)!) });
    if (ids.includes(id))
      errors.set(id, `Duplicate builtin modelRef: ${id}`);
  }
  const allStoredIds = [...new Set([...ids, ...registrationState.records.map(r => r.registration.modelRef)])].filter(id => !builtin.some(b => b.model.data.id === id));
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
        if (errors.has(id))
          throw new TypeError(errors.get(id));
        const registered = registrations.get(id);
        const storeId = registered?.registration.store_id ?? MODEL_DEFINITIONS_STORE;
        if (storeId !== MODEL_DEFINITIONS_STORE && storeId !== IMPORTED_MODEL_DEFINITIONS_STORE)
          throw new TypeError(`Unknown model Store: ${storeId}`);
        const sourceDirectory = storeId === MODEL_DEFINITIONS_STORE ? directory : resolve(paths.registrationDirectory, "imported-definitions");
        await assertModelPath(sourceDirectory, id, storeId === MODEL_DEFINITIONS_STORE ? paths.excludedDirectories : []);
        const sourceStore = storeId === MODEL_DEFINITIONS_STORE ? store : await bootstrap.getStore(context, storeId) as DataStore;
        const stored = await sourceStore.get(context, id);
        if (!stored)
          throw Object.assign(new Error(`Model not found: ${id}`), { code: "MODEL_NOT_FOUND" });
        const bytes = await readAll(context, stored.data.payload.content);
        const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        return { source, data: { ...stored.data, payload: { contentType: "application/json", content: bytesContent(bytes) } } };
      })();
      snapshots.set(id, pending);
    }
    return pending;
  };
  const bindings: ModelBinding[] = [meta, ...builtin, ...allStoredIds.map(ref => ({ ref, loadData: async () => (await snapshot(ref)).data }))];
  const manager = new DefaultDataManager({ extensions, stores, models: bindings });
  function assertId(id: string) {
    validateRelativeFilePath(id);
    if (!known.has(id) && !builtin.some(binding => binding.model.data.id === id)) {
      throw Object.assign(new Error(`Model not found: ${id}`), { code: "MODEL_NOT_FOUND" });
    }
  }
  const definition = async (id: string) => {
    if (id === LEGACY_MODEL_REGISTRATION_MODEL && !known.has(id))
      id = MODEL_REGISTRATION_MODEL;
    assertId(id);
    if (errors.has(id))
      throw new TypeError(errors.get(id));
    const model = await manager.getModel(context, id);
    const isBuiltin = !known.has(id);
    const source = isBuiltin ? JSON.stringify(model.definition, null, 2) : (await snapshot(id)).source;
    const value = model.definition as Record<string, unknown>;
    const managed = registrations.get(id) ?? { origin: "project" as const, registration: { modelRef: id, storage: "store" as const, store_id: MODEL_DEFINITIONS_STORE } };
    return { id, registration: managed.registration, origin: managed.origin, metaModel: model.data.model, builtin: isBuiltin, definition: model.definition, source,
      ...(typeof value.title === "string" ? { title: value.title } : {}),
      ...(typeof value.description === "string" ? { description: value.description } : {}) };
  };
  return {
    directory, store, manager, definition, initialized: registrationState.initialized, diagnostics: registrationState.diagnostics,
    async list(): Promise<ProjectModelSummary[]> {
      const result: ProjectModelSummary[] = [];
      for (const id of [...new Set([...allStoredIds, ...builtin.map(binding => binding.model.data.id)])].sort()) {
        try {
          const { source: _source, definition: _definition, ...summary } = await definition(id);
          result.push({ ...summary, status: "available" });
        }
        catch (error) {
          context.signal?.throwIfAborted();
          // Invalid content is isolated; storage I/O failures are not reclassified as corrupt models.
          if (!(error instanceof SyntaxError) && !(error instanceof TypeError)
            && !(error && typeof error === "object" && "code" in error && error.code === "MODEL_NOT_FOUND"))
            throw error;
          result.push({ id, ...(registrations.get(id) ?? {}), metaModel: JSON_SCHEMA_DRAFT_07, builtin: false, status: "unavailable",
            error: error instanceof Error ? error.message : String(error) });
        }
      }
      return result;
    },
    async runtime(id: string) {
      if (id === LEGACY_MODEL_REGISTRATION_MODEL && !known.has(id))
        id = MODEL_REGISTRATION_MODEL;
      assertId(id);
      const dependencies = new Map<string, string[]>();
      const visit = async (ref: string): Promise<void> => {
        if (dependencies.has(ref))
          return;
        const model = await manager.getModel(context, ref);
        const refs = model.data.model === JSON_SCHEMA_DRAFT_07 ? schemaDependencies(model.definition) : [];
        dependencies.set(ref, refs);
        for (const dependency of refs)
          await visit(dependency);
      };
      await visit(id);
      const prepared = new DefaultDataManager({ extensions, stores,
        models: bindings.map(binding => ({ ...binding, dependencies: dependencies.get(binding.model?.data.id ?? binding.ref!) ?? [] })) });
      return prepared.getRuntime(context, id);
    }
  };
}
/** Match the existing compiler's external ModelRef semantics, without network loads or aliases. */
function schemaDependencies(definition: unknown): string[] {
  const root = definition as Record<string, unknown>;
  // Only absolute IDs establish the compiler's supported reference base.
  // Leave unsupported relative IDs to the existing compiler's explicit diagnostic.
  const base = typeof root.$id === "string" && URL.canParse(root.$id) ? new URL(root.$id) : undefined;
  if (base)
    base.hash = "";
  const refs = new Set<string>();
  function visit(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return;
    const schema = value as Record<string, unknown>;
    if (typeof schema.$ref === "string" && schema.$ref !== "" && !schema.$ref.startsWith("#")) {
      const target = base ? new URL(schema.$ref, base) : undefined;
      if (target) {
        target.hash = "";
        if (target.href !== base!.href)
          refs.add(target.href);
      }
      else
        refs.add(schema.$ref.split("#", 1)[0]!);
    }
    for (const key of ["properties", "definitions"]) {
      const children = schema[key];
      if (children && typeof children === "object" && !Array.isArray(children))
        Object.values(children).forEach(visit);
    }
    visit(schema.items);
    visit(schema.additionalProperties);
  }
  visit(root);
  return [...refs];
}
