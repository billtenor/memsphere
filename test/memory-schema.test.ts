import assert from "node:assert/strict";
import test from "node:test";
import { conceptMemorySchema, procedureMemorySchema, schemaMemorySchema, statementMemorySchema } from "../src/memory/schema.js";
import { parseMemoryYaml } from "../src/memory/yaml.js";

function parseProcedure(source: string) {
  return procedureMemorySchema.parse(parseMemoryYaml(source));
}

function parseSchema(source: string) {
  return schemaMemorySchema.parse(parseMemoryYaml(source));
}

function parseStatement(source: string) {
  return statementMemorySchema.parse(parseMemoryYaml(source));
}

test("defines accepts text, anonymous Statement, and anonymous Schema", () => {
  const entity = parseSchema(`!schema
names: [example]
defines:
  - Text definition.
  - !statement
    asserts:
      - A rule must hold.
    suggests:
      - Prefer the documented path.
    sections:
      - !statement
        names: [Nested guidance]
        suggests:
          - Prefer a focused example.
  - !schema
    fields:
      - shorthand
      - !schema
        names: [detailed]
        asserts:
          - Detailed value is required.
fields:
  - simple
  - !schema
    names: [nested]
`);

  const embeddedStatement = entity.defines[1];
  assert.equal(typeof embeddedStatement === "string" ? undefined : embeddedStatement.tag, "!statement");
  if (typeof embeddedStatement !== "string" && embeddedStatement.tag === "!statement") {
    assert.deepEqual(embeddedStatement.suggests, ["Prefer the documented path."]);
    assert.deepEqual(embeddedStatement.sections?.[0].suggests, ["Prefer a focused example."]);
  }
  assert.equal(entity.defines[2].tag, "!schema");
  assert.equal(entity.fields?.[0], "simple");
  assert.equal(entity.fields?.[1].tag, "!schema");
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

test("Statement sections organize recursive and mixed rule nodes", () => {
  const entity = parseStatement(`!statement
names: [Repository rules]
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
names: [Repository rules]
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
names: [empty sections]
sections: []
`), /sections/);
  assert.throws(() => parseStatement(`!statement
names: [untagged section]
sections:
  - names: [Testing]
    asserts: [A rule.]
`), /tag/);
  assert.throws(() => parseStatement(`!statement
names: [invalid section]
sections: [Testing]
`), /sections/);

  const unnamed = statementMemorySchema.safeParse(parseMemoryYaml(`!statement
names: [Repository rules]
sections:
  - !statement
    asserts: [A rule.]
`));
  assert.equal(unnamed.success, false);
  if (!unnamed.success) {
    assert(unnamed.error.issues.some((issue) =>
      issue.path.join(".") === "sections.0.names"
      && issue.message.includes("non-empty names")
    ));
  }

  const duplicate = statementMemorySchema.safeParse(parseMemoryYaml(`!statement
names: [Repository rules]
sections:
  - !statement
    names: [Testing]
    asserts: [First rule.]
  - !statement
    names: [" Testing "]
    suggests: [Second rule.]
`));
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

test("requires names for top-level and field Schema but permits anonymous embedded Schema", () => {
  assert.throws(() => parseSchema(`!schema
defines: [value]
`), /top-level memory/);
  assert.throws(() => parseSchema(`!schema
names: [root]
fields:
  - !schema
    asserts: [Required.]
`), /non-empty names/);
  assert.doesNotThrow(() => parseSchema(`!schema
names: [root]
defines:
  - !schema
    element_types: [string]
`));
});

test("Schema no longer owns presentation format", () => {
  assert.doesNotThrow(() => parseSchema(`!schema
names: [structure]
fields: [summary]
`));
  for (const format of ["outline", "table"]) {
    assert.throws(() => parseSchema(`!schema
names: [legacy]
format: ${format}
fields: [summary]
`), /format/);
  }
});

test("Schema outline fields support mapping Repeat groups and limits", () => {
  const entity = parseSchema(`!schema
names: [decision record]
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
names: [sequence repeat]
fields:
  - !repeat [value]
`));
});

test("format is rejected on memory types without format implementations", () => {
  assert.throws(() => conceptMemorySchema.parse(parseMemoryYaml(`!concept
names: [invalid]
format: outline
`)), /format/);
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

for (const format of ["section", "field", "list", "template"]) {
  test(`rejects removed Schema format ${format}`, () => {
    assert.throws(() => parseSchema(`!schema
names: [legacy]
format: ${format}
`), /format/);
  });
}

test("Schema element_types rejects unknown, duplicate, and incompatible field types", () => {
  assert.throws(() => parseSchema(`!schema
names: [unknown-element_types]
element_types: [Unknown]
`), /element_types/);
  assert.throws(() => parseSchema(`!schema
names: [duplicate-element_types]
element_types: [string, string]
`), /duplicate/);
  assert.throws(() => parseSchema(`!schema
names: [empty-element_types]
element_types: []
`), /element_types/);
  assert.throws(() => parseSchema(`!schema
names: [invalid-structure]
element_types: [string]
fields: [value]
`), /must include Schema/);
});

test("Schema rejects non-snake-case and legacy element type field names", () => {
  assert.throws(() => parseSchema(`!schema
names: [legacy-items]
items: [string]
`), /items/);
  assert.throws(() => parseSchema(`!schema
names: [camel-case]
elementTypes: [string]
`), /elementTypes/);
});
