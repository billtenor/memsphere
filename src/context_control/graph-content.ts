import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { checkModelDefinition } from "../project/model-validation.js";
import { encodeJsonValue } from "../data/extensions/json-serializer/index.js";
import type { GraphArtifactSpec } from "../memory/ast.js";
import type { Body } from "./types.js";
import type { ContentReader } from "./service.js";
import { failure } from "./errors.js";

export const mimeType = (value: string) => value.split(";", 1)[0].trim().toLowerCase();
export function decodeGraphContent(bytes: Uint8Array, contentType: string): unknown {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  switch (mimeType(contentType)) {
    case "text/plain": case "text/markdown": return text;
    case "application/json": { const value: unknown = JSON.parse(text); encodeJsonValue(value); return value; }
    case "application/yaml": case "application/x-yaml": case "text/yaml": {
      const doc = parseDocument(text);
      if (doc.errors.length || doc.warnings.length) throw failure("CONTENT_INVALID", (doc.errors[0] ?? doc.warnings[0]).message);
      const value: unknown = doc.toJS(); encodeJsonValue(value); return value;
    }
    default: throw failure("CONTENT_TYPE_UNSUPPORTED", `Unsupported graph content type: ${contentType}`);
  }
}
export async function validateGraphSpec(spec: GraphArtifactSpec) {
  if (!["application/json", "application/yaml", "application/x-yaml", "text/yaml", "text/plain", "text/markdown"].includes(mimeType(spec.payload.contentType))) throw failure("CONTENT_TYPE_UNSUPPORTED", `Unsupported graph content type: ${spec.payload.contentType}`);
  return checkModelDefinition({}, { modelRef: "memsphere/graph-artifact.json", metaModel: spec.model.definedBy, definition: undefined, source: spec.model.definition });
}
export async function graphBody(body: Body, reader: ContentReader) {
  if (!!body.content === !!body.contentRef) throw failure("INVALID_ARGUMENT", "Exactly one of content/contentRef is required");
  if (body.content) {
    if (typeof body.content.payload?.content !== "string" || !body.content.payload.contentType) throw failure("INVALID_ARGUMENT", "Invalid Artifact payload");
    return { bytes: Buffer.from(body.content.payload.content), contentType: body.content.payload.contentType };
  }
  const ref = body.contentRef!;
  if (!/^[a-f0-9]{64}$/.test(ref.sha256)) throw failure("INVALID_ARGUMENT", "Invalid contentRef SHA-256");
  const result = await reader(ref, {});
  if (createHash("sha256").update(result.bytes).digest("hex") !== ref.sha256) throw failure("CONTENT_CHANGED", "Artifact contentRef SHA-256 mismatch");
  return result;
}
export async function validateGraphBody(body: Body, spec: GraphArtifactSpec, reader: ContentReader) {
  const value = await graphBody(body, reader);
  if (mimeType(value.contentType) !== mimeType(spec.payload.contentType)) throw failure("CONTENT_TYPE_MISMATCH", `Expected ${spec.payload.contentType}, received ${value.contentType}`);
  const { runtime } = await validateGraphSpec(spec);
  const decoded = decodeGraphContent(value.bytes, value.contentType);
  runtime!.reflect(spec.model.definedBy === "raw.json" ? value.bytes : decoded);
  return { ...value, decoded, sha256: createHash("sha256").update(value.bytes).digest("hex") };
}
