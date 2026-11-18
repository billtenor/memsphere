import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import type { Context } from "../../api/context.js";
import type { ModelRuntime } from "../../api/model-runtime.js";
import type { ValueStore, StoredValue } from "../../api/value-store.js";
import type { DeleteOptions, UpdateOptions, ListOptions, ListResult } from "../../api/store.js";
import { assertJsonDescriptor } from "../json-serializer/index.js";
import { snapshotJsonValue, encodeJsonChunks, parseJsonChunks, jsonCheckpoint, JsonStreamError } from "../json-serializer/streaming.js";
import type { TosConnectionConfig } from "../tos-datastore/config.js";
import type { ObjectHeaders, TosObjectClient } from "../tos-datastore/client.js";
import { TosRequestError, writeOutcome } from "../tos-datastore/response.js";
import { assertEtag } from "../tos-datastore/revision.js";
import { cursorScope, objectKey, encodeCursor, decodeCursor } from "../tos-datastore/keys.js";

export const MAX_VALUE_OBJECT_BYTES = 4 * 1024 ** 3;
function fail(code: string, message: string): never { throw Object.assign(new Error(message), { code }); }
const missing = (e: unknown) => e instanceof TosRequestError && e.status === 404 && e.code === "NoSuchKey";
type Metadata = { etag: string; length: number; is_delete: boolean; createdAt?: number; updatedAt?: number; createdBy?: string };
type RecordBody = { storageVersion: 1; id: string; model: string; mutationId: string; is_delete: boolean;
  value?: unknown; createdAt?: number; updatedAt?: number; createdBy?: string };

