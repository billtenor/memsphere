import assert from "node:assert/strict";
import test from "node:test";
import { allReviewNodes, assertReviewNodes, createReviewNodes, currentReviewNode, mutateReviewNode, reviewNodeProgress, reviewNodeView, type NodeComment, type NodeMutation } from "../src/review-nodes.js";
import { resolveRuleParts } from "../src/memory/rules.js";
import { renderReviewNodeOutput } from "../src/prompts/review-nodes.js";
let count = 0;
function make(body: { body: string; severity: NodeComment["severity"] }): NodeComment { return { ...body, commentId: `c${++count}` }; }
async function fixture(rules = true) {
  const tree = await resolveRuleParts("asserts", rules ? ["Check a", "Check b"] : [], async () => { throw new Error("unexpected lookup"); });
  return { value: createReviewNodes([{ name: "A", source: { kind: "step", path: "actions[0]", memoryRef: "procedures/p" }, asserts: tree }], "Open review"), comments: [] as NodeComment[] };
}
function edit(f: Awaited<ReturnType<typeof fixture>>, mutation: NodeMutation) { const next = structuredClone(f); next.comments = mutateReviewNode(next.value, next.comments, mutation, make); Object.assign(f, next); }
function report(f: Awaited<ReturnType<typeof fixture>>, artifact = { applicable: true }) { edit(f, { operation: "report", artifact, expectedNodeId: currentReviewNode(f.value)!.nodeId }); }

