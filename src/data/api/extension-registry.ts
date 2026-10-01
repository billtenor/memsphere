import type { DataStoreFactory } from "./data-store.js";
import type { DataExtension } from "./extension.js";
import type { ModelRuntimeFactory, ModelRuntimeFactoryTarget } from "./model-runtime.js";
import type { PayloadSerializer } from "./serializer.js";
import type { ValueStoreFactory } from "./value-store.js";

/**
 * Memsphere 进程内共享的扩展能力目录，不绑定 Project。
 * 保存 Extension 提供的 Serializer 和 Factory，不加载模型或创建 Runtime、Store。
 * 宿主在初始化时完成注册；被 DataManager 使用后，不再改变这份能力组合。
 */
export interface DataExtensionRegistry {
  /**
   * 登记整个扩展及其能力；先完整检查，再统一发布，失败时不留下部分登记。
   * 扩展 ID 唯一，version 记录所用版本，不支持同一 ID 同时注册多个版本。
   * 同一扩展内部和不同扩展之间均检查能力冲突：
   * - Serializer 的 contentType 不重复，Serializer ID 在所属扩展内不重复；
   * - Runtime Factory 的 target.model 与 target.metaModel 分别检查唯一性；
   * - DataStoreFactory 与 ValueStoreFactory 的 ID 在各自类别内唯一。
   * 重复登记时报错，不按加载顺序覆盖；登记后不得修改清单和能力标识。
   */
  register(extension: DataExtension): void;

  /** 按扩展 ID 查询清单，未注册时返回 undefined。 */
  get(id: string): DataExtension | undefined;

  /** 按注册顺序返回扩展清单的只读列表快照，不暴露内部可变列表。 */
  list(): readonly DataExtension[];

  /**
   * 按规范化后的 MIME 类型查询 Serializer，未匹配时返回 undefined。
   * 仅可忽略已知不影响内容解释的参数差异，不得一律丢弃 MIME 参数。
   */
  getPayloadSerializer(contentType: string): PayloadSerializer | undefined;

  /**
   * 按 target 精确查询 Factory，未注册时返回 undefined，不执行回退或创建。
   * DataManager 先查 { model }，未找到时再查 { metaModel }。
   */
  getModelRuntimeFactory(target: ModelRuntimeFactoryTarget): ModelRuntimeFactory | undefined;

  /** 按 DataStoreFactory ID 查询，未注册时返回 undefined。 */
  getDataStoreFactory(id: string): DataStoreFactory | undefined;

  /** 按 ValueStoreFactory ID 查询，未注册时返回 undefined。 */
  getValueStoreFactory(id: string): ValueStoreFactory | undefined;
}
