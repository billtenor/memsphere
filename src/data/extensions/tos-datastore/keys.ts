import { createHash } from "node:crypto";
import { validateRelativeFilePath } from "../shared/filesystem.js";

export function objectKey(prefix: string, id: string): string {
  validateRelativeFilePath(id);
  const key = prefix + id;
  if (Buffer.byteLength(key, "utf8") > 1024) throw new TypeError("TOS object key exceeds 1024 bytes");
  return key;
}
export function cursorScope(identity: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
export function encodeCursor(scope: string, token: string): string {
  return Buffer.from(JSON.stringify({ v: 1, scope, token })).toString("base64url");
}
export function decodeCursor(scope: string, cursor: string): string {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor) || cursor.length > 16384) throw new Error();
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!value || typeof value !== "object" || !("v" in value) || value.v !== 1 || !("scope" in value) || value.scope !== scope ||
      !("token" in value) || typeof value.token !== "string" || !value.token) throw new Error();
    return value.token;
  } catch { throw new TypeError("Invalid or foreign TOS list cursor"); }
}
