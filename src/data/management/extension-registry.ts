import { MIMEType } from "node:util";
import type { DataStoreFactory } from "../api/data-store.js";
import type { DataExtension } from "../api/extension.js";
import type { DataExtensionRegistry } from "../api/extension-registry.js";
import type { ModelRuntimeFactory, ModelRuntimeFactoryTarget } from "../api/model-runtime.js";
import type { PayloadSerializer } from "../api/serializer.js";
import type { ValueStoreFactory } from "../api/value-store.js";

/**
 * A process-level capability catalog, independent of any Project or data space.
 * Registration never invokes a serializer or factory. Extension metadata and
 * capability arrays are copied and frozen; capability objects retain their
 * identity and must honor the API's readonly identifiers and targets.
 *
 * MIME matching lowercases the type, subtype, and parameter names, ignores
 * parameter order, and decodes quoted parameter values. All parameter values
 * remain case-sensitive and all parameters (including charset) are retained.
 * Malformed syntax and duplicate parameter names are rejected, not discarded.
 */
export class DefaultDataExtensionRegistry implements DataExtensionRegistry {
  private readonly extensions = new Map<string, DataExtension>();
  private readonly serializers = new Map<string, PayloadSerializer>();
  private readonly modelFactories = new Map<string, ModelRuntimeFactory>();
  private readonly metaModelFactories = new Map<string, ModelRuntimeFactory>();
  private readonly dataStoreFactories = new Map<string, DataStoreFactory>();
  private readonly valueStoreFactories = new Map<string, ValueStoreFactory>();

  constructor(extensions: readonly DataExtension[] = []) {
    if (!Array.isArray(extensions)) throw new TypeError("Extensions must be an array");
    for (const extension of extensions) this.register(extension);
  }

  register(extension: DataExtension): void {
    assertObject(extension, "Extension");
    const id = requireString(extension.id, "Extension ID");
    const version = requireString(extension.version, `Extension ${id} version`);
    const existing = this.extensions.get(id);
    if (existing !== undefined) {
      throw new Error(`Extension ${id} is already registered at version ${existing.version}; cannot register version ${version}`);
    }

    const payloadSerializers = snapshotArray(extension.payloadSerializers, "payloadSerializers");
    const modelRuntimeFactories = snapshotArray(extension.modelRuntimeFactories, "modelRuntimeFactories");
    const dataStoreFactories = snapshotArray(extension.dataStoreFactories, "dataStoreFactories");
    const valueStoreFactories = snapshotArray(extension.valueStoreFactories, "valueStoreFactories");

    // Stage every validated key before publishing any of this extension.
    const serializers = new Map<string, PayloadSerializer>();
    const serializerIds = new Set<string>();
    for (const serializer of payloadSerializers ?? []) {
      assertObject(serializer, `Extension ${id} serializer`);
      const serializerId = requireString(serializer.id, "Serializer ID");
      if (serializerIds.has(serializerId)) {
        throw new Error(`Duplicate serializer ID ${serializerId} in extension ${id}`);
      }
      serializerIds.add(serializerId);
      const contentType = normalizeContentType(serializer.contentType);
      requireMethod(serializer.deserialize, `Serializer ${serializerId}.deserialize`);
      requireMethod(serializer.serialize, `Serializer ${serializerId}.serialize`);
      stage(serializers, this.serializers, contentType, serializer, `Serializer content type ${serializer.contentType}`);
    }

    const modelFactories = new Map<string, ModelRuntimeFactory>();
    const metaModelFactories = new Map<string, ModelRuntimeFactory>();
    for (const factory of modelRuntimeFactories ?? []) {
      assertObject(factory, `Extension ${id} model runtime factory`);
      const target = snapshotTarget(factory.target);
      requireMethod(factory.createRuntime, "Model runtime factory.createRuntime");
      if (target.model !== undefined) {
        stage(modelFactories, this.modelFactories, target.model, factory, `Model runtime factory model ${target.model}`);
      } else {
        stage(metaModelFactories, this.metaModelFactories, target.metaModel, factory, `Model runtime factory metaModel ${target.metaModel}`);
      }
    }

    const dataFactories = new Map<string, DataStoreFactory>();
    for (const factory of dataStoreFactories ?? []) {
      assertObject(factory, `Extension ${id} data store factory`);
      const factoryId = requireString(factory.id, "Data store factory ID");
      requireMethod(factory.createStore, `Data store factory ${factoryId}.createStore`);
      stage(dataFactories, this.dataStoreFactories, factoryId, factory, `Data store factory ID ${factoryId}`);
    }

    const valueFactories = new Map<string, ValueStoreFactory>();
    for (const factory of valueStoreFactories ?? []) {
      assertObject(factory, `Extension ${id} value store factory`);
      const factoryId = requireString(factory.id, "Value store factory ID");
      requireMethod(factory.createStore, `Value store factory ${factoryId}.createStore`);
      stage(valueFactories, this.valueStoreFactories, factoryId, factory, `Value store factory ID ${factoryId}`);
    }

    const snapshot: DataExtension = Object.freeze({
      id,
      version,
      ...(payloadSerializers === undefined ? {} : { payloadSerializers }),
      ...(modelRuntimeFactories === undefined ? {} : { modelRuntimeFactories }),
      ...(dataStoreFactories === undefined ? {} : { dataStoreFactories }),
      ...(valueStoreFactories === undefined ? {} : { valueStoreFactories })
    });
    this.extensions.set(id, snapshot);
    publish(this.serializers, serializers);
    publish(this.modelFactories, modelFactories);
    publish(this.metaModelFactories, metaModelFactories);
    publish(this.dataStoreFactories, dataFactories);
    publish(this.valueStoreFactories, valueFactories);
  }

