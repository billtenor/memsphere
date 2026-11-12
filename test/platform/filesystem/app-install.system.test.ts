import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { ownHttpTestServer, waitForHttpState } from "../../helpers/http-test-state.js";
import type { AddressInfo } from "node:net";
import { createViewServer } from "../../../src/commands/view.js";
import { projectCreateCommand } from "../../../src/commands/project.js";
import { resolveProjectContext } from "../../../src/project/resolver.js";
import { readConfig } from "../../../src/config.js";


import { configureApp, checkApp, installApp, setAppEnabled } from "../../../src/app/install.js";


import { bindCli } from "../../../src/tools/registry.js";

import { mutateModel } from "../../../src/project/model-service.js";
import { createProjectModelHost } from "../../../src/project/models.js";

import { invokeAppOperation } from "../../../src/app/backend.js";

// Keep recovery subprocesses independent of concurrent builds replacing dist.
// The packed CLI is checked separately by the guide acceptance workflow.
const cliArguments = ["--import", import.meta.resolve("tsx"), resolve("src/cli.ts")];
const builtCli = resolve("dist/cli.js");
const projectStoreExample = resolve("examples/apps/project-store");
const expenseExample = resolve("examples/apps/expense");
type FixtureAction = (root: string, context: Awaited<ReturnType<typeof resolveProjectContext>>, app: string) => Promise<void>;
function fixture(action: FixtureAction, embedded = false, owner?: import("node:test").TestContext, minimal = false) {
  // node:test can start the next test after timeout while its body is still
  // finishing. Wait for this fixture to restore cwd/env before another owns them.
  const completed = runFixture(action, embedded, owner?.signal, minimal);
  owner?.after(() => completed.catch(() => undefined));
  return completed;
}
async function runFixture(action: FixtureAction, embedded: boolean, signal: AbortSignal | undefined, minimal: boolean) {
  const root = await mkdtemp(join(tmpdir(), "memsphere-app-test-"));
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME, project: process.env.MEMSPHERE_PROJECT, gitConfig: process.env.GIT_CONFIG_GLOBAL,
    author: process.env.GIT_AUTHOR_NAME, authorEmail: process.env.GIT_AUTHOR_EMAIL, committer: process.env.GIT_COMMITTER_NAME, committerEmail: process.env.GIT_COMMITTER_EMAIL };
  try {
    // Supply installed native dependencies to the copied CLI integration fixture.
    // The guide E2E separately verifies npm installs the distributed package.
    await symlink(join(previous.cwd, "node_modules"), join(root, "node_modules"), "junction");
    process.chdir(root);
    process.env.MEMSPHERE_HOME = join(root, "home"); process.env.MEMSPHERE_PROJECT = "test";
    // Project bootstrap reads git config, not GIT_AUTHOR_*; never inherit a developer's identity.
    process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
    await writeFile(process.env.GIT_CONFIG_GLOBAL, "[user]\n\tname = App Test\n\temail = app@example.test\n");
    Object.assign(process.env, { GIT_AUTHOR_NAME: "App Test", GIT_AUTHOR_EMAIL: "app@example.test", GIT_COMMITTER_NAME: "App Test", GIT_COMMITTER_EMAIL: "app@example.test" });
    if (embedded) {
      await mkdir(join(root, ".memsphere/memory"), { recursive: true });
      execFileSync("git", ["init", "-b", "master"], { cwd: root });
      execFileSync("git", ["commit", "--allow-empty", "-m", "initial"], { cwd: root });
    }
    if (minimal) await prepareStoreProject(process.env.MEMSPHERE_HOME);
    else await projectCreateCommand("test", embedded ? { embedded: ".memsphere/memory" } : {});
    const context = await resolveProjectContext({ project: "test" });
    const app = join(root, "app"); await mkdir(join(app, "memories"), { recursive: true });
    await writeFile(join(app, "app.json"), JSON.stringify({ schemaVersion: 1, id: "example.app", name: "Example", version: "1.0.0", description: "Example",
      assets: { memories: minimal ? [] : [{ key: "intro", path: "memories/intro.yaml" }] }, entrypoints: minimal ? {} : { agent: ["concepts/app-intro"] } }));
    await writeFile(join(app, "memories/intro.yaml"), "!concept\nsyntax: memsphere-20260721-stable\nnames: [app-intro]\ndefines: [App introduction]\n");
    signal?.throwIfAborted();
    await action(root, context, app);
  } finally {
    process.chdir(previous.cwd);
    for (const [key, value] of Object.entries({ MEMSPHERE_HOME: previous.home, MEMSPHERE_PROJECT: previous.project, GIT_CONFIG_GLOBAL: previous.gitConfig,
      GIT_AUTHOR_NAME: previous.author, GIT_AUTHOR_EMAIL: previous.authorEmail, GIT_COMMITTER_NAME: previous.committer, GIT_COMMITTER_EMAIL: previous.committerEmail })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}

// Project creation/System Memory installation is covered separately. Shared
// Store system tests need a registered Project, model storage and empty Memory.
async function prepareStoreProject(home: string) {
  const project = join(home, "projects/test");
  await Promise.all(["concepts", "statements", "procedures", "schemas"].map(kind =>
    mkdir(join(project, "memory", kind), {recursive:true})));
  await mkdir(join(project, "models/json-schema/draft-07"), {recursive:true});
  await writeFile(join(project, "project.json"), JSON.stringify({format_version:1,name:"test",created_at:"2026-11-08T00:00:00.000Z"}));
  const memory = join(project, "memory");
  execFileSync("git", ["init", "-b", "master"], {cwd:memory});
  execFileSync("git", ["commit", "--allow-empty", "-m", "store fixture"], {cwd:memory});
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {cwd:memory,encoding:"utf8"}).trim();
  await writeFile(join(project, "config.json"), JSON.stringify({store:{type:"managed",branch:"master",published_revision:revision}}));
  await writeFile(join(home, "registry.json"), JSON.stringify({format_version:1,projects:{test:{root:project}},workspaces:{}}));
}

