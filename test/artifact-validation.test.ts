import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  ArtifactValidationFailure,
  ArtifactValidatorRegistry,
  compileArtifactContract,
  createBuiltInArtifactValidatorRegistry,
  prepareArtifactCandidate,
  type ArtifactValidationContext
} from "../src/artifact-validation.js";
import type { SchemaNode } from "../src/memory/ast.js";
import { artifactNodeSchema } from "../src/memory/schema.js";
import { readMemoryFile } from "../src/memory/store.js";

const context: ArtifactValidationContext = {
  runId: "run-test",
  stepId: "flow[1]",
  artifactPath: "flow[1].artifact",
  attemptId: "attempt-1"
};

function markdownTableColumnPaths(schema: SchemaNode, path = "schema"): string[] {
  const paths: string[] = [];
  for (const [index, field] of (schema.fields ?? []).entries()) {
    if (typeof field === "string") continue;
    if (field.tag === "!repeat") {
      for (const [bodyIndex, bodyField] of field.body.entries()) {
        if (typeof bodyField !== "string") paths.push(...markdownTableColumnPaths(bodyField, `${path}.fields[${index}].body[${bodyIndex}]`));
      }
      continue;
    }
    const fieldPath = `${path}.fields[${index}]`;
    paths.push(...markdownTableColumnPaths(field, fieldPath));
  }
  if (schema.item) {
    if (schema.type === "array" && schema.format?.name === "markdown" && schema.format.options.layout === "table") {
      paths.push(...(schema.item.fields ?? []).map((_column, columnIndex) => `${path}.item.fields[${columnIndex}]`));
    }
    paths.push(...markdownTableColumnPaths(schema.item, `${path}.item`));
  }
  for (const [index, item] of (schema.items ?? []).entries()) {
    if (schema.type === "array" && schema.format?.name === "markdown" && schema.format.options.layout === "table") {
      paths.push(...(item.fields ?? []).map((_column, columnIndex) => `${path}.items[${index}].fields[${columnIndex}]`));
    }
    paths.push(...markdownTableColumnPaths(item, `${path}.items[${index}]`));
  }
  return paths;
}

test("Artifact v2 defaults omitted type and format to normalized string and plain", () => {
  const artifact = artifactNodeSchema.parse({
    tag: "!artifact",
    name: "result"
  });
  assert.equal(artifact.type, "string");
  assert.deepEqual(artifact.format, { name: "plain", options: {} });
  assert.throws(() => artifactNodeSchema.parse({
    tag: "!artifact",
    name: "result",
    type: "string",
    format: {}
  }), /name/);
  assert.throws(() => artifactNodeSchema.parse({
    tag: "!artifact",
    name: "result",
    type: "object"
  }), /does not support format plain/);
});

test("Registry resolves stage and target without validator traversal", () => {
  const registry = new ArtifactValidatorRegistry();
  const validator = { validate: () => ({ status: "passed" as const, correctable: false, issues: [] }) };
  registry.register({ id: "test.type.string", version: "1", stage: "type", target: "string", validator });
  assert.equal(registry.resolve("type", "string")[0]?.validator, validator);
  assert.deepEqual(registry.resolve("type", "boolean"), []);
  assert.throws(() => registry.register({ id: "test.type.string", version: "1", stage: "type", target: "boolean", validator }), /Duplicate/);
});

test("built-in validation narrows plain and structured representations", async () => {
  const registry = createBuiltInArtifactValidatorRegistry();
  const booleanContract = compileArtifactContract(artifactNodeSchema.parse({
    tag: "!artifact",
    name: "condition",
    type: "boolean"
  }));
  const candidate = await prepareArtifactCandidate(booleanContract, { kind: "inline", value: "true" }, context);
  assert.equal(candidate.representation.kind, "plain");
  assert.equal(candidate.representation.value, true);
  assert.equal((await registry.execute(registry.resolvePlan(booleanContract), { contract: booleanContract, candidate, context })).status, "passed");

  const invalid = await prepareArtifactCandidate(booleanContract, { kind: "inline", value: "maybe" }, context);
  const result = await registry.execute(registry.resolvePlan(booleanContract), { contract: booleanContract, candidate: invalid, context });
  assert.equal(result.status, "failed");
  assert.equal(result.issues[0]?.code, "artifact.type.expected_boolean");
});