/** JSON values and their HEAD mirror are committed in one conditional PUT. */
export class TosJsonValueStore implements ValueStore {
  readonly kind = "ValueStore" as const;
  readonly model: string;
  private readonly scope: string;
  constructor(readonly id: string, private readonly runtime: ModelRuntime, private readonly config: TosConnectionConfig,
    private readonly client: TosObjectClient, private readonly clock = () => Date.now(),
    private readonly mutation = () => randomBytes(8).toString("hex")) {
    this.model = runtime.descriptor.id;
    assertJsonDescriptor(runtime.descriptor.root);
    this.scope = cursorScope([id, this.model, "tos-json-v1", config.region, config.endpoint, config.bucket, config.prefix]);
  }
  async checkBucket(context: Context): Promise<void> {
    if (await this.client.versioning(context) !== "") fail("STORE_INCOMPATIBLE", "TOS requires a never-versioned bucket");
  }
  private key(id: string): string { objectKey(this.config.prefix, id); return objectKey(this.config.prefix, id + ".json"); }
  private idFromKey(key: string): string {
    if (!key.startsWith(this.config.prefix) || !key.endsWith(".json")) fail("STORE_INCOMPATIBLE", "Unexpected key in ValueStore prefix");
    const id = key.slice(this.config.prefix.length, -5);
    if (this.key(id) !== key) fail("STORE_INCOMPATIBLE", "Invalid ValueStore key");
    return id;
  }
  private metadata(headers: ObjectHeaders): Metadata {
    try { assertEtag(headers.etag); } catch { fail("INVALID_RESPONSE", "TOS returned an invalid ETag"); }
    const lengthText = headers["content-length"];
    if (!lengthText || !/^\d+$/.test(lengthText) || !Number.isSafeInteger(Number(lengthText))) fail("INVALID_RESPONSE", "Invalid TOS object length");
    const length = Number(lengthText);
    if (length > MAX_VALUE_OBJECT_BYTES) throw new JsonStreamError("VALUE_TOO_LARGE", "ValueStore object exceeds 4 GiB");
    const meta = (key: string) => headers[`x-tos-meta-memsphere-${key}`];
    if (headers["content-type"] !== "application/json" || meta("storage-version") !== "1" ||
        meta("model") !== Buffer.from(this.model).toString("base64url") || !["true", "false"].includes(meta("is_delete") ?? "")) {
      fail("STORE_INCOMPATIBLE", "Invalid TOS ValueStore metadata/model");
    }
    const result: Metadata = { etag: headers.etag!, length, is_delete: meta("is_delete") === "true" };
    if (result.is_delete) {
      if (["created-at", "updated-at", "created-by"].some(k => meta(k) !== undefined)) fail("STORE_INCOMPATIBLE", "Deleted record retains live metadata");
    } else {
      for (const [field, key] of [["createdAt", "created-at"], ["updatedAt", "updated-at"]] as const) {
        const value = meta(key);
        if (value === undefined || !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) fail("STORE_INCOMPATIBLE", "Invalid TOS timestamp metadata");
        result[field] = Number(value);
      }
      if (meta("created-by") !== undefined) {
        const bytes = Buffer.from(meta("created-by")!, "base64url");
        if (bytes.toString("base64url") !== meta("created-by")) fail("STORE_INCOMPATIBLE", "Invalid TOS actor metadata");
        try { result.createdBy = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
        catch { fail("STORE_INCOMPATIBLE", "Invalid TOS actor encoding"); }
      }
    }
    return result;
  }
  private async head(context: Context, id: string): Promise<Metadata | undefined> {
    context.signal?.throwIfAborted();
    const key = this.key(id);
    try { return this.metadata(await this.client.head(context, key)); }
    catch (e) {
      if (!(e instanceof TosRequestError) || e.status !== 404) throw e;
      // A HEAD404 alone cannot distinguish NoSuchKey from a missing bucket.
      try {
        const response = await this.client.read(context, key);
        try { if (response.status !== 200) fail("INVALID_RESPONSE", "Unexpected TOS status"); return this.metadata(response.headers); }
        finally { response.stream.destroy(); }
      } catch (diagnosis) { if (missing(diagnosis)) return undefined; throw diagnosis; }
    }
  }
  private async readRecord(context: Context, id: string): Promise<{ body: RecordBody; metadata: Metadata } | undefined> {
    context.signal?.throwIfAborted();
    let response;
    try { response = await this.client.read(context, this.key(id)); }
    catch (e) { if (missing(e)) return undefined; throw e; }
    const abort = () => response.stream.destroy(new TosRequestError("ABORTED"));
    context.signal?.addEventListener("abort", abort, { once: true });
    try {
      if (response.status !== 200 || response.headers["content-range"] || response.headers["content-encoding"]) fail("INVALID_RESPONSE", "Invalid ValueStore response");
      const metadata = this.metadata(response.headers);
      let count = 0;
      const source = (async function* () { for await (const chunk of response.stream) { count += chunk.byteLength; yield chunk as Uint8Array; } })();
      const parsed = await parseJsonChunks(context, source, { maxBytes: MAX_VALUE_OBJECT_BYTES });
      if (count !== metadata.length) fail("INVALID_RESPONSE", "TOS value response length mismatch");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("STORE_INCOMPATIBLE", "Invalid JSON record");
      const body = parsed as RecordBody;
      const allowed = metadata.is_delete ? ["storageVersion", "id", "model", "mutationId", "is_delete"] :
        ["storageVersion", "id", "model", "mutationId", "is_delete", "value", "createdAt", "updatedAt", "createdBy"];
      if (Object.keys(body).some(k => !allowed.includes(k)) || body.storageVersion !== 1 || body.id !== id || body.model !== this.model ||
          typeof body.mutationId !== "string" || !/^[0-9a-f]{16}$/.test(body.mutationId) || body.is_delete !== metadata.is_delete ||
          body.createdAt !== metadata.createdAt || body.updatedAt !== metadata.updatedAt || body.createdBy !== metadata.createdBy ||
          (!body.is_delete && !Object.hasOwn(body, "value"))) fail("STORE_INCOMPATIBLE", "JSON record and HEAD mirror disagree");
      if (!body.is_delete) this.runtime.reflect(body.value);
      await jsonCheckpoint(context);
      return { body, metadata };
    } finally { context.signal?.removeEventListener("abort", abort); response.stream.destroy(); }
  }
  async get(context: Context, id: string): Promise<StoredValue | undefined> {
    const record = await this.readRecord(context, id);
    return record && !record.body.is_delete ? this.publicValue(record.body, record.metadata.etag) : undefined;
  }
  async has(context: Context, id: string): Promise<boolean> { const metadata = await this.head(context, id); return !!metadata && !metadata.is_delete; }
  private publicValue(body: RecordBody, revision: string): StoredValue {
    return { id: body.id, value: body.value, revision, createdAt: body.createdAt, updatedAt: body.updatedAt,
      ...(body.createdBy === undefined ? {} : { createdBy: body.createdBy }) };
  }
  private expected(options?: UpdateOptions): string | undefined {
    if (options?.expectedRevision === undefined) return undefined;
    try { assertEtag(options.expectedRevision); } catch { fail("INVALID_ARGUMENT", "Expected a single Store revision"); }
    return options.expectedRevision;
  }
  private async write(context: Context, id: string, value: unknown, operation: "create" | "update" | "upsert" | "delete", options?: UpdateOptions): Promise<StoredValue | boolean> {
    context.signal?.throwIfAborted(); this.key(id);
    const expected = this.expected(options);
    // Capture synchronously before HEAD or any other asynchronous work.
    const snapshot = operation === "delete" ? undefined : snapshotJsonValue(value);
    if (operation !== "delete") this.runtime.reflect(snapshot);
    await jsonCheckpoint(context);
    const previous = await this.head(context, id);
    const live = previous && !previous.is_delete;
    if (expected !== undefined && (!live || expected !== previous.etag)) fail("REVISION_CONFLICT", "Record revision does not match");
    if (operation === "create" && live) fail("ALREADY_EXISTS", "Record already exists");
    if (operation === "update" && !live) fail("NOT_FOUND", "Record does not exist");
    if (operation === "delete" && !live) return false;
    const now = this.clock(), mutationId = this.mutation();
    if (!Number.isSafeInteger(now) || now < 0 || !/^[0-9a-f]{16}$/.test(mutationId)) fail("INVALID_ARGUMENT", "Invalid metadata source");
    const body: RecordBody = { storageVersion: 1, id, model: this.model, mutationId, is_delete: operation === "delete" };
    const meta: Record<string, string> = { "memsphere-storage-version": "1", "memsphere-model": Buffer.from(this.model).toString("base64url"), "memsphere-is_delete": String(body.is_delete) };
    if (!body.is_delete) {
      body.createdAt = live ? previous.createdAt! : now; body.updatedAt = now; body.value = snapshot;
      meta["memsphere-created-at"] = String(body.createdAt); meta["memsphere-updated-at"] = String(now);
      if (live && previous.createdBy !== undefined) { body.createdBy = previous.createdBy; meta["memsphere-created-by"] = Buffer.from(body.createdBy).toString("base64url"); }
    }
    const stream = Readable.from(encodeJsonChunks(context, body, { maxBytes: MAX_VALUE_OBJECT_BYTES }));
    const settled = finished(stream, { cleanup: true }).catch(() => undefined);
    try {
      const headers = await this.client.put(context, this.key(id), stream, { meta, contentType: "application/json",
        ...(previous ? { ifMatch: previous.etag } : { create: true }) });
      try { assertEtag(headers.etag); } catch { fail("INVALID_RESPONSE", "Write may have committed but returned no valid ETag"); }
      context.signal?.throwIfAborted();
      return body.is_delete ? true : this.publicValue(body, headers.etag!);
    } catch (error) {
      if (error instanceof TosRequestError) {
        if (error.status === 412 && ["ConditionNotMet", "PreconditionFailed"].includes(error.code)) fail(operation === "create" ? "ALREADY_EXISTS" : "REVISION_CONFLICT", "TOS conditional write conflicts");
        if (error.code === "EntityTooLarge") throw new JsonStreamError("VALUE_TOO_LARGE", "TOS rejected object size");
      }
      throw writeOutcome(error);
    } finally { stream.destroy(); await settled; }
  }
  create(context: Context, id: string, value: unknown): Promise<StoredValue> { return this.write(context, id, value, "create") as Promise<StoredValue>; }
  update(context: Context, id: string, value: unknown, options?: UpdateOptions): Promise<StoredValue> { return this.write(context, id, value, "update", options) as Promise<StoredValue>; }
  upsert(context: Context, id: string, value: unknown): Promise<StoredValue> { return this.write(context, id, value, "upsert") as Promise<StoredValue>; }
  delete(context: Context, id: string, options?: DeleteOptions): Promise<boolean> { return this.write(context, id, undefined, "delete", options) as Promise<boolean>; }
  async list(context: Context, options: ListOptions = {}): Promise<ListResult> {
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) fail("INVALID_ARGUMENT", "Invalid list limit");
    let token = options.cursor === undefined ? undefined : decodeCursor(this.scope, options.cursor);
    const items: Array<{ id: string }> = [];
    for (let page = 0; page < 10; page++) {
      const result = await this.client.list(context, { prefix: this.config.prefix, limit: Math.min(128, limit - items.length), token });
      const ids = result.keys.map(key => this.idFromKey(key));
      for (let start = 0; start < ids.length; start += 8) {
        const controller = new AbortController(), signal = context.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal;
        const pending = ids.slice(start, start + 8).map(id => this.head({ signal }, id));
        let rows;
        try { rows = await Promise.all(pending); } catch (e) { controller.abort(); await Promise.allSettled(pending); throw e; }
        rows.forEach((row, index) => { if (row && !row.is_delete) items.push({ id: ids[start + index] }); });
      }
      if (token && result.token === token) fail("INVALID_RESPONSE", "TOS pagination made no progress");
      token = result.token;
      if (!token || items.length >= limit) break;
    }
    return { items, ...(token ? { nextCursor: encodeCursor(this.scope, token) } : {}) };
  }
  async *inspectPhysicalRecords(context: Context): AsyncGenerator<RecordBody> {
    let token: string | undefined;
    do {
      const page = await this.client.list(context, { prefix: this.config.prefix, limit: 128, token });
      for (const key of page.keys) { const record = await this.readRecord(context, this.idFromKey(key)); if (!record) fail("STORE_CHANGED", "Record vanished during compatibility scan"); yield record.body; }
      if (token && page.token === token) fail("INVALID_RESPONSE", "TOS pagination made no progress");
      token = page.token;
    } while (token);
  }
}
