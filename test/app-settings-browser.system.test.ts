import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {removeBusinessStore} from "../src/project/business-stores.js";
import assert from "node:assert/strict";
import nodeTest, {type TestContext, type TestOptions} from "node:test";
import { browserScope as sharedBrowserScope } from "./helpers/browser.js";
import { appSettingsServer, emptyAppSettingsServer } from "./helpers/app-settings.js";
import { readAppSettings } from "../src/app/settings.js";
import { configureApp, installApp } from "../src/app/install.js";
type RunTest = (t: TestContext) => void | Promise<void>;
function test(name:string,run:RunTest):Promise<void>;
function test(name:string,options:TestOptions,run:RunTest):Promise<void>;
function test(name:string,options:TestOptions|RunTest,run?:RunTest):Promise<void> {
    return nodeTest(name,{timeout:90000,...(typeof options==="object"?options:{})},typeof options==="function"?options:run!);
}
async function browserScope() {
    const browser=await sharedBrowserScope();
    return {...browser,async newPage(options?:Parameters<typeof browser.newPage>[0]) {
        const page=await browser.newPage(options);
        page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(15000);
        return page;
    }};
}
function httpGate(t:TestContext) {
    let arrived!:()=>void,reject!: (error:unknown)=>void,release!:()=>void;
    const handshake=new Promise<void>((resolve,fail)=>{arrived=resolve;reject=fail;});
    // Rejection may precede the UI click completing; it must still be delivered at await.
    void handshake.catch(()=>{});
    const gate=new Promise<void>(resolve=>release=resolve);
    const timer=setTimeout(()=>fail(new Error("App HTTP handshake did not arrive within 15s")),15000);
    const gateTimer=setTimeout(()=>release(),45000);
    const cleanup=()=>{clearTimeout(timer);clearTimeout(gateTimer);release();};
    const fail=(error:unknown)=>{reject(error);cleanup();};
    t.after(cleanup);t.signal.addEventListener("abort",()=>fail(t.signal.reason),{once:true});
    return {handshake,gate,arrived:()=>{clearTimeout(timer);arrived();},fail,release:cleanup};
}
async function customPage(t: import("node:test").TestContext) {
    const fixture = await appSettingsServer(t, "127.0.0.1", true);
    const browser = await browserScope(); t.after(() => browser.close());
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(`${fixture.origin}/projects/test-project/settings/apps?app=example.app`);
    await page.getByText("App 自定义分组", {exact:true}).waitFor();
    return {...fixture, page, errors};
}
test("dirty App navigation cancellation preserves the mounted draft across menu and history", async t => {
    const {page} = await customPage(t);
    await page.getByLabel("名称", {exact:true}).fill("B");
    for (const navigate of [() => page.getByRole("button",{name:"所有 App",exact:true}).click(), () => page.locator(".view-shell-project-home").click()]) {
        await navigate(); await page.getByRole("button",{name:"继续编辑",exact:true}).last().click();
        assert.match(page.url(), /app=example.app/);
        assert.equal(await page.getByLabel("名称",{exact:true}).inputValue(), "B");
    }
    // Create a known earlier entry before exercising popstate.
    await page.evaluate(() => history.pushState(history.state, "", location.href));
    await page.goBack(); await page.getByRole("button",{name:"继续编辑",exact:true}).last().click();
    assert.match(page.url(), /app=example.app/);
    assert.equal(await page.getByLabel("名称",{exact:true}).inputValue(), "B");
});
test("request errors clear after correction, success and reset without accumulating", async t => {
    const {page} = await customPage(t);
    for (let attempt=0; attempt<2; attempt++) {
        await page.getByLabel("数量",{exact:true}).fill("0");
        await page.getByRole("button",{name:"保存配置",exact:true}).click();
        await page.locator("[data-request-errors]").getByText(/must be >= 1/).waitFor();
        assert.equal(await page.locator("[data-request-errors]").count(),1);
        assert.equal(await page.getByText("App configuration does not match its Schema",{exact:true}).count(),0);
    }
    await page.getByLabel("数量",{exact:true}).fill("3");
    assert.equal(await page.locator("[data-request-errors]").count(),0);
    await page.getByRole("button",{name:"保存配置",exact:true}).click();
    await page.getByText(/配置已保存。/).waitFor();
    assert.equal(await page.getByText(/must be >= 1/).count(),0);
    await page.getByLabel("数量",{exact:true}).fill("0");
    await page.getByRole("button",{name:"保存配置",exact:true}).click();
    await page.locator("[data-request-errors]").waitFor();
    await page.getByRole("button",{name:"取消修改",exact:true}).click();
    assert.equal(await page.locator("[data-request-errors]").count(),0);
});
test("typed fields preserve invalid raw input and save enum and Store values without losing unknown keys", async t => {
    const {page,project} = await customPage(t);
    await page.getByLabel("数量",{exact:true}).fill("-");
    assert.equal(await page.getByRole("button",{name:"保存配置",exact:true}).isDisabled(),true);
    await page.getByLabel("数量",{exact:true}).fill("3");
    await page.getByLabel("类型选项",{exact:true}).selectOption({label:"否"});
    await page.getByLabel("偏好 JSON",{exact:true}).fill('{"hello":');
    await page.locator("[data-request-errors]").getByText(/prefs:/).waitFor();
    assert.equal(await page.getByRole("button",{name:"保存配置",exact:true}).isDisabled(),true);
    await page.getByLabel("偏好 JSON",{exact:true}).fill('{"hello":true}');
    await page.getByLabel("记录 Store",{exact:true}).selectOption({label:"second"});
    await page.getByRole("button",{name:"保存配置",exact:true}).click();
    await page.getByText(/配置已保存。/).waitFor();
    const saved=await readAppSettings(project,"example.app");
    assert.equal(saved.config.choice,false); assert.equal(saved.config.count,3); assert.equal(saved.config.store,"second");
    assert.deepEqual(saved.config.prefs,{hello:true}); assert.deepEqual(saved.config.untouched,{extra:true});
});
test("CLI concurrent save conflicts preserve the browser draft and refresh reads authoritative state",async t=>{
    const {page,project,context}=await customPage(t);
    const saved=await readAppSettings(project,"example.app");
    await page.getByLabel("名称",{exact:true}).fill("Local");
    await configureApp(context,"example.app",{...saved.config,name:"CLI"});
    await page.getByRole("button",{name:"保存配置",exact:true}).click();
    await page.locator("[data-request-errors]").getByText(/App configuration changed/).waitFor();
    assert.equal(await page.getByLabel("名称",{exact:true}).inputValue(),"Local");
    assert.equal((await readAppSettings(project,"example.app")).config.name,"CLI");
    await page.getByRole("button",{name:"取消修改",exact:true}).click();
    await page.reload(); await page.getByLabel("名称",{exact:true}).waitFor();
    assert.equal(await page.getByLabel("名称",{exact:true}).inputValue(),"CLI");
});
test("custom settings fit narrow screens without overflow or console errors",async t=>{
    const {page,errors}=await customPage(t);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
});
test("schema-only App uses the same public form and survives real save and refresh", async (t) => {
    const { origin, project } = await appSettingsServer(t);
    const browser = await browserScope();
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`${origin}/projects/test-project/settings/apps`);
    await page.getByRole("button", { name: "配置", exact: true }).click();
    await page.locator(".mem-view-settings-form").waitFor();
    await page.getByLabel("name", { exact: true }).fill("Generic");
    await page.getByRole("button", { name: "保存配置", exact: true }).click();
    await page.getByText(/配置已保存。/).waitFor();
    assert.equal((await readAppSettings(project, "example.app")).config.name, "Generic");
});

