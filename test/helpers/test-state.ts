/** State-driven waits always settle on cancellation/deadline and release listeners. */
export async function waitForTestState<T>(state: Promise<T>, label: string, signal?: AbortSignal, timeoutMs = 5000): Promise<T> {
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`Timed out waiting for ${label}`), {code:"TEST_STATE_TIMEOUT"})), timeoutMs);
    if (signal) {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, {once:true});
    }
  });
  try { return await Promise.race([state, cancelled]); }
  finally { clearTimeout(timer); if (abort) signal?.removeEventListener("abort", abort); }
}
