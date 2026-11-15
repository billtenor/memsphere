import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

// Store deadlines are external time; transport deadlines are exercised with real sockets in integration.
beforeEach(t => t.mock.timers.enable({ apis: ["setTimeout"] }));
import type { Data } from "../src/data/api/data.js";
import { bytesContent, readAll } from "../src/data/extensions/shared/payload.js";
import { TosDataStore } from "../src/data/extensions/tos-datastore/store.js";
import { encodeHeader } from "../src/data/extensions/tos-datastore/header.js";
import { encodeRevision, decodeRevision } from "../src/data/extensions/tos-datastore/revision.js";
import type { TosConfig } from "../src/data/extensions/tos-datastore/config.js";
import { casPhase, controlledPutPair } from "./support/tos-cas-barrier.js";
import { MemoryTosClient } from "./support/tos-object-client.js";

const config = (mode: "raw" | "revision"): TosConfig => ({ mode, region: "cn-beijing", endpoint: "tos-cn-beijing.volces.com", bucket: "test-bucket", prefix: "records/",
  credentials: { source: "env", accessKeyIdEnv: "TEST_AK", accessKeySecretEnv: "TEST_SK" } });
function fixture(mode: "raw" | "revision" = "revision") {
  const client = new MemoryTosClient(), store = new TosDataStore("records", "file.json", config(mode), client);
  return { client, store };
}
function data(id: string, content = "payload"): Data { return { id, model: "file.json", payload: { contentType: "text/plain", content: bytesContent(Buffer.from(content)) } }; }
async function live(store: TosDataStore, id = "item") { const record = await store.get({}, id); assert.ok(record && !record.deleted); return record; }

for (const mode of ["raw", "revision"] as const) {
  test(`${mode} create preserves Payload and rejects duplicate without overwriting`, async () => {
    const { client, store } = fixture(mode); await store.create({}, data("item"));
    const original = Buffer.from(client.objects.get("records/item")!.bytes);
    await assert.rejects(store.create({}, data("item", "other")), { code: "ALREADY_EXISTS" });
    assert.deepEqual(client.objects.get("records/item")!.bytes, original);
    const record = await live(store);
    assert.equal(Buffer.from(await readAll({}, record.data.payload.content)).toString(), "payload");
    assert.equal(record.data.payload.contentType, "text/plain");
    assert.equal(original.length, Buffer.byteLength("payload") + (mode === "revision" ? 10 : 0));
  });
  test(`${mode} empty Payload has valid metadata and no unnecessary content GET`, async () => {
    const { client, store } = fixture(mode); await store.create({}, data("item", ""));
    const record = await live(store); client.calls.length = 0;
    assert.equal((await readAll({}, record.data.payload.content)).length, 0);
    assert.equal(client.calls.length, 0);
  });
}

test("raw rejects update/expectedRevision without reading the Payload, physically deletes and recreates", async () => {
  const { store } = fixture("raw"); let consumed = false;
  const input = data("item"); input.payload.content = { stream() { consumed = true; throw Error("not reached"); } };
  await assert.rejects(store.update({}, input), { code: "UNSUPPORTED_CAPABILITY" });
  await assert.rejects(store.delete({}, "item", { expectedRevision: "anything" }), { code: "UNSUPPORTED_CAPABILITY" });
  assert.equal(consumed, false);
  await store.create({}, data("item")); assert.equal(await store.delete({}, "item"), true);
  assert.equal(await store.delete({}, "item"), false); await store.create({}, data("item", "again"));
  assert.equal(Buffer.from(await readAll({}, (await live(store)).data.payload.content)).toString(), "again");
});