for(const fault of ["hang-import","hang-apply","bad-root"] as const)test(`settings ${fault} stays bounded and offers explicit generic recovery`,async t=>{
 const {origin,project}=await appSettingsServer(t,"127.0.0.1",fault);const browser=await browserScope();t.after(()=>browser.close());const page=await browser.newPage();
 await page.goto(`${origin}/projects/test-project/settings/apps?app=example.app`);
 await page.getByRole("button",{name:"使用通用配置",exact:true}).waitFor({timeout:18000});
 assert.equal((await readAppSettings(project,"example.app")).config.name,"A");
 await page.getByRole("button",{name:"使用通用配置",exact:true}).click();await page.getByLabel("name",{exact:true}).fill("Recovered");await page.getByRole("button",{name:"保存配置",exact:true}).click();await page.getByText(/配置已保存。/).waitFor();assert.equal((await readAppSettings(project,"example.app")).config.name,"Recovered");
});

test("App settings framework follows the active English locale",async t=>{
 const {origin}=await appSettingsServer(t,"127.0.0.1",false,"en");const browser=await browserScope();t.after(()=>browser.close());const page=await browser.newPage();await page.goto(`${origin}/projects/test-project/settings/apps`);await page.getByRole("heading",{name:"App configuration",exact:true,level:2}).waitFor();await page.getByRole("button",{name:"Configure",exact:true}).click();await page.getByRole("button",{name:"Save configuration",exact:true}).waitFor();assert.equal(await page.getByRole("button",{name:"Validate",exact:true}).count(),1);
});

test("full JSON editing preserves unknown keys and requires confirmation before changing modes",async t=>{
 const {origin,project}=await appSettingsServer(t);const browser=await browserScope();t.after(()=>browser.close());const page=await browser.newPage();await page.goto(`${origin}/projects/test-project/settings/apps?app=example.app`);await page.getByRole("button",{name:"编辑完整 JSON",exact:true}).click();const editor=page.getByLabel("完整配置（JSON）",{exact:true});await editor.fill('{"name":"JSON","store":"first","extra":{"kept":true}}');await page.getByRole("button",{name:"返回表单",exact:true}).click();await page.getByRole("button",{name:"继续编辑",exact:true}).last().click();assert.match(await editor.inputValue(),/kept/);await page.getByRole("button",{name:"保存配置",exact:true}).click();await page.getByText(/配置已保存。/).waitFor();assert.deepEqual((await readAppSettings(project,"example.app")).config.extra,{kept:true});
});

test("a missing matching Store explains preparation without changing the saved target",async t=>{
 const {origin,project,f}=await appSettingsServer(t,"127.0.0.1",true);await removeBusinessStore({},f.root,"first");await removeBusinessStore({},f.root,"second");const browser=await browserScope();t.after(()=>browser.close());const page=await browser.newPage();await page.goto(`${origin}/projects/test-project/settings/apps?app=example.app`);await page.getByText(/请先在当前 Project 登记符合所需模型和类型的 Store/).waitFor();assert.equal(await page.getByLabel("记录 Store",{exact:true}).isDisabled(),true);await page.getByText("records · record.json · ValueStore",{exact:true}).waitFor();assert.equal((await readAppSettings(project,"example.app")).config.store,"first");
});

