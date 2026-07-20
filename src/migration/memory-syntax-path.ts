import type { Document } from "yaml";
import {
  assertMemorySyntaxIdentifier,
  firstStableMemorySyntax,
  startMemorySyntax,
  type MemorySyntaxVersion
} from "../memory/syntax.js";

export type MemorySyntaxMigrationStep = {
  readonly from: MemorySyntaxVersion;
  readonly to: MemorySyntaxVersion;
  migrate(document: Document.Parsed): void;
};

export class MemorySyntaxMigrationRegistry {
  readonly #steps = new Map<MemorySyntaxVersion, MemorySyntaxMigrationStep>();

  register(step: MemorySyntaxMigrationStep): void {
    assertMemorySyntaxIdentifier(step.from);
    assertMemorySyntaxIdentifier(step.to);
    if (step.from === step.to) throw new Error(`Memory syntax migration cannot target itself: ${step.from}`);
    if (this.#steps.has(step.from)) {
      throw new Error(`Duplicate Memory syntax migration from ${step.from}`);
    }
    this.#steps.set(step.from, step);
  }

  path(from: MemorySyntaxVersion, to: MemorySyntaxVersion): MemorySyntaxMigrationStep[] {
    const result: MemorySyntaxMigrationStep[] = [];
    const visited = new Set<MemorySyntaxVersion>();
    let current = from;
    while (current !== to) {
      if (visited.has(current)) throw new Error(`Memory syntax migration cycle detected at ${current}`);
      visited.add(current);
      const step = this.#steps.get(current);
      if (!step) throw new Error(`No Memory syntax migration path from ${from} to ${to}`);
      result.push(step);
      current = step.to;
    }
    return result;
  }

  canMigrate(from: MemorySyntaxVersion, to: MemorySyntaxVersion): boolean {
    try {
      this.path(from, to);
      return from !== to;
    } catch {
      return false;
    }
  }
}

export const memorySyntaxMigrationRegistry = new MemorySyntaxMigrationRegistry();
memorySyntaxMigrationRegistry.register({
  from: startMemorySyntax,
  to: firstStableMemorySyntax,
  migrate: () => undefined
});

export function canMigrateMemorySyntax(from: MemorySyntaxVersion, to: MemorySyntaxVersion): boolean {
  return memorySyntaxMigrationRegistry.canMigrate(from, to);
}
