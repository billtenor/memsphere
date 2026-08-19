import assert from "node:assert/strict";
import test from "node:test";
import type { MemoryEntity } from "../src/memory/ast.js";
import { validateMemoryReferences } from "../src/memory/references.js";
import type { MemoryFile } from "../src/memory/store.js";

function memoryFile(path: string, kind: MemoryFile["kind"], entity: MemoryEntity): MemoryFile {
  return { path, kind, entity };
}

test("reference validation resolves explicit aliases to canonical references", () => {
  const files: MemoryFile[] = [
    memoryFile("concept.yaml", "concepts", {
      tag: "!concept",
      names: ["Concept A"],
      defines: [{ tag: "!ref", target: "schemas/ Schema Alias " }]
    }),
    memoryFile("schema.yaml", "schemas", {
      tag: "!schema",
      names: ["Schema A", "Schema Alias"],
      defines: [],
      fields: ["summary"]
    })
  ];

  assert.deepEqual(validateMemoryReferences(files), []);
});

test("reference validation detects cycles reached through aliases", () => {
  const files: MemoryFile[] = [
    memoryFile("concept.yaml", "concepts", {
      tag: "!concept",
      names: ["Concept A", "Concept Alias"],
      defines: [{ tag: "!ref", target: "schemas/Schema Alias" }]
    }),
    memoryFile("schema.yaml", "schemas", {
      tag: "!schema",
      names: ["Schema A", "Schema Alias"],
      defines: [{ tag: "!ref", target: "concepts/Concept Alias" }]
    })
  ];

  const issues = validateMemoryReferences(files);
  const cycle = issues.find((issue) => issue.message.includes("Memory reference cycle detected"));
  assert(cycle);
  assert.match(cycle.message, /concepts\/Concept A/);
  assert.match(cycle.message, /schemas\/Schema A/);
});

test("reference validation checks the kind before resolving an alias", () => {
  const files: MemoryFile[] = [
    memoryFile("concept.yaml", "concepts", {
      tag: "!concept",
      names: ["Concept A", "Shared Alias"],
      defines: []
    }),
    memoryFile("schema.yaml", "schemas", {
      tag: "!schema",
      names: ["Schema A"],
      defines: [],
      fields: [{ tag: "!ref", target: "concepts/Shared Alias" }]
    })
  ];

  const issues = validateMemoryReferences(files);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /has kind concepts; expected schemas/);
});
