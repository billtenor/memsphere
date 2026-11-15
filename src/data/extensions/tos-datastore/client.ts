import { Readable } from "node:stream";
import type { Context } from "../../api/context.js";
import { ContextTosSdk } from "./context-sdk.js";
import type { TosConfig, TosCredentials } from "./config.js";

export type ObjectHeaders = Record<string, string | undefined>;
export type ObjectRead = { headers: ObjectHeaders; stream: Readable; status: number };
export interface TosObjectClient {
  versioning(context: Context): Promise<string>;
  head(context: Context, key: string): Promise<ObjectHeaders>;
  read(context: Context, key: string, options?: { range?: string; ifMatch?: string }): Promise<ObjectRead>;
  put(context: Context, key: string, body: Readable, options: { meta: Record<string, string>; contentType: string; ifMatch?: string; create?: boolean }): Promise<ObjectHeaders>;
  delete(context: Context, key: string): Promise<void>;
  list(context: Context, options: { prefix: string; limit: number; token?: string }): Promise<{ keys: string[]; token?: string }>;
}

/** Narrow object protocol over the official SDK; tests can replace this boundary. */
export function createTosClient(config: TosConfig, credentials: TosCredentials): TosObjectClient {
  const sdk = new ContextTosSdk({ ...credentials, region: config.region, endpoint: config.endpoint,
    secure: true, maxRetryCount: 0, enableCRC: false, requestTimeout: 120_000, connectionTimeout: 10_000 });
  return bindTosClient(sdk, config.bucket);
}

/** Bind the object protocol to an SDK instance; transport remains owned by that SDK. */
export function bindTosClient(sdk: ContextTosSdk, bucket: string): TosObjectClient {
  return {
    async versioning(context) {
      const response = await sdk.operate(context, [200], () => sdk.getBucketVersioning(bucket));
      return response.data.Status ?? "";
    },
    async head(context, key) {
      const response = await sdk.operate(context, [200], () => sdk.headObject({ bucket, key }));
      return { ...response.headers };
    },
    async read(context, key, options = {}) {
      const response = await sdk.operate(context, [options.range ? 206 : 200], () => sdk.getObjectV2({ bucket, key, ...options, dataType: "stream" }),
        { responseStream: value => value.data.content as Readable });
      return { headers: { ...response.headers }, stream: response.data.content as Readable, status: response.statusCode };
    },
    async put(context, key, body, options) {
      const response = await sdk.operate(context, [200], () => sdk.putObject({ bucket, key, body, contentType: options.contentType,
        meta: { ...options.meta }, ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}),
        ...(options.create ? { headers: { "if-none-match": "*" } } : {}) }), { body });
      return { ...response.headers };
    },
    async delete(context, key) { await sdk.operate(context, [204], () => sdk.deleteObject({ bucket, key })); },
    async list(context, options) {
      const response = await sdk.operate(context, [200], () => sdk.listObjectsType2({ bucket, prefix: options.prefix,
        maxKeys: Math.min(128, options.limit), ...(options.token === undefined ? {} : { continuationToken: options.token }), listOnlyOnce: true }));
      const page = response.data;
      if (typeof page.IsTruncated !== "boolean" || !Array.isArray(page.Contents) || page.Contents.length > Math.min(128, options.limit) || page.Contents.some(row => typeof row.Key !== "string") ||
        (page.IsTruncated && (typeof page.NextContinuationToken !== "string" || !page.NextContinuationToken))) throw new TypeError("Invalid TOS list response");
      return { keys: page.Contents.map(row => row.Key), ...(page.IsTruncated ? { token: page.NextContinuationToken } : {}) };
    }
  };
}