test("schema validators report stable field paths", async () => {
  const registry = createBuiltInArtifactValidatorRegistry();
  const contract = compileArtifactContract(artifactNodeSchema.parse({
    tag: "!artifact",
    name: "release",
    type: "object",
    format: "json",
    schema: {
      tag: "!schema",
      names: [],
      defines: [],
      fields: ["version", "date"]
    }
  }));
  const candidate = await prepareArtifactCandidate(contract, { kind: "inline", value: '{"version":"1.0"}' }, context);
  const result = await registry.execute(registry.resolvePlan(contract), { contract, candidate, context });
  assert.equal(result.status, "failed");
  assert.equal(result.issues[0]?.code, "artifact.schema.object.missing_field");
  assert.equal(result.issues[0]?.fieldPath, "date");
});

test("schema optional fields may be omitted across object, outline, and table formats", async () => {
  const registry = createBuiltInArtifactValidatorRegistry();
  const objectContract = compileArtifactContract(artifactNodeSchema.parse({
    tag: "!artifact",
    name: "release",
    type: "object",
    format: "json",
    schema: {
      tag: "!schema",
      names: [],
      defines: [],
      fields: [
        "version",
        { tag: "!schema", names: ["notes"], defines: [], optional: true }
      ]
    }
  }));
  const objectCandidate = await prepareArtifactCandidate(objectContract, { kind: "inline", value: '{"version":"1.0"}' }, context);
  assert.equal((await registry.execute(registry.resolvePlan(objectContract), { contract: objectContract, candidate: objectCandidate, context })).status, "passed");

  const outlineContract = compileArtifactContract(artifactNodeSchema.parse({
    tag: "!artifact",
    name: "doc",
    type: "object",
    format: { name: "markdown", layout: "outline" },
    schema: {
      tag: "!schema",
      names: [],
      defines: [],
      type: "object",
      format: { name: "markdown", layout: "outline" },
      fields: [
        "Title",
        { tag: "!schema", names: ["Notes"], defines: [], optional: true }
      ]
    }
  }));
  const outlineCandidate = await prepareArtifactCandidate(outlineContract, { kind: "inline", value: "## Title\nDone\n" }, context);
  assert.equal((await registry.execute(registry.resolvePlan(outlineContract), { contract: outlineContract, candidate: outlineCandidate, context })).status, "passed");

  const tableContract = compileArtifactContract(artifactNodeSchema.parse({
    tag: "!artifact",
    name: "rows",
    type: "array",
    format: { name: "markdown", layout: "table" },
    schema: {
      tag: "!schema",
      names: [],
      defines: [],
      type: "array",
      format: { name: "markdown", layout: "table" },
      item: {
        tag: "!schema",
        names: [],
        defines: [],
        type: "object",
        fields: [
          "ID",
          { tag: "!schema", names: ["Notes"], defines: [], optional: true }
        ]
      }
    }
  }));
  const tableCandidate = await prepareArtifactCandidate(tableContract, {
    kind: "inline",
    value: "| ID |\n| --- |\n| 1 |\n"
  }, context);
  assert.equal((await registry.execute(registry.resolvePlan(tableContract), { contract: tableContract, candidate: tableCandidate, context })).status, "passed");
});

test("decoder failures are format issues", async () => {
  const contract = compileArtifactContract(artifactNodeSchema.parse({
    tag: "!artifact",
    name: "payload",
    type: "object",
    format: "json"
  }));
  await assert.rejects(
    prepareArtifactCandidate(contract, { kind: "inline", value: "{" }, context),
    (error: unknown) => error instanceof ArtifactValidationFailure && error.result.issues[0]?.code === "artifact.format.decode_failed"
  );
});

