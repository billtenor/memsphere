import { AsyncLocalStorage } from 'node:async_hooks';

const reads = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/** One restricted command uses one configuration snapshot, never an authorization snapshot. */
export function withConfigReadScope<T>(operation: () => Promise<T>): Promise<T> {
  return reads.run(new Map(), operation);
}

export function scopedConfigRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  const scope = reads.getStore();
  if (!scope) return load();
  let value = scope.get(key);
  if (!value) {
    value = load();
    scope.set(key, value);
  }
  return value as Promise<T>;
}
