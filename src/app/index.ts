import type { Context } from "../data/api/context.js";
import type { DataStore } from "../data/api/data-store.js";
import type { ValueStore } from "../data/api/value-store.js";

export interface AppOperationContext extends Context {
  readonly project: string;
  readonly app: string;
  readonly config: Readonly<Record<string, unknown>>;
  getStore(key: string): Promise<DataStore | ValueStore>;
}
export interface AppBackend {
  readonly operations: Readonly<Record<string, {
    readonly kind: "read" | "write";
    execute(context: AppOperationContext, input: unknown): Promise<unknown>;
  }>>;
}
