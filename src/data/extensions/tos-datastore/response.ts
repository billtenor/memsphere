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

/** Do not let a lost acknowledgment imply that a write had no effect. */
export function writeOutcome(error: unknown): unknown {
  if (!(error instanceof TosRequestError) || !(["TOS_TRANSPORT_ERROR", "TOS_DEADLINE", "ABORTED", "INVALID_RESPONSE"].includes(error.code) || (error.status ?? 0) >= 500)) return error;
  const result = new TosRequestError(error.code, error.status, error.requestId);
  result.message += "; write outcome may be committed; read the record before submitting another write";
  return result;
}
