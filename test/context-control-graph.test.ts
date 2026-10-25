import assert from "node:assert/strict";
import test from "node:test";
import { artifactHistory } from "../modules/org.memsphere.run/adapter/view/context-control.js";
const a = (id: string, dependencies: string[] = [], revisedFrom?: string) => ({ id, stepId: `step-${id}`, name: id, tags: ["default"], status: "submitted", dependencies: dependencies.map(id => ({ kind: "artifact", id })), ...(revisedFrom ? { revisedFrom } : {}) });

test("fifty revisions stay folded and selecting a version projects its actual continuation", () => {
  const records = [a("input"), a("v0", ["input"])];
  for (let i = 1; i <= 50; i++) records.push(a(`v${i}`, ["input"], `v${i - 1}`));
  records.push(a("summary", ["v50"]));
  const history = artifactHistory(records);
  assert.deepEqual(history.latest().map(a => a.id), ["input", "v50", "summary"]);
  assert.deepEqual(history.around("v25").map(a => a.id), ["input", "v25"]);
  assert.equal(history.versions("v25").length, 51);
});

test("graph projections preserve explicitly required multiple versions and exact delivery roots", () => {
  const history = artifactHistory([a("a1"), a("a2", [], "a1"), a("comparison", ["a1", "a2"]), a("other")]);
  assert.deepEqual(history.latest(["comparison"]).map(a => a.id), ["a1", "a2", "comparison"]);
  assert.deepEqual(history.around("a1").map(a => a.id), ["a1", "a2", "comparison"]);
});

test("a newer branch from an old revision is latest even when another branch has more revisions", () => {
  const history = artifactHistory([a("root"), a("long-1", [], "root"), a("long-2", [], "long-1"), a("new-branch", [], "root")]);
  assert.deepEqual(history.latest().map(a => a.id), ["new-branch"]);
  assert.deepEqual(history.versions("long-2").map(a => a.id), ["root", "long-1", "long-2", "new-branch"]);
});
