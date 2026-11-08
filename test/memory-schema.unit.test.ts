import assert from "node:assert/strict";
import test from "node:test";
import {
  conceptMemorySchema,
  inferSchemaType,
  procedureMemorySchema,
  resolveSchemaContract,
  schemaMemorySchema,
  statementMemorySchema
} from "../src/memory/schema.js";
import { parseMemoryYaml } from "../src/memory/yaml.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

function parseProcedure(source: string) {
  return procedureMemorySchema.parse(parseMemoryYaml(withCurrentMemorySyntax(source)));
}

function parseSchema(source: string) {
  return schemaMemorySchema.parse(parseMemoryYaml(withCurrentMemorySyntax(source)));
}

function parseStatement(source: string) {
  return statementMemorySchema.parse(parseMemoryYaml(withCurrentMemorySyntax(source)));
}

test("name is a canonical single-value shorthand for names", () => {
  const concept = conceptMemorySchema.parse(parseMemoryYaml(withCurrentMemorySyntax(`!concept
name: work-item
defines: [A unit of work.]
`)));
  const statement = parseStatement(`!statement
name: rules
asserts: [A rule holds.]
sections:
  - !statement
    name: Nested rule
    asserts: [A nested rule holds.]
`);
  const schema = parseSchema(`!schema
name: record
fields:
  - !schema
    name: title
`);
  const procedure = parseProcedure(`!procedure
name: workflow
`);

  assert.deepEqual(concept.names, ["work-item"]);
  assert.deepEqual(statement.sections?.[0].names, ["Nested rule"]);
  assert.deepEqual(schema.fields?.[0].names, ["title"]);
  assert.deepEqual(procedure.names, ["workflow"]);
  assert.throws(() => parseSchema(`!schema
name: record
names: [record]
fields: []
`), /name/);
});

test("top-level canonical names are strict while aliases and nested names stay descriptive", () => {
  const valid = conceptMemorySchema.parse(parseMemoryYaml(withCurrentMemorySyntax(`!concept
names: [memorybase-review-rules, "MemoryBase 评审规则", "review rules"]
defines:
  - A definition.
`)));
  assert.deepEqual(valid.names, ["memorybase-review-rules", "MemoryBase 评审规则", "review rules"]);

  for (const invalid of [
    "Uppercase",
    "contains space",
    "中文",
    "under_score",
    "has.dot",
    "-leading",
    "trailing-",
    "repeated--hyphen",
    `a${"b".repeat(120)}`
  ]) {
    assert.equal(conceptMemorySchema.safeParse(parseMemoryYaml(withCurrentMemorySyntax(`!concept
names: [${JSON.stringify(invalid)}]
defines: [invalid]
`))).success, false, invalid);
  }

  for (const invalidAlias of [" leading", "trailing ", "has/slash", "line\nbreak"]) {
    assert.equal(conceptMemorySchema.safeParse({
      tag: "!concept",
      syntax: valid.syntax,
      names: ["valid-name", invalidAlias],
      defines: ["invalid alias"]
    }).success, false, JSON.stringify(invalidAlias));
  }
});

test("defines accepts only text while rule fields accept Statement refs", () => {
  const entity = parseSchema(`!schema
names: [example]
defines:
  - Text definition.
asserts:
  - A rule must hold.
  - !ref
    target: statements/external-rule
suggests:
  - !ref
    target: statements/external-guidance
fields:
  - simple
  - !schema
    names: [nested]
`);

  assert.deepEqual(entity.defines, ["Text definition."]);
  assert.deepEqual(entity.asserts?.[1], { tag: "!ref", target: "statements/external-rule" });
  assert.deepEqual(entity.suggests?.[0], { tag: "!ref", target: "statements/external-guidance" });
  assert.equal(entity.fields?.[0], "simple");
  assert.equal(entity.fields?.[1].tag, "!schema");
  assert.throws(() => parseSchema(`!schema
names: [example]
defines:
  - !ref
    target: statements/external-rule
`), /defines/);
});

test("Statement supports independent assertion and suggestion collections", () => {
  const withSuggestions = parseStatement(`!statement
names: [guidance]
asserts: [A required rule.]
suggests: [Prefer the documented path.]
`);
  assert.deepEqual(withSuggestions.suggests, ["Prefer the documented path."]);

  const withoutSuggestions = parseStatement(`!statement
names: [rule]
asserts: [A required rule.]
`);
  assert.equal(withoutSuggestions.suggests, undefined);

  const suggestionsOnly = parseStatement(`!statement
names: [advice]
suggests: [Prefer the documented path.]
`);
  assert.equal(suggestionsOnly.asserts, undefined);
  assert.deepEqual(suggestionsOnly.suggests, ["Prefer the documented path."]);

  assert.throws(() => parseStatement(`!statement
names: [invalid]
asserts: [A required rule.]
suggests: [1]
`), /suggests/);
  assert.throws(() => parseStatement(`!statement
names: [invalid]
suggests: []
`), /suggests/);
  assert.throws(() => parseStatement(`!statement
names: [invalid]
asserts: []
`), /asserts/);
  assert.throws(() => parseStatement(`!statement
names: [invalid]
asserts: [A required rule.]
unknown: value
`), /unknown/);
});

