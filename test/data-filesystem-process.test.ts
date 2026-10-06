import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Config } from "../src/data/api/config.js";
import { FilesystemJsonValueStoreFactory, FILESYSTEM_JSON_METADATA_DIRECTORY } from "../src/data/extensions/filesystem-json-valuestore/index.js";
import { createPlainRuntime } from "../src/data/extensions/shared/reflection.js";
import { filesystemWorker } from "./helpers/filesystem-process.js";

async function fixture(t: TestContext) {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "memsphere-process-store-")));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runtime = createPlainRuntime({ id: "test/record.json", root: { kind: "object", fields: [], field: () => undefined } });
  const store = await new FilesystemJsonValueStoreFactory().openExisting({}, "test/records", runtime, new Config({ directory }));
  return { directory, store };
}

test("independent creators commit exactly one complete record", { timeout: 15_000 }, async (t) => {
  const { directory, store } = await fixture(t);
  const first = await filesystemWorker(t, directory, { operation: "create", pause: "after-lock", value: { winner: 1 } });
  const second = await filesystemWorker(t, directory, { operation: "create", value: { winner: 2 } });
  first.send("start");
  await first.next("paused");
  second.send("start");
  await second.next("waiting");
  first.send("continue");
  assert.equal((await first.next("result")).ok, true);
  assert.equal((await second.next("result")).code, "ALREADY_EXISTS");
  assert.deepEqual((await store.get({}, "item"))?.value, { winner: 1 });
  assert.equal((await store.get({}, "item"))?.revision, 1);
});

for (const initial of [false, true]) for (const firstOperation of ["create", "delete"] as const) {
  test(`create/delete from ${initial ? "existing" : "missing"} record follows ${firstOperation}-first lock order`, { timeout: 15_000 }, async (t) => {
    const { directory, store } = await fixture(t);
    if (initial) await store.create({}, "item", { original: true });
    const first = await filesystemWorker(t, directory, { operation: firstOperation, pause: "after-lock" });
    const second = await filesystemWorker(t, directory, { operation: firstOperation === "create" ? "delete" : "create" });
    first.send("start");
    await first.next("paused");
    second.send("start");
    await second.next("waiting");
    first.send("continue");
    const a = await first.next("result");
    const b = await second.next("result");
    assert.equal(b.ok, true);
    if (firstOperation === "create") {
      assert.equal(a.ok, !initial);
      if (initial) assert.equal(a.code, "ALREADY_EXISTS");
      assert.equal(b.value, true);
      assert.equal(await store.get({}, "item"), undefined);
    } else {
      assert.equal(a.ok, true);
      assert.equal(a.value, initial);
      assert.equal(b.value.revision, initial ? 2 : 1);
      assert.equal((await store.get({}, "item"))?.revision, initial ? 2 : 1);
    }
  });
}

for (const [firstOperation, secondOperation] of [["update", "update"], ["update", "delete"], ["delete", "update"], ["delete", "delete"]] as const) {
  test(`independent conditional ${firstOperation}/${secondOperation} commits at most once for one revision`, { timeout: 15_000 }, async (t) => {
    const { directory, store } = await fixture(t);
    await store.create({}, "item", { initial: true });
    const first = await filesystemWorker(t, directory, { operation: firstOperation, expectedRevision: 1, pause: "after-lock" });
    const second = await filesystemWorker(t, directory, { operation: secondOperation, expectedRevision: 1 });
    first.send("start");
    await first.next("paused");
    second.send("start");
    await second.next("waiting");
    first.send("continue");
    assert.equal((await first.next("result")).ok, true);
    assert.equal((await second.next("result")).code, "REVISION_CONFLICT");
    assert.equal((await store.get({}, "item"))?.revision, firstOperation === "delete" ? undefined : 2);
  });
}

