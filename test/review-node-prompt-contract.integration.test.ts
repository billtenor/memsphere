// @integration-platform: native — verifies real filesystem, process or build-adapter behavior.
import assert from "node:assert/strict";
import test from "node:test";

import { writeFile } from "node:fs/promises";
import { buildAgentReviewContract } from "../src/acp/review-contract.js";
import { readMemoryFile } from "../src/memory/store.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";



import { buildArtifactReviewerPrompt, buildArtifactReviewerReminder } from "../src/acp/prompt.js";
import * as reviews from "../src/context_control/review-repository.js";
import { reviewNodeFixture } from "./helpers/review-nodes.js";


for (const graph of [true, false]) for (const locale of ["en", "zh-CN"] as const) {
  test(`${graph ? "graph" : "flow"} v3 ${locale}: frozen permissions and review-only boundary survive initial and reminder rendering`, async t => {
    const f = await reviewNodeFixture(t, graph);
    const context = await reviews.readArtifactReviewForActor(f.input);
    const prompt = await buildArtifactReviewerPrompt({ context, locale, promptVersion: "artifact-review-v3" });
    assert.match(prompt, /memsphere memory change show/);
    assert.match(prompt, /--checkpoint/);
    assert.match(prompt, locale === "en" ? /no --run is added automatically/ : /不会自动添加 --run/);
    assert.match(prompt, locale === "en" ? /Formal review rules and contracts always use the frozen version/ : /正式评审规则与契约始终采用冻结版本/);
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

for (const graph of [true, false]) test(`${graph ? "graph" : "flow"} formal rules remain frozen after current Project Statement changes`, async t => {
  const f = await reviewNodeFixture(t, graph, false, { statementRule: true });
  const before = await reviews.readArtifactReviewForActor(f.input);
  const contract = buildAgentReviewContract(before);
  assert.match(JSON.stringify(contract), /Frozen dependency rule/);
  await writeFile(f.ruleFile, withCurrentMemorySyntax("!statement\nnames: [checkpoint-rules]\nasserts: [Current Project rule changed.]\n"));
  assert.match(JSON.stringify((await readMemoryFile("statements", f.ruleFile)).entity), /Current Project rule changed/);
  const after = await reviews.readArtifactReviewForActor(f.input);
  assert.deepEqual(buildAgentReviewContract(after), contract);
  assert.deepEqual(after.assignment.nodeTree, before.assignment.nodeTree);
  assert.doesNotMatch(JSON.stringify(after.assignment.nodeTree), /Current Project rule changed/);
});

test("All supported legacy reviewer prompts describe explicit Run reads and equivalent parameter defaults", async t => {
  const f = await reviewNodeFixture(t, false);
  const context = await reviews.readArtifactReviewForActor(f.input);
  context.assignment.nodeTree = undefined;
  for (const promptVersion of ["artifact-review-v1", "artifact-review-v2"]) for (const locale of ["en", "zh-CN"] as const) {
    const prompt = await buildArtifactReviewerPrompt({ context, locale, promptVersion });
    assert.match(prompt, /--part summary/); assert.match(prompt, /--side after/);
    assert.match(prompt, /memory change show/);
    assert.match(prompt, locale === "en" ? /no --run is added automatically/ : /不会自动添加 --run/);
    assert.doesNotMatch(prompt, /automatically bind their frozen|会自动绑定其冻结/);
  }
});