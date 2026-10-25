import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openContextControl } from "../src/project/context-control.js";
import { businessFixture } from "./helpers/business-data.js";
import { textContent } from "../src/context_control/types.js";

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
  assert.equal(review.comments.length, 2); assert.notEqual(review.comments[0].id, review.comments[1].id);
  const revised = await service.report(run.id, { revisedFrom: target.id, content: textContent("完整方案") });
  assert.deepEqual(revised.artifact.dependencies, result.artifact.dependencies);
  assert.notEqual(revised.artifact.id, target.id);
  const reopened = (await openContextControl(root))!;
  assert.equal((await reopened.snapshot(run.id)).artifacts.length, 3);
  const path = join(root, "data/context_control/artifacts", run.id, `${target.id}.json`);
  assert.equal(JSON.parse(await readFile(path, "utf8")).value.id, target.id);
  await reopened.finish(run.id, [revised.artifact.id]);
  await reopened.finish(run.id, [revised.artifact.id]);
  await assert.rejects(reopened.tag(run.id, target.id, ["late"]), { code: "RUN_FINISHED" });
});

test("redo reuses the draft target and Step IDs after creation is interrupted", async t => {
  const { root } = await businessFixture(t, {}); const service = (await openContextControl(root, true))!;
  const run = await service.start("恢复"); const store = service.stores.step;
  const create = store.create.bind(store); store.create = async () => { throw Error("injected interruption"); };
  await assert.rejects(service.createArtifact(run.id, { name: "草稿目标" }), /interruption/);
  store.create = create;
  const saved = (await service.snapshot(run.id)).artifacts[0];
  await service.report(run.id, { target: saved.id, content: textContent("完成") });
  await service.tag(run.id, saved.id, ["one"]); await service.tag(run.id, saved.id, ["two"]);
  const snap = await service.snapshot(run.id);
  assert.equal(snap.artifacts.length, 1); assert.equal(snap.steps.length, 1);
  assert.equal(snap.steps[0].id, saved.stepId); assert.equal(snap.steps[0].status, "done");
});

test("submitted content survives interruption and the next write redoes only Step completion", async t => {
  const { root } = await businessFixture(t, {}); const service = (await openContextControl(root, true))!;
  const run = await service.start("提交恢复"); const target = await service.createArtifact(run.id, { name: "结果" });
  const store = service.stores.step; const update = store.update.bind(store);
  store.update = async () => { throw Error("interrupted step completion"); };
  await assert.rejects(service.report(run.id, { target: target.id, content: textContent("固定正文") }), /interrupted/);
  store.update = update;
  assert.equal((await service.snapshot(run.id)).completeIds.length, 0);
  await service.finish(run.id, [target.id]);
  const snap = await service.snapshot(run.id); assert.equal(snap.artifacts.length, 1); assert.deepEqual(snap.completeIds, [target.id]);
});

test("read accounting failures preserve the body and never rewrite terminal production", async t => {
  const { root } = await businessFixture(t, {}); const service = (await openContextControl(root, true))!;
  const run = await service.start("阅读"); const a = await service.report(run.id, { name: "内容", content: textContent("正文") });
  assert.equal((await service.recordRead(run.id, a.artifact.id, { kind: "artifact", id: a.artifact.id })).length, 1);
  assert.equal(Buffer.from((await service.readArtifact(run.id, a.artifact.id)).bytes).toString(), "正文");
  assert.equal((await service.snapshot(run.id)).steps.length, 1);
});