test("empty rules still require explicit open review before final submission", async () => {
  const f = await fixture(false); assert.equal(currentReviewNode(f.value)?.kind, "open_review");
  assert.throws(() => assertReviewNodes(f.value, f.comments, true), /incomplete/);
  report(f); assertReviewNodes(f.value, f.comments, true); assert.deepEqual(reviewNodeProgress(f.value), { phase: "final_review", processed: 1, total: 1 });
});
test("rule reports and skipped rule nodes always lead to mandatory open review", async () => {
  const f = await fixture(); edit(f, { operation: "report", expectedNodeId: "2", artifact: { applicable: false, comments: [{ body: "Outside role", severity: "suggestion" }] } });
  assert.equal(currentReviewNode(f.value)?.kind, "open_review");
  assert.throws(() => edit(f, { operation: "report", expectedNodeId: "3", artifact: { applicable: false } }), /must_be_completed/);
  report(f); assertReviewNodes(f.value, f.comments, true);
});
test("open findings have no rule result and allow multiple comments in the sole collection", async () => {
  const f = await fixture(false);
  for (const body of ["Missing requirement", "Wrong assumption", "Missing requirement"]) edit(f, { operation: "comment-add", artifact: { body, severity: "risk" } });
  assert.equal(f.comments.length, 3); assert.equal(f.value.nodeStates.at(-1)!.ruleResults.length, 0);
  assert.deepEqual(f.value.nodeStates.at(-1)!.commentIds, f.comments.map(c => c.commentId));
  report(f); assertReviewNodes(f.value, f.comments, true);
});
test("open review rejects statement-linked comments without storing partial state", async () => {
  const f = await fixture(false), before = structuredClone(f);
  assert.throws(() => edit(f, { operation: "comment-add", artifact: { rulePath: "asserts[0]", result: "not_satisfied", body: "Invalid", severity: "risk" } }), /no_rule/);
  assert.deepEqual(f, before);
});
test("editing a future node does not advance progress or omit its later report", async () => {
  const f = await fixture(); edit(f, { operation: "comment-add", nodeId: "3", artifact: { body: "Extra", severity: "risk" } });
  assert.equal(currentReviewNode(f.value)?.nodeId, "2"); assert.equal(reviewNodeProgress(f.value)?.processed, 0);
  report(f); assert.equal(currentReviewNode(f.value)?.nodeId, "3"); report(f); assert.equal(f.comments.length, 1);
});
test("omitted comments retain edits and identity; explicit empty comments clear outcomes", async () => {
  const f = await fixture(); edit(f, { operation: "comment-add", artifact: { rulePath: "actions[0].asserts[0]", result: "undetermined", body: "Need evidence", severity: "risk" } });
  const id = f.comments[0].commentId!; edit(f, { operation: "comment-update", commentId: id, artifact: { body: "Need execution evidence" } }); report(f);
  assert.equal(f.comments[0].commentId, id); assert.equal(f.comments[0].body, "Need execution evidence");
  edit(f, { operation: "update", nodeId: "2", artifact: { applicable: true, comments: [] } });
  assert.equal(f.comments.length, 0); assert.equal(f.value.nodeStates[1].ruleResults.length, 0); assert.equal(currentReviewNode(f.value)?.nodeId, "3");
});
test("deleting the final exception comment preserves its outcome and reported progress", async () => {
  const f = await fixture(); edit(f, { operation: "comment-add", artifact: { rulePath: "actions[0].asserts[0]", result: "not_satisfied", body: "Missing", severity: "risk" } }); report(f);
  edit(f, { operation: "comment-delete", commentId: f.comments[0].commentId! });
  assert.deepEqual(f.value.nodeStates[1].ruleResults, [{ rulePath: "actions[0].asserts[0]", result: "not_satisfied", commentIds: [] }]);
  assert.equal(reviewNodeProgress(f.value)?.processed, 1); report(f); assertReviewNodes(f.value, f.comments, true);
});
test("deleting an inapplicability reason preserves progress but final submission waits for repair", async () => {
  const f = await fixture(); edit(f, { operation: "report", expectedNodeId: "2", artifact: { applicable: false, comments: [{ body: "Outside scope", severity: "suggestion" }] } }); report(f);
  edit(f, { operation: "comment-delete", commentId: f.comments[0].commentId! }); assert.equal(reviewNodeProgress(f.value)?.phase, "final_review");
  assert.throws(() => assertReviewNodes(f.value, f.comments, true), /incomplete: 2/);
  edit(f, { operation: "comment-add", nodeId: "2", artifact: { body: "Outside role", severity: "suggestion" } }); assertReviewNodes(f.value, f.comments, true);
});
test("stale report target cannot report the next node after another report advances", async () => {
  const f = await fixture(); report(f); const before = structuredClone(f);
  assert.throws(() => edit(f, { operation: "report", expectedNodeId: "2", artifact: { applicable: true } }), /conflict/); assert.deepEqual(f, before);
});
test("final overview has no implicit comment-add target; explicit node edits stay in final review", async () => {
  const f = await fixture(false); report(f);
  assert.throws(() => edit(f, { operation: "comment-add", artifact: { body: "Extra", severity: "risk" } }), /required/);
  edit(f, { operation: "comment-add", nodeId: "3", artifact: { body: "Extra", severity: "risk" } }); assert.equal(reviewNodeProgress(f.value)?.phase, "final_review");
});
test("different Statement sources preserve root rule paths and parent-before-child order", async () => {
  const statement = { tag: "!statement" as const, names: ["S"], defines: ["Root definition"], asserts: ["Root"], suggests: ["Advice"], sections: [{ tag: "!statement" as const, names: ["Child"], defines: ["Child definition"], asserts: ["Child"] }] };
  const lookup = async () => statement;
  const value = createReviewNodes([{ name: "Action", source: { kind: "step", path: "actions[0]" }, asserts: await resolveRuleParts("asserts", [{ tag: "!ref", target: "statements/a" }, { tag: "!ref", target: "statements/b" }], lookup), suggests: await resolveRuleParts("suggests", [{ tag: "!ref", target: "statements/a" }], lookup) }], "Open");
  const a = value.nodeTree.root.children[0].children[0]; assert.equal(a.source?.memoryRef, "statements/a"); assert.equal(a.asserts[0].rulePath, "asserts[0]"); assert.equal(a.suggests[0].rulePath, "suggests[0]"); assert.equal(a.children[0].asserts[0].rulePath, "sections[0].asserts[0]");
  assert.deepEqual(allReviewNodes(value.nodeTree).map(n => n.nodeId), ["1", "2", "3", "4", "5", "6", "7"]); assertReviewNodes(value, []);
});
for (const locale of ["zh-CN", "en"] as const) test(`open-review ${locale} prompt asks for independent additional issues without inventing findings`, async () => {
  const f = await fixture(false), text = renderReviewNodeOutput("show", reviewNodeView(f.value, f.comments), locale);
  assert.match(text, locale === "en" ? /professional experience/ : /专业经验/); assert.match(text, locale === "en" ? /Do not manufacture/ : /不要求为了完成/); assert.match(text, /report/);
});


test("twenty applicable rules report only two exceptions and leave other nodes untouched", async () => {
  const rules = await resolveRuleParts("asserts", Array.from({ length: 20 }, (_, i) => `Requirement ${i}`), async () => { throw Error("unexpected lookup"); });
  const f = { value: createReviewNodes([{ name: "Scope", source: { kind: "step" as const, path: "actions[0]" }, asserts: rules }], "Open review"), comments: [] as NodeComment[] };
  edit(f, { operation: "report", expectedNodeId: "2", artifact: { applicable: true, comments: [
    { rulePath: "actions[0].asserts[3]", result: "not_satisfied", body: "Missing requirement", severity: "suggestion" },
    { rulePath: "actions[0].asserts[19]", result: "undetermined", body: "Need evidence", severity: "risk" }
  ] } });
  assert.equal(f.value.nodeStates[1].ruleResults.length, 2); assert.equal(f.comments.length, 2);
  assert.equal(f.value.nodeStates[2].reported, false);
  const results = reviewNodeView(f.value, f.comments, { all: true });
  assert.doesNotMatch(JSON.stringify(results), /Requirement 0/);
  edit(f, { operation: "update", nodeId: "2", artifact: { applicable: true, comments: [] } });
  assert.equal(f.comments.length, 0); assert.equal(f.value.nodeStates[1].reported, true);
});

