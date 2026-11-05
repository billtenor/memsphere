import assert from "node:assert/strict";
import test from "node:test";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { Command } from "commander";
import { registerReviewNodeCommands, reviewerContinue } from "../src/commands/review-nodes.js";
import { reviewNodeFixture } from "./helpers/review-nodes.js";
import * as reviews from "../src/context_control/review-repository.js";
import { currentReviewNode, reviewCommentId, reviewNodeProgress } from "../src/review-nodes.js";

// Use the actual native and Continue routers with the bound Session and stores.
// The filesystem barrier only inserts another valid report before the edit's
// repository read, after the Session has already resolved its default target.
function nativeRouter() {
  const run = new Command("run"), review = run.command("review");
  review.command("comment");
  review.command("submit").option("--vote <value>");
  review.command("list");
  review.command("show");
  registerReviewNodeCommands(run);
  return run;
}

for (const graph of [true, false]) for (const route of ["native", "continue"]) {
  for (const scenario of ["rule", "reason", "conflict"] as const) {
    test(`${graph ? "graph" : "flow"} ${route}: default comment target survives concurrent report (${scenario})`, async t => {
      const f = await reviewNodeFixture(t, graph), node = currentReviewNode(f.claimed.assignment)!;
      const env = {
        MEMSPHERE_HOME: f.home,
        MEMSPHERE_CONFIG_PATH: join(f.root, "config.json"),
        MEMSPHERE_WORKSPACE_ROOT: process.cwd(),
        MEMSPHERE_REVIEW_RUN_ID: f.runId,
        MEMSPHERE_REVIEW_ASSIGNMENT_ID: f.claimed.assignment.id!,
        MEMSPHERE_REVIEW_ATTEMPT_ID: f.bound.attemptId
      };
      const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
      Object.assign(process.env, env);
      t.after(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        t.mock.restoreAll();
        syncBuiltinESMExports();
      });
      let inserted = false, afterReport: unknown, receipt: any;
      const readFile = fsPromises.readFile;
      t.mock.method(fsPromises, "readFile", async function(...args: Parameters<typeof readFile>) {
        const inMutation = new Error().stack?.includes("mutateArtifactReviewNodes");
        const bytes = await readFile.apply(fsPromises, args);
        if (!inserted && inMutation) {
          inserted = true;
          await reviews.mutateArtifactReviewNodes({
            ...f.bound,
            mutation: {
              operation: "report", expectedNodeId: node.nodeId,
              artifact: scenario === "conflict"
                ? { applicable: false, comments: [{ body: "Existing skip reason", severity: "suggestion" }] }
                : { applicable: true, comments: [] }
            }
          });
          afterReport = structuredClone((await reviews.readArtifactReviewForActor(f.input)).assignment);
        }
        return bytes;
      });
      syncBuiltinESMExports();
      t.mock.method(console, "log", (text: string) => { receipt = JSON.parse(text); });
      const body = scenario === "rule"
        ? { rulePath: node.asserts[0].rulePath, result: "undetermined", body: "Need evidence", severity: "risk" }
        : { body: "Outside role", severity: "suggestion" };
      const args = ["comment", "add", "--artifact", JSON.stringify(body), "--output", "json"];
      const router = nativeRouter();
      const execute = () => route === "continue"
        ? reviewerContinue(router, args)
        : router.parseAsync(["review", ...args], { from: "user" });
      if (scenario === "conflict") await assert.rejects(execute(), /review_reason_already_exists/);
      else await execute();
      assert.equal(inserted, true, "the concurrent report ran at the repository boundary");
      const actual = (await reviews.readArtifactReviewForActor(f.input)).assignment;
      assert.equal(reviewNodeProgress(actual)?.processed, 1, "only the inserted report advances");
      const open = currentReviewNode(actual)!;
      assert.equal(open.kind, "open_review");
      assert.deepEqual(actual.nodeStates!.find(s => s.nodeId === open.nodeId)!.commentIds, [], "no comment was reinterpreted as an open finding");
      if (scenario === "conflict") {
        assert.deepEqual(actual, afterReport, "rejected add preserves the concurrent report without any partial edit");
        assert.equal(receipt, undefined);
      } else {
        assert.equal(receipt.savedNodeId, node.nodeId);
        const ids = actual.draft.comments.map(reviewCommentId);
        assert.equal(ids.length, 1);
        assert.deepEqual(receipt.savedCommentIds, ids);
        const state = actual.nodeStates!.find(s => s.nodeId === node.nodeId)!;
        if (scenario === "rule") {
          assert.deepEqual(state.ruleResults, [{ rulePath: node.asserts[0].rulePath, result: "undetermined", commentIds: ids }]);
          assert.equal(state.reasonCommentId, undefined);
        } else {
          assert.equal(state.reasonCommentId, ids[0]);
          assert.deepEqual(state.ruleResults, []);
        }
        assert.equal(receipt.node.nodeId, open.nodeId);
        assert.equal(actual.draft.comments[0].body, body.body);
      }
    });
  }
}
