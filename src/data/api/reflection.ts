import type { ModelRef } from "./data.js";

/** 模型的身份与根类型；根类型可以是 object、array、scalar 或 map。 */
export interface Descriptor {
  readonly id: ModelRef;
  readonly root: TypeDescriptor;
}

/** 根类型和嵌套类型使用同一套描述，递归结构通过描述符之间的引用表达。 */
export type TypeDescriptor =
  | ObjectDescriptor
  | ArrayDescriptor
  | ScalarDescriptor
  | MapDescriptor;

/** 对象的字段结构；不绑定具体值实例。 */
export interface ObjectDescriptor {
  readonly kind: "object";
  readonly description?: string;
  /** 模型声明的字段，不表示某个值实例已经设置了这些字段。 */
  readonly fields: readonly FieldDescriptor[];
  /** 声明字段优先；否则按 additionalProperties 描述动态字段，不允许时返回 undefined。 */
  field(name: string): FieldDescriptor | undefined;
  /** 动态字段的类型；省略表示不提供动态字段的反射访问。 */
  readonly additionalProperties?: TypeDescriptor;
}

/**
 * 字段描述属于对象类型，不是某条数据上的访问路径。
 * 同一描述符图内，parent.field(name) 必须返回同一 FieldDescriptor 对象。
 * 动态字段由 parent.field(name) 按 additionalProperties 描述，不加入 fields。
 */
export interface FieldDescriptor {
  readonly parent: ObjectDescriptor;
  readonly name: string;
  readonly description?: string;
  readonly type: TypeDescriptor;
}

/** 同类型元素组成的有序数组；元素可以是任意 TypeDescriptor。 */
export interface ArrayDescriptor {
  readonly kind: "array";
  readonly description?: string;
  readonly element: TypeDescriptor;
}

/** 键由值实例提供，不是模型预先声明的对象字段。 */
export interface MapDescriptor {
  readonly kind: "map";
  readonly description?: string;
  readonly key: TypeDescriptor;
  readonly value: TypeDescriptor;
}

/** 标量是反射中不再按字段或索引展开的值。 */
export interface ScalarDescriptor {
  readonly kind: "scalar";
  readonly description?: string;
  readonly scalar: ScalarType;
  /** 仅 string、number 可关联枚举，且必须与 enum.scalar 一致。 */
  readonly enum?: EnumDescriptor;
}

/**
 * 标量种类对应内存值类型，不区分序列化编码。
 * number 是 JS 双精度浮点数；bigint 是任意精度整数，两者不隐式转换。
 */
export type ScalarType = "null" | "boolean" | "number" | "string" | "bigint" | "bytes";

/** bytes 作为一个整体值读写；undefined 只用于表示缺失，不是标量值。 */
export type Scalar = null | boolean | number | string | bigint | Uint8Array;

/**
 * 标量的枚举描述，不是第五种 TypeDescriptor，也不绑定具体值实例。
 * 成员值必须全部符合 scalar；模型创建时检查，不做名称与实际值的隐式转换。
 */
export interface EnumDescriptor {
  readonly name?: string;
  readonly description?: string;
  readonly scalar: "string" | "number";
  /** true 允许同类型的未声明值；false 只接受 values 中的值。 */
  readonly open: boolean;
  /** 按声明顺序排列；成员可无名称，有名称时须唯一。 */
  readonly values: readonly EnumValueDescriptor[];

  /** 按成员名精确查找；未声明时返回 undefined。 */
  byName(name: string): EnumValueDescriptor | undefined;
  /**
   * 按实际值查找，不做类型转换；未声明或类型不匹配时返回 undefined。
   * 使用 SameValueZero 比较；多个名称对应同一值时返回声明顺序中的第一项。
   */
  byValue(value: string | number): EnumValueDescriptor | undefined;
}

/** 枚举成员的定义；同一枚举的列表与查询须复用同一成员描述符。 */
export interface EnumValueDescriptor {
  readonly parent: EnumDescriptor;
  /** 模型未命名成员时省略，不根据实际值自动生成名称。 */
  readonly name?: string;
  readonly value: string | number;
  readonly description?: string;
}

/**
 * 值实例的反射操作对象；通过 kind 区分操作能力，不要求先转换为对象视图。
 * descriptor 描述其结构；value 返回当前原始值实例，而不是另一个反射对象。
 *
 * get() 和遍历返回绑定父字段、数组元素或 Map 条目值的子视图，写操作直接反映到父值。
 * 父容器通过 set / delete / remove / clear 替换或删除位置后，旧子视图及其后代失效；
 * 数组长度变化会使该数组已有的元素视图失效，数组视图本身仍可用。
 * Map 增删其他键不影响已有条目值的视图。
 * 失效视图的值读写操作须报错，调用方重新 get。
 *
 * 写入使用原始值，由实现检查结构、类型及枚举取值规则；不接受 Value 包装对象作为原始值。
 * 写入失败不得修改目标位置；除 Map 的键身份外，不承诺输入的复制或别名关系。
 * reflect() 与任意写入均须保留 Map 键的身份，包括嵌套 Map 的键。
 * 持有视图期间通过这些接口修改结构，不直接修改 value 暴露的原始对象或字节。
 */
