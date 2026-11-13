import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { businessFixture } from "./helpers/business-data.js";
import { invokeCliModule } from "./helpers/cli-module.js";
import { useTosService } from "./support/tos-sdk-service.js";
import { encodeHeader } from "../src/data/extensions/tos-datastore/header.js";

test("TOS CLI uses opaque zero/quoted-colon revisions through deletion, normal update and byte export",{timeout:30_000},async t=>{
  const f=await businessFixture(t), service=useTosService(t);
  const env={...process.env,MEMSPHERE_HOME:f.home,CLI_TOS_AK:"fixture-ak",CLI_TOS_SK:"fixture-sk"};
  const command=async(args:string[])=>invokeCliModule(["--project","test-project","data",...args,"--output","json"],f.cwd,env,"memsphere");
  const run=async(args:string[])=>JSON.parse((await command(args)).stdout);
  const config=join(f.directory,"tos.json"),input=join(f.directory,"payload.bin"),out=join(f.directory,"export.bin");
  const bytes=Buffer.from([0,255,17,13,10,88]);await fs.writeFile(input,bytes);
  await fs.writeFile(config,JSON.stringify({mode:"revision",region:"cn-beijing",endpoint:"tos-cn-beijing.volces.com",bucket:"test-bucket",prefix:"cli/",credentials:{source:"env",accessKeyIdEnv:"CLI_TOS_AK",accessKeySecretEnv:"CLI_TOS_SK"}}));
  await run(["store","create","assets","--model","record.json","--kind","data","--factory","memsphere/tos","--config-file",config]);
  await run(["create","item","--store","assets","--payload-file",input,"--content-type","application/octet-stream"]);
  const object=service.objects.get("cli/item")!;
  object.bytes=Buffer.concat([encodeHeader(0,false),bytes]);object.headers.etag='"zero:opaque:etag"';
  const first=await run(["read","item","--store","assets","--metadata-only"]);
  assert.equal(first.revision,'00000000:"zero:opaque:etag"');
  const snapshot=Buffer.from(object.bytes), before=service.calls.length;
  await run(["delete","item","--store","assets","--expected-revision",first.revision,"--dry-run"]);
  assert.deepEqual(service.objects.get("cli/item")!.bytes,snapshot);assert.ok(service.calls.slice(before).every(c=>!["PUT","DELETE"].includes(c.method)));
  await run(["delete","item","--store","assets","--expected-revision",first.revision]);
  const deleted=await run(["read","item","--store","assets"]);assert.equal(deleted.deleted,true);assert.equal("value" in deleted,false);
  const tombstone=Buffer.from(service.objects.get("cli/item")!.bytes);
  await assert.rejects(command(["update","item","--store","assets","--expected-revision",first.revision,"--payload-file",input,"--content-type","application/octet-stream"]),error=>{assert.match(String((error as Error).message),/REVISION_CONFLICT/);return true;});
  assert.deepEqual(service.objects.get("cli/item")!.bytes,tombstone);
  await run(["update","item","--store","assets","--expected-revision",deleted.revision,"--payload-file",input,"--content-type","application/octet-stream"]);
  const current=await run(["read","item","--store","assets","--metadata-only"]);assert.notEqual(current.revision,deleted.revision);assert.equal(current.deleted,undefined);
  await run(["export","item","--store","assets","--as","payload","--out",out]);assert.deepEqual(await fs.readFile(out),bytes);
  assert.deepEqual(service.objects.get("cli/item")!.bytes.subarray(10),bytes);
});

for(const operation of ["read","validate","export"] as const)for(const failure of ["conflict","permission"] as const){
  test(`TOS CLI active JSON ${operation} exposes ${failure} without publishing or overwriting`,{timeout:30_000},async t=>{
    const f=await businessFixture(t),service=useTosService(t);
    const env={...process.env,MEMSPHERE_HOME:f.home,CLI_TOS_AK:"fixture-ak",CLI_TOS_SK:"fixture-sk"};
    const command=(args:string[])=>invokeCliModule(["--project","test-project","data",...args,"--output","json"],f.cwd,env,"memsphere");
    const settings=join(f.directory,"tos.json"),output=join(f.directory,"not-published.json");
    await fs.writeFile(settings,JSON.stringify({mode:"revision",region:"cn-beijing",endpoint:"tos-cn-beijing.volces.com",bucket:"test-bucket",prefix:"cli-json/",credentials:{source:"env",accessKeyIdEnv:"CLI_TOS_AK",accessKeySecretEnv:"CLI_TOS_SK"}}));
    await command(["store","create","assets","--model","record.json","--kind","data","--factory","memsphere/tos","--config-file",settings]);
    await command(["create","item","--store","assets","--value",'{"name":"first","count":0}']);
    const read=service.read.bind(service),original=Buffer.from(service.objects.get("cli-json/item")!.bytes);let injected=false;
    const {TosRequestError}=await import("../src/data/extensions/tos-datastore/context-sdk.js");
    service.read=async(context,key,options)=>{
      if(options?.ifMatch && !injected){
        injected=true;
        if(failure === "permission")throw new TosRequestError("AccessDenied",403);
        const object=service.objects.get(key)!;object.bytes=Buffer.concat([encodeHeader(2,false),Buffer.from('{"name":"concurrent","count":1}')]);object.headers.etag='"concurrent:etag"';object.headers["content-length"]=String(object.bytes.length);
      }
      return read(context,key,options);
    };
    service.calls.length=0;
    const args=[operation,"item","--store","assets",...(operation === "export" ? ["--as","json","--out",output] : [])];
    await assert.rejects(command(args),error=>{assert.equal(JSON.parse((error as Error & {stderr:string}).stderr).error.code,failure === "conflict" ? "REVISION_CONFLICT" : "AccessDenied");return true;});
    assert.equal(injected,true);assert.ok(service.calls.every(call=>!["PUT","DELETE"].includes(call.method)));
    if(failure === "permission")assert.deepEqual(service.objects.get("cli-json/item")!.bytes,original);
    else assert.equal(service.objects.get("cli-json/item")!.bytes.subarray(10).toString(),'{"name":"concurrent","count":1}');
    await assert.rejects(fs.stat(output),{code:"ENOENT"});
  });
}
