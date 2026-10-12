#!/usr/bin/env node
import { access, cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { childEnvironment, namespaceArguments } from './runtime-policy.mjs';
import { dirname, join, resolve } from 'node:path';

const smokeOnly = process.argv.includes('--smoke-only');
const bwrapLookup = spawnSync('which', ['bwrap'], { encoding: 'utf8' });
if (bwrapLookup.status !== 0) throw new Error('Bubblewrap unavailable');
const bubblewrap = await realpath(bwrapLookup.stdout.trim());
const trialInput = process.argv.slice(2).find(value => !value.startsWith('--'));
if (!trialInput) throw new Error('Usage: run-case.sh [--smoke-only] <prepared-trial>');
const trial = resolve(trialInput);
const metadata = JSON.parse(await readFile(join(trial, 'metadata.json'), 'utf8'));
const attempt = join(trial, 'runs', `${smokeOnly ? 'smoke' : 'agent'}-${Date.now()}`);
await mkdir(attempt, { recursive: true });
const runtime = join(trial, 'runtime');
const isolatedHome = join(attempt, 'home');
const isolatedCodexHome = join(attempt, 'codex-home');
await mkdir(isolatedHome); await mkdir(isolatedCodexHome);
const existingCodexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex');
const settings = spawnSync('python3', ['-c', `import json,tomllib,sys\nfrom pathlib import Path\np=Path(sys.argv[1])/'config.toml'\ns=tomllib.loads(p.read_text()) if p.exists() else {}\nprint(json.dumps({k:s[k] for k in ['model','model_reasoning_effort','service_tier'] if k in s}))`, existingCodexHome], { encoding: 'utf8' });
if (settings.status !== 0) throw new Error('Unable to read allowlisted model settings');
const modelSettings = JSON.parse(settings.stdout);
const cli = join(runtime, 'codex-package/bin/codex');
const bin = join(runtime, 'bin');
const env = childEnvironment(process.env, bin, metadata.memoryHome);
// HOME/CODEX_HOME identities remain unchanged; only their namespace contents are isolated.
const mounts = [];
function bind(source, target = source, writable = false) { mounts.push([writable ? '--bind' : '--ro-bind', source, target]); }
for (const path of ['/usr','/bin','/lib','/lib64','/etc/ssl','/etc/hosts','/etc/resolv.conf','/usr/local/share/ca-certificates']) {
  try { await access(path); bind(path); } catch {}
}
bind(metadata.workspace, metadata.workspace, true);
bind(metadata.memoryHome, metadata.memoryHome, true);
bind(runtime);
bind(attempt, attempt, true);
bind(isolatedHome, homedir(), true);
bind(isolatedCodexHome, existingCodexHome, true);
const auth = join(existingCodexHome, 'auth.json');
await access(auth); // Do not copy, print, or persist credential contents.
bind(auth, auth);
for (const key of ['SSL_CERT_FILE','NODE_EXTRA_CA_CERTS','CURL_CA_BUNDLE','REQUESTS_CA_BUNDLE']) if (env[key]) { try { await access(env[key]); bind(env[key]); } catch {} }
const base = namespaceArguments(mounts, metadata.workspace);
function command(args, options = {}) {
  return spawnSync(bubblewrap, [...base, ...args], { env, encoding: 'utf8', ...options });
}
const canary = join(trial, 'parent-grading-canary');
await writeFile(canary, 'Parent-only grading canary\n');
const sibling = join(dirname(trial), metadata.case === '001-complex-writing' ? 'B' : 'A');
const probes = {
  publicTaskReadable: metadata.workspace + '/.agents/skills/memsphere/SKILL.md',
  hiddenRubric: metadata.parentRubric,
  parentRepository: metadata.parentRepository + '/changes/README.md',
  parentCanary: canary,
  otherTrial: sibling + '/workspace',
  hostParentRoot: `/proc/${process.pid}/root${metadata.parentRubric}`
};
const script = `const fs=require('node:fs'); const checks=${JSON.stringify(probes)}; let valid=true; const results={}; for(const [k,p] of Object.entries(checks)){try{fs.accessSync(p);results[k]=true}catch{results[k]=false} if(k==='publicTaskReadable'?!results[k]:results[k])valid=false;} console.log(JSON.stringify(results)); process.exit(valid?0:1);`;
const probe = command(['/usr/bin/node', '-e', script]);
await writeFile(join(attempt, 'isolation-probes.json'), probe.stdout || JSON.stringify({error:probe.stderr}));
if (probe.status !== 0) throw new Error(`Filesystem isolation probe failed: ${probe.stderr}`);
const version = command([cli, '--version']);
if (version.status !== 0) throw new Error(`Codex namespace smoke failed: ${version.stderr}`);
const cliSmoke = command(['/usr/bin/node',join(runtime,'memsphere/dist/cli.js'),'validate']);
await writeFile(join(attempt, 'cli-smoke.log'), cliSmoke.stdout + cliSmoke.stderr);
if (cliSmoke.status !== 0) throw new Error('Candidate CLI smoke failed; see cli-smoke.log');
const help = command([cli,'exec','--help']);
for (const flag of ['--ephemeral','--ignore-user-config','--ignore-rules','--output-last-message','--json']) if (!help.stdout.includes(flag)) throw new Error(`Unsupported child CLI flag: ${flag}`);
const args = [cli, 'exec','--cd',metadata.workspace,'--sandbox','workspace-write','--ephemeral','--ignore-user-config','--ignore-rules','--disable','apps','--json','--output-last-message',join(attempt,'final-answer.md')];
for (const [key,value] of Object.entries(modelSettings)) args.push('-c', `${key}=${JSON.stringify(value)}`);
args.push('-');
const prompt = await readFile(join(trial,'prompt.md'));
await writeFile(join(attempt,'metadata.json'), JSON.stringify({ ...metadata, parentRubric:undefined, parentRepository:undefined, attempt, smokeOnly, settings:modelSettings, codexVersion:version.stdout.trim(), command:args, mounts:mounts.map(([mode,source,target])=>({mode,source:source===auth?'[credential-file]':source,target:target===auth?'[credential-file]':target})), promptDigest:createHash('sha256').update(prompt).digest('hex'), startedAt:new Date().toISOString() }, null, 2)+'\n');
if (smokeOnly) { const network=command(['/usr/bin/curl','-I','--max-time','15','-sS','-o','/dev/null','-w','HTTP=%{http_code} time=%{time_total}', 'https://chatgpt.com/backend-api/codex/models']); await writeFile(join(attempt,'network-smoke.json'),JSON.stringify({status:network.status,stdout:network.stdout,stderr:network.stderr},null,2)+'\n'); console.log(attempt); process.exit(0); }
const child = spawn(bubblewrap, [...base,...args], { env, stdio:['pipe','pipe','pipe'] });
const eventStream = createWriteStream(join(attempt,'agent-events.jsonl'));
const errorStream = createWriteStream(join(attempt,'agent-stderr.log'));
child.stdout.pipe(eventStream); child.stderr.pipe(errorStream);
child.stdin.end(prompt);
let timedOut=false;
const deadline=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},15*60*1000);
const result = await new Promise((resolveResult,reject) => { child.on('error',reject); child.on('close',(code,signal)=>resolveResult({code,signal})); });
clearTimeout(deadline); result.timedOut=timedOut;
await Promise.all([finished(eventStream),finished(errorStream)]);
await writeFile(join(attempt,'result.json'),JSON.stringify({...result,completedAt:new Date().toISOString()},null,2)+'\n');
await cp(metadata.workspace,join(attempt,'workspace-final'),{recursive:true});
console.log(attempt);
process.exitCode=result.code ?? 1;
