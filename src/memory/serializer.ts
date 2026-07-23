import { Document, Pair, YAMLMap, YAMLSeq, type Node } from "yaml";
import type { MemoryEntity } from "./ast.js";
import type { MemoryListPage } from "./catalog.js";
import type { MemoryNodeListPage, MemoryNodeReadResult } from "./navigation.js";

export function serializeMemoryYaml(entity: MemoryEntity): string {
  return serializeYaml(prepareMemoryForYaml(entity));
}

export function serializeMemoryJson(entity: MemoryEntity): string {
  return `${JSON.stringify(entity, null, 2)}\n`;
}

export function serializeMemoryListYaml(page: MemoryListPage): string {
  return serializeYaml(page);
}

export function serializeMemoryListJson(page: MemoryListPage): string {
  return `${JSON.stringify(page, null, 2)}\n`;
}

export function serializeMemoryListText(page: MemoryListPage): string {
  if (page.memories.length === 0) return "";
  return `${page.memories.map((memory) => {
    const aliases = memory.names.slice(1);
    return aliases.length > 0
      ? `${memory.reference} (${aliases.join(", ")})`
      : memory.reference;
  }).join("\n")}\n`;
}

export function serializeMemoryNodeListYaml(page: MemoryNodeListPage): string {
  return serializeYaml(page);
}

export function serializeMemoryNodeListJson(page: MemoryNodeListPage): string {
  return `${JSON.stringify(page, null, 2)}\n`;
}

export function serializeMemoryNodeListText(page: MemoryNodeListPage): string {
  if (page.nodes.length === 0) return "";
  return `${page.nodes.map((node) => node.node_ref).join("\n")}\n`;
}

export function serializeMemoryNodeReadYaml(result: MemoryNodeReadResult): string {
  return serializeYaml(prepareMemoryForYaml(result));
}

export function serializeMemoryNodeReadJson(result: MemoryNodeReadResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function serializeYaml(value: unknown): string {
  const document = new Document();
  document.contents = createYamlNode(document, value);
  return document.toString({ lineWidth: 0 });
}

function prepareMemoryForYaml(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prepareMemoryForYaml);
  if (value === null || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const prepared: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (record.tag === "!artifact" && key === "type" && item === "string") continue;
    if ((record.tag === "!artifact" || record.tag === "!schema") && key === "format" && isFormatSpec(item)) {
      const optionEntries = Object.entries(item.options);
      if (record.tag === "!artifact" && item.name === "plain" && optionEntries.length === 0) continue;
      prepared.format = optionEntries.length === 0
        ? item.name
        : { name: item.name, ...Object.fromEntries(optionEntries.map(([name, option]) => [name, prepareMemoryForYaml(option)])) };
      continue;
    }
    prepared[key] = prepareMemoryForYaml(item);
  }
  return prepared;
}

function isFormatSpec(value: unknown): value is { name: string; options: Readonly<Record<string, unknown>> } {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { name?: unknown }).name === "string" &&
    (value as { options?: unknown }).options &&
    typeof (value as { options?: unknown }).options === "object" &&
    !Array.isArray((value as { options?: unknown }).options)
  );
}

function createYamlNode(document: Document, value: unknown): Node {
  if (Array.isArray(value)) {
    const sequence = new YAMLSeq();
    sequence.items = value.map((item) => createYamlNode(document, item));
    return sequence;
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const mapping = new YAMLMap();
    const tag = typeof record.tag === "string" && record.tag.startsWith("!") ? record.tag : undefined;

    for (const [key, item] of Object.entries(record)) {
      if ((key === "tag" && tag) || item === undefined) continue;
      mapping.items.push(new Pair(document.createNode(key), createYamlNode(document, item)));
    }

    if (tag) mapping.tag = tag;
    return mapping;
  }

  return document.createNode(value);
}
