import type { DataId, ModelRef } from "./data.js";
import type { DataStore } from "./data-store.js";
import type { ValueStore } from "./value-store.js";

export type UpdateOptions = {
  /** 预期的当前记录版本，必须为正整数；不匹配时报冲突。 */
  expectedRevision?: number;
};

export type DeleteOptions = {
  /** 预期的当前记录版本，必须为正整数；记录缺失或版本不匹配时报冲突。 */
  expectedRevision?: number;
};

export type ListOptions = {
  /** 本页最多返回的条数，必须为正整数；默认值和上限由 Store 声明。 */
  limit?: number;
  /** 同一 Store 上一页返回的续查游标，须原样传回；无效或过期时报错。 */
  cursor?: string;
};

/** 分页结果只含 ID，所属模型由 Store 确定，完整内容通过 get() 读取。 */
export type ListResult = {
  items: Array<{ id: DataId }>;
  /** 存在时可继续翻页；缺省表示枚举结束，不以本页条数判断是否结束。 */
  nextCursor?: string;
};

/** 按模型 ID 管理已创建的 Store，不负责创建实例或跨 Store 查找数据。 */
export interface StoreRegistry {
  /** 按 store.model 登记；同一模型只能登记一个 Store，重复登记时报错。 */
  register(store: DataStore | ValueStore): void;
  /** 查询已登记的 Store，未找到时返回 undefined。 */
  get(model: ModelRef): DataStore | ValueStore | undefined;
}
