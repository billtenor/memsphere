import type { DataStore, StoredData } from "../../src/data/api/data-store.js";
import type { Data } from "../../src/data/api/data.js";
import type { Context } from "../../src/data/api/context.js";
import type { UpdateOptions, DeleteOptions, ListOptions } from "../../src/data/api/store.js";
import { bytesContent, readAll } from "../../src/data/extensions/shared/payload.js";
import { MemoryValueStore } from "./memory-value-store.js";

type Body = { bytes: Uint8Array; contentType: string };
/** Buffers input once; each get creates a fresh stream. CAS/uniqueness use the same record contract. */
export class MemoryDataStore implements DataStore {
  readonly kind = "DataStore" as const;
  constructor(readonly id: string, readonly model: string, private readonly records = new MemoryValueStore(id, model)) {}
  fork() { return new MemoryDataStore(this.id, this.model, this.records.fork()); }
  has(context: Context, id: string) { return this.records.has(context, id); }
  list(context: Context, options?: ListOptions) { return this.records.list(context, options); }
  async get(context: Context, id: string): Promise<StoredData | undefined> {
    const row = await this.records.get(context, id);
    if (!row) return;
    const { value, ...metadata } = row, body = value as Body;
    return { ...metadata, data: { id, model: this.model, payload: { contentType: body.contentType, content: bytesContent(body.bytes) } } };
  }
  private async body(context: Context, data: Data) {
    context.signal?.throwIfAborted();
    if (data.model !== this.model) throw new TypeError("Data model does not match Store");
    return { contentType: data.payload.contentType, bytes: await readAll(context, data.payload.content) };
  }
  async create(context: Context, data: Data) { const id = data.id; await this.records.create(context, id, await this.body(context, data)); }
  async update(context: Context, data: Data, options?: UpdateOptions) { const id = data.id; await this.records.update(context, id, await this.body(context, data), options); }
  delete(context: Context, id: string, options?: DeleteOptions) { return this.records.delete(context, id, options); }
}
