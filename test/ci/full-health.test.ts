import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { parse } from "yaml";
import {
  ACTIONS_APP_ID, CONTEXT, LEGACY_CONTEXT, FULL_JOB, REPOSITORY, WORKFLOW_ID, computeHealth, createApi,
  decideHealth, fullEvidence, refreshHealth, requiredCheckRules, verifyBootstrap
} from "../../scripts/full-health.mjs";

const sha = "a".repeat(40);
const master = "b".repeat(40);
const old = "c".repeat(40);
const proof = (state: string) => ({ state, reason: state });
function run(id: number, head = master, overrides = {}) {
  return { id, workflow_id: WORKFLOW_ID, repository: { full_name: REPOSITORY }, event: "workflow_dispatch",
    head_sha: head, head_branch: head === master ? "master" : "feature", display_title: "CI (full)",
    status: "completed", conclusion: "success", created_at: new Date(id * 1000).toISOString(),
    run_attempt: 1, html_url: `https://github.com/${REPOSITORY}/actions/runs/${id}`, ...overrides };
}
const summary = (conclusion = "success") => ({ name: FULL_JOB, status: "completed", conclusion });

// A real HTTP boundary verifies query strings, pagination and status payloads without GitHub credentials.
async function fixture(t: any, options: any = {}) {
  const posts: any[] = [];
  const statusAttempts: any[] = [];
  const paths: string[] = [];
  const pulls = options.pulls || [{ number: 108, state: "open", head: { sha }, base: { ref: "master" } }];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const path = url.pathname.replace(`/repos/${REPOSITORY}`, "");
    paths.push(`${path}${url.search}`);
    let status = 200;
    let value: any;
    const custom = await options.reply?.(path, url, req);
    if (custom) { status = custom.status || 200; value = custom.value; }
    else if (req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const post = { sha: path.split("/").at(-1), ...JSON.parse(raw) };
      statusAttempts.push(post);
      if (options.rejectPost?.(post)) { status = 503; value = { message: "Status write unavailable" }; }
      else { posts.push(post); value = {}; }
    } else if (path === "") value = { full_name: REPOSITORY, default_branch: "master" };
    else if (path === "/actions/workflows/ci.yml") value = { id: WORKFLOW_ID, path: ".github/workflows/ci.yml" };
    else if (path === "/git/ref/heads/master") value = { object: { sha: options.master?.() || master } };
    else if (path === "/pulls") value = pulls;
    else if (path.startsWith("/pulls/")) value = pulls.find((p: any) => p.number === Number(path.split("/").at(-1)));
    else if (path.endsWith("/runs")) value = { workflow_runs: options.runs || [] };
    else if (path.endsWith("/jobs")) value = { jobs: [summary()] };
    else if (path.includes("/attempts/")) value = { conclusion: "failure", status: "completed" };
    else { status = 404; value = { message: "Not found" }; }
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())));
  const address: any = server.address();
  return { api: createApi({ token: "fixture", apiUrl: `http://127.0.0.1:${address.port}` }), endpoint: `http://127.0.0.1:${address.port}`, posts, statusAttempts, paths };
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

test("Only this repository's genuine full can supply success, including failure before summary", async t => {
  const { api } = await fixture(t);
  for (const conclusion of ["failure", "cancelled", "timed_out", "action_required", "stale", "startup_failure", "neutral", "skipped", null]) {
    assert.equal((await fullEvidence(api, run(1, master, { conclusion }))).state, "failure");
  }
  assert.equal((await fullEvidence(api, run(1))).state, "success");
  for (const overrides of [
    { display_title: "CI (default)" }, { display_title: "Full health bootstrap" }, { display_title: "Initialize PR merge gate" },
    { workflow_id: 1 }, { repository: { full_name: "elsewhere/repo" } }, { event: "pull_request" },
    { event: "push", head_branch: "feature" }
  ]) assert.equal(await fullEvidence(api, run(1, master, overrides)), undefined);
  for (const conclusion of ["skipped", "neutral", "failure"]) {
    const f = await fixture(t, { reply: (p: string) => p.endsWith("/jobs") && { value: { jobs: [summary(conclusion)] } } });
    assert.equal((await fullEvidence(f.api, run(1))).state, "failure");
    if (conclusion === "skipped") assert.equal(await fullEvidence(f.api, run(1, master, { display_title: "legacy default" })), undefined);
  }
  const missing = await fixture(t, { reply: (p: string) => p.endsWith("/jobs") && { value: { jobs: [] } } });
  assert.equal((await fullEvidence(missing.api, run(1))).state, "failure");
  assert.equal((await fullEvidence(missing.api, run(1, master, { conclusion: "failure" }))).state, "failure");
});