test("contentRef checks fixed bytes and unrelated completed references are not replayed", async t => {
  const { root, createStore } = await businessFixture(t, { "text.json": { type: "string" } });
  await createStore("sources", "text.json", "data");
  const { openBusinessStore } = await import("../src/project/business-stores.js");
  const { bytesContent } = await import("../src/data/extensions/shared/payload.js");
  const { createHash } = await import("node:crypto");
  const opened = await openBusinessStore({}, root, "sources"); assert.equal(opened.store.kind, "DataStore");
  if (opened.store.kind !== "DataStore") return;
  const bytes = Buffer.from("固定资料");
  await opened.store.create({}, { id: "source.txt", model: "text.json", payload: { contentType: "text/plain", content: bytesContent(bytes) } });
  const service = (await openContextControl(root, true))!; const run = await service.start("固定引用");
  const a = await service.report(run.id, { name: "引用", contentRef: { storeId: "sources", dataId: "source.txt", sha256: createHash("sha256").update(bytes).digest("hex") } });
  assert.equal(Buffer.from((await service.readArtifact(run.id, a.artifact.id)).bytes).toString(), "固定资料");
  await opened.store.update({}, { id: "source.txt", model: "text.json", payload: { contentType: "text/plain", content: bytesContent(Buffer.from("变动")) } });
  await assert.rejects(service.readArtifact(run.id, a.artifact.id), { code: "CONTENT_CHANGED" });
  // A completed, unused historical branch is not a pending operation to redo.
  const b = await service.report(run.id, { name: "无关产物", content: textContent("独立结果") });
  await service.finish(run.id, [b.artifact.id]);
});

