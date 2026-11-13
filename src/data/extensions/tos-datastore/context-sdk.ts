import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { TosClient, CancelToken } from "@volcengine/tos-sdk";
import type { AxiosResponse } from "axios";
import type { TosResponse } from "@volcengine/tos-sdk/dist/methods/base.js";
import type { Context } from "../../api/context.js";

import { TosRequestError, readBounded } from "./response.js";
export { TosRequestError, readBounded } from "./response.js";

// Use debug's public gate, without changing process-wide logging or SDK internals.
const sdkDebug = createRequire(import.meta.url)("debug") as { enabled(namespace: string): boolean };


type Operation = {
  readonly cancelToken: ReturnType<typeof CancelToken.source>["token"];
  readonly success: readonly number[];
  readonly streams: Set<Readable>;
  readonly signal: AbortSignal;
};

/** Version-pinned SDK extension; all signing and HTTP remain in super.fetch(). */
export class ContextTosSdk extends TosClient {
  private readonly operations = new AsyncLocalStorage<Operation>();

  async operate<T>(
    context: Context,
    success: readonly number[],
    action: () => Promise<T>,
    options: { body?: Readable; responseStream?: (value: T) => Readable; timeoutMs?: number } = {}
  ): Promise<T> {
    context.signal?.throwIfAborted();
    if (sdkDebug.enabled("TOS")) throw new TosRequestError("TOS_DEBUG_LOGGING_FORBIDDEN");
    const controller = new AbortController();
    const source = CancelToken.source();
    const streams = new Set<Readable>();
    const abortParent = () => controller.abort();
    const abort = () => {
      source.cancel("TOS operation cancelled");
      for (const stream of streams) stream.destroy();
    };
    const release = () => {
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", abortParent);
      controller.signal.removeEventListener("abort", abort);
      // Each token and stream belongs to exactly this operation, never its peers.
      source.cancel("TOS operation closed");
      for (const stream of streams) stream.destroy();
    };
    let timedOut = false;
    let inputFailure: unknown;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 120_000);
    timer.unref();
    context.signal?.addEventListener("abort", abortParent, { once: true });
    controller.signal.addEventListener("abort", abort, { once: true });
    if (context.signal?.aborted) controller.abort();
    if (options.body) streams.add(options.body);
    const bodyFinished = options.body && finished(options.body, { cleanup: true }).then(
      () => undefined,
      error => { inputFailure = error; controller.abort(); return error as unknown; }
    );
    let transferred = false;
    try {
      if (controller.signal.aborted) throw new TosRequestError("ABORTED");
      const result = await this.operations.run({ cancelToken: source.token, streams, signal: controller.signal, success }, action);
      if (bodyFinished) {
        const failure = await bodyFinished;
        if (failure !== undefined) throw failure;
      }
      if (controller.signal.aborted) throw new TosRequestError("ABORTED");
      const stream = options.responseStream?.(result);
      if (stream) {
        streams.add(stream);
        stream.once("close", release);
        transferred = true;
        if (stream.destroyed) release();
      }
      return result;
    } catch (error) {
      if (context.signal?.aborted) throw context.signal.reason instanceof TosRequestError ? context.signal.reason : new TosRequestError("ABORTED");
      if (timedOut) throw new TosRequestError("TOS_DEADLINE");
      if (inputFailure) throw inputFailure instanceof TosRequestError ? inputFailure : new TosRequestError("PAYLOAD_READ_ERROR");
      if (error instanceof TosRequestError) throw error;
      throw new TosRequestError("TOS_TRANSPORT_ERROR");
    } finally {
      if (!transferred) release();
    }
  }

  protected override async fetch<T>(
    method: Parameters<TosClient["fetch"]>[0], path: string,
    query: Parameters<TosClient["fetch"]>[2], headers: Parameters<TosClient["fetch"]>[3],
    body?: Parameters<TosClient["fetch"]>[4],
    options?: Omit<NonNullable<Parameters<TosClient["fetch"]>[5]>, "handleResponse"> & { handleResponse?: (response: AxiosResponse<T>) => T }
  ): Promise<TosResponse<T>> {
    const operation = this.operations.getStore();
    if (!operation) throw new Error("TOS SDK operation context is required");
    const raw = await super.fetch<unknown>(method, path, query, headers, body, {
      ...options,
      handleResponse: response => response,
      axiosOpts: {
        ...options?.axiosOpts,
        // Native TOS endpoints use direct TLS. Axios 0.21's implicit HTTP
        // proxy selection otherwise pairs an HTTP request with the SDK TLS Agent.
        proxy: false,
        cancelToken: operation.cancelToken,
        responseType: "stream",
        validateStatus: () => true,
        maxRedirects: 0
      }
    });
    const response = raw.data as AxiosResponse<Readable>;
    const stream = response.data as Readable;
    operation.streams.add(stream);
    // Register before decoding, so abort also owns an in-flight JSON/error body.
    stream.once("close", () => operation.streams.delete(stream));
    if (operation.signal.aborted) { stream.destroy(); throw new TosRequestError("ABORTED"); }
    if (!operation.success.includes(response.status)) {
      const bytes = await readBounded(stream, 64 * 1024);
      let code = `HTTP_${response.status}`;
      try {
        const parsed: unknown = JSON.parse(bytes.toString("utf8"));
        if (parsed && typeof parsed === "object" && "Code" in parsed && typeof parsed.Code === "string" && /^[A-Za-z0-9_ -]{1,100}$/.test(parsed.Code)) code = parsed.Code;
      } catch { /* HEAD errors have no body; callers confirm ambiguous 404s. */ }
      throw new TosRequestError(code, response.status, raw.requestId);
    }
    let data: unknown = stream;
    if (options?.axiosOpts?.responseType !== "stream") {
      const bytes = await readBounded(stream, 2 * 1024 * 1024);
      try { data = bytes.length ? JSON.parse(bytes.toString("utf8")) : ""; }
      catch { throw new TosRequestError("INVALID_RESPONSE", response.status, raw.requestId); }
    }
    const decoded = options?.handleResponse ? options.handleResponse({ ...response, data } as AxiosResponse<T>) : data;
    return { ...raw, data: decoded as T };
  }
}
