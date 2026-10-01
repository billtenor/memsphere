// 仅供 TypeScript 编译检查，不执行本文件；操作桩不实现 Runtime 或真实反射行为。
import type {
  ArrayDescriptor,
  ArrayValue,
  Context,
  DataId,
  Descriptor,
  EnumDescriptor,
  EnumValueDescriptor,
  FieldDescriptor,
  MapDescriptor,
  MapValue,
  ModelRuntime,
  ObjectDescriptor,
  ObjectValue,
  Scalar,
  ScalarDescriptor,
  ScalarType,
  ScalarValue,
  StoredValue,
  TypeDescriptor,
  Value,
  ValueStore
} from "../../src/data/index.js";

const numberType: ScalarDescriptor = { kind: "scalar", scalar: "number" };
const stringType: ScalarDescriptor = { kind: "scalar", scalar: "string" };
const nullType: ScalarDescriptor = { kind: "scalar", scalar: "null" };
const booleanType: ScalarDescriptor = { kind: "scalar", scalar: "boolean" };
const bigintType: ScalarDescriptor = { kind: "scalar", scalar: "bigint" };
const bytesType: ScalarDescriptor = { kind: "scalar", scalar: "bytes" };

// 枚举附着在 string/number 标量上，不增加独立 kind；查询桩只证明接口形状。
const statusEnum: EnumDescriptor = {
  name: "Status",
  description: "Closed string enum with aliases and an unnamed member",
  scalar: "string",
  open: false,
  get values() { return [draftStatus, draftAlias, unnamedStatus]; },
  byName(name: string): EnumValueDescriptor | undefined { return compileOnly(); },
  byValue(value: string | number): EnumValueDescriptor | undefined { return compileOnly(); }
};
const draftStatus: EnumValueDescriptor = {
  parent: statusEnum, name: "DRAFT", value: "draft", description: "Initial state"
};
const draftAlias: EnumValueDescriptor = {
  parent: statusEnum, name: "PENDING", value: "draft"
};
const unnamedStatus: EnumValueDescriptor = { parent: statusEnum, value: "archived" };
const statusType: ScalarDescriptor = { kind: "scalar", scalar: "string", enum: statusEnum };

const priorityEnum: EnumDescriptor = {
  scalar: "number",
  open: true,
  get values() { return [normalPriority, highPriority, highPriorityAlias, unnamedPriority]; },
  byName(name: string): EnumValueDescriptor | undefined { return compileOnly(); },
  byValue(value: string | number): EnumValueDescriptor | undefined { return compileOnly(); }
};
const normalPriority: EnumValueDescriptor = { parent: priorityEnum, name: "NORMAL", value: 0 };
const highPriority: EnumValueDescriptor = { parent: priorityEnum, name: "HIGH", value: 2 };
const highPriorityAlias: EnumValueDescriptor = { parent: priorityEnum, name: "URGENT", value: 2 };
const unnamedPriority: EnumValueDescriptor = { parent: priorityEnum, value: 5 };
const priorityType: ScalarDescriptor = { kind: "scalar", scalar: "number", enum: priorityEnum };

const itemType: ObjectDescriptor = {
  kind: "object",
  get fields() { return [quantityField]; },
  field(name) { return this.fields.find(field => field.name === name); }
};
const quantityField: FieldDescriptor = {
  parent: itemType, name: "quantity", type: numberType
};
const itemsType: ArrayDescriptor = { kind: "array", element: itemType };
const numberArrayType: ArrayDescriptor = { kind: "array", element: numberType };
const matrixType: ArrayDescriptor = { kind: "array", element: numberArrayType };
const itemsByNumberType: MapDescriptor = { kind: "map", key: numberType, value: itemType };
const itemsByObjectType: MapDescriptor = { kind: "map", key: itemType, value: itemType };
const labelsByBytesType: MapDescriptor = { kind: "map", key: bytesType, value: stringType };
const matricesByArrayType: MapDescriptor = { kind: "map", key: numberArrayType, value: matrixType };
const nestedMapType: MapDescriptor = {
  kind: "map", key: itemsByNumberType, value: labelsByBytesType
};
// Map<T, null> 表达集合，无需独立 SetDescriptor 或 set kind。
const itemSetType: MapDescriptor = { kind: "map", key: itemType, value: nullType };
const mapsType: ArrayDescriptor = { kind: "array", element: itemsByNumberType };
const mapKeyKinds: readonly TypeDescriptor[] = [
  itemsByNumberType.key, itemsByObjectType.key, matricesByArrayType.key, nestedMapType.key
];
const mapValueKinds: readonly TypeDescriptor[] = [
  labelsByBytesType.value, itemsByObjectType.value, matricesByArrayType.value, nestedMapType.value
];

