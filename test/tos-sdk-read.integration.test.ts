import assert from "node:assert/strict";
import test from "node:test";
import { TosDataStore } from "../src/data/extensions/tos-datastore/store.js";
import { bindTosClient } from "../src/data/extensions/tos-datastore/client.js";
import { encodeHeader } from "../src/data/extensions/tos-datastore/header.js";
import { readAll, bytesContent } from "../src/data/extensions/shared/payload.js";
import { fixture, gate, responseChunk } from "./support/tos-sdk-http.js";

const settings = { timeout: 10_000 };
const config = (mode: "raw" | "revision") => ({ mode, region:"cn-beijing",endpoint:"tos-cn-beijing.volces.com",bucket:"probe-bucket",prefix:"test/",credentials:{source:"settings" as const,id:"fixture"} });
const identity = (mode: "raw" | "revision") => ({etag:'"snapshot"',"content-type":mode === "raw" ? "text/plain" : "application/octet-stream","x-tos-meta-memsphere-store-format":`${mode}-v1`,"x-tos-meta-memsphere-model":Buffer.from("file.json").toString("base64url"),"x-tos-meta-memsphere-content-type":"text/plain"});
const invoke = (store: TosDataStore, operation: "get" | "has" | "delete", context = {}) => store[operation](context,"item");

for (const operation of ["get","has","delete"] as const) for (const failure of ["NoSuchKey","NoSuchBucket","AccessDenied","ServerError","malformed","oversized","head-denied"] as const) {
  test(`SDK raw ${operation}: ${failure} is classified without an unsafe DELETE`,settings,async t => {
    const methods: string[] = [], closed: Promise<void>[] = [];
    const f = await fixture(t,(request,response) => {
      methods.push(request.method!); const done = gate(); closed.push(done.promise);response.once("close",done.resolve);
      if (request.method === "HEAD") {response.writeHead(failure === "head-denied" ? 403 : 404);response.end();return;}
      assert.equal(request.method,"GET");
      const status = failure === "AccessDenied" ? 403 : failure === "ServerError" ? 503 : 404;
      response.writeHead(status,{"content-type":"application/json"});
      response.end(failure === "malformed" ? "not json" : failure === "oversized" ? "x".repeat(65537) : JSON.stringify({Code:failure}));
    });
    const store = new TosDataStore("store","file.json",config("raw"),bindTosClient(f.sdk,"probe-bucket"));
    if (failure === "NoSuchKey") assert.equal(await invoke(store,operation),operation === "get" ? undefined : false);
    else await assert.rejects(invoke(store,operation),{code:failure === "malformed" ? "HTTP_404" : failure === "oversized" ? "RESPONSE_TOO_LARGE" : failure === "head-denied" ? "HTTP_403" : failure});
    await Promise.all(closed);
    assert.deepEqual(methods,failure === "head-denied" ? ["HEAD"] : ["HEAD","GET"]);
  });
}

for (const operation of ["get","has","delete"] as const) for (const disappears of [false,true]) {
  test(`SDK raw ${operation}: diagnostic 200 closes before EOF and fresh HEAD ${disappears ? "fails safely" : "authorizes current state"}`,settings,async t => {
    const methods: string[] = [], diagnosticClosed = gate();let heads=0;
    const f=await fixture(t,(request,response)=>{
      methods.push(request.method!);
      if(request.method === "HEAD") { if(++heads===1 || disappears) response.writeHead(404); else response.writeHead(200,{...identity("raw"),"content-length":"7"});response.end();return; }
      if(request.method === "GET") {response.once("close",diagnosticClosed.resolve);response.writeHead(200,{...identity("raw"),"content-length":"1000000"});response.write(Buffer.alloc(1024));return;}
      assert.equal(request.method,"DELETE");response.writeHead(204);response.end();
    });
    const store=new TosDataStore("store","file.json",config("raw"),bindTosClient(f.sdk,"probe-bucket"));
    if(disappears) await assert.rejects(invoke(store,operation),{code:"STORE_CHANGED"});else assert.ok(await invoke(store,operation));
    await diagnosticClosed.promise;
    assert.deepEqual(methods,["HEAD","GET","HEAD",...(!disappears && operation === "delete" ? ["DELETE"] : [])]);
  });
}

for (const operation of ["get","has","delete"] as const) for (const cancellation of ["signal","deadline"] as const) {
  test(`SDK raw ${operation}: diagnostic error body ${cancellation} closes without DELETE`,settings,async t=>{
    const first=gate(),closed=gate(),methods:string[]=[],consumed=responseChunk(t,"diagnostic-body");
    const f=await fixture(t,(request,response)=>{
      methods.push(request.method!);
      if(request.method === "HEAD") {response.writeHead(404);response.end();return;}
      response.once("close",closed.resolve);response.writeHead(403,{"content-type":"application/json","x-tos-request-id":"diagnostic-body"});response.write('{"Code":"AccessDenied",');first.resolve();
    });
    const controller=f.controller();
    if(cancellation === "deadline") t.mock.timers.enable({apis:["setTimeout"]});
    try {
      const store=new TosDataStore("store","file.json",config("raw"),bindTosClient(f.sdk,"probe-bucket"));
      const rejected=assert.rejects(invoke(store,operation,{signal:controller.signal}),{code:cancellation === "signal" ? "ABORTED" : "TOS_DEADLINE"});
      await Promise.all([first.promise,consumed]);if(cancellation === "signal") controller.abort();else t.mock.timers.tick(120001);
      await rejected;await closed.promise;assert.deepEqual(methods,["HEAD","GET"]);
    } finally {controller.abort();if(cancellation === "deadline") t.mock.timers.reset();}
  });
}

