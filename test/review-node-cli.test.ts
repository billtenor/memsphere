import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { reviewCliFixture } from "./helpers/review-node-cli.js";
import { completeReview } from "./helpers/review-node-materials.js";
import * as reviews from "../src/context_control/review-repository.js";
import { currentReviewNode, reviewCommentId, reviewNodeProgress } from "../src/review-nodes.js";

for (const command of ["report", "update", "comment add", "comment update", "submit"]) test(`restricted CLI: ${command} has equivalent route and artifact combinations`, { timeout: 120000 }, async t => {
  const results = [];
  // Cases mutate separate Runs/Reviews; model installation is shared setup.
  let project: Parameters<typeof reviewCliFixture>[1];
  for (const route of [["run", "review"], ["continue"]]) for (const source of ["string", "file"]) {
    const f = await reviewCliFixture(t, project), n = currentReviewNode(f.claimed.assignment)!;
    project ??= { fixture: f, service: f.input.service! };
    const finding = { rulePath: n.asserts[0].rulePath, result: "undetermined", body: "Need evidence", severity: "risk" };
    const args = command.split(" "), params: string[] = [];
    let body: unknown;
    if (command === "report") body = { applicable: true, comments: [finding] };
    else if (command === "update") { params.push("--node", n.nodeId); body = { applicable: true, comments: [finding] }; }
    else if (command === "comment add") body = finding;
    else if (command === "comment update") {
      const c = await reviews.mutateArtifactReviewNodes({ ...f.bound, mutation: { operation: "comment-add", artifact: { ...finding, result: "undetermined" as const, severity: "risk" as const } } });
      params.push("--comment", reviewCommentId(c.assignment.draft.comments[0])); body = { body: "Updated explanation", severity: "suggestion" };
    } else { await completeReview(f.bound); body = { vote: "approve", summary: "Reviewed" }; }
    const json = JSON.stringify(body), file = join(f.cwd, "artifact.json"); await writeFile(file, json);
    const invocation = [...route, ...args, ...params, ...(source === "string" ? ["--artifact", json] : ["--artifact-file", file]), "--output", "json"];
    // Every content command crosses the native restricted launcher. Remaining
    // route/input combinations exercise the same real handlers in-process.
    if (route[0] === "run" && source === (command === "report" ? "file" : "string")) f.cli(invocation);
    else await f.moduleCli(invocation);
    const c = (await reviews.readArtifactReviewForActor(f.input)).assignment;
    assert.equal(reviewNodeProgress(c)?.processed, command === "report" ? 1 : command === "submit" ? 2 : 0);
    assert.deepEqual((c.submitted?.comments ?? c.draft.comments).map(x => x.body), command === "submit" ? [] : [command === "comment update" ? "Updated explanation" : "Need evidence"]);
    if (command === "submit") { assert.equal(c.submitted?.vote, "approve"); assert.equal(c.submitted?.summary, "Reviewed"); }
    results.push({ status: c.status, nodeStates: c.nodeStates?.map(s => ({ ...s, ruleResults: s.ruleResults.map(r => ({ rulePath: r.rulePath, result: r.result, count: r.commentIds.length })), commentIds: s.commentIds?.length })), comments: (c.submitted?.comments ?? c.draft.comments).map(x => ({ body: x.body, severity: x.severity })), vote: c.submitted?.vote, summary: c.submitted?.summary });
  }
  for (const result of results) assert.deepEqual(result, results[0]);
});

test("restricted command module: invalid artifact inputs fail atomically for every content command", { timeout: 120000 }, async t => {
  const f = await reviewCliFixture(t), n = currentReviewNode(f.claimed.assignment)!;
  const finding = { rulePath: n.asserts[0].rulePath, result: "undetermined" as const, body: "Need evidence", severity: "risk" as const };
  const added = await reviews.mutateArtifactReviewNodes({ ...f.bound, mutation: { operation: "comment-add", artifact: finding } });
  const id = reviewCommentId(added.assignment.draft.comments[0]), before = (await reviews.readArtifactReviewForActor(f.input)).assignment;
  const malformed = join(f.cwd, "malformed.json"), valid = join(f.cwd, "valid.json"); await writeFile(malformed, "not json"); await writeFile(valid, "{}");
  for (const cmd of [["report"], ["update", "--node", n.nodeId], ["comment", "add"], ["comment", "update", "--comment", id], ["submit"]]) {
    for (const input of [[], ["--artifact", "{}", "--artifact-file", valid], ["--artifact", "not json"], ["--artifact-file", malformed], ["--artifact-file", join(f.cwd, "missing.json")], ["--artifact", "{}"]]) {
      await t.test(`${cmd.slice(0, 2).join(" ")}: ${input.join(" ") || "missing content"}`, async () => {
        await f.moduleCli(["continue", ...cmd, ...input, "--output", "json"], false);
        assert.deepEqual((await reviews.readArtifactReviewForActor(f.input)).assignment, before);
      });
    }
  }
  for (const cmd of [["report"], ["update", "--node", n.nodeId], ["comment", "add"], ["comment", "update", "--comment", id], ["submit"]]) {
    await t.test(`native ${cmd.join(" ")}: conflicting content sources`, async () => {
      f.cli(["run", "review", ...cmd, "--artifact", "{}", "--artifact-file", valid, "--output", "json"], false);
      assert.deepEqual((await reviews.readArtifactReviewForActor(f.input)).assignment, before);
    });
  }
});