// 同一名称复用 FieldDescriptor 身份，动态字段不加入静态声明列表。
const dynamicFields = new Map<string, FieldDescriptor>();
const labelsType: ObjectDescriptor = {
  kind: "object",
  fields: [],
  additionalProperties: stringType,
  field(name) {
    let field = dynamicFields.get(name);
    if (!field) {
      field = { parent: this, name, type: stringType };
      dynamicFields.set(name, field);
    }
    return field;
  }
};

const orderType: ObjectDescriptor = {
  kind: "object",
  get fields() {
    return [itemsField, noteField, labelsField, matrixField, itemsByNumberField, statusField, priorityField];
  },
  field(name) { return this.fields.find(field => field.name === name); }
};
const itemsField: FieldDescriptor = { parent: orderType, name: "items", type: itemsType };
const noteField: FieldDescriptor = { parent: orderType, name: "note", type: nullType };
const labelsField: FieldDescriptor = { parent: orderType, name: "labels", type: labelsType };
const matrixField: FieldDescriptor = { parent: orderType, name: "matrix", type: matrixType };
const itemsByNumberField: FieldDescriptor = {
  parent: orderType, name: "itemsByNumber", type: itemsByNumberType
};
const statusField: FieldDescriptor = { parent: orderType, name: "status", type: statusType };
const priorityField: FieldDescriptor = { parent: orderType, name: "priority", type: priorityType };

// 根和嵌套数组都使用同一 TypeDescriptor；递归引用不需要编码或字段编号。
const recursiveArrayType: ArrayDescriptor = {
  kind: "array",
  get element() { return recursiveArrayType; }
};
const recursiveMapType: MapDescriptor = {
  kind: "map",
  key: stringType,
  get value() { return recursiveMapType; }
};
const recursiveMapKeyType: MapDescriptor = {
  kind: "map",
  get key() { return recursiveMapKeyType; },
  value: nullType
};
const recursiveObjectType: ObjectDescriptor = {
  kind: "object",
  get fields() { return [childrenField]; },
  field(name) { return this.fields.find(field => field.name === name); }
};
const childrenField: FieldDescriptor = {
  parent: recursiveObjectType,
  name: "children",
  type: { kind: "array", element: recursiveObjectType }
};

const objectModel: Descriptor = { id: "order-model", root: orderType };
const arrayModel: Descriptor = { id: "matrix-model", root: matrixType };
const scalarModel: Descriptor = { id: "counter-model", root: numberType };
const nullModel: Descriptor = { id: "null-model", root: nullType };
const mapModel: Descriptor = { id: "indexed-items-model", root: itemsByNumberType };
const stringEnumModel: Descriptor = { id: "status-model", root: statusType };
const numberEnumModel: Descriptor = { id: "priority-model", root: priorityType };
const nestedKinds: readonly TypeDescriptor[] = [
  itemType, itemsType, matrixType, recursiveArrayType, recursiveObjectType, nullType,
  itemsByNumberType, mapsType, nestedMapType, recursiveMapType, recursiveMapKeyType,
  statusType, priorityType
];
const scalarKinds: readonly ScalarType[] = ["null", "boolean", "number", "string", "bigint", "bytes"];
const scalars: readonly Scalar[] = [null, false, 0, "", 123n, new Uint8Array([1])];

// 这些类仅证明扩展可以实现公开形状；不运行它们，也不据此验证写穿/失效等语义。
function compileOnly(): never {
  throw new Error("Compile-time reflection fixture only");
}

