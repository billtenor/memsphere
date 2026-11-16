import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appSettingsServer } from "./helpers/app-settings.js";
import { createViewServer } from "../src/commands/view.js";
import { readAppSettings } from "../src/app/settings.js";
import { configureApp } from "../src/app/install.js";
import type { MemsphereConfig } from "../src/config.js";

for (const host of ["127.0.0.1", "0.0.0.0"]) {
    async function fixture(t: import("node:test").TestContext) {
        const f=await appSettingsServer(t,host);
        const base=`${f.origin}/api/projects/test-project/settings/apps`;
        const headers:Record<string,string>=host==="127.0.0.1"?{}:{authorization:`Bearer ${f.token}`};
        const a=await (await fetch(`${base}/example.app`,{headers})).json() as any;
        const send=(method:string,suffix:string,config=a.config,revision=a.revision)=>fetch(`${base}/example.app${suffix}`,{method,headers:{...headers,origin:f.origin,"content-type":"application/json"},body:JSON.stringify({config,expectedRevision:revision})});
        return {...f,base,headers,a,send};
    }
    test(`App settings HTTP ${host} enforces listener authentication and mutation origin/JSON`,async t=>{
        const {origin,base,headers,a}=await fixture(t);
        assert.equal((await fetch(base)).status,host==="127.0.0.1"?200:401);
        const body=JSON.stringify({config:a.config,expectedRevision:a.revision});
        assert.equal((await fetch(`${base}/example.app`,{method:"PUT",headers:{...headers,"content-type":"application/json",origin:"https://other.example"},body})).status,403);
        assert.equal((await fetch(`${base}/example.app/validate`,{method:"POST",headers:{...headers,origin,"content-type":"text/plain"},body})).status,403);
    });
    test(`App settings HTTP ${host} scopes list and detail without caching`,async t=>{
        const {origin,base,headers}=await fixture(t);
        const list=await fetch(base,{headers});assert.equal(list.status,200);
        assert.deepEqual((await list.json() as any).apps.map((a:any)=>a.id),["example.app"]);
        assert.equal((await fetch(`${base}/example.app`,{headers})).headers.get("cache-control"),"no-store");
        assert.equal((await fetch(`${base}/missing.app`,{headers})).status,404);
        assert.equal((await fetch(`${origin}/api/projects/missing/settings/apps`,{headers})).status,404);
    });
    test(`App settings HTTP ${host} preview does not persist the candidate`,async t=>{
        const {a,send,project}=await fixture(t);
        assert.equal((await send("POST","/validate",{...a.config,name:"B"})).status,200);
        const after=await readAppSettings(project,a.id);assert.equal(after.config.name,"A");assert.equal(after.revision,a.revision);
    });
    test(`App settings HTTP ${host} save advances revision and rejects a CLI-stale revision`,async t=>{
        const {a,send,project,context}=await fixture(t);
        const saved=await send("PUT","",{...a.config,name:"B"});assert.equal(saved.status,200);const b=await saved.json() as any;
        assert.notEqual(b.revision,a.revision);assert.equal((await readAppSettings(project,a.id)).config.name,"B");
        await configureApp(context,a.id,{...a.config,name:"C"});
        const conflict=await send("PUT","",b.config,b.revision);assert.equal(conflict.status,409);assert.equal((await conflict.json() as any).code,"APP_CONFIG_CONFLICT");
    });
}

for(const method of ["POST","PUT"]) test(`App settings ${method} rejects readOnly changes independently of the editor`,{timeout:30000},async t=>{
    const {origin,project}=await appSettingsServer(t,"127.0.0.1",false,"zh-CN",{readOnly:true});
    const a=await readAppSettings(project,"example.app");
    const endpoint=`${origin}/api/projects/test-project/settings/apps/example.app${method==="POST"?"/validate":""}`;
    const request=(config:unknown)=>fetch(endpoint,{method,headers:{origin,"content-type":"application/json"},body:JSON.stringify({config,expectedRevision:a.revision}),signal:t.signal});
    const rejected=await request({...a.config,store:"second",name:"B"});
    assert.equal(rejected.status,400);assert.equal((await rejected.json() as any).code,"APP_SETTINGS_READ_ONLY");
    const unchanged=await readAppSettings(project,"example.app");assert.equal(unchanged.config.store,"first");assert.equal(unchanged.revision,a.revision);
    const allowed=await request({...a.config,name:"B"});assert.equal(allowed.status,200);
    const after=await readAppSettings(project,"example.app");assert.equal(after.config.store,"first");assert.equal(after.config.name,method==="POST"?"A":"B");
});

for(const method of ["POST","PUT"]) test(`appearance ${method} rejects the App-owned Slot without changing Home config`,async t=>{
    const {origin,f}=await appSettingsServer(t);
    const configPath=join(f.home,"config.json");
    const {readFile}=await import("node:fs/promises");
    const before=await readFile(configPath,"utf8");
    const document=await (await fetch(`${origin}/api/settings/global`)).json() as any;
    const candidate={...document.config,view_composition:{packages:[],slots:{"org.memsphere.settings.app.configuration@1:app":"example.settings:settings:configuration"}}};
    const response=await fetch(`${origin}/api/settings/global${method==="POST"?"/validate":""}`,{method,headers:{origin,"content-type":"application/json"},body:JSON.stringify({config:candidate,expectedRevision:document.diskRevision})});
    assert.equal(response.status,422);
    assert.match(JSON.stringify(await response.json()),/unknown configurable View Slot/);
    assert.equal(await readFile(configPath,"utf8"),before);
});
