// @integration-platform: native — real CLI process interoperates with the View API and published Memory.
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {readFile,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import test from "node:test";
import {appSettingsServer} from "../../helpers/app-settings.js";
const execute=promisify(execFile);

test("CLI show reads View-saved revisions and Store bindings; CLI configure updates the same App",async t=>{
 const {origin,f,project}=await appSettingsServer(t);
 const git=async(args:string[])=>(await execute("git",args,{cwd:project.memoryRoot})).stdout.trim();
 await writeFile(join(project.memoryRoot,"concepts/fixture.yaml"),"!concept\nsyntax: memsphere-20261027-stable\nnames: [config-cli-fixture]\ndefines: [Memory for the real configuration CLI check]\n");
 await git(["init","-b","master"]);await git(["add","concepts/fixture.yaml"]);await git(["-c","user.name=App Settings Test","-c","user.email=settings@example.test","commit","-m","fixture"]);
 const revision=await git(["rev-parse","HEAD"]);const raw=JSON.parse(await readFile(project.paths.configPath,"utf8"));raw.store.published_revision=revision;await writeFile(project.paths.configPath,JSON.stringify(raw));
 const cli=async(args:string[])=>JSON.parse((await execute(process.execPath,["--import",import.meta.resolve("tsx"),resolve("src/cli.ts"),"--project",project.name,"app",...args,"--output","json"],{env:{...process.env,MEMSPHERE_HOME:f.home},maxBuffer:1024*1024})).stdout);
 const url=`${origin}/api/projects/test-project/settings/apps/example.app`;const initial=await(await fetch(url)).json() as any;
 const response=await fetch(url,{method:"PUT",headers:{"content-type":"application/json",origin},body:JSON.stringify({config:{...initial.config,name:"Saved in View",store:"second"},expectedRevision:initial.revision})});assert.equal(response.status,200);const saved=await response.json() as any;
 const shown=await cli(["show","example.app"]);assert.equal(Object.hasOwn(shown,"config"),false);assert.equal(shown.revision,saved.revision);assert.equal(shown.configuration,"schema.json");assert.equal(shown.projectStores[0].storeId,"second");
 const file=join(f.directory,"configuration.json");await writeFile(file,JSON.stringify({...saved.config,name:"Saved in CLI",store:"first"}));await cli(["configure","example.app","--config",file]);
 const latest=await(await fetch(url)).json() as any;assert.equal(latest.config.name,"Saved in CLI");assert.equal(latest.config.store,"first");assert.deepEqual(latest.config.untouched,{extra:true});assert.notEqual(latest.revision,saved.revision);const reloaded=await cli(["show","example.app"]);assert.equal(reloaded.revision,latest.revision);assert.equal(Object.hasOwn(reloaded,"config"),false);
});
