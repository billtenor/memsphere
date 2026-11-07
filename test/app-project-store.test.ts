import assert from "node:assert/strict";
import test from "node:test";
import { appManifestSchema } from "../src/app/contracts.js";
import { projectStoreBinding, updateProjectStoreGenerations } from "../src/app/project-stores.js";
import type { AppInstallation, AppProject } from "../src/app/state.js";
import { removeBusinessStore } from "../src/project/business-stores.js";
import { businessFixture } from "./helpers/business-data.js";

test("Project Store binding resolves existing records and changes identity when re-registered", async t => {
  const fixture = await businessFixture(t);
  await fixture.createStore();
  const manifest = appManifestSchema.parse({ schemaVersion: 1, id: "example.app", name: "Example", version: "1.0.0", description: "Example", projectStores: [{ key: "expenses", model: "record.json", kind: "ValueStore", configKey: "store" }] });
  const app = { manifest, config: { store: "records" } } as AppInstallation;
  const project = { paths: { root: fixture.root }, memoryRoot: `${fixture.root}/memory` } as AppProject;
  updateProjectStoreGenerations(app);
  const first = await projectStoreBinding(project, app, "expenses");
  assert.equal(first.store.kind, "ValueStore");
  if (first.store.kind !== "ValueStore") throw new Error("wrong kind");
  await first.store.create({}, "one", { name: "first", count: 1 });
  await removeBusinessStore({}, fixture.root, "records");
  await fixture.createStore();
  const second = await projectStoreBinding(project, app, "expenses");
  assert.notEqual(second.token, first.token);
  assert.equal(second.store.kind, "ValueStore");
  if (second.store.kind !== "ValueStore") throw new Error("wrong kind");
  assert.deepEqual((await second.store.get({}, "one"))?.value, { name: "first", count: 1 });
});

test("Project Store binding rejects an incompatible Store instead of creating another", async t => {
  const fixture = await businessFixture(t);
  await fixture.createStore();
  const manifest = appManifestSchema.parse({ schemaVersion: 1, id: "example.app", name: "Example", version: "1.0.0", description: "Example", projectStores: [{ key: "expenses", model: "record.json", kind: "DataStore", configKey: "store" }] });
  const app = { manifest, config: { store: "records" } } as AppInstallation;
  const project = { paths: { root: fixture.root }, memoryRoot: `${fixture.root}/memory` } as AppProject;
  await assert.rejects(projectStoreBinding(project, app, "expenses"), { code: "APP_STORE_MISMATCH" });
});

test("App binding rejects the internal context-control Stores", async t => {
  const fixture = await businessFixture(t);
  const manifest = appManifestSchema.parse({ schemaVersion: 1, id: "example.app", name: "Example", version: "1.0.0", description: "Example", projectStores: [{ key: "runs", model: "record.json", kind: "ValueStore", configKey: "store" }] });
  const app = { manifest, config: { store: "context_control/runs" } } as AppInstallation;
  const project = { paths: { root: fixture.root }, memoryRoot: `${fixture.root}/memory` } as AppProject;
  await assert.rejects(projectStoreBinding(project, app, "runs"), { code: "APP_STORE_FORBIDDEN" });
});

test("a declared DataStore resolves the Project's existing DataStore", async t => {
  const fixture = await businessFixture(t);
  await fixture.createStore("files", "record.json", "data");
  const manifest = appManifestSchema.parse({ schemaVersion: 1, id: "example.app", name: "Example", version: "1.0.0", description: "Example", projectStores: [{ key: "files", model: "record.json", kind: "DataStore", configKey: "store" }] });
  const app = { manifest, config: { store: "files" } } as AppInstallation;
  const project = { paths: { root: fixture.root }, memoryRoot: `${fixture.root}/memory` } as AppProject;
  const binding = await projectStoreBinding(project, app, "files");
  assert.equal(binding.store.kind, "DataStore");
  assert.equal(binding.store.id, "files");
});

