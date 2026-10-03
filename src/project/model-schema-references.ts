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

function pointerSegments(fragment: string): string[] {
  let decoded: string;
  try { decoded = decodeURIComponent(fragment); }
  catch { throw new TypeError(`Invalid URI-encoded JSON Pointer: #${fragment}`); }
  if (!decoded) return [];
  if (!decoded.startsWith("/")) throw new TypeError(`Unsupported schema reference anchor: #${fragment}`);
  return decoded.slice(1).split("/").map(segment => {
    if (/~(?:[^01]|$)/.test(segment)) throw new TypeError(`Invalid JSON Pointer escape: #${fragment}`);
    return segment.replaceAll("~1", "/").replaceAll("~0", "~");
  });
}

/** Only schema positions are visited; ordinary examples/default/enum data stay opaque. */
export function collectModelSchemaReferences(definition: unknown, modelRef: string): ModelSchemaReference[] {
  if (!object(definition)) return [];
  let base: URL | undefined;
  if (definition.$id !== undefined) {
    if (typeof definition.$id !== "string" || !URL.canParse(definition.$id)) {
      throw new TypeError(`Cannot inspect relative schema $id: ${modelRef}`);
    }
    base = new URL(definition.$id);
    if (base.hash && base.hash !== "#") throw new TypeError(`Cannot inspect schema $id fragment: ${modelRef}`);
    base.hash = "";
  }
  const result: ModelSchemaReference[] = [];
  const visit = (schema: unknown, path: string): void => {
    if (!object(schema)) return;
    if (schema !== definition && schema.$id !== undefined) throw new TypeError(`Cannot inspect nested schema $id: ${modelRef} ${path}`);
    if (schema.$ref !== undefined) {
      if (typeof schema.$ref !== "string") throw new TypeError(`Invalid schema $ref: ${modelRef} ${path}`);
      const ref = schema.$ref;
      let targetModelRef = modelRef;
      let fragment = "";
      if (!ref || ref.startsWith("#")) fragment = ref.slice(1);
      else if (base) {
        let resolved: URL;
        try { resolved = new URL(ref, base); }
        catch { throw new TypeError(`Cannot resolve schema reference: ${modelRef} ${path} ${ref}`); }
        fragment = resolved.hash.slice(1);
        resolved.hash = "";
        if (resolved.href !== base.href) targetModelRef = resolved.href;
      } else {
        const hash = ref.indexOf("#");
        targetModelRef = hash < 0 ? ref : ref.slice(0, hash);
        fragment = hash < 0 ? "" : ref.slice(hash + 1);
      }
      pointerSegments(fragment);
      result.push({ ref, path: pointer(path, "$ref"), targetModelRef, fragment });
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

/** Package dependencies must be in the same atomic import; no network or other package is loaded. */
export function validateModelSchemaReferences(models: readonly { registration: { modelRef: string }; definition: unknown }[]): void {
  const byId = new Map(models.map(model => [model.registration.modelRef, model.definition]));
  for (const model of models) {
    for (const ref of collectModelSchemaReferences(model.definition, model.registration.modelRef)) {
      if (!byId.has(ref.targetModelRef)) throw new TypeError(`Missing model reference: ${model.registration.modelRef} ${ref.path} -> ${ref.targetModelRef}`);
      let target = byId.get(ref.targetModelRef);
      for (const key of pointerSegments(ref.fragment)) {
        if (target === null || typeof target !== "object" || !Object.hasOwn(target, key)) {
          throw new TypeError(`Missing schema reference: ${model.registration.modelRef} ${ref.path} -> ${ref.ref}`);
        }
        target = (target as Record<string, unknown>)[key];
      }
      if (typeof target !== "boolean" && !object(target)) throw new TypeError(`Reference target is not a schema: ${model.registration.modelRef} ${ref.ref}`);
    }
  }
}
