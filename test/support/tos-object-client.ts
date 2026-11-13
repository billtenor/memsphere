import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { Context } from "../../src/data/api/context.js";
import type { ObjectHeaders, TosObjectClient } from "../../src/data/extensions/tos-datastore/client.js";
import { TosRequestError } from "../../src/data/extensions/tos-datastore/response.js";

type StoredObject = { bytes: Buffer; headers: ObjectHeaders };
/** Commits compare conditions against the current object, after body consumption. */
export class MemoryTosClient implements TosObjectClient {
  readonly objects = new Map<string, StoredObject>();
  readonly calls: Array<{ method: string; key?: string; ifMatch?: string; create?: boolean }> = [];
  beforeCommit?: (key: string) => Promise<void>;
  version = "";
  async versioning() { this.calls.push({ method: "VERSIONING" }); return this.version; }
  async head(context: Context, key: string) {
    context.signal?.throwIfAborted(); this.calls.push({ method: "HEAD", key });
    const object = this.objects.get(key);
    if (!object) throw new TosRequestError("HTTP_404", 404, "fake");
    return { ...object.headers };
  }
  async read(context: Context, key: string, options: { range?: string; ifMatch?: string } = {}) {
    context.signal?.throwIfAborted(); this.calls.push({ method: "GET", key, ifMatch: options.ifMatch });
    const object = this.objects.get(key);
    if (!object) throw new TosRequestError("NoSuchKey", 404, "fake");
    if (options.ifMatch && object.headers.etag !== options.ifMatch) throw new TosRequestError("PreconditionFailed", 412, "fake");
    let bytes = object.bytes; const headers = { ...object.headers };
    if (options.range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(options.range); if (!match) throw new Error("Invalid fake range");
      const start = +match[1], end = match[2] ? +match[2] : bytes.length - 1;
      if (start > end || end >= bytes.length) throw new TosRequestError("InvalidRange", 416, "fake");
      headers["content-range"] = `bytes ${start}-${end}/${bytes.length}`;
      bytes = bytes.subarray(start, end + 1); headers["content-length"] = String(bytes.length);
    }
    return { headers, stream: Readable.from([Buffer.from(bytes)]), status: options.range ? 206 : 200 };
  }
  async put(context: Context, key: string, body: Readable, options: { meta: Record<string, string>; contentType: string; ifMatch?: string; create?: boolean }) {
    context.signal?.throwIfAborted(); this.calls.push({ method: "PUT", key, ifMatch: options.ifMatch, create: options.create });
    const abort = () => body.destroy(Object.assign(new Error("aborted"), { code: "ABORTED" }));
    context.signal?.addEventListener("abort", abort, { once: true });
    const chunks: Buffer[] = [];
    try { for await (const chunk of body) { context.signal?.throwIfAborted(); chunks.push(Buffer.from(chunk)); } }
    finally { context.signal?.removeEventListener("abort", abort); }
    await this.beforeCommit?.(key);
    context.signal?.throwIfAborted();
    const previous = this.objects.get(key);
    if (options.create && previous || options.ifMatch && previous?.headers.etag !== options.ifMatch) throw new TosRequestError("PreconditionFailed", 412, "fake");
    const bytes = Buffer.concat(chunks);
    const headers: ObjectHeaders = { etag: '"' + createHash("md5").update(bytes).digest("hex") + '"', "content-length": String(bytes.length), "content-type": options.contentType };
    for (const [key, value] of Object.entries(options.meta)) headers[`x-tos-meta-${key}`] = value;
    this.objects.set(key, { bytes, headers }); return { ...headers };
  }
  async delete(context: Context, key: string) { context.signal?.throwIfAborted(); this.calls.push({ method: "DELETE", key }); this.objects.delete(key); }
  async list(context: Context, options: { prefix: string; limit: number; token?: string }) {
    context.signal?.throwIfAborted(); this.calls.push({ method: "LIST" });
    const keys = [...this.objects.keys()].filter(key => key.startsWith(options.prefix)).sort();
    const index = options.token ? Number(options.token) : 0;
    const selected = keys.slice(index, index + options.limit);
    return { keys: selected, ...(index + selected.length < keys.length ? { token: String(index + selected.length) } : {}) };
  }
}
