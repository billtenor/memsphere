import { createHash } from "node:crypto";

export type PaginationOptions = { limit?: number | string; cursor?: string };
export type Page<T> = { items: T[]; nextCursor?: string };
export type CursorScope = { command: string; scope: unknown; filters?: unknown };

export class PaginationError extends Error {
  readonly code: "INVALID_ARGUMENT" | "INVALID_CURSOR";
  constructor(message: string, code: "INVALID_ARGUMENT" | "INVALID_CURSOR" = "INVALID_ARGUMENT") {
    super(message);
    this.name = "PaginationError";
    this.code = code;
  }
}

export function parseListLimit(value: unknown): number {
  if (value === undefined) return 100;
  if (typeof value === "string" && !/^[0-9]+$/.test(value)) {
    throw new PaginationError("limit must be an integer between 1 and 1000");
  }
  const limit = typeof value === "string" ? Number(value) : value;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new PaginationError("limit must be an integer between 1 and 1000");
  }
  return limit;
}

/** A continuation may be a position in an ordered list, or a Store's opaque token. */
export function encodeListCursor(scope: CursorScope, position: string): string {
  const fingerprint = digest(canonicalJson(scope));
  const body = { version: 1, scope: fingerprint, position };
  return Buffer.from(JSON.stringify({ ...body, check: digest(JSON.stringify(body)) }), "utf8").toString("base64url");
}

export function decodeListCursor(cursor: string | undefined, scope: CursorScope): string | undefined {
  if (cursor === undefined) return undefined;
  try {
    if (typeof cursor !== "string" || !cursor) throw new Error();
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.toString("base64url") !== cursor) throw new Error();
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const record = value as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "check,position,scope,version"
      || record.version !== 1 || record.scope !== digest(canonicalJson(scope))
      || typeof record.position !== "string") throw new Error();
    const body = { version: 1, scope: record.scope, position: record.position };
    if (record.check !== digest(JSON.stringify(body))) throw new Error();
    return record.position;
  } catch {
    throw new PaginationError("Invalid cursor or cursor does not match this command, scope, or filters", "INVALID_CURSOR");
  }
}

/** Callers filter and order the complete collection before selecting a page. */
export function paginateItems<T>(items: readonly T[], options: PaginationOptions, scope: CursorScope): Page<T> {
  const limit = parseListLimit(options.limit);
  const position = decodeListCursor(options.cursor, scope);
  const offset = position === undefined ? 0 : Number(position);
  if ((position !== undefined && !/^(0|[1-9][0-9]*)$/.test(position))
    || !Number.isSafeInteger(offset) || offset < 0) {
    throw new PaginationError("Invalid list cursor position", "INVALID_CURSOR");
  }
  const selected = items.slice(offset, offset + limit + 1);
  const more = selected.length > limit;
  const page: Page<T> = { items: selected.slice(0, limit) };
  if (more) page.nextCursor = encodeListCursor(scope, String(offset + limit));
  return page;
}

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => compareStrings(a, b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  throw new TypeError("Cursor scope must contain only JSON values");
}
