import type { Context } from "../../api/context.js";
import type { PayloadContent } from "../../api/payload.js";

export function throwIfAborted(context: Context): void {
  context.signal?.throwIfAborted();
}

/** Own the bytes so neither the source nor a stream consumer can change later reads. */
export function bytesContent(bytes: Uint8Array): PayloadContent {
  const snapshot = Uint8Array.from(bytes);
  return {
    stream: () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(snapshot.slice());
        controller.close();
      }
    })
  };
}

/** Cancellation also interrupts a source whose next read never settles. */
export async function readAll(context: Context, content: PayloadContent): Promise<Uint8Array> {
  throwIfAborted(context);
  const reader = content.stream().getReader();
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    const reason = context.signal?.reason ?? new DOMException("Aborted", "AbortError");
    rejectAbort(reason);
    void reader.cancel(reason).catch(() => undefined);
  };
  context.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    throwIfAborted(context);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const result = await Promise.race([reader.read(), aborted]);
      throwIfAborted(context);
      if (result.done) break;
      if (!(result.value instanceof Uint8Array)) throw new TypeError("Payload chunks must be Uint8Array");
      size += result.value.byteLength;
      if (!Number.isSafeInteger(size)) throw new RangeError("Payload is too large to read into memory");
      chunks.push(Uint8Array.from(result.value));
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    context.signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
