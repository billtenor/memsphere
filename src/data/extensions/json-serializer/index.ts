import type { Context } from "../../api/context.js";
import type { DataExtension } from "../../api/extension.js";
import type { PayloadContent } from "../../api/payload.js";
import type { Descriptor, TypeDescriptor } from "../../api/reflection.js";
import type { PayloadSerializer } from "../../api/serializer.js";
import { bytesContent, readAll, throwIfAborted } from "../shared/payload.js";
import { assertPlainValue } from "../shared/reflection.js";

/**
 * JSON for ordinary records, dense arrays, and native JSON scalars. No projection,
 * coercion, defaults, accessors, or toJSON hooks are applied. Unknown properties
 * remain part of the payload and must themselves be JSON values.
 *
 * Numbers use JavaScript IEEE-754 precision, including when parsing fractional
 * JSON literals. Unsafe integers and negative zero are rejected in both
 * directions instead of silently losing integer precision or the sign of zero.
 * Object prototypes, property attributes, and shared-reference identity are not
 * part of the JSON data model. Cycles and non-enumerable properties are rejected.
 */
export class JsonPayloadSerializer implements PayloadSerializer {
  readonly id = "json";
  readonly contentType = "application/json";

  async deserialize(
    context: Context,
    descriptor: Descriptor,
    content: PayloadContent
  ): Promise<unknown> {
    throwIfAborted(context);
    assertJsonDescriptor(descriptor.root);
    const bytes = await readAll(context, content);
    throwIfAborted(context);
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    // Inspect the complete value, including properties outside the reflection
    // descriptor, before checking the descriptor's structural and enum rules.
    encodeJsonValue(value);
    assertPlainValue(descriptor.root, value);
    throwIfAborted(context);
    return value;
  }

  async serialize(
    context: Context,
    descriptor: Descriptor,
    value: unknown
  ): Promise<PayloadContent> {
    throwIfAborted(context);
    assertJsonDescriptor(descriptor.root);
    const json = encodeJsonValue(value);
    assertPlainValue(descriptor.root, value);
    throwIfAborted(context);
    return bytesContent(new TextEncoder().encode(json));
  }
}

export const jsonSerializerExtension: DataExtension = {
  id: "memsphere/json-serializer",
  version: "0.1.0",
  payloadSerializers: [new JsonPayloadSerializer()]
};

/** Check the whole graph, not just branches present in a particular value. */
function assertJsonDescriptor(root: TypeDescriptor): void {
  const seen = new Set<TypeDescriptor>();
  const pending = [root];
  while (pending.length > 0) {
    const type = pending.pop()!;
    if (seen.has(type)) continue;
    seen.add(type);
    switch (type.kind) {
      case "object":
        for (const field of type.fields) pending.push(field.type);
        if (type.additionalProperties !== undefined) pending.push(type.additionalProperties);
        break;
      case "array":
        pending.push(type.element);
        break;
      case "scalar":
        if (!["null", "boolean", "number", "string"].includes(type.scalar)) {
          throw new TypeError(`JSON does not support the ${type.scalar} scalar descriptor`);
        }
        if (type.enum !== undefined) {
          if ((type.scalar !== "string" && type.scalar !== "number") || type.enum.scalar !== type.scalar) {
            throw new TypeError("JSON enum descriptor must match its string or number scalar");
          }
          for (const member of type.enum.values) {
            if (typeof member.value !== type.scalar) {
              throw new TypeError("JSON enum member must match its scalar descriptor");
            }
            encodeJsonValue(member.value);
          }
        }
        break;
      case "map":
        throw new TypeError("JSON does not support map descriptors");
      default:
        throw new TypeError("JSON does not support this descriptor kind");
    }
  }
}

/**
 * Encode data properties directly. Passing caller objects to JSON.stringify
 * would invoke hooks and silently omit unsupported properties and array keys.
 */
function encodeJsonValue(value: unknown, path = "$", ancestors = new Set<object>()): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`JSON requires a finite number at ${path}`);
      if (Object.is(value, -0)) throw new TypeError(`JSON does not support negative zero at ${path}`);
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
        throw new TypeError(`JSON does not support unsafe integers at ${path}`);
      }
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`JSON does not support ${typeof value} values at ${path}`);
  }

  const array = Array.isArray(value);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== (array ? Array.prototype : Object.prototype)) {
    throw new TypeError(`JSON requires a plain object or native array at ${path}`);
  }
  assertNoJsonHook(value, path);
  if (ancestors.has(value)) throw new TypeError(`JSON does not support cyclic values at ${path}`);
  ancestors.add(value);
  try {
    const properties = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(properties)) {
      if (typeof key !== "string") throw new TypeError(`JSON does not support symbol keys at ${path}`);
      if (array && key === "length") continue;
      const property = properties[key];
      if (!("value" in property)) throw new TypeError(`JSON does not support accessors at ${path}.${key}`);
      if (!property.enumerable) throw new TypeError(`JSON does not support non-enumerable properties at ${path}.${key}`);
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
        throw new TypeError(`JSON does not support extra array properties at ${path}.${key}`);
      }
    }

    if (array) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(properties, String(index))) {
          throw new TypeError(`JSON does not support sparse arrays at ${path}[${index}]`);
        }
        const property = properties[String(index)];
        items.push(encodeJsonValue(property.value, `${path}[${index}]`, ancestors));
      }
      return `[${items.join(",")}]`;
    }

    const fields: string[] = [];
    for (const key of Object.keys(properties)) {
      fields.push(`${JSON.stringify(key)}:${encodeJsonValue(properties[key].value, `${path}.${key}`, ancestors)}`);
    }
    return `{${fields.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function assertNoJsonHook(value: object, path: string): void {
  for (let target: object | null = value; target !== null; target = Object.getPrototypeOf(target)) {
    const property = Object.getOwnPropertyDescriptor(target, "toJSON");
    if (property !== undefined) {
      if (!("value" in property) || typeof property.value === "function") {
        throw new TypeError(`JSON does not support toJSON hooks at ${path}`);
      }
      return;
    }
  }
}
