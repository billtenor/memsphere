// 仅供 TypeScript 编译检查，不执行这些声明和示例。
import {
  Config,
  type Context,
  type Data,
  type DataExtension,
  type DataId,
  type DataStore,
  type DataStoreFactory,
  type DeleteOptions,
  type Descriptor,
  type JsonObject,
  type JsonValue,
  type ListOptions,
  type ListResult,
  type Model,
  type ModelRef,
  type ModelRuntime,
  type ModelRuntimeFactory,
  type ModelRuntimeFactoryTarget,
  type ModelRuntimeRegistry,
  type Payload,
  type PayloadContent,
  type PayloadSerializer,
  type StoredData,
  type StoredValue,
  type StoreRegistry,
  type UpdateOptions,
  type Value,
  type ValueStore,
  type ValueStoreFactory
} from "../../src/data/index.js";

declare const content: PayloadContent;
declare const reflected: Value;
declare const runtimes: ModelRuntimeRegistry;
declare const stores: StoreRegistry;
declare const dataStores: DataStoreFactory;
declare const valueStores: ValueStoreFactory;
declare const serializer: PayloadSerializer<{ quantity: number }>;
declare const factory: ModelRuntimeFactory<JsonObject>;

const context: Context = { signal: new AbortController().signal };
const id: DataId = "order-001";
const modelRef: ModelRef = "order-model";
const payload: Payload = { contentType: "application/json", content };
const data: Data = { id, model: modelRef, payload };
const record: StoredData = { data };
const valueRecord: StoredValue = { id, value: { quantity: 2 } };
const annotatedRecord: StoredValue = {
  ...valueRecord,
  revision: 1,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
  createdBy: "user-001",
  updatedBy: null
};

const json: JsonObject = { enabled: false, limit: 0, values: [null, "", true] };
const nested: JsonValue = [json, null];
const config = new Config(json);
const model: Model<JsonObject> = {
  data: { id: modelRef, model: "json-schema/2020-12", payload },
  definition: { type: "object" }
};
const descriptor: Descriptor = {
  id: modelRef,
  root: { kind: "object", fields: [], field: () => undefined }
};
const runtime: ModelRuntime = { descriptor, reflect: () => reflected };
const exact: ModelRuntimeFactoryTarget = { model: modelRef };
const byStandard: ModelRuntimeFactoryTarget = { metaModel: "json-schema/2020-12" };

const extension: DataExtension = {
  id: "test/data",
  version: "1.0.0",
  payloadSerializers: [serializer],
  modelRuntimeFactories: [factory],
  dataStoreFactories: [dataStores],
  valueStoreFactories: [valueStores]
};
const emptyExtension: DataExtension = { id: "test/empty", version: "1.0.0" };

async function exerciseInterfaces(dataStore: DataStore, valueStore: ValueStore): Promise<void> {
  const stream: ReadableStream<Uint8Array> = content.stream();
  const updateOptions: UpdateOptions = { expectedRevision: 1 };
  const deleteOptions: DeleteOptions = { expectedRevision: 1 };
  const listOptions: ListOptions = { limit: 10, cursor: "opaque-cursor" };

  const maybeData: StoredData | undefined = await dataStore.get(context, id);
  const hasData: boolean = await dataStore.has(context, id);
  const createdData: StoredData = await dataStore.create(context, data);
  const updatedData: StoredData = await dataStore.update(context, data, updateOptions);
  const deletedData: boolean = await dataStore.delete(context, id, deleteOptions);
  const dataPage: ListResult = await dataStore.list(context, listOptions);

  const maybeValue: StoredValue | undefined = await valueStore.get(context, id);
  const hasValue: boolean = await valueStore.has(context, id);
  const createdValue: StoredValue = await valueStore.create(context, id, valueRecord.value);
  const updatedValue: StoredValue = await valueStore.update(context, id, valueRecord.value, updateOptions);
  const deletedValue: boolean = await valueStore.delete(context, id, deleteOptions);
  const valuePage: ListResult = await valueStore.list(context, listOptions);
  const ids: DataId[] = valuePage.items.map(item => item.id);

  const deserialized: { quantity: number } = await serializer.deserialize(context, descriptor, content);
  const serialized: PayloadContent = await serializer.serialize(context, descriptor, deserialized);
  const createdRuntime: ModelRuntime = await factory.createRuntime(context, model, runtimes);
  const createdDataStore: DataStore = await dataStores.createStore(context, modelRef, config);
  const createdValueStore: ValueStore = await valueStores.createStore(context, runtime, config);
  const reflection: Value = runtime.reflect(deserialized);

  runtimes.register(createdRuntime);
  const maybeRuntime: ModelRuntime | undefined = runtimes.get(modelRef);
  stores.register(createdDataStore);
  stores.register(createdValueStore);
  const maybeStore: DataStore | ValueStore | undefined = stores.get(modelRef);
  if (maybeStore?.kind === "DataStore") {
    const stored: StoredData = await maybeStore.create(context, data);
  } else if (maybeStore?.kind === "ValueStore") {
    const stored: StoredValue = await maybeStore.create(context, id, deserialized);
  }

  // @ts-expect-error Context 必须是第一个参数。
  dataStore.create(data, context);
  // @ts-expect-error ValueStoreFactory 需要 Runtime，不是模型 ID。
  valueStores.createStore(context, modelRef, config);
  // @ts-expect-error 不提供 upsert。
  dataStore.upsert(context, data);
  // @ts-expect-error PayloadContent 只提供 stream。
  content.bytes();
  // @ts-expect-error 列表项只包含 ID。
  dataPage.items[0].data;
  // @ts-expect-error Serializer 的 TValue 保留具体值类型。
  serializer.serialize(context, descriptor, { quantity: "two" });
}

// @ts-expect-error Factory 的两种匹配方式必须互斥。
const ambiguous: ModelRuntimeFactoryTarget = { model: modelRef, metaModel: modelRef };
// @ts-expect-error Factory 必须声明一种匹配方式。
const noTarget: ModelRuntimeFactoryTarget = {};
// @ts-expect-error StoredValue 的模型由 Store 提供，不在记录中重复。
const duplicateModel: StoredValue = { ...valueRecord, model: modelRef };
// @ts-expect-error 时间戳是毫秒数字，不是字符串。
const invalidTimestamp: StoredData = { data, createdAt: "2026-01-01" };
// @ts-expect-error JSON 不接受 undefined。
const invalidJson: JsonObject = { field: undefined };
// @ts-expect-error Config 顶层必须是 JSON 对象。
new Config([]);
// @ts-expect-error Config.json 成员不可重新赋值。
config.json = {};
// @ts-expect-error DataExtension 注册 Factory，不直接注册 Runtime。
const directRuntime: DataExtension = { id: "test/invalid", version: "1", modelRuntimes: [runtime] };
// @ts-expect-error DataExtension 注册 Factory，不直接注册 Store。
const directStore: DataExtension = { id: "test/invalid", version: "1", stores: [] };
// @ts-expect-error 原始值不是反射操作对象。
const rawValue: Value = 2;