class ObjectView implements ObjectValue {
  readonly kind = "object";
  constructor(readonly descriptor: ObjectDescriptor) {}
  get value(): unknown { return compileOnly(); }
  has(field: FieldDescriptor): boolean { return compileOnly(); }
  get(field: FieldDescriptor): Value | undefined { return compileOnly(); }
  set(field: FieldDescriptor, value: unknown): void { compileOnly(); }
  delete(field: FieldDescriptor): boolean { return compileOnly(); }
  [Symbol.iterator](): IterableIterator<[FieldDescriptor, Value]> { return compileOnly(); }
  entries(): IterableIterator<[FieldDescriptor, Value]> { return compileOnly(); }
}

class ArrayView implements ArrayValue {
  readonly kind = "array";
  constructor(readonly descriptor: ArrayDescriptor) {}
  get value(): unknown { return compileOnly(); }
  get length(): number { return compileOnly(); }
  get(index: number): Value | undefined { return compileOnly(); }
  set(index: number, value: unknown): void { compileOnly(); }
  push(value: unknown): number { return compileOnly(); }
  insert(index: number, value: unknown): void { compileOnly(); }
  remove(index: number): void { compileOnly(); }
  clear(): void { compileOnly(); }
  [Symbol.iterator](): IterableIterator<Value> { return compileOnly(); }
  entries(): IterableIterator<[number, Value]> { return compileOnly(); }
  keys(): IterableIterator<number> { return compileOnly(); }
  values(): IterableIterator<Value> { return compileOnly(); }
}

class ScalarView implements ScalarValue {
  readonly kind = "scalar";
  constructor(readonly descriptor: ScalarDescriptor) {}
  get value(): Scalar { return compileOnly(); }
  set(value: Scalar): void { compileOnly(); }
}

class MapView implements MapValue {
  readonly kind = "map";
  constructor(readonly descriptor: MapDescriptor) {}
  get value(): unknown { return compileOnly(); }
  get size(): number { return compileOnly(); }
  has(key: unknown): boolean { return compileOnly(); }
  get(key: unknown): Value | undefined { return compileOnly(); }
  set(key: unknown, value: unknown): this { return compileOnly(); }
  delete(key: unknown): boolean { return compileOnly(); }
  clear(): void { compileOnly(); }
  [Symbol.iterator](): IterableIterator<[unknown, Value]> { return compileOnly(); }
  entries(): IterableIterator<[unknown, Value]> { return compileOnly(); }
  keys(): IterableIterator<unknown> { return compileOnly(); }
  values(): IterableIterator<Value> { return compileOnly(); }
}

const orderView: ObjectValue = new ObjectView(orderType);
const itemView: ObjectValue = new ObjectView(itemType);
const itemsView: ArrayValue = new ArrayView(itemsType);
const matrixView: ArrayValue = new ArrayView(matrixType);
const labelsView: ObjectValue = new ObjectView(labelsType);
const counterView: ScalarValue = new ScalarView(numberType);
const nullView: ScalarValue = new ScalarView(nullType);
const itemsByNumberView: MapValue = new MapView(itemsByNumberType);
const itemsByObjectView: MapValue = new MapView(itemsByObjectType);
const labelsByBytesView: MapValue = new MapView(labelsByBytesType);
const matricesByArrayView: MapValue = new MapView(matricesByArrayType);
const nestedMapView: MapValue = new MapView(nestedMapType);
const itemSetView: MapValue = new MapView(itemSetType);
const statusView: ScalarValue = new ScalarView(statusType);
const priorityView: ScalarValue = new ScalarView(priorityType);
const rootValues: readonly Value[] = [
  orderView, matrixView, counterView, nullView, itemsByNumberView, statusView, priorityView
];

/**
 * review 示例：修改首条订单明细的数量，并追加一个原始明细对象。
 * get 得到的子视图写穿到父值，无需把每一层重新 set 回去。
 * push 后不再使用旧元素视图，避免依赖已失效的关联。
 */