test("Schema supports independent assertion and suggestion collections", () => {
  const schema = parseSchema(`!schema
name: delivery
asserts:
  - Every required field must be present.
suggests:
  - Prefer concise field values.
fields:
  - !schema
    name: Summary
    asserts:
      - The summary must describe the result.
    suggests:
      - Keep the summary to one sentence.
`);

  assert.deepEqual(schema.asserts, ["Every required field must be present."]);
  assert.deepEqual(schema.suggests, ["Prefer concise field values."]);
  const summary = schema.fields?.[0];
  assert(summary && typeof summary !== "string" && summary.tag === "!schema");
  assert.deepEqual(summary.asserts, ["The summary must describe the result."]);
  assert.deepEqual(summary.suggests, ["Keep the summary to one sentence."]);

  assert.throws(() => parseSchema(`!schema
name: invalid
suggests: [1]
`), /suggests/);
  assert.throws(() => parseSchema(`!schema
name: invalid
suggests: []
`), /suggests/);
});

test("Statement sections organize recursive and mixed rule nodes", () => {
  const entity = parseStatement(`!statement
names: [repository-rules]
asserts: [All changes must be reviewed.]
sections:
  - !statement
    names: [Code organization]
    suggests: [Prefer domain-oriented modules.]
    sections:
      - !statement
        names: [Module boundaries]
        asserts: [Cross-module access must use public interfaces.]
  - !statement
    names: [Testing]
    asserts: [Core logic changes require tests.]
    suggests: [Prefer focused tests.]
`);

  assert.deepEqual(entity.asserts, ["All changes must be reviewed."]);
  assert.equal(entity.sections?.[0].names[0], "Code organization");
  assert.deepEqual(entity.sections?.[0].suggests, ["Prefer domain-oriented modules."]);
  assert.deepEqual(
    entity.sections?.[0].sections?.[0].asserts,
    ["Cross-module access must use public interfaces."]
  );
  assert.deepEqual(entity.sections?.[1].suggests, ["Prefer focused tests."]);

  const categoriesOnly = parseStatement(`!statement
names: [repository-rules]
sections:
  - !statement
    names: [Testing]
    asserts: [Core logic changes require tests.]
`);
  assert.equal(categoriesOnly.asserts, undefined);
  assert.equal(categoriesOnly.sections?.length, 1);
});

test("Statement sections reject empty, unnamed, and duplicate nodes with precise paths", () => {
  assert.throws(() => parseStatement(`!statement
names: [empty]
`), /Statement must define asserts, suggests, or sections/);
  assert.throws(() => parseStatement(`!statement
names: [empty-sections]
sections: []
`), /sections/);
  assert.throws(() => parseStatement(`!statement
names: [untagged-section]
sections:
  - names: [Testing]
    asserts: [A rule.]
`), /tag/);
  assert.throws(() => parseStatement(`!statement
names: [invalid-section]
sections: [Testing]
`), /sections/);

  const unnamed = statementMemorySchema.safeParse(parseMemoryYaml(withCurrentMemorySyntax(`!statement
names: [repository-rules]
sections:
  - !statement
    asserts: [A rule.]
`)));
  assert.equal(unnamed.success, false);
  if (!unnamed.success) {
    assert(unnamed.error.issues.some((issue) =>
      issue.path.join(".") === "sections.0.names"
      && issue.message.includes("non-empty names")
    ));
  }

  const duplicate = statementMemorySchema.safeParse(parseMemoryYaml(withCurrentMemorySyntax(`!statement
names: [repository-rules]
sections:
  - !statement
    names: [Testing]
    asserts: [First rule.]
  - !statement
    names: [" Testing "]
    suggests: [Second rule.]
`)));
  assert.equal(duplicate.success, false);
  if (!duplicate.success) {
    assert(duplicate.error.issues.some((issue) =>
      issue.path.join(".") === "sections.1.names.0"
      && issue.message.includes("unique among siblings")
    ));
  }
});

