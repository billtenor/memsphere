import assert from "node:assert/strict";


import { createServer } from "node:http";
import test from "node:test";

import { parse } from "yaml";
import { createApi, REPOSITORY } from "../../scripts/ci/full-health.mjs";
import { AUTHORIZATION_MESSAGE, CONTEXT, HUMAN_INSTRUCTIONS, readPullFiles, refreshGuard } from "../../scripts/ci/ci-change-guard.mjs";

const head = "a".repeat(40);
const base = "b".repeat(40);
const next = "c".repeat(40);
const changed = (filename: string, status = "modified", extra = {}) => ({ filename, status, ...extra });
const pull = (extra = {}) => ({ number: 123, state: "open", head: { sha: head }, base: { ref: "master", sha: base }, changed_files: 1, ...extra });
const targetUrl = `https://github.com/${REPOSITORY}/actions/runs/123`;

async function fixture(t: any, options: any = {}) {
  const posts: any[] = [];
  const requests: string[] = [];
  const files = options.files || [changed("src/cli.ts")];
  const initial = options.pulls || [pull({ changed_files: files.length })];
  let reads = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const path = url.pathname.replace(`/repos/${REPOSITORY}`, "");
    requests.push(`${path}${url.search}`);
    const custom = await options.reply?.(path, url, req);
    let value: any;
    let status = 200;
    if (custom) { status = custom.status || 200; value = custom.value; }
    else if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      posts.push({ sha: path.split("/").at(-1), ...JSON.parse(body) });
      value = {};
    } else if (path === "") value = { full_name: REPOSITORY, default_branch: "master" };
    else if (path === "/pulls") value = initial;
    else if (path.endsWith("/files")) {
      const page = Number(url.searchParams.get("page"));
      value = files.slice((page - 1) * 100, page * 100);
    } else if (/^\/pulls\/\d+$/.test(path)) value = options.current?.(++reads) || initial.find((p: any) => p.number === Number(path.split("/").at(-1)));
    else { status = 404; value = {}; }
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address: any = server.address();
  const endpoint = `http://127.0.0.1:${address.port}`;
  return { api: createApi({ token: "fixture", apiUrl: endpoint }), endpoint, posts, requests };
}

test("ordinary PR publishes pending then success to its current head, with a run details link", async t => {
  const f = await fixture(t);
  const reports = await refreshGuard(f.api, { publish: true, log: () => {}, targetUrl });
  assert.equal(reports[0].state, "success");
  assert.deepEqual(f.posts.map(p => p.state), ["pending", "pending", "success"]);
  assert(f.posts.every(p => p.sha === head && p.context === CONTEXT && p.target_url === targetUrl));
});

test("protected PR publishes failure and complete Human-facing logs instead of treating authorization as success", async t => {
  const f = await fixture(t, { files: [changed(".github/workflows/new.yml", "renamed", { previous_filename: ".github/workflows/ci.yml" })] });
  const logs: string[] = [];
  const reports = await refreshGuard(f.api, { publish: true, log: (line: string) => logs.push(line), targetUrl });
  assert.equal(reports[0].state, "failure");
  assert.deepEqual(reports[0].paths, [".github/workflows/ci.yml", ".github/workflows/new.yml"]);
  assert.equal(f.posts.at(-1).state, "failure");
  assert(logs.some(line => line.includes(".github/workflows/ci.yml") && line.includes(AUTHORIZATION_MESSAGE)));
  assert(logs.some(line => line.includes(".github/workflows/new.yml") && line.includes(AUTHORIZATION_MESSAGE)));
  assert(logs.includes(HUMAN_INSTRUCTIONS));
});

test("a protected change beyond the first page cannot pass the guard", async t => {
  const files = [...Array.from({ length: 100 }, (_, i) => changed(`src/${i}.ts`)), changed("scripts/ci/ci-plan.mjs")];
  const f = await fixture(t, { files });
  const reports = await refreshGuard(f.api, { publish: true, log: () => {} });
  assert.equal(reports[0].state, "failure");
  assert(f.requests.includes("/pulls/123/files?per_page=100&page=2"));
});

test("unreadable, truncated, duplicate, over-limit or malformed diffs never publish success", async t => {
  const cases = [
    { current: () => pull({ changed_files: 3001 }) },
    { current: () => pull({ changed_files: undefined }) },
    { current: () => pull({ changed_files: 2 }) },
    { files: [changed("src/a.ts"), changed("src/a.ts")] },
    { files: [changed("docs/new.txt", "renamed")] },
    { files: [changed("docs/new.txt", "unknown")] },
    { reply: (path: string) => path.endsWith("/files") ? { status: 503, value: {} } : undefined },
    { reply: (path: string) => path.endsWith("/files") ? { value: {} } : undefined }
  ];
  for (const options of cases) {
    const f = await fixture(t, options);
    const reports = await refreshGuard(f.api, { publish: true, log: () => {} });
    assert.equal(reports[0].state, "error");
    assert(!f.posts.some(p => p.state === "success"));
    assert.equal(f.posts.at(-1).state, "error");
  }
});

test("the documented 3000-file boundary is complete rather than silently truncated", async t => {
  const files = Array.from({ length: 3000 }, (_, i) => changed(`src/${i}.ts`));
  const f = await fixture(t, { files });
  assert.equal((await readPullFiles(f.api, pull({ changed_files: 3000 }))).length, 3000);
  assert(f.requests.at(-1)?.endsWith("page=30"));
});

test("head and base changes discard the previous diff and recompute before granting success", async t => {
  for (const change of ["head", "base"]) {
    const current = pull({ [change]: change === "head" ? { sha: next } : { ref: "master", sha: next } });
    const f = await fixture(t, { current: (read: number) => read === 1 ? pull() : current });
    const reports = await refreshGuard(f.api, { publish: true, log: () => {} });
    assert.equal(reports[0].state, "success");
    assert.equal(f.requests.filter(p => p.includes("/files?")).length, 2);
    assert.equal(f.posts.filter(p => p.state === "success").length, 1);
    assert.equal(f.posts.at(-1).sha, change === "head" ? next : head);
  }
});

test("a continually moving PR produces error while a closed or retargeted PR receives no green result", async t => {
  const moving = await fixture(t, { current: (read: number) => pull({ base: { ref: "master", sha: (read % 2 ? base : next) } }) });
  assert.equal((await refreshGuard(moving.api, { publish: true, log: () => {} }))[0].state, "error");
  assert(!moving.posts.some(p => p.state === "success"));
  for (const current of [pull({ state: "closed" }), pull({ base: { ref: "other", sha: base } })]) {
    const f = await fixture(t, { current: () => current });
    assert.deepEqual(await refreshGuard(f.api, { publish: true, log: () => {} }), []);
    assert(!f.posts.some(p => p.state === "success"));
  }
});

test("one failed PR query invalidates all listed old greens and still evaluates other PRs", async t => {
  const f = await fixture(t, { pulls: [pull(), pull({ number: 124 })], reply: (path: string) => path === "/pulls/123/files" ? { status: 503, value: {} } : undefined });
  const reports = await refreshGuard(f.api, { publish: true, log: () => {} });
  assert.deepEqual(f.posts.slice(0, 2).map(p => p.state), ["pending", "pending"]);
  assert.deepEqual(reports.map(r => r.state), ["error", "success"]);
});

test("dry-run evaluates current facts without writing any statuses", async t => {
  const f = await fixture(t, { files: [changed("scripts/ci/ci-plan.mjs")] });
  assert.equal((await refreshGuard(f.api, { log: () => {} }))[0].state, "failure");
  assert.deepEqual(f.posts, []);
});