async function updateOrderItems(
  context: Context,
  store: ValueStore,
  runtime: ModelRuntime,
  id: DataId,
  quantity: number
): Promise<StoredValue> {
  if (store.model !== runtime.descriptor.id) throw new Error("Model mismatch");
  const stored = await store.get(context, id);
  if (!stored) throw new Error("Order not found");
  const root = runtime.reflect(stored.value);
  if (root.kind !== "object") throw new Error("Order must be an object");

  const field = root.descriptor.field("items");
  const items = field ? root.get(field) : undefined;
  if (items?.kind !== "array") throw new Error("Order items must be an array");

  const first = items.get(0);
  if (first?.kind !== "object") throw new Error("First order item is missing");
  const quantityField = first.descriptor.field("quantity");
  const quantityValue = quantityField ? first.get(quantityField) : undefined;
  if (quantityValue?.kind !== "scalar" || quantityValue.descriptor.scalar !== "number") {
    throw new Error("Order item quantity must be a number");
  }
  quantityValue.set(quantity);
  items.push({ quantity: 1 });

  // 保存原始值实例，不把 Value 传给 Store。
  return store.update(context, id, root.value, { expectedRevision: stored.revision });
}

function updateRootScalar(runtime: ModelRuntime, initial: number): Scalar {
  const root = runtime.reflect(initial);
  if (root.kind !== "scalar" || root.descriptor.scalar !== "number") {
    throw new Error("Expected a number scalar root");
  }
  root.set(initial + 1);
  // 更新后的值从视图读取；初始 JS 变量不会因为 set 而被重新赋值。
  return root.value;
}

/**
 * Map 条目值也是子视图：消费者可继续访问对象字段并写回根 Map。
 * 写穿、相同键 set 后旧子视图失效、其他键增删不影响该子视图是待实现的契约，
 * 本例只检查调用形状，不执行或断言这些行为。
 */
function updateMappedQuantity(runtime: ModelRuntime, raw: unknown, key: unknown): unknown {
  const root = runtime.reflect(raw);
  if (root.kind !== "map") throw new Error("Expected a Map root");
  const item = root.get(key);
  if (item?.kind !== "object") throw new Error("Expected an object entry value");
  const quantity = item.descriptor.field("quantity");
  const child = quantity ? item.get(quantity) : undefined;
  if (child?.kind !== "scalar" || child.descriptor.scalar !== "number") {
    throw new Error("Expected a numeric quantity");
  }
  child.set(10);
  // 替换条目后消费者重新 get，不再依赖 item/child。
  root.set(key, { quantity: 20 });
  const replacement: Value | undefined = root.get(key);
  return root.value;
}

function updateNestedMap(value: ObjectValue): unknown {
  const field = value.descriptor.field("itemsByNumber");
  const items = field ? value.get(field) : undefined;
  if (items?.kind !== "map") throw new Error("Expected a Map field");
  items.set(1, { quantity: 3 });
  return value.value;
}

function readEnumMember(value: Value): EnumValueDescriptor | undefined {
  if (value.kind !== "scalar") return undefined;
  const enumeration: EnumDescriptor | undefined = value.descriptor.enum;
  const raw = value.value;
  if (!enumeration || (typeof raw !== "string" && typeof raw !== "number")) return undefined;
  return enumeration.byValue(raw);
}

// 描述符本身与值实例一样可穷尽窄化，根与嵌套没有另一套类型集合。
function narrowDescriptor(descriptor: TypeDescriptor): void {
  switch (descriptor.kind) {
    case "object": {
      const fields: readonly FieldDescriptor[] = descriptor.fields;
      const additional: TypeDescriptor | undefined = descriptor.additionalProperties;
      break;
    }
    case "array": {
      const element: TypeDescriptor = descriptor.element;
      break;
    }
    case "scalar": {
      const scalar: ScalarType = descriptor.scalar;
      const enumeration: EnumDescriptor | undefined = descriptor.enum;
      break;
    }
    case "map": {
      const key: TypeDescriptor = descriptor.key;
      const value: TypeDescriptor = descriptor.value;
      break;
    }
    default: {
      const exhaustive: never = descriptor;
    }
  }
}

