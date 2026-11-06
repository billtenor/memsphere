import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentReviewAcpSession } from "../src/acp/client.js";

test("actual ACP fs/read_text_file rejects direct and symlink escapes", async t => {
 const root=await mkdtemp(join(tmpdir(),'memsphere-review-fs-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const workspace=join(root,'workspace');await mkdir(workspace);
 const inside=join(workspace,'inside.txt'),outside=join(root,'outside.txt'),link=join(workspace,'link.txt');
 await writeFile(inside,'inside\nsecond line');await writeFile(outside,'OUTSIDE_SECRET');await symlink(outside,link);
 const provider=join(root,'provider.mjs'),results=join(root,'results.json');
 const sdk=new URL('../node_modules/@agentclientprotocol/sdk/dist/acp.js',import.meta.url).href;
 await writeFile(provider,`import * as acp from ${JSON.stringify(sdk)};
 import {Readable,Writable} from 'node:stream';import fs from 'node:fs/promises';
 const app=acp.agent({name:'fs-contract'})
 .onRequest(acp.methods.agent.initialize,()=>({protocolVersion:acp.PROTOCOL_VERSION,agentCapabilities:{},agentInfo:{name:'fs-contract',version:'1'}}))
 .onRequest(acp.methods.agent.session.new,()=>({sessionId:'fs-contract'}))
 .onRequest(acp.methods.agent.session.prompt,async({params,client})=>{
 const values=[];for(const path of ${JSON.stringify([inside,outside,link])}){
 try{values.push({path,result:await client.request(acp.methods.client.fs.readTextFile,{sessionId:params.sessionId,path,line:1,limit:1})});}catch(error){values.push({path,error:error.message});}}
 await fs.writeFile(${JSON.stringify(results)},JSON.stringify(values));return {stopReason:'end_turn'};});
 app.connect(acp.ndJsonStream(Writable.toWeb(process.stdout),Readable.toWeb(process.stdin)));`);
 await runAgentReviewAcpSession({launch:{provider:'test',command:process.execPath,args:[provider],cwd:workspace,env:{...process.env},startupTimeoutMs:10000,idleTimeoutMs:10000,maxRuntimeMs:null,promptVersion:'artifact-review-v3'},workspaceRoot:workspace,prompt:'Read the temporary test files',reminder:'Complete',isSubmitted:async()=>true,onSession:async()=>{}});
 const values=JSON.parse(await readFile(results,'utf8'));
 assert.equal(values[0].result.content,'inside');
 for(const value of values.slice(1)){assert.match(value.error,/agent_fs_denied/);assert.equal(value.result,undefined);assert.doesNotMatch(JSON.stringify(value),/OUTSIDE_SECRET/);}
});