test("Non-loopback App operations reject missing or invalid tokens and accept the operator token", async () => fixture(async (root, context) => {
  const directory = join(root, "expense"); await cp(expenseExample, directory, { recursive: true });
  await installApp(context, directory, { ledgerDirectory: join(root, "ledger") });
  const binding = join(root, "expense-binding.json");
  await writeFile(binding, JSON.stringify({ schemaVersion: 1, executable: join(directory, "cli/expense.cjs") }));
  await bindCli(context, "org.memsphere.expense-cli", binding, "org.memsphere.expense");
  await setAppEnabled(context, "org.memsphere.expense", true);
  const config = await readConfig(); config.view = { host: "0.0.0.0", port: 0 };
  const server = createViewServer(config, { settingsToken: "fixture-token" });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const token of [undefined, "wrong-token", "fixture-token"]) {
      const response = await fetch(`${origin}/api/projects/test/apps/org.memsphere.expense/operations/list`, {
        method: "POST", headers: { "content-type": "application/json", origin,
          ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ input: {} })
      });
      const payload = await response.json();
      assert.equal(response.status, token === "fixture-token" ? 200 : 401);
      if (token === "fixture-token") assert.deepEqual(payload.result.records, []);
      else assert.equal(payload.error, "Settings operator token is required");
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}));