function inspectNote(value: ObjectValue): "missing" | "null" | "other" {
  const field = value.descriptor.field("note");
  if (!field || !value.has(field)) return "missing";
  const note = value.get(field);
  if (note === undefined) return "missing";
  return note.kind === "scalar" && note.value === null ? "null" : "other";
}

function narrowRoot(value: Value): void {
  switch (value.kind) {
    case "object": {
      const descriptor: ObjectDescriptor = value.descriptor;
      const raw: unknown = value.value;
      const entries: IterableIterator<[FieldDescriptor, Value]> = value.entries();
      break;
    }
    case "array": {
      const descriptor: ArrayDescriptor = value.descriptor;
      const raw: unknown = value.value;
      const size: number = value.length;
      break;
    }
    case "scalar": {
      const descriptor: ScalarDescriptor = value.descriptor;
      const raw: Scalar = value.value;
      break;
    }
    case "map": {
      const descriptor: MapDescriptor = value.descriptor;
      const raw: unknown = value.value;
      const size: number = value.size;
      const entries: IterableIterator<[unknown, Value]> = value.entries();
      break;
    }
    default: {
      const exhaustive: never = value;
    }
  }
}

// 原始对象、原始嵌套数组与 null 都可作为写入输入，不需要反射包装。
orderView.set(itemsField, [{ quantity: 2 }]);
orderView.set(noteField, null);
orderView.set(matrixField, [[1, 2], [3]]);
orderView.set(itemsByNumberField, new Map([[1, { quantity: 2 }]]));
orderView.set(statusField, "draft");
orderView.set(priorityField, 2);
itemView.set(quantityField, 5);
const absentOrValue: Value | undefined = orderView.get(noteField);
const notePresent: boolean = orderView.has(noteField);
const noteDeleted: boolean = orderView.delete(noteField);
for (const [field, value] of orderView) {
  const descriptor: FieldDescriptor = field;
  const child: Value = value;
}
const objectEntries: IterableIterator<[FieldDescriptor, Value]> = orderView.entries();

const dynamicLabel = labelsView.descriptor.field("customer");
if (dynamicLabel) {
  labelsView.set(dynamicLabel, "alice");
  const dynamicValue: Value | undefined = labelsView.get(dynamicLabel);
}
const dynamicType: TypeDescriptor | undefined = labelsType.additionalProperties;
const declaredFields: readonly FieldDescriptor[] = labelsType.fields;

const pushedLength: number = itemsView.push({ quantity: 3 });
itemsView.set(0, { quantity: 4 });
itemsView.insert(0, { quantity: 5 });
itemsView.remove(0);
const maybeItem: Value | undefined = itemsView.get(0);
matrixView.push([1, 2]);
matrixView.set(0, [3, 4]);
const arrayEntries: IterableIterator<[number, Value]> = matrixView.entries();
const arrayKeys: IterableIterator<number> = matrixView.keys();
const arrayValues: IterableIterator<Value> = matrixView.values();
for (const row of matrixView) {
  if (row.kind === "array") {
    const cell: Value | undefined = row.get(0);
  }
}
matrixView.clear();
counterView.set(2);
nullView.set(null);
const currentCounter: Scalar = counterView.value;
const currentNull: Scalar = nullView.value;
new ScalarView(bigintType).set(9223372036854775807n);
new ScalarView(bytesType).set(new Uint8Array([1, 2]));
new ScalarView(booleanType).set(false);

