import type { Context } from "../../api/context.js";
import type { Config } from "../../api/config.js";
import type { DataStore, DataStoreFactory, DataStoreReadResult } from "../../api/data-store.js";
import type { DataExtension } from "../../api/extension.js";
import { parseTosConfig, resolveEnvironmentCredentials, validateCredentials, type TosCredentialsResolver, type TosConfig, type TosCredentials } from "./config.js";
import type { TosObjectClient } from "./client.js";
import { TosDataStore, storeError } from "./store.js";

export type { TosCredentials, TosCredentialReference, TosCredentialsResolver } from "./config.js";
export { parseTosConfig } from "./config.js";

export class TosDataStoreFactory implements DataStoreFactory {
  readonly id = "memsphere/tos";
  constructor(
    private readonly resolveCredentials: TosCredentialsResolver = resolveEnvironmentCredentials,
    private readonly openClient?: (config: TosConfig, credentials: TosCredentials) => TosObjectClient
  ) {}
  async createStore(context: Context, id: string, model: string, config: Config): Promise<TosDataStore> {
    context.signal?.throwIfAborted();
    if (!id || !model) throw new TypeError("Store id and model are required");
    const parsed = parseTosConfig(config);
    let credentials: TosCredentials;
    try { credentials = validateCredentials(await this.resolveCredentials(parsed.credentials)); }
    catch { throw storeError("TOS_CREDENTIALS_ERROR", "TOS credentials could not be resolved"); }
    context.signal?.throwIfAborted();
    // Ordinary filesystem commands must not initialize the optional cloud SDK.
    const client = this.openClient ? this.openClient(parsed, credentials) : (await import("./client.js")).createTosClient(parsed, credentials);
    const store = new TosDataStore(id, model, parsed, client);
    // Connection validation is done once when opening, never as a per-write pre-read.
    await store.checkBucket(context);
    return store;
  }
}

export const tosDataStoreExtension: DataExtension = {
  id: "memsphere/tos-datastore", version: "0.1.0", dataStoreFactories: [new TosDataStoreFactory()]
};

/** Host compatibility checks must see tombstones as well as active records. */
export function inspectPhysicalRecords(context: Context, store: DataStore): AsyncIterable<DataStoreReadResult> {
  if (!(store instanceof TosDataStore)) throw storeError("UNSUPPORTED_CAPABILITY", "Physical enumeration requires a TOS Store");
  return store.inspectPhysicalRecords(context);
}