test("Queued and rerun full wait, retaining previous failed-attempt evidence", async t => {
  const { api, paths } = await fixture(t);
  for (const status of ["queued", "in_progress", "waiting", "requested"]) {
    const evidence = await fullEvidence(api, run(2, master, { status, conclusion: null, run_attempt: 2 }));
    assert.equal(evidence.state, "pending");
    assert.equal(evidence.previousConclusion, "failure");
  }
  assert(paths.some(p => p === "/actions/runs/2/attempts/1"));
});

test("Latest master SHA and latest current-head full determine the gate, including run-ID ties", async t => {
  for (const [runs, expected] of [
    [[run(1, old, { head_branch: "master" })], "pending"],
    [[], "failure"],
    [[run(1)], "success"],
    [[run(1), run(2, master, { status: "queued", conclusion: null })], "pending"],
    [[run(1), run(2, master, { conclusion: "failure" })], "failure"],
    [[run(1, master, { conclusion: "failure" }), run(2, sha)], "success"],
    [[run(1), run(2, sha, { conclusion: "cancelled" })], "failure"],
    [[run(1, sha), run(2, sha, { created_at: new Date(1000).toISOString(), status: "in_progress", conclusion: null })], "pending"],
    [[run(1, master, { conclusion: "failure" }), run(2, old)], "failure"]
  ] as any[]) {
    const { api } = await fixture(t, { runs });
    assert.equal((await computeHealth(api, sha, master)).state, expected);
  }
});

test("History and jobs pagination cannot hide a newer failed full or duplicate summary", async t => {
  const { api, paths } = await fixture(t, { reply: (path: string, url: URL) => {
    const page = url.searchParams.get("page");
    if (path.endsWith("/runs")) return { value: { workflow_runs: page === "1"
      ? Array.from({ length: 100 }, (_, i) => run(i + 1, master, { display_title: "CI (default)" }))
      : [run(999, master, { conclusion: "failure" })] } };
    if (path.endsWith("/jobs")) return { value: { jobs: page === "1"
      ? Array.from({ length: 100 }, () => summary()) : [summary()] } };
  } });
  assert.equal((await computeHealth(api, sha, master)).state, "failure");
  assert(paths.some(p => p.includes("page=2")));
  assert.equal((await fullEvidence(api, run(1000))).state, "failure");
});

test("Refresh revokes all stale greens and updates all open PRs using live facts", async t => {
  const pulls = [108, 109].map(number => ({ number, state: "open", base: { ref: "master" }, head: { sha: number === 108 ? sha : old } }));
  const { api, posts } = await fixture(t, { pulls, runs: [run(1, master, { status: "in_progress", conclusion: null })] });
  const reports = await refreshHealth(api, { publish: true });
  assert.equal(reports.length, 2);
  assert(posts.slice(0, 2).every(p => p.state === "pending"));
  assert(posts.every(p => p.context === CONTEXT));
  for (const head of [sha, old]) assert.equal(posts.filter(p => p.sha === head).at(-1).state, "pending");
});

test("Head/master changes during lookup are recomputed before success is published", async t => {
  const pulls = [{ number: 108, state: "open", base: { ref: "master" }, head: { sha } }];
  let reads = 0;
  let currentMaster = master;
  const { api, posts } = await fixture(t, { pulls, master: () => currentMaster, runs: [run(1)], reply: (path: string) => {
    if (path.endsWith("/runs") && ++reads === 2) { pulls[0].head.sha = old; currentMaster = "d".repeat(40); }
  } });
  const reports = await refreshHealth(api, { publish: true });
  assert.equal(reports[0].sha, old);
  assert.equal(reports[0].state, "pending");
  assert.equal(posts.some(p => p.state === "success"), false);
});

test("API/identity failures produce error statuses, never stale success; dry run does not write", async t => {
  for (const broken of ["/actions/workflows/ci.yml", "/actions/workflows/335696122/runs"]) {
    const { api, posts } = await fixture(t, { runs: [run(1)], reply: (p: string) => p === broken && { status: 503, value: {} } });
    await assert.rejects(refreshHealth(api, { publish: true }), /HTTP 503/);
    assert.equal(posts[0].state, "pending");
    assert.equal(posts.at(-1).state, "error");
    assert.equal(posts.some(p => p.state === "success"), false);
  }
  const f = await fixture(t, { runs: [run(1)] });
  assert.equal((await refreshHealth(f.api))[0].state, "success");
  assert.equal(f.posts.length, 0);
});

