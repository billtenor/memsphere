import type { Payload } from "./payload.js";

/** 在所属数据空间内稳定且唯一的身份，由调用方提供。 */
export type DataId = string;

/** 保存模型定义的 Data 的 ID。 */
export type ModelRef = DataId;

/** 独立可寻址、可持久化、具有自身生命周期的数据单元。 */
export type Data = {
  id: DataId;
  /** 描述本 Data 领域含义的模型。 */
  model: ModelRef;
  /** 原始载荷及其表示格式；不包含存储管理信息。 */
  payload: Payload;
};
