/** Settle in-flight acquisition before closing its owned resources. Ownership
 * must be recorded inside acquire, before stop can resume after that promise. */
export function ownedSetup(signal: AbortSignal, cleanup: () => Promise<void>) {
  const pending = new Set<Promise<unknown>>();
  let closing = false, stopping: Promise<void> | undefined;
  const check = () => {
    signal.throwIfAborted();
    if (closing) throw new Error("Test setup is closing");
  };
  const acquire = async <T>(operation: () => Promise<T>, own?: (resource: T) => void): Promise<T> => {
    check();
    const acquisition = Promise.resolve().then(() => { check(); return operation(); }).then(resource => {
      own?.(resource);
      return resource;
    });
    pending.add(acquisition);
    try { const resource = await acquisition; check(); return resource; }
    finally { pending.delete(acquisition); }
  };
  const stop = () => {
    closing = true;
    return stopping ??= Promise.allSettled([...pending]).then(cleanup);
  };
  return { acquire, check, stop };
}