async function valueFixture(t: import("node:test").TestContext) {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { configureApp, installApp } = await import("../src/app/install.js");
  const { readAppState, writeAppState } = await import("../src/app/state.js");
  const { projectPaths } = await import("../src/project/paths.js");
  const { readBusinessProject } = await import("../src/project/business-stores.js");
  const { invokeAppOperation } = await import("../src/app/backend.js");
  const { writeData, readData } = await import("../src/project/data-service.js");
  type ProjectContext = import("../src/project/resolver.js").ProjectContext;
  const fixture = await businessFixture(t);
  for (const kind of ["concepts", "statements", "procedures", "schemas"]) await mkdir(join(fixture.root, "memory", kind), { recursive: true });
  await fixture.createStore("first"); await fixture.createStore("second");
  await writeData({}, fixture.root, "first", "one", "create", { kind: "value", value: { name: "old", count: 1 } });
  const root = join(fixture.directory, "app"); await mkdir(root);
  await writeFile(join(root, "backend.mjs"), `export default {operations: {
    read: {kind:'read', execute: async ctx => {const binding=await ctx.getProjectStoreBinding('expenses');const store=await ctx.getStore('expenses',{expectedBinding:binding.token});return {binding,row:await store.get({},'one')};}},
    write: {kind:'write', execute: async (ctx,input) => {const store=await ctx.getStore('expenses',{expectedBinding:input.token});return store.upsert({},'one',input.value);}},
    update: {kind:'read', execute: async (ctx,input) => {const store=await ctx.getStore('expenses',{expectedBinding:input.token});return store.update({},'one',input.value);}},
    remove: {kind:'read', execute: async (ctx,input) => {const store=await ctx.getStore('expenses',{expectedBinding:input.token});return store.delete({},'one');}},
    create: {kind:'read', execute: async (ctx,input) => {const store=await ctx.getStore('expenses',{expectedBinding:input.token});return store.create({},input.id,input.value);}},
    caught: {kind:'write', execute: async (ctx,input) => {const store=await ctx.getStore('expenses',{expectedBinding:input.token});try {await store.create({},'one',input.value);} catch(e) {if(e.code!=='ALREADY_EXISTS') throw e;} await store.update({},'one',input.value); return 'recovered';}},
    unhandled: {kind:'write', execute: async (ctx,input) => {const store=await ctx.getStore('expenses',{expectedBinding:input.token});void store.create({},'one',input.value);return 'started';}},
    unhandledchain: {kind:'write', execute: async (ctx,input) => {const store=await ctx.getStore('expenses',{expectedBinding:input.token});void store.create({},'one',input.value).then(()=>{});return 'started';}},
    unhandledfinally: {kind:'write', execute: async (ctx,input) => {const store=await ctx.getStore('expenses',{expectedBinding:input.token});void store.create({},'one',input.value).finally(()=>{});return 'started';}},
    caughtchain: {kind:'write', execute: async (ctx,input) => {const store=await ctx.getStore('expenses',{expectedBinding:input.token});return store.create({},'one',input.value).then(()=>false).catch(e=>e.code==='ALREADY_EXISTS');}},
    throwundefined: {kind:'read', execute: async () => {throw undefined;}},
    fire: {kind:'write', execute: async (ctx,input) => {const store=await ctx.getStore('expenses',{expectedBinding:input.token});void store.upsert({},'one',input.value);return 'started';}},
    firethrow: {kind:'write', execute: async (ctx,input) => {const store=await ctx.getStore('expenses',{expectedBinding:input.token});void store.upsert({},'one',input.value);throw new Error('backend failure');}},
    cancel: {kind:'write', execute: async (ctx,input) => {const store=await ctx.getStore('expenses',{expectedBinding:input.token});void store.upsert({},'one',input.value);await new Promise(resolve=>ctx.signal.addEventListener('abort',resolve,{once:true}));}},
    leak: {kind:'read', execute: async (ctx,input) => {globalThis.__issue137LeakedStore=await ctx.getStore('expenses',{expectedBinding:input.token});}},
    hold: {kind:'write', execute: async (ctx,input) => {const store=await ctx.getStore('expenses',{expectedBinding:input.token});process.send({event:'locked'});await new Promise(resolve=>process.once('message',resolve));await store.upsert({},'one',{name:'child',count:7});}}
  }};`);
  const operations = { read:"read",write:"write",update:"read",remove:"read",create:"read",caught:"write",unhandled:"write",unhandledchain:"write",unhandledfinally:"write",caughtchain:"write",throwundefined:"read",fire:"write",firethrow:"write",cancel:"write",leak:"read",hold:"write" };
  const manifest = appManifestSchema.parse({ schemaVersion:1,id:"example.app",name:"Example",version:"1.0.0",description:"Example",projectStores:[{key:"expenses",model:"record.json",kind:"ValueStore",configKey:"store"}],backend:{entry:"backend.mjs",operations} });
  await writeFile(join(root,"app.json"),JSON.stringify(manifest));
  const project = {name:"test-project",paths:projectPaths(fixture.root),memoryRoot:join(fixture.root,"memory"),config:await readBusinessProject(fixture.root)} as AppProject;
  const context = {primary:project,home:fixture.home} as ProjectContext;
  await installApp(context,root,{store:"first"});
  const installed=await readAppState(project);installed.installations["example.app"]!.enabled=true;await writeAppState(project,installed);
  const invoke=(operation:string,input:unknown,signal?:AbortSignal)=>invokeAppOperation(project,"example.app",operation,input,signal);
  const read=async()=>await invoke("read",{}) as {binding:{token:string};row?:{value:unknown}};
  return {fixture,project,context,invoke,read,readData,writeData,configureApp,readAppState,writeAppState};
}

