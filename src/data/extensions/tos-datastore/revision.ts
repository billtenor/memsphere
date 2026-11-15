/** A Store-issued token. Counter and ETag are deliberately opaque to callers. */
export function encodeRevision(counter: number, etag: string): string {
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xffffffff) throw new TypeError("Invalid TOS counter");
  assertEtag(etag);
  return `${counter.toString(16).padStart(8, "0")}:${etag}`;
}

export function decodeRevision(revision: unknown): { counter: number; etag: string } {
  if (typeof revision !== "string" || !/^[0-9a-f]{8}:/.test(revision)) throw new TypeError("Invalid TOS expectedRevision");
  const etag = revision.slice(9);
  assertEtag(etag);
  return { counter: Number.parseInt(revision.slice(0, 8), 16), etag };
}

export function assertEtag(etag: unknown): asserts etag is string {
  if (typeof etag !== "string" || !etag.length || etag.length > 1024 || /[\x00-\x1f\x7f]/.test(etag)) {
    throw new TypeError("Invalid or missing TOS ETag");
  }
}
