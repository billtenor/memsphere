import { validateTosWriteOptions } from "./write-policy.js";
import { Readable } from "node:stream";
import type { Context } from "../../api/context.js";
import type { Data } from "../../api/data.js";
import type { DataStore, DataStoreReadResult, DeletedStoredData, StoredData } from "../../api/data-store.js";
import type { DeleteOptions, ListOptions, ListResult, UpdateOptions } from "../../api/store.js";
import { throwIfAborted } from "../shared/payload.js";
import type { TosConfig } from "./config.js";
import type { ObjectHeaders, TosObjectClient } from "./client.js";
import { TosRequestError, readBounded } from "./context-sdk.js";
import { HEADER_SIZE, MAX_OBJECT_BYTES, encodeHeader, decodeHeader } from "./header.js";
import { assertEtag, decodeRevision, encodeRevision } from "./revision.js";
import { objectKey, cursorScope, encodeCursor, decodeCursor } from "./keys.js";

type Snapshot = { headers: ObjectHeaders; length: number; etag: string; counter?: number; deleted: boolean; contentType?: string };
export function storeError(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }); }
function responseError(): never { throw storeError("INVALID_RESPONSE", "Invalid TOS object response"); }
function lengthOf(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) responseError();
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length > MAX_OBJECT_BYTES) responseError();
  return length;
}
export function validateTosMime(value: unknown): string {
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[^\r\n\x00-\x1f]*)?$/.test(value)) {
    throw storeError("INVALID_ARGUMENT", "A valid Payload MIME type is required");
  }
  return value;
}

export class TosDataStore implements DataStore {
  readonly kind = "DataStore" as const;
  readonly capabilities: NonNullable<DataStore["capabilities"]>;
  private readonly scope: string;
  private readonly encodedModel: string;
  constructor(readonly id: string, readonly model: string, private readonly config: TosConfig, private readonly client: TosObjectClient) {
    this.capabilities = Object.freeze(config.mode === "raw" ? { update: false } : { update: true, conditionalWrite: Object.freeze({ required: true }) });
    this.scope = cursorScope([id, model, config.region, config.endpoint, config.bucket, config.prefix, config.mode]);
    this.encodedModel = Buffer.from(model).toString("base64url");
  }

  async checkBucket(context: Context): Promise<void> {
    throwIfAborted(context);
    const state = await this.client.versioning(context);
    if (state !== "") throw storeError("STORE_INCOMPATIBLE", "TOS Store requires a bucket that has never enabled versioning");
  }
  private key(id: string) { return objectKey(this.config.prefix, id); }
  private metadata(contentType?: string): Record<string, string> {
    return { "memsphere-store-format": `${this.config.mode}-v1`, "memsphere-model": this.encodedModel,
      ...(contentType ? { "memsphere-content-type": contentType } : {}) };
  }
  private identity(headers: ObjectHeaders, deleted: boolean): string | undefined {
    if (headers["x-tos-meta-memsphere-store-format"] !== `${this.config.mode}-v1` || headers["x-tos-meta-memsphere-model"] !== this.encodedModel) {
      throw storeError("STORE_INCOMPATIBLE", "TOS object format/model does not match the Store");
    }
    if (this.config.mode === "revision" && headers["content-type"] !== "application/octet-stream") responseError();
    if (deleted) return undefined;
    let type: string;
    try { type = validateTosMime(headers["x-tos-meta-memsphere-content-type"]); }
    catch { throw storeError("STORE_INCOMPATIBLE", "TOS object has invalid MIME metadata"); }
    if (this.config.mode === "raw" && headers["content-type"] !== type) responseError();
    return type;
  }
  private async head(context: Context, key: string): Promise<ObjectHeaders | undefined> {
    const controller = new AbortController();
    const relay = () => controller.abort(context.signal?.reason);
    const timer = setTimeout(() => controller.abort(new TosRequestError("TOS_DEADLINE")), 120_000); timer.unref();
    context.signal?.addEventListener("abort", relay, { once: true });
    if (context.signal?.aborted) relay();
    try { return await this.confirmHead({ signal: controller.signal }, key); }
    finally { clearTimeout(timer); context.signal?.removeEventListener("abort", relay); }
  }
  private async confirmHead(context: Context, key: string): Promise<ObjectHeaders | undefined> {
    try { return await this.client.head(context, key); }
    catch (error) {
      if (!(error instanceof TosRequestError) || error.status !== 404) throw error;
      // HEAD alone cannot tell a missing key from a missing bucket.
      try {
        const confirmation = await this.client.read(context, key);
        confirmation.stream.destroy();
      } catch (diagnosis) {
        if (diagnosis instanceof TosRequestError && diagnosis.code === "NoSuchKey") return undefined;
        throw diagnosis;
      }
      try { return await this.client.head(context, key); }
      catch (changed) {
        if (changed instanceof TosRequestError && changed.status === 404) throw storeError("STORE_CHANGED", "TOS object changed during existence confirmation");
        throw changed;
      }
    }
  }
  private async snapshot(context: Context, id: string): Promise<Snapshot | undefined> {
    const key = this.key(id);
    if (this.config.mode === "raw") {
      const headers = await this.head(context, key);
      if (!headers) return undefined;
      const etag = headers.etag; assertEtag(etag);
      return { headers, etag, length: lengthOf(headers["content-length"]), deleted: false, contentType: this.identity(headers, false) };
    }
    let response;
    try { response = await this.client.read(context, key, { range: "bytes=0-9" }); }
    catch (error) { if (error instanceof TosRequestError && error.code === "NoSuchKey") return undefined; throw error; }
    try {
      const { headers } = response;
      const match = /^bytes 0-9\/(\d+)$/.exec(headers["content-range"] ?? "");
      if (response.status !== 206 || !match || (headers["content-length"] !== undefined && headers["content-length"] !== "10")) responseError();
      const length = lengthOf(match[1]); if (length < HEADER_SIZE) responseError();
      const etag = headers.etag; assertEtag(etag);
      const { counter, deleted } = decodeHeader(await readBounded(response.stream, HEADER_SIZE));
      if (deleted && length !== HEADER_SIZE) responseError();
      return { headers, etag, counter, deleted, length, contentType: this.identity(headers, deleted) };
    } finally { response.stream.destroy(); }
  }
  async get(context: Context, id: string): Promise<DataStoreReadResult | undefined> {
    throwIfAborted(context);
    const snapshot = await this.snapshot(context, id);
    if (!snapshot) return undefined;
    const revision = snapshot.counter === undefined ? undefined : encodeRevision(snapshot.counter, snapshot.etag);
    const stamp = Date.parse(snapshot.headers["last-modified"] ?? "");
    const updated = Number.isFinite(stamp) ? { updatedAt: stamp } : {};
    if (snapshot.deleted) return { id, model: this.model, deleted: true, revision: revision!, ...updated } satisfies DeletedStoredData;
    return { data: { id, model: this.model, payload: { contentType: snapshot.contentType!, content: { stream: this.lazyContent(context, id, snapshot) } } },
      ...(revision === undefined ? {} : { revision }), ...updated } satisfies StoredData;
  }
  async has(context: Context, id: string): Promise<boolean> { return (await this.snapshot(context, id)) !== undefined; }