function queueWorker(child: import("node:child_process").ChildProcess) {
  const queue: Array<{event:string;name?:string;code?:string}> = [];
  let waiter: {resolve:(value:{event:string;name?:string;code?:string})=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>} | undefined;
  let ended: Error | undefined;
  child.on("message", value => { const item=value as {event:string;name?:string;code?:string}; if(waiter){const w=waiter;waiter=undefined;clearTimeout(w.timer);w.resolve(item);} else queue.push(item); });
  const fail=(error:Error)=>{ended=error;if(waiter){const w=waiter;waiter=undefined;clearTimeout(w.timer);w.reject(error);}};
  child.once("error",fail); child.once("close",(code,signal)=>fail(new Error(`worker closed: ${code ?? signal}`)));
  return {child,next:()=>new Promise<{event:string;name?:string;code?:string}>((resolve,reject)=>{const item=queue.shift();if(item){resolve(item);return;}if(ended){reject(ended);return;}if(waiter){reject(new Error("concurrent worker waits"));return;}const timer=setTimeout(()=>{waiter=undefined;reject(new Error("worker did not respond"));},15000);waiter={resolve,reject,timer};})};
}

async function launchWorker(t:import("node:test").TestContext,root:string,mode:string,arg?:string,beforeCleanup?:(cleanup:()=>Promise<void>)=>void) {
  const {fork}=await import("node:child_process");const {resolve}=await import("node:path");
  const child=fork(resolve("test/helpers/shared-store-lock-worker.ts"),[mode,root,...(arg?[arg]:[])],{execArgv:["--import","tsx"],stdio:["ignore","ignore","inherit","ipc"]});
  const queued=queueWorker(child);
  const stop=async()=>{if(child.exitCode!==null||child.signalCode!==null)return;const closed=new Promise<void>(resolve=>child.once("close",()=>resolve()));child.kill();let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([closed,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("worker did not exit")),5000);})]);}finally{if(timer)clearTimeout(timer);}};
  if(beforeCleanup) beforeCleanup(stop); else t.after(stop);
  return queued;
}

test("shared ValueStore reads existing records and writes are visible to Project data", {timeout:30000}, async t=>{
  const f=await valueFixture(t);const current=await f.read();assert.deepEqual(current.row?.value,{name:"old",count:1});
  await f.invoke("write",{token:current.binding.token,value:{name:"updated",count:2}});
  assert.deepEqual((await f.readData({},f.fixture.root,"first","one")).value,{name:"updated",count:2});
});

test("old-page delete after rebind cannot alter either Store", {timeout:30000}, async t=>{
  const f=await valueFixture(t);await f.writeData({},f.fixture.root,"second","one","create",{kind:"value",value:{name:"other",count:2}});
  const old=await f.read();await f.configureApp(f.context,"example.app",{store:"second"});
  await assert.rejects(f.invoke("remove",{token:old.binding.token}),{code:"APP_STORE_BINDING_CHANGED"});
  assert.deepEqual((await f.readData({},f.fixture.root,"first","one")).value,{name:"old",count:1});
  assert.deepEqual((await f.readData({},f.fixture.root,"second","one")).value,{name:"other",count:2});
  const fresh=await f.read();assert.equal(await f.invoke("remove",{token:fresh.binding.token}),true);
});

