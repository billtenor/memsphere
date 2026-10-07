import { randomUUID } from "node:crypto";
import { open, link, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Context } from "../data/api/context.js";
import type { StoredValue } from "../data/api/value-store.js";
import type { StoredData } from "../data/api/data-store.js";
import { JsonPayloadSerializer, encodeJsonValue } from "../data/extensions/json-serializer/index.js";
import { bytesContent, readAll } from "../data/extensions/shared/payload.js";
import { parseFilesystemDataStoreConfig } from "../data/extensions/filesystem-datastore/index.js";
import { validateFilename, validateRelativeFilePath } from "../data/extensions/shared/filesystem.js";
import { Config } from "../data/api/config.js";
import { applyJsonPatch } from "../data/operations/json-patch.js";
import { queryJsonPath } from "../data/operations/json-path.js";
import { openBusinessStore, serviceError, readBusinessProject } from "./business-stores.js";
import { createProjectModelHost } from "./models.js";
import { assertModelRef } from "./model-registration-contract.js";
import { assertModelOperationStamp, withProjectSettingsLock } from "./model-operation.js";
import { encodeListCursor, decodeListCursor, parseListLimit, type PaginationOptions } from "../pagination.js";

type Opened = Awaited<ReturnType<typeof openBusinessStore>>;
export type DataInput = { kind: "value"; value: unknown } | { kind: "payload"; bytes: Uint8Array; contentType: string };
function assertId(opened: Opened, id: string) {
  if (opened.store.kind === "ValueStore") validateFilename(id);
  else validateRelativeFilePath(id);
}
function assertRevision(revision: number | undefined) {
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) throw serviceError("INVALID_ARGUMENT", "expected-revision must be a positive safe integer");
}
function requireCas(opened: Opened, expected?: number, edit = false) {
  assertRevision(expected);
  if (opened.store.kind !== "ValueStore" && (expected !== undefined || edit)) throw serviceError("UNSUPPORTED_CAPABILITY", "Store has no revision or conditional-write capability");
}
function metadata(record: StoredValue | StoredData) {
  const { revision, createdAt, createdBy, updatedAt, updatedBy } = record;
  return { ...(revision === undefined ? {} : { revision }), ...(createdAt === undefined ? {} : { createdAt }),
    ...(createdBy === undefined ? {} : { createdBy }), ...(updatedAt === undefined ? {} : { updatedAt }), ...(updatedBy === undefined ? {} : { updatedBy }) };
}
async function recordValue(context: Context, opened: Opened, record: StoredValue | StoredData): Promise<unknown> {
  if ("value" in record) return record.value;
  if (record.data.payload.contentType !== "application/json") throw serviceError("UNSUPPORTED_CAPABILITY", "Payload cannot be decoded as a value; use metadata-only or export");
  try {
    const value = await new JsonPayloadSerializer().deserialize(context, opened.runtime.descriptor, record.data.payload.content);
    opened.runtime.reflect(value);
    return value;
  } catch (cause) { throw serviceError("UNSUPPORTED_CAPABILITY", "Payload cannot be decoded and validated; use metadata-only or export", { cause: String(cause) }); }
}
function contentTypeFor(opened: Opened, id: string): string {
  const { extensions } = parseFilesystemDataStoreConfig(new Config({ ...opened.binding.config, directory: opened.directory }));
  const match = extensions.find(([suffix]) => id.slice(id.lastIndexOf("/") + 1).toLowerCase().endsWith(suffix));
  if (!match) throw serviceError("INVALID_ARGUMENT", "Data ID has no configured MIME suffix", { id });
  return match[1];
}
export async function listData(context: Context, root: string, storeId: string, options: PaginationOptions = {}) {
  const limit = parseListLimit(options.limit);
  const opened = await openBusinessStore(context, root, storeId);
  const scope = { command: "data.list", scope: { root, storeId, binding: opened.binding, directory: opened.directory } };
  const cursor = decodeListCursor(options.cursor, scope);
  const page = await opened.store.list(context, { limit, cursor });
  await assertModelOperationStamp(root, opened.stamp);
  return { items: page.items, ...(page.nextCursor === undefined ? {} : { nextCursor: encodeListCursor(scope, page.nextCursor) }) };
}
export async function readData(context: Context, root: string, storeId: string, id: string, options: { metadataOnly?: boolean; path?: string } = {}) {
  if (options.metadataOnly && options.path !== undefined) throw serviceError("INVALID_ARGUMENT", "metadata-only and path are mutually exclusive");
  const opened = await openBusinessStore(context, root, storeId);
  assertId(opened, id);
  const record = await opened.store.get(context, id);
  if (!record) throw serviceError("NOT_FOUND", `Record not found: ${id}`);
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
export async function hasData(context: Context, root: string, storeId: string, id: string) {
  const opened = await openBusinessStore(context, root, storeId); assertId(opened, id);
  const exists = await opened.store.has(context, id);
  await assertModelOperationStamp(root, opened.stamp);
  return { id, modelRef: opened.binding.model, exists };
}
async function prepareInput(context: Context, opened: Opened, id: string, input: DataInput) {
  if (input.kind === "payload") {
    if (opened.store.kind !== "DataStore") throw serviceError("UNSUPPORTED_CAPABILITY", "Payload input requires a DataStore");
    if (contentTypeFor(opened, id) !== input.contentType) throw serviceError("INVALID_ARGUMENT", "Payload MIME does not match Data ID suffix");
    return { payload: { contentType: input.contentType, content: bytesContent(input.bytes) } };
  }
  opened.runtime.reflect(input.value);
  const content = await new JsonPayloadSerializer().serialize(context, opened.runtime.descriptor, input.value);
  if (opened.store.kind === "DataStore" && contentTypeFor(opened, id) !== "application/json") throw serviceError("UNSUPPORTED_CAPABILITY", "Structured JSON writes require an application/json Data ID");
  return { value: input.value, payload: { contentType: "application/json", content } };
}
export async function writeData(context: Context, root: string, storeId: string, id: string, operation: "create" | "update", input: DataInput, options: { expectedRevision?: number; dryRun?: boolean } = {}) {
  assertRevision(options.expectedRevision);
  const execute = async () => {
    const opened = await openBusinessStore(context, root, storeId); assertId(opened, id); requireCas(opened, options.expectedRevision);
    const prepared = await prepareInput(context, opened, id, input);
    if (options.dryRun) {
      const record = await opened.store.get(context, id);
      if (operation === "create" && record) throw serviceError("ALREADY_EXISTS", `Record already exists: ${id}`);
      if (operation === "update" && !record) throw serviceError(options.expectedRevision ? "REVISION_CONFLICT" : "NOT_FOUND", `Record not found: ${id}`);
      if (options.expectedRevision !== undefined && record?.revision !== options.expectedRevision) throw serviceError("REVISION_CONFLICT", "Record revision does not match");
      return { operation: `data.${operation}`, id, modelRef: opened.binding.model, dryRun: true };
    }
    let result: StoredValue | StoredData | undefined;
    if (opened.store.kind === "ValueStore") result = operation === "create" ? await opened.store.create(context, id, prepared.value) : await opened.store.update(context, id, prepared.value, { expectedRevision: options.expectedRevision });
    else {
      const data = { id, model: opened.binding.model, payload: prepared.payload };
      if (operation === "create") await opened.store.create(context, data); else await opened.store.update(context, data);
      result = await opened.store.get(context, id);
    }
    return { operation: `data.${operation}`, id, modelRef: opened.binding.model, ...(result ? metadata(result) : {}) };
  };
  return options.dryRun ? execute() : withProjectSettingsLock(root, execute, context.signal);
}
export async function upsertData(context: Context, root: string, storeId: string, id: string, input: DataInput, options: { dryRun?: boolean } = {}) {
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
  return options.dryRun ? execute() : withProjectSettingsLock(root, execute, context.signal);
}

export async function deleteData(context: Context, root: string, storeId: string, id: string, options: { expectedRevision?: number; dryRun?: boolean } = {}) {
  assertRevision(options.expectedRevision);
  const execute = async () => {
    const opened = await openBusinessStore(context, root, storeId); assertId(opened, id); requireCas(opened, options.expectedRevision);
    if (options.dryRun) {
      const record = await opened.store.get(context, id);
      if (options.expectedRevision !== undefined && record?.revision !== options.expectedRevision) throw serviceError("REVISION_CONFLICT", "Record revision does not match or record is missing");
      return { operation: "data.delete", id, modelRef: opened.binding.model, deleted: !!record, dryRun: true };
    }
    const deleted = await opened.store.delete(context, id, { expectedRevision: options.expectedRevision });
    return { operation: "data.delete", id, modelRef: opened.binding.model, deleted };
  };
  return options.dryRun ? execute() : withProjectSettingsLock(root, execute, context.signal);
}
export async function editData(context: Context, root: string, storeId: string, id: string, patch: unknown, options: { expectedRevision?: number; dryRun?: boolean } = {}) {
  const opened = await openBusinessStore(context, root, storeId); assertId(opened, id); requireCas(opened, options.expectedRevision, true);
  if (opened.store.kind !== "ValueStore") throw serviceError("UNSUPPORTED_CAPABILITY", "edit requires conditional ValueStore writes");
  const record = await opened.store.get(context, id);
  if (!record) throw serviceError("NOT_FOUND", `Record not found: ${id}`);
  if (options.expectedRevision !== undefined && record.revision !== options.expectedRevision) throw serviceError("REVISION_CONFLICT", "Record revision does not match");
  if (record.revision === undefined) throw serviceError("UNSUPPORTED_CAPABILITY", "edit requires a real record revision");
  const value = applyJsonPatch(record.value, patch);
  await prepareInput(context, opened, id, { kind: "value", value });
  if (options.dryRun) return { operation: "data.edit", id, modelRef: opened.binding.model, expectedRevision: record.revision, dryRun: true };
  return withProjectSettingsLock(root, async () => {
    const current = await openBusinessStore(context, root, storeId);
    if (current.store.kind !== "ValueStore" || !isSameBinding(opened, current)) throw serviceError("REVISION_CONFLICT", "Store binding changed during edit");
    const saved = await current.store.update(context, id, value, { expectedRevision: record.revision });
    return { operation: "data.edit", id, modelRef: current.binding.model, ...metadata(saved) };
  }, context.signal);
}
function isSameBinding(a: Opened, b: Opened) { return a.directory === b.directory && JSON.stringify(a.binding) === JSON.stringify(b.binding); }
export async function validateData(context: Context, root: string, options: { id?: string; storeId?: string; modelRef?: string; value?: unknown; hasValue?: boolean }) {
  if (options.modelRef !== undefined) {
    if (options.id !== undefined || options.storeId !== undefined || !options.hasValue) throw serviceError("INVALID_ARGUMENT", "Candidate validation requires model and value only");
    assertModelRef(options.modelRef);
    const project = await readBusinessProject(root);
    const host = await createProjectModelHost(context, { root, ...project });
    const runtime = await host.runtime(options.modelRef);
    runtime.reflect(options.value);
    await new JsonPayloadSerializer().serialize(context, runtime.descriptor, options.value);
    return { operation: "data.validate", modelRef: options.modelRef, valid: true };
  }
  if (options.id === undefined || options.storeId === undefined || options.hasValue) throw serviceError("INVALID_ARGUMENT", "Existing record validation requires id and store only");
  const record = await readData(context, root, options.storeId, options.id);
  return { operation: "data.validate", id: options.id, modelRef: record.modelRef, valid: true };
}
export async function exportData(context: Context, root: string, storeId: string, id: string, as: "payload" | "json", out: string) {
  const opened = await openBusinessStore(context, root, storeId); assertId(opened, id);
  const record = await opened.store.get(context, id);
  if (!record) throw serviceError("NOT_FOUND", `Record not found: ${id}`);
  let bytes: Uint8Array;
  if (as === "payload") {
    if (!("data" in record)) throw serviceError("UNSUPPORTED_CAPABILITY", "Payload export requires a DataStore");
    bytes = await readAll(context, record.data.payload.content);
  } else {
    const value = await recordValue(context, opened, record);
    try { bytes = Buffer.from(encodeJsonValue(value)); }
    catch (cause) { throw serviceError("UNSUPPORTED_CAPABILITY", "Value cannot be exported as JSON", { cause: String(cause) }); }
  }
  await assertModelOperationStamp(root, opened.stamp);
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
  return { operation: "data.export", id, modelRef: opened.binding.model, out: destination, bytes: bytes.byteLength };
}
