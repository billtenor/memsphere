/**
 * 数据层公共接口；内置实现从 memsphere/data/extensions 导入。
 * 公共反射描述内存值的结构与操作；尚未实现的部分见 README.md。
 */
export type { Context } from "./api/context.js";
export { Config, type JsonObject, type JsonValue } from "./api/config.js";
export type { Data, DataId, ModelRef } from "./api/data.js";
export type { Payload, PayloadContent } from "./api/payload.js";
export type { Model } from "./api/model.js";
export type {
  ArrayDescriptor,
  ArrayValue,
  Descriptor,
  EnumDescriptor,
  EnumValueDescriptor,
  FieldDescriptor,
  MapDescriptor,
  MapValue,
  ObjectDescriptor,
  ObjectValue,
  Scalar,
  ScalarDescriptor,
  ScalarType,
  ScalarValue,
  TypeDescriptor,
  Value
} from "./api/reflection.js";
export type {
  ModelRuntime,
  ModelRuntimeFactory,
  ModelRuntimeFactoryTarget,
  ModelRuntimeRegistry
} from "./api/model-runtime.js";
export type { PayloadSerializer } from "./api/serializer.js";
export type { DataStore, DataStoreFactory, StoredData } from "./api/data-store.js";
export type { StoredValue, ValueStore, ValueStoreFactory } from "./api/value-store.js";
export type {
  DeleteOptions,
  ListOptions,
  ListResult,
  StoreRegistry,
  UpdateOptions
} from "./api/store.js";
export type { DataExtension } from "./api/extension.js";
