import type { ModelRuntime } from "../../api/model-runtime.js";
import type {
  ArrayDescriptor, ArrayValue, Descriptor, FieldDescriptor, MapDescriptor, MapValue,
  ObjectDescriptor, ObjectValue, Scalar, ScalarDescriptor, ScalarValue, TypeDescriptor, Value
} from "../../api/reflection.js";

export interface PlainRuntimeOptions {
  /** Standard-specific validation, with no coercion or mutation. */
  validate?: (value: unknown) => void;
  /** Validation owned by referenced models, also used for map keys. */
  validateType?: (type: TypeDescriptor, value: unknown) => void;
}

const views = new WeakSet<object>();
const own = (value: object, name: PropertyKey) => Object.getOwnPropertyDescriptor(value, name);

function fail(message: string): never { throw new TypeError(message); }

function record(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || views.has(value)) fail("Expected a plain object value");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("Expected a plain object value");
}

function dataProperty(value: object, name: PropertyKey): PropertyDescriptor | undefined {
  const property = own(value, name);
  if (property && !("value" in property)) fail("Accessors are not supported by plain-value reflection");
  return property;
}

function checkScalar(type: ScalarDescriptor, value: unknown): void {
  const matches = type.scalar === "null" ? value === null
    : type.scalar === "bytes" ? value instanceof Uint8Array
    : typeof value === type.scalar;
  if (!matches) fail(`Expected scalar ${type.scalar}`);
  const enumeration = type.enum;
  if (enumeration) {
    if (type.scalar !== enumeration.scalar || !["string", "number"].includes(type.scalar)) {
      fail("Enum scalar must match its enclosing string or number descriptor");
    }
    if (!enumeration.open && !enumeration.byValue(value as string | number)) fail("Undeclared enum value");
  }
}

/** Validate native plain objects, dense arrays, Maps and scalars without reading accessors. */
export function assertPlainValue(type: TypeDescriptor, value: unknown): void {
  checkValue(type, value, new WeakMap());
}

function checkValue(
  type: TypeDescriptor,
  value: unknown,
  visited: WeakMap<object, Set<TypeDescriptor>>,
  validateType?: PlainRuntimeOptions["validateType"]
): void {
  if (value !== null && typeof value === "object") {
    if (views.has(value)) fail("Write raw values, not reflection views");
    const types = visited.get(value) ?? new Set<TypeDescriptor>();
    if (types.has(type)) return;
    types.add(type);
    visited.set(value, types);
  }
  switch (type.kind) {
    case "scalar": checkScalar(type, value); break;
    case "object": {
      record(value);
      for (const name of Object.getOwnPropertyNames(value)) {
        const property = dataProperty(value, name)!;
        const field = type.field(name);
        if (field) checkValue(field.type, property.value, visited, validateType);
      }
      break;
    }
    case "array": {
      if (!Array.isArray(value)) fail("Expected an array value");
      for (let index = 0; index < value.length; index += 1) {
        const property = dataProperty(value, String(index));
        if (!property) fail("Sparse arrays are not supported");
        checkValue(type.element, property.value, visited, validateType);
      }
      break;
    }
    case "map": {
      if (!(value instanceof Map) || Object.getPrototypeOf(value) !== Map.prototype) fail("Expected a native Map value");
      for (const name of ["get", "set", "has", "delete", "clear", "keys", "values", "entries", "size", Symbol.iterator]) {
        if (own(value, name)) fail("Overridden Map operations are not supported");
      }
      for (const [key, entry] of Map.prototype.entries.call(value)) {
        checkValue(type.key, key, visited, validateType);
        checkValue(type.value, entry, visited, validateType);
      }
      break;
    }
  }
  validateType?.(type, value);
}

type Epoch = { all: number; structure: number; slots: Map<unknown, number> };
// All reflection entry points share invalidation for the same native container.
const containerEpochs = new WeakMap<object, Epoch>();
type Binding = {
  read(): unknown;
  write(value: unknown): void;
  check(): void;
};

class Session {
  readonly root: Binding;

  constructor(readonly descriptor: Descriptor, value: unknown, readonly options: PlainRuntimeOptions) {
    let current = value;
    this.root = { read: () => current, write: value => { current = value; }, check() {} };
    this.validate();
  }

