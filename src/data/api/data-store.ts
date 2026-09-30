import type { Config } from "./config.js";
import type { Context } from "./context.js";
import type { Data, DataId, ModelRef } from "./data.js";
import type { DeleteOptions, ListOptions, ListResult, StoreId, UpdateOptions } from "./store.js";

/**
 * 保存完整 Data，不解释模型或反序列化 Payload。
 * 写入时须检查 data.model 与绑定模型一致；身份、模型和内容属于同一次提交。
 * 创建不得覆盖已有记录；支持版本条件时，条件检查与写入或删除须原子执行。
 * 不支持版本条件时明确报错；无版本条件的并发更新/删除语义由实现声明。
 * 写入只消费一次输入流；读到 EOF 且存储写入完成后 Promise 才成功。
 * 输入流出错、取消或存储失败时 Promise 拒绝，不自动重试已消费的输入。
 * 写入中的可见性、失败后是否保留部分内容，由实现声明。
 */
export interface DataStore {
  readonly kind: "DataStore";
  /** 业务指定的 Store 身份；一个模型可以对应多个不同 ID 的 Store。 */
  readonly id: StoreId;
  /** 此 Store 唯一绑定的模型。 */
  readonly model: ModelRef;

  /** 按 ID 读取完整记录，不存在时返回 undefined。 */
  get(context: Context, id: DataId): Promise<StoredData | undefined>;
  /** 按 ID 检查记录是否存在，不能用作写入原子条件检查的替代。 */
  has(context: Context, id: DataId): Promise<boolean>;
  /** 创建记录，ID 已存在时报错，不覆盖已有记录。 */
  create(context: Context, data: Data): Promise<void>;
  /** 整条替换 Data，不合并字段；检查时 ID 不存在时报错，并发删除语义由实现声明。 */
  update(
    context: Context,
    data: Data,
    options?: UpdateOptions
  ): Promise<void>;
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

/** 可选的字节追加能力；不要求所有 DataStore 实现。 */
export interface AppendableDataStore extends DataStore {
  /**
   * 将输入流的字节追加到已有记录末尾；记录不存在时报错，不自动创建。
   * data.model、payload.contentType 必须与目标记录一致。
   * 不插入分隔符、不合并结构化数据；完成与错误通知沿用 DataStore 写入约定。
   * 失败或取消时可能已追加部分字节，不保证回滚；调用方不能直接重试整个输入。
   * 不保证整条输入流在并发追加时连续写入，具体并发语义由实现声明。
   */
  append(context: Context, data: Data): Promise<void>;
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

/** 根据 StoreId、模型 ID 和实现专属配置创建 DataStore，不需要模型 Runtime。 */
export interface DataStoreFactory {
  /** 存储实现的稳定标识，例如 memsphere/filesystem。 */
  readonly id: string;

  /** 返回 Store 的 id、model 必须与传入的身份一致。 */
  createStore(
    context: Context,
    id: StoreId,
    model: ModelRef,
    config: Config
  ): Promise<DataStore>;
}
