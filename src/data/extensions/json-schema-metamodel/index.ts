import { Ajv } from "ajv";
import type { Context } from "../../api/context.js";
import type { DataExtension } from "../../api/extension.js";
import type { Model } from "../../api/model.js";
import type { ModelRuntimeFactory, ModelRuntimeRegistry } from "../../api/model-runtime.js";
import type { FieldDescriptor, ObjectDescriptor } from "../../api/reflection.js";
import { JSON_SCHEMA_DRAFT_07 } from "../json-schema/index.js";
import { createPlainRuntime } from "../shared/reflection.js";

const ajv = new Ajv({ allErrors: true, strict: false, ownProperties: true });

/** Validate the definition standard without compiling the business Runtime subset. */
export function validateJsonSchemaDefinition(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("JSON Schema definition must be an object");
  const schema = value as Record<string, unknown>;
  if (schema.$schema !== undefined && (typeof schema.$schema !== "string"
    || !/^https?:\/\/json-schema\.org\/draft-07\/schema#?$/.test(schema.$schema))) {
    throw new TypeError("Only JSON Schema Draft-07 is supported");
  }
  if (!ajv.validate("http://json-schema.org/draft-07/schema", value)) {
    throw new TypeError(`Invalid JSON Schema definition: ${ajv.errorsText(ajv.errors)}`);
  }
}

/** Bootstrap the definition format itself, independently of business-model compilation. */
export class JsonSchemaMetaModelRuntimeFactory implements ModelRuntimeFactory {
  readonly target = Object.freeze({ model: JSON_SCHEMA_DRAFT_07 });

  async createRuntime(context: Context, model: Model, _registry: ModelRuntimeRegistry) {
    context.signal?.throwIfAborted();
    if (model.data.id !== JSON_SCHEMA_DRAFT_07) throw new TypeError("JSON Schema metamodel ID mismatch");
    const fields: FieldDescriptor[] = [];
    const root: ObjectDescriptor = { kind: "object", fields, field: name => fields.find(field => field.name === name) };
    for (const name of ["$schema", "$id", "title", "description"]) {
      fields.push(Object.freeze({ parent: root, name, type: Object.freeze({ kind: "scalar", scalar: "string" }) }));
    }
    Object.freeze(fields);
    Object.freeze(root);
    return createPlainRuntime(Object.freeze({ id: model.data.id, root }), {
      validate: validateJsonSchemaDefinition
    });
  }
}

export const jsonSchemaMetaModelExtension: DataExtension = Object.freeze({
  id: "memsphere/json-schema-metamodel", version: "0.1.0",
  modelRuntimeFactories: [new JsonSchemaMetaModelRuntimeFactory()]
});
