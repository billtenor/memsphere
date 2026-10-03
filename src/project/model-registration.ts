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
import { atomicWriteJson, withFileLock } from "../persistence.js";
import { validateModelStoragePaths, within } from "./model-storage-paths.js";
import {
  MODEL_REGISTRATION_MODEL, LEGACY_MODEL_REGISTRATION_MODEL, IMPORTED_MODEL_DEFINITIONS_STORE,
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
  const filename = join(systemRoot, "definitions/json-schema/draft-07", `${MODEL_REGISTRATION_MODEL}.json`);
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
export async function createModelRegistrationStore(context: Context, id: string, directory: string, binding = modelRegistrationBinding()): Promise<ValueStore> {
  const manager = new DefaultDataManager({ extensions: registry, models: [binding], stores: [{ id, model: MODEL_REGISTRATION_MODEL, kind: "ValueStore", factory: "memsphere/filesystem-json", config: new Config({ directory }) }] });
  const store = await manager.getStore(context, id) as ValueStore;
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
    const store = await createModelRegistrationStore(context, `${(input.modelRegistration ?? DEFAULT_MODEL_REGISTRATION_CONFIG).storeId}/${area}`, directory, bootstrap);
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
export function withModelRegistrationLock<T>(root: string, action: () => Promise<T>): Promise<T> { return withFileLock(resolve(root, ".runtime/settings.lock"), action); }
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
/** The entire explicit operation rolls back its writes, including legacy migration. Caller holds settings.lock. */
export async function initializeProjectModelRegistrations(context: Context, input: ProjectModelInput, options: ModelInitializationOptions = {}) {
  const initial = await readModelRegistrations(context, input);
  if (initial.diagnostics.length) throw new TypeError(`Damaged model registrations: ${initial.diagnostics.map(d => d.id).join(", ")}`);
  const { createProjectModelHost } = await import("./models.js");
  const host = await createProjectModelHost(context, input);
  const summaries = await host.list();
  for (const model of summaries) if (model.status !== "available") throw new TypeError(`Invalid model definition: ${model.id}: ${model.error}`);
  const legacy = summaries.find(model => model.id === LEGACY_MODEL_REGISTRATION_MODEL);
  if (legacy) {
    if (!isDeepStrictEqual((await host.definition(legacy.id)).definition, modelRegistrationSchema))
      throw new TypeError("Legacy model registration definition is not the confirmed preview; migration refused");
    for (const model of summaries) {
      if (model.id !== legacy.id && model.origin !== "system") migrateSchemaReferences((await host.definition(model.id)).source, model.id);
    }
  }
  const registrationRoot = initial.paths.registrationDirectory;
  const systemRoot = join(registrationRoot, "system");
  const mutations: InitializationMutation[] = [];
  const same = (left: Buffer | undefined, right: Buffer | undefined) => left === undefined ? right === undefined : right !== undefined && left.equals(right);
  const currentBytes = async (path: string) => await pathExists(path) ? await readFile(path) : undefined;
  const mutate: InitializationWriter = async (path, before, after, operation) => {
    if (!same(await currentBytes(path), before)) throw new Error(`Model initialization write conflict: ${path}`);
    // Record intent first: an atomic publisher can fail after committing its bytes.
    mutations.push({ path, before, after });
    await operation();
  };
  const createdRecord = (path: string, value: unknown) => mutations.push({ path, before: undefined, after: Buffer.from(`${JSON.stringify(value, null, 2)}\n`) });
  let installedSnapshot: Map<string, Buffer> | undefined;
  try {
    const { installBundledSystemModels } = await import("./system-models.js");
    const system = await installBundledSystemModels(context, input);
    if (system.status === "installed") installedSnapshot = await treeBytes(systemRoot);
    await options.afterSystemInstall?.();
    const result = await initializeProjectModelRegistrationsInner(context, input, mutate, createdRecord);
    await options.afterRegistrations?.();
    if (options.config && !isDeepStrictEqual(options.config.value.modelRegistration, result.config)) {
      const next = { ...options.config.value, modelRegistration: result.config };
      const before = await currentBytes(options.config.path);
      if (before && !isDeepStrictEqual(JSON.parse(before.toString("utf8")), options.config.value))
        throw new Error(`Model initialization configuration conflict: ${options.config.path}`);
      await mutate(options.config.path, before, Buffer.from(`${JSON.stringify(next, null, 2)}\n`), () => atomicWriteJson(options.config!.path, next));
    }
    return { ...result, system };
  } catch (error) {
    const failures: string[] = [];
    for (const mutation of [...mutations].reverse()) {
      try {
        const current = await currentBytes(mutation.path);
        if (same(current, mutation.before)) continue;
        if (!same(current, mutation.after)) {
          failures.push(`rollback conflict (newer content preserved): ${mutation.path}`);
          continue;
        }
        if (mutation.before === undefined) await rm(mutation.path, { force: true });
        else {
          const { atomicWriteFile } = await import("../persistence.js");
          await atomicWriteFile(mutation.path, mutation.before.toString("utf8"));
        }
      } catch (restoreError) { failures.push(`${mutation.path}: ${String(restoreError)}`); }
    }
    if (installedSnapshot) {
      try {
        const current = await treeBytes(systemRoot);
        if (!isDeepStrictEqual(current, installedSnapshot)) failures.push(`rollback conflict (changed system subtree preserved): ${systemRoot}`);
        else await rm(systemRoot, { recursive: true, force: true });
      } catch (restoreError) { failures.push(`${systemRoot}: ${String(restoreError)}`); }
    }
    if (failures.length) throw Object.assign(new AggregateError([error], `Model initialization failed; restore required: ${failures.join(", ")}`), { rollbackErrors: failures });
    throw error;
  }
}
type InitializationMutation = { path: string; before: Buffer | undefined; after: Buffer | undefined };
type InitializationWriter = (path: string, before: Buffer | undefined, after: Buffer | undefined, operation: () => Promise<unknown>) => Promise<void>;

/** Caller holds the same Project settings lock used for config publication. */
async function initializeProjectModelRegistrationsInner(context: Context, input: ProjectModelInput, mutate: InitializationWriter, createdRecord: (path: string, value: unknown) => unknown) {
  const initial = await readModelRegistrations(context, input);
  if (initial.diagnostics.length)
    throw new TypeError(`Damaged model registrations: ${initial.diagnostics.map(d => d.id).join(", ")}`);
  const { createProjectModelHost } = await import("./models.js");
  const legacyRecordBytes = new Map<string, Buffer>();
  for (const record of initial.records.filter(record => record.origin === "project" && record.registration.modelRef === LEGACY_MODEL_REGISTRATION_MODEL)) {
    legacyRecordBytes.set(record.id, await readFile(join(initial.paths.registrationDirectory, "project", `${record.id}.json`)));
  }
  let host = await createProjectModelHost(context, input);
  let backupPath: string | undefined;
  const legacy = (await host.list()).find(m => m.id === LEGACY_MODEL_REGISTRATION_MODEL);
  if (legacy) {
    const old = await host.definition(legacy.id);
    if (!isDeepStrictEqual(old.definition, modelRegistrationSchema))
      throw new TypeError("Legacy model registration definition is not the confirmed preview; migration refused");
    const rewrites: {
      id: string;
      source: string;
      replacement: string;
      origin: ModelOrigin;
    }[] = [];
    // Only schema reference tokens change; whitespace/BOM and unrelated strings remain intact.
    for (const summary of await host.list()) {
      if (summary.id === legacy.id || summary.builtin)
        continue;
      if (summary.status !== "available")
        throw new TypeError(`Cannot preflight model references: ${summary.id}`);
      const definition = await host.definition(summary.id);
      const replacement = migrateSchemaReferences(definition.source, summary.id);
      if (replacement !== definition.source)
        rewrites.push({ id: summary.id, source: definition.source, replacement, origin: definition.origin });
    }
    const filename = join(initial.paths.modelsDirectory, LEGACY_MODEL_REGISTRATION_MODEL);
    const backupRoot = join(initial.paths.backupDirectory, randomUUID());
    await mkdir(backupRoot, { recursive: true });
    backupPath = join(backupRoot, "model-registration.json");
    const bytes = await readFile(filename);
    await writeFile(backupPath, bytes, { flag: "wx" });
    if (!(await readFile(backupPath)).equals(bytes))
      throw new Error("Preview backup verification failed");
    const references: {
      modelRef: string;
      backupPath: string;
    }[] = [];
    for (const rewrite of rewrites) {
      const path = join(backupRoot, "references", rewrite.origin, rewrite.id);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(rewrite.source), { flag: "wx" });
      if (!(await readFile(path)).equals(Buffer.from(rewrite.source)))
        throw new Error(`Reference backup verification failed: ${rewrite.id}`);
      references.push({ modelRef: rewrite.id, backupPath: path });
    }
    await atomicWriteJson(join(backupRoot, "migration-receipt.json"), { oldRef: LEGACY_MODEL_REGISTRATION_MODEL, newRef: MODEL_REGISTRATION_MODEL, originalPath: filename, backupPath, references });
    for (const rewrite of rewrites) {
      const store = rewrite.origin === "market" ? await host.manager.getStore(context, IMPORTED_MODEL_DEFINITIONS_STORE) : host.store;
      if (store.kind !== "DataStore") throw new TypeError("Model references require a DataStore");
      const root = rewrite.origin === "market" ? join(initial.paths.registrationDirectory, "imported-definitions") : initial.paths.modelsDirectory;
      await mutate(join(root, rewrite.id), Buffer.from(rewrite.source), Buffer.from(rewrite.replacement), () => store.update(context, {
        id: rewrite.id, model: JSON_SCHEMA_DRAFT_07, payload: { contentType: "application/json", content: bytesContent(Buffer.from(rewrite.replacement)) }
      }));
    }
    await mutate(filename, Buffer.from(old.source), undefined, () => rm(filename));
    for (const r of initial.records.filter(r => r.registration.modelRef === LEGACY_MODEL_REGISTRATION_MODEL)) {
      const store = await createModelRegistrationStore(context, `${(input.modelRegistration ?? DEFAULT_MODEL_REGISTRATION_CONFIG).storeId}/project`, join(initial.paths.registrationDirectory, "project"));
      await mutate(join(initial.paths.registrationDirectory, "project", `${r.id}.json`), legacyRecordBytes.get(r.id), undefined, () => store.delete(context, r.id));
    }
    host = await createProjectModelHost(context, input);
  }
  const existing = await readModelRegistrations(context, input);
  const store = await createModelRegistrationStore(context, `${(input.modelRegistration ?? DEFAULT_MODEL_REGISTRATION_CONFIG).storeId}/project`, join(existing.paths.registrationDirectory, "project"));
  let created = 0, retained = 0;
  for (const summary of await host.list()) {
    if (summary.builtin)
      continue;
    if (summary.status !== "available")
      throw new TypeError(`Invalid model definition: ${summary.id}: ${summary.error}`);
    if (existing.records.some(r => r.registration.modelRef === summary.id)) {
      retained++;
      continue;
    }
    const definition = await host.definition(summary.id);
    const seed = confirmedSeedDefinitions[summary.id];
    // Seed only the exact approved example asset, never unrelated models sharing an ID.
    let seedMatches = false;
    try {
      seedMatches = !!seed && createHash("sha256").update(JSON.stringify(definition.definition)).digest("hex") === seed.hash;
    }
    catch { }
    const registration: ModelRegistration = seedMatches ? structuredClone(seed!.registration) : { modelRef: summary.id, storage: "store", store_id: "models/json-schema/draft-07", ...(summary.title ? { name: summary.title } : {}), ...(summary.description !== undefined ? { description: summary.description } : {}) };
    validateModelRegistration(registration);
    const record = await store.create(context, randomUUID(), registration);
    createdRecord(join(existing.paths.registrationDirectory, "project", `${record.id}.json`), record);
    created++;
  }
  if (!existing.initialized) {
    const value = { initializedAt: new Date().toISOString() };
    const path = join(existing.paths.registrationDirectory, "initialized.json");
    await mutate(path, undefined, Buffer.from(`${JSON.stringify(value, null, 2)}\n`), () => atomicWriteJson(path, value));
  }
  return { created, retained, diagnostics: existing.diagnostics, config: input.modelRegistration ?? structuredClone(DEFAULT_MODEL_REGISTRATION_CONFIG), ...(backupPath ? { backupPath } : {}) };
}
/** Edit only schema $ref string tokens, preserving the original bytes everywhere else. */
function migrateSchemaReferences(source:string,modelRef:string):string {
  const tokens=[...source.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)];
  const edits:{start:number;end:number;text:string}[]=[];
  let position=0,uriBase=false;
  type Mode="schema"|"map"|"array"|"annotation";
  const schemaChildren=new Set(["items","additionalProperties","additionalItems","contains","not","if","then","else","propertyNames"]);
  const schemaMaps=new Set(["properties","definitions","patternProperties","$defs"]);
  const schemaArrays=new Set(["allOf","anyOf","oneOf"]);
  const visit=(mode:Mode):void=>{
    const token=tokens[position++]!;
    if(token[0]==="{"){
      while(tokens[position]?.[0]!=="}"){
        const key=JSON.parse(tokens[position++]![0]) as string;position++; // colon
        const child=tokens[position]!;
        if(mode==="schema"&&key==="$id"&&child[0].startsWith('"')&&URL.canParse(JSON.parse(child[0])))uriBase=true;
        if(mode==="schema"&&key==="$ref"&&child[0].startsWith('"')){
          const ref=JSON.parse(child[0]) as string;
          if(ref===LEGACY_MODEL_REGISTRATION_MODEL||ref.startsWith(`${LEGACY_MODEL_REGISTRATION_MODEL}#`))edits.push({start:child.index!,end:child.index!+child[0].length,text:JSON.stringify(MODEL_REGISTRATION_MODEL+ref.slice(LEGACY_MODEL_REGISTRATION_MODEL.length))});
        }
        const nextMode:Mode=mode==="map"?"schema":mode!=="schema"?"annotation":schemaMaps.has(key)?"map":schemaArrays.has(key)?"array":schemaChildren.has(key)?"schema":"annotation";
        visit(nextMode);
        if(tokens[position]?.[0]===",")position++;
      }
      position++;
    }else if(token[0]==="["){
      while(tokens[position]?.[0]!=="]"){
        visit(mode==="array"||mode==="schema"?"schema":"annotation");
        if(tokens[position]?.[0]===",")position++;
      }
      position++;
    }
  };
  visit("schema");
  if(edits.length&&uriBase)throw new TypeError(`Cannot migrate URI-based legacy reference: ${modelRef}`);
  let result=source;
  for(const edit of edits.reverse())result=result.slice(0,edit.start)+edit.text+result.slice(edit.end);
  return result;
}
