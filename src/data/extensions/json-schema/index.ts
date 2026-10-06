import { types as nativeTypes } from "node:util";
import { Ajv, type AnySchema } from "ajv";
import type { JsonObject as Schema, JsonValue as Json } from "../../api/config.js";
import type { Context } from "../../api/context.js";
import type { DataExtension } from "../../api/extension.js";
import type { Model } from "../../api/model.js";
import type { ModelRuntime, ModelRuntimeFactory, ModelRuntimeRegistry } from "../../api/model-runtime.js";
import type {
  ArrayDescriptor,
  Descriptor,
  EnumDescriptor,
  EnumValueDescriptor,
  FieldDescriptor,
  ObjectDescriptor,
  ScalarDescriptor,
  TypeDescriptor
} from "../../api/reflection.js";
import { createPlainRuntime } from "../shared/reflection.js";

/** This extension implements the reflectable, explicitly typed subset of Draft-07. */
export const JSON_SCHEMA_DRAFT_07 = "json-schema/draft-07.json";

const draft07 = "http://json-schema.org/draft-07/schema#";
const metadata = new Set(["$comment", "title", "description", "default", "examples", "readOnly", "writeOnly"]);
const keywords = new Set([
  ...metadata,
  "$schema", "$id", "$ref", "definitions", "type", "properties", "additionalProperties", "required", "items",
  "enum", "const", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties"
]);

function fail(path: string, message: string): never {
  throw Object.assign(new TypeError(`Unsupported JSON Schema at ${path}: ${message}`), {
    code: "MODEL_RUNTIME_UNSUPPORTED", details: { path }
  });
}