for (const action of ["validate", "save"] as const) test(`real HTTP ${action} locks public controls and SDK until the response is released`,async t=>{
    const {page,origin}=await customPage(t);
    await page.getByLabel("名称",{exact:true}).fill("Busy");
    const {gate,handshake,arrived,release,fail}=httpGate(t);
    const suffix=action==="validate"?"/validate":"";
    await page.route(`**/api/projects/test-project/settings/apps/example.app${suffix}`,async route=>{
        if(route.request().method()!==(action==="save"?"PUT":"POST")){await route.continue();return;}
        try { const response=await route.fetch({timeout:10000});arrived();await gate;await route.fulfill({response}); }
        catch(error){fail(error);await route.abort().catch(()=>{});}
    });
    try {
    await page.getByRole("button",{name:action==="save"?"保存配置":"校验",exact:true}).click();
    await handshake;
    assert.equal(await page.getByLabel("名称",{exact:true}).isDisabled(),true);
    const codes=await page.evaluate(async()=>{
        const c=(globalThis as any).__appSettingsContext, codes:string[]=[];
        for(const edit of [()=>c.setValue(["name"],"bad"),()=>c.setText(["prefs"],"{}"),()=>c.removeValue(["name"]),()=>c.reset(),()=>c.save(),()=>c.validate()]) {
            try{await edit();codes.push("accepted");}catch(e){codes.push((e as any).code);}
        }
        return codes;
    });
    assert.deepEqual(codes,Array(6).fill("APP_SETTINGS_BUSY"));
    release();await page.waitForFunction(()=>!(globalThis as any).__appSettingsContext.getState().busy);
    assert.equal(await page.getByLabel("名称",{exact:true}).isDisabled(),false);
    } finally {release();}
});

test("persisted save with a lost response stays unconfirmed without retry; reload recovers B and rejects the old revision",async t=>{
    const {page,origin,project}=await customPage(t);
    const a=await readAppSettings(project,"example.app");
    await page.getByLabel("名称",{exact:true}).fill("B");
    await page.getByLabel("记录 Store",{exact:true}).selectOption({label:"second"});
    let requests=0;
    const {gate,handshake,arrived,release,fail}=httpGate(t);
    await page.route("**/api/projects/test-project/settings/apps/example.app",async route=>{
        if(route.request().method()!=="PUT"){await route.continue();return;}
        try {
        requests++;const response=await route.fetch({timeout:10000});assert.equal(response.status(),200);arrived();await gate;
        // The server committed successfully, but its response is deliberately lost.
        await route.abort().catch(()=>{});
        } catch(error){fail(error);await route.abort().catch(()=>{});}
    });
    try {
    await page.getByRole("button",{name:"保存配置",exact:true}).click();await handshake;
    const b=await readAppSettings(project,"example.app");assert.equal(b.config.name,"B");assert.equal(b.config.store,"second");assert.notEqual(b.revision,a.revision);
    await page.getByText("保存结果未确认，请重新读取后核实",{exact:true}).waitFor({timeout:35000});
    const state=await page.evaluate(()=>(globalThis as any).__appSettingsContext.getState());
    assert.equal(state.status,"unconfirmed");assert.equal(state.draft.name,"B");assert.equal(state.revision,a.revision);assert.equal(state.dirty,true);assert.equal(state.busy,false);assert.equal(requests,1);
    release();await page.unrouteAll({behavior:"wait"});
    await page.getByRole("button",{name:"重新读取",exact:true}).click();
    await page.getByRole("button",{name:"放弃并离开",exact:true}).last().click();
    await page.waitForFunction(revision=>(globalThis as any).__appSettingsContext.getState().revision===revision,b.revision);
    assert.equal(await page.getByLabel("名称",{exact:true}).inputValue(),"B");
    const conflict=await fetch(`${origin}/api/projects/test-project/settings/apps/example.app`,{method:"PUT",headers:{origin,"content-type":"application/json"},body:JSON.stringify({config:a.config,expectedRevision:a.revision})});
    assert.equal(conflict.status,409);assert.equal((await conflict.json() as any).code,"APP_CONFIG_CONFLICT");
    const after=await readAppSettings(project,"example.app");assert.equal(after.revision,b.revision);assert.equal(after.config.store,"second");assert.equal(requests,1);
    } finally {release();}
});

test("late options from a disposed presentation cannot overwrite the new form",async t=>{
    const {origin}=await appSettingsServer(t,"127.0.0.1","late-options");const browser=await browserScope();t.after(()=>browser.close());const page=await browser.newPage();
    await page.goto(`${origin}/projects/test-project/settings/apps?app=example.app`);
    await page.waitForFunction(()=>(globalThis as any).__optionRequests?.length===1);
    await page.evaluate(()=>{(globalThis as any).__oldSettings=(globalThis as any).__appSettingsContext;});
    await page.getByRole("button",{name:"所有 App",exact:true}).click();await page.getByRole("button",{name:"配置",exact:true}).click();
    await page.waitForFunction(()=>(globalThis as any).__optionRequests?.length===2);
    assert.equal(await page.evaluate(()=>(globalThis as any).__optionRequests[0].signal.aborted),true);
    await page.evaluate(async()=>{const requests=(globalThis as any).__optionRequests;requests[1].resolve([{value:true,label:{text:"current choice"}}]);await Promise.resolve();});
    await page.getByLabel("类型选项",{exact:true}).locator("option",{hasText:"current choice"}).waitFor({state:"attached"});
    await page.evaluate(async()=>{(globalThis as any).__optionRequests[0].resolve([{value:false,label:{text:"stale choice"}}]);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));});
    assert.equal(await page.getByLabel("类型选项",{exact:true}).locator("option",{hasText:"stale choice"}).count(),0);
    assert.equal(await page.getByLabel("类型选项",{exact:true}).locator("option",{hasText:"current choice"}).count(),1);
});