test("restricted CLI: an old Attempt cannot report after retry", async t => {
  const f = await reviewCliFixture(t);
  await reviews.failArtifactReviewAgentAssignment({ ...f.bound, failure: { stage: "process", code: "fixture", message: "Retry" } });
  await reviews.retryArtifactReviewAgentAssignment(f.input);
  const claimed = (await reviews.claimArtifactReviewAgentAssignment({ ...f.input, workerPid: process.pid }))!;
  await reviews.markArtifactReviewAgentCliReady({ ...f.input, attemptId: claimed.attempt.id });
  f.cli(["continue", "report", "--artifact", '{"applicable":true}', "--output", "json"], false);
  assert.equal(reviewNodeProgress((await reviews.readArtifactReviewForActor(f.input)).assignment)?.processed, 0);
});

test("restricted CLI: node writes require their explicit identity and uniform content parameters", async t => {
  const f = await reviewCliFixture(t), before = (await reviews.readArtifactReviewForActor(f.input)).assignment;
  f.cli(["continue", "update", "--artifact", '{"applicable":true,"comments":[]}', "--output", "json"], false);
  f.cli(["run", "review", "submit", "--artifact", '{"vote":"approve"}', "--vote", "approve", "--output", "json"], false);
  assert.deepEqual((await reviews.readArtifactReviewForActor(f.input)).assignment, before);
});

test("restricted CLI: open review report is mandatory before final submit", async t => {
  const f = await reviewCliFixture(t);
  f.cli(["continue", "report", "--artifact", '{"applicable":true,"comments":[]}', "--output", "json"]);
  const before = (await reviews.readArtifactReviewForActor(f.input)).assignment;
  assert.equal(currentReviewNode(before)?.kind, "open_review");
  f.cli(["continue", "submit", "--artifact", '{"vote":"approve"}', "--output", "json"], false);
  assert.deepEqual((await reviews.readArtifactReviewForActor(f.input)).assignment, before);
});

test("restricted CLI: submitted results stay readable and reject further edits", async t => {
  const f = await reviewCliFixture(t); await completeReview(f.bound);
  f.cli(["continue", "submit", "--artifact", '{"vote":"approve"}', "--output", "json"]);
  const before = (await reviews.readArtifactReviewForActor(f.input)).assignment;
  assert.equal(f.cli(["continue", "show", "--all", "--output", "json"]).progress.phase, "submitted");
  f.cli(["continue", "comment", "add", "--node", before.nodeTree!.root.children.at(-1)!.nodeId, "--artifact", '{"body":"Late","severity":"risk"}', "--output", "json"], false);
  assert.deepEqual((await reviews.readArtifactReviewForActor(f.input)).assignment, before);
});

test("restricted CLI: deleting one comment retains its rule result and does not advance", async t => {
  const f = await reviewCliFixture(t), n = currentReviewNode(f.claimed.assignment)!;
  f.cli(["continue", "comment", "add", "--artifact", JSON.stringify({ rulePath: n.asserts[0].rulePath, result: "undetermined", body: "Evidence missing", severity: "risk" }), "--output", "json"]);
  const before = (await reviews.readArtifactReviewForActor(f.input)).assignment;
  f.cli(["run", "review", "comment", "delete", "--comment", reviewCommentId(before.draft.comments[0]), "--output", "json"]);
  const after = (await reviews.readArtifactReviewForActor(f.input)).assignment;
  assert.equal(reviewNodeProgress(after)?.processed, 0); assert.deepEqual(after.draft.comments, []);
  assert.deepEqual(after.nodeStates!.find(s => s.nodeId === n.nodeId)!.ruleResults, [{ rulePath: n.asserts[0].rulePath, result: "undetermined", commentIds: [] }]);
});
