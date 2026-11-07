import assert from "node:assert/strict";
import test from "node:test";
import type { ValueStore, StoredValue } from "../src/data/api/value-store.js";
import { ContextControl, failure, type Stores } from "../src/context_control/service.js";
import { textContent } from "../src/context_control/types.js";

function memoryStore(model: string): ValueStore {
  const rows = new Map<string, StoredValue>();
  return {
    id: model, model, kind: "ValueStore",
    async get(_, id) { const value = rows.get(id); return value && structuredClone(value); },
    async has(_, id) { return rows.has(id); },
    async list(_, options) {
      const ids = [...rows.keys()].sort().filter(id => !options?.cursor || id > options.cursor); const size = options?.limit ?? 1000;
      return { items: ids.slice(0, size).map(id => ({ id })), ...(ids.length > size ? { nextCursor: ids[size - 1] } : {}) };
    },
    async create(_, id, value) {
      if (rows.has(id)) throw failure("ALREADY_EXISTS", id);
      const row = { id, value: structuredClone(value), revision: 1 }; rows.set(id, row); return structuredClone(row);
    },
    async update(_, id, value, options) {
      const before = rows.get(id); if (before?.revision !== options?.expectedRevision) throw failure("REVISION_CONFLICT", id);
      const row = { id, value: structuredClone(value), revision: before!.revision! + 1 }; rows.set(id, row); return structuredClone(row);
    },
    async delete(_, id) { return rows.delete(id); }
  };
}

test("free exploration services work with injected Stores without directory or file capabilities", async () => {
  const stores = Object.fromEntries(["run", "step", "artifact", "external", "review"].map(k => [k, memoryStore(`${k}.json`)])) as Stores;
  const service = new ContextControl(stores, async () => { throw Error("no referenced content in this case"); });
  const run = await service.start("可替换存储");
  const a = await service.report(run.id, { name: "A", content: textContent("正文") });
  const b = await service.createArtifact(run.id, { name: "B" });
  await service.recordRead(run.id, b.id, { kind: "artifact", id: a.artifact.id });
  await service.report(run.id, { target: b.id, content: textContent("结果"), dependencies: [{ kind: "artifact", id: a.artifact.id }] });
  await service.review(run.id, b.id, "agent", ["检查完成"]);
  await service.finish(run.id, [b.id]);
  assert.equal((await service.snapshot(run.id)).run.status, "done");
  assert.ok(await stores.artifact.get({}, `${run.id}/${b.id}`));
});

test("explicit invalid target/revision inputs cannot silently become a new report", async () => {
  const stores = Object.fromEntries(["run", "step", "artifact", "external", "review"].map(k => [k, memoryStore(`${k}.json`)])) as Stores;
  const service = new ContextControl(stores, async () => { throw Error("unused"); });
  const run = await service.start("输入边界");
  await assert.rejects(service.report(run.id, { name: "结果", target: "", content: textContent("正文") }), { code: "INVALID_ARGUMENT" });
  await assert.rejects(service.report(run.id, { name: "结果", revisedFrom: "", content: textContent("正文") }), { code: "INVALID_ARGUMENT" });
  assert.equal((await service.snapshot(run.id)).artifacts.length, 0);
});
