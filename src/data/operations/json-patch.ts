import { encodeJsonValue } from "../extensions/json-serializer/index.js";

type JsonObject = Record<string, unknown>;
const noDocument = Symbol("removed JSON document");
function fail(message: string): never { throw Object.assign(new TypeError(message), { code: "INVALID_PATCH" }); }
function pointer(path: unknown): string[] {
  if (typeof path !== "string" || (path !== "" && !path.startsWith("/"))) fail("JSON Patch path/from must be a JSON Pointer");
  if (path === "") return [];
  return path.slice(1).split("/").map(segment => {
    if (/~(?:[^01]|$)/.test(segment)) fail("Invalid JSON Pointer escape");
    return segment.replaceAll("~1", "/").replaceAll("~0", "~");
  });
}
function index(key: string, length: number, add = false): number {
  if (key === "-" && add) return length;
  if (!/^(?:0|[1-9][0-9]*)$/.test(key)) fail("Invalid JSON Patch array index");
  const result = Number(key);
  if (!Number.isSafeInteger(result) || result >= length + (add ? 1 : 0)) fail("JSON Patch array index out of bounds");
  return result;
}
function get(root: unknown, parts: string[]): unknown {
  let value = root;
  for (const key of parts) {
    if (Array.isArray(value)) value = value[index(key, value.length)];
    else if (value !== null && typeof value === "object" && Object.hasOwn(value, key)) value = (value as JsonObject)[key];
    else fail("JSON Patch target does not exist");
  }
  if (value === noDocument) fail("JSON Patch document does not exist");
  return value;
}
function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, i) => equal(item, right[i]));
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  const keys = Object.keys(left); const other = Object.keys(right);
  return keys.length === other.length && keys.every(key => Object.hasOwn(right, key) && equal((left as JsonObject)[key], (right as JsonObject)[key]));
}
function change(root: unknown, parts: string[], op: "add" | "replace" | "remove", value?: unknown): unknown {
  if (!parts.length) {
    if (op !== "add" && root === noDocument) fail("JSON Patch document does not exist");
    return op === "remove" ? noDocument : structuredClone(value);
  }
  const parent = get(root, parts.slice(0, -1)); const key = parts.at(-1)!;
  if (Array.isArray(parent)) {
    const position = index(key, parent.length, op === "add");
    if (op === "add") parent.splice(position, 0, structuredClone(value));
    else if (op === "remove") parent.splice(position, 1);
    else parent[position] = structuredClone(value);
  } else if (parent !== null && typeof parent === "object") {
    if (op !== "add" && !Object.hasOwn(parent, key)) fail("JSON Patch target does not exist");
    if (op === "remove") delete (parent as JsonObject)[key];
    else Object.defineProperty(parent, key, { value: structuredClone(value), writable: true, enumerable: true, configurable: true });
  } else fail("JSON Patch parent must be an object or array");
  return root;
}
/** Complete patch on an isolated JSON copy. Runtime validation and CAS happen exactly once afterwards. */
export function applyJsonPatch(value: unknown, patch: unknown): unknown {
  encodeJsonValue(value); encodeJsonValue(patch);
  if (!Array.isArray(patch)) fail("JSON Patch must be an array");
  let result: unknown = structuredClone(value);
  for (const [operationIndex, entry] of patch.entries()) {
    try {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("JSON Patch operation must be an object");
      const operation = entry as JsonObject;
      const parts = pointer(operation.path);
      switch (operation.op) {
        case "add": case "replace":
          if (!Object.hasOwn(operation, "value")) fail("JSON Patch operation requires value");
          result = change(result, parts, operation.op, operation.value); break;
        case "remove": result = change(result, parts, "remove"); break;
        case "copy": case "move": {
          const from = pointer(operation.from);
          if (operation.op === "move" && parts.length > from.length && from.every((part, i) => parts[i] === part)) fail("Cannot move into a descendant");
          const copied = structuredClone(get(result, from));
          if (operation.op === "move") result = change(result, from, "remove");
          result = change(result, parts, "add", copied); break;
        }
        case "test":
          if (!Object.hasOwn(operation, "value") || !equal(get(result, parts), operation.value)) throw Object.assign(new Error("JSON Patch test failed"), { code: "PATCH_TEST_FAILED" });
          break;
        default: fail("Unknown JSON Patch operation");
      }
    } catch (cause) {
      const code = (cause as { code?: string }).code ?? "INVALID_PATCH";
      throw Object.assign(new Error(cause instanceof Error ? cause.message : String(cause), { cause }), { code, details: { operationIndex } });
    }
  }
  if (result === noDocument) fail("Patch removed the root; final result must be a JSON document");
  encodeJsonValue(result);
  return result;
}
