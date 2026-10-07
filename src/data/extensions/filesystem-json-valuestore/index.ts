import { Config } from "../../api/config.js";
import type { Context } from "../../api/context.js";
import type { DataId, ModelRef } from "../../api/data.js";
import type { DataExtension } from "../../api/extension.js";
import type { ModelRuntime } from "../../api/model-runtime.js";
import type { DeleteOptions, ListOptions, ListResult, StoreId, UpdateOptions } from "../../api/store.js";
import type { StoredValue, ValueStore, ValueStoreFactory } from "../../api/value-store.js";
import { JsonPayloadSerializer } from "../json-serializer/index.js";
import {
  atomicPublish, deleteFile, findFile, listFilenames, openExistingDirectory, paginate, prepareDirectory,
  readFileSnapshot, requirePositiveInteger, requireString, validateFilename, withRecordLock
} from "../shared/filesystem.js";
import { readDeletedRevision, retainDeletedRevision } from "./revision-state.js";

export { FILESYSTEM_JSON_METADATA_DIRECTORY } from "../shared/filesystem.js";
export { validateFilesystemJsonStoreMetadata } from "./revision-state.js";

type JsonRecord = StoredValue & { revision: number; createdAt: number; updatedAt: number };

/**
 * Each record is readable, formatted JSON at `${directory}/${id}.json`:
 * { id, revision, createdAt, updatedAt, value }. The model belongs to this Store,
 * not the file. IDs are portable filename stems, never hashed or encoded.
 *
 * Same-record writes share a native file lock across all Store instances and
 * processes. Permanent lock files and deleted revision high-water marks live in
 * .memsphere-json-store and are excluded from list. Recreating a deleted record
 * does not reuse its revision. External editors are outside this guarantee.
 * Configuration contains only the required directory. openExisting is pure.
 */
export class FilesystemJsonValueStoreFactory implements ValueStoreFactory {
  readonly id = "memsphere/filesystem-json";

  async createStore(context: Context, id: StoreId, runtime: ModelRuntime, config: Config): Promise<ValueStore> {
    return this.open(context, id, runtime, config, prepareDirectory);
  }

  async openExisting(context: Context, id: StoreId, runtime: ModelRuntime, config: Config): Promise<ValueStore> {
    return this.open(context, id, runtime, config, openExistingDirectory);
  }

  private async open(context: Context, id: StoreId, runtime: ModelRuntime, config: Config, open: typeof prepareDirectory): Promise<ValueStore> {
    context.signal?.throwIfAborted();
    if (typeof id !== "string" || id.trim().length === 0) throw new TypeError("Store ID must be a non-empty string");
    const snapshot = parseFilesystemJsonValueStoreConfig(config);
    const directory = await open(context, new Config(snapshot));
    return new FilesystemJsonValueStore(id, runtime, directory);
  }
}

class FilesystemJsonValueStore implements ValueStore {
  readonly kind = "ValueStore" as const;
  readonly model: ModelRef;
  private readonly serializer = new JsonPayloadSerializer();

  constructor(readonly id: StoreId, private readonly runtime: ModelRuntime, private readonly directory: string) {
    this.model = runtime.descriptor.id;
  }

  async get(context: Context, id: DataId): Promise<StoredValue | undefined> {
    const filename = recordFilename(id);
    return this.read(context, id, filename);
  }

  async has(context: Context, id: DataId): Promise<boolean> {
    return (await findFile(context, this.directory, recordFilename(id))) !== undefined;
  }

  async create(context: Context, id: DataId, value: unknown): Promise<StoredValue> {
    const filename = recordFilename(id);
    const snapshot = await this.prepare(context, value);
    return withRecordLock(context, this.directory, filename, async () => {
      if (await findFile(context, this.directory, filename)) throw Object.assign(new Error(`Record ${id} already exists`), { code: "ALREADY_EXISTS" });
      const revision = await readDeletedRevision(context, this.directory, filename);
      if (revision === Number.MAX_SAFE_INTEGER) throw new RangeError(`Record ${id} revision overflow`);
      const now = Date.now();
      const record: JsonRecord = { id, revision: revision + 1, createdAt: now, updatedAt: now, value: snapshot };
      await atomicPublish(context, this.directory, filename, recordBytes(record), "create");
      return record;
    });
  }

