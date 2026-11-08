import assert from "node:assert/strict";
import test from "node:test";
import { memoryDiffPlan } from "../modules/org.memsphere.memory/adapter/view/memory-diff.js";
const action = (action: string) => ({ tag: "!action", action });
test("inserting a step preserves the original unchanged steps' paired paths", () => {
  const plan = memoryDiffPlan({ flow: [action("A"), action("B")] }, { flow: [action("X"), action("A"), action("B")] }, "procedure");
  assert.deepEqual(plan.changes, [{ afterPath: "procedure.flow[1]", whole: true }]);
  assert.equal(plan.matches.get("procedure.flow[1].action"), "procedure.flow[2].action");
  assert.equal(plan.matches.get("procedure.flow[2]"), "procedure.flow[3]");
});
test("replacing a control node compares the entire structure, including the old condition", () => {
  const plan = memoryDiffPlan({ flow: [{ tag: "!if", condition: action("Decide"), then: [action("Submit")] }] }, { flow: [action("Submit directly")] }, "procedure");
  assert.deepEqual(plan.changes, [{ beforePath: "procedure.flow[1]", afterPath: "procedure.flow[1]", whole: true }]);
});
test("duplicate rules retain ordered matches when one occurrence is removed", () => {
  const plan = memoryDiffPlan({ asserts: ["same", "same", "tail"] }, { asserts: ["same", "tail"] }, "procedure");
  assert.deepEqual(plan.changes, [{ beforePath: "procedure.asserts[2]", afterNextPath: "procedure.asserts[2]", whole: false }]);
  assert.equal(plan.matches.get("procedure.asserts[3]"), "procedure.asserts[2]");
});
test("reordered steps show removal and addition instead of modifying unchanged content", () => {
  const plan = memoryDiffPlan({ flow: [action("A"), action("B"), action("C")] }, { flow: [action("B"), action("A"), action("C")] }, "procedure");
  assert.equal(plan.changes.every(c => !(c.beforePath && c.afterPath)), true);
  assert.equal(plan.changes.length, 2);
});
test("a shifted edited step keeps its metadata change associated with the new position", () => {
  const plan = memoryDiffPlan({ flow: [{ ...action("Tail"), artifact: { name: "Result", final: true } }] }, { flow: [action("Inserted"), { ...action("Tail"), artifact: { name: "Result" } }] }, "procedure");
  assert.equal(plan.matches.get("procedure.flow[1].artifact"), "procedure.flow[2].artifact");
  assert.equal(plan.changes.some(c => c.beforePath === "procedure.flow[1].artifact.final"), true);
});
test("nested branch insertion uses the candidate branch paths", () => {
  const plan = memoryDiffPlan({ flow: [{ tag: "!if", condition: action("Decide"), then: [action("A")] }] }, { flow: [{ tag: "!if", condition: action("Decide"), then: [action("X"), action("A")] }] }, "procedure");
  assert.deepEqual(plan.changes, [{ afterPath: "procedure.flow[1].then[1]", whole: true }]);
});