test("Procedure supports optional global assertions", () => {
  const entity = parseProcedure(`!procedure
names: [guarded-procedure]
asserts:
  - A more specific Procedure must take precedence.
flow: []
`);

  assert.deepEqual(entity.asserts, ["A more specific Procedure must take precedence."]);

  assert.throws(() => parseProcedure(`!procedure
names: [invalid]
asserts: []
flow: []
`), /asserts/);
  assert.throws(() => parseProcedure(`!procedure
names: [invalid]
asserts: [1]
flow: []
`), /asserts/);
});

test("Action supports contracts and Artifact supports inline Schema and final metadata", () => {
  const entity = parseProcedure(`!procedure
names: [contracts]
flow:
  - !action
    action: Produce a private delivery.
    asserts: [The result is complete.]
    suggests: [Prefer concise wording.]
    artifact: !artifact
      name: delivery
      type: object
      format:
        name: markdown
        layout: outline
      final: true
      schema: !schema
        asserts: [Keep the structure auditable.]
        fields: [summary]
`);
  const step = entity.flow[0];
  assert.equal(step.tag, "!action");
  if (step.tag === "!action") {
    assert.deepEqual(step.asserts, ["The result is complete."]);
    assert.deepEqual(step.suggests, ["Prefer concise wording."]);
    assert.equal(step.artifact.final, true);
    assert.equal(typeof step.artifact.schema, "object");
  }

  assert.throws(() => parseProcedure(`!procedure
names: [invalid-contract]
flow:
  - !action
    action: Invalid.
    asserts: []
    artifact: !artifact
      name: result
      type: string
`), /asserts/);
  assert.throws(() => parseProcedure(`!procedure
names: [invalid-boolean]
flow:
  - !action
    action: Invalid.
    artifact: !artifact
      name: result
      type: boolean
`), /boolean Artifact/);
  assert.throws(() => parseProcedure(`!procedure
names: [invalid-inline]
flow:
  - !action
    action: Invalid.
    artifact: !artifact
      name: result
      type: string
      schema: !schema
        fields: [summary]
`), /does not support schema/);
});

test("recursive elseif uses a single nested If and keeps else on the root", () => {
  const entity = parseProcedure(`!procedure
names: [branching]
flow:
  - !if
    condition: !action
      action: Check A.
      artifact: !artifact
        name: A
        type: boolean
    then:
      - !action
        action: Handle A.
        artifact: !artifact
          name: A result
          type: string
    elseif: !if
      condition: !action
        action: Check B.
        artifact: !artifact
          name: B
          type: boolean
      then:
        - !action
          action: Handle B.
          artifact: !artifact
            name: B result
            type: string
    else:
      - !action
        action: Handle fallback.
        artifact: !artifact
          name: fallback
          type: string
`);

  const node = entity.flow[0];
  assert.equal(node.tag, "!if");
  if (node.tag !== "!if") return;
  assert.equal(node.elseif?.condition.artifact.name, "B");
  assert.equal(node.else?.[0].tag, "!action");
});

test("Artifact defaults omitted type to string while conditions still require boolean", () => {
  const entity = parseProcedure(`!procedure
names: [default-string]
flow:
  - !action
    action: Write a note.
    artifact: !artifact
      name: note
      format: markdown
`);
  const step = entity.flow[0];
  assert.equal(step.tag === "!action" ? step.artifact.type : undefined, "string");

  assert.throws(() => parseProcedure(`!procedure
names: [default-string-condition]
flow:
  - !while
    condition: !action
      action: Continue?
      artifact: !artifact
        name: decision
    do:
      - !action
        action: Record progress.
        artifact: !artifact
          name: progress
`), /boolean/);
});

