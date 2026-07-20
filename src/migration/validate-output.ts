import { readFile } from "node:fs/promises";
import { memoryKinds, type MemoryKind } from "../memory/kinds.js";
import { memorySyntaxRegistry } from "../memory/schema.js";
import { listMemoryFiles } from "../memory/store.js";
import { currentMemorySyntax } from "../memory/syntax.js";
import { assertExpectedTag, parseMemoryYaml } from "../memory/yaml.js";

export async function validateMigrationOutputRoot(memoryRoot: string): Promise<void> {
  const schemas = memorySyntaxRegistry.require(currentMemorySyntax).schemas;
  for (const kind of memoryKinds) {
    for (const path of await listMemoryFiles(memoryRoot, kind)) {
      const entity = parseMemoryYaml(await readFile(path, "utf8"));
      assertExpectedTag(entity, kind, path);
      schemas[kind as MemoryKind].parse({
        ...(entity as Record<string, unknown>),
        syntax: currentMemorySyntax
      });
    }
  }
}