  private lazyContent(context: Context, id: string, snapshot: Snapshot): () => ReadableStream<Uint8Array> {
    let used = false;
    return () => {
      if (used) throw storeError("INVALID_ARGUMENT", "Payload can only be consumed once");
      used = true;
      const controller = new AbortController();
      const signal = context.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal;
      const start = this.config.mode === "revision" ? HEADER_SIZE : 0;
      const expected = snapshot.length - start;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let bytes = 0;
      const key = this.key(id);
      return new ReadableStream<Uint8Array>({
        pull: async output => {
          try {
            throwIfAborted({ signal });
            if (!expected) { output.close(); return; }
            if (!reader) {
              const response = await this.client.read({ signal }, key, { ifMatch: snapshot.etag, ...(start ? { range: "bytes=10-" } : {}) });
              try {
                if (response.status !== (start ? 206 : 200) || response.headers.etag !== snapshot.etag ||
                  (response.headers["content-length"] !== undefined && lengthOf(response.headers["content-length"]) !== expected) ||
                  (start && response.headers["content-range"] !== `bytes 10-${snapshot.length - 1}/${snapshot.length}`)) responseError();
                reader = (Readable.toWeb(response.stream) as ReadableStream<Uint8Array>).getReader();
              } catch (error) { response.stream.destroy(); throw error; }
            }
            const next = await reader.read();
            throwIfAborted({ signal });
            if (next.done) {
              if (bytes !== expected) responseError();
              reader.releaseLock(); output.close();
            } else {
              if (!(next.value instanceof Uint8Array)) responseError();
              bytes += next.value.byteLength; if (bytes > expected) responseError();
              output.enqueue(next.value);
            }
          } catch (error) {
            controller.abort(); void reader?.cancel().catch(() => undefined);
            output.error(this.writeError(error, false));
          }
        },
        cancel: reason => { controller.abort(); void reader?.cancel(reason).catch(() => undefined); }
      });
    };
  }

