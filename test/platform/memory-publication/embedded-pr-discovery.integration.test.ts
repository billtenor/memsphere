import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runGit } from "../../../src/git.js";
import { validateMemoryChange } from "../../../src/memory/changeset.js";
import { createGhTransport, discoverPullRequests } from "../../../src/memory/embedded-context.js";
import { EmbeddedChangeAmbiguityError } from "../../../src/memory/embedded-bindings.js";
import { concept, fixture, ghFixture } from "../../helpers/embedded-continuation.js";

test("real gh process discovers later-page PR and supplements the detached/branch record", async () => fixture(async f => {
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("Change"));
  const first = await validateMemoryChange();
  await runGit(["switch", "-c", "feature"]);
  await runGit(["remote", "add", "origin", "https://github.com/owner/repo.git"]);
  await runGit(["config", "push.default", "current"]);
  const unavailable = await validateMemoryChange(undefined, { prTransport: createGhTransport(join(f.home, "missing-gh")) });
  assert.equal(unavailable.changeId, first.changeId); assert.equal(unavailable.prDiscovery?.status, "unknown");
  const result = await validateMemoryChange(undefined, { prTransport: await ghFixture(f.home, [153]) });
  assert.equal(result.changeId, first.changeId);
  assert.deepEqual(result.bindings?.pull_requests, [{ host: "github.com", repository: "owner/repo", number: 153 }]);
  assert.equal(result.bindings?.worktrees.length, 1);
  const multi = await ghFixture(f.home, [153, 154]);
  await assert.rejects(validateMemoryChange(undefined, { prTransport: multi }), EmbeddedChangeAmbiguityError);
  const explicit = await validateMemoryChange(first.changeId, { prTransport: multi });
  assert.equal(explicit.bindings?.pull_requests.length, 2);
  const discovered = await discoverPullRequests(f.linked, "refs/heads/feature", [], multi);
  assert.equal(discovered.discovery.status, "ambiguous");
}));

test("gh real transport propagates nonzero, malformed output and bounded timeout as unknown discovery", async () => fixture(async f => {
  await runGit(["switch", "-c", "feature"]); await runGit(["remote", "add", "origin", "git@github.com:owner/repo.git"]); await runGit(["config", "push.default", "current"]);
  const script = join(f.home, "bad-gh.cjs");
  for (const body of ["process.exit(7)", "process.stdout.write('malformed')"]) {
    await writeFile(script, body);
    assert.equal((await discoverPullRequests(f.linked, "refs/heads/feature", [], createGhTransport(process.execPath, [script]))).discovery.status, "unknown");
  }
  await writeFile(script, "setTimeout(()=>process.stdout.write('{}'),10000)");
  const transport = createGhTransport(process.execPath, [script]);
  await assert.rejects(transport([], f.linked, 40), error => Boolean((error as { killed?: boolean }).killed));
  const bounded = (args: string[], cwd: string) => transport(args, cwd, 40);
  assert.equal((await discoverPullRequests(f.linked, "refs/heads/feature", [], bounded)).discovery.status, "unknown");
}));

test("fork pushurl and renamed push ref discover parent PR even without an upstream remote", async () => fixture(async f => {
  await runGit(["switch", "-c", "local"]);
  await runGit(["remote", "add", "origin", "https://github.com/fetch-only/repo.git"]);
  await runGit(["config", "remote.origin.pushurl", "git@github.com:fork/repo.git"]);
  await runGit(["config", "remote.origin.push", "refs/heads/local:refs/heads/feature"]);
  const script = join(f.home, "fork-gh.cjs");
  await writeFile(script, `const endpoint=process.argv.at(-1); if(endpoint.includes('/pulls?')) {
    if(!endpoint.includes('head=fork%3Afeature'))process.exit(9);
    console.log(JSON.stringify([[{number:153,head:{ref:'feature',repo:{full_name:'fork/repo'}},base:{ref:'master',repo:{full_name:'parent/repo'}}}]]));
  } else console.log(JSON.stringify({full_name:'fork/repo',fork:true,parent:{full_name:'parent/repo'},source:{full_name:'parent/repo'}}));`);
  const transport = createGhTransport(process.execPath, [script]);
  const result = await discoverPullRequests(f.linked, "refs/heads/local", [], transport);
  assert.equal(result.discovery.status, "found"); assert.deepEqual(result.pullRequests, [{ host: "github.com", repository: "parent/repo", number: 153 }]);
  await runGit(["config", "--add", "remote.origin.pushurl", "git@github.com:another/repo.git"]);
  assert.equal((await discoverPullRequests(f.linked, "refs/heads/local", [], transport)).discovery.status, "unknown");
}));
