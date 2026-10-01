import type { DataStoreFactory } from "./data-store.js";
import type { ModelRuntimeFactory } from "./model-runtime.js";
import type { PayloadSerializer } from "./serializer.js";
import type { ValueStoreFactory } from "./value-store.js";

/**
 * 扩展提供的能力清单；由 Memsphere 检查冲突、组织创建和管理实例。
 * 内置扩展按单个可独立替换的 Serializer 或 Factory 拆分，由默认装配列表组合。
 * 业务扩展仍可在一个清单中组合多个实现。
 */
export interface DataExtension {
  /** 全局稳定的扩展 ID。 */
  readonly id: string;
  readonly version: string;

  readonly payloadSerializers?: readonly PayloadSerializer[];
  readonly modelRuntimeFactories?: readonly ModelRuntimeFactory[];
  readonly dataStoreFactories?: readonly DataStoreFactory[];
  readonly valueStoreFactories?: readonly ValueStoreFactory[];
}
