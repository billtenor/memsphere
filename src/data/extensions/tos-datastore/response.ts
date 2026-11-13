import type { Readable } from "node:stream";

export class TosRequestError extends Error {
  constructor(readonly code: string, readonly status?: number, readonly requestId?: string) {
    // Do not retain Axios cause/config/request: these contain credentials.
    super(`TOS request failed: ${code}${status === undefined ? "" : ` (${status})`}`);
    this.name = "TosRequestError";
  }
}

export async function readBounded(stream: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array)) throw new TosRequestError("INVALID_RESPONSE");
      size += chunk.byteLength;
      if (size > limit) throw new TosRequestError("RESPONSE_TOO_LARGE");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, size);
  } finally { stream.destroy(); }
}
