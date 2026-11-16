import { execFileSync } from "node:child_process";
import { createViewServer } from "../../src/commands/view.js";
import type { MemsphereConfig } from "../../src/config.js";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { businessFixture } from "./business-data.js";
import { projectPaths } from "../../src/project/paths.js";
import { readBusinessProject } from "../../src/project/business-stores.js";
import { installApp, setAppEnabled, checkApp } from "../../src/app/install.js";
import type { AppProject } from "../../src/app/state.js";
import type { ProjectContext } from "../../src/project/resolver.js";
export type SettingsFixtureKind = boolean | "hang-import" | "hang-apply" | "bad-root" | "incompatible" | "late-apply" | "late-options" | "business-view";
export async function appSettingsFixture(t: import("node:test").TestContext, custom: SettingsFixtureKind = false) {
    const f = await businessFixture(t);
    for (const kind of ["concepts", "statements", "procedures", "schemas"])
        await mkdir(join(f.root, "memory", kind));
    await f.createStore("first");
    await f.createStore("second");
    const project = { name: "test-project", paths: projectPaths(f.root), memoryRoot: join(f.root, "memory"), config: await readBusinessProject(f.root) } as AppProject;
    const context = { primary: project, home: f.home } as ProjectContext;
    const root = join(f.directory, "app");
    await mkdir(root);
    const manifest: any = { schemaVersion: 1, id: "example.app", name: "Example", version: "1.0.0", description: "Example", configuration: "schema.json", projectStores: [{ key: "records", model: "record.json", kind: "ValueStore", configKey: "store" }] };
    await writeFile(join(root, "schema.json"), JSON.stringify({ type: "object", properties: { name: { type: "string" }, store: { type: "string" }, count: { type: "integer", minimum: 1 }, choice: { enum: [false, true, 1, 2] }, prefs: { type: "object" } }, required: ["name", "store"] }));
    if (custom) {
        await mkdir(join(root, "settings"));
        manifest.assets = { viewPackages: [{ key: "settings", path: "settings" }] };
        manifest.entrypoints = { settings: { packageKey: "settings" } };
        await writeFile(join(root, "settings/module.json"), JSON.stringify({ schemaVersion: 1, id: "example.settings", version: "1.0.0", view: { entry: "./index.js", sdk: "^1.1.0", contributions: [{ id: "configuration", cell: "org.memsphere.settings.app.configuration@1:app", priority: 100 }] } }));
        await writeFile(join(root, "settings/index.js"), `import {defineViewPlugin,portableSlots} from '@memsphere/view-sdk';
 export default defineViewPlugin({apiVersion:1,inject:['slots','ui'],uiVersion:1,apply(ctx){ctx.slots.register(portableSlots.appSettingsConfiguration,{id:'configuration',key:ctx.module.appId,value:{render(context){globalThis.__appSettingsContext=context;return ctx.ui.settingsForm({context,sections:[{id:'main',title:{text:'App 自定义分组'},fields:[{kind:'text',path:['name'],label:{text:'名称'}},{kind:'integer',path:['count'],label:{text:'数量'}},{kind:'select',path:['choice'],label:{text:'类型选项'},options:[{value:false,label:{text:'否'}},{value:true,label:{text:'是'}},{value:1,label:{text:'一'}},{value:2,label:{text:'二'}}]},{kind:'json',path:['prefs'],label:{text:'偏好 JSON'}},{kind:'projectStore',key:'records',label:{text:'记录 Store'}}]}]});}}});}});`);
    }
    if(custom === "late-options") {
        const entry=await readFile(join(root,"settings/index.js"),"utf8");
        await writeFile(join(root,"settings/index.js"),entry.replace("options:[{value:false,label:{text:'否'}},{value:true,label:{text:'是'}},{value:1,label:{text:'一'}},{value:2,label:{text:'二'}}]", "options:(snapshot,{signal})=>new Promise(resolve=>{globalThis.__optionRequests??=[];globalThis.__optionRequests.push({resolve,signal});})"));
    }
    if(custom === "late-apply") await writeFile(join(root,"settings/index.js"),`import {portableSlots} from '@memsphere/view-sdk'; export default {apiVersion:1,inject:['slots','ui'],uiVersion:1,async apply(ctx){await new Promise(resolve=>globalThis.__releaseSettingsApply=resolve);try{ctx.slots.register(portableSlots.appSettingsConfiguration,{id:'configuration',key:ctx.module.appId,value:{render(context){return ctx.ui.settingsForm({context,sections:[]});}}});globalThis.__lateApplyResult='registered';}catch(e){globalThis.__lateApplyResult=e.message;}}};`);
    if(custom === "business-view") {
        await mkdir(join(root,"view"));
        manifest.assets.viewPackages.push({key:"business",path:"view"});
        manifest.entrypoints.view=[{packageKey:"business",instanceId:"business",path:"/business",config:{name:{configKey:"name"}}}];
        await writeFile(join(root,"view/module.json"),JSON.stringify({schemaVersion:1,id:"example.business",version:"1.0.0",view:{entry:"./index.js",sdk:"^1.1.0",contributions:[{id:"main",cell:"main.view@1:route:index",priority:100}]}}));
        await writeFile(join(root,"view/index.js"),`import {slots} from '@memsphere/view-sdk';export default {apiVersion:1,inject:['router','slots'],apply(ctx,config){const r=ctx.router.register({id:'index',path:'/business'});ctx.slots.register(slots.mainView,{id:'main',key:r.key,value:{mount({element}){element.textContent='Business '+config.name;}}});}};`);
    }
    if(custom === "hang-import") await writeFile(join(root,"settings/index.js"),"await new Promise(()=>{}); export default {};");
    if(custom === "hang-apply") await writeFile(join(root,"settings/index.js"),"export default {apiVersion:1,inject:[],apply(){return new Promise(()=>{});}};");
    if(custom === "bad-root") await writeFile(join(root,"settings/index.js"),"import {portableSlots} from '@memsphere/view-sdk'; export default {apiVersion:1,inject:['slots'],apply(ctx){ctx.slots.register(portableSlots.appSettingsConfiguration,{id:'configuration',key:ctx.module.appId,value:{render(){return document.createElement('div');}}});}};");
    if(custom === "incompatible") {
        const module={schemaVersion:1,id:"example.settings",version:"1.0.0",view:{entry:"./index.js",sdk:"^99.0.0",contributions:[{id:"configuration",cell:"org.memsphere.settings.app.configuration@1:app",priority:100}]}};
        await writeFile(join(root,"settings/module.json"),JSON.stringify(module));
    }
    await writeFile(join(root, "app.json"), JSON.stringify(manifest));
    await installApp(context, root, { name: "A", store: "first", untouched: { extra: true } });
    if(custom === "business-view") {
        execFileSync("git",["init","--initial-branch=master",f.root],{stdio:"ignore"});
        project.config.store={type:"embedded",repository_path:f.root,memory_path:"memory"};
        await writeFile(project.paths.configPath,JSON.stringify(project.config));
        const check=await checkApp(project,"example.app");
        if(check.status!=="available") throw new Error(JSON.stringify(check));
        await setAppEnabled(context,"example.app",true);
    }
    return { f, project, context, root, manifest };
}
export async function appSettingsServer(t: import("node:test").TestContext, host = "127.0.0.1", custom: SettingsFixtureKind = false,locale="zh-CN") {
    const fixture = await appSettingsFixture(t, custom), { f, project } = fixture;
    await writeFile(join(f.home, "config.json"), JSON.stringify({language:locale, view: { host, port: 30002 } }));
    const config = { configPath: project.paths.configPath, scopeRoot: f.root, homeRoot: f.home, language: locale, memoryRoot: project.memoryRoot, reviewsRoot: join(f.root, "reviews"), runsRoot: join(f.root, "runs"), archiveRoot: join(f.root, "archives"), debug: { agentReview: false, root: join(f.home, ".runtime/debug") }, view: { host, port: 30002 }, project: { name: project.name, revision: "fixture", store: project.config.store, mounted: [] } } as MemsphereConfig;
    const token = "settings-test-token-" + "a".repeat(43);
    const server = createViewServer(config, { settingsToken: token });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
    return { ...fixture, server, config, origin: `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`, token };
}