test("concurrent services submit a target once and finish freezes its accepted roots", async t => {
  const { root } = await businessFixture(t, {}); const first = (await openContextControl(root, true))!; const second = (await openContextControl(root))!;
  const run = await first.start("并发"); const target = await first.createArtifact(run.id, { name: "结果" });
  const results = await Promise.allSettled([first.report(run.id, { target: target.id, content: textContent("A") }), second.report(run.id, { target: target.id, content: textContent("B") })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const snap = await first.snapshot(run.id); assert.deepEqual(snap.completeIds, [target.id]);
  await second.finish(run.id, [target.id]); await assert.rejects(first.createArtifact(run.id, { name: "终态后" }), { code: "RUN_FINISHED" });
});

for (const code of ["REVISION_CONFLICT", "LOCK_TIMEOUT", "EIO"]) {
  test(`Artifact and External content remain readable when Step accounting fails with ${code}`, async t => {
    const { root } = await businessFixture(t, {}); const service = (await openContextControl(root, true))!;
    const run = await service.start("辅助记账故障");
    const artifact = (await service.report(run.id, { name: "来源", content: textContent("产物正文") })).artifact;
    const external = await service.addExternal(run.id, "输入来源", { content: textContent("外部正文") });
    const target = await service.createArtifact(run.id, { name: "目标" });
    const update = service.stores.step.update.bind(service.stores.step);
    service.stores.step.update = async () => { throw Object.assign(Error(code), { code }); };
    try {
      for (const ref of [{ kind: "artifact" as const, id: artifact.id }, { kind: "external" as const, id: external.id }]) {
        const body = ref.kind === "artifact" ? await service.readArtifact(run.id, ref.id) : await service.readExternal(run.id, ref.id);
        assert.equal(Buffer.from(body.bytes).toString(), ref.kind === "artifact" ? "产物正文" : "外部正文");
        assert.match((await service.recordRead(run.id, target.id, ref))[0], new RegExp(code));
      }
    } finally { service.stores.step.update = update; }
    assert.equal((await service.snapshot(run.id)).steps.find(step => step.id === target.stepId)!.reads, undefined);
  });
}

function barrier() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return { entered, release, wait: async () => { enter(); await released; } };
}
for (const terminal of ["finish", "abandon"] as const) for (const reportFirst of [true, false]) {
  test(`report versus ${terminal} respects Run ordering when ${reportFirst ? "report" : terminal} holds the lock first`, async t => {
    const { root } = await businessFixture(t, {}); const service = (await openContextControl(root, true))!;
    const second = (await openContextControl(root))!; const run = await service.start("终态竞争");
    const rootArtifact = (await service.report(run.id, { name: "根", content: textContent("根正文") })).artifact;
    const target = await service.createArtifact(run.id, { name: "并发提交" }); const gate = barrier();
    const store = reportFirst ? service.stores.artifact : service.stores.run;
    const update = store.update.bind(store); store.update = async (...args) => { await gate.wait(); return update(...args); };
    const end = () => terminal === "finish" ? (reportFirst ? second : service).finish(run.id, [rootArtifact.id]) : (reportFirst ? second : service).abandon(run.id);
    const report = () => (reportFirst ? service : second).report(run.id, { target: target.id, content: textContent("新正文") });
    const first = reportFirst ? report() : end(); await gate.entered;
    const next = reportFirst ? end() : report(); const checked = reportFirst ? next : assert.rejects(next, { code: "RUN_FINISHED" });
    gate.release(); await first; await checked; store.update = update;
    const snapshot = await service.snapshot(run.id);
    assert.equal(snapshot.run.status, terminal === "finish" ? "done" : "abandoned");
    assert.equal(snapshot.artifacts.find(a => a.id === target.id)!.status, reportFirst ? "submitted" : "draft");
  });
}
for (const readFirst of [true, false]) {
  test(`report versus accounting ${readFirst ? "preserves a prior read" : "rejects a late read without changing submitted history"}`, async t => {
    const { root } = await businessFixture(t, {}); const service = (await openContextControl(root, true))!; const other = (await openContextControl(root))!;
    const run = await service.start("读取竞争"); const source = (await service.report(run.id, { name: "来源", content: textContent("来源") })).artifact;
    const target = await service.createArtifact(run.id, { name: "目标" }); const gate = barrier();
    const store = readFirst ? service.stores.step : service.stores.artifact;
    const update = store.update.bind(store); store.update = async (...args) => { await gate.wait(); return update(...args); };
    const read = () => (readFirst ? service : other).recordRead(run.id, target.id, { kind: "artifact", id: source.id });
    const report = () => (readFirst ? other : service).report(run.id, { target: target.id, content: textContent("完成") });
    const first = readFirst ? read() : report(); await gate.entered; const next = readFirst ? report() : read(); gate.release();
    const firstResult = await first; const nextResult = await next; store.update = update;
    const warnings = readFirst ? firstResult : nextResult;
    assert.ok(Array.isArray(warnings)); assert.equal(warnings.length, readFirst ? 0 : 1);
    const step = (await service.snapshot(run.id)).steps.find(step => step.id === target.stepId)!;
    assert.equal(step.status, "done"); assert.equal(!!step.reads?.[`artifact:${source.id}`], readFirst);
  });
}

for (const operation of ["create", "report-target", "report-direct"] as const) {
  const boundaries = operation === "create" ? [["artifact", "create"], ["step", "create"]] as const : operation === "report-target" ? [["artifact", "update"], ["step", "update"]] as const : [["artifact", "create"], ["step", "create"], ["step", "update"]] as const;
  for (const [entity, method] of boundaries) for (const after of [false, true]) {
    test(`${operation} interrupted ${after ? "after" : "before"} ${entity}.${method} redoes only durable original identities`, async t => {
      const { root } = await businessFixture(t, {}); const service = (await openContextControl(root, true))!; const run = await service.start("记录边界恢复");
      const target = operation === "report-target" ? await service.createArtifact(run.id, { name: "目标" }) : undefined;
      const store = service.stores[entity]; const original = store[method].bind(store) as (...args: any[]) => Promise<any>;
      let injected = false;
      (store as any)[method] = async (...args: any[]) => {
        if (injected) return original(...args); injected = true;
        if (after) await original(...args); throw Error("injected record boundary interruption");
      };
      try {
        await assert.rejects(operation === "create" ? service.createArtifact(run.id, { name: "目标" }) : service.report(run.id, { ...(target ? { target: target.id } : { name: "目标" }), content: textContent("固定成果") }), /record boundary/);
      } finally { (store as any)[method] = original; }
      const durable = await service.snapshot(run.id); const identities = durable.artifacts.map(a => [a.id, a.stepId]);
      await service.addExternal(run.id, "触发下一次业务写入redo", { content: textContent("输入") });
      await service.addExternal(run.id, "再次redo应跳过已完成", { content: textContent("输入") });
      const repaired = await service.snapshot(run.id);
      assert.deepEqual(repaired.artifacts.map(a => [a.id, a.stepId]), identities);
      assert.equal(repaired.steps.length, repaired.artifacts.length);
      for (const artifact of repaired.artifacts) {
        const step = repaired.steps.find(step => step.id === artifact.stepId)!;
        assert.equal(step.artifact.id, artifact.id); assert.equal(step.status, artifact.status === "submitted" ? "done" : "running");
        if (artifact.status === "submitted") assert.equal(artifact.content!.payload.content, "固定成果");
      }
    });
  }
}