test("a timed-out apply released after generic recovery cannot register into the new presentation",async t=>{
    const {origin}=await appSettingsServer(t,"127.0.0.1","late-apply");const browser=await browserScope();t.after(()=>browser.close());const page=await browser.newPage();
    await page.goto(`${origin}/projects/test-project/settings/apps?app=example.app`);
    await page.getByRole("button",{name:"使用通用配置",exact:true}).waitFor({timeout:18000});
    await page.getByRole("button",{name:"使用通用配置",exact:true}).click();
    await page.getByLabel("name",{exact:true}).fill("New context");
    await page.evaluate(()=>(globalThis as any).__releaseSettingsApply());
    await page.waitForFunction(()=>typeof (globalThis as any).__lateApplyResult==="string");
    assert.match(await page.evaluate(()=>(globalThis as any).__lateApplyResult),/closed|disposed/);
    assert.equal(await page.getByLabel("name",{exact:true}).inputValue(),"New context");
    assert.equal(await page.locator(".mem-view-settings-form").count(),1);
});

test("validation preserves a confirmed pending restart until an actual View server restart",async t=>{
    const {origin,project,config,server}=await appSettingsServer(t,"127.0.0.1","business-view");
    const browser=await browserScope();t.after(()=>browser.close());const page=await browser.newPage();
    await page.goto(`${origin}/projects/test-project/modules/business/business`);
    await page.getByText("Business A",{exact:true}).waitFor();
    await page.goto(`${origin}/projects/test-project/settings/apps?app=example.app`);
    await page.getByLabel("名称",{exact:true}).fill("B");await page.getByRole("button",{name:"保存配置",exact:true}).click();
    await page.getByText(/配置已保存/).waitFor();
    await page.reload();await page.getByText(/当前 View 仍使用启动快照/).waitFor();
    await page.getByRole("button",{name:"校验",exact:true}).click();await page.getByText(/校验通过，尚未保存/).waitFor();
    await page.getByText(/当前 View 仍使用启动快照/).waitFor();
    const detail=await (await fetch(`${origin}/api/projects/test-project/settings/apps/example.app`)).json() as any;
    assert.equal(detail.runtime.state,"pending-restart");assert.equal((await readAppSettings(project,"example.app")).config.name,"B");
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    const {createViewServer}=await import("../src/commands/view.js");const restarted=createViewServer(config);
    await new Promise<void>(resolve=>restarted.listen(0,"127.0.0.1",resolve));t.after(()=>new Promise<void>(resolve=>{restarted.closeAllConnections();restarted.close(()=>resolve());}));
    const next=`http://127.0.0.1:${(restarted.address() as import("node:net").AddressInfo).port}`;
    await page.goto(`${next}/projects/test-project/modules/business/business`);await page.getByText("Business B",{exact:true}).waitFor();
    await page.goto(`${next}/projects/test-project/settings/apps?app=example.app`);await page.getByLabel("名称",{exact:true}).waitFor();
    assert.equal(await page.getByText(/当前 View 仍使用启动快照/).count(),0);
    const after=await (await fetch(`${next}/api/projects/test-project/settings/apps/example.app`)).json() as any;assert.equal(after.runtime.state,"unknown");
});

for (const custom of [false,true]) test(`${custom?"custom":"generic"} Store field applies Schema readOnly after configKey resolution`, {timeout:60000}, async t=>{
    const {origin,project}=await appSettingsServer(t,"127.0.0.1",custom,"zh-CN",{readOnly:true});
    const browser=await browserScope();t.after(()=>browser.close());const page=await browser.newPage();
    await page.goto(`${origin}/projects/test-project/settings/apps?app=example.app`);
    const store=page.getByLabel(custom?"记录 Store":"records",{exact:true});
    await store.locator("option",{hasText:"second"}).waitFor({state:"attached",timeout:10000});
    assert.equal(await store.isDisabled(),true);
    assert.equal(await store.inputValue(),"0");
    await page.getByLabel(custom?"名称":"name",{exact:true}).fill("Other edit");
    await page.getByRole("button",{name:"保存配置",exact:true}).click();await page.getByText(/配置已保存。/).waitFor({timeout:10000});
    assert.equal((await readAppSettings(project,"example.app")).config.store,"first");
});
for (const custom of [false,true]) test(`${custom?"custom":"generic"} Store field applies required and enum from its resolved configKey`, {timeout:60000}, async t=>{
    const {origin}=await appSettingsServer(t,"127.0.0.1",custom,"zh-CN",{enum:["first"]});
    const browser=await browserScope();t.after(()=>browser.close());const page=await browser.newPage();
    await page.goto(`${origin}/projects/test-project/settings/apps?app=example.app`);
    const store=page.getByLabel(custom?"记录 Store":"records",{exact:true});
    await page.getByText("records · record.json · ValueStore",{exact:true}).waitFor({timeout:10000});
    assert.equal(await store.isDisabled(),false);
    assert.equal(await store.getAttribute("required"),"");
    assert.deepEqual(await store.locator("option").allTextContents(),["请选择","first"]);
});

