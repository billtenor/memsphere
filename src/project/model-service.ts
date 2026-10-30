import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Context } from "../data/api/context.js";
import { createProjectModelHost, MODEL_DEFINITIONS_STORE } from "./models.js";
import { readModelRegistrations, createModelRegistrationStore, modelDefinitionHash, validateModelRegistration, type ModelRegistration, type ModelOrigin, IMPORTED_MODEL_DEFINITIONS_STORE } from "./model-registration.js";
import { assertModelRef } from "./model-registration-contract.js";
import { readBundledSystemModels } from "../reserved/models.js";
import { checkModelDefinition, type ModelCheck } from "./model-validation.js";
import { assertModelPath } from "./model-storage-paths.js";
import { readBusinessProject, validateBusinessBindings, openBusinessStore, serviceError } from "./business-stores.js";
import { assertModelOperationStamp, readModelOperationStamp, optionalFileBytes, withConsistentModelRead, type ModelFileChange } from "./model-operation.js";
import { JsonPayloadSerializer } from "../data/extensions/json-serializer/index.js";
import { bytesContent } from "../data/extensions/shared/payload.js";
import { withConfigFileLock } from "../config-file-lock.js";
import { modelDefinitionStore } from "./system-model-store.js";
import { JSON_SCHEMA_DRAFT_07 } from "../data/extensions/index.js";
import { atomicWriteJson } from "../persistence.js";
import { paginateItems, compareStrings, type PaginationOptions } from "../pagination.js";

