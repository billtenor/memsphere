import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { ValueStore } from "../../src/data/api/value-store.js";

/** Shared logical contract; native durability/permissions remain adapter integration tests. */
export function valueStoreContract(name: string, fixture: (t: TestContext) => Promise<{ store: ValueStore; reopen: () => Promise<ValueStore> }>) {
  test(`${name}: independent handles enforce create uniqueness`, async t => {
    const { store, reopen } = await fixture(t), second = await reopen();
    await store.create({}, "item", { name: "first" });
    await assert.rejects(second.create({}, "item", { name: "duplicate" }), { code: "ALREADY_EXISTS" });
    assert.deepEqual((await store.get({}, "item"))!.value, { name: "first" });
  });
  test(`${name}: independent handles commit exactly one update for the same revision`, async t => {
    const { store, reopen } = await fixture(t), second = await reopen();
    const created = await store.create({}, "item", { name: "first" });
    const results = await Promise.allSettled([
      store.update({}, "item", { name: "A" }, { expectedRevision: created.revision }),
      second.update({}, "item", { name: "B" }, { expectedRevision: created.revision })
    ]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason.code, "REVISION_CONFLICT");
    const winner = (results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<unknown>).value;
    assert.deepEqual(await store.get({}, "item"), winner);
  });
  test(`${name}: conditional delete rejects a stale revision across handles`, async t => {
    const { store, reopen } = await fixture(t), second = await reopen();
    const created = await store.create({}, "item", { name: "first" });
    const current = await store.update({}, "item", { name: "changed" });
    await assert.rejects(store.delete({}, "item", { expectedRevision: created.revision }), { code: "REVISION_CONFLICT" });
    assert.deepEqual(await store.get({}, "item"), current);
    assert.equal(await second.delete({}, "item", { expectedRevision: current.revision }), true);
    assert.equal(await store.has({}, "item"), false);
  });
  test(`${name}: deletion is idempotent across independent handles`, async t => {
    const { store, reopen } = await fixture(t), second = await reopen();
    await store.create({}, "item", { name: "first" });
    await second.delete({}, "item");
    assert.equal(await store.delete({}, "item"), false);
  });
  test(`${name}: updating a missing record is rejected`, async t => {
    const { reopen } = await fixture(t);
    await assert.rejects((await reopen()).update({}, "missing", { name: "missing" }), { code: "NOT_FOUND" });
  });
  test(`${name}: deleting and recreating a record never reuses its revision`, async t => {
    const { store, reopen } = await fixture(t), second = await reopen();
    await store.create({}, "item", { name: "first" });
    const current = await store.update({}, "item", { name: "changed" });
    await second.delete({}, "item");
    const recreated = await store.create({}, "item", { name: "recreated" });
    assert.ok(recreated.revision! > current.revision!);
  });
  test(`${name}: input and returned snapshots cannot mutate the stored value`, async t => {
    const { store, reopen } = await fixture(t);
    const input = { name: "original" };
    const created = await store.create({}, "a", input);
    input.name = "mutated"; (created.value as typeof input).name = "changed return";
    assert.deepEqual((await (await reopen()).get({}, "a"))!.value, { name: "original" });
  });
  test(`${name}: pagination enumerates every record exactly once`, async t => {
    const { store } = await fixture(t);
    for (const id of ["a", "b", "c"]) await store.create({}, id, { name: id });
    const ids: string[] = []; let cursor: string | undefined;
    for (let count = 0; count < 3; count++) {
      const page = await store.list({}, { limit: 1, cursor });
      ids.push(...page.items.map(item => item.id)); cursor = page.nextCursor;
      if (!cursor) break;
    }
    assert.equal(cursor, undefined, "enumeration terminates after all records");
    assert.deepEqual(ids, ["a", "b", "c"]);
  });
  test(`${name}: invalid pagination cursors are rejected`, async t => {
    const { store } = await fixture(t);
    await assert.rejects(store.list({}, { cursor: "bad" }));
  });
  test(`${name}: an aborted create publishes no record`, async t => {
    const { store } = await fixture(t);
    const signal = AbortSignal.abort(new Error("cancel fixture"));
    await assert.rejects(store.create({ signal }, "cancelled", { name: "never" }), /cancel fixture/);
    assert.equal(await store.has({}, "cancelled"), false);
  });
}
