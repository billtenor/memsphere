import assert from "node:assert/strict";

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { parse } from "yaml";
import { FULL_JOB, REPOSITORY, WORKFLOW_ID, createApi } from "../../scripts/ci/full-health.mjs";

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


test("CLI dry run reads real HTTP facts without writes; normal publisher refuses a non-master checkout", async t => {
  const runs = [run(1)];
  const { endpoint, posts } = await fixture(t, { runs });
  const env = { ...process.env, GITHUB_REPOSITORY: REPOSITORY, GITHUB_TOKEN: "fixture", GITHUB_API_URL: endpoint,
    GITHUB_SHA: old, CHECKED_OUT_SHA: old, GITHUB_REF: "refs/heads/feature", GITHUB_EVENT_NAME: "workflow_dispatch" };
  const execute = promisify(execFile);
  const output = await execute(process.execPath, ["scripts/ci/full-health.mjs"], { env });
  assert.equal(JSON.parse(output.stdout)[0].state, "success");
  await assert.rejects(execute(process.execPath, ["scripts/ci/full-health.mjs", "--publish"], { env }), /trusted master checkout/);
  assert.equal(posts.length, 0);
  const published = await execute(process.execPath, ["scripts/ci/full-health.mjs", "--publish"], {
    env: { ...env, GITHUB_REF: "refs/heads/master", GITHUB_SHA: master, CHECKED_OUT_SHA: master }
  });
  assert.equal(JSON.parse(published.stdout)[0].state, "success");
  assert.equal(posts.at(-1).state, "success");
  // Event A queued; checkout/live master is now B. It must revoke the old green
  // and publish B's pending full rather than reject event/checkout SHA mismatch.
  runs.push(run(2, master, { status: "in_progress", conclusion: null }));
  const before = posts.length;
  const lateEvent = await execute(process.execPath, ["scripts/ci/full-health.mjs", "--publish"], {
    env: { ...env, GITHUB_REF: "refs/heads/master", GITHUB_SHA: old, CHECKED_OUT_SHA: master }
  });
  assert.equal(JSON.parse(lateEvent.stdout)[0].state, "pending");
  assert(posts.slice(before).every(p => p.state === "pending"));
});