test("Real View API and independently launched CLI share records, revisions and business validation", async () => fixture(async (root, context) => {
  const directory = join(root, "expense"); await cp(expenseExample, directory, { recursive: true });
  const ledger = join(root, "ledger"), executable = join(directory, "cli/expense.cjs");
  await installApp(context, directory, { ledgerDirectory: ledger });
  const binding = join(root, "expense-binding.json");
  await writeFile(binding, JSON.stringify({ schemaVersion: 1, executable }));
  await bindCli(context, "org.memsphere.expense-cli", binding, "org.memsphere.expense");
  await setAppEnabled(context, "org.memsphere.expense", true);
  const config = await readConfig(); config.view = { host: "127.0.0.1", port: 0 };
  const server = createViewServer(config);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const invoke = async (operation: string, input: unknown) => {
    const response = await fetch(`${origin}/api/projects/test/apps/org.memsphere.expense/operations/${operation}`, {
      method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ input })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result.result;
  };
  try {
  const html = await (await fetch(origin)).text();
  assert.match(html, /appApiBase/);
  const record = await invoke("create", { description: "View expense", amount: 25 }) as { id: string; revision: number };
  const list = JSON.parse(execFileSync(process.execPath, [executable, "--ledger", ledger, "list"], { encoding: "utf8" }));
  assert.equal(list.records[0].id, record.id);
  execFileSync(process.execPath, [executable, "--ledger", ledger, "submit", "--id", record.id, "--revision", String(record.revision)], { encoding: "utf8" });
  assert.equal((await invoke("list", {}) as any).records[0].value.status, "submitted");
  await assert.rejects(invoke("create", { description: "Invalid", amount: -1 }), /positive/);
  assert.throws(() => execFileSync(process.execPath, [executable, "--ledger", ledger, "create", "--description", "Invalid", "--amount", "-1"], { encoding: "utf8", stdio: "pipe" }), /positive/);
  const models = await createProjectModelHost({}, { root: context.primary.paths.root });
  assert.equal((await models.definition("example/expense.json")).origin, "app");
  for (const operation of ["update", "delete"] as const) {
    await assert.rejects(mutateModel({}, context.primary.paths.root, operation, "example/expense.json",
      operation === "update" ? { fields: { description: "cannot overwrite an App model" } } : {}),
      (error: unknown) => (error as { code?: string }).code === "APP_MODEL_READ_ONLY");
  }
  await setAppEnabled(context, "org.memsphere.expense", false);
  await assert.rejects(invoke("list", {}), /disabled/);
  assert.equal(JSON.parse(execFileSync(process.execPath, [executable, "--ledger", ledger, "list"], { encoding: "utf8" })).records.length, 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}));

type HttpCleanup = {destroyed:boolean;listening:boolean;handlers:number;requests:number;aborted:boolean};
async function verifyResponseAbort(t: import("node:test").TestContext, root: string, context: Awaited<ReturnType<typeof resolveProjectContext>>, app: string,
  options: {omitStarted?:boolean;cancelStarted?:boolean;cleanup?:(state:HttpCleanup)=>void} = {}) {
  const http = await import("node:http");
  const manifest = JSON.parse(await readFile(join(app, "app.json"), "utf8"));
  manifest.backend = { entry: "backend.mjs", operations: { wait: "read" } };
  await writeFile(join(app, "app.json"), JSON.stringify(manifest));
  await writeFile(join(app, "backend.mjs"), `export default {operations:{wait:{kind:'read',execute: async ctx => { globalThis.__issue137Started(); await Promise.race([new Promise(resolve => ctx.signal.addEventListener('abort',resolve,{once:true})),globalThis.__issue137Cleanup]); if(ctx.signal.aborted)globalThis.__issue137Aborted(); }}}};`);
  await installApp(context, app);
  await setAppEnabled(context, "example.app", true);
  let entered!:()=>void,started!:()=>void,aborted!:()=>void,release!:()=>void;
  const reached = new Promise<void>(resolve=>{entered=resolve});
  const start = new Promise<void>(resolve=>{started=resolve});
  const abort = new Promise<void>(resolve=>{aborted=resolve});
  const cleanup = new Promise<void>(resolve=>{release=resolve});
  let didAbort = false;
  const cancellation = new AbortController();
  const stateSignal = AbortSignal.any([t.signal,cancellation.signal]);
  const config = await readConfig(); config.view = {host:"127.0.0.1",port:0};
  const server = createViewServer(config), scope = ownHttpTestServer(server);
  Object.assign(globalThis,{__issue137Started:()=>{entered();if(options.cancelStarted)cancellation.abort(new Error("controlled App state cancellation"));if(!options.omitStarted)started();},__issue137Aborted:()=>{didAbort=true;aborted();},__issue137Cleanup:cleanup});
  let request: import("node:http").ClientRequest | undefined;
  try {
    await waitForHttpState(new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve)),"View listening",stateSignal);
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    request = scope.own(http.request(`${origin}/api/projects/test/apps/example.app/operations/wait`,{method:"POST",headers:{"content-type":"application/json",origin},signal:t.signal}));
    request.on("error",()=>undefined);
    request.end(JSON.stringify({input:{}}));
    if(options.omitStarted) await waitForHttpState(reached,"backend entered",stateSignal);
    await waitForHttpState(start,"App started",stateSignal,options.omitStarted?20:5000);
    request.destroy();
    await waitForHttpState(abort,"App aborted",stateSignal);
  } finally {
    // The fixture can release its backend even if production abort delivery regresses.
    request?.destroy(); release();
    try {
      await scope.close();
      options.cleanup?.({destroyed:request?.destroyed??true,listening:server.listening,handlers:scope.activeHandlers,requests:scope.activeRequests,aborted:didAbort});
    } finally {
      delete (globalThis as Record<string,unknown>).__issue137Started;
      delete (globalThis as Record<string,unknown>).__issue137Aborted;
      delete (globalThis as Record<string,unknown>).__issue137Cleanup;
    }
  }
}

