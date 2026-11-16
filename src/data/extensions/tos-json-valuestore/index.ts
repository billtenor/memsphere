import type { Context } from "../../api/context.js";
import type { Config } from "../../api/config.js";
import type { ModelRuntime } from "../../api/model-runtime.js";
import type { ValueStoreFactory } from "../../api/value-store.js";
import type { DataExtension } from "../../api/extension.js";
import { parseTosConnectionConfig, resolveEnvironmentCredentials, validateCredentials, type TosConnectionConfig, type TosCredentials, type TosCredentialsResolver } from "../tos-datastore/config.js";
import type { TosObjectClient } from "../tos-datastore/client.js";
import { TosJsonValueStore } from "./store.js";
export { TosJsonValueStore, MAX_VALUE_OBJECT_BYTES } from "./store.js";
export { parseTosConnectionConfig as parseTosJsonConfig } from "../tos-datastore/config.js";

export class TosJsonValueStoreFactory implements ValueStoreFactory {
  readonly id = "memsphere/tos-json";
  constructor(private readonly resolveCredentials: TosCredentialsResolver = resolveEnvironmentCredentials,
    private readonly openClient?: (config: TosConnectionConfig, credentials: TosCredentials) => TosObjectClient) {}
  async createStore(context: Context, id: string, runtime: ModelRuntime, config: Config): Promise<TosJsonValueStore> {
    context.signal?.throwIfAborted();
    if (!id.trim() || !runtime.descriptor.id) throw new TypeError("Store id and model are required");
    const parsed = parseTosConnectionConfig(config);
    let credentials: TosCredentials;
    try { credentials = validateCredentials(await this.resolveCredentials(parsed.credentials)); }
    catch { throw Object.assign(new Error("TOS credentials could not be resolved"), { code: "TOS_CREDENTIALS_ERROR" }); }
    context.signal?.throwIfAborted();
    const client = this.openClient ? this.openClient(parsed, credentials) : (await import("../tos-datastore/client.js")).createTosClient(parsed, credentials);
    const store = new TosJsonValueStore(id, runtime, parsed, client);
    await store.checkBucket(context);
    return store;
  }
}
export const tosJsonValueStoreExtension: DataExtension = { id: "memsphere/tos-json-valuestore", version: "0.1.0", valueStoreFactories: [new TosJsonValueStoreFactory()] };