  epoch(container: object): Epoch {
    let epoch = containerEpochs.get(container);
    if (!epoch) {
      epoch = { all: 0, structure: 0, slots: new Map() };
      containerEpochs.set(container, epoch);
    }
    return epoch;
  }

  invalidate(container: object, slot?: { key: unknown }): void {
    const epoch = this.epoch(container);
    if (slot) epoch.slots.set(slot.key, (epoch.slots.get(slot.key) ?? 0) + 1);
    else { epoch.all += 1; epoch.structure += 1; epoch.slots.clear(); }
  }

  child(parent: Binding, container: object, key: unknown, read: () => unknown, write: (value: unknown) => void): Binding {
    const epoch = this.epoch(container);
    const all = epoch.all;
    const slot = epoch.slots.get(key) ?? 0;
    const check = () => {
      parent.check();
      if (epoch.all !== all || (epoch.slots.get(key) ?? 0) !== slot) throw new Error("Reflection view is stale; get a new view");
    };
    return { check, read: () => { check(); return read(); }, write: value => { check(); write(value); } };
  }

  validate(): void {
    const value = this.root.read();
    checkValue(this.descriptor.root, value, new WeakMap(), this.options.validateType);
    this.options.validate?.(value);
  }

  checkType(type: TypeDescriptor, value: unknown): void {
    checkValue(type, value, new WeakMap(), this.options.validateType);
  }

  change(apply: () => void, rollback: () => void, committed: () => void = () => {}): void {
    apply();
    try { this.validate(); } catch (error) { rollback(); throw error; }
    committed();
  }

  wrap(type: TypeDescriptor, binding: Binding): Value {
    switch (type.kind) {
      case "object": return new ObjectView(this, type, binding);
      case "array": return new ArrayView(this, type, binding);
      case "scalar": return new ScalarView(this, type, binding);
      case "map": return new MapView(this, type, binding);
    }
  }
}

abstract class View {
  constructor(protected readonly session: Session, protected readonly binding: Binding) { views.add(this); }
  get value(): unknown { return this.binding.read(); }
}

function put(object: object, name: PropertyKey, value: unknown): void {
  const property = dataProperty(object, name);
  if (property && !property.writable) fail("Property is not writable");
  if (!property && !Object.isExtensible(object)) fail("Object is not extensible");
  Object.defineProperty(object, name, property ? { ...property, value } : {
    value, enumerable: true, writable: true, configurable: true
  });
}

class ObjectView extends View implements ObjectValue {
  readonly kind = "object";
  constructor(session: Session, readonly descriptor: ObjectDescriptor, binding: Binding) { super(session, binding); }
  private object(field?: FieldDescriptor): Record<string, unknown> {
    this.binding.check();
    if (field && (field.parent !== this.descriptor || field !== this.descriptor.field(field.name))) fail("Foreign field descriptor");
    return this.value as Record<string, unknown>;
  }
  has(field: FieldDescriptor): boolean { return own(this.object(field), field.name) !== undefined; }
  get(field: FieldDescriptor): Value | undefined {
    const object = this.object(field);
    if (!own(object, field.name)) return undefined;
    const child = this.session.child(this.binding, object, field.name,
      () => dataProperty(object, field.name)!.value, value => put(object, field.name, value));
    return this.session.wrap(field.type, child);
  }
  set(field: FieldDescriptor, value: unknown): void {
    const object = this.object(field);
    this.session.checkType(field.type, value);
    const previous = own(object, field.name);
    this.session.change(() => put(object, field.name, value), () => {
      if (previous) Object.defineProperty(object, field.name, previous);
      else Reflect.deleteProperty(object, field.name);
    }, () => this.session.invalidate(object, { key: field.name }));
  }
  delete(field: FieldDescriptor): boolean {
    const object = this.object(field);
    const previous = own(object, field.name);
    if (!previous) return false;
    if (!previous.configurable) fail("Property is not configurable");
    this.session.change(() => { Reflect.deleteProperty(object, field.name); },
      () => { Object.defineProperty(object, field.name, previous); },
      () => this.session.invalidate(object, { key: field.name }));
    return true;
  }
  [Symbol.iterator](): IterableIterator<[FieldDescriptor, Value]> { return this.entries(); }
  *entries(): IterableIterator<[FieldDescriptor, Value]> {
    const object = this.object();
    for (const name of Object.getOwnPropertyNames(object)) {
      this.binding.check();
      const field = this.descriptor.field(name);
      if (!field) continue;
      const value = this.get(field);
      if (value) yield [field, value];
    }
  }
}

