import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";




import { fileURLToPath } from "node:url";
import crossSpawn from "cross-spawn";
import { createAgentReviewCliRuntime } from "../src/acp/cli-runtime.js";
import { buildArtifactReviewerPrompt } from "../src/acp/prompt.js";
import * as reviews from "../src/context_control/review-repository.js";

import { reviewMaterialFixture } from "./helpers/review-node-materials.js";

test("restricted material CLI preserves both legitimate input Artifact IDs for exact graph anchors", async t => {
  const f = await reviewMaterialFixture(t);
  const runtime = await createAgentReviewCliRuntime({ nodeExecutable: process.execPath, cliEntrypoint: fileURLToPath(new URL("../dist/cli.js", import.meta.url)) });
  t.after(() => runtime.cleanup());
  const r = crossSpawn.sync(runtime.launcherPath, ["run", "artifact", "show", "--assignment", f.claimed.assignment.id!, "--output", "json"], {
    cwd: f.cwd, encoding: "utf8", env: {
      ...process.env, MEMSPHERE_HOME: f.home, MEMSPHERE_CONFIG_PATH: join(f.root, "config.json"), MEMSPHERE_WORKSPACE_ROOT: f.cwd,
      MEMSPHERE_REVIEW_RUN_ID: f.runId, MEMSPHERE_REVIEW_ASSIGNMENT_ID: f.claimed.assignment.id!, MEMSPHERE_REVIEW_ATTEMPT_ID: f.bound.attemptId
    }
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const payload = JSON.parse(r.stdout);
  assert.deepEqual(payload.contextArtifacts.map((a: { artifactId: string }) => a.artifactId).sort(), [f.result.materials.inputA, f.result.materials.inputB].sort());
  assert.equal(payload.contextArtifacts.some((a: { artifactId: string }) => a.artifactId === f.result.materials.unrelated), false);
  for (const name of ["inputA", "inputB"]) {
    const input = payload.contextArtifacts.find((a: { artifactId: string }) => a.artifactId === f.result.materials[name]);
    assert.equal(input.artifact.name, name);
    assert.match(input.artifact.value, new RegExp(name));
  }
  const prompt = await buildArtifactReviewerPrompt({ context: await reviews.readArtifactReviewForActor(f.input), locale: "en", promptVersion: "artifact-review-v3" });
  assert.ok(prompt.includes(f.result.materials.inputA));
  assert.ok(prompt.includes(f.result.materials.inputB));
  assert.equal(prompt.includes(f.result.materials.unrelated), false);
});
