import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChildProcess } from 'node:child_process';
import crossSpawn from 'cross-spawn';
import { readFile, writeFile, rename, access, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initializedContextFixture } from './helpers/initialized-context.js';
import { reviewerSessionEnvironment } from './helpers/reviewer-session.js';
import { createAgentReviewCliRuntime } from '../src/acp/cli-runtime.js';
import { terminateProcessTree } from '../src/platform-process.js';

type ExportChild = { child: ChildProcess; closed: boolean; error?: Error; stdout: string; stderr: string; exited: Promise<number | null>; draining?: Promise<void> };
type Phase = 'stage-open' | 'published' | 'zero' | 'partial' | 'after-write';
async function exportFixture(t: test.TestContext, phase: Phase) {
  const f = await initializedContextFixture(t);
  const session = await reviewerSessionEnvironment(f.root, f.home, f.cwd);
  const runtime = await createAgentReviewCliRuntime({ nodeExecutable: process.execPath, cliEntrypoint: fileURLToPath(new URL('../dist/cli.js', import.meta.url)) });
  let drainChildren: () => Promise<void> = async () => {};
  f.beforeCleanup(async () => { await drainChildren(); await runtime.cleanup(); });
  const target = join(f.cwd, 'export.txt'), ready = join(f.directory, 'ready'), release = join(f.directory, 'release');
  const preload = join(f.directory, 'barrier.mjs');
  // Only this child is instrumented. Authorization, body selection, real writes
  // and exclusive publication still execute in the actual restricted launcher.
  await writeFile(preload, `import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
const phase=${JSON.stringify(phase)}, target=${JSON.stringify(target)};
const gate=async()=>{
  await fs.writeFile(${JSON.stringify(ready)},'ready');
  const end=Date.now()+15000;
  for(;;){
    try{await fs.access(${JSON.stringify(release)});return;}
    catch(e){if(e.code!=='ENOENT')throw e;}
    if(Date.now()>end)throw Error('barrier timeout');
    await delay(10);
  }
};
const originalOpen=fs.open, originalLink=fs.link;
fs.open=async(...args)=>{
  const h=await originalOpen(...args);
  if(String(args[0]).includes('.memsphere-export-') && args[1]==='wx'){
    if(phase==='stage-open')await gate();
    const write=h.writeFile.bind(h);
    h.writeFile=async(...a)=>{
      if(phase==='zero')throw Error('controlled zero-byte failure');
      if(phase==='partial'){
        await write(Buffer.from(a[0]).subarray(0,3));
        throw Error('controlled partial-write failure');
      }
      await write(...a);
      if(phase==='after-write'){
        await gate();
        throw Error('controlled failure after complete write');
      }
    };
  }
  return h;
};
fs.link=async(...args)=>{
  await originalLink(...args);
  if(phase==='published' && String(args[1])===target)await gate();
};
syncBuiltinESMExports();`);
  const owned: ExportChild[] = [];
  const drainOne = (state: ExportChild): Promise<void> => {
    if (state.closed) return Promise.resolve();
    return state.draining ??= (async () => {
      const deadline = new AbortController();
      try {
        await Promise.race([
          (async () => {
            try { if (state.child.pid) await terminateProcessTree(state.child.pid, 'SIGKILL', process.platform, true); }
            catch (error) { if (!state.closed && (error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
            await state.exited;
          })(),
          delay(5000, undefined, { signal: deadline.signal }).then(() => { throw Error('export child did not close before fixture cleanup'); })
        ]);
      } finally { deadline.abort(); }
    })();
  };
  const drain = async () => { for (const state of owned) await drainOne(state); };
  // Run before businessFixture deletes the directory, including failures before
  // readiness. Every child, including a retry, is closed before launcher cleanup.
  drainChildren = drain;
  const spawn = (instrumented: boolean) => {
    const child = crossSpawn(runtime.launcherPath,
      ['run', 'artifact', 'show', '--out', target, '--output', 'json'], {
        cwd: f.cwd, detached: process.platform !== 'win32',
        env: { ...process.env, ...session, ...(instrumented ? { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` } : {}) },
        stdio: ['ignore', 'pipe', 'pipe']
      });
    const state: ExportChild = { child, closed: false, stdout: '', stderr: '',
      exited: new Promise<number | null>(resolve => child.once('close', code => { state.closed = true; resolve(code); })) };
    owned.push(state);
    child.stdout?.on('data', b => { state.stdout += b; });
    child.stderr?.on('data', b => { state.stderr += b; });
    child.once('error', error => { state.error = error; });
    return state;
  };
  const first = spawn(true);
  const waitReady = async () => {
    const end = Date.now() + 15000;
    for (;;) {
      t.signal.throwIfAborted();
      if (first.closed) throw first.error ?? Error(`export exited before barrier: ${first.stderr}`);
      try { await access(ready); return; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      assert.ok(Date.now() < end, 'child did not reach barrier');
      await delay(10, undefined, { signal: t.signal });
    }
  };
  const finish = async (state = first) => {
    const deadline = new AbortController();
    try {
      const code = await Promise.race([
        state.exited,
        delay(15000, undefined, { signal: AbortSignal.any([deadline.signal, t.signal]) }).then(() => { throw Error('export child did not finish'); })
      ]);
      assert.ifError(state.error);
      return { code, stdout: state.stdout, stderr: state.stderr };
    } finally { deadline.abort(); }
  };
  const releaseGate = () => writeFile(release, 'release');
  return { ...f, target, waitReady, releaseGate, finish, drain, retry: () => finish(spawn(false)), isClosed: () => first.closed };
}

for (const phase of ['stage-open', 'published', 'after-write'] as const) {
  test(`restricted export preserves a concurrent destination at ${phase}`, { timeout: 60000 }, async t => {
    const f = await exportFixture(t, phase);
    try {
      await f.waitReady();
      assert.equal(f.isClosed(), false, 'replacement must occur at the controlled gate');
      if (phase === 'published') await rename(f.target, join(f.cwd, 'completed-export.txt'));
      else await assert.rejects(access(f.target), { code: 'ENOENT' });
      await writeFile(f.target, 'REPLACEMENT_OWNED_BY_OTHER');
      await f.releaseGate();
      const result = await f.finish();
      assert.notEqual(result.code, 0, result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, phase === 'published' ? /REVIEW_RESOURCE_DENIED/ : phase === 'stage-open' ? /EEXIST/ : /controlled failure after complete write/);
      assert.equal(await readFile(f.target, 'utf8'), 'REPLACEMENT_OWNED_BY_OTHER');
    } finally { await f.drain(); }
  });
}

for (const phase of ['zero', 'partial', 'after-write'] as const) {
  test(`restricted export ${phase} failure leaves no partial target and can be retried`, { timeout: 60000 }, async t => {
    const f = await exportFixture(t, phase);
    try {
      if (phase === 'after-write') { await f.waitReady(); await f.releaseGate(); }
      const result = await f.finish();
      assert.notEqual(result.code, 0, result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /controlled .*failure/);
      await assert.rejects(access(f.target), { code: 'ENOENT' });
      assert.deepEqual((await readdir(f.cwd)).filter(name => name.startsWith('.memsphere-export-')), []);
      const retry = await f.retry();
      assert.equal(retry.code, 0, retry.stderr);
      assert.equal(await readFile(f.target, 'utf8'), 'fixed candidate');
    } finally { await f.drain(); }
  });
}