function indexIn(index: number, length: number, insert = false): void {
  if (!Number.isInteger(index)) throw new RangeError("Array index must be an integer");
  if (index < 0 || index >= length + (insert ? 1 : 0)) throw new RangeError("Array index is out of range");
}

function mutableArray(array: unknown[], growing: boolean): void {
  if (!own(array, "length")!.writable || (growing && !Object.isExtensible(array))) fail("Array is not mutable");
  for (let index = 0; index < array.length; index += 1) {
    const property = dataProperty(array, String(index));
    if (!property?.writable || !property.configurable || !property.enumerable) fail("Array elements must be enumerable, writable and configurable");
  }
}

/** Snapshot own data slots without invoking slice, iterators, constructors or species. */
function arraySnapshot(array: unknown[]): unknown[] {
  const result: unknown[] = [];
  for (let index = 0; index < array.length; index += 1) {
    Object.defineProperty(result, String(index), {
      value: dataProperty(array, String(index))!.value,
      enumerable: true, writable: true, configurable: true
    });
  }
  return result;
}

/** Preflight requires mutable own slots; defining them also bypasses inherited setters. */
function writeArray(array: unknown[], values: unknown[]): void {
  for (let index = 0; index < values.length; index += 1) put(array, String(index), values[index]);
  Object.defineProperty(array, "length", { value: values.length });
}

class ArrayView extends View implements ArrayValue {
  readonly kind = "array";
  constructor(session: Session, readonly descriptor: ArrayDescriptor, binding: Binding) { super(session, binding); }
  private array(): unknown[] { return this.value as unknown[]; }
  private replace(array: unknown[], previous: unknown[], next: unknown[]): void {
    const rollback = () => writeArray(array, previous);
    this.session.change(() => {
      // The shared transaction handles validation failures. Also restore any
      // partial array write if a host/proxy operation itself rejects a change.
      try { writeArray(array, next); } catch (error) { rollback(); throw error; }
    }, rollback, () => this.session.invalidate(array));
  }
  get length(): number { return this.array().length; }
  get(index: number): Value | undefined {
    const array = this.array();
    if (!Number.isInteger(index)) throw new RangeError("Array index must be an integer");
    if (index < 0 || index >= array.length) return undefined;
    return this.session.wrap(this.descriptor.element, this.session.child(this.binding, array, index,
      () => dataProperty(array, String(index))!.value, value => put(array, String(index), value)));
  }
  set(index: number, value: unknown): void {
    const array = this.array();
    indexIn(index, array.length);
    this.session.checkType(this.descriptor.element, value);
    const previous = own(array, String(index))!;
    this.session.change(() => put(array, String(index), value),
      () => { Object.defineProperty(array, String(index), previous); },
      () => this.session.invalidate(array, { key: index }));
  }
  push(value: unknown): number { this.insert(this.length, value); return this.length; }
  insert(index: number, value: unknown): void {
    const array = this.array();
    indexIn(index, array.length, true);
    this.session.checkType(this.descriptor.element, value);
    mutableArray(array, true);
    const previous = arraySnapshot(array);
    const next: unknown[] = [];
    for (let position = 0; position <= previous.length; position += 1) {
      put(next, String(position), position < index ? previous[position]
        : position === index ? value : previous[position - 1]);
    }
    this.replace(array, previous, next);
  }
  remove(index: number): void {
    const array = this.array();
    indexIn(index, array.length);
    mutableArray(array, false);
    // Rollback of a deletion must be able to recreate the last element.
    if (!Object.isExtensible(array)) fail("Array is not extensible");
    const previous = arraySnapshot(array);
    const next: unknown[] = [];
    for (let position = 0; position < previous.length - 1; position += 1) {
      put(next, String(position), previous[position < index ? position : position + 1]);
    }
    this.replace(array, previous, next);
  }
  clear(): void {
    const array = this.array();
    if (!array.length) return;
    mutableArray(array, false);
    if (!Object.isExtensible(array)) fail("Array is not extensible");
    this.replace(array, arraySnapshot(array), []);
  }
  [Symbol.iterator](): IterableIterator<Value> { return this.values(); }
  *entries(): IterableIterator<[number, Value]> {
    const array = this.array();
    const epoch = this.session.epoch(array).all;
    for (let index = 0; index < array.length; index += 1) {
      this.binding.check();
      if (epoch !== this.session.epoch(array).all) throw new Error("Array changed during iteration");
      yield [index, this.get(index)!];
    }
    this.binding.check();
    if (epoch !== this.session.epoch(array).all) throw new Error("Array changed during iteration");
  }
  *keys(): IterableIterator<number> { for (const [index] of this.entries()) yield index; }
  *values(): IterableIterator<Value> { for (const [, value] of this.entries()) yield value; }
}

