import assert from "node:assert/strict";
import test from "node:test";
import type { Data } from "../src/data/api/data.js";
import { bytesContent, readAll } from "../src/data/extensions/shared/payload.js";
import { TosDataStore } from "../src/data/extensions/tos-datastore/store.js";
import { encodeHeader } from "../src/data/extensions/tos-datastore/header.js";
import { encodeRevision, decodeRevision } from "../src/data/extensions/tos-datastore/revision.js";
import type { TosConfig } from "../src/data/extensions/tos-datastore/config.js";
import { MemoryTosClient } from "./support/tos-object-client.js";

const config = (mode: "raw" | "revision"): TosConfig => ({ mode, region: "cn-beijing", endpoint: "tos-cn-beijing.volces.com", bucket: "test-bucket", prefix: "records/",
  credentials: { source: "env", accessKeyIdEnv: "TEST_AK", accessKeySecretEnv: "TEST_SK" } });
function fixture(mode: "raw" | "revision" = "revision") {
  const client = new MemoryTosClient(), store = new TosDataStore("records", "file.json", config(mode), client);
  return { client, store };
}
function data(id: string, content = "payload"): Data { return { id, model: "file.json", payload: { contentType: "text/plain", content: bytesContent(Buffer.from(content)) } }; }
async function live(store: TosDataStore, id = "item") { const record = await store.get({}, id); assert.ok(record && !record.deleted); return record; }

test("business service retains TOS single-PUT writes, validates dry-run conditions and returns tombstone revisions", async () => {
  const { createDataService } = await import("../src/project/data-service.js");
  const { createPlainRuntime } = await import("../src/data/extensions/shared/reflection.js");
  const { store, client } = fixture();
  const runtime = createPlainRuntime({ id: "file.json", root: { kind: "scalar", scalar: "bytes" } });
  const service = createDataService({ async openStore() { return { store, runtime, stamp: "fixed", binding: { kind: "data", factory: "memsphere/tos", model: "file.json", config: config("revision") } }; }, async assertStamp() {}, async modelRuntime() { return runtime; } });
  const payload = { kind: "payload" as const, bytes: Buffer.from("first"), contentType: "text/plain" };
  await service.writeData({}, "project", "records", "item", "create", payload);
  assert.deepEqual(client.calls.map(call => call.method), ["PUT"]);
  const revision = (await live(store)).revision!;
  client.calls.length = 0;
  await assert.rejects(service.writeData({}, "project", "records", "item", "update", payload), { code: "INVALID_ARGUMENT" });
  await assert.rejects(service.writeData({}, "project", "records", "item", "update", payload, { dryRun: true, expectedRevision: "bad" }), { code: "INVALID_ARGUMENT" });
  assert.equal(client.calls.length, 0);
  await service.writeData({}, "project", "records", "item", "update", payload, { expectedRevision: revision });
  assert.deepEqual(client.calls.map(call => call.method), ["PUT"]);
  const current = (await live(store)).revision!;
  await service.deleteData({}, "project", "records", "item", { expectedRevision: current });
  const result = await service.readData({}, "project", "records", "item");
  assert.equal(result.deleted, true); assert.equal(typeof result.revision, "string"); assert.equal("value" in result, false);
});


test("Project namespace validation treats public and internal endpoints as the same bucket", async t => {
  const { businessFixture } = await import("./helpers/business-data.js");
  const { validateBusinessBindings } = await import("../src/project/business-stores.js");
  const { projectConfigSchema } = await import("../src/project/model.js");
  const { root } = await businessFixture(t);
  const binding = (endpoint: string, prefix: string, bucket = "test-bucket") => ({ kind:"data",model:"file.json",factory:"memsphere/tos",config:{...config("revision"),endpoint,prefix,bucket} });
  const project = (second: ReturnType<typeof binding>) => projectConfigSchema.parse({store:{type:"managed",branch:"master",published_revision:"fixture"},dataStores:{first:binding("tos-cn-beijing.volces.com","records/"),second}});
  for (const prefix of ["records/","records/child/"]) await assert.rejects(validateBusinessBindings(root,project(binding("tos-cn-beijing.ivolces.com",prefix))),{code:"STORE_PATH_CONFLICT"});
  await validateBusinessBindings(root,project(binding("tos-cn-beijing.ivolces.com","independent/")));
  await validateBusinessBindings(root,project(binding("tos-cn-beijing.ivolces.com","records/","other-bucket")));
});