for (const operation of ["create", "update", "write", "remove"] as const) test(`${operation} rejects missing and stale shared binding tokens`, {timeout:30000}, async t => {
  const f=await valueFixture(t);const old=(await f.read()).binding.token;
  const input={id:"new",value:{name:"wrong",count:1}};
  await assert.rejects(f.invoke(operation,input),{code:"APP_STORE_BINDING_CHANGED"});
  await f.configureApp(f.context,"example.app",{store:"second"});
  await assert.rejects(f.invoke(operation,{...input,token:old}),{code:"APP_STORE_BINDING_CHANGED"});
  assert.deepEqual((await f.readData({},f.fixture.root,"first","one")).value,{name:"old",count:1});
  await assert.rejects(f.readData({},f.fixture.root,"second",operation==="create"?"new":"one"),{code:"NOT_FOUND"});
});

test("a binding token cannot be used by another App in the same Project",{timeout:30000},async t=>{
  const f=await valueFixture(t);const token=(await f.read()).binding.token;
  const state=await f.readAppState(f.project);const other=structuredClone(state.installations["example.app"]!);other.manifest.id="example.other";
  state.installations["example.other"]=other;await f.writeAppState(f.project,state);
  const {invokeAppOperation}=await import("../src/app/backend.js");
  await assert.rejects(invokeAppOperation(f.project,"example.other","write",{token,value:{name:"wrong",count:1}}),{code:"APP_STORE_BINDING_CHANGED"});
});

test("a binding token cannot be used in another Project",{timeout:30000},async t=>{
  const first=await valueFixture(t);const second=await valueFixture(t);const token=(await first.read()).binding.token;
  await assert.rejects(second.invoke("write",{token,value:{name:"wrong",count:1}}),{code:"APP_STORE_BINDING_CHANGED"});
});

test("a read and its binding token remain consistent across a rebinding attempt",{timeout:30000},async t=>{
  const f=await valueFixture(t);const {withSharedStoreLock}=await import("../src/project/shared-store-lock.js");
  const {FilesystemJsonValueStoreFactory}=await import("../src/data/extensions/filesystem-json-valuestore/index.js");
  let release!:()=>void,reached!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve});const entered=new Promise<void>(resolve=>{reached=resolve});t.after(()=>release());
  const original=FilesystemJsonValueStoreFactory.prototype.openExisting;
  t.mock.method(FilesystemJsonValueStoreFactory.prototype,"openExisting",async function(...args:Parameters<typeof original>){const store=await original.apply(this,args);const get=store.get.bind(store);store.get=async(...a)=>{reached();await barrier;return get(...a)};return store;});
  const reading=f.read();await entered;
  const switching=f.configureApp(f.context,"example.app",{store:"second"});
  await assert.rejects(withSharedStoreLock(f.fixture.root,async()=>{},AbortSignal.timeout(300)),{name:"TimeoutError"});
  release();const fromA=await reading;assert.deepEqual(fromA.row?.value,{name:"old",count:1});
  await switching;
  await assert.rejects(f.invoke("write",{token:fromA.binding.token,value:{name:"wrong",count:1}}),{code:"APP_STORE_BINDING_CHANGED"});
});

test("a captured Store error can be handled by the App and followed by a successful write", {timeout:30000}, async t=>{
  const f=await valueFixture(t);const token=(await f.read()).binding.token;
  assert.equal(await f.invoke("caught",{token,value:{name:"recovered",count:2}}),"recovered");
  assert.deepEqual((await f.readData({},f.fixture.root,"first","one")).value,{name:"recovered",count:2});
});

test("an unobserved rejected Store write fails the operation", {timeout:30000}, async t=>{
  const f=await valueFixture(t);const token=(await f.read()).binding.token;
  await assert.rejects(f.invoke("unhandled",{token,value:{name:"duplicate",count:2}}),{code:"ALREADY_EXISTS"});
});

test("a chained catch can handle a Store error",{timeout:30000},async t=>{
  const f=await valueFixture(t);const token=(await f.read()).binding.token;
  assert.equal(await f.invoke("caughtchain",{token,value:{name:"duplicate",count:2}}),true);
});

test("a fulfillment-only chain does not hide an unobserved Store rejection",{timeout:30000},async t=>{
  const f=await valueFixture(t);const token=(await f.read()).binding.token;
  await assert.rejects(f.invoke("unhandledchain",{token,value:{name:"duplicate",count:2}}),{code:"ALREADY_EXISTS"});
});