test("independent unconditional writers serialize without claiming old-client revision protection", { timeout: 15_000 }, async (t) => {
  const { directory, store } = await fixture(t);
  await store.create({}, "item", { initial: true });
  const first = await filesystemWorker(t, directory, { operation: "update", pause: "after-lock" });
  const second = await filesystemWorker(t, directory, { operation: "update" });
  first.send("start"); await first.next("paused");
  second.send("start"); await second.next("waiting");
  first.send("continue");
  assert.equal((await first.next("result")).value.revision, 2);
  assert.equal((await second.next("result")).value.revision, 3);
  assert.equal((await store.get({}, "item"))?.revision, 3);
});

test("delete/recreate across processes retains revision and rejects stale update and delete", { timeout: 15_000 }, async (t) => {
  const { directory, store } = await fixture(t);
  await store.create({}, "item", { initial: true });
  const deleted = await filesystemWorker(t, directory, { operation: "delete", expectedRevision: 1 });
  deleted.send("start"); assert.equal((await deleted.next("result")).value, true);
  const recreated = await filesystemWorker(t, directory, { operation: "create" });
  recreated.send("start"); assert.equal((await recreated.next("result")).value.revision, 2);
  for (const operation of ["update", "delete"]) {
    const stale = await filesystemWorker(t, directory, { operation, expectedRevision: 1 });
    stale.send("start"); assert.equal((await stale.next("result")).code, "REVISION_CONFLICT");
  }
  assert.equal((await store.get({}, "item"))?.revision, 2);
  assert.deepEqual(await store.list({}), { items: [{ id: "item" }] });
});

test("SIGKILL after retaining deletion history leaves the visible record unchanged and can be retried", { timeout: 15_000 }, async (t) => {
  const { directory, store } = await fixture(t);
  await store.create({}, "item", { initial: true });
  const dying = await filesystemWorker(t, directory, { operation: "delete", expectedRevision: 1, pause: "after-history" });
  dying.send("start"); await dying.next("paused");
  assert.ok((await fs.readdir(join(directory, FILESYSTEM_JSON_METADATA_DIRECTORY))).some((name) => name.endsWith(".revision.json")));
  dying.child.kill("SIGKILL"); await dying.exit;
  assert.equal((await store.get({}, "item"))?.revision, 1);
  assert.equal(await store.delete({}, "item", { expectedRevision: 1 }), true);
  assert.equal((await store.create({}, "item", { recreated: true })).revision, 2);
});

test("SIGKILL before record publication leaves complete original JSON and releases its lock", { timeout: 15_000 }, async (t) => {
  const { directory, store } = await fixture(t);
  const original = await store.create({}, "item", { initial: true });
  const dying = await filesystemWorker(t, directory, { operation: "update", expectedRevision: 1, pause: "before-publish" });
  dying.send("start"); await dying.next("paused");
  assert.deepEqual(await store.get({}, "item"), original);
  dying.child.kill("SIGKILL"); await dying.exit;
  assert.deepEqual(await store.get({}, "item"), original);
  assert.equal((await store.update({}, "item", { retried: true }, { expectedRevision: 1 })).revision, 2);
});

test("a committed update remains readable when SIGKILL loses its success receipt", { timeout: 15_000 }, async (t) => {
  const { directory, store } = await fixture(t);
  await store.create({}, "item", { initial: true });
  const dying = await filesystemWorker(t, directory, { operation: "update", expectedRevision: 1, pause: "after-publish", value: { committed: true } });
  dying.send("start"); await dying.next("paused");
  dying.child.kill("SIGKILL"); await dying.exit;
  const committed = await store.get({}, "item");
  assert.equal(committed?.revision, 2); assert.deepEqual(committed?.value, { committed: true });
  await assert.rejects(store.update({}, "item", { retry: true }, { expectedRevision: 1 }), { code: "REVISION_CONFLICT" });
  assert.equal((await store.update({}, "item", { next: true }, { expectedRevision: 2 })).revision, 3);
});