test("closing a View HTTP response aborts the running App operation",{timeout:30000},async t=>fixture(
  (root,context,app)=>verifyResponseAbort(t,root,context,app),false,t,true));

for (const cancelStarted of [false,true]) test(cancelStarted?"cancelled App state wait cleans the request, handler and fixture":"missing App started event fails finitely and cleans the request, handler and fixture",{timeout:30000},async t=>{
  const previous={cwd:process.cwd(),home:process.env.MEMSPHERE_HOME};
  let directory="",cleaned:HttpCleanup|undefined;
  await assert.rejects(fixture(async(root,context,app)=>{
    directory=root;
    await verifyResponseAbort(t,root,context,app,{omitStarted:true,cancelStarted,cleanup:state=>{cleaned=state}});
  },false,t,true),error=>cancelStarted?String(error).includes("controlled App state cancellation"):(error as {code?:string}).code==="TEST_STATE_TIMEOUT"&&String(error).includes("App started"));
  assert.equal(cleaned?.destroyed,true);assert.equal(cleaned?.listening,false);
  assert.equal(cleaned?.handlers,0);assert.equal(cleaned?.requests,0);
  assert.equal(process.cwd(),previous.cwd);assert.equal(process.env.MEMSPHERE_HOME,previous.home);
  await assert.rejects(stat(directory),{code:"ENOENT"});
});