const invalidProcedures: Array<[string, string, RegExp]> = [
  ["untagged Action", `!procedure
names: [invalid]
flow:
  - action: Old action.
    artifact: !artifact
      name: result
      type: string
`, /flow/],
  ["untagged Artifact", `!procedure
names: [invalid]
flow:
  - !action
    action: Old artifact.
    artifact:
      name: result
      type: string
`, /artifact/],
  ["empty artifact format", `!procedure
names: [invalid]
flow:
  - !action
    action: Old number.
    artifact: !artifact
      name: result
      type: string
      format: {}
`, /name/],
  ["elseif array", `!procedure
names: [invalid]
flow:
  - !if
    condition: !action
      action: Check A.
      artifact: !artifact
        name: A
        type: boolean
    then:
      - !action
        action: Handle A.
        artifact: !artifact
          name: A result
          type: string
    elseif:
      - !if
        condition: !action
          action: Check B.
          artifact: !artifact
            name: B
            type: boolean
        then:
          - !action
            action: Handle B.
            artifact: !artifact
              name: B result
              type: string
`, /elseif/],
  ["else on nested elseif", `!procedure
names: [invalid]
flow:
  - !if
    condition: !action
      action: Check A.
      artifact: !artifact
        name: A
        type: boolean
    then:
      - !action
        action: Handle A.
        artifact: !artifact
          name: A result
          type: string
    elseif: !if
      condition: !action
        action: Check B.
        artifact: !artifact
          name: B
          type: boolean
      then:
        - !action
          action: Handle B.
          artifact: !artifact
            name: B result
            type: string
      else:
        - !action
          action: Nested fallback.
          artifact: !artifact
            name: fallback
            type: string
`, /else is only allowed/],
  ["non-boolean condition", `!procedure
names: [invalid]
flow:
  - !while
    condition: !action
      action: Check.
      artifact: !artifact
        name: result
        type: string
    do:
      - !action
        action: Repeat.
        artifact: !artifact
          name: repeated
          type: string
`, /boolean/],
  ["empty branch", `!procedure
names: [invalid]
flow:
  - !if
    condition: !action
      action: Check.
      artifact: !artifact
        name: result
        type: boolean
    then: []
`, /then/]
];

for (const [name, source, expected] of invalidProcedures) {
  test(`rejects ${name}`, () => {
    assert.throws(() => parseProcedure(source), expected);
  });
}

test("rejects scalar call and unregistered control tags at YAML parsing", () => {
  assert.throws(() => parseProcedure(`!procedure
names: [invalid]
flow:
  - !call child
`));
  assert.throws(() => parseProcedure(`!procedure
names: [invalid]
flow:
  - !elseif
    condition: value
`));
});

test("requires names for top-level and field Schema", () => {
  assert.throws(() => parseSchema(`!schema
defines: [value]
`), /top-level memory/);
  assert.throws(() => parseSchema(`!schema
names: [root]
fields:
  - !schema
    asserts: [Required.]
`), /non-empty names/);
  assert.throws(() => parseSchema(`!schema
names: [root]
defines:
  - !schema
    type: array
    format: json
`), /defines/);
});

test("Schema supports optional type and format contracts", () => {
  const inherited = parseSchema(`!schema
names: [structure]
fields: [summary]
`);
  assert.equal(inherited.type, undefined);
  assert.equal(inherited.format, undefined);

  const table = parseSchema(`!schema
names: [rows]
type: array
format:
  name: markdown
  layout: table
item: !schema
  type: object
  fields: [ID, Summary]
`);
  assert.equal(table.type, "array");
  assert.deepEqual(table.format, { name: "markdown", options: { layout: "table" } });

  const localPlain = parseSchema(`!schema
names: [value]
type: string
`);
  assert.equal(localPlain.type, "string");
  assert.equal(localPlain.format, undefined);

  const inheritedFormat = parseSchema(`!schema
names: [inherits-format]
type: array
item: !schema
  type: string
`);
  assert.equal(inheritedFormat.type, "array");
  assert.equal(inheritedFormat.format, undefined);

  assert.throws(() => parseSchema(`!schema
names: [invalid-scalar]
type: string
fields: [value]
`), /fields/);
  assert.throws(() => parseSchema(`!schema
names: [invalid-array]
type: array
fields: [value]
`), /fields/);
  assert.throws(() => parseSchema(`!schema
names: [invalid-table]
type: object
format:
  name: markdown
  layout: table
fields: [value]
`), /layout: outline/);
});

test("Schema infers local types and inherits only compatible format layout", () => {
  const leaf = parseSchema(`!schema
names: [leaf]
defines: [value]
`);
  assert.equal(inferSchemaType(leaf), "string");
  assert.deepEqual(resolveSchemaContract(leaf, {
    name: "markdown",
    options: { layout: "outline" }
  }), {
    type: "string",
    format: { name: "markdown", options: {} }
  });

  const object = parseSchema(`!schema
names: [object]
fields: [value]
`);
  assert.equal(inferSchemaType(object), "object");
  assert.deepEqual(resolveSchemaContract(object, {
    name: "markdown",
    options: { layout: "outline" }
  }), {
    type: "object",
    format: { name: "markdown", options: { layout: "outline" } }
  });

  const emptyObject = parseSchema(`!schema
names: [empty-object]
fields: []
`);
  assert.equal(inferSchemaType(emptyObject), "object");

  assert.deepEqual(resolveSchemaContract(leaf, {
    name: "yaml",
    options: {}
  }), {
    type: "string",
    format: { name: "yaml", options: {} }
  });
});

