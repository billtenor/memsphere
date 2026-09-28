import type { Context } from "./context.js";
import type { ModelRef } from "./data.js";
import type { Model } from "./model.js";
import type { Descriptor, Value } from "./reflection.js";

/** 绑定一个具体模型，提供结构描述和值实例的反射访问能力。 */
export interface ModelRuntime {
  readonly descriptor: Descriptor;

  /**
   * 检查值实例符合反射类型及枚举取值规则；返回视图的 descriptor 为 descriptor.root。
   * 不转换值、不补默认值；不符合时抛错。
   */
  reflect(value: unknown): Value;
}

/** 当前数据空间内已创建的 Runtime；查询不触发加载或创建。 */
export interface ModelRuntimeRegistry {
  /** 按 runtime.descriptor.id 登记；重复登记时报错。 */
  register(runtime: ModelRuntime): void;
  /** 未登记时返回 undefined，不表示模型数据不存在。 */
  get(ref: ModelRef): ModelRuntime | undefined;
}

/** Factory 按具体模型或元模型匹配，二者选一。 */
export type ModelRuntimeFactoryTarget =
  | { readonly model: ModelRef; readonly metaModel?: never }
  | { readonly metaModel: ModelRef; readonly model?: never };

/** 模型定义标准的扩展入口；框架选择 Factory、准备依赖并登记返回的 Runtime。 */
export interface ModelRuntimeFactory<TDefinition = unknown> {
  /** 同时存在两类匹配时，具体模型优先于元模型。 */
  readonly target: ModelRuntimeFactoryTarget;

  /**
   * 根据已解码的模型定义创建 Runtime，并检查定义是否受支持。
   * registry 只查询已准备好的依赖，依赖未就绪时报错。
   * 返回 Runtime 的 descriptor.id 必须等于 model.data.id。
   */
  createRuntime(
    context: Context,
    model: Model<TDefinition>,
    registry: ModelRuntimeRegistry
  ): Promise<ModelRuntime>;
}