export type Value = ObjectValue | ArrayValue | ScalarValue | MapValue;

/** 对具体对象值的字段操作；字段查询与类型信息留在 descriptor。 */
export interface ObjectValue extends Iterable<[FieldDescriptor, Value]> {
  readonly kind: "object";
  readonly descriptor: ObjectDescriptor;
  /** 当前原始值实例；可能由普通对象或自定义内存类型实现。 */
  readonly value: unknown;

  /**
   * 判断字段实际是否存在。null、false、0、空字符串、空数组都算存在。
   * 已存在但值为 undefined 的可反射字段是非法输入，验证时须报错，不能当作缺失。
   * 所有接收 field 的操作均检查 field === descriptor.field(field.name)，
   * 外来字段描述符报错，不能当成字段缺失。
   */
  has(field: FieldDescriptor): boolean;
  /** 缺失返回 undefined；不合成默认值，也不创建子对象。 */
  get(field: FieldDescriptor): Value | undefined;
  /** 设置原始字段值；undefined 非法，删除应使用 delete()。 */
  set(field: FieldDescriptor, value: unknown): void;
  /** 删除字段，返回此前是否存在；不是重置为零值或默认值。 */
  delete(field: FieldDescriptor): boolean;

  /** 只遍历当前存在且可反射的字段，不自动纳入原型属性；不承诺顺序。 */
  [Symbol.iterator](): IterableIterator<[FieldDescriptor, Value]>;
  entries(): IterableIterator<[FieldDescriptor, Value]>;
}

/**
 * 对密集数组的元素操作，不允许空洞或 undefined 元素。
 * 索引必须是整数；非整数时报错。遍历期间不得改变数组结构。
 */
export interface ArrayValue extends Iterable<Value> {
  readonly kind: "array";
  readonly descriptor: ArrayDescriptor;
  readonly value: unknown;
  readonly length: number;

  /** index < 0 或 index >= length 时返回 undefined。 */
  get(index: number): Value | undefined;
  /** 替换已有元素，越界时报错；不能借此扩展数组或制造空洞。 */
  set(index: number, value: unknown): void;
  /** 追加一个原始元素，返回新的 length。 */
  push(value: unknown): number;
  /** 插入位置允许 [0, length]；后续元素右移，其他位置报错。 */
  insert(index: number, value: unknown): void;
  /** 删除已有元素，后续元素左移；越界时报错。 */
  remove(index: number): void;
  clear(): void;

  [Symbol.iterator](): IterableIterator<Value>;
  entries(): IterableIterator<[number, Value]>;
  keys(): IterableIterator<number>;
  values(): IterableIterator<Value>;
}

/**
 * Map 的键与值均按描述符检查；不接受 undefined 或 Value 包装对象。
 * 键使用 SameValueZero：基本值按值比较（NaN 相等、正负零相等），对象和字节按身份比较。
 * 不转换、复制键；keys / entries 返回的原始键是借用引用，可直接用于 has / get / delete。
 * 使用期间不直接修改任何入口取得的复合键；更换键应删除旧条目后重新插入。
 * 迭代按键的插入顺序；替换值不改变顺序，删除后重新插入放在末尾。
 * 遍历期间不得增删键；实现不要求原始值实例一定是原生 JS Map。
 */
export interface MapValue extends Iterable<[unknown, Value]> {
  readonly kind: "map";
  readonly descriptor: MapDescriptor;
  readonly value: unknown;
  readonly size: number;

  /** 键类型不符合 descriptor.key 时报错；不存在时返回 false。 */
  has(key: unknown): boolean;
  /** 键类型不符合时同样报错；不存在时返回 undefined，不创建条目。 */
  get(key: unknown): Value | undefined;
  /** 新增或替换原始条目值；键和值不符合描述时均报错。 */
  set(key: unknown, value: unknown): this;
  /** 键类型不符合时报错；返回是否删除了已有条目。 */
  delete(key: unknown): boolean;
  clear(): void;

  /** 键保持原始身份；只有条目值包装为可修改的子 Value。 */
  [Symbol.iterator](): IterableIterator<[unknown, Value]>;
  entries(): IterableIterator<[unknown, Value]>;
  keys(): IterableIterator<unknown>;
  values(): IterableIterator<Value>;
}

/** 对一个标量值的整体读写，不提供字段或元素访问。 */
export interface ScalarValue {
  readonly kind: "scalar";
  readonly descriptor: ScalarDescriptor;
  /** 每次读取都返回当前值，而不是 reflect() 时取得的快照。 */
  readonly value: Scalar;
  /**
   * 类型须与 descriptor.scalar 一致，不做字符串与数字等隐式转换。
   * 存在枚举描述时遵循其 open 规则；成员名不是实际值的替代输入。
   * 子视图写回父容器；根标量更新本视图持有的值，不修改调用方原来的 JS 变量。
   * 此操作不会使本视图或同位置的其他标量视图失效，它们都能读取更新后的值。
   */
  set(value: Scalar): void;
}