test("skipping a parent still checks children; prompts contain only current definitions and ancestry labels", async () => {
  const rules = await resolveRuleParts("asserts", ["Check"], async () => { throw Error("unexpected lookup"); });
  const f = { value: createReviewNodes([{ name: "Parent", defines: ["Parent long definition"], source: { kind: "step" as const, path: "actions[0]" }, asserts: rules, children: [{ name: "Child", defines: ["Child definition"], source: { kind: "schema" as const, path: "fields[0]", memoryRef: "schemas/s" }, asserts: rules }] }], "Open review"), comments: [] as NodeComment[] };
  edit(f, { operation: "report", expectedNodeId: "2", artifact: { applicable: false, comments: [{ body: "Outside role", severity: "suggestion" }] } });
  assert.equal(currentReviewNode(f.value)?.name, "Child");
  const prompt = renderReviewNodeOutput("report", reviewNodeView(f.value, f.comments), "en");
  assert.match(prompt, /Child definition/); assert.match(prompt, /Parent/); assert.doesNotMatch(prompt, /Parent long definition/);
});

for (const first of ["asserts", "suggests"] as const) test(`Statement sections keep declaration order when the first section has only ${first}`, async () => {
  const other = first === "asserts" ? "suggests" : "asserts";
  const ref = { tag: "!ref" as const, target: "statements/s" };
  const childRef = { tag: "!ref" as const, target: "statements/child" };
  const statement = { tag: "!statement" as const, names: ["S"], defines: [], asserts: [childRef], suggests: [childRef], sections: [
    { tag: "!statement" as const, names: ["First"], defines: [], [first]: ["First rule"], sections: [
      { tag: "!statement" as const, names: ["Nested first"], defines: [], [first]: ["Nested first rule"] },
      { tag: "!statement" as const, names: ["Nested second"], defines: [], [other]: ["Nested second rule"] }
    ] },
    { tag: "!statement" as const, names: ["Second"], defines: [], [other]: ["Second rule"] }
  ] };
  const lookup = async (target: string) => target === "statements/s" ? statement : { tag: "!statement" as const, names: ["Referenced sibling"], defines: [], asserts: ["Ref rule"], suggests: ["Ref advice"] };
  const value = createReviewNodes([{ name: "Step", source: { kind: "step", path: "actions[0]" }, asserts: await resolveRuleParts("asserts", [ref, ref], lookup), suggests: await resolveRuleParts("suggests", [ref], lookup) }], "Open");
  const nodes = allReviewNodes(value.nodeTree).filter(n => n.source?.kind === "statement");
  assert.deepEqual(nodes.map(n => n.name), ["S", "Referenced sibling", "First", "Nested first", "Nested second", "Second"]);
  assert.deepEqual(nodes.slice(2).map(n => [...n.asserts, ...n.suggests][0].rulePath), [`sections[0].${first}[0]`, `sections[0].sections[0].${first}[0]`, `sections[0].sections[1].${other}[0]`, `sections[1].${other}[0]`]);
  assert.equal(nodes[1].source?.memoryRef, "statements/child");
  assert.deepEqual(nodes[1].asserts, [{ rulePath: "asserts[0]", text: "Ref rule" }]);
});

for (const stage of ["node", "overview", "all"] as const) test(`${stage} renders each comment body once while preserving separate duplicate opinions`, async () => {
  const f = await fixture(), body = "Unique long finding that must appear once per identity.";
  for (let i = 0; i < 2; i++) edit(f, { operation: "comment-add", artifact: { rulePath: "actions[0].asserts[0]", result: "undetermined", body, severity: "risk" } });
  if (stage === "overview") { report(f); report(f); }
  const view = reviewNodeView(f.value, f.comments, stage === "all" ? { all: true } : {});
  const prompt = renderReviewNodeOutput(stage === "all" ? "show-all" : "show", view, "en");
  assert.equal(prompt.split(body).length - 1, 2);
  const serialized = JSON.stringify(view);
  for (const c of f.comments) assert.ok(serialized.includes(c.commentId!));
  assert.equal(f.comments.length, 2);
});
