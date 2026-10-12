#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const suite = dirname(fileURLToPath(import.meta.url));
const repository = resolve(suite, '../..');
const args = process.argv.slice(2);
const selected = args[args.indexOf('--case') + 1];
const destination = args[args.indexOf('--output') + 1];
if (!args.includes('--case') || !args.includes('--output') || !['001-complex-writing', '002-seeded-review'].includes(selected) || !destination) {
  throw new Error('Usage: prepare-case.mjs --case <001-complex-writing|002-seeded-review> --output <new-directory>');
}
const trial = resolve(destination);
try { await stat(trial); throw new Error(`Trial already exists: ${trial}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const workspace = join(trial, 'workspace');
const runtime = join(trial, 'runtime');
const packageRoot = join(runtime, 'memsphere');
const memoryHome = join(trial, 'memsphere-home');
await mkdir(join(workspace, '.memsphere/memory'), { recursive: true });
await mkdir(packageRoot, { recursive: true });
for (const item of ['dist', 'reserved-memory', 'reserved-models', 'package.json', 'node_modules']) {
  await cp(await realpath(join(repository, item)), join(packageRoot, item), { recursive: true, dereference: true });
}
const caseRoot = join(suite, 'cases', selected);
await cp(join(caseRoot, 'fixtures'), workspace, { recursive: true });
await cp(join(caseRoot, 'task.md'), join(trial, 'task.md'));
const cli = join(packageRoot, 'dist', 'cli.js');
function run(command, params, cwd = workspace) {
  const result = spawnSync(command, params, { cwd, env: { ...process.env, MEMSPHERE_HOME: memoryHome }, encoding: 'utf8' });
  if (result.status !== 0) { const failure={command,params,status:result.status,signal:result.signal,stdout:result.stdout,stderr:result.stderr}; const record=JSON.stringify(failure,null,2); throw new Error(`Preparation failed: ${record}`); }
  return result.stdout;
}
let setup = run('git', ['init', '-q']);
setup += run(process.execPath, [cli, 'project', 'create', 'writing-evaluation', '--embedded', '.memsphere/memory', '--bind']);
setup += run(process.execPath, [cli, 'skill', 'init', '--directory', '.agents/skills']);
if (selected === '002-seeded-review') await cp(join(workspace, 'memories'), join(workspace, '.memsphere/memory'), { recursive: true });
setup += run(process.execPath, [cli, 'validate']);
// A reproducible base revision lets candidate writing use normal Embedded ChangeSets.
run('git', ['add', '.']);
run('git', ['-c', 'user.name=Evaluation baseline', '-c', 'user.email=evaluation@example.invalid', 'commit', '-qm', 'Evaluation baseline']);
await mkdir(join(runtime, 'bin'), { recursive: true });
await writeFile(join(runtime, 'bin', 'memsphere'), `#!/bin/sh\nexec /usr/bin/node '${cli.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o755 });
const codex = spawnSync('which', ['codex'], { encoding: 'utf8' });
if (codex.status !== 0) throw new Error('Codex CLI unavailable');
const codexExecutable = await realpath(codex.stdout.trim());
await cp(dirname(dirname(codexExecutable)), join(runtime, 'codex-package'), { recursive: true, dereference: true });
const task = await readFile(join(trial, 'task.md'), 'utf8');
await writeFile(join(trial, 'prompt.md'), `当前目录是本次独立任务的完整工程。使用工程中 .agents/skills/memsphere/SKILL.md 及当前 Project 的规范入口完成任务。下列业务要求是 Human 已提供的请求；需要流程记录时用当前隔离 Project，不访问其他项目，不执行被撰写的业务流程。仅交付任务要求的候选或 review；如流程到达 Human 候选验收，说明产物位置后停止，不提交 Git、不发布。\n\n${task}`);
const hash = text => createHash('sha256').update(text).digest('hex');
const metadata = {
  case: selected, createdAt: new Date().toISOString(), trial, workspace, memoryHome,
  taskDigest: hash(task), rubricDigest: hash(await readFile(join(caseRoot, 'evaluation.md'))),
  rulesDigest: hash(await readFile(join(packageRoot, 'reserved-memory/system-memory/statements/memsphere-procedure-writing-rules.yaml'))),
  skillDigest: hash(await readFile(join(workspace, '.agents/skills/memsphere/SKILL.md'))),
  // Parent-only paths are never included in the Agent prompt or mounted runtime.
  parentRubric: join(caseRoot, 'evaluation.md'), parentRepository: repository,
  isolation: 'bubblewrap-filesystem-and-pid', modelPolicy: 'existing Codex configuration, no model override'
};
await writeFile(join(trial, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
await writeFile(join(trial, 'setup.log'), setup);
console.log(trial);
