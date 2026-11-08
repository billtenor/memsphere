import { schemaNodeSchema, memorySyntaxRegistry } from "./schema.js";
import { parseMemoryYaml } from "./yaml.js";
import { serializeEffectiveMemoryReadYaml } from "./serializer.js";
import type { SchemaNode } from "./ast.js";

export const MEMSPHERE_SCHEMA_MODEL = "memsphere/schema.json";

/** Inline model definitions share Memory syntax, but need no catalog identity. */
export function parseSchemaModel(source: string): { syntax: string; node: SchemaNode } {
  const value = parseMemoryYaml(source) as Record<string, unknown>;
  if (!value || value.tag !== "!schema" || typeof value.syntax !== "string") {
    throw new TypeError("Schema model definition requires !schema and an explicit syntax");
  }
  memorySyntaxRegistry.require(value.syntax);
  const { syntax, ...node } = value;
  const parsed = schemaNodeSchema.parse(node);
  const checkOptional = (value: SchemaNode, field = false): void => {
    if (value.optional === true && !field) throw new TypeError("optional is only allowed on named Schema fields");
    for (const child of value.fields ?? []) if (typeof child === "object") {
      if (child.tag === "!schema") checkOptional(child, true);
      else if (child.tag === "!repeat") for (const member of child.body) if (typeof member === "object" && member.tag === "!schema") checkOptional(member, true);
    }
    if (value.item?.tag === "!schema") checkOptional(value.item);
    for (const item of value.items ?? []) if (item.tag === "!schema") checkOptional(item);
  };
  checkOptional(parsed);
  return { syntax: syntax as string, node: parsed };
}

export function serializeSchemaModel(syntax: string, node: SchemaNode): string {
  return serializeEffectiveMemoryReadYaml({ ...node, syntax });
}