test("custom and generic Apps keep independent configuration across save, switching and refresh",async t=>{
    const {page,project,context,root,manifest}=await customPage(t);
    await writeFile(join(root,"app.json"),JSON.stringify({...manifest,id:"generic.app",name:"Generic App",assets:{},entrypoints:{}}));
    await installApp(context,root,{name:"Generic A",store:"second",untouched:{owner:"generic"}});
    await page.getByLabel("名称",{exact:true}).fill("Custom B");
    await page.getByLabel("记录 Store",{exact:true}).selectOption({label:"second"});
    await page.getByRole("button",{name:"保存配置",exact:true}).click();await page.getByText(/配置已保存。/).waitFor();
    await page.getByRole("button",{name:"所有 App",exact:true}).click();
    await page.locator('[data-app-id="generic.app"]').getByRole("button",{name:"配置",exact:true}).click();
    assert.equal(await page.getByLabel("name",{exact:true}).inputValue(),"Generic A");
    await page.getByLabel("name",{exact:true}).fill("Generic B");
    await page.getByLabel("records",{exact:true}).selectOption({label:"first"});
    await page.getByRole("button",{name:"保存配置",exact:true}).click();await page.getByText(/配置已保存。/).waitFor();
    await page.getByRole("button",{name:"所有 App",exact:true}).click();
    await page.locator('[data-app-id="example.app"]').getByRole("button",{name:"配置",exact:true}).click();
    assert.equal(await page.getByLabel("名称",{exact:true}).inputValue(),"Custom B");
    await page.reload();await page.getByLabel("名称",{exact:true}).waitFor();
    assert.equal(await page.getByLabel("名称",{exact:true}).inputValue(),"Custom B");
    await page.getByRole("button",{name:"所有 App",exact:true}).click();
    await page.locator('[data-app-id="generic.app"]').getByRole("button",{name:"配置",exact:true}).click();
    await page.reload();await page.getByLabel("name",{exact:true}).waitFor();
    assert.equal(await page.getByLabel("name",{exact:true}).inputValue(),"Generic B");
    const custom=await readAppSettings(project,"example.app"),generic=await readAppSettings(project,"generic.app");
    assert.equal(custom.config.store,"second");assert.equal(generic.config.store,"first");
    assert.deepEqual(custom.config.untouched,{extra:true});assert.deepEqual(generic.config.untouched,{owner:"generic"});
});
test("App settings can be edited, reached by Tab and saved with Enter",async t=>{
    const {page,project}=await customPage(t);
    await page.getByLabel("记录 Store",{exact:true}).locator("option",{hasText:"second"}).waitFor({state:"attached"});
    await page.getByLabel("名称",{exact:true}).focus();
    await page.keyboard.press("ControlOrMeta+A");await page.keyboard.type("Keyboard saved");
    const save=page.getByRole("button",{name:"保存配置",exact:true});
    let focused=false;
    for(let i=0;i<15;i++) {await page.keyboard.press("Tab");focused=await save.evaluate(el=>document.activeElement===el);if(focused)break;}
    assert.equal(focused,true);await page.keyboard.press("Enter");await page.getByText(/配置已保存。/).waitFor();
    assert.equal((await readAppSettings(project,"example.app")).config.name,"Keyboard saved");
});

