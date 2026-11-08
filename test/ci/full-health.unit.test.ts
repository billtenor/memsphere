import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";
import { ACTIONS_APP_ID, CONTEXT, REPOSITORY, WORKFLOW_ID, decideHealth, requiredCheckRules } from "../../scripts/ci/full-health.mjs";

const master = "b".repeat(40);

const proof = (state: string) => ({ state, reason: state });

function run(id: number, head = master, overrides = {}) {
  return { id, workflow_id: WORKFLOW_ID, repository: { full_name: REPOSITORY }, event: "workflow_dispatch",
    head_sha: head, head_branch: head === master ? "master" : "feature", display_title: "CI (full)",
    status: "completed", conclusion: "success", created_at: new Date(id * 1000).toISOString(),
    run_attempt: 1, html_url: `https://github.com/${REPOSITORY}/actions/runs/${id}`, ...overrides };
}


test("PR repair proof wins; pending and failed full never borrow an older green result", () => {
  for (const state of ["success", "pending", "failure"]) {
    for (const current of [undefined, proof("success"), proof("pending"), proof("failure")]) {
      assert.equal(decideHealth(current, proof(state)).state, state);
    }
    assert.equal(decideHealth(proof(state), undefined).state, state);
  }
  assert.equal(decideHealth(undefined, undefined, true).state, "pending");
  assert.equal(decideHealth(undefined, undefined, false).state, "failure");
});


test("Required context binds Actions without changing existing protections; rollback removes only that binding", () => {
  const original = [{ type: "deletion" }, { type: "pull_request", parameters: { require_code_owner_review: true } }];
  const added = requiredCheckRules(original);
  assert.deepEqual(added.slice(0, 2), original);
  assert.deepEqual(added[2].parameters, { required_status_checks: [{ context: CONTEXT, integration_id: ACTIONS_APP_ID }],
    strict_required_status_checks_policy: false, do_not_enforce_on_create: false });
  assert.deepEqual(requiredCheckRules(added, true), original);
  added[2].parameters.required_status_checks.push({ context: "Another check", integration_id: 123 });
  added[2].parameters.strict_required_status_checks_policy = true;
  const rolledBack = requiredCheckRules(added, true);
  assert.deepEqual(rolledBack[2].parameters.required_status_checks, [{ context: "Another check", integration_id: 123 }]);
  assert.equal(rolledBack[2].parameters.strict_required_status_checks_policy, true);
  assert.deepEqual(requiredCheckRules(added), added);
  assert.equal(original.length, 2);
});


test("Publisher always checks out trusted master, uses minimal permissions and never executes PR assets", async () => {
  const health = parse(await readFile(".github/workflows/full-health.yml", "utf8"));
  assert.equal(health.name, "Update PR merge gate");
  assert.match(health["run-name"], /Update PR merge gate.*github\.event\.action/);
  for (const label of ["format('CI {0}', github.event.action)", "'master updated'", "format('PR {0}', github.event.action)", "'manual refresh'"]) {
    assert(health["run-name"].includes(label), `missing human-readable event label: ${label}`);
  }
  assert.equal(health.jobs.refresh.name, "Publish merge gate status (no tests)");
  assert.deepEqual(health.on.workflow_run.types, ["requested", "in_progress", "completed"]);
  assert.deepEqual(health.on.push.branches, ["master"]);
  assert.deepEqual(health.on.pull_request_target.branches, ["master"]);
  assert.equal(health.on.pull_request, undefined);
  assert.equal(health.concurrency["cancel-in-progress"], false);
  assert.deepEqual(health.permissions, { contents: "read", actions: "read", "pull-requests": "read", statuses: "write" });
  const steps = health.jobs.refresh.steps;
  assert.equal(steps[0].with.ref, "refs/heads/master");
  assert.equal(steps[0].with["persist-credentials"], false);
  assert.equal(steps.some((s: any) => /npm |download-artifact|cache@/.test(s.run || s.uses || "")), false);
  assert.notEqual(health.jobs.refresh.name, CONTEXT);
  assert.match(steps.at(-1).run, /export CHECKED_OUT_SHA="\$\(git rev-parse HEAD\)"/);
  assert.equal(steps.at(-1).env.FULL_HEALTH_PUBLISH_LEGACY, "${{ vars.FULL_HEALTH_PUBLISH_LEGACY }}");
  const ci = parse(await readFile(".github/workflows/ci.yml", "utf8"));
  assert.equal(ci.jobs["full-health-bootstrap"], undefined);
  assert.equal(ci.on.workflow_dispatch.inputs.full_health_bootstrap, undefined);
  assert.equal(ci.on.workflow_dispatch.inputs.reviewed_sha, undefined);
  assert.equal(ci.permissions.statuses, undefined);
  assert.equal(ci.jobs.plan.if, undefined);
});