test("an unobserved finally chain does not hide a Store rejection",{timeout:30000},async t=>{
  const f=await valueFixture(t);const token=(await f.read()).binding.token;
  await assert.rejects(f.invoke("unhandledfinally",{token,value:{name:"duplicate",count:2}}),{code:"ALREADY_EXISTS"});
});

test("a backend rejection is not reported as success when it throws undefined",{timeout:30000},async t=>{
  const f=await valueFixture(t);let rejected=false;
  try {await f.invoke("throwundefined",{});} catch(error) {rejected=true;assert.equal(error,undefined);}
  assert.equal(rejected,true);
});

test("shared Store handles cannot be reused after the operation", {timeout:30000}, async t=>{
  const f=await valueFixture(t);const token=(await f.read()).binding.token;
  try {await f.invoke("leak",{token});const leaked=(globalThis as Record<string,unknown>).__issue137LeakedStore as {get:(context:object,id:string)=>Promise<unknown>};assert.throws(()=>leaked.get({},"one"),{code:"APP_OPERATION_CLOSED"});}
  finally {delete (globalThis as Record<string,unknown>).__issue137LeakedStore;}
});

test("a binding token stays stale after A-to-B-to-A", {timeout:30000}, async t=>{
  const f=await valueFixture(t);const token=(await f.read()).binding.token;
  await f.configureApp(f.context,"example.app",{store:"second"});await f.configureApp(f.context,"example.app",{store:"first"});
  await assert.rejects(f.invoke("write",{token,value:{name:"wrong",count:0}}),{code:"APP_STORE_BINDING_CHANGED"});
});

test("an invalid rebind preserves the previous target", {timeout:30000}, async t=>{
  const f=await valueFixture(t);const old=(await f.read()).binding.token;
  await assert.rejects(f.configureApp(f.context,"example.app",{store:"missing"}),{code:"STORE_NOT_FOUND"});
  await f.invoke("write",{token:old,value:{name:"still first",count:2}});
  assert.deepEqual((await f.readData({},f.fixture.root,"first","one")).value,{name:"still first",count:2});
});

for(const mode of ["fire","firethrow","cancel"] as const) test(`in-flight Store writes retain the lock when backend ${mode} completes`,{timeout:30000},async t=>{
  const f=await valueFixture(t);const {withSharedStoreLock}=await import("../src/project/shared-store-lock.js");
  const {FilesystemJsonValueStoreFactory}=await import("../src/data/extensions/filesystem-json-valuestore/index.js");
  const token=(await f.read()).binding.token;let release!:()=>void,reached!:()=>void;
  const barrier=new Promise<void>(resolve=>{release=resolve});const entered=new Promise<void>(resolve=>{reached=resolve});
  t.after(()=>release());
  const original=FilesystemJsonValueStoreFactory.prototype.openExisting;
  t.mock.method(FilesystemJsonValueStoreFactory.prototype,"openExisting",async function(...args:Parameters<typeof original>){const store=await original.apply(this,args);const upsert=store.upsert!.bind(store);store.upsert=async(...a)=>{reached();await barrier;return upsert(...a)};return store;});
  const controller=new AbortController();const pending=f.invoke(mode,{token,value:{name:"pending",count:4}},controller.signal);const outcome=pending.then(()=>undefined,error=>error);
  await entered;if(mode==="cancel")controller.abort();
  await assert.rejects(withSharedStoreLock(f.fixture.root,async()=>{},AbortSignal.timeout(300)),{name:"TimeoutError"});
  release();const result=await outcome;if(mode!=="fire")assert(result);else assert.equal(result,undefined);
  await f.configureApp(f.context,"example.app",{store:"second"});
});

for(const [mode,arg] of [["remove","first"],["model",undefined],["recovery",undefined]] as const) test(`shared App operation excludes ${mode} across processes`,{timeout:45000},async t=>{
  const f=await valueFixture(t);const token=(await f.read()).binding.token;const child=await launchWorker(t,f.fixture.root,"invoke",token,f.fixture.beforeCleanup);assert.equal((await child.next()).event,"locked");
  const w=await launchWorker(t,f.fixture.root,mode,arg,f.fixture.beforeCleanup);assert.equal((await w.next()).event,"started");assert.deepEqual(await w.next(),{event:"failed",name:"TimeoutError"});
  child.child.send("release");assert.equal((await child.next()).event,"finished");
  if(mode==="recovery"){const recovery=await launchWorker(t,f.fixture.root,"recovery",undefined,f.fixture.beforeCleanup);assert.equal((await recovery.next()).event,"started");assert.equal((await recovery.next()).event,"recovered");}
  assert.deepEqual((await f.readData({},f.fixture.root,"first","one")).value,{name:"child",count:7});
});

