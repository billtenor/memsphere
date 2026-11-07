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

test("App reads and writes a configured Project Store and rejects a stale binding", async t => {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { configureApp, installApp } = await import("../src/app/install.js");
  const { readAppState, writeAppState } = await import("../src/app/state.js");
  const { projectPaths } = await import("../src/project/paths.js");
  const { readBusinessProject } = await import("../src/project/business-stores.js");
  type ProjectContext = import("../src/project/resolver.js").ProjectContext;
  const { invokeAppOperation } = await import("../src/app/backend.js");
  const { FilesystemJsonValueStoreFactory } = await import("../src/data/extensions/filesystem-json-valuestore/index.js");
  const { writeData, readData } = await import("../src/project/data-service.js");
  const fixture = await businessFixture(t);
  for (const kind of ["concepts", "statements", "procedures", "schemas"]) await mkdir(join(fixture.root, "memory", kind), { recursive: true });
  await fixture.createStore("first");
  await fixture.createStore("second");
  await writeData({}, fixture.root, "first", "one", "create", { kind: "value", value: { name: "old", count: 1 } });
  const root = join(fixture.directory, "app");
  await mkdir(root);
  await writeFile(join(root, "backend.mjs"), `export default {operations: {
    read: {kind:'read', execute: async ctx => {const binding=await ctx.getProjectStoreBinding('expenses'); const store=await ctx.getStore('expenses',{expectedBinding:binding.token}); return {binding, row: await store.get({}, 'one')};}},
    write: {kind:'write', execute: async (ctx,input) => {const store=await ctx.getStore('expenses',{expectedBinding:input.token}); return store.upsert({},'one',input.value);}},
    fire: {kind:'write', execute: async (ctx,input) => {const store=await ctx.getStore('expenses',{expectedBinding:input.token}); void store.upsert({},'one',input.value); return 'started';}},
    firethrow: {kind:'write', execute: async (ctx,input) => {const store=await ctx.getStore('expenses',{expectedBinding:input.token}); void store.upsert({},'one',input.value); throw new Error('backend failure');}},
    cancel: {kind:'write', execute: async (ctx,input) => {const store=await ctx.getStore('expenses',{expectedBinding:input.token}); void store.upsert({},'one',input.value); await new Promise(resolve=>ctx.signal.addEventListener('abort',resolve,{once:true}));}},
    leak: {kind:'read', execute: async (ctx,input) => {globalThis.__issue137LeakedStore=await ctx.getStore('expenses',{expectedBinding:input.token});}},
    hold: {kind:'write', execute: async (ctx,input) => {const store=await ctx.getStore('expenses',{expectedBinding:input.token});process.send({event:'locked'});await new Promise(resolve=>process.once('message',resolve));await store.upsert({},'one',{name:'child',count:7});}}
  }};`);
  const manifest = appManifestSchema.parse({ schemaVersion: 1, id: "example.app", name: "Example", version: "1.0.0", description: "Example", projectStores: [{ key: "expenses", model: "record.json", kind: "ValueStore", configKey: "store" }], backend: { entry: "backend.mjs", operations: { read: "read", write: "write", fire: "write", firethrow: "write", cancel: "write", leak: "read", hold: "write" } } });
  await writeFile(join(root, "app.json"), JSON.stringify(manifest));
  const project = { name: "test-project", paths: projectPaths(fixture.root), memoryRoot: join(fixture.root, "memory"), config: await readBusinessProject(fixture.root) } as AppProject;
  const context = { primary: project, home: fixture.home } as ProjectContext;
  await installApp(context, root, { store: "first" });
  const installed = await readAppState(project);
  installed.installations["example.app"]!.enabled = true;
  await writeAppState(project, installed);
  const first = await invokeAppOperation(project, "example.app", "read", {}) as { binding: { token: string }; row: { value: unknown } };
  assert.deepEqual(first.row.value, { name: "old", count: 1 });
  await invokeAppOperation(project, "example.app", "leak", { token: first.binding.token });
  const leaked = (globalThis as Record<string, unknown>).__issue137LeakedStore as { get: (context: object, id: string) => Promise<unknown> };
  assert.throws(() => leaked.get({}, "one"), { code: "APP_OPERATION_CLOSED" });
  delete (globalThis as Record<string, unknown>).__issue137LeakedStore;
  await assert.rejects(invokeAppOperation(project, "example.app", "write", { value: { name: "wrong", count: 0 } }), { code: "APP_STORE_BINDING_CHANGED" });
  await invokeAppOperation(project, "example.app", "write", { token: first.binding.token, value: { name: "updated", count: 2 } });
  assert.deepEqual((await readData({}, fixture.root, "first", "one")).value, { name: "updated", count: 2 });
  await assert.rejects(configureApp(context, "example.app", { store: "missing" }), { code: "STORE_NOT_FOUND" });
  let release!: () => void;
  let reached!: () => void;
  let barrier = new Promise<void>(resolve => { release = resolve; });
  let entered = new Promise<void>(resolve => { reached = resolve; });
  const originalOpen = FilesystemJsonValueStoreFactory.prototype.openExisting;
  t.mock.method(FilesystemJsonValueStoreFactory.prototype, "openExisting", async function (...args: Parameters<typeof originalOpen>) {
    const store = await originalOpen.apply(this, args);
    const upsert = store.upsert!.bind(store);
    store.upsert = async (...writeArgs) => { reached(); await barrier; return upsert(...writeArgs); };
    return store;
  });
  const pending = invokeAppOperation(project, "example.app", "fire", { token: first.binding.token, value: { name: "pending", count: 4 } });
  await entered;
  let finished = false;
  void pending.then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false, "the host waits for an unawaited Store write");
  const configuring = configureApp(context, "example.app", { store: "second" });
  release();
  await pending;
  await configuring;
  await assert.rejects(invokeAppOperation(project, "example.app", "write", { token: first.binding.token, value: { name: "wrong", count: 3 } }), { code: "APP_STORE_BINDING_CHANGED" });
  assert.deepEqual((await readData({}, fixture.root, "first", "one")).value, { name: "pending", count: 4 });
  const current = await invokeAppOperation(project, "example.app", "read", {}) as { binding: { token: string } };
  await invokeAppOperation(project, "example.app", "write", { token: current.binding.token, value: { name: "second", count: 5 } });
  assert.deepEqual((await readData({}, fixture.root, "second", "one")).value, { name: "second", count: 5 });
  barrier = new Promise<void>(resolve => { release = resolve; });
  entered = new Promise<void>(resolve => { reached = resolve; });
  const throwing = invokeAppOperation(project, "example.app", "firethrow", { token: current.binding.token, value: { name: "cancelled", count: 9 } });
  const outcome = throwing.then(() => undefined, error => error);
  await entered;
  const rebinding = configureApp(context, "example.app", { store: "first" });
  release();
  assert.match(String(await outcome), /backend failure/);
  await rebinding;
  await assert.rejects(invokeAppOperation(project, "example.app", "write", { token: first.binding.token, value: { name: "wrong", count: 6 } }), { code: "APP_STORE_BINDING_CHANGED" });
  let fresh = await invokeAppOperation(project, "example.app", "read", {}) as { binding: { token: string } };
  barrier = new Promise<void>(resolve => { release = resolve; });
  entered = new Promise<void>(resolve => { reached = resolve; });
  const controller = new AbortController();
  const cancelling = invokeAppOperation(project, "example.app", "cancel", { token: fresh.binding.token, value: { name: "cancelled", count: 8 } }, controller.signal);
  const cancelled = cancelling.then(() => undefined, error => error);
  await entered;
  controller.abort();
  const duringCancel = configureApp(context, "example.app", { store: "second" });
  release();
  assert(await cancelled, "the cancelled in-flight write must not report success");
  await duringCancel;
  await configureApp(context, "example.app", { store: "first" });
  fresh = await invokeAppOperation(project, "example.app", "read", {}) as { binding: { token: string } };
  const { fork } = await import("node:child_process");
  const { resolve } = await import("node:path");
  const worker = resolve("test/helpers/shared-store-lock-worker.ts");
  const child = fork(worker, ["invoke", fixture.root, fresh.binding.token], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  t.after(() => { child.kill(); });
  const receive = (proc: import("node:child_process").ChildProcess) => new Promise<{ event: string; name?: string }>((resolveMessage, reject) => {
    const timeout = setTimeout(() => reject(new Error("worker did not respond")), 5000);
    proc.once("message", value => { clearTimeout(timeout); resolveMessage(value as { event: string; name?: string }); });
    proc.once("error", reject);
  });
  assert.equal((await receive(child)).event, "locked");
  const remover = fork(worker, ["remove", fixture.root, "first"], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  t.after(() => { remover.kill(); });
  assert.equal((await receive(remover)).event, "started");
  assert.deepEqual(await receive(remover), { event: "failed", name: "TimeoutError" });
  const model = fork(worker, ["model", fixture.root], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  t.after(() => { model.kill(); });
  assert.equal((await receive(model)).event, "started");
  assert.deepEqual(await receive(model), { event: "failed", name: "TimeoutError" });
  const recovery = fork(worker, ["recovery", fixture.root], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  t.after(() => { recovery.kill(); });
  assert.equal((await receive(recovery)).event, "started");
  assert.deepEqual(await receive(recovery), { event: "failed", name: "TimeoutError" });
  const finishedChild = receive(child); child.send("release");
  assert.equal((await finishedChild).event, "finished");
  const retryRecovery = fork(worker, ["recovery", fixture.root], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  t.after(() => { retryRecovery.kill(); });
  assert.equal((await receive(retryRecovery)).event, "started");
  assert.equal((await receive(retryRecovery)).event, "recovered");
  assert.deepEqual((await readData({}, fixture.root, "first", "one")).value, { name: "child", count: 7 });
  const removeAfterWrite = fork(worker, ["remove", fixture.root, "first"], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  t.after(() => { removeAfterWrite.kill(); });
  assert.equal((await receive(removeAfterWrite)).event, "started");
  assert.equal((await receive(removeAfterWrite)).event, "removed");
  await assert.rejects(invokeAppOperation(project, "example.app", "write", { token: fresh.binding.token, value: { name: "wrong", count: 8 } }), { code: "STORE_NOT_FOUND" });
  await fixture.createStore("first");
  await assert.rejects(invokeAppOperation(project, "example.app", "write", { token: fresh.binding.token, value: { name: "wrong", count: 8 } }), { code: "APP_STORE_BINDING_CHANGED" });
  assert.deepEqual((await readData({}, fixture.root, "first", "one")).value, { name: "child", count: 7 });
  const restored = await invokeAppOperation(project, "example.app", "read", {}) as { binding: { token: string } };
  const stuck = fork(worker, ["invoke", fixture.root, restored.binding.token], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  t.after(() => { stuck.kill(); });
  assert.equal((await receive(stuck)).event, "locked");
  const blocked = fork(worker, ["remove", fixture.root, "first"], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  t.after(() => { blocked.kill(); });
  assert.equal((await receive(blocked)).event, "started");
  assert.deepEqual(await receive(blocked), { event: "failed", name: "TimeoutError" });
  const exited = new Promise<void>(resolveExit => stuck.once("exit", () => resolveExit()));
  stuck.kill("SIGKILL");
  await exited;
  const afterKill = fork(worker, ["remove", fixture.root, "first"], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  t.after(() => { afterKill.kill(); });
  assert.equal((await receive(afterKill)).event, "started");
  assert.equal((await receive(afterKill)).event, "removed");
});

test("Project Store removal in another process waits for an active shared operation", async t => {
  const { fork } = await import("node:child_process");
  const { resolve } = await import("node:path");
  const fixture = await businessFixture(t);
  await fixture.createStore();
  const worker = resolve("test/helpers/shared-store-lock-worker.ts");
  const launch = (mode: string) => fork(worker, [mode, fixture.root], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const message = (child: import("node:child_process").ChildProcess) => new Promise<{ event: string; name?: string }>((resolveMessage, reject) => {
    const timeout = setTimeout(() => reject(new Error("worker did not respond")), 5000);
    child.once("message", value => { clearTimeout(timeout); resolveMessage(value as { event: string; name?: string }); });
    child.once("error", reject);
  });
  const holder = launch("hold");
  t.after(() => { holder.kill(); });
  assert.equal((await message(holder)).event, "locked");
  const remover = launch("remove");
  t.after(() => { remover.kill(); });
  assert.equal((await message(remover)).event, "started");
  assert.deepEqual(await message(remover), { event: "failed", name: "TimeoutError" });
  const released = message(holder);
  holder.send("release");
  assert.equal((await released).event, "released");
  const next = launch("remove");
  t.after(() => { next.kill(); });
  assert.equal((await message(next)).event, "started");
  assert.equal((await message(next)).event, "removed");
});

test("App reads and updates an existing Project DataStore", async t => {
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
  const loaded = await invokeAppOperation(project, "example.data", "read", {}) as { token: string; value: unknown };
  assert.deepEqual(loaded.value, { name: "first", count: 1 });
  await invokeAppOperation(project, "example.data", "write", { token: loaded.token, value: { name: "second", count: 2 } });
  assert.deepEqual((await readData({}, fixture.root, "files", "one.json")).value, { name: "second", count: 2 });
  await assert.rejects(invokeAppOperation(project, "example.data", "broken", { token: loaded.token }), /input failure/);
  assert.deepEqual((await readData({}, fixture.root, "files", "one.json")).value, { name: "second", count: 2 });
  await assert.rejects(configureApp(context, "example.data", { store: "missing" }), { code: "STORE_NOT_FOUND" });
  const file = join(fixture.root, "data", "files", "one.json");
  const { readFile } = await import("node:fs/promises");
  const before = await readFile(file, "utf8");
  (globalThis as Record<string, unknown>).__issue137Streams = 0;
  try {
    await assert.rejects(invokeAppOperation(project, "example.data", "appendfail", { token: "stale" }), { code: "APP_STORE_BINDING_CHANGED" });
    assert.equal((globalThis as Record<string, unknown>).__issue137Streams, 0);
    await assert.rejects(invokeAppOperation(project, "example.data", "appendfail", { token: loaded.token }), /append input failure/);
    assert.equal((globalThis as Record<string, unknown>).__issue137Streams, 1);
    assert((await readFile(file, "utf8")).startsWith(before));
    await configureApp(context, "example.data", { store: "files" });
  } finally { delete (globalThis as Record<string, unknown>).__issue137Streams; }
});
