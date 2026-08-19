import { isMemoryKind, type MemoryKind } from "./kinds.js";

export type LogicalMemoryReference = {
  kind: MemoryKind;
  name: string;
};

export function normalizeMemoryName(value: string): string {
  return value.trim();
}

export function parseLogicalMemoryReference(input: string): LogicalMemoryReference | undefined {
  const normalized = normalizeMemoryName(input);
  const separator = normalized.indexOf("/");
  if (separator <= 0) return undefined;

  const kind = normalized.slice(0, separator);
  const name = normalizeMemoryName(normalized.slice(separator + 1));
  if (!isMemoryKind(kind) || !name) return undefined;
  return { kind, name };
}

export function canonicalMemoryReference(kind: MemoryKind, canonicalName: string): string | undefined {
  const name = normalizeMemoryName(canonicalName);
  return name ? `${kind}/${name}` : undefined;
}
