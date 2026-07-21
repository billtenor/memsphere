import assert from "node:assert/strict";
import test from "node:test";
import type { MemoryEntity } from "../src/memory/ast.js";
import { memorySchemas } from "../src/memory/schema.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";
import {
  serializeMemoryJson,
  serializeMemoryListJson,
  serializeMemoryListText,
  serializeMemoryListYaml,
  serializeMemoryNodeListJson,
  serializeMemoryNodeListText,
  serializeMemoryNodeListYaml,
  serializeMemoryNodeReadJson,
  serializeMemoryNodeReadYaml,
  serializeMemoryYaml
} from "../src/memory/serializer.js";
import { parseMemoryYaml } from "../src/memory/yaml.js";
import { parse } from "yaml";

const entities: MemoryEntity[] = [
  {
    tag: "!concept",
    syntax: currentMemorySyntax,
    names: ["Memory: core", "记忆 #1"],
    defines: [
      "A multiline\ndefinition",
      {
        tag: "!statement",
        names: ["Embedded statement"],
        defines: [],
        asserts: ["Nested tags survive."],
        suggests: ["Keep them structured."]
      }
    ],
    extends: []
  },
  {
    tag: "!statement",
    syntax: currentMemorySyntax,
    names: ["Suggestion"],
    defines: [],
    asserts: ["Statements assert."],
    suggests: ["Statements may suggest."],
    sections: [
      {
        tag: "!statement",
        names: ["Nested guidance"],
        defines: [],
        suggests: ["Nested Statement tags survive."]
      }
    ]
  },
  {
    tag: "!schema",
    syntax: currentMemorySyntax,
    names: ["Record"],
    defines: [],
    format: { name: "markdown", options: { layout: "outline" } },
    fields: [
      {
        tag: "!schema",
        names: ["title"],
        defines: ["A title: with punctuation"],
        type: "string",
        format: { name: "plain", options: {} }
      },
      {
        tag: "!repeat",
        limit: { min: 1, max: 2 },
        body: [
          "note",
          {
            tag: "!schema",
            names: ["decision"],
            defines: [],
            fields: ["conclusion"]
          }
        ]
      },
      {
        tag: "!schema",
        names: ["values"],
        defines: [],
        type: "array",
        format: { name: "yaml", options: {} },
        item: {
          tag: "!schema",
          names: [],
          defines: [],
          type: "string"
        }
      }
    ]
  },
  {
    tag: "!procedure",
    syntax: currentMemorySyntax,
    names: ["Nested procedure"],
    defines: [],
    asserts: ["Global procedure contracts survive."],
    goals: ["Exercise every flow tag."],
    roleBindings: { reviewer: ["review_agent"] },
    flow: [
      {
        tag: "!if",
        condition: {
          tag: "!action",
          action: "Decide.",
          artifact: { tag: "!artifact", name: "decision", type: "boolean", format: { name: "plain", options: {} } }
        },
        then: [
          {
            tag: "!while",
            condition: {
              tag: "!action",
              action: "Continue?",
              artifact: { tag: "!artifact", name: "continue", type: "boolean", format: { name: "plain", options: {} } }
            },
            do: [{ tag: "!call", target: "child" }]
          }
        ],
        else: [
          {
            tag: "!action",
            action: "Write markdown.",
            artifact: {
              tag: "!artifact",
              name: "note",
              type: "string",
              format: { name: "markdown", options: {} },
              roleBindings: { reviewer: ["human_reviewer", "review_agent"] },
              permissionGrants: { runner: ["artifact.submit"] }
            }
          }
        ]
      }
    ]
  }
];

for (const entity of entities) {
  test(`YAML serializer round-trips ${entity.tag}`, () => {
    const source = serializeMemoryYaml(entity);
    assert(source.startsWith(`${entity.tag}\n`));
    assert(!/^tag:/m.test(source));
    if (entity.tag === "!procedure") {
      assert.doesNotMatch(source, /type: string/);
      assert.match(source, /role_bindings:/);
      assert.match(source, /permission_grants:/);
      assert.doesNotMatch(source, /roleBindings|permissionGrants/);
    }
    const parsed = parseMemoryYaml(source);
    const kind = entity.tag === "!concept"
      ? "concepts"
      : entity.tag === "!statement"
        ? "statements"
        : entity.tag === "!schema"
          ? "schemas"
          : "procedures";
    assert.deepEqual(memorySchemas[kind].parse(parsed), entity);
  });

  test(`JSON serializer preserves ${entity.tag} AST`, () => {
    assert.deepEqual(JSON.parse(serializeMemoryJson(entity)), entity);
  });
}

test("list serializers produce structured machine output and compact text", () => {
  const page = {
    memories: [
      { reference: "concepts/Memory", kind: "concepts" as const, names: ["Memory", "记忆"], defines: ["A memory."] },
      { reference: "schemas/Record", kind: "schemas" as const, names: ["Record"], defines: [] }
    ],
    next_cursor: null
  };

  assert.deepEqual(parse(serializeMemoryListYaml(page)), page);
  assert.deepEqual(JSON.parse(serializeMemoryListJson(page)), page);
  assert.equal(serializeMemoryListText(page), "concepts/Memory (记忆)\nschemas/Record\n");
  assert.equal(serializeMemoryListText({ memories: [], next_cursor: null }), "");
});

test("memory node serializers preserve tagged fragments and copyable text references", () => {
  const page = {
    memory: { reference: "procedures/Flow", kind: "procedures" as const, names: ["Flow"] },
    nodes: [{
      node_ref: "action:Result",
      type: "Action" as const,
      artifact: "Result",
      summary: "Produce a result.",
      relation: "flow",
      has_children: false
    }],
    next_cursor: null
  };
  assert.deepEqual(parse(serializeMemoryNodeListYaml(page)), page);
  assert.deepEqual(JSON.parse(serializeMemoryNodeListJson(page)), page);
  assert.equal(serializeMemoryNodeListText(page), "action:Result\n");
  assert.match(serializeMemoryNodeListYaml(page), /artifact: Result/);

  const result = {
    memory: page.memory,
    node_ref: "action:Result",
    node_type: "Action" as const,
    context: {
      root: {
        tag: "!procedure",
        names: ["Flow"],
        defines: [],
        goals: ["Finish."],
        roleBindings: { reviewer: ["review_agent"] }
      },
      ancestors: []
    },
    fragment: {
      tag: "!action",
      action: "Produce a result.",
      artifact: {
        tag: "!artifact",
        name: "Result",
        type: "string",
        format: { name: "markdown", options: {} },
        review: "artifact_acceptance.unanimous",
        permissionGrants: { runner: ["artifact.submit"] }
      }
    }
  };
  const yaml = serializeMemoryNodeReadYaml(result);
  assert.match(yaml, /root: !procedure/);
  assert.match(yaml, /fragment: !action/);
  assert.match(yaml, /role_bindings:/);
  assert.match(yaml, /permission_grants:/);
  assert.match(yaml, /review: artifact_acceptance\.unanimous/);
  assert.doesNotMatch(yaml, /roleBindings|permissionGrants/);
  assert.deepEqual(JSON.parse(serializeMemoryNodeReadJson(result)), result);
});