test("revision update and repeated tombstone delete use exactly one conditional PUT", async () => {
  const { client, store } = fixture(); await store.create({}, data("item"));
  let record = await live(store); const old = record.revision!;
  client.calls.length = 0; await store.update({}, data("item", "new"), { expectedRevision: old });
  assert.deepEqual(client.calls.map(c => c.method), ["PUT"]);
  await assert.rejects(store.update({}, data("item", "stale"), { expectedRevision: old }), { code: "REVISION_CONFLICT" });
  record = await live(store); client.calls.length = 0;
  assert.equal(await store.delete({}, "item", { expectedRevision: record.revision }), true);
  assert.deepEqual(client.calls.map(c => c.method), ["PUT"]);
  const deleted = await store.get({}, "item"); assert.ok(deleted?.deleted); assert.equal(await store.has({}, "item"), true);
  assert.equal(client.objects.get("records/item")!.bytes.length, 10);
  assert.deepEqual(await store.list({}), { items: [] });
  client.calls.length = 0; assert.equal(await store.delete({}, "item", { expectedRevision: deleted.revision }), true);
  assert.deepEqual(client.calls.map(c => c.method), ["PUT"]);
  const repeated = await store.get({}, "item"); assert.ok(repeated?.deleted);
  assert.equal(decodeRevision(repeated.revision).counter, decodeRevision(deleted.revision).counter + 1);
  await assert.rejects(store.create({}, data("item")), { code: "ALREADY_EXISTS" });
  await store.update({}, data("item", "back"), { expectedRevision: repeated.revision });
  assert.equal(Buffer.from(await readAll({}, (await live(store)).data.payload.content)).toString(), "back");
});

