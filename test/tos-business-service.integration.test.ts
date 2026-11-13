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

for (const operation of ["read","validate","export-json"] as const) for (const failure of ["conflict","permission","abort","deadline"] as const) {
  test(`TOS active JSON ${operation} retains its lazy ${failure} failure`,async()=>{
    const { createDataService }=await import("../src/project/data-service.js");
    const { createPlainRuntime }=await import("../src/data/extensions/shared/reflection.js");
    const { TosRequestError }=await import("../src/data/extensions/tos-datastore/response.js");
    const {store,client}=fixture();const input=data("item",'"first"');input.payload.contentType="application/json";await store.create({},input);
    const runtime=createPlainRuntime({id:"file.json",root:{kind:"scalar",scalar:"string"}});
    let published=false;
    const service=createDataService({async openStore(){return {store,runtime,stamp:"fixed",binding:{kind:"data",factory:"memsphere/tos",model:"file.json",config:config("revision")}};},async assertStamp(){},async exportBytes(){published=true;throw Error("Failure must precede JSON publication");}});
    const current=client.objects.get("records/item")!,read=client.read.bind(client),controller=new AbortController();let injected=false;
    const error=new TosRequestError(failure === "permission" ? "AccessDenied" : failure === "deadline" ? "TOS_DEADLINE" : "ABORTED",failure === "permission" ? 403 : undefined);
    client.read=async(context,key,options)=>{
      if(options?.ifMatch && !injected){
        injected=true;
        if(failure === "conflict") {const next=data("item",'"concurrent"');next.payload.contentType="application/json";await store.update({},next,{expectedRevision:encodeRevision(1,current.headers.etag!)});}
        else {if(failure === "abort")controller.abort(error);throw error;}
      }
      return read(context,key,options);
    };
    client.calls.length=0;
    const context={signal:controller.signal};
    const result=operation === "read" ? service.readData(context,"project","records","item") : operation === "validate" ? service.validateData(context,"project",{storeId:"records",id:"item"}) : service.exportData(context,"project","records","item","json","unused.json");
    await assert.rejects(result,{code:failure === "conflict" ? "REVISION_CONFLICT" : error.code});
    assert.equal(injected,true);assert.equal(published,false);
    assert.equal(client.calls.filter(call=>call.method === "PUT").length,failure === "conflict" ? 1 : 0);
    assert.equal(client.calls.filter(call=>call.method === "DELETE").length,0);
    assert.equal(client.objects.get("records/item")!.bytes.subarray(10).toString(),failure === "conflict" ? '"concurrent"' : '"first"');
  });
}
for(const invalid of ["syntax","utf8","runtime"] as const){
  test(`TOS JSON ${invalid} incompatibility still reports a capability error`,async()=>{
    const {createDataService}=await import("../src/project/data-service.js");const {createPlainRuntime}=await import("../src/data/extensions/shared/reflection.js");
    const {store}=fixture(),input=data("item",invalid === "syntax" ? "{" : invalid === "runtime" ? "42" : '"first"');input.payload.contentType="application/json";
    if(invalid === "utf8")input.payload.content=bytesContent(Uint8Array.of(255));await store.create({},input);
    const runtime=createPlainRuntime({id:"file.json",root:{kind:"scalar",scalar:"string"}});
    const service=createDataService({async openStore(){return{store,runtime,stamp:"fixed",binding:{kind:"data",factory:"memsphere/tos",model:"file.json",config:config("revision")}};},async assertStamp(){}});
    await assert.rejects(service.readData({},"project","records","item"),{code:"UNSUPPORTED_CAPABILITY"});
  });
}