const rawObjectKey = { quantity: 1 };
const rawBytesKey = new Uint8Array([1, 2]);
const rawArrayKey = [1, 2];
const rawMapKey = new Map([[1, { quantity: 1 }]]);
const chainedMap: MapValue = itemsByNumberView.set(1, { quantity: 2 }).set(2, { quantity: 3 });
const concreteMapView = new MapView(itemsByNumberType);
const concreteChainedMap: MapView = concreteMapView.set(1, { quantity: 2 });
itemsByObjectView.set(rawObjectKey, { quantity: 4 });
labelsByBytesView.set(rawBytesKey, "binary key");
matricesByArrayView.set(rawArrayKey, [[1, 2]]);
nestedMapView.set(rawMapKey, new Map([[rawBytesKey, "nested map value"]]));
new MapView(recursiveMapType).set("next", new Map());
const mapSize: number = itemsByNumberView.size;
const hasNumberKey: boolean = itemsByNumberView.has(1);
const maybeMappedItem: Value | undefined = itemsByNumberView.get(1);
const deletedNumberKey: boolean = itemsByNumberView.delete(1);
const mapEntries: IterableIterator<[unknown, Value]> = itemsByObjectView.entries();
const mapKeys: IterableIterator<unknown> = itemsByObjectView.keys();
const mapValues: IterableIterator<Value> = itemsByObjectView.values();
const mapIterator: IterableIterator<[unknown, Value]> = itemsByObjectView[Symbol.iterator]();
for (const [key, child] of itemsByObjectView) {
  const rawKey: unknown = key;
  const entryValue: Value = child;
  const present: boolean = itemsByObjectView.has(rawKey);
  const sameEntryView: Value | undefined = itemsByObjectView.get(rawKey);
}
for (const child of mapValues) {
  if (child.kind === "object") {
    const quantity = child.descriptor.field("quantity");
    if (quantity) child.set(quantity, 6);
  }
}
// keys/entries 暴露原始键，只有值是 Value。先结束遍历，再用保留的原始键删除。
const retainedKeys: unknown[] = [...itemsByObjectView.keys()];
for (const key of retainedKeys) {
  const deleted: boolean = itemsByObjectView.delete(key);
}
itemsByNumberView.clear();

// Map<T, null> 的存在性由 has 判断；get 返回持有 null 的 ScalarValue，不是直接 null。
itemSetView.set(rawObjectKey, null);
const setContains: boolean = itemSetView.has(rawObjectKey);
const setEntry: Value | undefined = itemSetView.get(rawObjectKey);
if (setEntry?.kind === "scalar") {
  const rawSetValue: Scalar = setEntry.value;
}
const setRemoved: boolean = itemSetView.delete(rawObjectKey);
itemSetView.clear();

// SameValueZero 与对象/bytes 身份是 runtime 契约；以下仅证明原始键可被接口消费。
// number 键的 NaN 等价于 NaN，+0 等价于 -0；对象/bytes 内容相同不代表键身份相同。
itemsByNumberView.set(NaN, { quantity: 1 });
itemsByNumberView.has(NaN);
itemsByNumberView.set(-0, { quantity: 2 });
itemsByNumberView.get(+0);
itemsByObjectView.has(rawObjectKey);
itemsByObjectView.has({ quantity: 1 });
labelsByBytesView.get(rawBytesKey);
labelsByBytesView.get(new Uint8Array([1, 2]));

const enumAttachedToScalar: EnumDescriptor | undefined = statusView.descriptor.enum;
const enumScalarKind: "string" | "number" = priorityEnum.scalar;
const openEnum: boolean = priorityEnum.open;
const closedEnum: boolean = statusEnum.open;
const enumName: string | undefined = priorityEnum.name;
const enumDescription: string | undefined = statusEnum.description;
const declaredMembers: readonly EnumValueDescriptor[] = statusEnum.values;
const unnamedMemberName: string | undefined = unnamedStatus.name;
const enumParent: EnumDescriptor = unnamedStatus.parent;
const memberValue: string | number = unnamedPriority.value;
const memberDescription: string | undefined = draftStatus.description;
const namedMember: EnumValueDescriptor | undefined = statusEnum.byName("DRAFT");
const aliasMember: EnumValueDescriptor | undefined = statusEnum.byName("PENDING");
const firstStringMember: EnumValueDescriptor | undefined = statusEnum.byValue("draft");
const firstNumberMember: EnumValueDescriptor | undefined = priorityEnum.byValue(2);
const namedNumberAlias: EnumValueDescriptor | undefined = priorityEnum.byName("URGENT");
const unnamedStringLookup: EnumValueDescriptor | undefined = statusEnum.byValue("archived");
const unnamedNumberLookup: EnumValueDescriptor | undefined = priorityEnum.byValue(5);
const missingMember: EnumValueDescriptor | undefined = statusEnum.byName("MISSING");
// 同值别名返回声明顺序第一项，查询结果与 values 复用成员身份，均待 runtime 验证。
// 类型不匹配的 byValue 返回 undefined，不隐式转换；此签名仍允许 string | number。
statusEnum.byValue(2);
priorityEnum.byValue("2");
statusView.set("draft");
priorityView.set(99); // open 数字枚举允许未声明的同类型值。

