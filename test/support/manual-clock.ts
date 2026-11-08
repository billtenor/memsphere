/** Each fixture owns its clock. Advancing time never sleeps or patches globals. */
export class ManualClock {
  private milliseconds: number;
  private pending = new Set<{ at: number; finish: () => void }>();
  constructor(start = Date.parse("2026-01-01T00:00:00Z")) { this.milliseconds = start; }
  now = () => this.milliseconds;
  iso = () => new Date(this.milliseconds).toISOString();
  sleep = (milliseconds: number, signal?: AbortSignal): Promise<void> => {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError("Invalid delay");
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const cleanup = () => { this.pending.delete(item); signal?.removeEventListener("abort", abort); };
      const item = { at: this.milliseconds + milliseconds, finish: () => { cleanup(); resolve(); } };
      const abort = () => { cleanup(); reject(signal!.reason); };
      this.pending.add(item); signal?.addEventListener("abort", abort, { once: true });
    });
  };
  advance(milliseconds: number) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError("Invalid advance");
    this.milliseconds += milliseconds;
    for (const item of [...this.pending]) if (item.at <= this.milliseconds) item.finish();
  }
  get waiting() { return this.pending.size; }
}
