import type { Context } from "../data/api/context.js";
import type { DataStoreReadResult } from "../data/api/data-store.js";
import type { ModelRuntime } from "../data/api/model-runtime.js";
import { RawModelRuntime } from "../data/extensions/raw/index.js";
import { consumeContent } from "../data/extensions/shared/payload.js";

/** Validate opaque bytes without turning a compatibility scan into a full buffer. */
export async function validateTosRecord(context: Context, record: DataStoreReadResult, candidateRuntime: ModelRuntime): Promise<void> {
  if (record.deleted) return; // Identity/header were validated by physical enumeration.
  const root = candidateRuntime.descriptor.root;
  if (root.kind === "scalar" && root.scalar === "bytes" && !(candidateRuntime instanceof RawModelRuntime)) {
    throw Object.assign(new Error("Unknown bytes model cannot be validated with bounded memory"), { code: "STORE_INCOMPATIBLE" });
  }
  await consumeContent(context, record.data.payload.content, async () => undefined);
  // The built-in raw Runtime only constrains the byte type, not total content.
  if (candidateRuntime instanceof RawModelRuntime) candidateRuntime.reflect(new Uint8Array());
  // Other DataStore models remain opaque; this proves stream integrity, not JSON semantics.
}
