import assert from "node:assert/strict";
import test from "node:test";
import type { StatementNode } from "../src/memory/ast.js";
import {
  flattenEffectiveRules,
  resolveRuleParts,
  RuleResolutionError
} from "../src/memory/rules.js";

function statement(input: Partial<StatementNode>): StatementNode {
  return {
    tag: "!statement",
    names: input.names ?? ["fixture"],
    defines: input.defines ?? [],
    ...input
  };
}

test("rule resolver projects only the selected channel and preserves section hierarchy", async () => {
  const memories: Record<string, StatementNode> = {
    "statements/release-rules": statement({
      names: ["release-rules"],
      asserts: ["Record the version."],
      suggests: ["Prefer a short summary."],
      sections: [statement({
        names: ["Security"],
        defines: ["Checks for production security."],
        asserts: ["Describe security risk."],
        suggests: ["Link the security review."]
      })]
    })
  };

  const tree = await resolveRuleParts(
    "asserts",
    ["Record the owner.", { tag: "!ref", target: "statements/release-rules" }],
    async (target) => memories[target]
  );

  assert.deepEqual(flattenEffectiveRules(tree).map((rule) => rule.text), [
    "Record the owner.",
    "Record the version.",
    "Describe security risk."
  ]);
  const reference = tree.entries[1];
  assert.equal(reference.kind, "reference");
  if (reference.kind !== "reference") return;
  assert.equal(reference.target, "statements/release-rules");
  assert.equal(reference.sections[0].name, "Security");
  assert.deepEqual(reference.sections[0].defines, ["Checks for production security."]);
});

test("rule resolver keeps nested references in place and deduplicates diamond rules", async () => {
  const memories: Record<string, StatementNode> = {
    "statements/shared": statement({ names: ["shared"], asserts: ["Shared rule."] }),
    "statements/left": statement({
      names: ["left"],
      asserts: [{ tag: "!ref", target: "statements/shared" }]
    }),
    "statements/right": statement({
      names: ["right"],
      asserts: [{ tag: "!ref", target: "statements/shared" }]
    })
  };

  const tree = await resolveRuleParts("asserts", [
    { tag: "!ref", target: "statements/left" },
    { tag: "!ref", target: "statements/right" }
  ], async (target) => memories[target]);

  assert.deepEqual(flattenEffectiveRules(tree).map((rule) => rule.text), ["Shared rule."]);
  assert.equal(tree.entries[0].kind, "reference");
  assert.equal(tree.entries.length, 1);
});

test("rule resolver rejects empty projections, wrong kinds, and same-channel cycles", async () => {
  const memories: Record<string, StatementNode> = {
    "statements/advice": statement({ names: ["advice"], suggests: ["Prefer clarity."] }),
    "statements/a": statement({ names: ["a"], asserts: [{ tag: "!ref", target: "statements/b" }] }),
    "statements/b": statement({ names: ["b"], asserts: [{ tag: "!ref", target: "statements/a" }] })
  };
  const lookup = async (target: string) => memories[target];

  await assert.rejects(
    resolveRuleParts("asserts", [{ tag: "!ref", target: "statements/advice" }], lookup),
    (error: unknown) => error instanceof RuleResolutionError && /no effective asserts/.test(error.message)
  );
  await assert.rejects(
    resolveRuleParts("asserts", [{ tag: "!ref", target: "schemas/advice" }], lookup),
    /must identify a Statement/
  );
  await assert.rejects(
    resolveRuleParts("asserts", [{ tag: "!ref", target: "statements/a" }], lookup),
    /statements\/a\.asserts -> statements\/b\.asserts -> statements\/a\.asserts/
  );
});

test("assert and suggest graphs do not traverse across channels", async () => {
  const memories: Record<string, StatementNode> = {
    "statements/a": statement({
      names: ["a"],
      asserts: ["A assertion."],
      suggests: [{ tag: "!ref", target: "statements/b" }]
    }),
    "statements/b": statement({
      names: ["b"],
      asserts: [{ tag: "!ref", target: "statements/a" }],
      suggests: ["B suggestion."]
    })
  };

  const asserts = await resolveRuleParts(
    "asserts",
    [{ tag: "!ref", target: "statements/b" }],
    async (target) => memories[target]
  );
  assert.deepEqual(flattenEffectiveRules(asserts).map((rule) => rule.text), ["A assertion."]);
});
