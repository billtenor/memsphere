/** A single opaque object ETag, never an HTTP conditional expression. */
export function assertEtag(etag: unknown): asserts etag is string {
  if (typeof etag !== "string" || !etag.length || etag.length > 1024 ||
      !(/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag) || /^[^\x00-\x20\x7f\s",*]+$/.test(etag))) {
    throw new TypeError("Invalid or missing single TOS ETag");
  }
}
