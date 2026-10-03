import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Context } from "../data/api/context.js";
import type { ValueStore } from "../data/api/value-store.js";
import { Config } from "../data/api/config.js";
import { filesystemJsonValueStoreExtension, jsonSchemaExtension, jsonSchemaMetaModelExtension, jsonSerializerExtension, JSON_SCHEMA_DRAFT_07 } from "../data/extensions/index.js";
import { bytesContent } from "../data/extensions/shared/payload.js";
import { DefaultDataManager } from "../data/management/data-manager.js";
import { DefaultDataExtensionRegistry } from "../data/management/extension-registry.js";
import { atomicWriteJson, withFileLock } from "../persistence.js";
import { validateModelStoragePaths, within } from "./model-storage-paths.js";
export const MODEL_REGISTRATION_MODEL = "memsphere/model-registration";
export const LEGACY_MODEL_REGISTRATION_MODEL = "memsphere/model-registration.json";
export const IMPORTED_MODEL_DEFINITIONS_STORE = "models/imported/json-schema/draft-07";
export type ModelOrigin = "project" | "system" | "market";
export type ModelRegistration = {
  modelRef: string;
  name?: string;
  description?: string;
  package?: string;
  package_name?: string;
  tags?: string[];
  storage: "builtin" | "store";
  store_id?: string;
};
export type ModelRegistrationConfig = {
  storeId: string;
  stores: Record<string, {
    factory: "memsphere/filesystem-json";
    directory: string;
  }>;
  excludedDirectories?: string[];
};
export type ProjectModelInput = {
  root: string;
  modelsDirectory?: string;
  modelRegistration?: ModelRegistrationConfig;
};
export const DEFAULT_MODEL_REGISTRATION_CONFIG: ModelRegistrationConfig = { storeId: "memsphere/model-registrations", stores: { "memsphere/model-registrations": { factory: "memsphere/filesystem-json", directory: "models/registrations" } } };
export const modelRegistrationSchema = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "模型登记",
  "description": "管理模型的名称、说明、所属包、包名称、标签与模型存储方式。代码内置定义由系统直接提供；持久化定义通过存储 ID 与模型 ID 读取。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "modelRef",
    "storage"
  ],
  "properties": {
    "modelRef": {
      "type": "string",
      "minLength": 1,
      "pattern": "\\S",
      "description": "模型的稳定 ID，与 Runtime 使用的 ModelRef 一致；读取模型定义时也以此值作为 Store 内的记录 ID。项目内不得重复登记。"
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "pattern": "\\S",
      "description": "管理侧显示名称。未设置时使用模型定义中的 title；定义没有 title 时使用 modelRef。"
    },
    "description": {
      "type": "string",
      "description": "管理侧说明。未设置时使用模型定义中的 description；显式空字符串表示不显示说明。"
    },
    "package": {
      "type": "string",
      "minLength": 1,
      "pattern": "\\S",
      "description": "模型所属包的稳定标识，例如 memsphere.builtin、memsphere.examples.orders。省略表示未定义包；本项目也可有自己的包。",
      "examples": [
        "memsphere.builtin",
        "memsphere.examples.orders",
        "acme.commerce"
      ]
    },
    "package_name": {
      "type": "string",
      "minLength": 1,
      "pattern": "\\S",
      "description": "所属包的显示名称，例如 Memsphere 内置、订单示例。仅在设置 package 时填写；未设置时显示 package。同一个包的模型可重复保存名称，名称应保持一致。"
    },
    "tags": {
      "type": "array",
      "uniqueItems": true,
      "items": {
        "type": "string",
        "minLength": 1,
        "pattern": "\\S"
      },
      "description": "辅助分类标签，例如 example、experimental。一个模型可以有多个标签，同一条记录中的标签不得重复。"
    },
    "storage": {
      "type": "string",
      "enum": [
        "builtin",
        "store"
      ],
      "description": "模型存储方式：builtin 为代码内置，由系统直接提供定义；store 为持久化存储，必须同时填写 store_id。此字段不表示包的来源。"
    },
    "store_id": {
      "type": "string",
      "minLength": 1,
      "pattern": "\\S",
      "description": "保存模型定义的 Store ID。storage 为 store 时必填，以 store_id 与 modelRef 读取定义；storage 为 builtin 时不得填写。不得另存重复的定义 ID。"
    }
  },
  "examples": [
    {
      "modelRef": "sales/order.json",
      "name": "订单",
      "package": "myproject.orders",
      "package_name": "订单管理",
      "tags": [
        "order"
      ],
      "store_id": "models/json-schema/draft-07",
      "storage": "store"
    },
    {
      "modelRef": "memsphere/run/artifact",
      "name": "运行产物",
      "package": "memsphere.builtin",
      "package_name": "Memsphere 内置",
      "tags": [
        "run",
        "artifact"
      ],
      "storage": "builtin"
    },
    {
      "modelRef": "notes.json",
      "name": "备注",
      "tags": [
        "example"
      ],
      "store_id": "models/json-schema/draft-07",
      "storage": "store"
    }
  ]
} as const;
export function modelRegistrationBinding() { return { model: { data: { id: MODEL_REGISTRATION_MODEL, model: JSON_SCHEMA_DRAFT_07, payload: { contentType: "application/json", content: bytesContent(Buffer.from(JSON.stringify(modelRegistrationSchema))) } }, definition: modelRegistrationSchema } }; }
const registry = new DefaultDataExtensionRegistry([filesystemJsonValueStoreExtension, jsonSchemaExtension, jsonSchemaMetaModelExtension, jsonSerializerExtension]);
export async function createModelRegistrationStore(context: Context, id: string, directory: string): Promise<ValueStore> {
  const manager = new DefaultDataManager({ extensions: registry, models: [modelRegistrationBinding()], stores: [{ id, model: MODEL_REGISTRATION_MODEL, kind: "ValueStore", factory: "memsphere/filesystem-json", config: new Config({ directory }) }] });
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
export function validateModelRegistration(value: unknown): asserts value is ModelRegistration {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid model registration: expected object");
  const v = value as Record<string, unknown>;
  const keys = new Set(["modelRef", "name", "description", "package", "package_name", "tags", "storage", "store_id"]);
  for (const key of Object.keys(v))
    if (!keys.has(key))
      throw new TypeError(`Unknown model registration field: ${key}`);
  for (const key of ["modelRef", "name", "package", "package_name", "store_id"])
    if ((key === "modelRef" || v[key] !== undefined) && (typeof v[key] !== "string" || !(v[key] as string).trim()))
      throw new TypeError(`Invalid model registration ${key}`);
  if (v.description !== undefined && typeof v.description !== "string")
    throw new TypeError("Invalid model registration description");
  if (v.storage !== "builtin" && v.storage !== "store")
    throw new TypeError("Invalid model registration storage");
  if (v.storage === "store" && (typeof v.store_id !== "string" || !v.store_id.trim()))
    throw new TypeError("Persistent model requires store_id");
  if (v.storage === "builtin" && v.store_id !== undefined)
    throw new TypeError("Builtin model must not have store_id");
  if (v.package_name !== undefined && v.package === undefined)
    throw new TypeError("package_name requires package");
  if (v.tags !== undefined && (!Array.isArray(v.tags) || v.tags.some(t => typeof t !== "string" || !t.trim()) || new Set(v.tags).size !== v.tags.length))
    throw new TypeError("Invalid model registration tags");
}
export type RegistrationRecord = {
  id: string;
  registration: ModelRegistration;
  origin: "project" | "market";
};
export type RegistrationDiagnostic = {
  id: string;
  message: string;
  origin: "project" | "market";
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
  for (const area of ["project", "imported"] as const) {
    const directory = join(paths.registrationDirectory, area);
    if (!await pathExists(directory))
      continue;
    const store = await createModelRegistrationStore(context, `${(input.modelRegistration ?? DEFAULT_MODEL_REGISTRATION_CONFIG).storeId}/${area}`, directory);
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
          records.push({ id: item.id, registration: record.value, origin: area === "project" ? "project" : "market" });
        }
        catch (error) {
          context.signal?.throwIfAborted();
          if (!(error instanceof TypeError) && !(error instanceof SyntaxError))
            throw error;
          diagnostics.push({ id: item.id, origin: area === "project" ? "project" : "market", message: error.message });
        }
      }
    } while (cursor !== undefined);
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
/** Caller holds the same Project settings lock used for config publication. */
export async function initializeProjectModelRegistrations(context: Context, input: ProjectModelInput) {
  const initial = await readModelRegistrations(context, input);
  if (initial.diagnostics.length)
    throw new TypeError(`Damaged model registrations: ${initial.diagnostics.map(d => d.id).join(", ")}`);
  const { createProjectModelHost } = await import("./models.js");
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
    const changed: typeof rewrites = [];
    try {
      for (const rewrite of rewrites) {
        const store = rewrite.origin === "market" ? await host.manager.getStore(context, IMPORTED_MODEL_DEFINITIONS_STORE) : host.store;
        if (store.kind !== "DataStore")
          throw new TypeError("Model references require a DataStore");
        await store.update(context, { id: rewrite.id, model: JSON_SCHEMA_DRAFT_07, payload: { contentType: "application/json", content: bytesContent(Buffer.from(rewrite.replacement)) } });
        changed.push(rewrite);
      }
      await rm(filename);
    }
    catch (error) {
      const failures: string[] = [];
      for (const rewrite of changed.reverse())
        try {
          const store = rewrite.origin === "market" ? await host.manager.getStore({}, IMPORTED_MODEL_DEFINITIONS_STORE) : host.store;
          if (store.kind !== "DataStore")
            throw new TypeError("Expected DataStore");
          await store.update({}, { id: rewrite.id, model: JSON_SCHEMA_DRAFT_07, payload: { contentType: "application/json", content: bytesContent(Buffer.from(rewrite.source)) } });
        }
        catch {
          failures.push(rewrite.id);
        }
      if (failures.length)
        throw Object.assign(new Error(`Migration failed; restore references from ${backupRoot}: ${failures.join(", ")}`), { cause: error });
      throw error;
    }
    for (const r of initial.records.filter(r => r.registration.modelRef === LEGACY_MODEL_REGISTRATION_MODEL)) {
      const store = await createModelRegistrationStore(context, `${(input.modelRegistration ?? DEFAULT_MODEL_REGISTRATION_CONFIG).storeId}/project`, join(initial.paths.registrationDirectory, "project"));
      await store.delete(context, r.id);
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
    await store.create(context, randomUUID(), registration);
    created++;
  }
  await atomicWriteJson(join(existing.paths.registrationDirectory, "initialized.json"), { initializedAt: new Date().toISOString() });
  return { created, retained, diagnostics: existing.diagnostics, config: input.modelRegistration ?? structuredClone(DEFAULT_MODEL_REGISTRATION_CONFIG), ...(backupPath ? { backupPath } : {}) };
}
export const builtinModelRegistrations: ReadonlyArray<ModelRegistration> = [
  {
    "modelRef": "memsphere/model-registration",
    "name": "模型登记",
    "package": "memsphere.builtin",
    "tags": [
      "management"
    ],
    "description": "管理模型的名称、说明、所属包、包名称、标签与模型存储方式。代码内置定义由系统直接提供；持久化定义通过存储 ID 与模型 ID 读取。",
    "package_name": "Memsphere 内置",
    "storage": "builtin"
  },
  {
    "modelRef": "memsphere/run/agent-activity-log",
    "name": "智能体活动日志",
    "package": "memsphere.builtin",
    "tags": [
      "run",
      "observability"
    ],
    "description": "智能体执行过程中的追加活动日志，用于查看过程与定位问题。",
    "package_name": "Memsphere 内置",
    "storage": "builtin"
  },
  {
    "modelRef": "memsphere/run/agent-activity-snapshot",
    "name": "智能体活动快照",
    "package": "memsphere.builtin",
    "tags": [
      "run",
      "observability"
    ],
    "description": "智能体当前活动状态的快照，用于展示运行进度。",
    "package_name": "Memsphere 内置",
    "storage": "builtin"
  },
  {
    "modelRef": "memsphere/run/artifact",
    "name": "运行产物",
    "package": "memsphere.builtin",
    "tags": [
      "run",
      "artifact"
    ],
    "description": "运行过程中提交的产物内容，以完整字节值保存。",
    "package_name": "Memsphere 内置",
    "storage": "builtin"
  },
  {
    "modelRef": "memsphere/run/memory-snapshot-file",
    "name": "记忆快照文件",
    "package": "memsphere.builtin",
    "tags": [
      "run",
      "memory"
    ],
    "description": "运行启动时冻结的记忆文件，为本次运行提供稳定的记忆快照。",
    "package_name": "Memsphere 内置",
    "storage": "builtin"
  }
];

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
