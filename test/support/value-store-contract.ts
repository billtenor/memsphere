import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { ValueStore } from "../../src/data/api/value-store.js";

/** Shared logical contract; native durability/permissions remain adapter integration tests. */
export function valueStoreContract(name: string, fixture: (t: TestContext) => Promise<{ store: ValueStore; reopen: () => Promise<ValueStore> }>) {
  test(`${name}: independent handles enforce create and revision conditions, including delete/recreate`, async t => {
    const { store, reopen } = await fixture(t), second = await reopen();
    const created = await store.create({}, "item", { name: "first" });
    await assert.rejects(second.create({}, "item", { name: "duplicate" }), { code: "ALREADY_EXISTS" });
    const results = await Promise.allSettled([store.update({}, "item", { name: "A" }, { expectedRevision: created.revision }), second.update({}, "item", { name: "B" }, { expectedRevision: created.revision })]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason.code, "REVISION_CONFLICT");
    const current = (await store.get({}, "item"))!;
    await assert.rejects(store.delete({}, "item", { expectedRevision: created.revision }), { code: "REVISION_CONFLICT" });
    assert.equal(await second.delete({}, "item", { expectedRevision: current.revision }), true);
    assert.equal(await store.delete({}, "item"), false);
    await assert.rejects(second.update({}, "missing", { name: "missing" }), { code: "NOT_FOUND" });
    const recreated = await store.create({}, "item", { name: "recreated" });
    assert.ok(recreated.revision! > current.revision!);
  });
  test(`${name}: snapshots and pagination preserve independent values and complete enumeration`, async t => {
    const { store, reopen } = await fixture(t);
    const input = { name: "original" }; const created = await store.create({}, "a", input);
    input.name = "mutated"; (created.value as typeof input).name = "changed return";
    await store.create({}, "b", { name: "B" }); await store.create({}, "c", { name: "C" });
    assert.deepEqual((await (await reopen()).get({}, "a"))!.value, { name: "original" });
    const ids: string[] = []; let cursor: string | undefined;
    do { const page = await store.list({}, { limit: 1, cursor }); ids.push(...page.items.map(item => item.id)); cursor = page.nextCursor; } while (cursor);
    assert.deepEqual(ids, ["a", "b", "c"]);
    await assert.rejects(store.list({}, { cursor: "bad" }));
    const signal = AbortSignal.abort(new Error("cancel fixture"));
    await assert.rejects(store.create({ signal }, "cancelled", { name: "never" }), /cancel fixture/);
    assert.equal(await store.has({}, "cancelled"), false);
  });
}