test("nested JSON and YAML decoder failures are format issues", async () => {
  const registry = createBuiltInArtifactValidatorRegistry();
  for (const format of ["json", "yaml"] as const) {
    const contract = compileArtifactContract(artifactNodeSchema.parse({
      tag: "!artifact",
      name: "payload",
      type: "object",
      format,
      schema: {
        tag: "!schema",
        names: [],
        defines: [],
        fields: [{
          tag: "!schema",
          names: ["nested"],
          defines: [],
          type: "string",
          format
        }]
      }
    }));
    const source = format === "json"
      ? '{"nested":"not-json"}'
      : "nested: '[unterminated'\n";
    const candidate = await prepareArtifactCandidate(contract, { kind: "inline", value: source }, context);
    const result = await registry.execute(registry.resolvePlan(contract), { contract, candidate, context });
    assert.equal(result.status, "failed");
    assert.equal(result.issues[0]?.code, "artifact.format.decode_failed");
    assert.equal(result.issues[0]?.fieldPath, "nested");
  }
});

test("JSON and YAML schema validation inherits contracts and validates shorthand leaf types", async () => {
  const registry = createBuiltInArtifactValidatorRegistry();
  const objectContract = compileArtifactContract(artifactNodeSchema.parse({
    tag: "!artifact",
    name: "payload",
    type: "object",
    format: "yaml",
    schema: {
      tag: "!schema",
      names: [],
      defines: [],
      fields: [{ tag: "!schema", names: ["owner"], defines: [], fields: ["name"] }]
    }
  }));
  const invalidObject = await prepareArtifactCandidate(objectContract, { kind: "inline", value: "owner: nobody\n" }, context);
  const objectResult = await registry.execute(registry.resolvePlan(objectContract), { contract: objectContract, candidate: invalidObject, context });
  assert.equal(objectResult.status, "failed");
  assert.equal(objectResult.issues[0]?.code, "artifact.type.expected_object");
  assert.equal(objectResult.issues[0]?.fieldPath, "owner");

  const invalidLeaf = await prepareArtifactCandidate(objectContract, {
    kind: "inline",
    value: await readFile(new URL("./fixtures/schema-contract-validation/recursive-invalid.yaml", import.meta.url), "utf8")
  }, context);
  const leafResult = await registry.execute(registry.resolvePlan(objectContract), { contract: objectContract, candidate: invalidLeaf, context });
  assert.equal(leafResult.status, "failed");
  assert.equal(leafResult.issues[0]?.code, "artifact.type.expected_string");
  assert.equal(leafResult.issues[0]?.fieldPath, "owner.name");

  const validObject = await prepareArtifactCandidate(objectContract, {
    kind: "inline",
    value: await readFile(new URL("./fixtures/schema-contract-validation/recursive-valid.yaml", import.meta.url), "utf8")
  }, context);
  assert.equal((await registry.execute(registry.resolvePlan(objectContract), {
    contract: objectContract,
    candidate: validObject,
    context
  })).status, "passed");

  const arrayContract = compileArtifactContract(artifactNodeSchema.parse({
    tag: "!artifact",
    name: "rows",
    type: "array",
    format: "json",
    schema: { tag: "!schema", names: [], defines: [], type: "array", format: "json" }
  }));
  const mixedArray = await prepareArtifactCandidate(arrayContract, { kind: "inline", value: '["ok", 2, {"value":true}]' }, context);
  const arrayResult = await registry.execute(registry.resolvePlan(arrayContract), { contract: arrayContract, candidate: mixedArray, context });
  assert.equal(arrayResult.status, "passed");
});

