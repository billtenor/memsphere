import assert from "node:assert/strict";



import { test } from "node:test";

import { ArtifactValidatorRegistry, type ArtifactValidationContext } from "../src/artifact-validation.js";

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
