import type { Context } from "./context.js";
import type { ModelRef } from "./data.js";
import type { DataStore } from "./data-store.js";
import type { Model } from "./model.js";
import type { ModelRuntime } from "./model-runtime.js";
import type { ValueStore } from "./value-store.js";

/**
 * 当前 Project 的数据管理入口；由宿主绑定项目、配置及模型版本或快照范围。
 * 使用进程共享的 DataExtensionRegistry，自行持有 ModelRuntimeRegistry、StoreRegistry。
 * 不同 Project 的实例相互隔离，不向调用方暴露可登记实例的 Registry。
 *
 * 与 Registry 的纯查询不同，下列异步方法会按需加载或创建，并复用已准备好的结果。
 * 同一 Manager 内并发准备同一 Runtime 或 Store 时，合并创建，成功后才登记实例。
 * 定位、配置、依赖或创建失败时抛错，不发布半成品，也不缓存为成功结果。
 * 配置或模型快照变更由宿主重新装配，不隐式热替换已经返回的实例。
 */
export interface DataManager {
  /**
   * 加载并解码模型定义，返回 Model；不要求创建该模型自身的 Runtime 或实例 Store。
   * 解码所需的元模型能力由 Manager 准备；模型不存在或无法定位时抛错。
   * 返回结果的 model.data.id 必须等于 ref。
   */
  getModel(context: Context, ref: ModelRef): Promise<Model>;

  /**
   * 取得模型 Runtime；未创建时准备 Model 及其依赖，选择 Factory 创建并登记。
   * 优先使用 target.model 匹配的 Factory，否则使用 target.metaModel 匹配的 Factory。
   * 返回结果的 descriptor.id 必须等于 ref，同一快照复用同一个 Runtime。
   */
  getRuntime(context: Context, ref: ModelRef): Promise<ModelRuntime>;

  /**
   * 根据模型的存储绑定取得 Store；未创建时调用指定的 Factory 并登记。
   * DataStore 仅需模型 ID 和 Config，不要求加载模型定义或创建 Runtime；
   * ValueStore 则先通过 getRuntime() 准备模型 Runtime。
   * 返回结果的 model、kind 必须与绑定一致，同一模型复用同一个 Store。
   * 缺少绑定或 Factory 时抛错，不自动选用其他持久化实现。
   */
  getStore(context: Context, model: ModelRef): Promise<DataStore | ValueStore>;
}