test("array item and items recursively validate single and union element contracts", async () => {
  const registry = createBuiltInArtifactValidatorRegistry();
  const single = compileArtifactContract(artifactNodeSchema.parse({
    tag: "!artifact",
    name: "strings",
    type: "array",
    format: "json",
    schema: {
      tag: "!schema",
      names: [],
      defines: [],
      type: "array",
      item: { tag: "!schema", names: [], defines: [], type: "string" }
    }
  }));
  const invalidSingle = await prepareArtifactCandidate(single, { kind: "inline", value: '["ok", 2]' }, context);
  const singleResult = await registry.execute(registry.resolvePlan(single), { contract: single, candidate: invalidSingle, context });
  assert.equal(singleResult.status, "failed");
  assert.equal(singleResult.issues[0]?.code, "artifact.type.expected_string");
  assert.equal(singleResult.issues[0]?.fieldPath, "[1]");

  const union = compileArtifactContract(artifactNodeSchema.parse({
    tag: "!artifact",
    name: "mixed",
    type: "array",
    format: "yaml",
    schema: {
      tag: "!schema",
      names: [],
      defines: [],
      type: "array",
      items: [
        { tag: "!schema", names: [], defines: [], type: "string" },
        { tag: "!schema", names: [], defines: [], type: "number" }
      ]
    }
  }));
  const validUnion = await prepareArtifactCandidate(union, { kind: "inline", value: "- one\n- 2\n" }, context);
  assert.equal((await registry.execute(registry.resolvePlan(union), {
    contract: union,
    candidate: validUnion,
    context
  })).status, "passed");

  const invalidUnion = await prepareArtifactCandidate(union, { kind: "inline", value: "- true\n" }, context);
  const unionResult = await registry.execute(registry.resolvePlan(union), { contract: union, candidate: invalidUnion, context });
  assert.equal(unionResult.status, "failed");
  assert.equal(unionResult.issues[0]?.code, "artifact.schema.array.no_matching_item");
  assert.equal(unionResult.issues[0]?.fieldPath, "[0]");
});

test("Markdown table decoding validates columns and row objects", async () => {
  const registry = createBuiltInArtifactValidatorRegistry();
  const contract = compileArtifactContract(artifactNodeSchema.parse({
    tag: "!artifact",
    name: "requirements",
    type: "array",
    format: { name: "markdown", layout: "table" },
    schema: {
      tag: "!schema",
      names: [],
      defines: [],
      type: "array",
      item: {
        tag: "!schema",
        names: [],
        defines: [],
        type: "object",
        fields: [{ tag: "!schema", names: ["ID", "Identifier"], defines: [] }, "Summary"]
      }
    }
  }));
  const valid = await prepareArtifactCandidate(contract, {
    kind: "inline",
    value: "| ID | Summary |\n| --- | --- |\n| R1 | First |\n"
  }, context);
  assert.deepEqual(valid.representation.value, [{ ID: "R1", Summary: "First" }]);
  assert.equal((await registry.execute(registry.resolvePlan(contract), { contract, candidate: valid, context })).status, "passed");

  const invalid = await prepareArtifactCandidate(contract, {
    kind: "inline",
    value: "| ID |\n| --- |\n| R1 |\n"
  }, context);
  const result = await registry.execute(registry.resolvePlan(contract), { contract, candidate: invalid, context });
  assert.equal(result.status, "failed");
  assert.equal(result.issues[0]?.code, "artifact.schema.markdown_table.missing_column");
  assert.equal(result.issues[0]?.fieldPath, "Summary");
});

test("ValidationPlan snapshots inherited and local Schema contracts by path", () => {
  const registry = createBuiltInArtifactValidatorRegistry();
  const contract = compileArtifactContract(artifactNodeSchema.parse({
    tag: "!artifact",
    name: "document",
    type: "object",
    format: { name: "markdown", layout: "outline" },
    schema: {
      tag: "!schema",
      names: [],
      defines: [],
      fields: [
        {
          tag: "!schema",
          names: ["Overview"],
          defines: [],
          fields: ["Summary"]
        },
        {
          tag: "!schema",
          names: ["Requirements"],
          defines: [],
          type: "array",
          format: { name: "markdown", layout: "table" },
          item: { tag: "!schema", names: [], defines: [], type: "object", fields: ["ID", "Description"] }
        }
      ]
    }
  }));

  const plan = registry.resolvePlan(contract);
  const targets = plan.map((entry) => `${entry.contractPath}:${entry.stage}:${entry.target}`);
  assert(targets.includes("artifact:type:object"));
  assert(targets.includes("schema:schema:markdown:outline"));
  assert(targets.includes("schema.fields[0]:type:object"));
  assert(targets.includes("schema.fields[0].fields[0]:type:string"));
  assert(targets.includes("schema.fields[0].fields[0]:format:markdown"));
  assert(targets.includes("schema.fields[1]:type:array"));
  assert(targets.includes("schema.fields[1]:schema:markdown:table"));
  assert(targets.includes("schema.fields[1].item.fields[0]:type:string"));
  assert(targets.includes("schema.fields[1].item.fields[0]:format:markdown"));
});