  get(id: string): DataExtension | undefined {
    return this.extensions.get(id);
  }

  list(): readonly DataExtension[] {
    return Object.freeze([...this.extensions.values()]);
  }

  getPayloadSerializer(contentType: string): PayloadSerializer | undefined {
    return this.serializers.get(normalizeContentType(contentType));
  }

  getModelRuntimeFactory(target: ModelRuntimeFactoryTarget): ModelRuntimeFactory | undefined {
    const key = snapshotTarget(target);
    return key.model !== undefined
      ? this.modelFactories.get(key.model)
      : this.metaModelFactories.get(key.metaModel);
  }

  getDataStoreFactory(id: string): DataStoreFactory | undefined {
    return this.dataStoreFactories.get(id);
  }

  getValueStoreFactory(id: string): ValueStoreFactory | undefined {
    return this.valueStoreFactories.get(id);
  }
}

function assertObject(value: unknown, label: string): asserts value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a nonempty string`);
  }
  return value;
}

function requireMethod(value: unknown, label: string): void {
  if (typeof value !== "function") throw new TypeError(`${label} must be a function`);
}

function snapshotArray<T>(values: readonly T[] | undefined, label: string): readonly T[] | undefined {
  if (values === undefined) return undefined;
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  return Object.freeze([...values]);
}

function snapshotTarget(target: ModelRuntimeFactoryTarget): ModelRuntimeFactoryTarget {
  assertObject(target, "Model runtime factory target");
  const model = Object.hasOwn(target, "model");
  const metaModel = Object.hasOwn(target, "metaModel");
  if (model === metaModel || (!model && "model" in target) || (!metaModel && "metaModel" in target)) {
    throw new TypeError("Model runtime factory target must have exactly one own model or metaModel property");
  }
  return Object.freeze(model
    ? { model: requireString(target.model, "Model runtime factory target.model") }
    : { metaModel: requireString(target.metaModel, "Model runtime factory target.metaModel") });
}

function stage<T>(pending: Map<string, T>, registered: Map<string, T>, key: string, value: T, label: string): void {
  if (pending.has(key) || registered.has(key)) throw new Error(`${label} is already registered`);
  pending.set(key, value);
}

function publish<T>(registered: Map<string, T>, pending: Map<string, T>): void {
  for (const [key, value] of pending) registered.set(key, value);
}

function normalizeContentType(contentType: string): string {
  requireString(contentType, "Serializer content type");
  // MIMEType intentionally recovers from some malformed parameters and keeps
  // only the first duplicate. Validate first so neither can alias a valid key.
  const essence = /^[ \t]*[!#$%&'*+\-.^_`|~0-9A-Za-z]+\/[!#$%&'*+\-.^_`|~0-9A-Za-z]+[ \t]*/.exec(contentType);
  if (!essence) throw new TypeError(`Invalid MIME content type: ${contentType}`);
  const parameter = /;[ \t]*([!#$%&'*+\-.^_`|~0-9A-Za-z]+)=(?:[!#$%&'*+\-.^_`|~0-9A-Za-z]+|"(?:[\t\x20\x21\x23-\x5b\x5d-\xff]|\\[\t\x20-\xff])*")[ \t]*/y;
  const names = new Set<string>();
  let offset = essence[0].length;
  while (offset < contentType.length) {
    parameter.lastIndex = offset;
    const match = parameter.exec(contentType);
    if (!match) throw new TypeError(`Invalid MIME parameters: ${contentType}`);
    const name = match[1].toLowerCase();
    if (names.has(name)) throw new TypeError(`Duplicate MIME parameter ${name}: ${contentType}`);
    names.add(name);
    offset = parameter.lastIndex;
  }
  const parsed = new MIMEType(contentType);
  const parameters = [...parsed.params].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return JSON.stringify([parsed.essence, parameters]);
}
