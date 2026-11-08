import assert from "node:assert/strict";

import { createHash } from "node:crypto";



import test from "node:test";






import { contextModuleFixture } from "./helpers/module-context.js";



import { textContent } from "../src/context_control/types.js";



function barrier() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return { entered, release, wait: async () => { enter(); await released; } };
}

test("redo reuses the draft target and Step IDs after creation is interrupted", async t => {
  const f = await contextModuleFixture(t); const service = f.reopen();
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

test("submitted content survives interruption and the next read recovers its original Step", async t => {
  const f = await contextModuleFixture(t); const service = f.reopen();
  const run = await service.start("提交恢复"); const target = await service.createArtifact(run.id, { name: "结果" });
  const store = service.stores.step; const update = store.update.bind(store);
  store.update = async () => { throw Error("interrupted step completion"); };
  await assert.rejects(service.report(run.id, { target: target.id, content: textContent("固定正文") }), /interrupted/);
  store.update = update;
  assert.equal((await service.snapshot(run.id)).completeIds.length, 1);
  await service.finish(run.id, [target.id]);
  const snap = await service.snapshot(run.id); assert.equal(snap.artifacts.length, 1); assert.deepEqual(snap.completeIds, [target.id]);
});

test("read accounting failures preserve the body and never rewrite terminal production", async t => {
  const f = await contextModuleFixture(t); const service = f.reopen();
  const run = await service.start("阅读"); const a = await service.report(run.id, { name: "内容", content: textContent("正文") });
  assert.equal((await service.recordRead(run.id, a.artifact.id, { kind: "artifact", id: a.artifact.id })).length, 1);
  assert.equal(Buffer.from((await service.readArtifact(run.id, a.artifact.id)).bytes).toString(), "正文");
  assert.equal((await service.snapshot(run.id)).steps.length, 1);
});

test("concurrent services submit a target once and finish freezes its accepted roots", async t => {
  const f = await contextModuleFixture(t); const first = f.reopen(); const second = f.reopen();
  const run = await first.start("并发"); const target = await first.createArtifact(run.id, { name: "结果" });
  const results = await Promise.allSettled([first.report(run.id, { target: target.id, content: textContent("A") }), second.report(run.id, { target: target.id, content: textContent("B") })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const snap = await first.snapshot(run.id); assert.deepEqual(snap.completeIds, [target.id]);
  await second.finish(run.id, [target.id]); await assert.rejects(first.createArtifact(run.id, { name: "终态后" }), { code: "RUN_FINISHED" });
});

for (const code of ["REVISION_CONFLICT", "LOCK_TIMEOUT", "EIO"]) {
  test(`Artifact and External content remain readable when Step accounting fails with ${code}`, async t => {
    const f = await contextModuleFixture(t); const service = f.reopen();
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

for (const terminal of ["finish", "abandon"] as const) for (const reportFirst of [true, false]) {
  test(`report versus ${terminal} allows an admitted report to finish when ${reportFirst ? "report" : terminal} is paused`, async t => {
    const f = await contextModuleFixture(t); const service = f.reopen();
    const second = f.reopen(); const run = await service.start("终态竞争");
    const rootArtifact = (await service.report(run.id, { name: "根", content: textContent("根正文") })).artifact;
    const target = await service.createArtifact(run.id, { name: "并发提交" }); const gate = barrier();
    const store = reportFirst ? service.stores.artifact : service.stores.run;
    const update = store.update.bind(store); store.update = async (...args) => { await gate.wait(); return update(...args); };
    const end = () => terminal === "finish" ? (reportFirst ? second : service).finish(run.id, [rootArtifact.id]) : (reportFirst ? second : service).abandon(run.id);
    const report = () => (reportFirst ? service : second).report(run.id, { target: target.id, content: textContent("新正文") });
    const first = reportFirst ? report() : end(); await gate.entered;
    const next = reportFirst ? end() : report();
    try { await next; } finally { gate.release(); }
    await first; store.update = update;
    const snapshot = await service.snapshot(run.id);
    assert.equal(snapshot.run.status, terminal === "finish" ? "done" : "abandoned");
    assert.equal(snapshot.artifacts.find(a => a.id === target.id)!.status, "submitted");
    await assert.rejects(second.report(run.id, { name: "late", content: textContent("late") }), { code: "RUN_FINISHED" });
  });
}

for (const readFirst of [true, false]) {
  test(`report versus accounting ${readFirst ? "preserves a prior read" : "allows accounting while submission has not written the Artifact"}`, async t => {
    const f = await contextModuleFixture(t); const service = f.reopen(); const other = f.reopen();
    const run = await service.start("读取竞争"); const source = (await service.report(run.id, { name: "来源", content: textContent("来源") })).artifact;
    const target = await service.createArtifact(run.id, { name: "目标" }); const gate = barrier();
    const store = readFirst ? service.stores.step : service.stores.artifact;
    const update = store.update.bind(store); store.update = async (...args) => { await gate.wait(); return update(...args); };
    const read = () => (readFirst ? service : other).recordRead(run.id, target.id, { kind: "artifact", id: source.id });
    const report = () => (readFirst ? other : service).report(run.id, { target: target.id, content: textContent("完成") });
    const first = readFirst ? read() : report(); await gate.entered;
    let next;
    if (readFirst) {
      gate.release(); await first; next = report();
    } else {
      next = read();
      try { await next; } finally { gate.release(); } // A paused Artifact write must not block a different Step record.
    }
    const firstResult = await first; const nextResult = await next; store.update = update;
    const warnings = readFirst ? firstResult : nextResult;
    assert.ok(Array.isArray(warnings)); assert.equal(warnings.length, 0);
    const step = (await service.snapshot(run.id)).steps.find(step => step.id === target.stepId)!;
    assert.equal(step.status, "done"); assert.ok(step.reads?.[`artifact:${source.id}`]);
  });
}

for (const operation of ["create", "report-target", "report-direct"] as const) {
  const boundaries = operation === "create" ? [["artifact", "create"], ["step", "create"]] as const : operation === "report-target" ? [["artifact", "update"], ["step", "update"]] as const : [["artifact", "create"], ["step", "create"], ["step", "update"]] as const;
  for (const [entity, method] of boundaries) for (const after of [false, true]) {
    test(`${operation} interrupted ${after ? "after" : "before"} ${entity}.${method} redoes only durable original identities`, async t => {
      const f = await contextModuleFixture(t); const service = f.reopen(); const run = await service.start("记录边界恢复");
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

import { MemoryDataStore } from "./support/memory-data-store.js";
import { bytesContent, readAll } from "../src/data/extensions/shared/payload.js";
test("contentRef checks fixed bytes and unrelated completed references are not replayed", async t => {
  const store = new MemoryDataStore("sources", "text.json");
  const opened = { store };
  const { service } = await contextModuleFixture(t, async (ref, context) => {
    assert.equal(ref.storeId, "sources");
    const row = await store.get(context, ref.dataId);
    if (!row) throw new Error("Missing source");
    return { bytes: await readAll(context, row.data.payload.content), contentType: row.data.payload.contentType };
  });
  const bytes = Buffer.from("固定资料");
  await opened.store.create({}, { id: "source.txt", model: "text.json", payload: { contentType: "text/plain", content: bytesContent(bytes) } });
  const run = await service.start("固定引用");
  const a = await service.report(run.id, { name: "引用", contentRef: { storeId: "sources", dataId: "source.txt", sha256: createHash("sha256").update(bytes).digest("hex") } });
  assert.equal(Buffer.from((await service.readArtifact(run.id, a.artifact.id)).bytes).toString(), "固定资料");
  await opened.store.update({}, { id: "source.txt", model: "text.json", payload: { contentType: "text/plain", content: bytesContent(Buffer.from("变动")) } });
  await assert.rejects(service.readArtifact(run.id, a.artifact.id), { code: "CONTENT_CHANGED" });
  // A completed, unused historical branch is not a pending operation to redo.
  const b = await service.report(run.id, { name: "无关产物", content: textContent("独立结果") });
  await service.finish(run.id, [b.artifact.id]);
});
