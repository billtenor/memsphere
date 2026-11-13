export const HEADER_SIZE = 10;
export const MAX_OBJECT_BYTES = 5 * 1024 ** 3;
const MAGIC = Uint8Array.of(0x4d, 0x53, 0x44, 0x54);

export function encodeHeader(counter: number, deleted: boolean): Uint8Array {
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xffffffff) throw new TypeError("Invalid TOS counter");
  const bytes = new Uint8Array(HEADER_SIZE);
  bytes.set(MAGIC);
  bytes[4] = 1;
  bytes[5] = deleted ? 1 : 0;
  new DataView(bytes.buffer).setUint32(6, counter, false);
  return bytes;
}

export function decodeHeader(bytes: Uint8Array): { counter: number; deleted: boolean } {
  if (bytes.length !== HEADER_SIZE || MAGIC.some((byte, i) => bytes[i] !== byte) || bytes[4] !== 1 || bytes[5] > 1) {
    throw Object.assign(new Error("Unsupported or corrupt TOS Store header"), { code: "STORE_INCOMPATIBLE" });
  }
  return { counter: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(6, false), deleted: bytes[5] === 1 };
}
