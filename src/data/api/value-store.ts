import type { Config } from "./config.js";
import type { Context } from "./context.js";
import type { DataId, ModelRef } from "./data.js";
import type { ModelRuntime } from "./model-runtime.js";
import type { DeleteOptions, ListOptions, ListResult, StoreId, UpdateOptions } from "./store.js";

/**
 * 直接接收和返回模型的值实例，不要求调用方构造 Payload，不保存反射操作对象 Value。
 * 实现负责存储映射和内部编码，可复用 Serializer，并恢复与 Runtime 兼容的值实例。
 * 不支持的结构或值须明确报错。
 * 存在性、版本条件检查与对应写入或删除须原子执行，不支持时明确报错。
 */
export interface ValueStore {
  readonly kind: "ValueStore";
  /** 业务指定的 Store 身份；一个模型可以对应多个不同 ID 的 Store。 */
  readonly id: StoreId;
  /** 此 Store 唯一绑定的模型。 */
  readonly model: ModelRef;

  /** 按 ID 读取记录，不存在时返回 undefined。 */
  get(context: Context, id: DataId): Promise<StoredValue | undefined>;
  /** 按 ID 检查记录是否存在，不能用作写入原子条件检查的替代。 */
  has(context: Context, id: DataId): Promise<boolean>;
  /** 创建记录，ID 已存在时报错，不覆盖已有记录。 */
  create(
    context: Context,
    id: DataId,
    value: unknown
  ): Promise<StoredValue>;
  /** 整条替换已有值实例，不合并字段；ID 不存在时报错，指定版本须匹配。 */
  update(
    context: Context,
    id: DataId,
    value: unknown,
    options?: UpdateOptions
  ): Promise<StoredValue>;
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

/** 所属模型由 store.model 提供；可选的管理信息由 Store 提供。 */
export type StoredValue = {
  /** 数据的身份。 */
  id: DataId;
  /** 模型的值实例，可交给对应 Runtime 的 reflect() 使用。 */
  value: unknown;
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

/** 根据 StoreId、模型 Runtime 和实现专属配置创建 ValueStore。 */
export interface ValueStoreFactory {
  /** 存储实现的稳定标识，例如 acme/order-database。 */
  readonly id: string;

  /** 返回 Store 的 id 必须等于传入 ID，model 必须等于 runtime.descriptor.id。 */
  createStore(
    context: Context,
    id: StoreId,
    runtime: ModelRuntime,
    config: Config
  ): Promise<ValueStore>;
}
