import {
  type Document,
  isMap,
  parseDocument,
  type CollectionTag,
  type ParsedNode,
  type Scalar,
  type YAMLMap
} from "yaml";
import { memoryKindTags, type MemoryKind } from "./kinds.js";

const memoryYamlTags: CollectionTag[] = Object.values(memoryKindTags).map((tag) => ({
  tag,
  collection: "map"
}));

const nestedStructTags: CollectionTag[] = ["!action", "!artifact", "!if", "!while", "!call", "!repeat"].map((tag) => ({
  tag,
  collection: "map"
}));

export const memoryCustomTags = [...memoryYamlTags, ...nestedStructTags];

function nodeTag(node: ParsedNode | null | undefined): string | undefined {
  return node?.tag ?? undefined;
}

function scalarValue(node: ParsedNode | null | undefined): unknown {
  return (node as Scalar | null | undefined)?.value;
}

function mapToPlainObject(map: YAMLMap): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const item of map.items) {
    const key = scalarValue(item.key as ParsedNode);

    if (typeof key !== "string") {
      continue;
    }

    result[key] = nodeToPlainValue(item.value as ParsedNode);
  }

  return result;
}

function sequenceToPlainArray(node: ParsedNode): unknown[] {
  if (!("items" in node) || !Array.isArray(node.items)) {
    return [];
  }

  return node.items.map((item) => nodeToPlainValue(item as ParsedNode));
}

function nodeToPlainValue(node: ParsedNode | null | undefined): unknown {
  if (!node) {
    return null;
  }

  if (isMap(node)) {
    const tag = nodeTag(node);
    const value = mapToPlainObject(node);
    return tag?.startsWith("!") && tag !== "!" ? { tag, ...value } : value;
  }

  if ("items" in node && Array.isArray(node.items)) {
    return sequenceToPlainArray(node);
  }

  const tag = nodeTag(node);
  const value = scalarValue(node);

  if (tag?.startsWith("!") && tag !== "!") {
    return {
      tag,
      value
    };
  }

  return value;
}

export function parseMemoryYaml(source: string): unknown {
  const document = parseMemoryYamlDocument(source);

  const contents = document.contents;

  if (!contents || !isMap(contents)) {
    throw new Error("memory YAML must contain one tagged mapping at the document root");
  }

  return nodeToPlainValue(contents);
}

export function parseMemoryYamlDocument(source: string): Document.Parsed {
  const document = parseDocument(source, {
    prettyErrors: false,
    customTags: memoryCustomTags
  });

  if (document.errors.length > 0) {
    throw document.errors[0];
  }

  return document;
}

export function assertExpectedTag(entity: unknown, kind: MemoryKind, filePath: string): void {
  const expectedTag = memoryKindTags[kind];

  if (!entity || typeof entity !== "object" || !("tag" in entity)) {
    throw new Error(`${filePath} must start with ${expectedTag}`);
  }

  const actualTag = (entity as { tag?: unknown }).tag;

  if (actualTag !== expectedTag) {
    throw new Error(`${filePath} uses ${String(actualTag)} but expected ${expectedTag}`);
  }
}
