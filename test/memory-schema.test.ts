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
  }
  assert.equal(entity.defines[2].tag, "!schema");
  assert.equal(entity.fields?.[0], "simple");
  assert.equal(entity.fields?.[1].tag, "!schema");
});

test("Statement supports optional suggestions without weakening assertions", () => {
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
  assert.deepEqual(withoutSuggestions.suggests, []);

  assert.throws(() => parseStatement(`!statement
names: [invalid]
asserts: [A required rule.]
suggests: [1]
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