test("Markdown outline validates a table only inside its child heading subtree", async () => {
  const registry = createBuiltInArtifactValidatorRegistry();
  const contract = compileArtifactContract(artifactNodeSchema.parse({
    tag: "!artifact",
    name: "document",
    type: "object",
    format: { name: "markdown", layout: "outline" },
    schema: {
      tag: "!schema",
      names: [],
      defines: [],
      fields: [
        "Overview",
        {
          tag: "!schema",
          names: ["Requirements"],
          defines: [],
          type: "array",
          format: { name: "markdown", layout: "table" },
          item: { tag: "!schema", names: [], defines: [], type: "object", fields: ["ID", "Summary"] }
        }
      ]
    }
  }));

  const valid = await prepareArtifactCandidate(contract, {
    kind: "inline",
    value: await readFile(new URL("./fixtures/schema-contract-validation/mixed-outline-valid.md", import.meta.url), "utf8")
  }, context);
  assert.equal((await registry.execute(registry.resolvePlan(contract), { contract, candidate: valid, context })).status, "passed");

  const wrongSubtree = await prepareArtifactCandidate(contract, {
    kind: "inline",
    value: await readFile(new URL("./fixtures/schema-contract-validation/mixed-outline-wrong-subtree.md", import.meta.url), "utf8")
  }, context);
  const result = await registry.execute(registry.resolvePlan(contract), { contract, candidate: wrongSubtree, context });
  assert.equal(result.status, "failed");
  assert.equal(result.issues[0]?.code, "artifact.schema.markdown_table.missing_table");
  assert.equal(result.issues[0]?.fieldPath, "Requirements");
});

test("structured parents re-decode fields that establish a local format contract", async () => {
  const registry = createBuiltInArtifactValidatorRegistry();
  const contract = compileArtifactContract(artifactNodeSchema.parse({
    tag: "!artifact",
    name: "document",
    type: "object",
    format: "yaml",
    schema: {
      tag: "!schema",
      names: [],
      defines: [],
      fields: [{
        tag: "!schema",
        names: ["requirements"],
        defines: [],
        type: "array",
        format: { name: "markdown", layout: "table" },
        item: { tag: "!schema", names: [], defines: [], type: "object", fields: ["ID", "Summary"] }
      }]
    }
  }));
  const candidate = await prepareArtifactCandidate(contract, {
    kind: "inline",
    value: "requirements: |\n  | ID | Summary |\n  | --- | --- |\n  | R-1 | First |\n"
  }, context);
  const result = await registry.execute(registry.resolvePlan(contract), { contract, candidate, context });
  assert.equal(result.status, "passed");
});

test("recursive validator infrastructure failures preserve contract and field paths", async () => {
  const registry = createBuiltInArtifactValidatorRegistry();
  registry.register({
    id: "test.type.string.failure",
    version: "1",
    stage: "type",
    target: "string",
    validator: { validate: () => { throw new Error("boom"); } }
  });
  const contract = compileArtifactContract(artifactNodeSchema.parse({
    tag: "!artifact",
    name: "document",
    type: "object",
    format: "yaml",
    schema: {
      tag: "!schema",
      names: [],
      defines: [],
      fields: ["child"]
    }
  }));
  const candidate = await prepareArtifactCandidate(contract, {
    kind: "inline",
    value: "child: value\n"
  }, context);
  const result = await registry.execute(registry.resolvePlan(contract), { contract, candidate, context });

  assert.equal(result.status, "failed");
  assert.equal(result.issues[0]?.code, "artifact.validator.error");
  assert.equal(result.issues[0]?.contractPath, "schema.fields[0].type");
  assert.equal(result.issues[0]?.fieldPath, "child");
});

