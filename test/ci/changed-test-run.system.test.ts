import assert from "node:assert/strict";
import { symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import crossSpawn from "cross-spawn";
import { changedTestCandidate } from "./fixtures/changed-test-candidate.js";

test("test:changed only runs its selected file and requires a genuine finished Node test", { timeout: 60000 }, async t => {
  const f = await changedTestCandidate(t);
  const script = resolve("scripts/ci/test-changed.mjs").replaceAll("\\", "/");
  await symlink(resolve("node_modules"), join(f.root, "node_modules"), "junction");
  await f.put("package.json", JSON.stringify({
    type: "module", scripts: {
      build: 'node -e "console.log(\'build fixture ready\')"',
      "test:changed": `node ${JSON.stringify(script)}`
    }
  }));
  await f.put("test/unselected.system.test.ts", 'throw new Error("unselected test ran");');
  const base = await f.commit("base");
  const exec = (...args: string[]) => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = crossSpawn.sync("npm", ["run", "test:changed", "--", "--base", base, ...args],
      { cwd: f.root, env, encoding: "utf8", timeout: 15000 });
    if (result.error) throw result.error;
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  const selected = "test/selected.system.test.ts";
  const save = async (content: string) => {
    await f.put(selected, content);
    await f.commit("update selected file");
  };
  await save('import test from "node:test"; test("normal", () => {}); test.skip("not for this platform", () => {});');
  const dry = exec("--dry-run");
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stdout, /"status": "planned"/);
  assert.doesNotMatch(dry.stdout, /build fixture ready|# Starting:|unselected.system.test.ts/);
  const pass = exec();
  // A local execution can prove only one of the three planned platform rows.
  assert.equal(pass.code, 2, pass.stderr);
  assert.deepEqual([...pass.stdout.matchAll(/^# Starting: (.*)$/gm)].map(match => match[1]), ["selected.system.test.ts"]);
  assert.match(pass.stdout, /"status": "passed"/);
  assert.match(pass.stdout, /"executed": 1/);
  assert.match(pass.stdout, /"skipped": 1/);
  assert.match(pass.stdout, /"reason": "missing_job"/);
  assert.doesNotMatch(pass.stdout, /unselected test ran/);

  for (const content of [
    'import test from "node:test"; test.skip("platform-only", () => {});',
    'import test from "node:test"; test.todo("deferred");',
    "",
    'process.exit(0);'
  ]) {
    await save(content);
    const missing = exec();
    assert.equal(missing.code, 2, missing.stderr);
    assert.match(missing.stdout, /"status": "incomplete"/);
    assert.match(missing.stdout, /"reason": "file_not_passed"/);
    assert.doesNotMatch(missing.stdout, /"status": "passed"/);
  }
  await save('import test, { after } from "node:test"; test("early pass", () => {}); after(() => { throw new Error("late failure"); });');
  const fail = exec();
  assert.equal(fail.code, 1, fail.stdout + fail.stderr);
  assert.match(fail.stdout, /late failure/);
  assert.match(fail.stdout, /"executed": 1/);
  assert.match(fail.stdout, /"failedEvents": 1/);
  assert.match(fail.stdout, /"status": "failed"/);
});

test("a packaged-cli-only candidate produces a Windows shell handoff without running a generic test", async t => {
  const f = await changedTestCandidate(t);
  await f.put("test/packaged-cli/windows-shell-smoke.cmd", "@echo before\n");
  const base = await f.commit("base");
  await f.put("test/packaged-cli/windows-shell-smoke.cmd", "@echo after\n");
  await f.commit("package shell only");
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = crossSpawn.sync(process.execPath,
    [resolve("scripts/ci/test-changed.mjs"), "--base", base], { cwd: f.root, env, encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /"status": "needs_evidence"/);
  assert.match(result.stdout, /Windows packaged CLI shells.*PowerShell 5\.1.*Git Bash/);
  assert.match(result.stdout, /"status": "incomplete"/);
  assert.doesNotMatch(result.stdout, /# Starting:|"status": "passed"/);
});