function object(value: Json | undefined): value is Schema {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pointer(path: string, key: string): string {
  return `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

/** Ajv's deep comparisons can inspect opaque descendants and conversion hooks. */
function assertSafeValidationValue(value: unknown, visited = new WeakSet<object>()): void {
  if (typeof value === "function" || typeof value === "symbol") {
    throw new TypeError("JSON Schema validation does not support functions, callable hooks, or symbols");
  }
  if (value === null || typeof value !== "object") return;
  if (nativeTypes.isProxy(value)) throw new TypeError("JSON Schema validation does not support Proxy values");
  if (visited.has(value)) return;
  visited.add(value);
  const prototype = Object.getPrototypeOf(value);
  const map = prototype === Map.prototype;
  const bytes = nativeTypes.isUint8Array(value)
    && (prototype === Uint8Array.prototype || prototype === Buffer.prototype);
  if (prototype !== Object.prototype && prototype !== null
    && !(Array.isArray(value) && prototype === Array.prototype) && !map && !bytes) {
    throw new TypeError("JSON Schema validation does not support custom object prototypes");
  }
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in property)) throw new TypeError("JSON Schema validation does not support accessors (getters/setters)");
    assertSafeValidationValue(property.value, visited);
  }
  if (map) {
    for (const [key, entry] of Map.prototype.entries.call(value) as MapIterator<[unknown, unknown]>) {
      assertSafeValidationValue(key, visited);
      assertSafeValidationValue(entry, visited);
    }
  }
}

/** Snapshot JSON without invoking toJSON or silently dropping invalid members. */
function snapshot(value: unknown, path = "#", ancestors = new Set<object>()): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || value === null) fail(path, "the definition must contain only JSON values");
  if (ancestors.has(value)) fail(path, "cyclic definitions are not JSON; use $ref for recursion");
  if (Object.getOwnPropertySymbols(value).length) fail(path, "symbol properties are not JSON");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const name of Object.getOwnPropertyNames(value)) {
        if (name !== "length" && (!/^(0|[1-9][0-9]*)$/.test(name) || Number(name) >= value.length)) {
          fail(pointer(path, name), "non-index array properties are not JSON");
        }
      }
      return Array.from({ length: value.length }, (_, index) => {
        const entry = Object.getOwnPropertyDescriptor(value, String(index));
        if (!entry || !entry.enumerable || !("value" in entry)) fail(pointer(path, String(index)), "array holes and accessors are not JSON");
        return snapshot(entry.value, pointer(path, String(index)), ancestors);
      });
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(path, "schema objects must be plain JSON objects");
    const result: Schema = {};
    for (const name of Object.getOwnPropertyNames(value)) {
      const entry = Object.getOwnPropertyDescriptor(value, name)!;
      if (!entry.enumerable || !("value" in entry)) fail(pointer(path, name), "non-enumerable properties and accessors are not JSON");
      Object.defineProperty(result, name, {
        value: snapshot(entry.value, pointer(path, name), ancestors), enumerable: true, configurable: true, writable: true
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

type Reference = { schema: Schema; path: string };

class Compiler {
  readonly types = new Map<Schema, TypeDescriptor>();
  readonly references = new Map<Schema, Reference>();
  private readonly checked = new Set<Schema>();
  private readonly paths = new Map<Schema, string>();
  private readonly base?: URL;

  constructor(readonly context: Context, readonly root: Schema) {
    if (root.$id !== undefined) {
      if (typeof root.$id !== "string") fail("#/$id", "$id must be an absolute URI string");
      try {
        this.base = new URL(root.$id);
      } catch {
        fail("#/$id", "relative $id values are not supported; provide an absolute URI");
      }
      if (this.base.hash && this.base.hash !== "#") fail("#/$id", "$id fragments are not supported");
      this.base.hash = "";
    }
  }

  check(schema: Schema, path: string): void {
    this.context.signal?.throwIfAborted();
    if (this.checked.has(schema)) return;
    this.checked.add(schema);
    this.paths.set(schema, path);
    for (const key of Object.keys(schema)) {
      if (!keywords.has(key)) fail(pointer(path, key), `keyword ${JSON.stringify(key)} is not supported by this reflection extension`);
    }
    if (schema !== this.root && schema.$id !== undefined) fail(pointer(path, "$id"), "nested $id changes of reference scope are not supported");
    if (schema.$schema !== undefined) {
      if (schema !== this.root) fail(pointer(path, "$schema"), "$schema must appear at the document root");
      if (typeof schema.$schema !== "string" || !/^https?:\/\/json-schema\.org\/draft-07\/schema#?$/.test(schema.$schema)) {
        fail(pointer(path, "$schema"), "only JSON Schema Draft-07 is supported");
      }
    }
    if (schema.$ref !== undefined) {
      if (typeof schema.$ref !== "string") fail(pointer(path, "$ref"), "$ref must be a string");
      for (const key of Object.keys(schema)) {
        if (!["$ref", "$schema", "$id", "definitions"].includes(key) && !metadata.has(key)) {
          fail(pointer(path, key), "validation siblings of $ref are not supported (Draft-07 ignores them)");
        }
      }
      const reference = this.resolve(schema.$ref, path);
      this.references.set(schema, reference);
      this.check(reference.schema, reference.path);
    } else {
      this.scalarType(schema, path);
    }
    for (const key of ["definitions", "properties"] as const) {
      if (schema[key] === undefined) continue;
      if (!object(schema[key])) fail(pointer(path, key), `${key} must be an object of schemas`);
      for (const [name, child] of Object.entries(schema[key])) {
        const childPath = pointer(pointer(path, key), name);
        if (!object(child)) fail(childPath, "boolean or unconstrained schemas have no reflection descriptor");
        this.check(child, childPath);
      }
    }
    if (schema.items !== undefined) {
      if (!object(schema.items)) fail(pointer(path, "items"), "only one homogeneous object schema is supported; tuples and boolean items are not supported");
      this.check(schema.items, pointer(path, "items"));
    }
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
      if (!object(schema.additionalProperties)) fail(pointer(path, "additionalProperties"), "additionalProperties must be a boolean or schema object");
      this.check(schema.additionalProperties, pointer(path, "additionalProperties"));
    }
  }

  private scalarType(schema: Schema, path: string): string {
    let type = schema.type;
    if (type === undefined && Array.isArray(schema.enum) && schema.enum.length) {
      const types = new Set(schema.enum.map(value => value === null ? "null" : typeof value));
      if (types.size === 1 && ["string", "number", "boolean", "null"].includes([...types][0])) type = [...types][0];
    }
    if (typeof type !== "string" || !["object", "array", "string", "number", "integer", "boolean", "null"].includes(type)) {
      fail(pointer(path, "type"), "an explicit single type or homogeneous scalar enum is required; unconstrained and union types are not supported");
    }
    if (type === "array" && !object(schema.items)) fail(pointer(path, "items"), "array schemas require a homogeneous items schema");
    if (schema.enum !== undefined) {
      if (!Array.isArray(schema.enum) || !schema.enum.length) fail(pointer(path, "enum"), "enum must be a nonempty array");
      if (["string", "number", "integer", "boolean", "null"].includes(type)) {
        for (const value of schema.enum) {
          const matches = type === "null" ? value === null
            : type === "integer" ? typeof value === "number" && Number.isInteger(value)
              : typeof value === type;
          if (!matches) fail(pointer(path, "enum"), "enum members must match the declared scalar type without coercion");
        }
      }
    }
    return type;
  }

  private resolve(ref: string, path: string): Reference {
    if (ref !== "" && ref !== "#" && !ref.startsWith("#/")) {
      throw Object.assign(new TypeError(`Cross-model schema references are not supported at ${pointer(path, "$ref")}: ${ref}; use a local JSON Pointer`), {
        code: "MODEL_REFERENCE_UNSUPPORTED", details: { path: pointer(path, "$ref"), ref }
      });
    }
    const fragment = ref.slice(1);
    let decoded: string;
    try { decoded = decodeURIComponent(fragment!); }
    catch { fail(pointer(path, "$ref"), "invalid URI-encoded JSON Pointer"); }
    if (decoded && !decoded.startsWith("/")) fail(pointer(path, "$ref"), "only JSON Pointer local references are supported");
    let value: Json = this.root;
    let targetPath = "#";
    if (decoded) {
      for (const segment of decoded.slice(1).split("/")) {
        if (/~(?:[^01]|$)/.test(segment)) fail(pointer(path, "$ref"), "invalid JSON Pointer escape");
        const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
        targetPath = pointer(targetPath, key);
        if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) fail(pointer(path, "$ref"), `local reference ${JSON.stringify(ref)} does not exist`);
        value = (value as Schema)[key];
      }
    }
    if (!object(value)) fail(pointer(path, "$ref"), "reference target must be a supported schema object");
    return { schema: value, path: targetPath };
  }

  type(schema: Schema): TypeDescriptor {
    this.context.signal?.throwIfAborted();
    const cached = this.types.get(schema);
    if (cached) return cached;
    const path = this.paths.get(schema) ?? "#";
    if (schema.$ref !== undefined) {
      const aliases = new Set<Schema>();
      let target = schema;
      while (target.$ref !== undefined) {
        if (aliases.has(target)) fail(path, "reference cycle has no concrete type");
        aliases.add(target);
        const reference = this.references.get(target)!;
        target = reference.schema;
      }
      const type = this.type(target);
      for (const alias of aliases) this.types.set(alias, type);
      return type;
    }
    const description = typeof schema.description === "string" ? { description: schema.description } : {};
    const type = this.scalarType(schema, path);
    if (type === "object") {
      const fields: FieldDescriptor[] = [];
      const lookup = new Map<string, FieldDescriptor>();
      const descriptor: ObjectDescriptor = {
        kind: "object", ...description, fields,
        field(name) {
          let field = lookup.get(name);
          if (!field && descriptor.additionalProperties) {
            field = Object.freeze({ parent: descriptor, name, type: descriptor.additionalProperties });
            lookup.set(name, field);
          }
          return field;
        }
      };
      this.types.set(schema, descriptor);
      if (object(schema.properties)) {
        for (const [name, property] of Object.entries(schema.properties)) {
          const child = property as Schema;
          const field: FieldDescriptor = Object.freeze({
            parent: descriptor, name, type: this.type(child),
            ...(typeof child.description === "string" ? { description: child.description } : {})
          });
          fields.push(field);
          lookup.set(name, field);
        }
      }
      if (object(schema.additionalProperties)) {
        Object.defineProperty(descriptor, "additionalProperties", { value: this.type(schema.additionalProperties), enumerable: true });
      }
      Object.freeze(fields);
      return Object.freeze(descriptor);
    }
    if (type === "array") {
      const descriptor = { kind: "array", ...description } as ArrayDescriptor;
      this.types.set(schema, descriptor);
      Object.defineProperty(descriptor, "element", { value: this.type(schema.items as Schema), enumerable: true });
      return Object.freeze(descriptor);
    }
    const scalar = type === "integer" ? "number" : type as ScalarDescriptor["scalar"];
    const descriptor: ScalarDescriptor = {
      kind: "scalar", scalar, ...description,
      ...(Array.isArray(schema.enum) && (scalar === "string" || scalar === "number")
        ? { enum: this.enumeration(scalar, schema.enum as (string | number)[], description) } : {})
    };
    this.types.set(schema, descriptor);
    return Object.freeze(descriptor);
  }

  private enumeration(scalar: "string" | "number", members: (string | number)[], description: { description?: string }): EnumDescriptor {
    const values: EnumValueDescriptor[] = [];
    const byValue = new Map<string | number, EnumValueDescriptor>();
    const enumeration: EnumDescriptor = {
      scalar, open: false, ...description, values,
      byName: () => undefined,
      byValue: value => byValue.get(value)
    };
    for (const value of members) {
      const member = Object.freeze({ parent: enumeration, value });
      values.push(member);
      if (!byValue.has(value)) byValue.set(value, member);
    }
    Object.freeze(values);
    return Object.freeze(enumeration);
  }

  /** Preserve constraints while adapting supported Draft-07 annotations for Ajv. */
  validationSchema(schema: Schema): AnySchema {
    const rewrite = (node: Json): Json => {
      if (Array.isArray(node)) return node.map(rewrite);
      if (!object(node)) return node;
      const result: Schema = {};
      for (const [name, child] of Object.entries(node)) {
        Object.defineProperty(result, name, { value: rewrite(child), enumerable: true, writable: true, configurable: true });
      }
      if (!this.checked.has(node)) return result;
      if (result.$schema !== undefined) result.$schema = draft07;
      // Ajv deliberately skips __proto__ in `properties`. An exact generated
      // pattern preserves both its constraints and additionalProperties semantics.
      if (object(node.properties) && Object.hasOwn(node.properties, "__proto__")) {
        result.patternProperties = { "^__proto__$": rewrite(node.properties.__proto__ as Schema) };
      }
      return result;
    };
    return rewrite(schema) as AnySchema;
  }
}

/** Compile supported Draft-07 schemas without loading references or modifying values. */
export class JsonSchemaModelRuntimeFactory implements ModelRuntimeFactory {
  readonly target = Object.freeze({ metaModel: JSON_SCHEMA_DRAFT_07 });

  async createRuntime(context: Context, model: Model, _registry: ModelRuntimeRegistry): Promise<ModelRuntime> {
    context.signal?.throwIfAborted();
    if (model.data.model !== JSON_SCHEMA_DRAFT_07) {
      throw new TypeError(`JSON Schema factory requires model.data.model to be ${JSON_SCHEMA_DRAFT_07}`);
    }
    const schema = snapshot(model.definition);
    if (!object(schema)) fail("#", "the root must be a typed schema object; boolean schemas are not supported");
    const compiler = new Compiler(context, schema);
    compiler.check(schema, "#");
    const descriptor: Descriptor = Object.freeze({ id: model.data.id, root: compiler.type(schema) });
    const ajv = new Ajv({
      allErrors: true, strict: true, strictTypes: false, ownProperties: true, allowMatchingProperties: true,
      useDefaults: false, removeAdditional: false, coerceTypes: false
    });
    const validate = ajv.compile(compiler.validationSchema(schema));
    context.signal?.throwIfAborted();
    return createPlainRuntime(descriptor, {
      validate(value) {
        assertSafeValidationValue(value);
        if (!validate(value)) throw new TypeError(`JSON Schema validation failed: ${ajv.errorsText(validate.errors, { separator: "; " })}`);
      }
    });
  }
}

export const jsonSchemaExtension: DataExtension = Object.freeze({
  id: "memsphere/json-schema-draft-07",
  version: "0.1.0",
  modelRuntimeFactories: Object.freeze([new JsonSchemaModelRuntimeFactory()])
});
