import { types as nativeTypes } from "node:util";
import type { Context } from "../../api/context.js";
import type { DataExtension } from "../../api/extension.js";
import type { Model } from "../../api/model.js";
import type { ModelRuntime, ModelRuntimeFactory, ModelRuntimeRegistry } from "../../api/model-runtime.js";
import type { Descriptor, ScalarValue } from "../../api/reflection.js";
import { createPlainRuntime } from "../shared/reflection.js";

/** Model definition standard for content treated as a single byte value. */
export const RAW_MODEL = "raw.json";

/** Raw models describe the content as a whole, without declaring member fields. */
export interface RawModelDefinition {
  readonly description?: string;
}

function readDescription(definition: unknown): string | undefined {
  if (definition === null || typeof definition !== "object" || nativeTypes.isProxy(definition)) {
    throw new TypeError("Raw model definition must be a plain JSON object");
  }
  const prototype = Object.getPrototypeOf(definition);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Raw model definition must be a plain JSON object");
  }
  let description: string | undefined;
  for (const key of Reflect.ownKeys(definition)) {
    if (key !== "description") throw new TypeError(`Unsupported raw model definition property: ${String(key)}`);
    const property = Object.getOwnPropertyDescriptor(definition, key)!;
    if (!property.enumerable || !("value" in property) || typeof property.value !== "string") {
      throw new TypeError("Raw model description must be an enumerable string data property");
    }
    description = property.value;
  }
  return description;
}

/** Reflect Uint8Array values as whole scalars; no decoding, field access or storage I/O. */
export class RawModelRuntime implements ModelRuntime {
  readonly descriptor: Descriptor;
  private readonly runtime: ModelRuntime;

  constructor(model: Model) {
    if (model.data.model !== RAW_MODEL) {
      throw new TypeError(`Raw factory requires model.data.model to be ${RAW_MODEL}`);
    }
    const id = model.data.id;
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new TypeError("Raw model ID must be a non-empty string");
    }
    const description = readDescription(model.definition);
    this.descriptor = Object.freeze({
      id,
      root: Object.freeze({
        kind: "scalar",
        scalar: "bytes",
        ...(description === undefined ? {} : { description })
      })
    });
    this.runtime = createPlainRuntime(this.descriptor, {
      validate(value) {
        // instanceof alone also accepts forged prototypes and Proxy wrappers.
        if (!nativeTypes.isUint8Array(value)) throw new TypeError("Raw value must be a Uint8Array");
      }
    });
    Object.freeze(this);
  }

  reflect(value: unknown): ScalarValue {
    // The root is always a bytes scalar, so the shared runtime creates a ScalarValue.
    return this.runtime.reflect(value) as ScalarValue;
  }
}

/** One factory serves all models defined with the raw standard. */
export class RawModelRuntimeFactory implements ModelRuntimeFactory<RawModelDefinition> {
  readonly target = Object.freeze({ metaModel: RAW_MODEL });

  async createRuntime(context: Context, model: Model, _registry: ModelRuntimeRegistry): Promise<RawModelRuntime> {
    context.signal?.throwIfAborted();
    return new RawModelRuntime(model);
  }
}

export const rawExtension: DataExtension = Object.freeze({
  id: "memsphere/raw",
  version: "0.1.0",
  modelRuntimeFactories: Object.freeze([new RawModelRuntimeFactory()])
});
