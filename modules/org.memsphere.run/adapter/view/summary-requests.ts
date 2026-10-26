/** Share only in-flight work; a later refresh always reads current records. */
export class RunSummaryRequests {
  readonly #pending = new Map<string, Promise<Record<string, any>>>();
  readonly #controller = new AbortController();
  constructor(private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init)) {}

  read(url: string, signal?: AbortSignal): Promise<Record<string, any>> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.#controller.signal.aborted) return Promise.reject(this.#controller.signal.reason);
    let pending = this.#pending.get(url);
    if (!pending) {
      const request = Promise.resolve().then(async () => {
        const response = await this.fetcher(url, { signal: this.#controller.signal });
        if (!response.ok) throw new Error((await response.text()) || `${response.status}`);
        return response.json() as Promise<Record<string, any>>;
      }).finally(() => { if (this.#pending.get(url) === request) this.#pending.delete(url); });
      pending = request;
      this.#pending.set(url, request);
    }
    if (!signal) return pending;
    return new Promise((resolve, reject) => {
      const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
      signal.addEventListener("abort", abort, { once: true });
      pending.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => {
        signal.removeEventListener("abort", abort); reject(error);
      });
    });
  }

  dispose(): void { this.#controller.abort(); this.#pending.clear(); }
}
