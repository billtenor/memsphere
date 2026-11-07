import { AsyncLocalStorage } from "node:async_hooks";
import { promiseHooks } from "node:v8";
import { setImmediate } from "node:timers/promises";

interface Failure { consumed: boolean; rejected: boolean; settled: boolean; watched: boolean; error?: unknown; onObserved?: () => void }
const current = new AsyncLocalStorage<AppPromiseScope>();
const owners = new WeakMap<Promise<unknown>, { scope: AppPromiseScope; state: Failure }>();
let ignored = false;
let users = 0;
let stop: (() => void) | undefined;

/** Observe native aggregation without changing process-wide rejection handling. */
export class AppPromiseScope {
  private readonly failures: Failure[] = [];
  private readonly pending = new Set<Promise<unknown>>();
  private open = true;

  constructor() {
    if (users++ === 0) {
      const disable = promiseHooks.onInit((promise, parent) => {
        if (ignored) return;
        const ancestor = parent && owners.get(parent);
        const scope = current.getStore() ?? ancestor?.scope;
        if (!scope?.open) return;
        if (ancestor) ancestor.scope.consume(parent!);
        const state: Failure = { consumed: false, rejected: false, settled: false, watched: ancestor?.state.watched ?? false };
        owners.set(promise, { scope, state });
        if (state.watched) scope.pending.add(promise);
        scope.ignore(() => {
          void Promise.prototype.then.call(promise, () => { state.settled = true; scope.pending.delete(promise); }, (error: unknown) => {
            state.settled = true;
            scope.pending.delete(promise);
            state.rejected = true;
            scope.failures.push(state);
            state.error = error;
            if (state.consumed) state.onObserved?.();
          });
        });
      });
      stop = () => { disable(); };
    }
  }

  ignore<T>(action: () => T): T {
    const before = ignored;
    ignored = true;
    try { return action(); } finally { ignored = before; }
  }

  consume(task: Promise<unknown>) {
    const owned = owners.get(task);
    if (owned?.scope !== this) return;
    owned.state.consumed = true;
    if (owned.state.rejected) owned.state.onObserved?.();
  }
  watch(task: Promise<unknown>, onObserved?: () => void) {
    const owned = owners.get(task);
    if (owned?.scope !== this) return;
    owned.state.watched = true;
    owned.state.onObserved = onObserved;
    if (!owned.state.settled) this.pending.add(task);
    if (owned.state.rejected && owned.state.consumed) onObserved?.();
  }
  run<T>(action: () => T): T { return current.run(this, action); }
  async flush() { await this.ignore(() => setImmediate()); }
  async drain() { while (this.pending.size) await this.ignore(() => Promise.allSettled([...this.pending])); }
  check() { const failure = this.failures.find(item => item.rejected && !item.consumed); if (failure) throw failure.error; }
  close() { if (!this.open) return; this.open = false; if (--users === 0) { stop?.(); stop = undefined; } }
}
