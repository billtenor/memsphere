// @integration-platform: native — verifies real filesystem, process or build-adapter behavior.
import assert from "node:assert/strict";

import { createHash } from "node:crypto";

import { withNativeFileLock } from "../src/file-lock.js";

import test from "node:test";

import { mkdir, readFile, writeFile } from "node:fs/promises";

import { join } from "node:path";

import { openContextControl } from "../src/project/context-control.js";

import { initializedContextFixture } from "./helpers/initialized-context.js";

import { businessFixture } from "./helpers/business-data.js";

import { textContent } from "../src/context_control/types.js";

import { reviewCommentId } from "../src/review-nodes.js";

function barrier() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return { entered, release, wait: async () => { enter(); await released; } };
}

test("lightweight Review historical comment IDs remain readable without rewriting persisted bytes or revision", async t => {
  const { root } = await initializedContextFixture(t), service = (await openContextControl(root))!;
  const run = await service.start("Historical Review");
  const artifact = await service.report(run.id, { name: "Candidate", content: textContent("Candidate") });
  const review = await service.review(run.id, artifact.artifact.id, "agent", ["Existing opinion"]);
  const path = join(root, "data/context_control/reviews", run.id, `${review.id}.json`);
  const record = JSON.parse(await readFile(path, "utf8"));
  record.value.comments[0].id = record.value.comments[0].commentId;
  delete record.value.comments[0].commentId;
  await writeFile(path, JSON.stringify(record)); const bytes = await readFile(path, "utf8");
  const reopened = (await openContextControl(root))!;
  const read = (await reopened.snapshot(run.id)).reviews.find(r => r.id === review.id)!;
  assert.equal(reviewCommentId(read.comments[0]), review.comments[0].commentId);
  assert.equal(await readFile(path, "utf8"), bytes);
});

test("Context Control ignores former Project and Run gates for recovery and independent writes", async t => {
  const { root } = await initializedContextFixture(t);
  const service = (await openContextControl(root))!;
  const a = await service.start("A"), b = await service.start("B");
  await mkdir(join(root, ".runtime", "context-control"), { recursive: true });
  await withNativeFileLock(join(root, ".runtime", "settings.lock"), async () => {
    const reopened = (await openContextControl(root))!;
    const runLock = join(root, ".runtime", "context-control", `${createHash("sha256").update(a.id).digest("hex")}.lock`);
    await withNativeFileLock(runLock, async () => {
      assert.equal((await reopened.snapshot(a.id)).run.id, a.id);
      const result = await reopened.report(b.id, { name: "independent", content: textContent("B") });
      assert.equal(result.step.status, "done");
      assert.equal((await reopened.snapshot(b.id)).artifacts.length, 1);
    });
  });
});

test("free exploration persists model-backed create/read/report and immutable revisions across reopening", async t => {
  const { root } = await businessFixture(t, {});
  assert.equal(await openContextControl(root), undefined);
  const service = (await openContextControl(root, true))!;
  const run = await service.start("探索");
  const first = await service.report(run.id, { name: "要求", content: textContent("离线可用") });
  const target = await service.createArtifact(run.id, { name: "方案", tags: ["design"] });
  assert.equal(target.status, "draft");
  assert.equal(Buffer.from((await service.readArtifact(run.id, first.artifact.id)).bytes).toString(), "离线可用");
  assert.deepEqual(await service.recordRead(run.id, target.id, { kind: "artifact", id: first.artifact.id }), []);
  const result = await service.report(run.id, { target: target.id, content: textContent("本地快照"), dependsOn: ["tag:default"] });
  assert.equal(result.artifact.id, target.id); assert.equal(result.step.status, "done");
  assert.deepEqual(result.artifact.dependencies, [{ kind: "artifact", id: first.artifact.id }]);
  assert.ok(result.step.reads?.[`artifact:${first.artifact.id}`]);
  const review = await service.review(run.id, target.id, "human", ["补充恢复", "补充测试"]);
  assert.equal(review.comments.length, 2); assert.notEqual(review.comments[0].commentId, review.comments[1].commentId);
  for (const comment of review.comments) { assert.ok(comment.commentId); assert.equal(comment.id, undefined); }
  const revised = await service.report(run.id, { revisedFrom: target.id, content: textContent("完整方案") });
  assert.deepEqual(revised.artifact.dependencies, result.artifact.dependencies);
  assert.notEqual(revised.artifact.id, target.id);
  const reopened = (await openContextControl(root))!;
  assert.equal((await reopened.snapshot(run.id)).artifacts.length, 3);
  assert.deepEqual((await reopened.snapshot(run.id)).reviews.find(r => r.id === review.id)?.comments, review.comments);
  const path = join(root, "data/context_control/artifacts", run.id, `${target.id}.json`);
  assert.equal(JSON.parse(await readFile(path, "utf8")).value.id, target.id);
  await reopened.finish(run.id, [revised.artifact.id]);
  await reopened.finish(run.id, [revised.artifact.id]);
  await assert.rejects(reopened.tag(run.id, target.id, ["late"]), { code: "RUN_FINISHED" });
});
