import assert from "node:assert/strict";
import test from "node:test";
import { schemaFormats } from "../src/memory/ast.js";
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
    format: outline
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
      format: schema
      final: true
      schema: !schema
        format: outline
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
      format: string
`), /asserts/);
  assert.throws(() => parseProcedure(`!procedure
names: [invalid-boolean]
flow:
  - !action
    action: Invalid.
    artifact: !artifact
      name: result
      format: boolean
`), /boolean Artifact/);
  assert.throws(() => parseProcedure(`!procedure
names: [invalid-inline]
flow:
  - !action
    action: Invalid.
    artifact: !artifact
      name: result
      format: string
      schema: !schema
        fields: [summary]
`), /schema is only allowed/);
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
        format: boolean
    then:
      - !action
        action: Handle A.
        artifact: !artifact
          name: A result
          format: string
    elseif: !if
      condition: !action
        action: Check B.
        artifact: !artifact
          name: B
          format: boolean
      then:
        - !action
          action: Handle B.
          artifact: !artifact
            name: B result
            format: string
    else:
      - !action
        action: Handle fallback.
        artifact: !artifact
          name: fallback
          format: string
`);

  const node = entity.flow[0];
  assert.equal(node.tag, "!if");
  if (node.tag !== "!if") return;
  assert.equal(node.elseif?.condition.artifact.name, "B");
  assert.equal(node.else?.[0].tag, "!action");
});

const invalidProcedures: Array<[string, string, RegExp]> = [
  ["untagged Action", `!procedure
names: [invalid]
flow:
  - action: Old action.
    artifact: !artifact
      name: result
      format: string
`, /flow/],
  ["untagged Artifact", `!procedure
names: [invalid]
flow:
  - !action
    action: Old artifact.
    artifact:
      name: result
      format: string
`, /artifact/],
  ["int artifact format", `!procedure
names: [invalid]
flow:
  - !action
    action: Old number.
    artifact: !artifact
      name: result
      format: int
`, /format/],
  ["elseif array", `!procedure
names: [invalid]
flow:
  - !if
    condition: !action
      action: Check A.
      artifact: !artifact
        name: A
        format: boolean
    then:
      - !action
        action: Handle A.
        artifact: !artifact
          name: A result
          format: string
    elseif:
      - !if
        condition: !action
          action: Check B.
          artifact: !artifact
            name: B
            format: boolean
        then:
          - !action
            action: Handle B.
            artifact: !artifact
              name: B result
              format: string
`, /elseif/],
  ["else on nested elseif", `!procedure
names: [invalid]
flow:
  - !if
    condition: !action
      action: Check A.
      artifact: !artifact
        name: A
        format: boolean
    then:
      - !action
        action: Handle A.
        artifact: !artifact
          name: A result
          format: string
    elseif: !if
      condition: !action
        action: Check B.
        artifact: !artifact
          name: B
          format: boolean
      then:
        - !action
          action: Handle B.
          artifact: !artifact
            name: B result
            format: string
      else:
        - !action
          action: Nested fallback.
          artifact: !artifact
            name: fallback
            format: string
`, /else is only allowed/],
  ["non-boolean condition", `!procedure
names: [invalid]
flow:
  - !while
    condition: !action
      action: Check.
      artifact: !artifact
        name: result
        format: string
    do:
      - !action
        action: Repeat.
        artifact: !artifact
          name: repeated
          format: string
`, /boolean/],
  ["empty branch", `!procedure
names: [invalid]
flow:
  - !if
    condition: !action
      action: Check.
      artifact: !artifact
        name: result
        format: boolean
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
format: outline
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

test("Schema format defaults to outline and accepts explicit outline", () => {
  assert.deepEqual(schemaFormats, ["outline", "table"]);
  assert.equal(parseSchema(`!schema
names: [default-outline]
fields: [summary]
`).format, undefined);
  assert.equal(parseSchema(`!schema
names: [explicit-outline]
format: outline
fields: [summary]
`).format, "outline");
});

test("format is rejected on memory types without format implementations", () => {
  assert.throws(() => conceptMemorySchema.parse(parseMemoryYaml(`!concept
names: [invalid]
format: outline
`)), /format/);
});

test("table Schema requires List<Schema> element_types and non-empty fields", () => {
  const table = parseSchema(`!schema
names: [requirements]
format: table
element_types: [Schema]
fields: [id, description]
`);
  assert.deepEqual(table.element_types, ["Schema"]);

  assert.throws(() => parseSchema(`!schema
names: [invalid-table]
format: table
fields: [id]
`), /element_types: \[Schema\]/);
  assert.throws(() => parseSchema(`!schema
names: [invalid-table]
format: table
element_types: [Schema]
fields: []
`), /at least one field/);
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
