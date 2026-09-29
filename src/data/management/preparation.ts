import type { Context } from "../api/context.js";

type Preparation = {
  readonly key: string;
  promise: Promise<unknown>;
  readonly dependencies: Map<Preparation, number>;
};

/**
 * Manager-internal singleflight and successful-result cache.
 *
 * A caller's cancellation stops only its own wait. Shared creation receives no
 * caller Context here and may finish and populate the cache even after every
 * caller cancels; create callbacks must likewise use a non-caller Context for
 * nested preparation and extension calls.
 *
 * Nested preparation passes its active parent's key to track actual waits.
 * Graph nodes represent individual attempts, so cleanup from a failed attempt
 * cannot remove dependencies belonging to a retry with the same key.
 */
export class PreparationCache {
  private readonly completed = new Map<string, unknown>();
  private readonly pending = new Map<string, Preparation>();

  async get<T>(context: Context, key: string, create: () => Promise<T>, parent?: string): Promise<T> {
    context.signal?.throwIfAborted();
    if (this.completed.has(key)) return this.completed.get(key) as T;

    let preparation = this.pending.get(key);
    if (!preparation) {
      const next: Preparation = {
        key,
        dependencies: new Map(),
        promise: Promise.resolve().then(create)
      };
      next.promise = next.promise.then(
        value => {
          this.completed.set(key, value);
          this.finish(next);
          return value;
        },
        error => {
          this.finish(next);
          throw error;
        }
      );
      // Always observe shared failure, including when every waiter cancels.
      void next.promise.catch(() => {});
      this.pending.set(key, next);
      preparation = next;
    }

    const owner = parent === undefined ? undefined : this.pending.get(parent);
    if (owner) {
      const path = this.findPath(preparation, owner);
      if (path) {
        throw new Error(`Data preparation dependency cycle: ${[owner, ...path].map(node => node.key).join(" -> ")}`);
      }
      owner.dependencies.set(preparation, (owner.dependencies.get(preparation) ?? 0) + 1);
    }

    try {
      return await this.wait(context, preparation.promise) as T;
    } finally {
      if (owner) {
        const count = owner.dependencies.get(preparation);
        if (count === 1) owner.dependencies.delete(preparation);
        else if (count !== undefined) owner.dependencies.set(preparation, count - 1);
      }
    }
  }

  private finish(preparation: Preparation): void {
    this.pending.delete(preparation.key);
    preparation.dependencies.clear();
  }

  private findPath(start: Preparation, target: Preparation): Preparation[] | undefined {
    const stack = [start];
    const predecessor = new Map<Preparation, Preparation | undefined>([[start, undefined]]);
    while (stack.length) {
      const current = stack.pop()!;
      if (current === target) {
        const path: Preparation[] = [];
        let node: Preparation | undefined = current;
        while (node) {
          path.push(node);
          node = predecessor.get(node);
        }
        return path.reverse();
      }
      for (const dependency of current.dependencies.keys()) {
        if (!predecessor.has(dependency)) {
          predecessor.set(dependency, current);
          stack.push(dependency);
        }
      }
    }
    return undefined;
  }

  private wait(context: Context, shared: Promise<unknown>): Promise<unknown> {
    const signal = context.signal;
    if (!signal) return shared;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      shared.then(
        value => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        error => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      );
      if (signal.aborted) onAbort();
    });
  }
}
