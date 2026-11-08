import assert from "node:assert/strict";
import test from "node:test";
import type { MemoryEntity } from "../src/memory/ast.js";
import { validateMemoryReferences } from "../src/memory/references.js";
import type { MemoryFile } from "../src/memory/store.js";

function memoryFile(path: string, kind: MemoryFile["kind"], entity: MemoryEntity): MemoryFile {
  return { path, kind, entity };
}

test("reference validation resolves canonical logical references", () => {
  const files: MemoryFile[] = [
    memoryFile("consumer.yaml", "schemas", {
      tag: "!schema",
      names: ["consumer"],
      defines: [],
      asserts: [{ tag: "!ref", target: "statements/rule-a" }]
    }),
    memoryFile("rule.yaml", "statements", {
      tag: "!statement",
      names: ["rule-a", "Rule Alias"],
      defines: [],
      asserts: ["Required."]
    })
  ];

  assert.deepEqual(validateMemoryReferences(files), []);
});

test("reference validation rejects aliases and malformed names in explicit references", () => {
  const files: MemoryFile[] = [
    memoryFile("consumer.yaml", "statements", {
      tag: "!statement",
      names: ["consumer"],
      defines: [],
      asserts: [
        { tag: "!ref", target: "statements/Rule Alias" },
        { tag: "!ref", target: "statements/rule_alias" }
      ]
    }),
    memoryFile("rule.yaml", "statements", {
      tag: "!statement",
      names: ["rule-a", "Rule Alias"],
      defines: [],
      asserts: ["Required."]
    })
  ];

  const issues = validateMemoryReferences(files);
  assert.equal(issues.length, 2);
  assert(issues.every((issue) => issue.message.includes("invalid !ref target")));
});

test("reference validation detects cycles reached through canonical references", () => {
  const files: MemoryFile[] = [
    memoryFile("a.yaml", "statements", {
      tag: "!statement",
      names: ["rule-a"],
      defines: [],
      asserts: [{ tag: "!ref", target: "statements/rule-b" }]
    }),
    memoryFile("b.yaml", "statements", {
      tag: "!statement",
      names: ["rule-b"],
      defines: [],
      asserts: [{ tag: "!ref", target: "statements/rule-a" }]
    })
  ];

  const cycle = validateMemoryReferences(files).find((issue) => issue.message.includes("Memory reference cycle detected"));
  assert(cycle);
  assert.match(cycle.message, /statements\/rule-a\.asserts/);
  assert.match(cycle.message, /statements\/rule-b\.asserts/);
});

test("reference validation does not combine assert and suggest graphs", () => {
  const files: MemoryFile[] = [
    memoryFile("a.yaml", "statements", {
      tag: "!statement",
      names: ["rule-a"],
      defines: [],
      asserts: ["A."],
      suggests: [{ tag: "!ref", target: "statements/rule-b" }]
    }),
    memoryFile("b.yaml", "statements", {
      tag: "!statement",
      names: ["rule-b"],
      defines: [],
      asserts: [{ tag: "!ref", target: "statements/rule-a" }],
      suggests: ["B."]
    })
  ];
  assert.deepEqual(validateMemoryReferences(files), []);
});

test("reference validation rejects a channel with an empty effective projection", () => {
  const files: MemoryFile[] = [
    memoryFile("consumer.yaml", "schemas", {
      tag: "!schema",
      names: ["consumer"],
      defines: [],
      asserts: [{ tag: "!ref", target: "statements/advice" }]
    }),
    memoryFile("advice.yaml", "statements", {
      tag: "!statement",
      names: ["advice"],
      defines: [],
      suggests: ["Prefer clarity."]
    })
  ];
  assert.match(validateMemoryReferences(files)[0].message, /has no effective asserts/);
});

test("reference validation checks target kinds", () => {
  const files: MemoryFile[] = [
    memoryFile("concept.yaml", "concepts", {
      tag: "!concept",
      names: ["shared"],
      defines: []
    }),
    memoryFile("schema.yaml", "schemas", {
      tag: "!schema",
      names: ["schema-a"],
      defines: [],
      fields: [{ tag: "!ref", target: "concepts/shared" }]
    })
  ];

  const issues = validateMemoryReferences(files);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /has kind concepts; expected schemas/);
});

test("reference validation covers extends, call targets, and Artifact schemas", () => {
  const files: MemoryFile[] = [
    memoryFile("concept.yaml", "concepts", {
      tag: "!concept",
      names: ["child"],
      defines: [],
      extends: ["missing-parent"]
    }),
    memoryFile("procedure.yaml", "procedures", {
      tag: "!procedure",
      names: ["workflow"],
      defines: [],
      flow: [
        { tag: "!call", target: "missing-procedure" },
        {
          tag: "!action",
          action: "Produce a result.",
          artifact: {
            tag: "!artifact",
            name: "result",
            type: "object",
            format: { name: "plain", options: {} },
            schema: "missing-schema"
          }
        }
      ]
    })
  ];

  const issues = validateMemoryReferences(files);
  assert.equal(issues.length, 3);
  assert(issues.some((issue) => issue.message.includes('Memory target "missing-parent"')));
  assert(issues.some((issue) => issue.message.includes('Memory target "missing-procedure"')));
  assert(issues.some((issue) => issue.message.includes('Memory target "missing-schema"')));
});