test("Renamed merge gate publishes only its new status unless the temporary rollout bridge is enabled", async t => {
  assert.equal(CONTEXT, "Merge gate / full regression");
  for (const state of ["success", "pending", "failure"]) {
    const runs = [run(1, master, state === "pending" ? { status: "in_progress", conclusion: null }
      : { conclusion: state })];
    const { api, posts } = await fixture(t, { runs });
    await refreshHealth(api, { publish: true, env: { FULL_HEALTH_PUBLISH_LEGACY: "true" } });
    for (let i = 0; i < posts.length; i += 2) {
      assert.equal(posts[i].context, LEGACY_CONTEXT, "revoke the still-required old gate first");
      assert.deepEqual(posts[i + 1], { ...posts[i], context: CONTEXT });
    }
    assert.equal(posts.at(-1).state, state);
    for (const value of [undefined, "", "false", "TRUE"]) {
      const start = posts.length;
      await refreshHealth(api, { publish: true, env: { FULL_HEALTH_PUBLISH_LEGACY: value } });
      assert(posts.slice(start).every(p => p.context === CONTEXT), "only exact true enables dual publication");
    }
    const beforeDryRun = posts.length;
    await refreshHealth(api, { env: { FULL_HEALTH_PUBLISH_LEGACY: "true" } });
    assert.equal(posts.length, beforeDryRun);
  }
});

test("Rollout marks both status names as error on identity or per-PR lookup failure", async t => {
  for (const broken of ["/actions/workflows/ci.yml", "/actions/workflows/335696122/runs"]) {
    const { api, posts } = await fixture(t, { runs: [run(1)], reply: (p: string) => p === broken && { status: 503, value: {} } });
    await assert.rejects(refreshHealth(api, { publish: true, env: { FULL_HEALTH_PUBLISH_LEGACY: "true" } }), /HTTP 503/);
    assert.deepEqual(posts.slice(0, 2).map(p => [p.context, p.state]), [[LEGACY_CONTEXT, "pending"], [CONTEXT, "pending"]]);
    assert.deepEqual(posts.slice(-2).map(p => [p.context, p.state]), [[LEGACY_CONTEXT, "error"], [CONTEXT, "error"]]);
    assert.equal(posts.some(p => p.state === "success"), false);
  }
});

test("Partial status write failure stops rollout without retrying or leaving the writable old gate stale", async t => {
  const env = { FULL_HEALTH_PUBLISH_LEGACY: "true" };
  for (const context of [LEGACY_CONTEXT, CONTEXT]) {
    const f = await fixture(t, { runs: [run(1)], rejectPost: (p: any) => p.context === context && p.state === "pending" });
    await assert.rejects(refreshHealth(f.api, { publish: true, env }), /HTTP 503/);
    assert.deepEqual(f.statusAttempts.map(p => p.context), [LEGACY_CONTEXT, CONTEXT], "attempt each independent revocation once");
    assert.equal(f.posts.some(p => p.state === "success"), false);
    if (context === CONTEXT) assert.equal(f.posts.at(-1).state, "pending", "new-name failure leaves the old required gate blocked");
    else assert.equal(f.posts.some(p => p.context === LEGACY_CONTEXT), false, "if the old status API itself rejects writes, revocation cannot be guaranteed");
    assert.equal(f.paths.some(p => p.startsWith("/actions/")), false, "no health query or success after pending write failure");
  }
  for (const context of [LEGACY_CONTEXT, CONTEXT]) {
    const f = await fixture(t, { runs: [run(1)], rejectPost: (p: any) => p.context === context && p.state === "success" });
    await assert.rejects(refreshHealth(f.api, { publish: true, env }), /HTTP 503/);
    assert.equal(f.statusAttempts.filter(p => p.context === context && p.state === "success").length, 1);
    for (const name of [LEGACY_CONTEXT, CONTEXT]) assert.equal(f.posts.filter(p => p.context === name).at(-1).state, "error");
  }
});