// unknown 输入允许 TS 层接收任意值。下面这些必须由 Runtime 拒绝，不能伪造类型反例。
function writesRequiringRuntimeValidation(): void {
  orderView.set(noteField, undefined);
  itemsView.push(undefined);
  itemsView.set(0, orderView);
  itemView.set(quantityField, "not a number");
  itemsByNumberView.has("not a number");
  itemsByNumberView.get(undefined);
  itemsByNumberView.delete(null);
  itemsByNumberView.set(undefined, { quantity: 1 });
  itemsByNumberView.set(1, undefined);
  itemsByNumberView.set(1, "not an item");
  itemsByObjectView.set(itemView, { quantity: 1 });
  itemsByNumberView.set(1, itemView);
  itemSetView.set(rawObjectKey, true);
}

// ScalarDescriptor 没有依赖类型：enum 同型匹配、成员同型、closed 成员校验由 runtime 承担。
function enumsRequiringRuntimeValidation(): void {
  const mismatchedScalar: ScalarDescriptor = { kind: "scalar", scalar: "number", enum: statusEnum };
  const unsupportedScalar: ScalarDescriptor = { kind: "scalar", scalar: "bytes", enum: statusEnum };
  const mismatchedMember: EnumValueDescriptor = { parent: statusEnum, value: 123 };
  statusView.set("not declared"); // closed 枚举拒绝未声明值。
  statusView.set("DRAFT"); // 成员名不替代实际值，不做名称到值的隐式转换。
  statusView.set(2);
  priorityView.set("2");
  priorityView.set(true); // open 只放开成员集合，不放开标量类型。
}