test("same old revision competition is decided at server commit, without any pre-read", async () => {
  const { client, store } = fixture(); await store.create({}, data("item")); const revision = (await live(store)).revision!;
  let arrived = 0; let release!: () => void; let both!: () => void;
  const ready = new Promise<void>(r => { both = r; }), gate = new Promise<void>(r => { release = r; });
  client.beforeCommit = async () => { if (++arrived === 2) both(); await gate; };
  client.calls.length = 0;
  const controller = new AbortController();
  const a = store.update({ signal: controller.signal }, data("item", "A"), { expectedRevision: revision });
  const b = store.update({ signal: controller.signal }, data("item", "B"), { expectedRevision: revision });
  const settled = Promise.allSettled([a, b]); // Observe early rejections while waiting at the barrier.
  try { await casPhase(ready, "both writers reach commit", 3000); release(); const result = await settled;
    assert.equal(result.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((result.find(r => r.status === "rejected") as PromiseRejectedResult).reason.code, "REVISION_CONFLICT");
    assert.deepEqual(client.calls.map(c => c.method), ["PUT", "PUT"]);
    assert.ok(client.calls.every(c => c.ifMatch === decodeRevision(revision).etag));
  } finally { controller.abort(); release(); await settled; }
});

test("lazy Payload read retains its ETag and rejects concurrent replacement", async () => {
  const { store } = fixture(); await store.create({}, data("item")); const original = await live(store);
  await store.update({}, data("item", "replacement"), { expectedRevision: original.revision });
  await assert.rejects(readAll({}, original.data.payload.content), { code: "REVISION_CONFLICT" });
});

test("counter wraps to zero without exposing a numeric revision", async () => {
  const { client, store } = fixture(); await store.create({}, data("item", ""));
  const object = client.objects.get("records/item")!; object.bytes = Buffer.from(encodeHeader(0xffffffff, false));
  // The fake's ETag is still a valid old snapshot token; production never derives it from metadata.
  await store.update({}, data("item", ""), { expectedRevision: encodeRevision(0xffffffff, object.headers.etag!) });
  const record = await live(store); assert.equal(typeof record.revision, "string"); assert.equal(decodeRevision(record.revision).counter, 0);
});

test("physical compatibility enumeration includes deleted records hidden from list", async () => {
  const { store } = fixture(); await store.create({}, data("a")); await store.create({}, data("b"));
  await store.delete({}, "a", { expectedRevision: (await live(store, "a")).revision });
  assert.deepEqual((await store.list({}, { limit: 1 })).items, [{ id: "b" }]);
  const physical = []; for await (const record of store.inspectPhysicalRecords({})) physical.push(record);
  assert.equal(physical.length, 2); assert.equal(physical.filter(r => r.deleted).length, 1);
});

test("raw existence needs NoSuchKey confirmation; bucket and permission errors cannot trigger DELETE", async () => {
  const { TosRequestError } = await import("../src/data/extensions/tos-datastore/response.js");
  for (const [code, status] of [["NoSuchBucket", 404], ["AccessDenied", 403]] as const) {
    const { store, client } = fixture("raw");
    client.read = async () => { client.calls.push({ method: "GET" }); throw new TosRequestError(code, status); };
    await assert.rejects(store.delete({}, "missing"), { code });
    assert.deepEqual(client.calls.map(call => call.method), ["HEAD", "GET"]);
  }
});

test("raw ambiguous HEAD confirms a present object then permits exactly one fresh HEAD", async () => {
  const { TosRequestError } = await import("../src/data/extensions/tos-datastore/response.js");
  const { store, client } = fixture("raw"); await store.create({}, data("item")); client.calls.length = 0;
  const head = client.head.bind(client); let calls = 0;
  client.head = async (context, key) => { if (++calls === 1) { client.calls.push({ method: "HEAD" }); throw new TosRequestError("HTTP_404", 404); } return head(context, key); };
  const read = client.read.bind(client); let confirmation: import("node:stream").Readable | undefined;
  client.read = async (...args) => { const result = await read(...args); confirmation = result.stream; return result; };
  assert.ok(await store.get({}, "item"));
  assert.deepEqual(client.calls.map(call => call.method), ["HEAD", "GET", "HEAD"]);
  assert.equal(confirmation!.destroyed, true);
  client.head = async () => { client.calls.push({ method: "HEAD" }); throw new TosRequestError("HTTP_404", 404); };
  client.calls.length = 0;
  await assert.rejects(store.delete({}, "item"), { code: "STORE_CHANGED" });
  assert.deepEqual(client.calls.map(call => call.method), ["HEAD", "GET", "HEAD"]);
});

test("list yields an empty page with a continuation after its ten-page tombstone budget", async () => {
  const { store, client } = fixture();
  for (let index = 0; index < 11; index++) {
    const id = String(index).padStart(2, "0"); await store.create({}, data(id));
    if (index < 10) await store.delete({}, id, { expectedRevision: (await live(store, id)).revision });
  }
  client.calls.length = 0;
  const first = await store.list({}, { limit: 1 });
  assert.deepEqual(first.items, []); assert.ok(first.nextCursor);
  assert.equal(client.calls.filter(call => call.method === "LIST").length, 10);
  assert.deepEqual(await store.list({}, { limit: 1, cursor: first.nextCursor }), { items: [{ id: "10" }] });
  const other = new TosDataStore("other", "file.json", config("revision"), client);
  await assert.rejects(other.list({}, { cursor: first.nextCursor }));
});


test("bucket admission rejects Enabled, Suspended and unknown versioning states", async () => {
  const { store, client } = fixture();
  await store.checkBucket({});
  for (const state of ["Enabled", "Suspended", "unknown"]) { client.version = state; await assert.rejects(store.checkBucket({}), { code: "STORE_INCOMPATIBLE" }); }
  assert.ok(client.calls.every(call => call.method === "VERSIONING"));
});

for (const operation of ["create", "update"] as const) for (const first of [0, 1] as const) {
  test(`fake TOS ${operation} honours controlled original conditions when writer ${first} commits first`, async () => {
    const mode = operation === "create" ? "raw" : "revision";
    const { store, client } = fixture(mode);
    if (operation === "update") await store.create({}, data("item", "old"));
    const expectedRevision = operation === "update" ? (await live(store)).revision! : undefined;
    client.calls.length = 0;
    await controlledPutPair({ client, key: "records/item", first, condition: operation === "create" ? { create: true } : { ifMatch: decodeRevision(expectedRevision!).etag },
      conflictCode: operation === "create" ? "ALREADY_EXISTS" : "REVISION_CONFLICT",
      write: (gated, context, index) => {
        const target = new TosDataStore("records", "file.json", config(mode), gated);
        return operation === "create" ? target.create(context, data("item", `writer-${index}`)) : target.update(context, data("item", `writer-${index}`), { expectedRevision });
      } });
    assert.deepEqual(client.calls.map(call => call.method), ["PUT", "PUT"]);
    assert.equal(Buffer.from(await readAll({}, (await live(store)).data.payload.content)).toString(), `writer-${first}`);
  });
}

for (const defect of ["status", "range", "length", "etag", "model", "format", "mime", "short-header", "long-header", "deleted-payload"] as const) {
  test(`revision snapshot rejects ${defect} and releases the owned response`, async () => {
    const { store, client } = fixture(); await store.create({}, data("item"));
    const read = client.read.bind(client); let owned: import("node:stream").Readable | undefined;
    client.read = async (...args) => {
      const out = await read(...args); owned = out.stream;
      if (defect === "status") out.status = 200;
      if (defect === "range") out.headers["content-range"] = "bytes 1-10/17";
      if (defect === "length") out.headers["content-length"] = "9";
      if (defect === "etag") delete out.headers.etag;
      if (defect === "model") delete out.headers["x-tos-meta-memsphere-model"];
      if (defect === "format") out.headers["x-tos-meta-memsphere-store-format"] = "raw-v1";
      if (defect === "mime") out.headers["x-tos-meta-memsphere-content-type"] = "invalid";
      if (["short-header", "long-header", "deleted-payload"].includes(defect)) {
        out.stream.destroy();
        const { Readable } = await import("node:stream");
        const bytes = defect === "deleted-payload" ? encodeHeader(1,true) : new Uint8Array(defect === "short-header" ? 9 : 11);
        out.stream = Readable.from([bytes]); owned = out.stream;
      }
      return out;
    };
    await assert.rejects(store.get({}, "item"));
    assert.equal(owned!.destroyed, true);
  });
}

for (const defect of ["status", "range", "etag", "short", "long"] as const) {
  test(`lazy revision Payload rejects ${defect} and closes its response`, async () => {
    const { store, client } = fixture(); await store.create({}, data("item", "hello"));
    const record = await live(store), read = client.read.bind(client);
    let owned: import("node:stream").Readable | undefined;
    client.read = async (...args) => {
      const out = await read(...args); owned = out.stream;
      if (defect === "status") out.status = 200;
      if (defect === "range") out.headers["content-range"] = "bytes 11-15/16";
      if (defect === "etag") out.headers.etag = '"changed"';
      if (defect === "short" || defect === "long") {
        out.stream.destroy(); const { Readable } = await import("node:stream");
        out.stream = Readable.from([Buffer.from(defect === "short" ? "hell" : "hello!")]); owned = out.stream;
        delete out.headers["content-length"];
      }
      return out;
    };
    await assert.rejects(readAll({},record.data.payload.content));
    assert.equal(owned!.destroyed,true);
  });
}


for (const scenario of ["same-payload", "update-delete", "delete-delete", "tombstone-delete-delete", "tombstone-update-delete"] as const) for (const first of [0,1] as const) {
  test(`revision ${scenario} preserves the complete winner when writer ${first} commits first`, async () => {
    const {store,client}=fixture();await store.create({},data("item","same"));
    let before=await store.get({},"item");assert.ok(before?.revision);
    if(scenario.startsWith("tombstone-")){await store.delete({},"item",{expectedRevision:before.revision});before=await store.get({},"item");assert.ok(before?.revision);}
    const revision=before.revision, counter=decodeRevision(revision).counter;
    const deletes=scenario.endsWith("delete-delete") ? [true,true] : scenario.endsWith("update-delete") ? [false,true] : [false,false];
    client.calls.length=0;
    await controlledPutPair({client,key:"records/item",first,condition:{ifMatch:decodeRevision(revision).etag},conflictCode:"REVISION_CONFLICT",write:async(gated,context,index)=>{
      const target=new TosDataStore("records","file.json",config("revision"),gated);
      if(deletes[index])await target.delete(context,"item",{expectedRevision:revision});
      else await target.update(context,data("item","same"),{expectedRevision:revision});
    }});
    assert.deepEqual(client.calls.map(c=>c.method),["PUT","PUT"]);
    const physical=client.objects.get("records/item")!;
    assert.deepEqual(physical.bytes,Buffer.concat([encodeHeader(counter+1,deletes[first]),...(deletes[first]?[]:[Buffer.from("same")])]));
    const winner=await store.get({},"item");assert.ok(winner?.revision);
    assert.equal(!!winner.deleted,deletes[first]);assert.equal(decodeRevision(winner.revision).counter,counter+1);assert.notEqual(winner.revision,revision);
    if(!winner.deleted)assert.equal(Buffer.from(await readAll({},winner.data.payload.content)).toString(),"same");
    const snapshot=Buffer.from(physical.bytes);client.calls.length=0;
    await assert.rejects(store.update({},data("item","stale"),{expectedRevision:revision}),{code:"REVISION_CONFLICT"});
    await assert.rejects(store.delete({},"item",{expectedRevision:revision}),{code:"REVISION_CONFLICT"});
    assert.deepEqual(client.objects.get("records/item")!.bytes,snapshot);
  });
}

for(const defect of ["missing-writer","early-failure"] as const){
  test(`CAS watchdog survives the mocked Store clock and cleans up ${defect}`, {timeout:5000},async()=>{
    const {client,store}=fixture();await store.create({},data("item"));const revision=(await live(store)).revision!;
    const bytes=Buffer.from(client.objects.get("records/item")!.bytes);client.calls.length=0;
    await assert.rejects(controlledPutPair({client,key:"records/item",first:0,condition:{ifMatch:decodeRevision(revision).etag},conflictCode:"REVISION_CONFLICT",timeoutMs:25,write:async(gated,context,index)=>{
      if(index===1){if(defect === "early-failure")throw Error("controlled failure before PUT");return;}
      await new TosDataStore("records","file.json",config("revision"),gated).update(context,data("item","new"),{expectedRevision:revision});
    }}),/CAS barrier deadline: both original conditions prepared/);
    assert.deepEqual(client.objects.get("records/item")!.bytes,bytes);assert.deepEqual(client.calls,[]);
  });
}

test("list waits for its cancelled sibling to settle and preserves the original failure", async t => {
  const {client,store}=fixture();
  await store.create({},data("bad"));await store.create({},data("stalled"));
  const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};
  const started=deferred(),fail=deferred(),cancelled=deferred(),released=deferred();let count=0;
  const original=new Error("first candidate failed");
  t.mock.method(client,"read",async(context:import("../src/data/api/context.js").Context,key:string)=>{
    if(++count===2)started.resolve();
    if(key.endsWith("/bad")){await fail.promise;throw original;}
    await new Promise<void>(resolve=>context.signal!.addEventListener("abort",()=>resolve(),{once:true}));
    cancelled.resolve();await released.promise;throw new Error("cancelled sibling settled");
  });
  const parent=new AbortController();
  let settled=false;const list=store.list({signal:parent.signal}),observed=list.finally(()=>{settled=true;});void observed.catch(()=>undefined);
  const rejected=assert.rejects(list,error=>error===original);
  try{
    await casPhase(started.promise,"list snapshots started");fail.resolve();
    await casPhase(cancelled.promise,"list sibling cancelled");
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(settled,false,"List must wait for the cancelled read's asynchronous cleanup");
    released.resolve();await rejected;
  }finally{parent.abort();fail.resolve();released.resolve();await Promise.allSettled([list,observed,rejected]);}
});