test("removing and re-registering a Store preserves data but invalidates old tokens",{timeout:30000},async t=>{
  const f=await valueFixture(t);const token=(await f.read()).binding.token;await removeBusinessStore({},f.fixture.root,"first");
  await assert.rejects(f.invoke("write",{token,value:{name:"wrong",count:3}}),{code:"STORE_NOT_FOUND"});await f.fixture.createStore("first");
  await assert.rejects(f.invoke("write",{token,value:{name:"wrong",count:3}}),{code:"APP_STORE_BINDING_CHANGED"});
  assert.deepEqual((await f.readData({},f.fixture.root,"first","one")).value,{name:"old",count:1});
});

test("terminating a stuck shared App releases the Project lock",{timeout:45000},async t=>{
  const f=await valueFixture(t);const token=(await f.read()).binding.token;const stuck=await launchWorker(t,f.fixture.root,"invoke",token,f.fixture.beforeCleanup);assert.equal((await stuck.next()).event,"locked");
  const blocked=await launchWorker(t,f.fixture.root,"remove","first",f.fixture.beforeCleanup);assert.equal((await blocked.next()).event,"started");assert.deepEqual(await blocked.next(),{event:"failed",name:"TimeoutError"});
  const exited=new Promise<void>(resolve=>stuck.child.once("exit",()=>resolve()));stuck.child.kill("SIGKILL");await exited;
  const removal=await launchWorker(t,f.fixture.root,"remove","first",f.fixture.beforeCleanup);assert.equal((await removal.next()).event,"started");assert.equal((await removal.next()).event,"removed");
  await f.fixture.createStore("first");
  assert.deepEqual((await f.readData({},f.fixture.root,"first","one")).value,{name:"old",count:1});
});

test("Project Store removal in another process waits for a shared lock",{timeout:30000},async t=>{
  const f=await businessFixture(t);await f.createStore();const holder=await launchWorker(t,f.root,"hold",undefined,f.beforeCleanup);assert.equal((await holder.next()).event,"locked");
  const blocked=await launchWorker(t,f.root,"remove",undefined,f.beforeCleanup);assert.equal((await blocked.next()).event,"started");assert.deepEqual(await blocked.next(),{event:"failed",name:"TimeoutError"});
  holder.child.send("release");assert.equal((await holder.next()).event,"released");const next=await launchWorker(t,f.root,"remove",undefined,f.beforeCleanup);assert.equal((await next.next()).event,"started");assert.equal((await next.next()).event,"removed");
});

