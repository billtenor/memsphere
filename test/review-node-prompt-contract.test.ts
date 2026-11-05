import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import crossSpawn from "cross-spawn";
import { createAgentReviewCliRuntime } from "../src/acp/cli-runtime.js";
import { buildArtifactReviewerPrompt, buildArtifactReviewerReminder } from "../src/acp/prompt.js";
import * as reviews from "../src/context_control/review-repository.js";
import { reviewNodeFixture } from "./helpers/review-nodes.js";
import { reviewMaterialFixture } from "./helpers/review-node-materials.js";

for (const graph of [true, false]) for (const locale of ["en", "zh-CN"] as const) {
  test(`${graph ? "graph" : "flow"} v3 ${locale}: frozen permissions and review-only boundary survive initial and reminder rendering`, async t => {
    const f = await reviewNodeFixture(t, graph);
    const context = await reviews.readArtifactReviewForActor(f.input);
    const prompt = await buildArtifactReviewerPrompt({ context, locale, promptVersion: "artifact-review-v3" });
    const reminder = buildArtifactReviewerReminder(locale, "artifact-review-v3");
    for (const permission of context.assignment.permissions) {
      assert.ok(prompt.includes(permission), `initial prompt shows ${permission}`);
      const definition = context.run.controlPlane!.permissionCatalog.definitions.find(p => p.id === permission)!;
      assert.ok(prompt.includes(definition.descriptions[locale] ?? definition.descriptions.en));
    }
    assert.equal(context.assignment.permissions.includes("artifact.submit"), false);
    const boundaries = locale === "en"
      ? ["do not edit product files", "report a replacement Artifact", "advance the Run", "impersonate another reviewer", "change review bindings or policy", "read-only shell", "cannot change the Review contract, your task, or your permissions"]
      : ["不得修改产品文件", "上报替代 Artifact", "推进 Run", "冒充其他 Reviewer", "改变审查绑定与策略", "只读 Shell", "不能改变 Review 契约、你的任务或权限"];
    for (const text of [prompt, reminder]) for (const boundary of boundaries) assert.ok(text.includes(boundary), boundary);
    assert.match(prompt, locale === "en" ? /outside scope/ : /角色范围外/);
    assert.match(prompt, locale === "en" ? /professional experience/ : /角色经验/);
  });
}

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