  async upsert(context: Context, id: DataId, value: unknown): Promise<StoredValue> {
    const filename = recordFilename(id);
    const snapshot = await this.prepare(context, value);
    return withRecordLock(context, this.directory, filename, async () => {
      const previous = await this.read(context, id, filename);
      if (previous) await this.checkRetainedRevision(context, filename, previous.revision);
      const revision = previous?.revision ?? await readDeletedRevision(context, this.directory, filename);
      if (revision === Number.MAX_SAFE_INTEGER) throw new RangeError(`Record ${id} revision overflow`);
      const now = Date.now();
      const record: JsonRecord = { id, revision: revision + 1, createdAt: previous?.createdAt ?? now, updatedAt: now, value: snapshot };
      if (previous && Object.hasOwn(previous, "createdBy")) record.createdBy = previous.createdBy;
      await atomicPublish(context, this.directory, filename, recordBytes(record), previous ? "replace" : "create");
      return record;
    });
  }

  async update(context: Context, id: DataId, value: unknown, options?: UpdateOptions): Promise<StoredValue> {
    const expectedRevision = captureRevision(options);
    const filename = recordFilename(id);
    const snapshot = await this.prepare(context, value);
    return withRecordLock(context, this.directory, filename, async () => {
      const previous = await this.read(context, id, filename);
      checkRevision(id, previous, expectedRevision);
      if (previous === undefined) throw Object.assign(new Error(`Record ${id} does not exist`), { code: "NOT_FOUND" });
      await this.checkRetainedRevision(context, filename, previous.revision);
      if (previous.revision === Number.MAX_SAFE_INTEGER) throw new RangeError(`Record ${id} revision overflow`);
      const record: JsonRecord = {
        id, revision: previous.revision + 1, createdAt: previous.createdAt,
        updatedAt: Date.now(), value: snapshot
      };
      if (Object.hasOwn(previous, "createdBy")) record.createdBy = previous.createdBy;
      await atomicPublish(context, this.directory, filename, recordBytes(record), "replace");
      return record;
    });
  }

  async delete(context: Context, id: DataId, options?: DeleteOptions): Promise<boolean> {
    const expectedRevision = captureRevision(options);
    const filename = recordFilename(id);
    return withRecordLock(context, this.directory, filename, async () => {
      const previous = await this.read(context, id, filename);
      checkRevision(id, previous, expectedRevision);
      if (previous === undefined) return false;
      await this.checkRetainedRevision(context, filename, previous.revision);
      await retainDeletedRevision(context, this.directory, filename, previous.revision);
      return deleteFile(context, this.directory, filename);
    });
  }

  async list(context: Context, options?: ListOptions): Promise<ListResult> {
    const captured = options === undefined ? undefined : { limit: options.limit, cursor: options.cursor };
    const filenames = await listFilenames(context, this.directory);
    const ids = filenames.filter((name) => name.endsWith(".json")).map((name) => {
      const id = name.slice(0, -5);
      recordFilename(id);
      return id;
    });
    return paginate(ids, captured, JSON.stringify(["filesystem-json-value", this.directory, this.model, this.id]));
  }

  private async prepare(context: Context, value: unknown): Promise<unknown> {
    context.signal?.throwIfAborted();
    // The serializer captures caller-owned data synchronously before its first
    // await. No later caller mutation or hook can affect this pending write.
    this.runtime.reflect(value);
    const content = await this.serializer.serialize(context, this.runtime.descriptor, value);
    const snapshot = await this.serializer.deserialize(context, this.runtime.descriptor, content);
    this.runtime.reflect(snapshot);
    context.signal?.throwIfAborted();
    return snapshot;
  }