test("Rollout revokes every writable PR gate before reporting a partial status write failure", async t => {
  const pulls = [sha, old].map((head, i) => ({ number: 108 + i, state: "open", base: { ref: "master" }, head: { sha: head } }));
  for (const brokenContext of [LEGACY_CONTEXT, CONTEXT]) {
    const f = await fixture(t, { pulls, runs: [run(1)],
      rejectPost: (p: any) => p.sha === sha && p.context === brokenContext });
    await assert.rejects(refreshHealth(f.api, { publish: true, env: { FULL_HEALTH_PUBLISH_LEGACY: "true" } }), /HTTP 503/);
    assert.deepEqual(f.statusAttempts.map(p => [p.sha, p.context]), [
      [sha, LEGACY_CONTEXT], [old, LEGACY_CONTEXT], [sha, CONTEXT], [old, CONTEXT]
    ]);
    assert.equal(f.posts.filter(p => p.sha === old && p.context === LEGACY_CONTEXT).at(-1).state, "pending");
    if (brokenContext === CONTEXT) assert.equal(f.posts.filter(p => p.sha === sha && p.context === LEGACY_CONTEXT).at(-1).state, "pending");
    assert(f.posts.every(p => p.state === "pending"));
    assert.equal(f.paths.some(p => p.startsWith("/actions/")), false, "failed revocation never proceeds to health queries");
  }
});

test("Bootstrap requires explicit owner and reviewed SHA, and retires after master installation", async t => {
  const { api } = await fixture(t);
  const env = { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_ACTOR: "billtenor", GITHUB_SHA: sha, REVIEWED_SHA: sha };
  await verifyBootstrap(api, env);
  for (const changed of [{ GITHUB_ACTOR: "stranger" }, { GITHUB_EVENT_NAME: "pull_request" }, { REVIEWED_SHA: old }]) {
    await assert.rejects(verifyBootstrap(api, { ...env, ...changed }), /owner workflow_dispatch/);
  }
  const installed = await fixture(t, { reply: (p: string) => p.includes("/contents/") && { value: { sha: master } } });
  await assert.rejects(verifyBootstrap(installed.api, env), /installed on master/);
  const denied = await fixture(t, { reply: (p: string) => p.includes("/contents/") && { status: 403, value: {} } });
  await assert.rejects(verifyBootstrap(denied.api, env), /HTTP 403/);
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
  const bootstrap = ci.jobs["full-health-bootstrap"];
  assert.match(bootstrap.if, /github.actor == github.repository_owner/);
  assert.match(bootstrap.if, /inputs.reviewed_sha == github.sha/);
  assert.equal(bootstrap.steps[0].with.ref, "${{ github.sha }}");
  assert.equal(bootstrap.permissions.statuses, "write");
  assert.equal(ci.permissions.statuses, undefined);
  assert.equal(ci.jobs.plan.if, "${{ !inputs.full_health_bootstrap }}");
  assert(bootstrap.steps.some((s: any) => s.run === "node scripts/full-health.mjs --bootstrap --publish"));
});


test("CLI dry run reads real HTTP facts without writes; normal publisher refuses a non-master checkout", async t => {
  const runs = [run(1)];
  const { endpoint, posts } = await fixture(t, { runs });
  const env = { ...process.env, GITHUB_REPOSITORY: REPOSITORY, GITHUB_TOKEN: "fixture", GITHUB_API_URL: endpoint,
    GITHUB_SHA: old, CHECKED_OUT_SHA: old, GITHUB_REF: "refs/heads/feature", GITHUB_EVENT_NAME: "workflow_dispatch" };
  const execute = promisify(execFile);
  const output = await execute(process.execPath, ["scripts/full-health.mjs"], { env });
  assert.equal(JSON.parse(output.stdout)[0].state, "success");
  await assert.rejects(execute(process.execPath, ["scripts/full-health.mjs", "--publish"], { env }), /trusted master checkout/);
  assert.equal(posts.length, 0);
  const published = await execute(process.execPath, ["scripts/full-health.mjs", "--publish"], {
    env: { ...env, GITHUB_REF: "refs/heads/master", GITHUB_SHA: master, CHECKED_OUT_SHA: master }
  });
  assert.equal(JSON.parse(published.stdout)[0].state, "success");
  assert.equal(posts.at(-1).state, "success");
  // Event A queued; checkout/live master is now B. It must revoke the old green
  // and publish B's pending full rather than reject event/checkout SHA mismatch.
  runs.push(run(2, master, { status: "in_progress", conclusion: null }));
  const before = posts.length;
  const lateEvent = await execute(process.execPath, ["scripts/full-health.mjs", "--publish"], {
    env: { ...env, GITHUB_REF: "refs/heads/master", GITHUB_SHA: old, CHECKED_OUT_SHA: master }
  });
  assert.equal(JSON.parse(lateEvent.stdout)[0].state, "pending");
  assert(posts.slice(before).every(p => p.state === "pending"));
});
