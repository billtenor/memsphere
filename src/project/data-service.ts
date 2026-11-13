import { validateTosWriteOptions } from "../data/extensions/tos-datastore/write-policy.js";
import { validateTosMime } from "../data/extensions/tos-datastore/store.js";
import { withContextControlAccess, isContextControlStore } from "./context-control-access.js";
import { randomUUID } from "node:crypto";
import { open, link, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { PayloadContent } from "../data/api/payload.js";
import type { Context } from "../data/api/context.js";
import type { StoredValue } from "../data/api/value-store.js";
import type { StoredData, DataStoreReadResult } from "../data/api/data-store.js";
import { JsonPayloadSerializer, decodeJsonBytes, assertJsonDescriptor, encodeJsonValue } from "../data/extensions/json-serializer/index.js";
import { bytesContent, consumeContent, readAll, throwIfAborted } from "../data/extensions/shared/payload.js";
import { parseFilesystemDataStoreConfig } from "../data/extensions/filesystem-datastore/index.js";
import { validateRelativeFilePath } from "../data/extensions/shared/filesystem.js";
import { Config } from "../data/api/config.js";
import { applyJsonPatch } from "../data/operations/json-patch.js";
import { queryJsonPath } from "../data/operations/json-path.js";
import { openBusinessStore as openNativeBusinessStore, serviceError, readBusinessProject } from "./business-stores.js";
import { createProjectModelHost } from "./models.js";
import { assertModelRef } from "./model-registration-contract.js";
import { assertModelOperationStamp as assertNativeModelOperationStamp } from "./model-operation.js";
import { encodeListCursor, decodeListCursor, parseListLimit, type PaginationOptions } from "../pagination.js";

type Opened = Pick<Awaited<ReturnType<typeof openNativeBusinessStore>>, "binding" | "directory" | "runtime" | "store" | "stamp">;
export type DataInput = { kind: "value"; value: unknown } | { kind: "payload"; bytes: Uint8Array; contentType: string } | { kind: "payload-stream"; content: PayloadContent; contentType: string };

export interface DataServiceAdapters {
  openStore: (context: Context, root: string, storeId: string) => Promise<Opened>;
  assertStamp: typeof assertNativeModelOperationStamp;
  modelRuntime: (context: Context, root: string, modelRef: string) => Promise<Opened["runtime"]>;
  exportContent: (context: Context, content: PayloadContent, out: string, beforePublish: () => Promise<void>) => Promise<{ destination?: string; bytes: number }>;
  exportBytes: (bytes: Uint8Array, out: string) => Promise<string | undefined>;
}

async function nativeModelRuntime(context: Context, root: string, modelRef: string) {
  const project = await readBusinessProject(root);
  return (await createProjectModelHost(context, { root, ...project })).runtime(modelRef);
}
async function nativeExportBytes(bytes: Uint8Array, out: string): Promise<string | undefined> {
  if (out === "-") {
    await new Promise<void>((resolveWrite, reject) => process.stdout.write(bytes, error => error ? reject(error) : resolveWrite()));
    return undefined;
  }
  const destination = resolve(out);
  const temporary = join(dirname(destination), `.memsphere-export-${randomUUID()}`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await link(temporary, destination);
  } finally { await rm(temporary, { force: true }); }
  return destination;
}

/** Stream to an unpublished sibling file; a failed read never publishes a partial file. */
async function nativeExportContent(context: Context, content: PayloadContent, out: string, beforePublish: () => Promise<void>) {
  let bytes = 0;
  if (out === "-") {
    await beforePublish();
    await consumeContent(context, content, async chunk => {
      await new Promise<void>((done, reject) => process.stdout.write(chunk, error => error ? reject(error) : done()));
      bytes += chunk.byteLength;
    });
    return { bytes };
  }
  const destination = resolve(out), temporary = join(dirname(destination), `.memsphere-export-${randomUUID()}`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await consumeContent(context, content, async chunk => {
        let offset = 0;
        while (offset < chunk.byteLength) {
          const written = await handle.write(chunk, offset, chunk.byteLength - offset);
          if (!written.bytesWritten) throw new Error("Export made no write progress");
          offset += written.bytesWritten;
        }
        bytes += chunk.byteLength;
      });
      await handle.sync();
    } finally { await handle.close(); }
    await beforePublish();
    context.signal?.throwIfAborted();
    await link(temporary, destination);
    return { destination, bytes };
  } finally { await rm(temporary, { force: true }); }
}

