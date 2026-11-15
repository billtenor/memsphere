import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createDataService } from "../../../src/project/data-service.js";
import type { DataStore } from "../../../src/data/api/data-store.js";
import { createPlainRuntime } from "../../../src/data/extensions/shared/reflection.js";
import { bytesContent } from "../../../src/data/extensions/shared/payload.js";

function gate(){let open!:()=>void;const promise=new Promise<void>(resolve=>{open=resolve;});return {promise,open};}
async function partialFile(directory:string,signal:AbortSignal){
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){
    signal.throwIfAborted();
    for(const name of await fs.readdir(directory))if(name.startsWith(".memsphere-export-") && (await fs.stat(join(directory,name))).size>0)return name;
    await new Promise<void>(resolve=>setTimeout(resolve,5));
  }
  throw Error("Export did not reach its first real filesystem write");
}

for(const failure of ["read-error","cancel","publication-race"] as const){
  test(`native streaming export ${failure} preserves targets and reclaims only its owned staging file`,{timeout:30000},async t=>{
    const directory=await fs.mkdtemp(join(tmpdir(),"memsphere-stream-export-")),destination=join(directory,"result.bin");
    const bytes=Buffer.alloc(128*1024,7),outside=Buffer.from("independent target");
    const controller=new AbortController(),resume=gate(),stopped=gate();
    const relay=()=>controller.abort(t.signal.reason);t.signal.addEventListener("abort",relay,{once:true});
    let owned:Readable|undefined,started=false,reads=0;
    const unexpected=async():Promise<never>=>{throw Error("Export must only read its source Store");};
    const store:DataStore={
      kind:"DataStore",id:"assets",model:"file.json",
      async get(context,id){
        reads++;assert.equal(id,"item");
        let content=bytesContent(bytes);
        if(failure !== "publication-race"){
          const abort=()=>resume.open();context.signal?.addEventListener("abort",abort,{once:true});
          owned=Readable.from((async function*(){
            started=true;
            try{yield bytes.subarray(0,65536);await resume.promise;context.signal?.throwIfAborted();throw Object.assign(Error("controlled read failure"),{code:"READ_FAILED"});}
            finally{context.signal?.removeEventListener("abort",abort);stopped.open();}
          })());owned.on("error",()=>undefined);
          const stream=Readable.toWeb(owned) as ReadableStream<Uint8Array>;
          content={stream:()=>stream};
        }
        return {data:{id,model:"file.json",payload:{contentType:"application/octet-stream",content}}};
      },
      has:unexpected,create:unexpected,update:unexpected,delete:unexpected,list:unexpected
    };
    let publications=0;
    const runtime=createPlainRuntime({id:"file.json",root:{kind:"scalar",scalar:"bytes"}});
    const service=createDataService({async openStore(){return {store,runtime,stamp:"fixed",binding:{kind:"data",factory:"test/stream-source",model:"file.json",config:{}}};},async assertStamp(){
      publications++;
      if(failure === "publication-race"){
        const staging=(await fs.readdir(directory)).filter(name=>name.startsWith(".memsphere-export-"));assert.equal(staging.length,1);
        assert.deepEqual(await fs.readFile(join(directory,staging[0])),bytes);
        await fs.writeFile(destination,outside,{flag:"wx"});
      }
    }});
    const operation=service.exportData({signal:controller.signal},"project","assets","item","payload",destination);
    const observed=operation.catch(error=>error);
    try{
      if(failure !== "publication-race"){
        await partialFile(directory,t.signal);
        if(failure === "cancel")controller.abort(Object.assign(Error("controlled cancellation"),{code:"ABORTED"}));else resume.open();
      }
      const error=await observed;assert.equal(error.code,failure === "publication-race" ? "EEXIST" : failure === "cancel" ? "ABORTED" : "READ_FAILED");
      if(started)await stopped.promise;
      if(failure === "publication-race")assert.deepEqual(await fs.readFile(destination),outside);
      else await assert.rejects(fs.stat(destination),{code:"ENOENT"});
      assert.equal(publications,failure === "publication-race" ? 1 : 0);
      assert.deepEqual((await fs.readdir(directory)).filter(name=>name.startsWith(".memsphere-export-")),[]);
      if(owned)assert.equal(owned.destroyed,true);
      assert.equal(reads,1);
    }finally{
      controller.abort();resume.open();owned?.destroy();await observed;if(started)await stopped.promise;
      t.signal.removeEventListener("abort",relay);await fs.rm(directory,{recursive:true,force:true});
    }
  });
}
