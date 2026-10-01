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

/** Consume one input stream, applying backpressure and interrupting stalled reads on cancellation. */
export async function consumeContent(
  context: Context,
  content: PayloadContent,
  consume: (chunk: Uint8Array) => Promise<void>
): Promise<void> {
  throwIfAborted(context);
  const reader = content.stream().getReader();
  const onAbort = () => {
    const reason = context.signal?.reason ?? new DOMException("Aborted", "AbortError");
    // cancel() closes the readable side and settles pending reads immediately,
    // even when the source's asynchronous cancellation cleanup never completes.
    void reader.cancel(reason).catch(() => undefined);
  };
  context.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    throwIfAborted(context);
    while (true) {
      const result = await reader.read();
      throwIfAborted(context);
      if (result.done) break;
      if (!(result.value instanceof Uint8Array)) throw new TypeError("Payload chunks must be Uint8Array");
      await consume(result.value);
      throwIfAborted(context);
    }
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    context.signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

/** Explicitly aggregate a single consumption when a consumer needs a complete byte array. */
export async function readAll(context: Context, content: PayloadContent): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  await consumeContent(context, content, async (chunk) => {
    size += chunk.byteLength;
    if (!Number.isSafeInteger(size)) throw new RangeError("Payload is too large to read into memory");
    chunks.push(Uint8Array.from(chunk));
  });
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
