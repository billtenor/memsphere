import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

test("observation is opt-in and binds every job to the fixed PR candidate", async () => {
  const workflow = parse(await readFile(".github/workflows/changed-full-tests.yml", "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read", "pull-requests": "read" });
  for (const [name, ref] of [
    ["plan", "${{ steps.candidate.outputs.candidate }}"],
    ["selected", "${{ needs.plan.outputs.candidate }}"],
    ["observation-result", "${{ needs.plan.outputs.candidate }}"]
  ]) {
    const checkout = workflow.jobs[name].steps.find(step => step.uses?.startsWith("actions/checkout@"));
    assert.equal(checkout.with.ref, ref);
    assert.equal(checkout.with["persist-credentials"], false);
  }
  const selected = workflow.jobs.selected;
  assert.equal(selected["runs-on"], "${{ matrix.os }}");
  assert.equal(selected["timeout-minutes"], "${{ matrix.timeoutMinutes }}");
  assert.equal(selected.strategy.matrix, "${{ fromJSON(needs.plan.outputs.matrix) }}");
  assert.equal(selected.strategy["fail-fast"], false);
  const result = workflow.jobs["observation-result"];
  assert.deepEqual(result.needs, ["plan", "selected"]);
  assert.equal(result.if, "always()");
  assert.ok(result.steps.some(step => step.name === "Confirm candidate is still current"));
  assert.equal(result.steps.at(-1).env.OBSERVATION_JOBS_STATUS, "${{ needs.selected.result }}");
});
