import assert from "node:assert/strict";
import test from "node:test";
import { changedTestCandidate } from "../../fixtures/changed-test-candidate.js";
import { createChangedTestPlan, readCandidate } from "../../../../scripts/ci/changed-test-plan.mjs";

test("an exact two-parent candidate selects added, modified and renamed targets", async t => {
  const f = await changedTestCandidate(t);
  await f.put("test/old.system.test.ts", "export const old = 'rename target';");
  await f.put("test/modified.system.test.ts", "");
  const initial = await f.commit("initial");
  await f.git("switch", "-c", "feature");
  await f.git("mv", "test/old.system.test.ts", "test/renamed.system.test.ts");
  await f.put("test/modified.system.test.ts", "export const changed = true;");
  await f.put("test/added.system.test.ts", "");
  const head = await f.commit("feature");
  await f.git("switch", "master");
  await f.put("README.md", "base-only change");
  const base = await f.commit("latest base");
  await f.git("merge", "--no-ff", "--no-edit", "feature");
  const candidate = await f.git("rev-parse", "HEAD");
  const result = createChangedTestPlan(await readCandidate(f.root, base, { candidate, head }));
  assert.equal(result.status, "planned");
  assert.deepEqual(result.jobs[0].files.map(file => file.path), [
    "added.system.test.ts", "modified.system.test.ts", "renamed.system.test.ts"
  ]);
  assert.equal(result.jobs[0].files[2].triggers[0].source, "test/old.system.test.ts");
  await assert.rejects(readCandidate(f.root, initial, { candidate, head }), /fixed PR merge candidate/);
  await assert.rejects(readCandidate(f.root, base, { candidate: head, head }), /fixed PR merge candidate/);
  await assert.rejects(readCandidate(f.root, base.slice(0, 8)), /full base commit SHA/);
  await f.put("test/uncommitted.system.test.ts", "");
  await assert.rejects(readCandidate(f.root, base, { candidate, head }), /clean checkout/);
});
