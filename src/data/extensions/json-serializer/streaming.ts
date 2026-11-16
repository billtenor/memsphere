import { setImmediate } from "node:timers/promises";
import { JSONParser } from "@streamparser/json";
import type { Context } from "../../api/context.js";
import { assertJsonValue } from "./index.js";

export class JsonStreamError extends Error {
  constructor(readonly code: "VALUE_TOO_LARGE" | "VALUE_RUNTIME_LIMIT" | "INVALID_JSON", message: string) { super(message); }
}

/** Capture only JSON data; validation never invokes getters or serialization hooks. */
export function snapshotJsonValue(value: unknown): unknown {
  assertJsonValue(value);
  const clone = (item: unknown): unknown => {
    if (item === null || typeof item !== "object") return item;
    const result: Record<string, unknown> | unknown[] = Array.isArray(item) ? [] : {};
    for (const key of Object.keys(item)) Object.defineProperty(result, key, {
      value: clone(Object.getOwnPropertyDescriptor(item, key)!.value), enumerable: true, writable: true, configurable: true
    });
    return result;
  };
  return clone(value);
}

export async function jsonCheckpoint(context: Context): Promise<void> {
  await setImmediate();
  context.signal?.throwIfAborted();
}

function* quoted(text: string): Generator<string> {
  yield '"';
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + 4096, text.length);
    // Keep a surrogate pair together; lone surrogates retain JSON's escaping.
    if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff &&
        text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) end--;
    yield JSON.stringify(text.slice(offset, end)).slice(1, -1);
    offset = end;
  }
  yield '"';
}
function* pieces(value: unknown, depth: number, pretty: boolean): Generator<string> {
  if (typeof value === "string") { yield* quoted(value); return; }
  if (value === null || typeof value !== "object") { yield JSON.stringify(value); return; }
  const array = Array.isArray(value), keys = Object.keys(value);
  yield array ? "[" : "{";
  for (let index = 0; index < keys.length; index++) {
    if (index) yield ",";
    if (pretty) yield "\n" + "  ".repeat(depth + 1);
    const key = keys[index];
    if (!array) { yield* quoted(key); yield pretty ? ": " : ":"; }
    yield* pieces((value as Record<string, unknown>)[key], depth + 1, pretty);
  }
  if (pretty && keys.length) yield "\n" + "  ".repeat(depth);
  yield array ? "]" : "}";
}

/** Single-pass UTF-8 output, without a complete document string or pre-count. */
export async function* encodeJsonChunks(context: Context, snapshot: unknown,
  options: { maxBytes?: number; pretty?: boolean } = {}): AsyncGenerator<Uint8Array> {
  context.signal?.throwIfAborted();
  let pending = "", count = 0;
  const output = (text: string): Uint8Array => {
    const bytes = Buffer.from(text, "utf8");
    count += bytes.byteLength;
    if (count > (options.maxBytes ?? Infinity)) throw new JsonStreamError("VALUE_TOO_LARGE", "JSON exceeds the Store byte limit");
    return bytes;
  };
  for (const piece of pieces(snapshot, 0, options.pretty ?? true)) {
    pending += piece;
    if (pending.length >= 16384) {
      await jsonCheckpoint(context);
      yield output(pending); pending = "";
    }
  }
  await jsonCheckpoint(context);
  yield output(pending + "\n");
}

/** Decode one full root and wait for clean EOF, including trailing whitespace. */
export async function parseJsonChunks(context: Context, input: AsyncIterable<Uint8Array>,
  options: { maxBytes?: number } = {}): Promise<unknown> {
  context.signal?.throwIfAborted();
  const parser = new JSONParser({ paths: ["$"], keepStack: true, stringBufferSize: 65536 });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let value: unknown, roots = 0, bytes = 0;
  parser.onValue = result => { value = result.value; roots++; };
  const feed = (part: Uint8Array, final = false) => {
    try {
      const text = decoder.decode(part, { stream: !final });
      if (text.length) parser.write(text);
      if (final && !parser.isEnded) parser.end();
    } catch (error) {
      if (error instanceof RangeError) throw new JsonStreamError("VALUE_RUNTIME_LIMIT", "JSON exceeds JavaScript representation limits");
      throw new JsonStreamError("INVALID_JSON", "Invalid or truncated UTF-8 JSON document");
    }
  };
  for await (const chunk of input) {
    if (!(chunk instanceof Uint8Array)) throw new JsonStreamError("INVALID_JSON", "Expected UTF-8 JSON bytes");
    bytes += chunk.byteLength;
    if (bytes > (options.maxBytes ?? Infinity)) throw new JsonStreamError("VALUE_TOO_LARGE", "JSON exceeds the Store byte limit");
    for (let offset = 0; offset < chunk.length; offset += 65536) {
      await jsonCheckpoint(context); feed(chunk.subarray(offset, offset + 65536));
    }
  }
  feed(new Uint8Array(), true);
  if (roots !== 1) throw new JsonStreamError("INVALID_JSON", "Expected exactly one JSON root");
  assertJsonValue(value);
  await jsonCheckpoint(context);
  return value;
}
