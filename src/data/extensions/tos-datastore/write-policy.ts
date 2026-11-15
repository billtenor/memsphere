import { decodeRevision } from "./revision.js";

/** Shared by the Store and read-only previews, before opening the input stream. */
export function validateTosWriteOptions(mode: "raw" | "revision", operation: "create" | "update" | "delete", expectedRevision: unknown) {
  const fail = (code: string, message: string): never => { throw Object.assign(new TypeError(message), { code }); };
  if (operation === "create") {
    if (expectedRevision !== undefined) fail("INVALID_ARGUMENT", "create does not accept expectedRevision");
    return undefined;
  }
  if (mode === "raw") {
    if (operation === "update" || expectedRevision !== undefined) fail("UNSUPPORTED_CAPABILITY", "Raw TOS Store does not support this write");
    return undefined;
  }
  try { return decodeRevision(expectedRevision); }
  catch { return fail("INVALID_ARGUMENT", "A valid TOS expectedRevision is required"); }
}