async function dataFixture(t: import("node:test").TestContext) {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { configureApp, installApp } = await import("../src/app/install.js");
  const { readAppState, writeAppState } = await import("../src/app/state.js");
  const { projectPaths } = await import("../src/project/paths.js");
  const { readBusinessProject } = await import("../src/project/business-stores.js");
  const { invokeAppOperation } = await import("../src/app/backend.js");
  const { writeData, readData } = await import("../src/project/data-service.js");
  type ProjectContext = import("../src/project/resolver.js").ProjectContext;
  const fixture = await businessFixture(t);
  for (const kind of ["concepts", "statements", "procedures", "schemas"]) await mkdir(join(fixture.root, "memory", kind), { recursive: true });
  await fixture.createStore("files", "record.json", "data");
  await writeData({}, fixture.root, "files", "one.json", "create", { kind: "value", value: { name: "first", count: 1 } });
  const root = join(fixture.directory, "data-app"); await mkdir(root);
  const manifest = appManifestSchema.parse({ schemaVersion: 1, id: "example.data", name: "Example", version: "1.0.0", description: "Example", projectStores: [{ key: "files", model: "record.json", kind: "DataStore", configKey: "store" }], backend: { entry: "backend.mjs", operations: { read: "read", write: "write", broken: "write", appendfail: "write" } } });
  await writeFile(join(root, "app.json"), JSON.stringify(manifest));
  await writeFile(join(root, "backend.mjs"), `export default {operations:{
    read:{kind:'read',execute:async ctx=>{const binding=await ctx.getProjectStoreBinding('files');const store=await ctx.getStore('files',{expectedBinding:binding.token});const item=await store.get({},'one.json');const text=await new Response(item.data.payload.content.stream()).text();return {token:binding.token,value:JSON.parse(text)};}},
    write:{kind:'write',execute:async(ctx,input)=>{const store=await ctx.getStore('files',{expectedBinding:input.token});const bytes=new TextEncoder().encode(JSON.stringify(input.value));await store.update({}, {id:'one.json',model:'record.json',payload:{contentType:'application/json',content:{stream:()=>new ReadableStream({start(c){c.enqueue(bytes);c.close();}})}}});}},
    broken:{kind:'write',execute:async(ctx,input)=>{const store=await ctx.getStore('files',{expectedBinding:input.token});await store.update({}, {id:'one.json',model:'record.json',payload:{contentType:'application/json',content:{stream:()=>new ReadableStream({pull(c){c.error(new Error('input failure'));}})}}});}},
    appendfail:{kind:'write',execute:async(ctx,input)=>{const store=await ctx.getStore('files',{expectedBinding:input.token});await store.append({}, {id:'one.json',model:'record.json',payload:{contentType:'application/json',content:{stream:()=>{globalThis.__issue137Streams++;let count=0;return new ReadableStream({pull(c){if(count++===0)c.enqueue(new TextEncoder().encode('x'));else c.error(new Error('append input failure'));}});}}}});}}
  }};`);
  const project = { name: "test-project", paths: projectPaths(fixture.root), memoryRoot: join(fixture.root, "memory"), config: await readBusinessProject(fixture.root) } as AppProject;
  const context = { primary: project, home: fixture.home } as ProjectContext;
  await installApp(context, root, { store: "files" });
  const state = await readAppState(project); state.installations["example.data"]!.enabled = true; await writeAppState(project, state);
  return { fixture, project, context, configureApp, invokeAppOperation, readData };
}

test("App reads and updates an existing Project DataStore",{timeout:30000},async t=>{
  const {project,fixture,invokeAppOperation,readData}=await dataFixture(t);
  const loaded=await invokeAppOperation(project,"example.data","read",{}) as {token:string;value:unknown};
  assert.deepEqual(loaded.value,{name:"first",count:1});
  await invokeAppOperation(project,"example.data","write",{token:loaded.token,value:{name:"second",count:2}});
  assert.deepEqual((await readData({},fixture.root,"files","one.json")).value,{name:"second",count:2});
});

test("a failing DataStore replacement stream preserves the original record",{timeout:30000},async t=>{
  const {project,fixture,invokeAppOperation,readData}=await dataFixture(t);
  const loaded=await invokeAppOperation(project,"example.data","read",{}) as {token:string};
  await assert.rejects(invokeAppOperation(project,"example.data","broken",{token:loaded.token}),/input failure/);
  assert.deepEqual((await readData({},fixture.root,"files","one.json")).value,{name:"first",count:1});
});

test("a stale DataStore token is rejected before consuming the input stream",{timeout:30000},async t=>{
  const {project,invokeAppOperation}=await dataFixture(t);
  (globalThis as Record<string,unknown>).__issue137Streams=0;
  try {
    await assert.rejects(invokeAppOperation(project,"example.data","appendfail",{token:"stale"}),{code:"APP_STORE_BINDING_CHANGED"});
    assert.equal((globalThis as Record<string,unknown>).__issue137Streams,0);
  } finally {delete (globalThis as Record<string,unknown>).__issue137Streams;}
});

test("append failure consumes its input once and releases the binding lock",{timeout:30000},async t=>{
  const {project,fixture,context,configureApp,invokeAppOperation}=await dataFixture(t);
  const {join}=await import("node:path");const {readFile}=await import("node:fs/promises");
  const loaded=await invokeAppOperation(project,"example.data","read",{}) as {token:string};
  const file=join(fixture.root,"data","files","one.json");const before=await readFile(file,"utf8");
  (globalThis as Record<string,unknown>).__issue137Streams=0;
  try {
    await assert.rejects(invokeAppOperation(project,"example.data","appendfail",{token:loaded.token}),/append input failure/);
    assert.equal((globalThis as Record<string,unknown>).__issue137Streams,1);assert((await readFile(file,"utf8")).startsWith(before));
    await configureApp(context,"example.data",{store:"files"});
  } finally {delete (globalThis as Record<string,unknown>).__issue137Streams;}
});
