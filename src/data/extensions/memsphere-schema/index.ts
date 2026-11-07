import type { ModelRuntime, ModelRuntimeFactory, ModelRuntimeRegistry } from "../../api/model-runtime.js";
import type { Context } from "../../api/context.js";
import type { Model } from "../../api/model.js";
import type { Descriptor, Value } from "../../api/reflection.js";
import { MEMSPHERE_SCHEMA_MODEL, parseSchemaModel } from "../../../memory/schema-model.js";
import { inferSchemaType } from "../../../memory/schema.js";
import type { ArtifactFormatSpec } from "../../../memory/ast.js";
import { ArtifactValidationFailure, createBuiltInArtifactValidatorRegistry, prepareArtifactCandidate, type CompiledArtifactContract } from "../../../artifact-validation.js";

export { MEMSPHERE_SCHEMA_MODEL };
export function schemaPayloadFormat(contentType: string): ArtifactFormatSpec {
  const mime = contentType.split(";", 1)[0].trim().toLowerCase();
  const name = mime === "application/json" ? "json" : ["application/yaml", "application/x-yaml", "text/yaml"].includes(mime) ? "yaml" : mime === "text/markdown" ? "markdown" : mime === "text/plain" ? "plain" : undefined;
  if (!name) throw new TypeError(`Unsupported Schema payload MIME: ${contentType}`);
  return { name, options: {} };
}

/** The descriptor describes the actual bytes input. Field reflection is deliberately unsupported. */
export class SchemaModelRuntime implements ModelRuntime {
  readonly descriptor: Descriptor;
  readonly schema: ReturnType<typeof parseSchemaModel>;
  constructor(model: Model) {
    if (model.data.model !== MEMSPHERE_SCHEMA_MODEL || typeof model.definition !== "string") throw new TypeError("Schema Runtime requires a YAML definition");
    this.schema = parseSchemaModel(model.definition);
    this.descriptor = Object.freeze({ id: model.data.id, root: Object.freeze({ kind: "scalar", scalar: "bytes" }) });
  }
  reflect(_value: unknown): Value {
    throw Object.assign(new TypeError("Memsphere Schema does not support reflection"), { code: "MODEL_REFLECTION_UNSUPPORTED" });
  }
  contract(contentType: string): CompiledArtifactContract {
    const node = this.schema.node, type = inferSchemaType(node), format = schemaPayloadFormat(contentType);
    if (node.format && node.format.name !== format.name) throw new TypeError(`Schema root format ${node.format.name} conflicts with payload ${contentType}`);
    format.options = { ...(node.format?.options ?? {}) };
    if (format.name === "markdown" && format.options.layout === undefined && ["object", "array"].includes(type)) {
      format.options = { ...format.options, layout: type === "object" ? "outline" : "table" };
    }
    return { name: node.names[0] ?? "Artifact", type, format, schema: { ...node, format }, final: false };
  }
  async validatePayload(bytes: Uint8Array, contentType: string): Promise<void> {
    const contract = this.contract(contentType);
    const registry = createBuiltInArtifactValidatorRegistry();
    const context = { runId: "schema", stepId: "schema", artifactPath: "artifact", attemptId: "validation" };
    const candidate = await prepareArtifactCandidate(contract, { kind: "inline", value: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }, context);
    const result = await registry.execute(registry.resolvePlan(contract), { contract, candidate, context });
    if (result.status !== "passed") throw new ArtifactValidationFailure(result);
  }
}
export class SchemaModelRuntimeFactory implements ModelRuntimeFactory<string> {
  readonly target = Object.freeze({ metaModel: MEMSPHERE_SCHEMA_MODEL });
  async createRuntime(context: Context, model: Model, _registry: ModelRuntimeRegistry): Promise<SchemaModelRuntime> {
    context.signal?.throwIfAborted();
    return new SchemaModelRuntime(model);
  }
}