class MapView extends View implements MapValue {
  readonly kind = "map";
  constructor(session: Session, readonly descriptor: MapDescriptor, binding: Binding) { super(session, binding); }
  private map(key?: { value: unknown }): Map<unknown, unknown> {
    const map = this.value as Map<unknown, unknown>;
    if (key) this.session.checkType(this.descriptor.key, key.value);
    return map;
  }
  get size(): number { return this.map().size; }
  has(key: unknown): boolean { return this.map({ value: key }).has(key); }
  get(key: unknown): Value | undefined {
    const map = this.map({ value: key });
    if (!map.has(key)) return undefined;
    return this.session.wrap(this.descriptor.value, this.session.child(this.binding, map, key,
      () => map.get(key), value => { map.set(key, value); }));
  }
  set(key: unknown, value: unknown): this {
    const map = this.map({ value: key });
    this.session.checkType(this.descriptor.value, value);
    const present = map.has(key);
    const previous = map.get(key);
    this.session.change(() => { map.set(key, value); }, () => {
      if (present) map.set(key, previous); else map.delete(key);
    }, () => {
      this.session.invalidate(map, { key });
      if (!present) this.session.epoch(map).structure += 1;
    });
    return this;
  }
  delete(key: unknown): boolean {
    const map = this.map({ value: key });
    if (!map.has(key)) return false;
    const previous = [...map];
    this.session.change(() => { map.delete(key); }, () => {
      map.clear(); for (const [key, value] of previous) map.set(key, value);
    }, () => {
      this.session.invalidate(map, { key });
      this.session.epoch(map).structure += 1;
    });
    return true;
  }
  clear(): void {
    const map = this.map();
    if (!map.size) return;
    const previous = [...map];
    this.session.change(() => map.clear(), () => {
      for (const [key, value] of previous) map.set(key, value);
    }, () => this.session.invalidate(map));
  }
  [Symbol.iterator](): IterableIterator<[unknown, Value]> { return this.entries(); }
  *entries(): IterableIterator<[unknown, Value]> {
    const map = this.map();
    const structure = this.session.epoch(map).structure;
    for (const key of map.keys()) {
      this.binding.check();
      if (structure !== this.session.epoch(map).structure) throw new Error("Map keys changed during iteration");
      yield [key, this.get(key)!];
    }
    this.binding.check();
    if (structure !== this.session.epoch(map).structure) throw new Error("Map keys changed during iteration");
  }
  *keys(): IterableIterator<unknown> { for (const [key] of this.entries()) yield key; }
  *values(): IterableIterator<Value> { for (const [, value] of this.entries()) yield value; }
}

class ScalarView extends View implements ScalarValue {
  readonly kind = "scalar";
  constructor(session: Session, readonly descriptor: ScalarDescriptor, binding: Binding) { super(session, binding); }
  get value(): Scalar { return this.binding.read() as Scalar; }
  set(value: Scalar): void {
    const previous = this.value;
    this.session.checkType(this.descriptor, value);
    this.session.change(() => this.binding.write(value), () => this.binding.write(previous));
  }
}

/** Shared implementation code, not a registered extension or a new public protocol. */
export function createPlainRuntime(descriptor: Descriptor, options: PlainRuntimeOptions = {}): ModelRuntime {
  return {
    descriptor,
    reflect(value) {
      const session = new Session(descriptor, value, options);
      return session.wrap(descriptor.root, session.root);
    }
  };
}