test("full JSON cannot replace a readOnly descendant but can save other fields",async t=>{
    const {origin,project}=await appSettingsServer(t,"127.0.0.1",false,"zh-CN",{readOnly:true});
    const browser=await browserScope();t.after(()=>browser.close());const page=await browser.newPage();
    await page.goto(`${origin}/projects/test-project/settings/apps?app=example.app`);
    await page.getByRole("button",{name:"编辑完整 JSON",exact:true}).click();
    const editor=page.getByLabel("完整配置（JSON）",{exact:true});await editor.waitFor();
    const initial=await readAppSettings(project,"example.app");
    await editor.fill(JSON.stringify({...initial.config,store:"second",name:"B"}));
    assert.equal(await page.getByRole("button",{name:"保存配置",exact:true}).isDisabled(),true);
    assert.equal((await readAppSettings(project,"example.app")).config.store,"first");
    await editor.fill(JSON.stringify({...initial.config,name:"B"}));
    await page.getByRole("button",{name:"保存配置",exact:true}).click();await page.getByText(/配置已保存。/).waitFor();
    const saved=await readAppSettings(project,"example.app");assert.equal(saved.config.store,"first");assert.equal(saved.config.name,"B");
});
for(const kind of ["array-fields","tuple-fields"] as const)test(`${kind} public controls preserve items readOnly, required and enum`,async t=>{
    const {origin,project}=await appSettingsServer(t,"127.0.0.1",kind);
    const browser=await browserScope();t.after(()=>browser.close());const page=await browser.newPage();
    await page.goto(`${origin}/projects/test-project/settings/apps?app=example.app`);
    const name=page.getByLabel("数组名称",{exact:true});await name.waitFor();
    assert.equal(await name.isDisabled(),true);assert.equal(await name.getAttribute("required"),"");
    const choice=page.getByLabel("数组选项",{exact:true});assert.equal(await choice.getAttribute("required"),"");
    assert.deepEqual(await choice.locator("option").allTextContents(),["请选择","A"]);
    await page.getByLabel("名称",{exact:true}).fill("B");await page.getByRole("button",{name:"保存配置",exact:true}).click();await page.getByText(/配置已保存。/).waitFor();
    assert.deepEqual((await readAppSettings(project,"example.app")).config.rows,[{name:"A",choice:"A",note:"keep"}]);
});
async function historyPage(t:TestContext) {
    const fixture=await appSettingsServer(t,"127.0.0.1",true),{origin,context,root,manifest}=fixture;
    await writeFile(join(root,"app.json"),JSON.stringify({...manifest,id:"other.app",name:"Other App",assets:{},entrypoints:{}}));
    await installApp(context,root,{name:"Other",store:"second"});
    const browser=await browserScope();t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:1000}});
    // Three real destinations A → B → C; no synthetic pushState or copied state.
    const otherUrl=`${origin}/projects/test-project/settings/apps?app=other.app`;
    await page.goto(otherUrl);await page.getByLabel("name",{exact:true}).waitFor();
    await page.getByRole("button",{name:"所有 App",exact:true}).click();
    const listUrl=page.url(),listIndex=await page.evaluate(()=>history.state.memsphereViewIndex);
    await page.locator('[data-app-id="example.app"]').getByRole("button",{name:"配置",exact:true}).click();await page.getByLabel("名称",{exact:true}).waitFor();
    const detailUrl=page.url(),index=await page.evaluate(()=>history.state.memsphereViewIndex);assert.equal(index,listIndex+1);
    await page.reload();await page.getByLabel("名称",{exact:true}).waitFor();
    return {...fixture,page,listUrl,listIndex,detailUrl,index,otherUrl};
}
test("reload preserves actual route history for dirty Back and Forward cancellation and confirmation",async t=>{
    const {page,listUrl,listIndex,detailUrl,index,otherUrl}=await historyPage(t);
    await page.getByLabel("名称",{exact:true}).fill("Unsaved after reload");
    await page.goBack();await page.getByRole("button",{name:"继续编辑",exact:true}).last().click();
    assert.equal(page.url(),detailUrl);assert.equal(await page.evaluate(()=>history.state.memsphereViewIndex),index);
    assert.equal(await page.getByLabel("名称",{exact:true}).inputValue(),"Unsaved after reload");
    await page.goBack();await page.getByRole("button",{name:"放弃并离开",exact:true}).last().click();
    await page.waitForURL(listUrl);await page.getByRole("heading",{name:"App 配置",exact:true,level:2}).waitFor();
    assert.equal(await page.getByLabel("名称",{exact:true}).count(),0);assert.equal(await page.evaluate(()=>history.state.memsphereViewIndex),listIndex);
    await page.goForward();await page.getByLabel("名称",{exact:true}).waitFor();assert.equal(page.url(),detailUrl);
    assert.equal(await page.getByLabel("名称",{exact:true}).inputValue(),"A");assert.equal(await page.evaluate(()=>history.state.memsphereViewIndex),index);
    await page.goBack();await page.waitForURL(listUrl);await page.getByRole("heading",{name:"App 配置",exact:true,level:2}).waitFor();
    await page.goBack();await page.waitForURL(otherUrl);await page.getByLabel("name",{exact:true}).fill("Other dirty");
    await page.goForward();await page.getByRole("button",{name:"继续编辑",exact:true}).last().click();
    assert.equal(page.url(),otherUrl);assert.equal(await page.getByLabel("name",{exact:true}).inputValue(),"Other dirty");
    assert.equal(await page.evaluate(()=>history.state.memsphereViewIndex),listIndex-1);
    await page.goForward();await page.getByRole("button",{name:"放弃并离开",exact:true}).last().click();
    await page.waitForURL(listUrl);await page.getByRole("heading",{name:"App 配置",exact:true,level:2}).waitFor();
    await page.goForward();await page.getByLabel("名称",{exact:true}).waitFor();assert.equal(page.url(),detailUrl);assert.equal(await page.getByLabel("名称",{exact:true}).inputValue(),"A");
});
test("a missing history restoration event fails finitely and retains the current route and draft",async t=>{
    const {page,detailUrl,index}=await historyPage(t);await page.getByLabel("名称",{exact:true}).fill("Keep draft");
    await page.evaluate(()=>{const go=history.go.bind(history);(globalThis as any).__restoreNativeGo=go;history.go=(delta=0)=>{if(delta!==1)go(delta);};});
    await page.goBack();await page.locator("[data-view-navigation-error]").getByText(/History navigation could not be restored/).waitFor({timeout:8000});
    assert.equal(page.url(),detailUrl);assert.equal(await page.evaluate(()=>history.state.memsphereViewIndex),index);assert.equal(await page.getByLabel("名称",{exact:true}).inputValue(),"Keep draft");
    await page.evaluate(()=>history.go=(globalThis as any).__restoreNativeGo);
    await page.getByRole("button",{name:"所有 App",exact:true}).click();await page.getByRole("button",{name:"继续编辑",exact:true}).last().click();
    assert.equal(page.url(),detailUrl);assert.equal(await page.getByLabel("名称",{exact:true}).inputValue(),"Keep draft");
});

