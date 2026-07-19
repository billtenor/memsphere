import type { ZodTypeAny } from "zod";
import type { MemoryKind } from "./kinds.js";

export const startMemorySyntax = "start";
export const firstStableMemorySyntax = "memsphere-20260719-stable";
export const currentMemorySyntax = firstStableMemorySyntax;

export type MemorySyntaxVersion = string;

export type MemorySyntaxDefinition = {
  version: MemorySyntaxVersion;
  schemas: Readonly<Record<MemoryKind, ZodTypeAny>>;
};

const formalSyntaxPattern = /^memsphere-(\d{4})(\d{2})(\d{2})-(?:draft|stable)$/;

export class MemorySyntaxRegistry {
  readonly #definitions = new Map<MemorySyntaxVersion, MemorySyntaxDefinition>();

  register(definition: MemorySyntaxDefinition): void {
    assertMemorySyntaxIdentifier(definition.version);
    if (this.#definitions.has(definition.version)) {
      throw new Error(`Duplicate Memory syntax registration: ${definition.version}`);
    }
    this.#definitions.set(definition.version, definition);
  }

  get(version: MemorySyntaxVersion): MemorySyntaxDefinition | undefined {
    return this.#definitions.get(version);
  }

  require(version: MemorySyntaxVersion): MemorySyntaxDefinition {
    const definition = this.get(version);
    if (!definition) {
      throw new Error(
        `Unsupported Memory syntax ${version}; current syntax is ${currentMemorySyntax}. ` +
        "Upgrade memsphere or migrate the Memory store."
      );
    }
    return definition;
  }

  versions(): MemorySyntaxVersion[] {
    return [...this.#definitions.keys()];
  }
}

export function readMemorySyntax(value: unknown): MemorySyntaxVersion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return startMemorySyntax;
  const syntax = (value as Record<string, unknown>).syntax;
  if (syntax === undefined) return startMemorySyntax;
  if (typeof syntax !== "string") {
    throw new Error("Memory syntax must be a string");
  }
  assertMemorySyntaxIdentifier(syntax);
  return syntax;
}

export function assertMemorySyntaxIdentifier(value: string): void {
  if (value === startMemorySyntax) return;
  const match = formalSyntaxPattern.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) return;
  }
  throw new Error(
    `Invalid Memory syntax ${JSON.stringify(value)}; expected start or memsphere-YYYYMMDD-draft|stable`
  );
}

export function isCurrentMemorySyntax(value: MemorySyntaxVersion): boolean {
  return value === currentMemorySyntax;
}