test("recursive custom validation failures inherit missing context paths", async () => {
  const registry = createBuiltInArtifactValidatorRegistry();
  registry.register({
    id: "test.type.string.failed",
    version: "1",
    stage: "type",
    target: "string",
    validator: {
      validate: (request) => ({
        status: "failed",
        correctable: true,
        issues: [{
          code: "test.string.rejected",
          stage: "type",
          validatorId: "test.type.string.failed",
          artifactPath: request.context.artifactPath,
          message: "rejected"
        }]
      })
    }
  });
  const contract = compileArtifactContract(artifactNodeSchema.parse({
    tag: "!artifact",
    name: "document",
    type: "object",
    format: "yaml",
    schema: { tag: "!schema", names: [], defines: [], fields: ["child"] }
  }));
  const candidate = await prepareArtifactCandidate(contract, { kind: "inline", value: "child: value\n" }, context);
  const result = await registry.execute(registry.resolvePlan(contract), { contract, candidate, context });

  assert.equal(result.status, "failed");
  assert.equal(result.issues[0]?.contractPath, "schema.fields[0].type");
  assert.equal(result.issues[0]?.fieldPath, "child");
});

test("recursive unsupported validator plans preserve contract and field paths", async () => {
  const registry = createBuiltInArtifactValidatorRegistry();
  const contract = compileArtifactContract(artifactNodeSchema.parse({
    tag: "!artifact",
    name: "document",
    type: "object",
    format: "yaml",
    schema: { tag: "!schema", names: [], defines: [], fields: ["child"] }
  }));
  const candidate = await prepareArtifactCandidate(contract, { kind: "inline", value: "child: value\n" }, context);
  const plan = registry.resolvePlan(contract).map((entry) =>
    entry.contractPath === "schema.fields[0]" && entry.stage === "format"
      ? { ...entry, version: "missing" }
      : entry
  );
  const result = await registry.execute(plan, { contract, candidate, context });

  assert.equal(result.status, "unsupported");
  assert.equal(result.issues[0]?.contractPath, "schema.fields[0].format");
  assert.equal(result.issues[0]?.fieldPath, "child");
});

test("real CRAA requirements and test Schema Artifacts pass recursive validation", async (t) => {
  const registry = createBuiltInArtifactValidatorRegistry();

  for (const name of ["craa-spec-driven-requirements", "craa-spec-driven-test"] as const) {
    await t.test(name, async () => {
      const schemaPath = fileURLToPath(new URL(`../.memsphere/memory/schemas/${name}.yaml`, import.meta.url));
      const artifactPath = fileURLToPath(new URL(`./fixtures/schema-contract-validation/${name}-valid.md`, import.meta.url));
      const schemaFile = await readMemoryFile("schemas", schemaPath);
      assert.equal(schemaFile.entity.tag, "!schema");
      if (schemaFile.entity.tag !== "!schema") return;
      const contract = compileArtifactContract({
        tag: "!artifact",
        name,
        type: "object",
        format: { name: "markdown", options: { layout: "outline" } },
        schema: schemaFile.entity
      });
      const candidate = await prepareArtifactCandidate(contract, { kind: "file", path: artifactPath }, {
        ...context,
        artifactPath
      });
      const result = await registry.execute(registry.resolvePlan(contract), {
        contract,
        candidate,
        context: { ...context, artifactPath }
      });

      assert.equal(result.status, "passed", JSON.stringify(result.issues, null, 2));
      const plan = registry.resolvePlan(contract);
      const columns = markdownTableColumnPaths(schemaFile.entity);
      assert(columns.length > 0);
      for (const columnPath of columns) {
        assert(plan.some((entry) => entry.contractPath === columnPath && entry.stage === "type" && entry.target === "string"));
        assert(plan.some((entry) => entry.contractPath === columnPath && entry.stage === "format" && entry.target === "markdown"));
      }
    });
  }
});