async function leavingPage(t:TestContext) {
    const fixture=await appSettingsServer(t,"127.0.0.1",true,"zh-CN",{},true);
    const browser=await browserScope();t.after(()=>browser.close());const context=await browser.newContext({viewport:{width:1440,height:1000}});
    context.setDefaultTimeout(10000);context.setDefaultNavigationTimeout(15000);
    const page=await context.newPage();
    await page.goto(`${fixture.origin}/projects/test-project/settings/apps?app=example.app`);
    await page.getByLabel("偏好 JSON",{exact:true}).waitFor();
    await page.getByLabel("偏好 JSON",{exact:true}).click();
    return {...fixture,page};
}
for(const mode of ["invalid","format-only"] as const)test(`${mode} JSON Project switch cancels intact and discards once with cleanup`,async t=>{
    const {page,project,secondary}=await leavingPage(t);
    const editor=page.getByLabel("偏好 JSON",{exact:true}),original=await editor.inputValue();
    const raw=mode==="invalid"?'{"color":':JSON.stringify(JSON.parse(original));assert.notEqual(raw,original);
    await editor.fill(raw);const url=page.url();
    assert.equal(await page.evaluate(()=>(globalThis as any).__appSettingsContext.getState().dirty),true);
    if(mode==="invalid")await page.locator("[data-request-errors]").waitFor();
    else assert.deepEqual(await page.evaluate(()=>(globalThis as any).__appSettingsContext.getState().draft.prefs),{color:"blue"});
    const nativeDialogs:string[]=[];page.on("dialog",async dialog=>{nativeDialogs.push(dialog.type());await dialog.accept();});
    await page.evaluate(()=>{localStorage.removeItem("settings-disposed");(globalThis as any).__appSettingsContext.signal.addEventListener("abort",()=>localStorage.setItem("settings-disposed","yes"),{once:true});});
    const choose=async()=>{if(await page.locator("#view-shell-project-trigger").getAttribute("aria-expanded")!=="true")await page.locator("#view-shell-project-trigger").click();await page.getByRole("menuitem",{name:"second-project",exact:true}).click();};
    await choose();await page.getByRole("button",{name:"继续编辑",exact:true}).last().click();
    assert.equal(page.url(),url);assert.equal(await editor.inputValue(),raw);
    assert.equal(await page.locator("[data-request-errors]").count(),mode==="invalid"?1:0);
    assert.equal(await page.evaluate(()=>localStorage.getItem("settings-disposed")),null);
    await choose();await page.getByRole("button",{name:"放弃并离开",exact:true}).last().click();
    await page.waitForURL("**/projects/second-project/settings/apps");await page.getByRole("heading",{name:"App 配置",exact:true,level:2}).waitFor();
    assert.deepEqual(nativeDialogs,[]);assert.equal(await page.evaluate(()=>localStorage.getItem("settings-disposed")),"yes");
    await page.getByRole("button",{name:"配置",exact:true}).click();await page.getByLabel("name",{exact:true}).waitFor();
    assert.equal(await page.getByLabel("name",{exact:true}).inputValue(),"Second");
    assert.deepEqual((await readAppSettings(project,"example.app")).config.prefs,{color:"blue"});
    assert.deepEqual((await readAppSettings(secondary!.project,"example.app")).config.prefs,{color:"green"});
    await page.reload();await page.getByLabel("name",{exact:true}).waitFor();assert.deepEqual(nativeDialogs,[]);
    await page.locator("#view-shell-project-trigger").click();await page.getByRole("menuitem",{name:"test-project",exact:true}).click();
    await page.waitForURL("**/projects/test-project/settings/apps");await page.getByRole("heading",{name:"App 配置",exact:true,level:2}).waitFor();
    assert.equal(await page.getByRole("dialog").count(),0);assert.deepEqual(nativeDialogs,[]);
});

for(const mode of ["invalid","format-only"] as const)test(`${mode} JSON native reload cancellation retains raw input and confirmation discards it`,async t=>{
    const {page,project}=await leavingPage(t);const editor=page.getByLabel("偏好 JSON",{exact:true}),original=await editor.inputValue();
    const raw=mode==="invalid"?'{"color":':JSON.stringify(JSON.parse(original));await editor.fill(raw);const url=page.url();
    const first=page.waitForEvent("dialog",{timeout:10000});
    const cancelled=page.reload().then(()=>null,error=>error);
    const dialog=await first;assert.equal(dialog.type(),"beforeunload");await dialog.dismiss();await cancelled;
    assert.equal(page.url(),url);assert.equal(await editor.inputValue(),raw);
    assert.equal(await page.locator("[data-request-errors]").count(),mode==="invalid"?1:0);
    const second=page.waitForEvent("dialog",{timeout:10000});const accepted=page.reload();
    const confirm=await second;assert.equal(confirm.type(),"beforeunload");await confirm.accept();await accepted;
    await page.getByLabel("偏好 JSON",{exact:true}).waitFor();assert.equal(await page.getByLabel("偏好 JSON",{exact:true}).inputValue(),original);
    assert.equal(await page.locator("[data-request-errors]").count(),0);assert.deepEqual((await readAppSettings(project,"example.app")).config.prefs,{color:"blue"});
    let cleanDialogs=0;page.on("dialog",async d=>{cleanDialogs++;await d.dismiss();});
    await page.reload();await page.getByLabel("偏好 JSON",{exact:true}).waitFor();assert.equal(cleanDialogs,0);
    const closed=page.waitForEvent("close",{timeout:10000});await page.close({runBeforeUnload:true});await closed;assert.equal(cleanDialogs,0);
});