async function sharedHttpFixture(owner: import("node:test").TestContext, action: (fixture: { root: string; context: Awaited<ReturnType<typeof resolveProjectContext>>; origin: string; server: ReturnType<typeof createViewServer>; scope: ReturnType<typeof ownHttpTestServer>; invoke: (operation: string, input: unknown) => Promise<any> }) => Promise<void>) {
  return fixture(async (root, context, app) => {
  const { createBusinessStore } = await import("../../../src/project/business-stores.js");
  const { writeData } = await import("../../../src/project/data-service.js");
  await mutateModel({}, context.primary.paths.root, "create", "expense.json", { source: JSON.stringify({ type: "object", properties: { amount: { type: "number" } }, required: ["amount"], additionalProperties: false }) });
  await createBusinessStore({}, context.primary.paths.root, "expenses", { model: "expense.json", kind: "value", factory: "memsphere/filesystem-json", config: { directory: "data/expenses" } });
  await writeData({}, context.primary.paths.root, "expenses", "first", "create", { kind: "value", value: { amount: 3 } });
  const manifest = JSON.parse(await readFile(join(app, "app.json"), "utf8"));
  manifest.projectStores = [{ key: "expenses", model: "expense.json", kind: "ValueStore", configKey: "store" }];
  manifest.backend = { entry: "backend.mjs", operations: { read: "read", write: "write", wait: "read" } };
  await writeFile(join(app, "app.json"), JSON.stringify(manifest));
  await writeFile(join(app, "backend.mjs"), `export default {operations:{
    read:{kind:'read',execute:async ctx=>{const binding=await ctx.getProjectStoreBinding('expenses');const store=await ctx.getStore('expenses',{expectedBinding:binding.token});return {token:binding.token,record:await store.get({},'first')};}},
    write:{kind:'write',execute:async(ctx,input)=>{const store=await ctx.getStore('expenses',{expectedBinding:input.token});return store.update({},'first',input.value);}},
    wait:{kind:'read',execute:async(ctx,input)=>{const store=await ctx.getStore('expenses',{expectedBinding:input.token});void store.update({},'first',{amount:99});globalThis.__issue137SharedStarted();await Promise.race([new Promise(resolve=>ctx.signal.addEventListener('abort',resolve,{once:true})),globalThis.__issue137SharedCleanup]);if(ctx.signal.aborted)globalThis.__issue137SharedAborted();}}
  }};`);
  await installApp(context, app, { store: "expenses" });
  assert.equal((await checkApp(context.primary, "example.app")).status, "available");
  await setAppEnabled(context, "example.app", true);
  const config = await readConfig(); config.view = { host: "127.0.0.1", port: 0 };
  const server = createViewServer(config), scope = ownHttpTestServer(server);
  try {
  await waitForHttpState(new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)),"View listening",owner.signal);
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const invoke = async (operation: string, input: unknown) => {
    const response = await fetch(`${origin}/api/projects/test/apps/example.app/operations/${operation}`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ input }), signal: owner.signal });
    assert.equal(response.status, 200);
    return (await response.json()).result;
  };
  await action({root,context,origin,server,scope,invoke});
  } finally { await scope.close(); }
  }, false, owner, true);
}

test("unbound Project Store allows install but prevents check, enable and invoke",{timeout:30000},async t=>fixture(async(_root,context,app)=>{
  const manifest=JSON.parse(await readFile(join(app,"app.json"),"utf8"));
  manifest.projectStores=[{key:"expenses",model:"expense.json",kind:"ValueStore",configKey:"store"}];
  manifest.backend={entry:"backend.mjs",operations:{read:"read"}};
  await writeFile(join(app,"app.json"),JSON.stringify(manifest));
  await writeFile(join(app,"backend.mjs"),"export default {operations:{read:{kind:'read',execute:async()=>true}}};");
  await installApp(context,app,{});
  const check=await checkApp(context.primary,"example.app");assert.equal(check.status,"unavailable");
  assert.equal(check.items.find(item=>item.name==="project-store:expenses")?.available,false);
  await assert.rejects(setAppEnabled(context,"example.app",true),{code:"APP_NOT_READY"});
  await assert.rejects(invokeAppOperation(context.primary,"example.app","read",{}),{code:"APP_DISABLED"});
}, false, t, true));

test("App installation shares a Project Store between View API and CLI",{timeout:30000},async t=>sharedHttpFixture(t,async({root,origin,invoke})=>{
  const current=await invoke("read",{});assert.deepEqual(current.record.value,{amount:3});
  await invoke("write",{token:current.token,value:{amount:8}});
  const result=JSON.parse(execFileSync(process.execPath,[builtCli,"--project","test","data","read","first","--store","expenses","--output","json"],{cwd:root,encoding:"utf8",timeout:10000}));
  assert.deepEqual(result.value,{amount:8});
  execFileSync(process.execPath,[builtCli,"--project","test","data","update","first","--store","expenses","--value",'{"amount":11}',"--output","json"],{cwd:root,encoding:"utf8",timeout:10000});
  assert.deepEqual((await invoke("read",{})).record.value,{amount:11});
}));

