import { isMemoryKind, type MemoryKind } from "./kinds.js";

export const canonicalMemoryNameMaxLength = 120;
export const canonicalMemoryNamePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export type LogicalMemoryReference = {
  kind: MemoryKind;
  name: string;
};

export function normalizeMemoryName(value: string): string {
  return value.trim();
}

export function canonicalMemoryNameIssue(value: string): string | undefined {
  if (value.length > canonicalMemoryNameMaxLength) {
    return `canonical Memory name must not exceed ${canonicalMemoryNameMaxLength} characters`;
  }
  if (!canonicalMemoryNamePattern.test(value)) {
    return "canonical Memory name must use lowercase ASCII kebab-case (for example, memorybase-mr-review-rules)";
  }
  return undefined;
}

export function isCanonicalMemoryName(value: string): boolean {
  return canonicalMemoryNameIssue(value) === undefined;
}

export function assertCanonicalMemoryName(value: string): void {
  const issue = canonicalMemoryNameIssue(value);
  if (issue) throw new Error(issue);
}

export function memoryAliasIssue(value: string): string | undefined {
  if (!value) return "Memory alias must not be empty";
  if (value !== value.trim()) return "Memory alias must not contain leading or trailing whitespace";
  if (value.includes("/")) return "Memory alias must not contain /";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "Memory alias must not contain control characters";
  return undefined;
}

export function parseLogicalMemoryReference(input: string): LogicalMemoryReference | undefined {
  const normalized = normalizeMemoryName(input);
  if (input !== normalized) return undefined;
  const separator = normalized.indexOf("/");
  if (separator <= 0) return undefined;

  const kind = normalized.slice(0, separator);
  const name = normalized.slice(separator + 1);
  if (!isMemoryKind(kind) || !isCanonicalMemoryName(name)) return undefined;
  return { kind, name };
}

export function canonicalMemoryReference(kind: MemoryKind, canonicalName: string): string | undefined {
  return isCanonicalMemoryName(canonicalName) ? `${kind}/${canonicalName}` : undefined;
}
