import type { Context } from "./context.js";
import type { PayloadContent } from "./payload.js";
import type { Descriptor } from "./reflection.js";

/**
 * 一种内容格式的序列化能力；TValue 是值实例的内存类型。
 * 实现需检查 Descriptor 与格式兼容，并与 Runtime 约定一致的值实例表示。
 * Descriptor 只描述内存结构；额外的格式专属信息由 Serializer 实现持有。
 */
export interface PayloadSerializer<TValue = unknown> {
  /** 扩展内稳定的标识，用于诊断和冲突检测。 */
  readonly id: string;
  /** 唯一处理的 MIME 类型，同时用于标识序列化输出。 */
  readonly contentType: string;

  deserialize(
    context: Context,
    descriptor: Descriptor,
    content: PayloadContent
  ): Promise<TValue>;

  serialize(
    context: Context,
    descriptor: Descriptor,
    value: TValue
  ): Promise<PayloadContent>;
}
