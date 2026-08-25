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
    names: ["memory-core", "记忆 #1"],
    defines: [
      "A multiline\ndefinition"
    ],
    extends: []
  },
  {
    tag: "!statement",
    syntax: currentMemorySyntax,
    names: ["suggestion"],
    defines: [],
    asserts: ["Statements assert.", { tag: "!ref", target: "statements/shared-assertions" }],
    suggests: ["Statements may suggest.", { tag: "!ref", target: "statements/shared-suggestions" }],
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
    names: ["record"],
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
    names: ["nested-procedure"],
    defines: [],
    asserts: ["Global procedure contracts survive."],
    goals: ["Exercise every flow tag."],
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
              review: ["human_reviewer", "review_agent"]
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
      assert.match(source, /review:/);
      assert.doesNotMatch(source, /roleBindings|permissionGrants|role_bindings|permission_grants/);
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
      { reference: "concepts/memory", kind: "concepts" as const, names: ["memory", "记忆"], defines: ["A memory."] },
      { reference: "schemas/record", kind: "schemas" as const, names: ["record"], defines: [] }
    ],
    next_cursor: null
  };

  assert.deepEqual(parse(serializeMemoryListYaml(page)), page);
  assert.deepEqual(JSON.parse(serializeMemoryListJson(page)), page);
  assert.equal(serializeMemoryListText(page), "concepts/memory (记忆)\nschemas/record\n");
  assert.equal(serializeMemoryListText({ memories: [], next_cursor: null }), "");
});

test("memory node serializers preserve tagged fragments and copyable text references", () => {
  const page = {
    memory: { reference: "procedures/flow", kind: "procedures" as const, names: ["flow"] },
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
        names: ["flow"],
        defines: [],
        goals: ["Finish."]
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
        review: ["review_agent"]
      }
    }
  };
  const yaml = serializeMemoryNodeReadYaml(result);
  assert.match(yaml, /root: !procedure/);
  assert.match(yaml, /fragment: !action/);
  assert.match(yaml, /review:/);
  assert.match(yaml, /review_agent/);
  assert.doesNotMatch(yaml, /role_bindings|permission_grants/);
  assert.doesNotMatch(yaml, /roleBindings|permissionGrants/);
  assert.deepEqual(JSON.parse(serializeMemoryNodeReadJson(result)), result);
});