for (const operation of ["save", "remove"] as const) {
  test(`example caller displays refresh and confirmation after a stale ${operation}`, {timeout:30000}, async t => fixture(async (_root, context) => {
    const {createBusinessStore} = await import("../../../src/project/business-stores.js");
    const {writeData, readData} = await import("../../../src/project/data-service.js");
    const {createRecordEditor, createHttpInvoker} = await import(new URL("../../../examples/apps/project-store/record-editor.mjs", import.meta.url).href);
    await mutateModel({}, context.primary.paths.root, "create", "example/expense.json", {source:JSON.stringify({type:"object",properties:{amount:{type:"number"}},required:["amount"],additionalProperties:false})});
    for (const [id, amount] of [["expenses-a",3],["expenses-b",99]] as const) {
      await createBusinessStore({}, context.primary.paths.root, id, {model:"example/expense.json",kind:"value",factory:"memsphere/filesystem-json",config:{directory:`data/${id}`}});
      await writeData({}, context.primary.paths.root, id, "first", "create", {kind:"value",value:{amount}});
    }
    await installApp(context, projectStoreExample, {expensesStore:"expenses-a"});
    await setAppEnabled(context, "org.example.project-store", true);
    const config = await readConfig();
    config.view = {host:"127.0.0.1",port:0};
    const server = createViewServer(config);
    await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const messages: string[] = [];
    const displayed: any[] = [];
    const confirmations: any[] = [];
    let confirm = false;
    const editor = createRecordEditor({
      invoke:createHttpInvoker({baseUrl,project:"test"}),
      notify:(message:string) => { messages.push(message); console.log(`caller ${operation}: ${message}`); },
      showRecord:(record:unknown) => { displayed.push(record); console.log(`caller record: ${JSON.stringify(record)}`); },
      confirmTarget:async (target:unknown) => { confirmations.push(target); return confirm; }
    });
    const change = () => operation === "save" ? editor.save({amount:8}) : editor.remove();
    try {
      await editor.load("first");
      await configureApp(context,"org.example.project-store",{expensesStore:"expenses-b"});
      assert.equal((await change()).status,"binding-changed");
      assert(messages.some(message => message.includes("数据来源已改变") && message.includes("重新确认")));
      assert(messages.some(message => message.includes("expenses-b") && message.includes("不会自动重试")));
      assert.equal(displayed.at(-1).storeId,"expenses-b");
      assert.deepEqual(displayed.at(-1).record.value,{amount:99});
      assert.equal(confirmations.length,0,"stale request must refresh without automatically applying to B");
      assert.deepEqual((await readData({},context.primary.paths.root,"expenses-a","first")).value,{amount:3});
      assert.deepEqual((await readData({},context.primary.paths.root,"expenses-b","first")).value,{amount:99});
      assert.equal((await change()).status,"cancelled");
      assert.equal(confirmations.at(-1).storeId,"expenses-b");
      assert.deepEqual((await readData({},context.primary.paths.root,"expenses-b","first")).value,{amount:99});
      confirm = true;
      assert.equal((await change()).status,operation === "save" ? "saved" : "removed");
      assert.deepEqual((await readData({},context.primary.paths.root,"expenses-a","first")).value,{amount:3});
      if (operation === "save") assert.deepEqual((await readData({},context.primary.paths.root,"expenses-b","first")).value,{amount:8});
      else await assert.rejects(readData({},context.primary.paths.root,"expenses-b","first"),{code:"NOT_FOUND"});
      if (operation === "save") await verifyTerminalCaller(context, baseUrl);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }, false, t, true));
}

async function verifyTerminalCaller(context: Awaited<ReturnType<typeof resolveProjectContext>>, baseUrl: string) {
  const {spawn} = await import("node:child_process");
  const {readData} = await import("../../../src/project/data-service.js");
  await configureApp(context,"org.example.project-store",{expensesStore:"expenses-a"});
  const child = spawn(process.execPath, [join(projectStoreExample,"client.mjs"),baseUrl,"test","first"], {stdio:["pipe","pipe","pipe"]});
  let output = "", stderr = "", cursor = 0, ended = false;
  let problem: Error | undefined;
  let waiting: {marker:string;resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>} | undefined;
  const settle = () => {
    if (!waiting) return;
    const position = output.indexOf(waiting.marker,cursor);
    if (position >= 0) {
      cursor = position + waiting.marker.length;
      const ready = waiting; waiting = undefined; clearTimeout(ready.timer); ready.resolve();
    } else if (ended || problem) {
      const failed = waiting; waiting = undefined; clearTimeout(failed.timer);
      failed.reject(problem ?? new Error(`terminal exited before ${failed.marker}: ${output}\n${stderr}`));
    }
  };
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data",chunk => { output += chunk; settle(); });
  child.stderr.on("data",chunk => { stderr += chunk; });
  child.on("error",error => { problem = error; settle(); });
  child.stdin.on("error",error => { problem = error; settle(); });
  const closed = new Promise<number|null>(resolve => child.once("close",code => { ended = true; settle(); resolve(code); }));
  const until = (marker:string) => new Promise<void>((resolve,reject) => {
    const timer = setTimeout(() => {
      waiting = undefined;
      reject(new Error(`terminal did not display ${marker}: ${output}\n${stderr}`));
    },10000);
    waiting = {marker,resolve,reject,timer}; settle();
  });
  const enter = (line:string) => child.stdin.write(`${line}\n`);
  try {
    await until("命令> ");
    assert(output.includes('"storeId":"expenses-a"'));
    await configureApp(context,"org.example.project-store",{expensesStore:"expenses-b"});
    enter('save {"amount":12}');
    await until("数据来源已改变，请刷新并重新确认目标后再保存或删除。");
    await until("命令> ");
    assert(output.includes('"storeId":"expenses-b"'));
    assert.deepEqual((await readData({},context.primary.paths.root,"expenses-b","first")).value,{amount:8});
    enter('save {"amount":12}');
    await until("确认在 expenses-b 保存？输入 yes 确认：");
    enter("no");
    await until("已取消，本次未修改当前目标的数据。");
    await until("命令> ");
    assert.deepEqual((await readData({},context.primary.paths.root,"expenses-b","first")).value,{amount:8});
    enter('save {"amount":12}');
    await until("确认在 expenses-b 保存？输入 yes 确认：");
    enter("yes");
    await until("保存成功。");
    await until("命令> ");
    assert.deepEqual((await readData({},context.primary.paths.root,"expenses-a","first")).value,{amount:3});
    assert.deepEqual((await readData({},context.primary.paths.root,"expenses-b","first")).value,{amount:12});
    enter("quit");
    assert.equal(await closed,0,stderr);
    console.log(`terminal caller transcript:\n${output}`);
  } finally {
    if (!ended) child.kill();
    await closed;
  }
}

async function verifySharedDisconnect(t: import("node:test").TestContext, state: Parameters<Parameters<typeof sharedHttpFixture>[1]>[0],
  options:{omitLog?:boolean;cleanup?:(state:HttpCleanup)=>void}={}) {
  const {root,context,origin,invoke,server,scope}=state;
  const current=await invoke("read",{}),http=await import("node:http");
  const {FilesystemJsonValueStoreFactory}=await import("../../../src/data/extensions/filesystem-json-valuestore/index.js");
  const {withSharedStoreLock}=await import("../../../src/project/shared-store-lock.js");
  let releaseWrite!:()=>void,writeStarted!:()=>void,started!:()=>void,aborted!:()=>void,releaseBackend!:()=>void;
  let logged!:(value:Record<string,unknown>)=>void,emitted!:()=>void;
  const writeBarrier=new Promise<void>(resolve=>{releaseWrite=resolve}),writeEntered=new Promise<void>(resolve=>{writeStarted=resolve});
  const start=new Promise<void>(resolve=>{started=resolve}),abort=new Promise<void>(resolve=>{aborted=resolve});
  const cleanup=new Promise<void>(resolve=>{releaseBackend=resolve});
  const log=new Promise<Record<string,unknown>>(resolve=>{logged=resolve}),logEmitted=new Promise<void>(resolve=>{emitted=resolve});
  const original=FilesystemJsonValueStoreFactory.prototype.openExisting;
  t.mock.method(FilesystemJsonValueStoreFactory.prototype,"openExisting",async function(...args:Parameters<typeof original>){const store=await original.apply(this,args);store.update=async()=>{writeStarted();await writeBarrier;throw Object.assign(new Error("sensitive input must not be logged"),{code:"EIO"})};return store;});
  t.mock.method(console,"error",(message?:unknown)=>{try{const record=JSON.parse(String(message));if(record.event==="app_operation_disconnected"){emitted();if(!options.omitLog)logged(record);}}catch{/* Ignore unrelated diagnostics. */}});
  let didAbort=false;
  Object.assign(globalThis,{__issue137SharedStarted:started,__issue137SharedAborted:()=>{didAbort=true;aborted();},__issue137SharedCleanup:cleanup});
  const request=scope.own(http.request(`${origin}/api/projects/test/apps/example.app/operations/wait`,{method:"POST",headers:{"content-type":"application/json",origin},signal:t.signal}));
  request.on("error",()=>undefined);
  let configuring:Promise<unknown>|undefined;
  try {
    request.end(JSON.stringify({input:{token:current.token}}));
    await waitForHttpState(start,"App started",t.signal);
    await waitForHttpState(writeEntered,"Store write entered",t.signal);
    request.destroy();await waitForHttpState(abort,"App aborted",t.signal);
    let configured=false;
    configuring=configureApp(context,"example.app",{store:"expenses"}).then(()=>{configured=true;},error=>error);
    await assert.rejects(withSharedStoreLock(context.primary.paths.root,async()=>{},AbortSignal.timeout(300)),{name:"TimeoutError"});
    assert.equal(configured,false,"configure must wait for the in-flight write");
    releaseWrite();
    if(options.omitLog)await waitForHttpState(logEmitted,"actual disconnect log emitted",t.signal);
    const record=await waitForHttpState(log,"disconnect log",t.signal,options.omitLog?20:5000);
    assert.equal(record.project,"test");assert.equal(record.app,"example.app");assert.equal(record.operation,"wait");assert.equal(record.code,"EIO");
    assert(!JSON.stringify(record).includes(current.token));assert(!JSON.stringify(record).includes("sensitive input"));
    const result=await waitForHttpState(configuring,"configuration after write",t.signal);if(result!==undefined)throw result;
    assert.equal(configured,true);
    const after=JSON.parse(execFileSync(process.execPath,[builtCli,"--project","test","data","read","first","--store","expenses","--output","json"],{cwd:root,encoding:"utf8",timeout:10000}));
    assert.deepEqual(after.value,{amount:3});
  } finally {
    request.destroy();releaseWrite();releaseBackend();
    try {
      await scope.close();
      if(configuring){const result=await waitForHttpState(configuring,"configuration cleanup");if(result!==undefined)throw result;}
      options.cleanup?.({destroyed:request.destroyed,listening:server.listening,handlers:scope.activeHandlers,requests:scope.activeRequests,aborted:didAbort});
    } finally {
      delete (globalThis as Record<string,unknown>).__issue137SharedStarted;
      delete (globalThis as Record<string,unknown>).__issue137SharedAborted;
      delete (globalThis as Record<string,unknown>).__issue137SharedCleanup;
    }
  }
}

test("HTTP disconnect keeps the binding locked until in-flight write ends and logs the failure",{timeout:30000},async t=>
  sharedHttpFixture(t,state=>verifySharedDisconnect(t,state)));

test("missing disconnect log fails finitely and cleans barriers, handlers and fixture",{timeout:30000},async t=>{
  const previous={cwd:process.cwd(),home:process.env.MEMSPHERE_HOME};
  let directory="",cleaned:HttpCleanup|undefined;
  await assert.rejects(sharedHttpFixture(t,async state=>{
    directory=state.root;
    await verifySharedDisconnect(t,state,{omitLog:true,cleanup:value=>{cleaned=value}});
  }),error=>(error as {code?:string}).code==="TEST_STATE_TIMEOUT"&&String(error).includes("disconnect log"));
  assert.deepEqual(cleaned,{destroyed:true,listening:false,handlers:0,requests:0,aborted:true});
  assert.equal(process.cwd(),previous.cwd);assert.equal(process.env.MEMSPHERE_HOME,previous.home);
  await assert.rejects(stat(directory),{code:"ENOENT"});
});
