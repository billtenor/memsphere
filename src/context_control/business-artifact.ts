import type { GraphStoreBinding } from "../memory/ast.js";
import type { ResolvedArtifactSpec } from "./schema-contract.js";
import type { ModelArtifactTarget } from "../project/model-artifact.js";

export type BusinessTarget = ModelArtifactTarget & { operation: GraphStoreBinding["operation"] };
export type BusinessDestination = BusinessTarget & { dataId: string };
export type BusinessReceipt = { committedAt: string; revision?: string };
export type BusinessPayload = { bytes: Uint8Array; contentType: string; value: unknown };

export interface GraphBusinessStores {
  lock<T>(runId: string, action: () => Promise<T>): Promise<T>;
  freeze(binding: GraphStoreBinding, spec: ResolvedArtifactSpec): Promise<BusinessTarget>;
  prepare(target: BusinessTarget, payload: BusinessPayload, defaultId: string, requestedId?: string, projectValue?: () => Promise<unknown>): Promise<{ destination: BusinessDestination; value: unknown }>;
  write(destination: BusinessDestination, payload: BusinessPayload): Promise<BusinessReceipt>;
}
