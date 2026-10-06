import { query } from "jsonpath-rfc9535";
import { encodeJsonValue } from "../extensions/json-serializer/index.js";

export function queryJsonPath(value: unknown, path: string): unknown[] {
  encodeJsonValue(value);
  if (typeof path !== "string" || !path.startsWith("$")) throw Object.assign(new TypeError("path must be a JSONPath expression starting with $"), { code: "INVALID_PATH" });
  try { return query(value as Parameters<typeof query>[0], path); }
  catch (cause) { throw Object.assign(new TypeError(`Invalid JSONPath: ${cause instanceof Error ? cause.message : String(cause)}`, { cause }), { code: "INVALID_PATH" }); }
}