for(const mode of ["invalid","format-only"] as const)test(`${mode} native close cancellation preserves raw JSON; accepting closes without saving`,async t=>{
    const {page,project}=await leavingPage(t);const editor=page.getByLabel("偏好 JSON",{exact:true});
    const raw=mode==="invalid"?'{"color":':JSON.stringify(JSON.parse(await editor.inputValue()));await editor.fill(raw);
    // Use Chrome's native close command: Playwright Page.close keeps a closing
    // state after a dismissed beforeunload and will not issue a second close.
    const native=await page.context().newCDPSession(page);
    const first=page.waitForEvent("dialog",{timeout:10000});const cancelled=native.send("Page.close");
    const dialog=await first;assert.equal(dialog.type(),"beforeunload");await dialog.dismiss();await cancelled;
    assert.equal(page.isClosed(),false);assert.equal(await page.getByLabel("偏好 JSON",{exact:true}).inputValue(),raw);assert.equal(await page.locator("[data-request-errors]").count(),mode==="invalid"?1:0);
    const second=page.waitForEvent("dialog",{timeout:10000}),closed=page.waitForEvent("close",{timeout:10000});
    const accepted=native.send("Page.close");const confirm=await second;assert.equal(confirm.type(),"beforeunload");await confirm.accept();await accepted;await closed;
    assert.deepEqual((await readAppSettings(project,"example.app")).config.prefs,{color:"blue"});
});

for (const id of ["empty.no-schema", "empty.closed", "empty.readonly"]) test(`App settings with no editable configuration explains ${id} without an editor`,async t=>{
    const {origin,project}=await emptyAppSettingsServer(t);
    const browser=await browserScope();t.after(()=>browser.close());const page=await browser.newPage();
    await page.goto(`${origin}/projects/test-project/settings/apps?app=${id}`);
    await page.getByText("这个 App 没有可配置项。",{exact:true}).waitFor();
    assert.equal(await page.locator(".mem-view-settings-form").count(),0);
    assert.equal(await page.getByRole("button",{name:"编辑完整 JSON",exact:true}).count(),0);
    assert.equal(await page.getByRole("button",{name:"保存配置",exact:true}).isDisabled(),true);
    await page.reload();await page.getByText("这个 App 没有可配置项。",{exact:true}).waitFor();
    assert.deepEqual((await readAppSettings(project,id)).config,{});
});
test("an open empty Schema remains editable and can persist new JSON properties",async t=>{
    const {origin,project}=await emptyAppSettingsServer(t);const browser=await browserScope();t.after(()=>browser.close());const page=await browser.newPage();
    await page.goto(`${origin}/projects/test-project/settings/apps?app=empty.open`);
    await page.getByLabel("完整配置（JSON）",{exact:true}).fill('{"newField":"kept"}');
    await page.getByRole("button",{name:"保存配置",exact:true}).click();await page.getByText(/配置已保存。/).waitFor();
    await page.reload();await page.getByRole("button",{name:"编辑完整 JSON",exact:true}).click();assert.deepEqual(JSON.parse(await page.getByLabel("完整配置（JSON）",{exact:true}).inputValue()),{newField:"kept"});
    assert.deepEqual((await readAppSettings(project,"empty.open")).config,{newField:"kept"});
});
test("zero installed Apps shows installation guidance through the App settings menu",async t=>{
    const {origin}=await emptyAppSettingsServer(t,"empty");const browser=await browserScope();t.after(()=>browser.close());const page=await browser.newPage();
    await page.goto(`${origin}/projects/test-project/settings/overview`);
    await page.getByRole("button",{name:"App 配置",exact:true}).click();
    await page.getByText(/当前项目尚未安装 App。使用 memsphere app install/).waitFor();
    assert.equal(await page.locator("[data-app-id]").count(),0);
    assert.equal(await page.getByRole("button",{name:"保存配置",exact:true}).count(),0);
});
test("App settings without a selected Project explains selection and remains reachable",async t=>{
    const {origin}=await emptyAppSettingsServer(t,"no-project");const browser=await browserScope();t.after(()=>browser.close());const page=await browser.newPage();
    await page.goto(`${origin}/settings/overview`);
    await page.getByRole("button",{name:"App 配置",exact:true}).click();
    await page.getByText(/App 配置属于 Project。请先通过顶部项目选择器选择 Project/).waitFor();
    assert.equal(await page.locator("[data-app-id]").count(),0);
    assert.equal(await page.getByRole("button",{name:"保存配置",exact:true}).count(),0);
    await page.locator("#view-shell-project-trigger").click();
    await page.getByRole("menuitem",{name:"test-project",exact:true}).click();
    await page.waitForURL("**/projects/test-project/settings/apps");
    await page.getByText(/当前项目尚未安装 App。使用 memsphere app install/).waitFor();
    assert.equal(await page.getByText(/App 配置属于 Project。请先/).count(),0);
});
test("App search retains unmatched text and clears it without confusing an uninstalled Project",async t=>{
    const {origin}=await emptyAppSettingsServer(t);const browser=await browserScope();t.after(()=>browser.close());const page=await browser.newPage();
    await page.goto(`${origin}/projects/test-project/settings/apps`);
    const search=page.getByLabel("搜索 App",{exact:true});await search.fill("unmatched-app");
    await page.getByText("没有匹配的 App。",{exact:true}).waitFor();
    assert.equal(await search.inputValue(),"unmatched-app");
    assert.equal(await page.locator("[data-app-id]:visible").count(),0);
    assert.equal(await page.getByText(/当前项目尚未安装 App/).count(),0);
    await page.getByRole("button",{name:"清空搜索",exact:true}).click();assert.equal(await search.inputValue(),"");
    assert.equal(await page.locator("[data-app-id]:visible").count(),4);
    assert.equal(await page.getByText("没有匹配的 App。",{exact:true}).isVisible(),false);
});
