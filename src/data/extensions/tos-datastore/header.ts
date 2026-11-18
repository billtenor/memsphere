import { randomBytes } from "node:crypto";

export const HEADER_SIZE = 14;
export const MAX_OBJECT_BYTES = 5 * 1024 ** 3;
const MAGIC = Uint8Array.of(0x4d, 0x53, 0x44, 0x54);

/** Random identity changes the physical body; the public revision is the ETag. */
export function encodeHeader(mutationId: Uint8Array, deleted: boolean): Uint8Array {
  if (mutationId.length !== 8) throw new TypeError("TOS mutation identity must contain eight bytes");
  const bytes = new Uint8Array(HEADER_SIZE);
  bytes.set(MAGIC); bytes[4] = 2; bytes[5] = deleted ? 1 : 0;
  bytes.set(mutationId, 6);
  return bytes;
}
export function createHeader(deleted: boolean, mutation: () => Uint8Array = () => randomBytes(8)): Uint8Array { return encodeHeader(mutation(), deleted); }
export function decodeHeader(bytes: Uint8Array): { mutationId: Uint8Array; deleted: boolean } {
  if (bytes.length !== HEADER_SIZE || MAGIC.some((byte, i) => bytes[i] !== byte) || bytes[4] !== 2 || bytes[5] > 1) {
    throw Object.assign(new Error("Unsupported or corrupt TOS Store header"), { code: "STORE_INCOMPATIBLE" });
  }
  return { mutationId: bytes.slice(6), deleted: bytes[5] === 1 };
}
