// @integration-platform: native — verifies real filesystem, process or build-adapter behavior.
import assert from "node:assert/strict";
import test from "node:test";

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverTestFiles } from "../../scripts/ci/test-plan.mjs";

test("test discovery retains root tests and recursively includes CI subdirectories", async t => {
  const directory = await mkdtemp(join(tmpdir(), "memsphere-test-discovery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "ci", "nested"), { recursive: true });
  await Promise.all(["root.test.ts", "ci/guard.test.ts", "ci/nested/future.test.ts", "ci/helper.ts", "README.md"]
    .map(file => writeFile(join(directory, file), "")));
  assert.deepEqual(await discoverTestFiles(directory), ["ci/guard.test.ts", "ci/nested/future.test.ts", "root.test.ts"]);
});