import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { readAll } from "../data/extensions/shared/payload.js";
import { serviceError } from "../project/business-stores.js";
import type { DataInput } from "../project/data-service.js";

export async function readInputBytes(path: string): Promise<Uint8Array> {
  return path === "-" ? readAll({}, { stream: () => Readable.toWeb(process.stdin) as ReadableStream<Uint8Array> }) : readFile(path);
}
export async function readInputText(path: string): Promise<string> {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readInputBytes(path)); }
  catch (cause) {
    if (cause instanceof TypeError) throw serviceError("INPUT_INVALID", "Input must be valid UTF-8", { cause: String(cause) });
    throw cause;
  }
}
export function parseJsonInput(text: string): unknown {
  try { return JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch (cause) { throw serviceError("INPUT_INVALID", "Input must be valid JSON", { cause: String(cause) }); }
}
export type ValueInputOptions = { value?: string; valueFile?: string; payloadFile?: string; contentType?: string };
export function assertInputOptions(options: ValueInputOptions, payloadAllowed = true) {
  const count = [options.value, options.valueFile, options.payloadFile].filter(value => value !== undefined).length;
  if (count !== 1) throw serviceError("INVALID_ARGUMENT", "Provide exactly one of value, value-file or payload-file");
  if (options.payloadFile !== undefined && !payloadAllowed) throw serviceError("UNSUPPORTED_CAPABILITY", "Payload input requires a DataStore");
  if (options.payloadFile !== undefined && options.contentType === undefined || options.payloadFile === undefined && options.contentType !== undefined)
    throw serviceError("INVALID_ARGUMENT", "payload-file and content-type must be provided together");
}
export async function readDataInput(options: ValueInputOptions, payloadAllowed = true): Promise<DataInput> {
  assertInputOptions(options, payloadAllowed);
  if (options.payloadFile !== undefined) return { kind: "payload", bytes: await readInputBytes(options.payloadFile), contentType: options.contentType! };
  return { kind: "value", value: parseJsonInput(options.value ?? await readInputText(options.valueFile!)) };
}
export function parseRevision(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const revision = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(revision) || revision < 1) throw serviceError("INVALID_ARGUMENT", "expected-revision must be a positive safe integer");
  return revision;
}
