import { Document, Pair, YAMLMap, YAMLSeq, type Node } from "yaml";
import type { MemoryEntity } from "./ast.js";
import type { MemoryListPage } from "./catalog.js";

export function serializeMemoryYaml(entity: MemoryEntity): string {
  return serializeYaml(entity);
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

function serializeYaml(value: unknown): string {
  const document = new Document();
  document.contents = createYamlNode(document, value);
  return document.toString({ lineWidth: 0 });
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