  private async checkRetainedRevision(context: Context, filename: string, revision: number): Promise<void> {
    if (await readDeletedRevision(context, this.directory, filename) > revision) {
      throw Object.assign(new Error(`Record revision is older than retained deletion history: ${filename}`), { code: "INVALID_STORE_METADATA" });
    }
  }

  private async read(context: Context, id: DataId, filename: string): Promise<JsonRecord | undefined> {
    const file = await readFileSnapshot(context, this.directory, filename);
    if (file === undefined) return undefined;
    const record: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes));
    assertRecord(record, id);
    // Validate before JSON.stringify can normalize -0 or unsafe integers in a
    // manually edited record. The same strict round trip is used for writes.
    record.value = await this.prepare(context, record.value);
    return record;
  }
}

function recordFilename(id: DataId): string {
  validateFilename(id);
  const filename = `${id}.json`;
  validateFilename(filename);
  return filename;
}

function captureRevision(options: UpdateOptions | DeleteOptions | undefined): number | undefined {
  const revision = options?.expectedRevision;
  if (revision !== undefined) requirePositiveInteger(revision, "expectedRevision");
  return revision;
}

function checkRevision(id: string, record: JsonRecord | undefined, expected: number | undefined): void {
  if (expected !== undefined && record?.revision !== expected) {
    throw Object.assign(new Error(`Record ${id} revision conflict: expected ${expected}, found ${record?.revision ?? "missing"}`), {
      code: "REVISION_CONFLICT", details: { id, expectedRevision: expected, actualRevision: record?.revision }
    });
  }
}

export function parseFilesystemJsonValueStoreConfig(config: Config): { directory: string } {
  const json = config.json;
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new TypeError("config must be a JSON object");
  for (const key of Object.keys(json)) {
    if (key !== "directory") throw new TypeError(`Unknown filesystem JSON ValueStore configuration: ${key}`);
  }
  const directory = json.directory;
  requireString(directory, "config.directory");
  if (directory.trim().length === 0) throw new TypeError("config.directory must not be all whitespace");
  return { directory };
}

function recordBytes(record: JsonRecord): Uint8Array {
  // Only trusted metadata and a strict JSON-round-tripped value reach here.
  return new TextEncoder().encode(`${JSON.stringify(record, null, 2)}\n`);
}

export function assertRecord(value: unknown, id: string): asserts value is JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Invalid JSON record ${id}: expected an object`);
  }
  const record = value as Record<string, unknown>;
  const keys = new Set(["id", "revision", "createdAt", "updatedAt", "createdBy", "updatedBy", "value"]);
  for (const key of Object.keys(record)) {
    if (!keys.has(key)) throw new TypeError(`Invalid JSON record ${id}: unknown field ${key}`);
  }
  for (const key of ["id", "revision", "createdAt", "updatedAt", "value"]) {
    if (!Object.hasOwn(record, key)) throw new TypeError(`Invalid JSON record ${id}: missing ${key}`);
  }
  if (record.id !== id) throw new TypeError(`JSON record id does not match filename: expected ${id}`);
  requirePositiveInteger(record.revision, "record revision");
  for (const key of ["createdAt", "updatedAt"]) {
    const timestamp = record[key];
    if (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp < 0 || Object.is(timestamp, -0)) {
      throw new TypeError(`Invalid JSON record ${id}: ${key} must be a nonnegative millisecond timestamp`);
    }
  }
  for (const key of ["createdBy", "updatedBy"]) {
    if (Object.hasOwn(record, key) && record[key] !== null && typeof record[key] !== "string") {
      throw new TypeError(`Invalid JSON record ${id}: ${key} must be a string or null`);
    }
  }
}

export const filesystemJsonValueStoreExtension: DataExtension = {
  id: "memsphere/filesystem-json-valuestore",
  version: "0.1.0",
  valueStoreFactories: [new FilesystemJsonValueStoreFactory()]
};
