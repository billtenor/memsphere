import type { Config } from "./config.js";
import type { Context } from "./context.js";
import type { Data, DataId, ModelRef } from "./data.js";
import type { DeleteOptions, ListOptions, ListResult, UpdateOptions } from "./store.js";

/**
 * 保存完整 Data，不解释模型或反序列化 Payload。
 * 写入时须检查 data.model 与绑定模型一致；身份、模型和内容属于同一次提交。
 * 创建不得覆盖已有记录；支持版本条件时，条件检查与写入或删除须原子执行。
 * 不支持版本条件时明确报错；无版本条件的并发更新/删除语义由实现声明。
 */
export interface DataStore {
  readonly kind: "DataStore";
  /** 此 Store 唯一绑定的模型。 */
  readonly model: ModelRef;

  /** 按 ID 读取完整记录，不存在时返回 undefined。 */
  get(context: Context, id: DataId): Promise<StoredData | undefined>;
  /** 按 ID 检查记录是否存在，不能用作写入原子条件检查的替代。 */
  has(context: Context, id: DataId): Promise<boolean>;
  /** 创建记录，ID 已存在时报错，不覆盖已有记录。 */
  create(context: Context, data: Data): Promise<StoredData>;
  /** 整条替换 Data，不合并字段；检查时 ID 不存在时报错，并发删除语义由实现声明。 */
  update(
    context: Context,
    data: Data,
    options?: UpdateOptions
  ): Promise<StoredData>;
  /** 无版本条件时缺失返回 false；有条件时缺失或版本不匹配均报冲突。 */
  delete(
    context: Context,
    id: DataId,
    options?: DeleteOptions
  ): Promise<boolean>;
  /**
   * 分页列举 ID；数据不变且游标有效时，连续翻页完整且不重复。
   * 并发修改时不保证跨页快照，不提供业务字段过滤或任意排序。
   */
  list(context: Context, options?: ListOptions): Promise<ListResult>;
}

/** 存储管理信息由 Store 提供，不支持或无法取得时可省略。 */
export type StoredData = {
  /** 完整 Data，包含 id、model 和 payload。 */
  data: Data;
  /** 该存储记录的版本，用于并发更新检查，不是模型版本。 */
  revision?: number;
  /** 创建时间，Unix 时间戳，单位为毫秒；更新时保留。 */
  createdAt?: number;
  /** 可信创建主体 ID；未知时可省略或为 null，更新时保留。 */
  createdBy?: string | null;
  /** 最近更新时间，Unix 时间戳，单位为毫秒。 */
  updatedAt?: number;
  /** 最近成功更新的可信主体 ID；未知时省略或为 null，不沿用前次更新者。 */
  updatedBy?: string | null;
};

/** 根据模型 ID 和实现专属配置创建 DataStore，不需要模型 Runtime。 */
export interface DataStoreFactory {
  /** 存储实现的稳定标识，例如 memsphere/filesystem。 */
  readonly id: string;

  /** 返回 Store 的 model 必须等于传入的模型 ID。 */
  createStore(
    context: Context,
    model: ModelRef,
    config: Config
  ): Promise<DataStore>;
}