/** Compose business operations with Store/model/export capabilities. Defaults
 * retain filesystem persistence; in-memory adapters exercise the same logic.
 */
export function createDataService(adapters: Partial<DataServiceAdapters> = {}) {
  const openBusinessStore = adapters.openStore ?? openNativeBusinessStore;
  const assertModelOperationStamp = adapters.assertStamp ?? assertNativeModelOperationStamp;
  const modelRuntime = adapters.modelRuntime ?? nativeModelRuntime;
  const exportBytes = adapters.exportBytes ?? nativeExportBytes;
  const exportContent = adapters.exportContent ?? (adapters.exportBytes ? async (context: Context, content: PayloadContent, out: string, beforePublish: () => Promise<void>) => {
    const bytes = await readAll(context, content);
    await beforePublish();
    return { destination: await exportBytes(bytes, out), bytes: bytes.byteLength };
  } : nativeExportContent);

  function assertId(opened: Opened, id: string) {
    validateRelativeFilePath(id);
  }
  function assertRevision(revision: string | undefined) {
    if (revision !== undefined && (typeof revision !== "string" || !revision.length)) throw serviceError("INVALID_ARGUMENT", "expected-revision must be a non-empty revision string");
  }
  function requireCas(opened: Opened, expected?: string, edit = false, modifying = false) {
    assertRevision(expected);
    if (opened.store.kind === "ValueStore") return;
    if (edit || expected !== undefined && !opened.store.capabilities?.conditionalWrite) throw serviceError("UNSUPPORTED_CAPABILITY", "Store has no requested conditional-write capability");
    if (modifying && opened.store.capabilities?.conditionalWrite?.required && expected === undefined) throw serviceError("INVALID_ARGUMENT", "expectedRevision is required");
  }
  function metadata(record: StoredValue | DataStoreReadResult) {
    const { revision, createdAt, createdBy, updatedAt, updatedBy } = record;
    return { ...(revision === undefined ? {} : { revision }), ...(createdAt === undefined ? {} : { createdAt }),
      ...(createdBy === undefined ? {} : { createdBy }), ...(updatedAt === undefined ? {} : { updatedAt }), ...(updatedBy === undefined ? {} : { updatedBy }) };
  }
  async function recordValue(context: Context, opened: Opened, record: StoredValue | DataStoreReadResult): Promise<unknown> {
    if ("deleted" in record && record.deleted) throw serviceError("DATA_DELETED", "Record is deleted", { revision: record.revision });
    if ("value" in record) return record.value;
    if (record.data.payload.contentType !== "application/json") throw serviceError("UNSUPPORTED_CAPABILITY", "Payload cannot be decoded as a value; use metadata-only or export");
    const incompatible = (cause: unknown) => serviceError("UNSUPPORTED_CAPABILITY", "Payload cannot be decoded and validated; use metadata-only or export", { cause: String(cause) });
    throwIfAborted(context);
    try { assertJsonDescriptor(opened.runtime.descriptor.root); } catch (cause) { throw incompatible(cause); }
    // A conditional GET, permission failure or cancellation is a storage fact,
    // not evidence that the JSON model is unsupported.
    const bytes = await readAll(context, record.data.payload.content);
    throwIfAborted(context);
    let value: unknown;
    try { value = decodeJsonBytes(opened.runtime.descriptor, bytes); opened.runtime.reflect(value); }
    catch (cause) { throwIfAborted(context); throw incompatible(cause); }
    throwIfAborted(context);
    return value;
  }
  function contentTypeFor(opened: Opened, id: string): string | undefined {
    if (opened.binding.factory === "memsphere/tos") return undefined;
    const { extensions } = parseFilesystemDataStoreConfig(new Config({ ...opened.binding.config, directory: opened.directory! }));
    const match = extensions.find(([suffix]) => id.slice(id.lastIndexOf("/") + 1).toLowerCase().endsWith(suffix));
    if (!match) throw serviceError("INVALID_ARGUMENT", "Data ID has no configured MIME suffix", { id });
    return match[1];
  }
  async function listDataUnlocked(context: Context, root: string, storeId: string, options: PaginationOptions = {}) {
    const limit = parseListLimit(options.limit);
    const opened = await openBusinessStore(context, root, storeId);
    const scope = { command: "data.list", scope: { root, storeId, binding: opened.binding, directory: opened.directory } };
    const cursor = decodeListCursor(options.cursor, scope);
    const page = await opened.store.list(context, { limit, cursor });
    await assertModelOperationStamp(root, opened.stamp);
    return { items: page.items, ...(page.nextCursor === undefined ? {} : { nextCursor: encodeListCursor(scope, page.nextCursor) }) };
  }
  async function readDataUnlocked(context: Context, root: string, storeId: string, id: string, options: { metadataOnly?: boolean; path?: string } = {}) {
    if (options.metadataOnly && options.path !== undefined) throw serviceError("INVALID_ARGUMENT", "metadata-only and path are mutually exclusive");
    const opened = await openBusinessStore(context, root, storeId);
    assertId(opened, id);
    const record = await opened.store.get(context, id);
    if (!record) throw serviceError("NOT_FOUND", `Record not found: ${id}`);
    if ("deleted" in record && record.deleted) {
      await assertModelOperationStamp(root, opened.stamp);
      return { id, modelRef: opened.binding.model, deleted: true as const, revision: record.revision };
    }
    let value: unknown;
    if (!options.metadataOnly) {
      value = await recordValue(context, opened, record);
      if (options.path !== undefined) {
        try { encodeJsonValue(value); } catch (cause) { throw serviceError("UNSUPPORTED_CAPABILITY", "Path queries require JSON-compatible values", { cause: String(cause) }); }
        value = queryJsonPath(value, options.path);
      }
    }
    await assertModelOperationStamp(root, opened.stamp);
    return { id, modelRef: opened.binding.model, ...metadata(record), ...("data" in record ? { contentType: record.data.payload.contentType } : {}), ...(options.metadataOnly ? {} : { value }) };
  }
  async function hasDataUnlocked(context: Context, root: string, storeId: string, id: string) {
    const opened = await openBusinessStore(context, root, storeId); assertId(opened, id);
    const exists = await opened.store.has(context, id);
    await assertModelOperationStamp(root, opened.stamp);
    return { id, modelRef: opened.binding.model, exists };
  }
  async function prepareInput(context: Context, opened: Opened, id: string, input: DataInput) {
    if (input.kind !== "value") {
      if (opened.store.kind !== "DataStore") throw serviceError("UNSUPPORTED_CAPABILITY", "Payload input requires a DataStore");
      if (opened.binding.factory === "memsphere/tos") validateTosMime(input.contentType);
      if (contentTypeFor(opened, id) !== undefined && contentTypeFor(opened, id) !== input.contentType) throw serviceError("INVALID_ARGUMENT", "Payload MIME does not match Data ID suffix");
      return { payload: { contentType: input.contentType, content: input.kind === "payload" ? bytesContent(input.bytes) : input.content } };
    }
    opened.runtime.reflect(input.value);
    const content = await new JsonPayloadSerializer().serialize(context, opened.runtime.descriptor, input.value);
    if (opened.store.kind === "DataStore" && contentTypeFor(opened, id) !== undefined && contentTypeFor(opened, id) !== "application/json") throw serviceError("UNSUPPORTED_CAPABILITY", "Structured JSON writes require an application/json Data ID");
    return { value: input.value, payload: { contentType: "application/json", content } };
  }
  async function writeData(context: Context, root: string, storeId: string, id: string, operation: "create" | "update", input: DataInput, options: { expectedRevision?: string; dryRun?: boolean } = {}) {
    assertRevision(options.expectedRevision);
    const execute = async () => {
      const opened = await openBusinessStore(context, root, storeId); assertId(opened, id); requireCas(opened, options.expectedRevision, false, operation === "update");
      if (operation === "update" && opened.store.kind === "DataStore" && opened.store.capabilities?.update === false) throw serviceError("UNSUPPORTED_CAPABILITY", "This Store does not permit updates");
      if (operation === "create" && options.expectedRevision !== undefined) throw serviceError("INVALID_ARGUMENT", "create does not accept expectedRevision");
      if (opened.binding.factory === "memsphere/tos") validateTosWriteOptions(opened.binding.config.mode, operation, options.expectedRevision);
      const prepared = await prepareInput(context, opened, id, input);
      if (options.dryRun) {
        const record = await opened.store.get(context, id);
        if (operation === "create" && record) throw serviceError("ALREADY_EXISTS", `Record already exists: ${id}`);
        if (operation === "update" && !record) throw serviceError(options.expectedRevision ? "REVISION_CONFLICT" : "NOT_FOUND", `Record not found: ${id}`);
        if (options.expectedRevision !== undefined && record?.revision !== options.expectedRevision) throw serviceError("REVISION_CONFLICT", "Record revision does not match");
        return { operation: `data.${operation}`, id, modelRef: opened.binding.model, dryRun: true };
      }
      let result: StoredValue | DataStoreReadResult | undefined;
      if (opened.store.kind === "ValueStore") result = operation === "create" ? await opened.store.create(context, id, prepared.value) : await opened.store.update(context, id, prepared.value, { expectedRevision: options.expectedRevision });
      else {
        const data = { id, model: opened.binding.model, payload: prepared.payload };
        if (operation === "create") await opened.store.create(context, data); else await opened.store.update(context, data, { expectedRevision: options.expectedRevision });
        if (!opened.store.capabilities) result = await opened.store.get(context, id);
      }
      return { operation: `data.${operation}`, id, modelRef: opened.binding.model, ...(result ? metadata(result) : {}) };
    };
    return options.dryRun || !isContextControlStore(storeId) ? execute() : withContextControlAccess(root, execute, context.signal);
  }
  async function upsertData(context: Context, root: string, storeId: string, id: string, input: DataInput, options: { dryRun?: boolean } = {}) {
    const execute = async () => {
      const opened = await openBusinessStore(context, root, storeId);
      assertId(opened, id);
      if (opened.store.kind !== "ValueStore" || !opened.store.upsert || input.kind !== "value")
        throw serviceError("UNSUPPORTED_CAPABILITY", "upsert requires a value and an atomic-upsert ValueStore");
      await prepareInput(context, opened, id, input);
      if (options.dryRun) return { operation: "data.upsert", id, modelRef: opened.binding.model, dryRun: true };
      const record = await opened.store.upsert(context, id, input.value);
      return { operation: "data.upsert", id, modelRef: opened.binding.model, ...metadata(record) };
    };
    return options.dryRun || !isContextControlStore(storeId) ? execute() : withContextControlAccess(root, execute, context.signal);
  }

  async function deleteData(context: Context, root: string, storeId: string, id: string, options: { expectedRevision?: string; dryRun?: boolean } = {}) {
    assertRevision(options.expectedRevision);
    const execute = async () => {
      const opened = await openBusinessStore(context, root, storeId); assertId(opened, id); requireCas(opened, options.expectedRevision, false, true);
      if (opened.binding.factory === "memsphere/tos") validateTosWriteOptions(opened.binding.config.mode, "delete", options.expectedRevision);
      if (options.dryRun) {
        const record = await opened.store.get(context, id);
        if (options.expectedRevision !== undefined && record?.revision !== options.expectedRevision) throw serviceError("REVISION_CONFLICT", "Record revision does not match or record is missing");
        return { operation: "data.delete", id, modelRef: opened.binding.model, deleted: !!record, dryRun: true };
      }
      const deleted = await opened.store.delete(context, id, { expectedRevision: options.expectedRevision });
      return { operation: "data.delete", id, modelRef: opened.binding.model, deleted };
    };
    return options.dryRun || !isContextControlStore(storeId) ? execute() : withContextControlAccess(root, execute, context.signal);
  }
  async function editData(context: Context, root: string, storeId: string, id: string, patch: unknown, options: { expectedRevision?: string; dryRun?: boolean } = {}) {
    const opened = await openBusinessStore(context, root, storeId); assertId(opened, id); requireCas(opened, options.expectedRevision, true);
    if (opened.store.kind !== "ValueStore") throw serviceError("UNSUPPORTED_CAPABILITY", "edit requires conditional ValueStore writes");
    const record = await opened.store.get(context, id);
    if (!record) throw serviceError("NOT_FOUND", `Record not found: ${id}`);
    if (options.expectedRevision !== undefined && record.revision !== options.expectedRevision) throw serviceError("REVISION_CONFLICT", "Record revision does not match");
    if (record.revision === undefined) throw serviceError("UNSUPPORTED_CAPABILITY", "edit requires a real record revision");
    const value = applyJsonPatch(record.value, patch);
    await prepareInput(context, opened, id, { kind: "value", value });
    if (options.dryRun) return { operation: "data.edit", id, modelRef: opened.binding.model, expectedRevision: record.revision, dryRun: true };
    // Ordinary business operations keep the Store/runtime snapshot they opened.
    // Rebinding affects later operations; the record revision protects this edit.
    if (!isContextControlStore(storeId)) {
      const saved = await opened.store.update(context, id, value, { expectedRevision: record.revision });
      return { operation: "data.edit", id, modelRef: opened.binding.model, ...metadata(saved) };
    }
    return withContextControlAccess(root, async () => {
      const current = await openBusinessStore(context, root, storeId);
      if (current.store.kind !== "ValueStore" || !isSameBinding(opened, current)) throw serviceError("REVISION_CONFLICT", "Store binding changed during edit");
      const saved = await current.store.update(context, id, value, { expectedRevision: record.revision });
      return { operation: "data.edit", id, modelRef: current.binding.model, ...metadata(saved) };
    }, context.signal);
  }
  function isSameBinding(a: Opened, b: Opened) { return a.directory === b.directory && JSON.stringify(a.binding) === JSON.stringify(b.binding); }
  async function validateData(context: Context, root: string, options: { id?: string; storeId?: string; modelRef?: string; value?: unknown; hasValue?: boolean }) {
    if (options.modelRef !== undefined) {
      if (options.id !== undefined || options.storeId !== undefined || !options.hasValue) throw serviceError("INVALID_ARGUMENT", "Candidate validation requires model and value only");
      assertModelRef(options.modelRef);
      const runtime = await modelRuntime(context, root, options.modelRef);
      runtime.reflect(options.value);
      await new JsonPayloadSerializer().serialize(context, runtime.descriptor, options.value);
      return { operation: "data.validate", modelRef: options.modelRef, valid: true };
    }
    if (options.id === undefined || options.storeId === undefined || options.hasValue) throw serviceError("INVALID_ARGUMENT", "Existing record validation requires id and store only");
    const record = await readData(context, root, options.storeId, options.id);
    if ("deleted" in record && record.deleted) throw serviceError("DATA_DELETED", "Record is deleted", { revision: record.revision });
    return { operation: "data.validate", id: options.id, modelRef: record.modelRef, valid: true };
  }
  async function exportDataUnlocked(context: Context, root: string, storeId: string, id: string, as: "payload" | "json", out: string) {
    const opened = await openBusinessStore(context, root, storeId); assertId(opened, id);
    const record = await opened.store.get(context, id);
    if (!record) throw serviceError("NOT_FOUND", `Record not found: ${id}`);
    if ("deleted" in record && record.deleted) throw serviceError("DATA_DELETED", "Record is deleted", { revision: record.revision });
    let bytes: Uint8Array;
    if (as === "payload") {
      if (!("data" in record)) throw serviceError("UNSUPPORTED_CAPABILITY", "Payload export requires a DataStore");
      const result = await exportContent(context, record.data.payload.content, out, () => assertModelOperationStamp(root, opened.stamp));
      return result.destination === undefined ? undefined : { operation: "data.export", id, modelRef: opened.binding.model, out: result.destination, bytes: result.bytes };
    } else {
      const value = await recordValue(context, opened, record);
      try { bytes = Buffer.from(encodeJsonValue(value)); }
      catch (cause) { throw serviceError("UNSUPPORTED_CAPABILITY", "Value cannot be exported as JSON", { cause: String(cause) }); }
    }
    await assertModelOperationStamp(root, opened.stamp);
    const destination = await exportBytes(bytes, out);
    return destination === undefined ? undefined : { operation: "data.export", id, modelRef: opened.binding.model, out: destination, bytes: bytes.byteLength };
  }

  const listData = (...args: Parameters<typeof listDataUnlocked>) => isContextControlStore(args[2]) ? withContextControlAccess(args[1], () => listDataUnlocked(...args)) : listDataUnlocked(...args);

  const readData = (...args: Parameters<typeof readDataUnlocked>) => isContextControlStore(args[2]) ? withContextControlAccess(args[1], () => readDataUnlocked(...args)) : readDataUnlocked(...args);

  const hasData = (...args: Parameters<typeof hasDataUnlocked>) => isContextControlStore(args[2]) ? withContextControlAccess(args[1], () => hasDataUnlocked(...args)) : hasDataUnlocked(...args);

  const exportData = (...args: Parameters<typeof exportDataUnlocked>) => isContextControlStore(args[2]) ? withContextControlAccess(args[1], () => exportDataUnlocked(...args)) : exportDataUnlocked(...args);

  return { listData, readData, hasData, writeData, upsertData, deleteData, editData, validateData, exportData };
}

export const { listData, readData, hasData, writeData, upsertData, deleteData, editData, validateData, exportData } = createDataService();
