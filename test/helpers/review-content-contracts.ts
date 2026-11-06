import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { reviewCliFixture } from "./review-node-cli.js";
import { completeReview } from "./review-node-materials.js";
import * as reviews from "../../src/context_control/review-repository.js";
import { currentReviewNode, reviewCommentId, reviewNodeProgress } from "../../src/review-nodes.js";

export function reviewContentContracts(commands: string[]) {
  for (const command of commands) test(`restricted CLI: ${command} has equivalent route and artifact combinations`, { timeout: 120000 }, async t => {
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

}
