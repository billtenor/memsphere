import type { Context } from "../data/api/context.js";
import type { Model } from "../data/api/model.js";
import type { ModelRuntime, ModelRuntimeRegistry } from "../data/api/model-runtime.js";
import { JSON_SCHEMA_DRAFT_07, JsonSchemaModelRuntimeFactory } from "../data/extensions/json-schema/index.js";
import { JsonSchemaMetaModelRuntimeFactory, validateJsonSchemaDefinition } from "../data/extensions/json-schema-metamodel/index.js";
import { RAW_MODEL, RawModelRuntime } from "../data/extensions/raw/index.js";
import { bytesContent } from "../data/extensions/shared/payload.js";
import { assertModelRef } from "./model-registration-contract.js";
import { validateModelSchemaReferences } from "./model-schema-references.js";

export type ModelCheck = "definition" | "runtime";
export type ModelCandidate = { modelRef: string; metaModel?: string; definition: unknown; source?: string };
export type CheckedModel = { model: Model; runtime?: ModelRuntime };

const noDependencies: ModelRuntimeRegistry = {
  get: () => undefined,
  register() { throw new TypeError("Model validation does not register cross-model dependencies"); }
};

function invalid(code: string, modelRef: string, cause: unknown): never {
  const prior = cause && typeof cause === "object" ? cause as { details?: { path?: string }; code?: string } : undefined;
  throw Object.assign(new TypeError(cause instanceof Error ? cause.message : String(cause), { cause }), {
    code: prior?.code ?? code, details: { ...prior?.details, modelRef, path: prior?.details?.path ?? "#" }
  });
}

/** Pure candidate checks shared by Project reads and every publishing entry point. */
export async function checkModelDefinition(context: Context, candidate: ModelCandidate, check: ModelCheck = "runtime"): Promise<CheckedModel> {
  context.signal?.throwIfAborted();
  assertModelRef(candidate.modelRef);
  const metaModel = candidate.metaModel ?? JSON_SCHEMA_DRAFT_07;
  assertModelRef(metaModel);
  let definition: unknown;
  let source: string;
  try {
    source = candidate.source ?? JSON.stringify(candidate.definition);
    if (typeof source !== "string") throw new TypeError("Model definition must be JSON");
    // Validate the bytes that will be persisted when a source is supplied.
    definition = candidate.source === undefined ? structuredClone(candidate.definition) : JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch (error) { invalid("MODEL_DEFINITION_INVALID", candidate.modelRef, error); }
  const model: Model = { data: { id: candidate.modelRef, model: metaModel,
    payload: { contentType: "application/json", content: bytesContent(Buffer.from(source)) } }, definition };
  let runtime: ModelRuntime | undefined;
  try {
    if (metaModel === JSON_SCHEMA_DRAFT_07) validateJsonSchemaDefinition(definition);
    else if (metaModel === RAW_MODEL) runtime = new RawModelRuntime(model);
    else throw Object.assign(new TypeError(`Unsupported model standard: ${metaModel}`), { code: "MODEL_RUNTIME_UNSUPPORTED" });
  } catch (error) { invalid("MODEL_DEFINITION_INVALID", candidate.modelRef, error); }
  if (metaModel === JSON_SCHEMA_DRAFT_07) validateModelSchemaReferences([{ registration: { modelRef: candidate.modelRef }, definition }]);
  if (check === "definition") return { model };
  try {
    runtime ??= await (candidate.modelRef === JSON_SCHEMA_DRAFT_07
      ? new JsonSchemaMetaModelRuntimeFactory()
      : new JsonSchemaModelRuntimeFactory()).createRuntime(context, model, noDependencies);
  } catch (error) {
    context.signal?.throwIfAborted();
    invalid("MODEL_RUNTIME_UNSUPPORTED", candidate.modelRef, error);
  }
  return { model, runtime };
}