  private target(data: Data): string {
    const key = this.key(data.id);
    if (data.model !== this.model) throw storeError("STORE_INCOMPATIBLE", "Data model does not match TOS Store");
    validateTosMime(data.payload.contentType);
    return key;
  }
  private writeError(error: unknown, create: boolean): unknown {
    if (error instanceof TosRequestError && (error.status === 412 || error.code === "NoSuchKey" || (create && error.status === 409))) {
      return storeError(create ? "ALREADY_EXISTS" : "REVISION_CONFLICT", "TOS record conflicts with the supplied condition");
    }
    return error;
  }
  async create(context: Context, data: Data): Promise<void> {
    throwIfAborted(context); const key = this.target(data);
    const body = createTosUploadBody(context, data, this.config.mode === "revision" ? encodeHeader(1, false) : undefined);
    try { await this.client.put(context, key, body, { create: true, contentType: this.config.mode === "raw" ? data.payload.contentType : "application/octet-stream", meta: this.metadata(data.payload.contentType) }); }
    catch (error) { throw this.writeError(error, true); }
    finally { body.destroy(); }
  }
  async update(context: Context, data: Data, options?: UpdateOptions): Promise<void> {
    throwIfAborted(context); const key = this.target(data);
    const { counter, etag } = validateTosWriteOptions(this.config.mode, "update", options?.expectedRevision)!;
    const body = createTosUploadBody(context, data, encodeHeader((counter + 1) >>> 0, false));
    try { await this.client.put(context, key, body, { ifMatch: etag, contentType: "application/octet-stream", meta: this.metadata(data.payload.contentType) }); }
    catch (error) { throw this.writeError(error, false); }
    finally { body.destroy(); }
  }
  async delete(context: Context, id: string, options?: DeleteOptions): Promise<boolean> {
    throwIfAborted(context); const key = this.key(id);
    const condition = validateTosWriteOptions(this.config.mode, "delete", options?.expectedRevision);
    if (this.config.mode === "raw") {
      if (!(await this.snapshot(context, id))) return false;
      await this.client.delete(context, key); return true;
    }
    const { counter, etag } = condition!;
    const body = Readable.from([encodeHeader((counter + 1) >>> 0, true)]);
    try { await this.client.put(context, key, body, { ifMatch: etag, contentType: "application/octet-stream", meta: this.metadata() }); return true; }
    catch (error) { throw this.writeError(error, false); }
    finally { body.destroy(); }
  }
  async list(context: Context, options?: ListOptions): Promise<ListResult> {
    const limit = options?.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw storeError("INVALID_ARGUMENT", "List limit must be between 1 and 1000");
    let token = options?.cursor === undefined ? undefined : decodeCursor(this.scope, options.cursor);
    const items: Array<{ id: string }> = [];
    for (let page = 0; page < 10; page++) {
      throwIfAborted(context);
      const result = await this.client.list(context, { prefix: this.config.prefix, limit: Math.min(128, limit - items.length), token });
      const ids = result.keys.map(key => {
        if (!key.startsWith(this.config.prefix)) responseError();
        const id = key.slice(this.config.prefix.length); this.key(id); return id;
      });
      for (let index = 0; index < ids.length; index += 8) {
        const records = await Promise.all(ids.slice(index, index + 8).map(id => this.snapshot(context, id)));
        records.forEach((record, offset) => { if (record && !record.deleted) items.push({ id: ids[index + offset] }); });
      }
      if (token && result.token === token) throw storeError("STORE_CHANGED", "TOS list cursor made no progress");
      token = result.token;
      if (!token || items.length === limit) break;
    }
    return { items, ...(token ? { nextCursor: encodeCursor(this.scope, token) } : {}) };
  }
  /** Physical enumeration includes tombstones; used only for compatibility checks. */
  async *inspectPhysicalRecords(context: Context): AsyncGenerator<DataStoreReadResult> {
    let token: string | undefined;
    do {
      const page = await this.client.list(context, { prefix: this.config.prefix, limit: 128, token });
      for (const key of page.keys) {
        if (!key.startsWith(this.config.prefix)) responseError();
        const record = await this.get(context, key.slice(this.config.prefix.length));
        if (!record) throw storeError("STORE_CHANGED", "TOS record vanished during compatibility scan");
        yield record;
      }
      if (token && page.token === token) throw storeError("STORE_CHANGED", "TOS compatibility cursor made no progress");
      token = page.token;
    } while (token);
  }
}

export function createTosUploadBody(context: Context, data: Data, header?: Uint8Array, maximumBytes = MAX_OBJECT_BYTES): Readable {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let cancelled = false, sentHeader = false, bytes = header?.byteLength ?? 0;
    const cancel = () => {
      cancelled = true;
      context.signal?.removeEventListener("abort", cancel);
      if (reader) { void reader.cancel().catch(() => undefined); try { reader.releaseLock(); } catch { /* A pending pull releases below. */ } }
    };
    context.signal?.addEventListener("abort", cancel, { once: true });
    const stream = new ReadableStream<Uint8Array>({
      pull: async output => {
        try {
          throwIfAborted(context);
          if (cancelled) return;
          if (header && !sentHeader) { sentHeader = true; output.enqueue(header); return; }
          reader ??= data.payload.content.stream().getReader();
          const next = await reader.read();
          if (cancelled) { reader.releaseLock(); return; }
          throwIfAborted(context);
          if (next.done) {
            reader.releaseLock(); context.signal?.removeEventListener("abort", cancel); output.close();
          } else {
            if (!(next.value instanceof Uint8Array)) throw storeError("INVALID_ARGUMENT", "Payload chunks must be Uint8Array");
            bytes += next.value.byteLength;
            if (!Number.isSafeInteger(bytes) || bytes > maximumBytes) throw new TosRequestError("PAYLOAD_TOO_LARGE");
            output.enqueue(next.value);
          }
        } catch (error) { cancel(); output.error(error); }
      },
      cancel
    });
    // fromWeb propagates destroy immediately to the upstream reader, including a
    // stalled pull; destroying an async-generator Readable can wait for that pull.
    return Readable.fromWeb(stream as import("node:stream/web").ReadableStream<Uint8Array>);
  }