// @ts-expect-error 模型必须描述根类型，不能只有 ID。
const missingRoot: Descriptor = { id: "order-model" };
// @ts-expect-error 裸内存值不是反射操作对象。
const rawObjectAsValue: Value = { quantity: 2 };
// @ts-expect-error 原始数组不是 ArrayValue。
const rawArrayAsValue: ArrayValue = [];
// @ts-expect-error 原生 Map 不是带描述符和子视图操作的 MapValue。
const rawMapAsValue: MapValue = new Map();
// @ts-expect-error null 是标量值，不是反射操作对象。
const rawNullAsValue: Value = null;
// @ts-expect-error undefined 不是 Scalar。
const missingAsScalar: Scalar = undefined;
// @ts-expect-error ScalarValue.set 不接受 undefined。
counterView.set(undefined);
// @ts-expect-error ScalarValue.set 不接受普通对象。
counterView.set({ quantity: 2 });
// @ts-expect-error ScalarValue.set 不接受数组。
counterView.set([1, 2]);
// @ts-expect-error ScalarValue.set 不接受反射操作对象。
counterView.set(counterView);
// @ts-expect-error 精度与编码类别不属于内存标量类型。
const encodedScalar: ScalarType = "int64";
// @ts-expect-error JS undefined 不是标量种类。
const undefinedType: ScalarType = "undefined";
// @ts-expect-error JS symbol 不是标量种类。
const symbolType: ScalarType = "symbol";
// @ts-expect-error JS symbol 不是 Scalar。
const symbolScalar: Scalar = Symbol("key");
// @ts-expect-error ObjectValue 的字段操作接收 FieldDescriptor，不接收字符串。
orderView.get("items");
// @ts-expect-error ArrayValue 的索引必须是 number。
itemsView.get("0");
// @ts-expect-error ScalarValue 没有按字段或索引访问的能力。
counterView.get(0);
// @ts-expect-error 对象结构描述不操作具体值实例。
orderType.get(itemsField);
// @ts-expect-error 字段发现留在 descriptor，不在 Value 上复制。
orderView.fields;
// @ts-expect-error object/array 的原始内存表示是 unknown，不能假定普通 JS 对象。
orderView.value.items;
// @ts-expect-error MapValue 的原始内存表示是 unknown，不能假定为原生 Map。
itemsByNumberView.value.get(1);
// @ts-expect-error Map 的键是 unknown 原始值，不保证是 Value。
retainedKeys[0].kind;
// @ts-expect-error Map 的 size 只读。
itemsByNumberView.size = 0;
// @ts-expect-error Value 按 kind 直接访问，没有 message 桥接。
orderView.message();
// @ts-expect-error 默认值不属于本反射协议。
orderView.newField(itemsField);
// @ts-expect-error 添加元素接收原始值，不要求 newElement。
itemsView.newElement();
// @ts-expect-error 数组不是 Map，不提供按 key 的 has。
itemsView.has("key");
// @ts-expect-error 对象字段没有 Protobuf oneof 选择操作。
orderView.oneofCase({});
// @ts-expect-error 存在性由 has 表示，不是 Protobuf isSet。
orderView.isSet(noteField);
// @ts-expect-error 删除字段不表示清零或重置默认值。
orderView.clear(noteField);
// @ts-expect-error wire 未知字段不是内存反射能力。
orderView.getUnknown();
// @ts-expect-error wire 专属元数据没有进入公共模型描述。
objectModel.native;
// @ts-expect-error 模型描述根类型，不固定 message。
objectModel.message;
// @ts-expect-error 类型集合没有 message 种类。
const invalidKind: TypeDescriptor = { kind: "message" };
// @ts-expect-error tuple 不在四种 kind 内。
const tupleKind: TypeDescriptor = { kind: "tuple", elements: [] };
// @ts-expect-error 动态对象使用 additionalProperties，不增加 record kind。
const recordKind: TypeDescriptor = { kind: "record", value: stringType };
// @ts-expect-error 集合使用 Map<T, null>，不增加 set kind。
const setKind: TypeDescriptor = { kind: "set", element: itemType };
// @ts-expect-error 枚举附着在 scalar 上，不增加 enum kind。
const enumKind: TypeDescriptor = { kind: "enum", values: statusEnum.values };
// @ts-expect-error EnumDescriptor 不是独立的 TypeDescriptor。
const enumAsType: TypeDescriptor = statusEnum;
// @ts-expect-error Map 的 key 需要完整 TypeDescriptor，不是标量类型字符串。
const invalidMapKey: MapDescriptor = { kind: "map", key: "number", value: itemType };
// @ts-expect-error Map 的 value 需要完整 TypeDescriptor，不是 null 原始值。
const invalidMapValue: MapDescriptor = { kind: "map", key: itemType, value: null };
// @ts-expect-error 枚举仅支持 string/number。
const invalidEnumScalar: EnumDescriptor = { ...statusEnum, scalar: "boolean" };
// @ts-expect-error open 是必须声明的策略。
const missingEnumOpen: EnumDescriptor = { scalar: "string", values: [], byName: () => undefined, byValue: () => undefined };
// @ts-expect-error 枚举成员实际值只能是 string/number。
const invalidEnumValue: EnumValueDescriptor = { parent: statusEnum, value: false };
// @ts-expect-error 枚举成员必须指回所属枚举。
const missingEnumParent: EnumValueDescriptor = { value: "draft" };
// @ts-expect-error 枚举查询不接受 boolean。
statusEnum.byValue(false);
// @ts-expect-error 按成员名查询只接受 string。
priorityEnum.byName(2);
// @ts-expect-error 枚举成员列表只读。
statusEnum.values.push(draftStatus);
// @ts-expect-error 字段类型必须是 TypeDescriptor。
const invalidField: FieldDescriptor = { parent: orderType, name: "x", type: "string" };
// @ts-expect-error additionalProperties 描述类型，不是原标准的布尔选项。
const invalidDynamicType: ObjectDescriptor = { ...labelsType, additionalProperties: true };
// @ts-expect-error 不导出 Protobuf MessageValue。
type LegacyMessage = import("../../src/data/index.js").MessageValue;
// @ts-expect-error 不导出 wire 类型。
type LegacyWire = import("../../src/data/index.js").WireType;
