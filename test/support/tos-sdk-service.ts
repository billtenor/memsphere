import type { TestContext } from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "../../src/data/api/context.js";
import { cliInvocationSignal } from "../helpers/cli-module.js";
import { ContextTosSdk } from "../../src/data/extensions/tos-datastore/context-sdk.js";
import { MemoryTosClient } from "./tos-object-client.js";

/** External TOS service substitute for public-entry system tests. Factory,
 * credential resolution, operation ownership and product handlers remain real.
 * Parent/CLI/explicit operation cancellation reaches this owned fake service.
 * This is not a remote rollback guarantee. Native SDK serialization/transport
 * and unknown remote submission have separate real-socket integration. */
export function useTosService(t: TestContext, client = new MemoryTosClient()) {
  const operations = new AsyncLocalStorage<Context>();
  const context = () => {
    const value = operations.getStore();
    if (!value) throw new Error("Fake TOS operation requires its owned Context");
    return value;
  };
  const reply = (data: unknown, headers = {}, statusCode = 200) => ({ data, headers, statusCode, requestId: "system-fixture" });
  const replacements: Array<{ name: "getBucketVersioning" | "headObject" | "getObjectV2" | "putObject" | "deleteObject" | "listObjectsType2"; action: (input: any) => Promise<unknown> }> = [];
  const mock = (name: "getBucketVersioning" | "headObject" | "getObjectV2" | "putObject" | "deleteObject" | "listObjectsType2", action: (input: any) => Promise<unknown>) => replacements.push({name,action});
  mock("getBucketVersioning", async () => { const state=await client.versioning(context());return reply(state ? {Status:state}:{}); });
  mock("headObject", async input => reply({},await client.head(context(),input.key)));
  mock("getObjectV2", async input => {const out=await client.read(context(),input.key,input);return reply({content:out.stream},out.headers,out.status);});
  mock("putObject", async input => reply({},await client.put(context(),input.key,input.body,{meta:input.meta,contentType:input.contentType,ifMatch:input.ifMatch,create:input.headers?.["if-none-match"] === "*"})));
  mock("deleteObject", async input => {await client.delete(context(),input.key);return reply({}, {},204);});
  mock("listObjectsType2", async input => {const out=await client.list(context(), {prefix:input.prefix,limit:input.maxKeys,token:input.continuationToken});return reply({Contents:out.keys.map(Key=>({Key})),IsTruncated:!!out.token,...(out.token?{NextContinuationToken:out.token}:{})});});
  const operate = ContextTosSdk.prototype.operate;
  t.mock.method(ContextTosSdk.prototype, "operate", async function(this: ContextTosSdk, ...args: Parameters<typeof operate>) {
    const signals = [t.signal, args[0].signal, cliInvocationSignal()].filter((value): value is AbortSignal => !!value);
    const owned = { ...args[0], signal: AbortSignal.any(signals) };
    owned.signal.throwIfAborted();
    // SDK object methods are per-instance public functions, not prototype methods.
    for (const {name,action} of replacements) t.mock.method(this,name,action as never);
    args[0] = owned;
    return operations.run(owned, () => operate.apply(this,args));
  });
  return client;
}