for(const defect of ["ignored-range","bad-range","missing-etag","missing-model","bad-format","bad-mime","short-header","long-header","deleted-payload","payload-status","payload-range","payload-etag","payload-short","payload-long"] as const){
  test(`SDK revision read rejects ${defect} through the production Store and releases responses`,settings,async t=>{
    const methods:string[]=[], closed:Promise<void>[]=[];
    const f=await fixture(t,(request,response)=>{
      methods.push(request.method!);const done=gate();closed.push(done.promise);response.once("close",done.resolve);
      assert.equal(request.method,"GET");
      if(request.headers.range === "bytes=0-9"){
        const headers:Record<string,string>={...identity("revision"),"content-range":"bytes 0-9/14"};
        if(defect === "bad-range") headers["content-range"]="bytes 1-10/14";
        if(defect === "missing-etag") delete headers.etag;
        if(defect === "missing-model") delete headers["x-tos-meta-memsphere-model"];
        if(defect === "bad-format") headers["x-tos-meta-memsphere-store-format"]="raw-v1";
        if(defect === "bad-mime") headers["x-tos-meta-memsphere-content-type"]="invalid";
        response.writeHead(defect === "ignored-range" ? 200 : 206,headers);
        response.write(defect === "short-header" ? encodeHeader(1,false).slice(0,9) : defect === "long-header" ? Buffer.concat([encodeHeader(1,false),Buffer.of(1)]) : encodeHeader(1,defect === "deleted-payload"));response.end();return;
      }
      assert.equal(request.headers.range,"bytes=10-");assert.equal(request.headers["if-match"],'"snapshot"');
      const headers:Record<string,string>={...identity("revision"),"content-range":defect === "payload-range" ? "bytes 11-14/15" : "bytes 10-13/14"};
      if(defect === "payload-etag") headers.etag='"changed"';
      response.writeHead(defect === "payload-status" ? 200 : 206,headers);
      response.write(defect === "payload-short" ? "abc" : defect === "payload-long" ? "abcde" : "abcd");response.end();
    });
    const store=new TosDataStore("store","file.json",config("revision"),bindTosClient(f.sdk,"probe-bucket"));
    await assert.rejects(async()=>{const out=await store.get({},"item");assert.ok(out && !out.deleted);await readAll({},out.data.payload.content);});
    await Promise.all(closed);assert.ok(methods.every(method=>method === "GET"));
    assert.equal(methods.length,defect.startsWith("payload-") ? 2 : 1);
  });
}

for (const mode of ["raw","revision"] as const) for (const operation of ["get","has","list",...(mode === "raw" ? ["delete" as const] : [])] as const) for (const status of [403,503]) {
  test(`SDK ${mode} ${operation} preserves contradictory ${status}/NoSuchKey as failure`,settings,async t=>{
    const methods:string[]=[];
    const f=await fixture(t,(request,response)=>{
      methods.push(request.method!);
      if(new URL(request.url!,"http://fixture").searchParams.has("list-type")){response.setHeader("content-type","application/json");response.end(JSON.stringify({Contents:[{Key:"test/item"}],IsTruncated:false}));return;}
      if(request.method === "HEAD"){response.writeHead(404);response.end();return;}
      response.writeHead(status,{"content-type":"application/json","x-tos-request-id":"contradictory"});response.end(JSON.stringify({Code:"NoSuchKey"}));
    });
    const store=new TosDataStore("store","file.json",config(mode),bindTosClient(f.sdk,"probe-bucket"));
    await assert.rejects(operation === "list" ? store.list({}) : invoke(store,operation),{code:"NoSuchKey",status,requestId:"contradictory"});
    assert.ok(methods.every(method=>method === "GET" || method === "HEAD"));
  });
}
for(const operation of ["create","update","delete"] as const) for(const status of [403,404,503]){
  test(`SDK ${operation} maps NoSuchKey only for a missing conditional target at HTTP ${status}`,settings,async t=>{
    const methods:string[]=[];
    const f=await fixture(t,(request,response)=>{
      methods.push(request.method!);request.resume();request.once("end",()=>{response.writeHead(status,{"content-type":"application/json","x-tos-request-id":"write-error"});response.end(JSON.stringify({Code:"NoSuchKey"}));});
    });
    const store=new TosDataStore("store","file.json",config("revision"),bindTosClient(f.sdk,"probe-bucket"));
    const data={id:"item",model:"file.json",payload:{contentType:"text/plain",content:bytesContent(Buffer.from("body"))}};
    const options={expectedRevision:'00000001:"original"'};
    const operationResult=operation === "create" ? store.create({},data) : operation === "update" ? store.update({},data,options) : store.delete({},"item",options);
    if(status === 404 && operation !== "create")await assert.rejects(operationResult,{code:"REVISION_CONFLICT"});
    else await assert.rejects(operationResult,{code:"NoSuchKey",status,requestId:"write-error"});
    assert.deepEqual(methods,["PUT"]);
  });
}
