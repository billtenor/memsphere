import assert from 'node:assert/strict';
import test from 'node:test';
import crossSpawn from 'cross-spawn';
import { readFile, writeFile, rename, access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initializedContextFixture } from './helpers/initialized-context.js';
import { reviewerSessionEnvironment } from './helpers/reviewer-session.js';
import { createAgentReviewCliRuntime } from '../src/acp/cli-runtime.js';

async function race(t: test.TestContext, phase: 'open'|'write'|'failure', replace: boolean) {
 const f=await initializedContextFixture(t), session=await reviewerSessionEnvironment(f.root,f.home,f.cwd);
 const runtime=await createAgentReviewCliRuntime({nodeExecutable:process.execPath,cliEntrypoint:fileURLToPath(new URL('../dist/cli.js',import.meta.url))});t.after(()=>runtime.cleanup());
 const target=join(f.cwd,'export.txt'), ready=join(f.directory,'ready'), release=join(f.directory,'release'), preload=join(f.directory,'barrier.mjs');
 // Instrument only this temporary child process. The real restricted CLI and
 // its real filesystem implementation run across a deterministic open/write gate.
 await writeFile(preload,`import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';import {setTimeout as delay} from 'node:timers/promises';
 const original=fs.open;const gate=async()=>{await fs.writeFile(${JSON.stringify(ready)},'ready');const end=Date.now()+15000;for(;;){try{await fs.access(${JSON.stringify(release)});return;}catch(e){if(e.code!=='ENOENT')throw e;}if(Date.now()>end)throw Error('barrier timeout');await delay(10);}};
 fs.open=async(...args)=>{const h=await original(...args);if(String(args[0])===${JSON.stringify(target)}&&args[1]==='wx'){
 if(${JSON.stringify(phase)}==='open')await gate();else{const write=h.writeFile.bind(h);h.writeFile=async(...a)=>{await write(...a);await gate();if(${JSON.stringify(phase)}==='failure')throw Error('controlled write failure');};}}return h;};syncBuiltinESMExports();`);
 const child=crossSpawn(runtime.launcherPath,['run','artifact','show','--out',target,'--output','json'],{cwd:f.cwd,env:{...process.env,...session,NODE_OPTIONS:`--import=${pathToFileURL(preload).href}`},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout!.on('data',b=>stdout+=b);child.stderr!.on('data',b=>stderr+=b);
 const exited=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 t.after(()=>{if(child.exitCode===null)child.kill();});
 const deadline=Date.now()+15000;
 for(;;){try{await access(ready);break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(child.exitCode!==null)throw Error(stderr);assert.ok(Date.now()<deadline,'child did not reach barrier');await delay(10);}
 if(replace){assert.equal(child.exitCode,null,'replacement must occur while export is paused at its gate');await rename(target,join(f.cwd,'created-by-export.txt'));await writeFile(target,'REPLACEMENT_OWNED_BY_OTHER');}
 await writeFile(release,'release');
 assert.notEqual(await exited,0,stderr);assert.equal(stdout,'');
 if(phase!=='failure')assert.match(stderr,/REVIEW_RESOURCE_DENIED/);
 if(replace)assert.equal(await readFile(target,'utf8'),'REPLACEMENT_OWNED_BY_OTHER');else {assert.equal(await readFile(target,'utf8'),'fixed candidate');assert.match(stderr,/may be incomplete/);}
}
test('restricted export rejects target replacement immediately after open without deleting the replacement',t=>race(t,'open',true));
test('restricted export rejects target replacement after writing without reporting a false successful path',t=>race(t,'write',true));
test('failed export cleanup preserves another writer\'s replacement',t=>race(t,'failure',true));
test('failed export explicitly retains its partial file',t=>race(t,'failure',false));
