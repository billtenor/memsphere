import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ArtifactValidationFailure,
  ArtifactValidatorRegistry,
  compileArtifactContract,
  createBuiltInArtifactValidatorRegistry,
  prepareArtifactCandidate,
  type ArtifactValidationContext
} from "../src/artifact-validation.js";
import { artifactNodeSchema } from "../src/memory/schema.js";

const context: ArtifactValidationContext = {
  runId: "run-test",
  stepId: "flow[1]",
  artifactPath: "flow[1].artifact",
  attemptId: "attempt-1"
};

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

test("JSON and YAML schema validation checks nested objects and array element types", async () => {
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
  assert.equal(objectResult.issues[0]?.code, "artifact.schema.object.expected_object");
  assert.equal(objectResult.issues[0]?.fieldPath, "owner");

  const arrayContract = compileArtifactContract(artifactNodeSchema.parse({
    tag: "!artifact",
    name: "rows",
    type: "array",
    format: "json",
    schema: { tag: "!schema", names: [], defines: [], element_types: ["string"] }
  }));
  const invalidArray = await prepareArtifactCandidate(arrayContract, { kind: "inline", value: '["ok", 2]' }, context);
  const arrayResult = await registry.execute(registry.resolvePlan(arrayContract), { contract: arrayContract, candidate: invalidArray, context });
  assert.equal(arrayResult.status, "failed");
  assert.equal(arrayResult.issues[0]?.code, "artifact.schema.array.invalid_element_type");
  assert.equal(arrayResult.issues[0]?.fieldPath, "[1]");
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
      element_types: ["Schema"],
      fields: ["ID", "Summary"]
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
