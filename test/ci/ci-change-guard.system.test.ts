import assert from "node:assert/strict";
import { execFile } from "node:child_process";

import { createServer } from "node:http";
import test from "node:test";
import { promisify } from "node:util";
import { parse } from "yaml";
import { createApi, REPOSITORY } from "../../scripts/ci/full-health.mjs";
import { CONTEXT, HUMAN_INSTRUCTIONS } from "../../scripts/ci/ci-change-guard.mjs";

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

test("publisher CLI succeeds for published decisions and fails for query or publication errors", async t => {
  const execute = promisify(execFile);
  for (const protectedFile of [false, true]) {
    await t.test(protectedFile ? "protected change keeps only the guard red" : "ordinary change passes", async t => {
      const f = await fixture(t, { files: [changed(protectedFile ? "scripts/ci/future.mjs" : "src/cli.ts")] });
      const result = await execute(process.execPath, ["scripts/ci/ci-change-guard.mjs", "--publish"], {
        env: { ...process.env, GITHUB_TOKEN: "fixture", GITHUB_API_URL: f.endpoint }
      });
      assert.equal(f.posts.at(-1).state, protectedFile ? "failure" : "success");
      assert(f.posts.every(p => p.context === CONTEXT && p.sha === head));
      if (protectedFile) assert(result.stdout.includes(HUMAN_INSTRUCTIONS));
    });
  }
  for (const failure of ["query", "publish"]) {
    await t.test(`${failure} errors fail the publisher`, async t => {
      const f = await fixture(t, {
        reply: (path: string, _url: URL, req: any) =>
          (failure === "query" ? path.endsWith("/files") : req.method === "POST")
            ? { status: 503, value: {} } : undefined
      });
      await assert.rejects(execute(process.execPath, ["scripts/ci/ci-change-guard.mjs", "--publish"], {
        env: { ...process.env, GITHUB_TOKEN: "fixture", GITHUB_API_URL: f.endpoint }
      }), (error: any) => error.code === 1);
      assert(!f.posts.some(p => p.state === "success"));
      if (failure === "query") assert.equal(f.posts.at(-1).state, "error");
    });
  }
});