test("Schema outline fields support mapping Repeat groups and limits", () => {
  const entity = parseSchema(`!schema
names: [decision-record]
fields:
  - context
  - !repeat
    limit:
      min: 1
      max: 3
    body:
      - !schema
        names: [decision]
        fields: [conclusion]
      - owner
  - summary
`);

  const repeat = entity.fields?.[1];
  assert.equal(typeof repeat === "object" ? repeat.tag : undefined, "!repeat");
  if (typeof repeat === "object" && repeat.tag === "!repeat") {
    assert.deepEqual(repeat.limit, { min: 1, max: 3 });
    assert.equal(repeat.body.length, 2);
  }
});

test("Schema Repeat rejects invalid shape, limits, and nesting", () => {
  const invalidSources = [
    `!schema\nnames: [empty body]\nfields:\n  - !repeat\n    body: []\n`,
    `!schema\nnames: [empty limit]\nfields:\n  - !repeat\n    limit: {}\n    body: [value]\n`,
    `!schema\nnames: [negative]\nfields:\n  - !repeat\n    limit: { min: -1 }\n    body: [value]\n`,
    `!schema\nnames: [fraction]\nfields:\n  - !repeat\n    limit: { max: 1.5 }\n    body: [value]\n`,
    `!schema\nnames: [reversed]\nfields:\n  - !repeat\n    limit: { min: 3, max: 2 }\n    body: [value]\n`,
    `!schema\nnames: [nested]\nfields:\n  - !repeat\n    body:\n      - !repeat\n        body: [value]\n`,
    `!schema\nnames: [nested in schema]\nfields:\n  - !repeat\n    body:\n      - !schema\n        names: [item]\n        fields:\n          - !repeat\n            body: [value]\n`,
    `!schema\nnames: [unknown]\nfields:\n  - !repeat\n    body: [value]\n    extra: true\n`
  ];

  for (const source of invalidSources) {
    assert.throws(() => parseSchema(source));
  }

  assert.throws(() => parseSchema(`!schema
names: [sequence-repeat]
fields:
  - !repeat [value]
`));
});

test("format is rejected on memory types without format implementations", () => {
  assert.throws(() => conceptMemorySchema.parse(parseMemoryYaml(withCurrentMemorySyntax(`!concept
names: [invalid]
format: outline
`))), /format/);
});

test("table layout belongs to an array markdown Artifact", () => {
  const procedure = parseProcedure(`!procedure
names: [table]
flow:
  - !action
    action: Write rows.
    artifact: !artifact
      name: requirements
      type: array
      format:
        name: markdown
        layout: table
      schema: !schema
        type: array
        item: !schema
          type: object
          fields: [id, description]
`);
  const step = procedure.flow[0];
  assert.equal(step.tag === "!action" ? step.artifact.format.options.layout : undefined, "table");

  assert.throws(() => parseProcedure(`!procedure
names: [invalid-table]
flow:
  - !action
    action: Write rows.
    artifact: !artifact
      name: requirements
      type: object
      format:
        name: markdown
        layout: table
      schema: !schema
        fields: [id]
`), /requires layout: outline/);
});

test("Schema preserves custom format targets for registered validators", () => {
  const schema = parseSchema(`!schema
names: [custom]
format: domain-specific
`);
  assert.deepEqual(schema.format, { name: "domain-specific", options: {} });
});

test("Schema supports item and union items while rejecting legacy element_types", () => {
  assert.throws(() => parseSchema(`!schema
names: [unknown-element_types]
element_types: [string]
`), /element_types/);

  const single = parseSchema(`!schema
names: [strings]
type: array
item: !schema
  type: string
`);
  assert.equal(single.item?.type, "string");

  const union = parseSchema(`!schema
names: [mixed]
type: array
items:
  - !schema
    type: string
  - !schema
    type: number
`);
  assert.deepEqual(union.items?.map((item) => item.type), ["string", "number"]);

  assert.throws(() => parseSchema(`!schema
names: [too-few]
type: array
items:
  - !schema
    type: string
`), /at least 2/);
  assert.throws(() => parseSchema(`!schema
names: [both]
type: array
item: !schema
  type: string
items:
  - !schema
    type: string
  - !schema
    type: number
`), /mutually exclusive/);
  assert.throws(() => parseSchema(`!schema
names: [wrong-owner]
item: !schema
  type: string
`), /explicit type: array/);
  assert.throws(() => parseSchema(`!schema
names: [repeat-item]
type: array
item: !schema
  fields:
    - !repeat
      body: [value]
`), /not allowed under array item/);
  assert.throws(() => parseSchema(`!schema
names: [camel-case]
elementTypes: [string]
`), /elementTypes/);
});
