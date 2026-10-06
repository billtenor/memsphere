/** Project-private reference inspection; this does not compile or expand schemas. */
export type ModelSchemaReference = {
  ref: string;
  path: string;
  targetModelRef: string;
  fragment: string;
};

const schemaMaps = ["properties", "patternProperties", "definitions"];
const schemaChildren = ["additionalProperties", "additionalItems", "contains", "propertyNames", "not", "if", "then", "else"];
const schemaArrays = ["allOf", "anyOf", "oneOf"];
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const pointer = (path: string, key: string) => `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;

function referenceError(modelRef: string, path: string, message: string, unsupported = false): never {
  throw Object.assign(new TypeError(`${message}: ${modelRef} ${path}`), {
    code: unsupported ? "MODEL_REFERENCE_UNSUPPORTED" : "MODEL_REFERENCE_INVALID", details: { modelRef, path }
  });
}

function pointerSegments(fragment: string, modelRef: string, path: string): string[] {
  let decoded: string;
  try { decoded = decodeURIComponent(fragment); }
  catch { referenceError(modelRef, path, `Invalid URI-encoded JSON Pointer: #${fragment}`); }
  if (!decoded) return [];
  if (!decoded.startsWith("/")) referenceError(modelRef, path, `Unsupported schema reference anchor: #${fragment}`);
  return decoded.slice(1).split("/").map(segment => {
    if (/~(?:[^01]|$)/.test(segment)) referenceError(modelRef, path, `Invalid JSON Pointer escape: #${fragment}`);
    return segment.replaceAll("~1", "/").replaceAll("~0", "~");
  });
}

/** Only schema positions are visited; ordinary examples/default/enum data stay opaque. */
export function collectModelSchemaReferences(definition: unknown, modelRef: string): ModelSchemaReference[] {
  if (!object(definition)) return [];
  const result: ModelSchemaReference[] = [];
  const visited = new WeakSet<object>();
  const visit = (schema: unknown, path: string): void => {
    if (!object(schema) || visited.has(schema)) return;
    visited.add(schema);
    if (schema.$ref !== undefined) {
      const refPath = pointer(path, "$ref");
      if (typeof schema.$ref !== "string") referenceError(modelRef, refPath, "Invalid schema $ref");
      const ref = schema.$ref;
      if (ref !== "" && ref !== "#" && !ref.startsWith("#/")) {
        referenceError(modelRef, refPath, ref.startsWith("#")
          ? `Unsupported schema reference anchor or pointer: ${ref}`
          : `Cross-model schema references are not supported (${ref}); use a local JSON Pointer`, !ref.startsWith("#"));
      }
      const fragment = ref.slice(1);
      const segments = pointerSegments(fragment, modelRef, refPath);
      let target: unknown = definition;
      let targetPath = "#";
      for (const key of segments) {
        if (target === null || typeof target !== "object" || !Object.hasOwn(target, key))
          referenceError(modelRef, refPath, `Missing schema reference: ${ref}`);
        target = (target as Record<string, unknown>)[key];
        targetPath = pointer(targetPath, key);
      }
      if (typeof target !== "boolean" && !object(target)) referenceError(modelRef, refPath, `Reference target is not a schema: ${ref}`);
      result.push({ ref, path: refPath, targetModelRef: modelRef, fragment });
      // A locally referenced object is a schema even if stored under an otherwise opaque annotation.
      visit(target, targetPath);
    }
    for (const key of schemaMaps) {
      if (object(schema[key])) for (const [name, child] of Object.entries(schema[key])) visit(child, pointer(pointer(path, key), name));
    }
    for (const key of schemaChildren) visit(schema[key], pointer(path, key));
    for (const key of schemaArrays) {
      if (Array.isArray(schema[key])) schema[key].forEach((child, index) => visit(child, pointer(pointer(path, key), String(index))));
    }
    if (Array.isArray(schema.items)) schema.items.forEach((child, index) => visit(child, pointer(pointer(path, "items"), String(index))));
    else visit(schema.items, pointer(path, "items"));
    if (object(schema.dependencies)) {
      for (const [name, child] of Object.entries(schema.dependencies)) if (!Array.isArray(child)) visit(child, pointer(pointer(path, "dependencies"), name));
    }
  };
  visit(definition, "#");
  return result;
}

export function collectExternalSchemaReferences(definition: unknown, modelRef: string): string[] {
  return [...new Set(collectModelSchemaReferences(definition, modelRef).map(ref => ref.targetModelRef).filter(ref => ref !== modelRef))];
}

/** Every definition is self-contained; package membership never grants reference access. */
export function validateModelSchemaReferences(models: readonly { registration: { modelRef: string }; definition: unknown }[]): void {
  for (const model of models) collectModelSchemaReferences(model.definition, model.registration.modelRef);
}
