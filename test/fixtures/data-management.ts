// 仅供 TypeScript 编译检查，不执行；声明由外部装配提供，不实现管理器或注册表。
import * as dataApi from "../../src/data/index.js";
import { Config, DefaultDataExtensionRegistry, DefaultDataManager } from "../../src/data/index.js";
import type {
  Context,
  Data,
  DataExtension,
  DataExtensionRegistry,
  DataManager,
  DataStore,
  DataStoreFactory,
  Model,
  ModelBinding,
  ModelRef,
  ModelRuntime,
  ModelRuntimeFactory,
  PayloadSerializer,
  StoredData,
  StoredValue,
  StoreBinding,
  ValueStore,
  ValueStoreFactory
} from "../../src/data/index.js";

declare const context: Context;
declare const extensions: DataExtensionRegistry;
declare const extension: DataExtension;
declare const projectA: DataManager;
declare const projectB: DataManager;
declare const orderData: Data;
declare const orderValue: unknown;
declare const decodedModel: Model;

const orderModel: ModelRef = "order-model";
const metaModel: ModelRef = "json-schema/draft-07";

const decodedBinding: ModelBinding = { model: decodedModel, dependencies: ["money-model"] };
const rawBinding: ModelBinding = { ref: "loaded-model", loadData: async context => ({ ...orderData, id: "loaded-model" }) };
const storeBinding: StoreBinding = {
  model: orderModel, kind: "ValueStore", factory: "memsphere/filesystem-json",
  config: new Config({ directory: "/project/data/orders" })
};
const implementedRegistry: DataExtensionRegistry = new DefaultDataExtensionRegistry([extension]);
const implementedManager: DataManager = new DefaultDataManager({
  extensions: implementedRegistry, models: [decodedBinding, rawBinding], stores: [storeBinding]
});

// @ts-expect-error 一个模型来源不能同时提供已解码定义和读取回调。
const mixedBinding: ModelBinding = { model: decodedModel, ref: orderModel, loadData: async () => orderData };
// @ts-expect-error 原始模型加载回调返回 Data，不是解码后的 Model。
const wrongLoader: ModelBinding = { ref: orderModel, loadData: async () => decodedModel };
// @ts-expect-error Store 绑定必须使用约定的类型名称。
const wrongStoreKind: StoreBinding = { ...storeBinding, kind: "value" };

// 扩展按能力登记一次；两个项目的 Manager 可使用同一个全局能力目录。
extensions.register(extension);
const registered: DataExtension | undefined = extensions.get(extension.id);
const catalog: readonly DataExtension[] = extensions.list();
const serializer: PayloadSerializer | undefined = extensions.getPayloadSerializer("application/json");
const dataStoreFactory: DataStoreFactory | undefined = extensions.getDataStoreFactory("memsphere/filesystem");
const valueStoreFactory: ValueStoreFactory | undefined = extensions.getValueStoreFactory("memsphere/filesystem-json");

// Registry 只精确查询一种 target；编排方显式决定具体模型优先、元模型兜底。
const exactFactory: ModelRuntimeFactory | undefined = extensions.getModelRuntimeFactory({ model: orderModel });
const standardFactory: ModelRuntimeFactory | undefined = extensions.getModelRuntimeFactory({ metaModel });
const selectedFactory: ModelRuntimeFactory | undefined =
  extensions.getModelRuntimeFactory({ model: orderModel }) ??
  extensions.getModelRuntimeFactory({ metaModel });

