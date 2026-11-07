import assert from "node:assert/strict";
import test from "node:test";
import { memoryKinds } from "../src/memory/kinds.js";
import { parseMemoryEntity } from "../src/memory/store.js";
import { currentMemorySyntax, firstStableMemorySyntax, MemorySyntaxRegistry, readMemorySyntax, startMemorySyntax } from "../src/memory/syntax.js";
import { parseMemoryYaml } from "../src/memory/yaml.js";
import { canMigrateMemorySyntax } from "../src/migration/memory-syntax-path.js";


test("Memory syntax defaults to start and formal versions use immutable identifiers", () => {
  assert.equal(readMemorySyntax({ tag: "!concept" }), startMemorySyntax);
  assert.equal(readMemorySyntax({ syntax: currentMemorySyntax }), currentMemorySyntax);
  assert.throws(() => readMemorySyntax({ syntax: 1 }), /must be a string/);
  assert.throws(() => readMemorySyntax({ syntax: "v1" }), /memsphere-YYYYMMDD/);
  assert.throws(() => readMemorySyntax({ syntax: "memsphere-20260230-stable" }), /memsphere-YYYYMMDD/);
});


test("Memory syntax migration availability comes from the migration graph", () => {
  assert.equal(canMigrateMemorySyntax(startMemorySyntax, currentMemorySyntax), true);
  assert.equal(canMigrateMemorySyntax(firstStableMemorySyntax, currentMemorySyntax), true);
  assert.equal(canMigrateMemorySyntax(currentMemorySyntax, currentMemorySyntax), false);
  assert.equal(canMigrateMemorySyntax("memsphere-20990101-stable", currentMemorySyntax), false);
});


test("Memory syntax dispatch accepts registered stable versions and rejects nested syntax fields", () => {
  const current = parseMemoryEntity("concepts", parseMemoryYaml(`!concept
syntax: ${currentMemorySyntax}
name: current
defines: [Current syntax.]
`));
  assert.equal(current.syntax, currentMemorySyntax);

  const previous = parseMemoryEntity("concepts", parseMemoryYaml(`!concept
syntax: ${firstStableMemorySyntax}
name: previous
defines: [Previous stable syntax remains executable.]
`));
  assert.equal(previous.syntax, firstStableMemorySyntax);

  assert.throws(() => parseMemoryEntity("concepts", parseMemoryYaml(`!concept
name: legacy
defines: [Legacy syntax.]
`)), /Unsupported Memory syntax start/);

  assert.throws(() => parseMemoryEntity("concepts", parseMemoryYaml(`!concept
syntax: memsphere-20990101-stable
name: future
defines: [Future syntax.]
`)), /Unsupported Memory syntax/);

  assert.throws(() => parseMemoryEntity("statements", parseMemoryYaml(`!statement
syntax: ${currentMemorySyntax}
name: root
sections:
  - !statement
    syntax: ${currentMemorySyntax}
    name: Nested
    asserts: [Nested rule.]
`)), /Unrecognized key.*syntax/);
});


test("current syntax declares Review Slots and rejects removed governance fields", () => {
  const parsed = parseMemoryEntity("procedures", parseMemoryYaml(`!procedure
syntax: ${currentMemorySyntax}
name: governed
flow:
  - !action
    action: Produce an Artifact.
    artifact: !artifact
      name: result
      review: [human_reviewer, agent_reviewer]
`));
  assert.equal(parsed.tag, "!procedure");
  if (parsed.tag !== "!procedure") return;
  const action = parsed.flow[0];
  assert.equal(action.tag, "!action");
  if (action.tag !== "!action") return;
  assert.deepEqual(action.artifact.review, ["human_reviewer", "agent_reviewer"]);

  assert.throws(() => parseMemoryEntity("procedures", parseMemoryYaml(`!procedure
syntax: ${firstStableMemorySyntax}
name: old-governed
role_bindings: { reviewer: human }
flow: []
`)), /Unrecognized key.*role_bindings/);

  assert.throws(() => parseMemoryEntity("procedures", parseMemoryYaml(`!procedure
syntax: ${firstStableMemorySyntax}
name: invalid-old-governance
flow:
  - !action
    action: Produce.
    artifact: !artifact
      name: result
      permission_grants: { runner: [decision.decide] }
`)), /Unrecognized key.*permission_grants/);

  assert.throws(() => parseMemoryEntity("procedures", parseMemoryYaml(`!procedure
syntax: ${currentMemorySyntax}
name: invalid-review
flow:
  - !action
    action: Produce.
    artifact: !artifact
      name: result
      review: reviewer
`)), /Expected array/);

  assert.throws(() => parseMemoryEntity("procedures", parseMemoryYaml(`!procedure
syntax: ${currentMemorySyntax}
name: misplaced
flow:
  - !action
    action: Invalid placement.
    role_bindings: { reviewer: human }
    artifact: !artifact { name: result }
`)), /Unrecognized key.*role_bindings/);

  for (const removed of ["review_role: implementation", "review_requires: [implementation]"]) {
    assert.throws(() => parseMemoryEntity("procedures", parseMemoryYaml(`!procedure
syntax: ${currentMemorySyntax}
name: removed-artifact-review-field
flow:
  - !action
    action: Produce.
    artifact: !artifact
      name: result
      ${removed}
`)), /Unrecognized key.*review_/);
  }

});


test("Memory syntax registries reject duplicate definitions", () => {
  const registry = new MemorySyntaxRegistry();
  const schemas = Object.fromEntries(memoryKinds.map((kind) => [kind, {}])) as never;
  registry.register({ version: startMemorySyntax, schemas });
  assert.throws(() => registry.register({ version: startMemorySyntax, schemas }), /Duplicate/);
  assert.throws(() => registry.require("memsphere-20990101-stable"), /Unsupported Memory syntax/);
});
