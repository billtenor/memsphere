import assert from "node:assert/strict";
import test from "node:test";
import { MemoryDataStore } from "./support/memory-data-store.js";
import { ManualClock } from "./support/manual-clock.js";
import { bytesContent, readAll } from "../src/data/extensions/shared/payload.js";
import { JsonPayloadSerializer } from "../src/data/extensions/json-serializer/index.js";
import { checkModelDefinition } from "../src/project/model-validation.js";
import { MemoryValueStore } from "./support/memory-value-store.js";
import { contextModuleFixture } from "./helpers/module-context.js";

test("schema, serializer, raw Store and value Store compose without a filesystem", async () => {
  const { runtime } = await checkModelDefinition({}, { modelRef: "order.json", definition: { type: "object", properties: { quantity: { type: "integer", minimum: 1 } }, required: ["quantity"] } });
  const serializer = new JsonPayloadSerializer(), raw = new MemoryDataStore("raw", "order.json");
  await raw.create({}, { id: "order", model: "order.json", payload: { contentType: serializer.contentType, content: await serializer.serialize({}, runtime!.descriptor, { quantity: 2 }) } });
  const values = new MemoryValueStore("values", "order.json", value => { runtime!.reflect(value); });
  const record = (await raw.fork().get({}, "order"))!;
  await values.create({}, "order", await serializer.deserialize({}, runtime!.descriptor, record.data.payload.content));
  const saved = (await values.fork().get({}, "order"))!;
  assert.deepEqual(saved.value, { quantity: 2 });
  await assert.rejects(values.update({}, "order", { quantity: 0 }, { expectedRevision: saved.revision }));
  assert.deepEqual((await values.get({}, "order"))!.value, saved.value);
  for (let i = 0; i < 2; i++) assert.deepEqual(JSON.parse(Buffer.from(await readAll({}, (await raw.get({}, "order"))!.data.payload.content)).toString()), { quantity: 2 });
  await assert.rejects(raw.create({}, { id: "wrong", model: "other.json", payload: { contentType: "text/plain", content: bytesContent(new Uint8Array()) } }));
});

test("manual time resolves waits exactly at their deadlines and removes cancelled waits", async () => {
  const clock = new ManualClock(0), other = new ManualClock(0), controller = new AbortController();
  let done = false; const pending = clock.sleep(100).then(() => { done = true; });
  const cancelled = clock.sleep(200, controller.signal); controller.abort(new Error("cancel wait"));
  await assert.rejects(cancelled, /cancel wait/);
  clock.advance(99); await Promise.resolve(); assert.equal(done, false);
  clock.advance(1); await pending; assert.equal(done, true);
  assert.equal(clock.waiting, 0); assert.equal(other.now(), 0);
});

test("reopened module services share records while isolating overrides, clocks and worker observations", async () => {
  const f = await contextModuleFixture(), separate = await contextModuleFixture();
  const r = await f.service.start("module"); f.clock.advance(500);
  const reopened = f.reopen();
  f.service.stores.run.update = async () => { throw Error("handle fault"); };
  await reopened.finish(r.id, []);
  const run = (await reopened.snapshot(r.id)).run;
  assert.equal(Date.parse(run.endedAt!) - Date.parse(run.createdAt), 500);
  assert.equal((await separate.service.listRuns()).length, 0);
  f.workers.identities.set(12, { pid: 12, group: 12, started: "first" });
  assert.equal((await f.workers.captureGroup(12)).length, 1);
  assert.equal((await separate.workers.captureGroup(12)).length, 0);
});