export type ModelManagementFields = Pick<ModelRegistration, "name" | "description" | "package" | "package_name" | "tags">;
export type ModelChanges = { source?: string; fields?: ModelManagementFields; unset?: string[]; dryRun?: boolean };
export type ModelFilters = { origin?: ModelOrigin; package?: string; unpackaged?: boolean; tag?: string[]; query?: string; status?: "available" | "unavailable" };
export function assertWritableModelRef(ref: string) {
  assertModelRef(ref);
  if (readBundledSystemModels().some(model => model.registration.modelRef === ref)) throw serviceError("SYSTEM_MODEL_READ_ONLY", `System model is read-only: ${ref}`);
}
export function parseModelSource(source: string): unknown {
  try { return JSON.parse(source.replace(/^\uFEFF/, "")); }
  catch (cause) { throw serviceError("INPUT_INVALID", "Definition file is not valid JSON", { cause: String(cause) }); }
}
async function hostFor(context: Context, root: string) {
  const stamp = await readModelOperationStamp(root);
  const project = await readBusinessProject(root);
  const host = await createProjectModelHost(context, { root, ...project });
  return { stamp, project, host };
}
export function listModels(context: Context, root: string, filters: ModelFilters = {}, options: PaginationOptions = {}) {
  return withConsistentModelRead(() => listModelsOnce(context, root, filters, options));
}
async function listModelsOnce(context: Context, root: string, filters: ModelFilters, options: PaginationOptions) {
  if (filters.package && filters.unpackaged) throw serviceError("INVALID_ARGUMENT", "package and unpackaged are mutually exclusive");
  const { stamp, host } = await hostFor(context, root);
  const items = (await host.list()).filter(item => {
    const registration = item.registration;
    return (!filters.origin || item.origin === filters.origin) && (!filters.package || registration?.package === filters.package)
      && (!filters.unpackaged || !registration?.package) && (!filters.status || item.status === filters.status)
      && (!filters.tag || filters.tag.every(tag => registration?.tags?.includes(tag)))
      && (!filters.query || [item.id, registration?.name, registration?.description, item.title, item.description].some(value => value?.toLowerCase().includes(filters.query!.toLowerCase())));
  }).sort((a, b) => compareStrings(a.id, b.id));
  await assertModelOperationStamp(root, stamp);
  return paginateItems(items, options, { command: "model.list", scope: { root }, filters: {
    origin: filters.origin, package: filters.package, unpackaged: filters.unpackaged, query: filters.query, status: filters.status,
    tag: filters.tag ? [...filters.tag].sort(compareStrings) : undefined
  } });
}
export function readModel(context: Context, root: string, ref: string, part: "all" | "registration" | "definition" = "definition") {
  return withConsistentModelRead(() => readModelOnce(context, root, ref, part));
}
async function readModelOnce(context: Context, root: string, ref: string, part: "all" | "registration" | "definition") {
  assertModelRef(ref);
  const { host, stamp } = await hostFor(context, root);
  const result = await host.definition(ref);
  await assertModelOperationStamp(root, stamp);
  return { modelRef: ref, ...(part !== "definition" ? { registration: result.registration, origin: result.origin } : {}), ...(part !== "registration" ? { definition: result.definition } : {}) };
}
function mergeRegistration(base: ModelRegistration, input: ModelChanges): ModelRegistration {
  const fields = input.fields ?? {};
  const unset = input.unset ?? [];
  const allowed = ["name", "description", "package", "package_name", "tags"] as const;
  if (new Set(unset).size !== unset.length) throw serviceError("INVALID_ARGUMENT", "Duplicate unset field");
  for (const field of unset) {
    if (!allowed.includes(field as typeof allowed[number])) throw serviceError("INVALID_ARGUMENT", `Cannot unset ${field}`);
    if (Object.hasOwn(fields, field)) throw serviceError("INVALID_ARGUMENT", `Cannot both set and unset ${field}`);
  }
  if (unset.includes("package") && Object.hasOwn(fields, "package_name")) throw serviceError("INVALID_ARGUMENT", "Cannot set package_name while removing package");
  for (const key of Object.keys(fields)) if (!allowed.includes(key as typeof allowed[number])) throw serviceError("INVALID_ARGUMENT", `Unknown registration field: ${key}`);
  const value = { ...base, ...structuredClone(fields) };
  for (const field of unset) delete value[field as keyof ModelManagementFields];
  if (unset.includes("package")) delete value.package_name;
  validateModelRegistration(value);
  return value;
}
export async function mutateModel(context: Context, root: string, operation: "create" | "update" | "delete", ref: string, input: ModelChanges = {}) {
  assertWritableModelRef(ref);
  if (operation === "create" && input.source === undefined) throw serviceError("INVALID_ARGUMENT", "Model creation requires definition-file");
  if (operation === "update" && input.source === undefined && !Object.keys(input.fields ?? {}).length && !input.unset?.length) throw serviceError("INVALID_ARGUMENT", "Provide at least one model change");
  const execute = async () => {
    const { project, host, stamp } = await hostFor(context, root);
    await validateBusinessBindings(root, project);
    const state = await readModelRegistrations(context, { root, ...project });
    if (state.diagnostics.length) throw serviceError("MODEL_REGISTRATION_INVALID", "Model registration state is damaged", state.diagnostics);
    const summaries = await host.list();
    const existing = summaries.find(model => model.id === ref);
    if (operation === "create" && existing) throw serviceError("ALREADY_EXISTS", `Model already exists: ${ref}`);
    if (operation !== "create" && !existing) throw serviceError("MODEL_NOT_FOUND", `Model not found: ${ref}`);
    if (existing?.origin === "system") throw serviceError("SYSTEM_MODEL_READ_ONLY", `System model is read-only: ${ref}`);
    if (existing?.origin === "app") throw serviceError("APP_MODEL_READ_ONLY", `App model is read-only: ${ref}; manage it through its App package`);
    const market = existing?.origin === "market";
    const definitionDirectory = market ? join(state.paths.registrationDirectory, "imported-definitions") : state.paths.modelsDirectory;
    await assertModelPath(definitionDirectory, ref, market ? [] : state.paths.excludedDirectories);
    const definitionPath = join(definitionDirectory, ref);
    let previous: Awaited<ReturnType<typeof host.definition>> | undefined;
    if (existing && (input.source !== undefined || operation === "delete")) {
      // Replacement validates the candidate, not the broken old model. Deletion publishes no model.
      const saved = await host.source(ref);
      const oldSource = saved.source;
      let oldDefinition: unknown;
      try { oldDefinition = parseModelSource(oldSource); } catch { /* A valid candidate can repair invalid JSON. */ }
      previous = { id: ref, origin: existing.origin ?? "project", registration: existing.registration ?? { modelRef: ref, storage: "store", store_id: MODEL_DEFINITIONS_STORE },
        metaModel: saved.metaModel, builtin: false, definition: oldDefinition, source: oldSource };
    } else if (existing) previous = await host.definition(ref);
    const source = input.source ?? previous!.source;
    const definition = operation === "delete" ? previous!.definition : parseModelSource(source);
    const original = previous?.registration ?? { modelRef: ref, storage: "store" as const, store_id: MODEL_DEFINITIONS_STORE };
    const registration = operation === "delete" ? original : { ...mergeRegistration(original, input), definition_sha256: modelDefinitionHash(source) };
    if (operation !== "delete") await checkModelDefinition(context, { modelRef: ref, metaModel: previous?.metaModel, source, definition });
    const inUse = Object.entries(project.dataStores ?? {}).filter(([, binding]) => binding.model === ref).map(([id]) => id);
    if (inUse.length && (operation === "delete" || previous && !isDeepStrictEqual(previous.definition, definition)))
      throw serviceError("MODEL_IN_USE", `Model is used by business Stores: ${ref}`, { storeIds: inUse });
    for (const record of state.records) if (record.registration.modelRef !== ref && registration.package && record.registration.package === registration.package
      && registration.package_name && record.registration.package_name && registration.package_name !== record.registration.package_name)
      throw serviceError("MODEL_PACKAGE_NAME_CONFLICT", `Inconsistent package name: ${registration.package}`);
    const record = state.records.find(record => record.registration.modelRef === ref);
    // A stable ID makes concurrent first registration contend on one ValueStore
    // record. Existing registrations retain their original identity.
    const key = createHash("sha256").update(ref).digest("hex").slice(0, 32);
    const recordId = record?.id ?? `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20)}`;
    const registrationDirectory = join(state.paths.registrationDirectory, market ? "imported" : "project");
    const registrationPath = join(registrationDirectory, `${recordId}.json`);
    const changes: ModelFileChange[] = [];
    if (operation === "delete" || operation === "create" || input.source !== undefined) changes.push({ path: definitionPath, before: await optionalFileBytes(definitionPath), after: operation === "delete" ? undefined : Buffer.from(source) });
    if (operation === "delete" || !record || !isDeepStrictEqual(original, registration)) changes.push({ path: registrationPath, before: await optionalFileBytes(registrationPath), after: operation === "delete" ? undefined : Buffer.from(JSON.stringify(registration)) });
    await assertModelOperationStamp(root, stamp);
    if (!input.dryRun) {
      const registry = await createModelRegistrationStore(context, `registrations/${market ? "imported" : "project"}`, registrationDirectory);
      const row = await registry.get(context, recordId);
      if (record && !row) throw serviceError("REVISION_CONFLICT", "Model registration disappeared");
      if (!record && row) throw serviceError("ALREADY_EXISTS", `Model already exists: ${ref}`);
      // A fresh read after preflight may include the authorized legacy hash
      // backfill, but must not silently overwrite other concurrent metadata.
      if (record && row) {
        const { definition_sha256: _oldHash, ...before } = record.registration;
        const { definition_sha256: _newHash, ...current } = row.value as ModelRegistration;
        if (!isDeepStrictEqual(before, current) || record.registration.definition_sha256 !== undefined && record.registration.definition_sha256 !== (row.value as ModelRegistration).definition_sha256)
          throw serviceError("REVISION_CONFLICT", "Model registration changed during validation");
      }
      const definitions = modelDefinitionStore(market ? IMPORTED_MODEL_DEFINITIONS_STORE : MODEL_DEFINITIONS_STORE, JSON_SCHEMA_DRAFT_07, definitionDirectory);
      if (operation === "delete") {
        await definitions.delete(context, ref);
        if (row) await registry.delete(context, recordId, { expectedRevision: row.revision });
        if (market) {
          const publicationPath = join(state.paths.registrationDirectory, "published-imports.json");
          await withConfigFileLock(publicationPath, async () => {
            const publication = JSON.parse(await readFile(publicationPath, "utf8")) as { recordIds: string[] };
            await atomicWriteJson(publicationPath, { ...publication, recordIds: publication.recordIds.filter(id => id !== recordId) });
          }, context.signal);
        }
      } else {
        if (operation === "create" || input.source !== undefined) {
          const data = { id: ref, model: JSON_SCHEMA_DRAFT_07, payload: { contentType: "application/json", content: bytesContent(Buffer.from(source)) } };
          if (operation === "create") await definitions.create(context, data);
          else await definitions.update(context, data);
        }
        if (!row) await registry.create(context, recordId, registration);
        else if (!isDeepStrictEqual(row.value, registration)) await registry.update(context, recordId, registration, { expectedRevision: row.revision });
      }
    }
    return { operation: `model.${operation}`, modelRef: ref, ...(operation !== "delete" ? { registration } : {}), ...(input.dryRun ? { dryRun: true, files: changes.map(change => change.path) } : {}) };
  };
  return execute();
}
type ModelValidationOptions = { source?: string; check?: ModelCheck; checkData?: boolean; stores?: string[] };
export function validateModel(context: Context, root: string, ref: string, options: ModelValidationOptions = {}) {
  return withConsistentModelRead(() => validateModelOnce(context, root, ref, options));
}
async function validateModelOnce(context: Context, root: string, ref: string, options: ModelValidationOptions) {
  assertModelRef(ref);
  if (options.stores?.length && !options.checkData || options.checkData && options.check === "definition") throw serviceError("INVALID_ARGUMENT", "store requires check-data; check-data requires runtime");
  const { host, project, stamp } = await hostFor(context, root);
  const existing = options.source === undefined ? await host.inspect(ref) : undefined;
  const source = options.source ?? existing!.source;
  const metaModel = existing?.metaModel ?? (options.source === undefined ? undefined : (await host.list()).find(item => item.id === ref)?.metaModel);
  const checked = await checkModelDefinition(context, { modelRef: ref, metaModel, definition: parseModelSource(source), source }, options.check ?? "runtime");
  const data: Array<{ storeId: string; checked: number; failures: Array<{ id: string; message: string }> }> = [];
  if (options.checkData) {
    await validateBusinessBindings(root, project);
    const ids = options.stores ?? Object.entries(project.dataStores ?? {}).filter(([, binding]) => binding.model === ref).map(([id]) => id);
    for (const storeId of [...new Set(ids)]) {
      if (project.dataStores?.[storeId]?.model !== ref) throw serviceError("STORE_MODEL_MISMATCH", `Store ${storeId} does not use ${ref}`);
      const { store } = await openBusinessStore(context, root, storeId, { runtime: checked.runtime! });
      const result = { storeId, checked: 0, failures: [] as Array<{ id: string; message: string }> };
      let cursor: string | undefined;
      do {
        const page = await store.list(context, { limit: 1000, cursor });
        for (const item of page.items) {
          result.checked++;
          try {
            const record = await store.get(context, item.id);
            if (!record) throw new Error("Record disappeared while checking data");
            if ("data" in record && record.data.payload.contentType !== "application/json") throw new TypeError("Structured data checks require application/json Payloads");
            const value = "data" in record ? await new JsonPayloadSerializer().deserialize(context, checked.runtime!.descriptor, record.data.payload.content) : record.value;
            checked.runtime!.reflect(value);
          } catch (error) { result.failures.push({ id: item.id, message: error instanceof Error ? error.message : String(error) }); }
        }
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      data.push(result);
    }
  }
  await assertModelOperationStamp(root, stamp);
  if (data.some(store => store.failures.length)) throw serviceError("DATA_VALIDATION_FAILED", "Existing data does not satisfy model", { data, snapshot: false });
  return { operation: "model.validate", modelRef: ref, valid: true, checks: { definition: "passed", runtime: options.check === "definition" ? "not_checked" : "passed" }, ...(options.checkData ? { data, snapshot: false } : {}) };
}
