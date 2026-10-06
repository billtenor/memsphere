import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Context } from "../data/api/context.js";
import type { ValueStore } from "../data/api/value-store.js";
import { Config } from "../data/api/config.js";
import { filesystemJsonValueStoreExtension, jsonSchemaExtension, jsonSchemaMetaModelExtension, jsonSerializerExtension, JSON_SCHEMA_DRAFT_07 } from "../data/extensions/index.js";
import { bytesContent, readAll } from "../data/extensions/shared/payload.js";
import { DefaultDataManager } from "../data/management/data-manager.js";
import { DefaultDataExtensionRegistry } from "../data/management/extension-registry.js";
import { atomicWriteJson } from "../persistence.js";
import { commitModelOperation, optionalFileBytes, recoverModelOperation, withProjectModelWrite, type ModelFileChange } from "./model-operation.js";
import { checkModelDefinition } from "./model-validation.js";
import { discoverModelIds, assertModelPath } from "./model-storage-paths.js";
import { RAW_MODEL } from "../data/extensions/raw/index.js";
import { FilesystemJsonValueStoreFactory, assertRecord } from "../data/extensions/filesystem-json-valuestore/index.js";
import { validateModelStoragePaths, within } from "./model-storage-paths.js";
import {
  MODEL_REGISTRATION_MODEL, MODEL_ID_UPGRADES, IMPORTED_MODEL_DEFINITIONS_STORE,
  DEFAULT_MODEL_REGISTRATION_CONFIG, SYSTEM_JSON_SCHEMA_MODELS_STORE,
  validateModelRegistration, type ModelOrigin, type ModelRegistration, type ModelRegistrationConfig, type ProjectModelInput
} from "./model-registration-contract.js";
import { readBundledSystemModels } from "../reserved/models.js";
import { modelDefinitionStore } from "./system-model-store.js";
import { validateJsonSchemaDefinition } from "../data/extensions/json-schema-metamodel/index.js";
export * from "./model-registration-contract.js";
export const modelRegistrationSchema = readBundledSystemModels().find(model => model.registration.modelRef === MODEL_REGISTRATION_MODEL)!.definition;
export function modelRegistrationBinding(definition = modelRegistrationSchema, source = JSON.stringify(definition)) {
  return { model: { data: { id: MODEL_REGISTRATION_MODEL, model: JSON_SCHEMA_DRAFT_07,
    payload: { contentType: "application/json", content: bytesContent(Buffer.from(source)) } }, definition } };
}
async function registrationBootstrap(context: Context, directory: string) {
  const systemRoot = join(directory, "system");
  if (!await pathExists(systemRoot)) return modelRegistrationBinding();
  const filename = join(systemRoot, "definitions/json-schema/draft-07", MODEL_REGISTRATION_MODEL);
  let source: string;
  try {
    const store = modelDefinitionStore(SYSTEM_JSON_SCHEMA_MODELS_STORE, JSON_SCHEMA_DRAFT_07, join(systemRoot, "definitions/json-schema/draft-07"), true);
    const stored = await store.get(context, MODEL_REGISTRATION_MODEL);
    if (!stored) throw new Error("Missing definition");
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readAll(context, stored.data.payload.content));
  }
  catch (error) { throw new TypeError(`Installed system registration definition is missing: ${filename}`, { cause: error }); }
  let definition: unknown;
  try { definition = JSON.parse(source.replace(/^\uFEFF/, "")); }
  catch (error) { throw new TypeError(`Installed system registration definition is damaged: ${filename}`, { cause: error }); }
  validateJsonSchemaDefinition(definition);
  return modelRegistrationBinding(definition, source);
}
const registry = new DefaultDataExtensionRegistry([filesystemJsonValueStoreExtension, jsonSchemaExtension, jsonSchemaMetaModelExtension, jsonSerializerExtension]);
export async function createModelRegistrationStore(context: Context, id: string, directory: string, binding = modelRegistrationBinding(), readOnly = false): Promise<ValueStore> {
  const manager = new DefaultDataManager({ extensions: registry, models: [binding], stores: [{ id, model: MODEL_REGISTRATION_MODEL, kind: "ValueStore", factory: "memsphere/filesystem-json", config: new Config({ directory }) }] });
  const store = readOnly
    ? await new FilesystemJsonValueStoreFactory().openExisting(context, id, await manager.getRuntime(context, MODEL_REGISTRATION_MODEL), new Config({ directory }))
    : await manager.getStore(context, id) as ValueStore;
  return {
    id: store.id, kind: store.kind, model: store.model,
    list: store.list.bind(store), has: store.has.bind(store), delete: store.delete.bind(store),
    async get(ctx, recordId) { const record = await store.get(ctx, recordId); if (record)
      validateModelRegistration(record.value); return record; },
    async create(ctx, recordId, value) { validateModelRegistration(value); return store.create(ctx, recordId, value); },
    async update(ctx, recordId, value, options) { validateModelRegistration(value); return store.update(ctx, recordId, value, options); }
  };
}
export type RegistrationRecord = {
  id: string;
  registration: ModelRegistration;
  origin: ModelOrigin;
};
export type RegistrationDiagnostic = {
  id: string;
  message: string;
  origin: ModelOrigin;
  modelRef?: string;
};
export async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}
export async function readModelRegistrations(context: Context, input: ProjectModelInput) {
  const paths = await validateModelStoragePaths(input);
  const records: RegistrationRecord[] = [];
  const diagnostics: RegistrationDiagnostic[] = [];
  const initialized = await pathExists(join(paths.registrationDirectory, "initialized.json"));
  const publishedPath = join(paths.registrationDirectory, "published-imports.json");
  const publishedIds = new Set<string>();
  if (await pathExists(publishedPath)) {
    const published: unknown = JSON.parse(await readFile(publishedPath, "utf8"));
    if (!published || typeof published !== "object" || !("recordIds" in published) || !Array.isArray(published.recordIds) || published.recordIds.some(id => typeof id !== "string"))
      throw new TypeError("Invalid model import publication state");
    for (const id of published.recordIds)
      publishedIds.add(id);
  }
  const bootstrap = await registrationBootstrap(context, paths.registrationDirectory);
  if (await pathExists(join(paths.registrationDirectory, "system")) && !await pathExists(join(paths.registrationDirectory, "system/registrations")))
    throw new TypeError("Installed system model registrations are missing");
  for (const area of ["project", "imported", "system"] as const) {
    const directory = join(paths.registrationDirectory, area === "system" ? "system/registrations" : area);
    if (!await pathExists(directory))
      continue;
    const store = await createModelRegistrationStore(context, `${(input.modelRegistration ?? DEFAULT_MODEL_REGISTRATION_CONFIG).storeId}/${area}`, directory, bootstrap, true);
    let cursor: string | undefined;
    do {
      const page = await store.list(context, { limit: 1000, ...(cursor ? { cursor } : {}) });
      cursor = page.nextCursor;
      for (const item of page.items) {
        if (area === "imported" && !publishedIds.has(item.id))
          continue;
        try {
          const record = await store.get(context, item.id);
          if (!record)
            continue;
          validateModelRegistration(record.value);
          records.push({ id: item.id, registration: record.value, origin: area === "system" ? "system" : area === "project" ? "project" : "market" });
        }
        catch (error) {
          context.signal?.throwIfAborted();
          if (!(error instanceof TypeError) && !(error instanceof SyntaxError))
            throw error;
          diagnostics.push({ id: item.id, origin: area === "system" ? "system" : area === "project" ? "project" : "market", message: error.message });
        }
      }
    } while (cursor !== undefined);
  }
  if (await pathExists(join(paths.registrationDirectory, "system"))) {
    const expected = new Set(readBundledSystemModels().map(model => model.registration.modelRef));
    const registered = new Set(records.filter(record => record.origin === "system").map(record => record.registration.modelRef));
    for (const modelRef of expected) if (!registered.has(modelRef)) diagnostics.push({ id: `system/${modelRef}`, modelRef, origin: "system", message: `Installed system model registration is missing: ${modelRef}` });
    for (const modelRef of registered) if (!expected.has(modelRef)) diagnostics.push({ id: `system/${modelRef}`, modelRef, origin: "system", message: `Unexpected system model registration: ${modelRef}` });
  }
  const duplicates = new Set<string>();
  const seen = new Map<string, RegistrationRecord>();
  const packages = new Map<string, string>();
  for (const r of records) {
    if (seen.has(r.registration.modelRef))
      duplicates.add(r.registration.modelRef);
    else
      seen.set(r.registration.modelRef, r);
    const v = r.registration;
    if (v.package && v.package_name) {
      if (packages.has(v.package) && packages.get(v.package) !== v.package_name)
        diagnostics.push({ id: r.id, origin: r.origin, message: `Inconsistent package_name for ${v.package}` });
      else
        packages.set(v.package, v.package_name);
    }
  }
  for (const ref of duplicates) {
    for (const r of records.filter(r => r.registration.modelRef === ref))
      diagnostics.push({ id: r.id, origin: r.origin, message: `Duplicate modelRef: ${ref}`, modelRef: ref });
  }
  return { records: records.filter(r => !duplicates.has(r.registration.modelRef)), diagnostics, initialized, paths };
}
export function withModelRegistrationLock<T>(root: string, action: () => Promise<T>): Promise<T> { return withProjectModelWrite(root, action); }
export async function prepareModelRegistrationMigration(context: Context, input: ProjectModelInput, target: ModelRegistrationConfig, options: {
  migrate?: boolean;
} = {}) {
  const old = await readModelRegistrations(context, input);
  const next = await validateModelStoragePaths({ ...input, modelRegistration: target });
  const changed = old.paths.registrationDirectory !== next.registrationDirectory || (input.modelRegistration ?? DEFAULT_MODEL_REGISTRATION_CONFIG).storeId !== target.storeId;
  const hasData = old.initialized || old.records.length > 0 || old.diagnostics.length > 0 || await pathExists(join(old.paths.registrationDirectory, "imported-definitions"));
  if (!changed || !hasData)
    return { migrated: false, oldDirectory: old.paths.registrationDirectory, targetDirectory: next.registrationDirectory, excludedDirectories: target.excludedDirectories ?? [] };
  if (!options.migrate)
    throw Object.assign(new Error("Changing model registration storage requires explicit migration"), { code: "MODEL_REGISTRATION_MIGRATION_REQUIRED" });
  if (old.diagnostics.length)
    throw new TypeError(`Cannot migrate damaged registrations: ${old.diagnostics.map(d => d.id).join(", ")}`);
  if (old.paths.registrationDirectory === next.registrationDirectory)
    return { migrated: true, oldDirectory: old.paths.registrationDirectory, targetDirectory: next.registrationDirectory, excludedDirectories: target.excludedDirectories ?? [] };
  if (within(next.registrationDirectory, old.paths.registrationDirectory) || within(old.paths.registrationDirectory, next.registrationDirectory))
    throw new TypeError("Source and target registration directories overlap");
  const { createProjectModelHost } = await import("./models.js");
  const sourceHost = await createProjectModelHost(context, input);
  for (const record of old.records)
    await sourceHost.definition(record.registration.modelRef);
  const targetRead = await readModelRegistrations(context, { ...input, modelRegistration: target });
  if (targetRead.diagnostics.length)
    throw new TypeError("Target registration records are damaged");
  for (const record of targetRead.records) {
    const source = old.records.find(r => r.registration.modelRef === record.registration.modelRef);
    if (!source || source.origin !== record.origin || !isDeepStrictEqual(source.registration, record.registration))
      throw new TypeError(`Target registration conflict: ${record.registration.modelRef}`);
  }
  // Stage a verified byte-for-byte tree. Target publication never alters the original root.
  const stage = join(dirname(next.registrationDirectory), `.memsphere-migration-${randomUUID()}`);
  try {
    await copyVerifiedTree(context, old.paths.registrationDirectory, stage);
    if (await pathExists(next.registrationDirectory)) {
      const oldFiles = await treeBytes(old.paths.registrationDirectory);
      const targetFiles = await treeBytes(next.registrationDirectory);
      for (const [key, bytes] of targetFiles) {
        if (!oldFiles.get(key)?.equals(bytes))
          throw new TypeError(`Target storage conflict: ${key}`);
      }
      // A nonempty identical root is already a valid target; a subset cannot be published by overwriting it.
      if (targetFiles.size && targetFiles.size !== oldFiles.size)
        throw new TypeError("Target storage is incomplete; choose an empty target directory");
      if (!targetFiles.size)
        await rm(next.registrationDirectory, { recursive: true });
      else {
        await rm(stage, { recursive: true });
        return { migrated: true, oldDirectory: old.paths.registrationDirectory, targetDirectory: next.registrationDirectory, excludedDirectories: [...new Set([...(target.excludedDirectories ?? []), old.paths.registrationDirectory])] };
      }
    }
    await mkdir(dirname(next.registrationDirectory), { recursive: true });
    await rename(stage, next.registrationDirectory);
    const verified = await readModelRegistrations(context, { ...input, modelRegistration: target });
    if (verified.diagnostics.length || verified.records.length !== old.records.length)
      throw new Error("Migration registration verification failed");
    return { migrated: true, oldDirectory: old.paths.registrationDirectory, targetDirectory: next.registrationDirectory, excludedDirectories: [...new Set([...(target.excludedDirectories ?? []), old.paths.registrationDirectory])] };
  }
  catch (error) {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
async function treeBytes(root: string): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  if (!await pathExists(root))
    return result;
  const visit = async (dir: string, prefix: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const key = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isSymbolicLink())
        throw new TypeError(`Symlink in registration storage: ${key}`);
      if (e.isDirectory())
        await visit(join(dir, e.name), key);
      else if (e.isFile())
        result.set(key, await readFile(join(dir, e.name)));
    }
  };
  await visit(root, "");
  return result;
}
async function copyVerifiedTree(context: Context, source: string, target: string) {
  const files = await treeBytes(source);
  await mkdir(target, { recursive: true });
  for (const [key, bytes] of files) {
    context.signal?.throwIfAborted();
    const path = join(target, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: "wx" });
    if (!(await readFile(path)).equals(bytes))
      throw new Error(`Migration byte verification failed: ${key}`);
  }
}
const confirmedSeedDefinitions: Record<string, {
  hash: string;
  registration: ModelRegistration;
}> = {
  "examples/01-basic-types.json": {
    "hash": "188bcf42155b53f8a1b9c43cbe1b0fd9ac89f5cba687a69801a4bb185fc558af",
    "registration": {
      "modelRef": "examples/01-basic-types.json",
      "name": "用例 01 · 基本类型与枚举",
      "tags": [
        "example",
        "json-schema"
      ],
      "description": "覆盖 JSON Schema 的全部基本类型、整数子类型、字符串/数字枚举、必填/可选、空容器。",
      "store_id": "models/json-schema/draft-07",
      "storage": "store"
    }
  },
  "examples/02-nested-order.json": {
    "hash": "58327b7c1dd1894688aea66c998d678bb8560f9b98fe8c1bc7e97295f22aafe2",
    "registration": {
      "modelRef": "examples/02-nested-order.json",
      "name": "用例 02 · 订单与深层嵌套",
      "tags": [
        "example",
        "json-schema"
      ],
      "description": "对象套对象、对象套数组、数组套对象；订单、明细、规格、价格与收货信息的多级结构。",
      "package": "memsphere.examples.orders",
      "store_id": "models/json-schema/draft-07",
      "package_name": "订单示例",
      "storage": "store"
    }
  },
  "examples/03-array-root.json": {
    "hash": "0fd8afff02b5ed3a03bcb9097e2efae013b31c11c230ad993ec83658bf1caa18",
    "registration": {
      "modelRef": "examples/03-array-root.json",
      "name": "用例 03 · 根数组与多维数组",
      "tags": [
        "example",
        "json-schema"
      ],
      "description": "根值不是对象而是数组；包含数组套数组、数组套对象、嵌套枚举数组。",
      "store_id": "models/json-schema/draft-07",
      "storage": "store"
    }
  },
  "examples/04-dictionaries-and-encodings.json": {
    "hash": "7df33c1d6953e9bc668fc633f39b08b933c6e7954882a58a7c99794b855372db",
    "registration": {
      "modelRef": "examples/04-dictionaries-and-encodings.json",
      "name": "用例 04 · 字典与特殊类型映射",
      "tags": [
        "example",
        "json-schema"
      ],
      "description": "动态键字典以及 bigint/bytes 的 JSON 表示示例；它们不是原生 Map、bigint、Uint8Array 的反射声明。",
      "store_id": "models/json-schema/draft-07",
      "storage": "store"
    }
  },
  "examples/05-unions-and-conditions.json": {
    "hash": "88e8e07d1343b78bbc87dbab2a4756bdd67967fd1e504d718c6ea8226a0313be",
    "registration": {
      "modelRef": "examples/05-unions-and-conditions.json",
      "name": "用例 05 · 联合与条件展示边界",
      "tags": [
        "example",
        "json-schema"
      ],
      "description": "合法 Draft-07 的联合、组合、条件、布尔子模式；用于检查展示边界，不承诺现有业务 Runtime 支持这些特性。",
      "store_id": "models/json-schema/draft-07",
      "storage": "store"
    }
  },
  "examples/06-references-and-recursion.json": {
    "hash": "12658014955e3a1613e4ff98d28ac69ddf497826f8336c24487628f2436f23e2",
    "registration": {
      "modelRef": "examples/06-references-and-recursion.json",
      "name": "用例 06 · 引用与递归",
      "tags": [
        "example",
        "json-schema"
      ],
      "description": "本地 definitions 复用、递归树与精确文件 ModelRef；当前树表显示引用提示，引用目标查看原文，不无限展开。",
      "store_id": "models/json-schema/draft-07",
      "storage": "store"
    }
  },
  "examples/07-scalar-enum-root.json": {
    "hash": "33740aa3503cc8a4469f5affb8f831d2d818c4ca455006705b7b9a1594e78241",
    "registration": {
      "modelRef": "examples/07-scalar-enum-root.json",
      "name": "用例 07 · 标量枚举根",
      "tags": [
        "example",
        "json-schema"
      ],
      "description": "整个模型就是一个字符串枚举，没有对象字段。",
      "store_id": "models/json-schema/draft-07",
      "storage": "store"
    }
  },
  "examples/08-numeric-enum-root.json": {
    "hash": "408c31fd323664cbceaaa80be03f0c21b76fa213ce4e439989059225c0f58553",
    "registration": {
      "modelRef": "examples/08-numeric-enum-root.json",
      "name": "用例 08 · 数字枚举根",
      "tags": [
        "example",
        "json-schema"
      ],
      "description": "整数作为根值；数值枚举成员，不把数字转换为字符串。",
      "store_id": "models/json-schema/draft-07",
      "storage": "store"
    }
  }
};
export type ModelInitializationOptions = {
  config?: { path: string; value: Record<string, unknown> };
  afterSystemInstall?: () => Promise<void>;
  afterRegistrations?: () => Promise<void>;
};
/** Caller owns Project settings lock (or an unpublished Project staging root). */
export async function initializeProjectModelRegistrations(context: Context, input: ProjectModelInput, options: ModelInitializationOptions = {}) {
  await recoverModelOperation(input.root);
  const paths = await validateModelStoragePaths(input);
  const root = paths.registrationDirectory;
  const systemRoot = join(root, "system");
  const changes: ModelFileChange[] = [];
  const records: Array<{ id: string; registration: ModelRegistration; origin: ModelOrigin; path: string }> = [];
  const upgrade = (ref: string) => MODEL_ID_UPGRADES[ref] ?? (ref.endsWith(".json") ? ref : `${ref}.json`);
  const jsonBytes = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const put = async (path: string, after: Buffer) => {
    const before = await optionalFileBytes(path);
    if (!before?.equals(after)) changes.push({ path, before, after });
  };
  const publicationPath = join(root, "published-imports.json");
  const publicationBytes = await optionalFileBytes(publicationPath);
  const published = publicationBytes ? JSON.parse(publicationBytes.toString("utf8")) as { recordIds: string[] } : { recordIds: [] };
  if (!Array.isArray(published.recordIds) || published.recordIds.some(id => typeof id !== "string")) throw new TypeError("Invalid model publication state");
  const seen = new Set<string>();
  for (const [area, origin] of [["project", "project"], ["imported", "market"], ["system/registrations", "system"]] as const) {
    const directory = join(root, area);
    for (const [filename, bytes] of await treeBytes(directory)) {
      if (filename.startsWith(".memsphere-")) continue;
      if (!filename.endsWith(".json") || filename.includes("/")) throw new TypeError(`Unknown registration file: ${filename}`);
      const path = join(directory, filename);
      let envelope: { id: string; revision: number; value: ModelRegistration; createdAt: number; updatedAt: number };
      try { envelope = JSON.parse(bytes.toString("utf8")); }
      catch (cause) { throw Object.assign(new TypeError(`Damaged model registration: ${path}`, { cause }), { code: "MODEL_REGISTRATION_INVALID", details: { file: path } }); }
      assertRecord(envelope, filename.slice(0, -5));
      if (!envelope.value || typeof envelope.value.modelRef !== "string")
        throw new TypeError(`Damaged registration: ${path}`);
      if (origin === "market" && !published.recordIds.includes(envelope.id)) throw new TypeError(`Unpublished registration requires cleanup: ${path}`);
      const registration = { ...envelope.value, modelRef: upgrade(envelope.value.modelRef) };
      validateModelRegistration(registration);
      if (seen.has(registration.modelRef)) throw new TypeError(`Model identity conflict: ${registration.modelRef}`);
      seen.add(registration.modelRef);
      if (!isDeepStrictEqual(registration, envelope.value)) {
        if (envelope.revision === Number.MAX_SAFE_INTEGER) throw new TypeError(`Revision overflow: ${path}`);
        await put(path, jsonBytes({ ...envelope, revision: envelope.revision + 1, updatedAt: Date.now(), value: registration }));
      }
      records.push({ id: envelope.id, registration, origin, path });
    }
  }
  const bundled = readBundledSystemModels();
  const installed = await pathExists(systemRoot);
  let systemCreated = 0;
  for (const model of bundled) {
    await checkModelDefinition(context, { modelRef: model.registration.modelRef, ...model });
    const raw = model.metaModel === RAW_MODEL;
    const definitionPath = join(systemRoot, "definitions", raw ? "raw" : "json-schema/draft-07", model.registration.modelRef);
    const saved = await optionalFileBytes(definitionPath);
    const existing = records.find(record => record.registration.modelRef === model.registration.modelRef);
    if (existing && existing.origin !== "system") throw new TypeError(`System model identity conflict: ${model.registration.modelRef}`);
    if (installed) {
      if (!existing || !saved) throw new TypeError(`Installed system model is missing: ${model.registration.modelRef}`);
      const definition = JSON.parse(saved.toString("utf8").replace(/^\uFEFF/, ""));
      const upgradeIdentityFields = (value: unknown): void => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) { value.forEach(upgradeIdentityFields); return; }
        const item = value as Record<string, unknown>;
        for (const key of ["$id", "modelRef", "model"]) if (typeof item[key] === "string" && MODEL_ID_UPGRADES[item[key]]) item[key] = MODEL_ID_UPGRADES[item[key]];
        Object.values(item).forEach(upgradeIdentityFields);
      };
      upgradeIdentityFields(definition);
      if (!isDeepStrictEqual(definition, model.definition) || existing.registration.store_id !== model.registration.store_id || existing.registration.package !== model.registration.package)
        throw new TypeError(`Installed system model conflicts: ${model.registration.modelRef}`);
      if (!isDeepStrictEqual(JSON.parse(saved.toString("utf8").replace(/^\uFEFF/, "")), definition)) await put(definitionPath, Buffer.from(model.source));
    } else {
      if (existing || saved) throw new TypeError(`System model identity conflict: ${model.registration.modelRef}`);
      await put(definitionPath, Buffer.from(model.source));
      const id = randomUUID();
      await put(join(systemRoot, "registrations", `${id}.json`), jsonBytes({ id, revision: 1, createdAt: Date.now(), updatedAt: Date.now(), value: model.registration }));
      systemCreated++;
    }
  }
  if (records.filter(record => record.origin === "system").length !== (installed ? bundled.length : 0)) throw new TypeError("Unexpected system model registrations");
  const systemEnd = changes.length;
  let created = 0, retained = 0;
  for (const [directory, origin, storeId] of [[paths.modelsDirectory, "project", "models/json-schema/draft-07"], [join(root, "imported-definitions"), "market", IMPORTED_MODEL_DEFINITIONS_STORE]] as const) {
    for (const id of await discoverModelIds(context, directory, origin === "project" ? paths.excludedDirectories : [])) {
      await assertModelPath(directory, id, origin === "project" ? paths.excludedDirectories : []);
      const source = (await readFile(join(directory, id))).toString("utf8");
      const definition: unknown = JSON.parse(source.replace(/^\uFEFF/, ""));
      await checkModelDefinition(context, { modelRef: id, definition, source }, "definition");
      if (bundled.some(model => model.registration.modelRef === id)) throw new TypeError(`System model identity conflict: ${id}`);
      const existing = records.find(record => record.registration.modelRef === id);
      if (existing) {
        if (existing.origin !== origin || existing.registration.store_id !== storeId) throw new TypeError(`Model binding conflict: ${id}`);
        retained++;
      } else {
        if (origin === "market") throw new TypeError(`Imported model has no published registration: ${id}`);
        const value = definition as Record<string, unknown>;
        const registration: ModelRegistration = { modelRef: id, storage: "store", store_id: storeId,
          ...(typeof value.title === "string" && value.title.trim() ? { name: value.title } : {}),
          ...(typeof value.description === "string" ? { description: value.description } : {}) };
        const seed = confirmedSeedDefinitions[id];
        if (seed && createHash("sha256").update(JSON.stringify(definition)).digest("hex") === seed.hash) Object.assign(registration, structuredClone(seed.registration));
        validateModelRegistration(registration);
        const recordId = randomUUID();
        await put(join(root, "project", `${recordId}.json`), jsonBytes({ id: recordId, revision: 1, createdAt: Date.now(), updatedAt: Date.now(), value: registration }));
        created++;
      }
    }
  }
  for (const record of records.filter(record => record.origin !== "system")) {
    const directory = record.origin === "market" ? join(root, "imported-definitions") : paths.modelsDirectory;
    if (!await optionalFileBytes(join(directory, record.registration.modelRef))) throw new TypeError(`Registration definition missing: ${record.registration.modelRef}`);
  }
  const marker = join(root, "initialized.json");
  if (!await optionalFileBytes(marker)) await put(marker, jsonBytes({ initializedAt: new Date().toISOString() }));
  const config = input.modelRegistration ?? structuredClone(DEFAULT_MODEL_REGISTRATION_CONFIG);
  if (options.config) {
    const before = await optionalFileBytes(options.config.path);
    if (before && !isDeepStrictEqual(JSON.parse(before.toString("utf8")), options.config.value)) throw new Error("Model initialization configuration conflict");
    const next = structuredClone(options.config.value);
    next.modelRegistration = config;
    if (next.dataStores && typeof next.dataStores === "object") for (const binding of Object.values(next.dataStores as Record<string, { model: string }>)) {
      if (typeof binding.model !== "string") throw new TypeError("Invalid business Store model binding");
      binding.model = upgrade(binding.model);
    }
    if (!isDeepStrictEqual(next, options.config.value)) await put(options.config.path, jsonBytes(next));
  }
  let systemHookCalled = false;
  await commitModelOperation(input.root, "initialize", changes, {
    afterPending: async () => { if (systemEnd === 0) { await options.afterSystemInstall?.(); systemHookCalled = true; } },
    afterFile: async index => {
      if (index + 1 === systemEnd && !systemHookCalled) { await options.afterSystemInstall?.(); systemHookCalled = true; }
      if (index + 1 === changes.length) await options.afterRegistrations?.();
    }
  });
  if (!changes.length) { await options.afterSystemInstall?.(); await options.afterRegistrations?.(); }
  return { created, retained, diagnostics: [], config,
    system: { status: installed ? "unchanged" as const : "installed" as const, created: systemCreated, retained: installed ? bundled.length : 0 } };
}
