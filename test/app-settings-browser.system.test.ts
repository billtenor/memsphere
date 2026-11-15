import {removeBusinessStore} from "../src/project/business-stores.js";
import assert from "node:assert/strict";
import test from "node:test";
import { browserScope } from "./helpers/browser.js";
import { appSettingsServer } from "./helpers/app-settings.js";
import { readAppSettings } from "../src/app/settings.js";
import { configureApp } from "../src/app/install.js";
test("real App Slot preserves invalid input, typed enums, dirty navigation, conflict and saved state", async (t) => {
    const { origin, project, context } = await appSettingsServer(t, "127.0.0.1", true);
    const browser = await browserScope();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`${origin}/projects/test-project/settings/apps`);
    await page.getByRole("button",{name:"配置",exact:true}).click();
    await page.getByText("App 自定义分组", { exact: true }).waitFor();
    await page.getByLabel("名称", { exact: true }).fill("B");
    await page.getByRole("button", { name: "所有 App", exact: true }).click();
    await page.getByRole("button", { name: "继续编辑", exact: true }).last().click();
    assert.match(page.url(), /app=example.app/);
    assert.equal(await page.getByLabel("名称", { exact: true }).inputValue(), "B");
    await page.goBack();
    await page.getByRole("button",{name:"继续编辑",exact:true}).last().click();
    assert.match(page.url(),/app=example.app/);
    assert.equal(await page.getByLabel("名称",{exact:true}).inputValue(),"B");
    await page.locator(".view-shell-project-home").click();
    await page.getByRole("button",{name:"继续编辑",exact:true}).last().click();
    assert.equal(await page.getByLabel("名称",{exact:true}).inputValue(),"B");
    await page.getByLabel("数量", { exact: true }).fill("-");
    assert.equal(await page.getByRole("button", { name: "保存配置", exact: true }).isDisabled(), true);
    await page.getByLabel("数量", { exact: true }).fill("0");
    await page.getByRole("button",{name:"保存配置",exact:true}).click();
    await page.getByText(/must be >= 1/).first().waitFor();
    assert.equal(await page.getByLabel("数量",{exact:true}).inputValue(),"0");
    await page.getByLabel("数量", { exact: true }).fill("3");
    await page.getByLabel("类型选项", { exact: true }).selectOption({ label: "否" });
    await page.getByLabel("偏好 JSON", { exact: true }).fill('{"hello":');
    await page.locator("[data-request-errors]").getByText(/prefs:/).waitFor();
    assert.equal(await page.getByRole("button", { name: "保存配置", exact: true }).isDisabled(), true);
    await page.getByLabel("偏好 JSON", { exact: true }).fill('{"hello":true}');
    await page.getByLabel("记录 Store", { exact: true }).selectOption({ label: "second" });
    await page.getByRole("button", { name: "保存配置", exact: true }).click();
    await page.getByText(/配置已保存。/).waitFor();
    const saved = await readAppSettings(project, "example.app");
    assert.equal(saved.config.name, "B");
    assert.equal(saved.config.choice, false);
    assert.equal(saved.config.count, 3);
    assert.equal(saved.config.store, "second");
    assert.deepEqual(saved.config.untouched, { extra: true });
    await page.getByLabel("名称", { exact: true }).fill("Local");
    await configureApp(context, "example.app", { ...saved.config, name: "CLI" });
    await page.getByRole("button", { name: "保存配置", exact: true }).click();
    await page.getByText(/App configuration changed/).first().waitFor();
    assert.equal(await page.getByLabel("名称", { exact: true }).inputValue(), "Local");
    assert.equal((await readAppSettings(project, "example.app")).config.name, "CLI");
    await page.getByRole("button", { name: "取消修改", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.reload();
    await page.getByLabel("名称", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("名称", { exact: true }).inputValue(), "CLI");
    assert.deepEqual(errors, []);
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