async function useProjectManagers(): Promise<void> {
  // 同一模型引用在不同项目中独立解析；实例获取始终是异步操作。
  const pendingModel: Promise<Model> = projectA.getModel(context, orderModel);
  const pendingRuntime: Promise<ModelRuntime> = projectA.getRuntime(context, orderModel);
  const pendingStore: Promise<DataStore | ValueStore> = projectA.getStore(context, orderModel);
  const modelA: Model = await pendingModel;
  const runtimeA: ModelRuntime = await pendingRuntime;
  const storeA: DataStore | ValueStore = await pendingStore;
  const modelB: Model = await projectB.getModel(context, orderModel);
  const runtimeB: ModelRuntime = await projectB.getRuntime(context, orderModel);
  const storeB: DataStore | ValueStore = await projectB.getStore(context, orderModel);

  // 业务写入仍由 Store 提供；kind 缩窄后保留各自的创建协议。
  if (storeA.kind === "DataStore") {
    const rawStore: DataStore = storeA;
    const created: StoredData = await rawStore.create(context, orderData);
    // @ts-expect-error DataStore 创建接收完整 Data，不接收 ID 和值实例。
    await rawStore.create(context, orderData.id, orderValue);
  } else {
    const values: ValueStore = storeA;
    const created: StoredValue = await values.create(context, orderData.id, orderValue);
    // @ts-expect-error ValueStore 创建需要 ID 和值实例，不接收完整 Data。
    await values.create(context, orderData);
  }
}

// @ts-expect-error Manager 的 Context 必须是第一个参数。
projectA.getModel(orderModel, context);
// @ts-expect-error Runtime 获取也遵守 Context-first。
projectA.getRuntime(orderModel, context);
// @ts-expect-error Store 获取也遵守 Context-first。
projectA.getStore(orderModel, context);
// @ts-expect-error Manager 不省略操作上下文。
projectA.getModel(orderModel);
// @ts-expect-error Manager 的模型获取不是同步查询。
const synchronousModel: Model = projectA.getModel(context, orderModel);
// @ts-expect-error Manager 的 Runtime 获取不是同步查询。
const synchronousRuntime: ModelRuntime = projectA.getRuntime(context, orderModel);
// @ts-expect-error Manager 的 Store 获取不是同步查询。
const synchronousStore: DataStore | ValueStore = projectA.getStore(context, orderModel);
// @ts-expect-error Registry 查询同步返回能力，不返回 Promise。
const asynchronousLookup: Promise<DataExtension | undefined> = extensions.get(extension.id);
// @ts-expect-error Registry 列表不可追加扩展，登记需使用 register。
catalog.push(extension);
// @ts-expect-error Registry 列表不可替换元素。
catalog[0] = extension;
// @ts-expect-error Factory target 不允许同时指定 model 和 metaModel。
extensions.getModelRuntimeFactory({ model: orderModel, metaModel });
// @ts-expect-error Factory target 必须指定一种匹配方式。
extensions.getModelRuntimeFactory({});
// @ts-expect-error Factory target 不是裸模型 ID。
extensions.getModelRuntimeFactory(orderModel);
// @ts-expect-error Factory target 不使用 kind 字段区分匹配方式。
extensions.getModelRuntimeFactory({ kind: "model", id: orderModel });
// @ts-expect-error 能力注册表不负责获取或创建 Runtime 实例。
extensions.getRuntime(context, orderModel);
// @ts-expect-error 能力注册表不负责获取或创建 Store 实例。
extensions.getStore(context, orderModel);
// @ts-expect-error 能力注册表没有隐式创建接口。
extensions.getOrCreateRuntime(context, orderModel);
// @ts-expect-error 能力注册表没有隐式创建 Store 接口。
extensions.getOrCreateStore(context, orderModel);
// @ts-expect-error Manager 不直接登记扩展或实例。
projectA.register(extension);
// @ts-expect-error Manager 不提供通用业务 CRUD。
projectA.create(context, orderData);
// @ts-expect-error Manager 不公开内部可变 Runtime Registry。
projectA.runtimeRegistry;
// @ts-expect-error Manager 不公开内部可变 Store Registry。
projectA.storeRegistry;
// @ts-expect-error 尚未约定资源释放协议，不预置 close。
projectA.close(context);
// @ts-expect-error 公共入口仅导出 Registry 接口，不提供运行时构造器。
new dataApi.DataExtensionRegistry();
// @ts-expect-error 公共入口仅导出 Manager 接口，不提供运行时构造器。
new dataApi.DataManager();
