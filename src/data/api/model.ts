import type { Data } from "./data.js";

/** 模型定义的运行时表示；TDefinition 是定义按原标准解码后的类型。 */
export interface Model<TDefinition = unknown> {
  /** 保存这份模型定义的 Data。 */
  readonly data: Data;
  /** Model Payload 反序列化后的模型定义。 */
  readonly definition: TDefinition;
}
