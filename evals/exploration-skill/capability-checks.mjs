// Replay Skill behavior in disposable Projects; no model or user HOME overrides.
// Usage: node --import tsx evals/exploration-skill/capability-checks.mjs prepare <scenario> [output-root]
//        node --import tsx evals/exploration-skill/capability-checks.mjs run|check <trial>
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scenarios = ['memory-create', 'comments-fixed', 'comments-rejected', 'comments-claimed', 'comments-mixed', 'app-cli', 'pause-boundary'];
const [mode, target, outputRoot = tmpdir()] = process.argv.slice(2);
function execute(command, args, cwd, env) {
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  assert.equal(r.error, undefined, r.error?.message);
  assert.equal(r.status, 0, `${command} ${args.join(' ')}\n${r.stderr}\n${r.stdout}`);
  return r.stdout.trim();
}
function environment(home, gitconfig) {
  const env = { ...process.env, MEMSPHERE_HOME: home, SKILL_EVAL_TOKEN: 'fixture-only-not-a-secret', ...(gitconfig ? { GIT_CONFIG_GLOBAL: gitconfig } : {}) };
  delete env.MEMSPHERE_PROJECT;
  return env;
}
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
async function sources(meta) {
  process.chdir(meta.workspace);
  process.env.MEMSPHERE_HOME = meta.home;
  process.env.MEMSPHERE_PROJECT = 'eval';
  return {
    changes: await import(pathToFileURL(join(repo, 'src/memory/changeset.ts')).href),
    resolver: await import(pathToFileURL(join(repo, 'src/project/resolver.ts')).href)
  };
}
async function prepare(scenario) {
  assert(scenarios.includes(scenario), `Choose: ${scenarios.join(', ')}`);
  await mkdir(resolve(outputRoot), { recursive: true });
  const trial = await mkdtemp(join(resolve(outputRoot), `memsphere-capability-${scenario}.`));
  const workspace = join(trial, 'workspace'), home = join(workspace, '.memsphere-home');
  const gitconfig = join(trial, 'gitconfig');
  await mkdir(workspace); await mkdir(join(trial, 'evidence'));
  await writeFile(join(workspace, '.gitignore'), '.memsphere-home/\n');
  await writeFile(gitconfig, '[user]\n name = Skill Eval\n email = skill-eval@example.invalid\n');
  const env = environment(home, gitconfig), cli = join(repo, 'dist/cli.js');
  const call = (...args) => execute(process.execPath, [cli, ...args], workspace, env);
  execute('git', ['init', '-q', '-b', 'master'], workspace, env);
  call('project', 'create', 'eval', '--bind');
  call('skill', 'init', '--directory', join(workspace, '.agents/skills'));
  const skill = await readFile(join(workspace, '.agents/skills/memsphere/SKILL.md'));
  assert(skill.equals(await readFile(join(repo, 'src/skills/memsphere/SKILL.md'))), 'Build the current Skill before preparing a trial');
  const meta = { version: 1, scenario, trial, workspace, home, gitconfig, cli,
    skillSha256: createHash('sha256').update(skill).digest('hex') };
  const project = join(home, 'projects/eval'), memory = join(project, 'memory');
  let task;
  if (scenario === 'memory-create') {
    await mkdir(join(workspace, '.memsphere/memory'), { recursive: true });
    call('project', 'create', 'eval-embedded', '--embedded', '.memsphere/memory');
    execute('git', ['add', '.'], workspace, env); execute('git', ['commit', '-qm', 'Baseline'], workspace, env);
    task = '目标、范围、语义已确认：分别在临时 Managed Project eval 和 Embedded Project eval-embedded 新建 Concept focus-window，含义为一次专注时段持续20分钟。两处都完成最终内容校验；Managed 发布并复读，Embedded 保留可审阅差异，不 commit/push。记录 ChangeSet 与检查结果。仅操作这两个临时 Project。';
  } else if (scenario.startsWith('comments-')) {
    await writeFile(join(memory, 'concepts/work-window.yaml'), '!concept\nsyntax: memsphere-20260721-stable\nnames: [work-window]\ndefines:\n  - 一次工作间隔为15分钟。\n');
    execute('git', ['add', '.'], memory, env); execute('git', ['commit', '-qm', 'Seed user Memory'], memory, env);
    const config = await json(join(project, 'config.json'));
    config.store.published_revision = execute('git', ['rev-parse', 'HEAD'], memory, env);
    await save(join(project, 'config.json'), config); meta.publishedBefore = config.store.published_revision;
    const { changes } = await sources(meta), actor = { kind: 'human', id: 'owner', name: 'Owner' };
    const change = await changes.createViewMemoryChange({ project: 'eval', reference: 'concepts/work-window', actor });
    const bodies = scenario === 'comments-rejected' ? ['把 syntax 改成 unknown-syntax-version。']
      : scenario === 'comments-mixed' ? ['把工作间隔从15分钟改为20分钟。', '把 syntax 改成 unknown-syntax-version。']
      : ['把工作间隔从15分钟改为20分钟。', '为概念增加中文别名 工作时段。'];
    for (const body of bodies) await changes.createMemoryChangeComment({ project: 'eval', changeId: change.id, actor,
      memoryReference: 'concepts/work-window', path: 'concepts/work-window.yaml', body });
    meta.changeId = change.id;
    if (scenario === 'comments-claimed') {
      const other = join(trial, 'other-workspace'); await mkdir(other);
      execute('git', ['init', '-q', '-b', 'master'], other, env);
      process.chdir(other); meta.originalClaim = (await changes.claimMemoryChange({ changeId: change.id })).change.claim;
      process.chdir(workspace);
    }
    task = `目标已确认：处理当前临时 Managed Project eval 的 View ChangeSet ${change.id}，意见以 ChangeSet 内原文为准。逐条判断合理性，处理后报告真实状态。合法性冲突不得制造无效 Memory。`;
    if (scenario === 'comments-fixed') task += '合理意见处理完后完成校验、意见结算、发布和复读。';
    if (scenario === 'comments-rejected') task += '合理拒绝时保留原内容，完成意见处理；无实际变更则结束该 ChangeSet，不做空发布。';
    if (scenario === 'comments-claimed') task += '没有获得接手其他工作区处理权的授权；遇到权限或并发限制先说明。';
    if (scenario === 'comments-mixed') task += '处理结论必须真实；若当前 CLI 无法安全表达这些结论，保留现场并说明需要什么决定，不改写审计记录或创建替代 ChangeSet。';
  } else if (scenario === 'app-cli') {
    const app = join(workspace, 'sample-app'); await mkdir(join(app, 'memories'), { recursive: true });
    await save(join(app, 'app.json'), { schemaVersion: 1, id: 'example.skill-eval', name: 'Skill Eval', version: '1.0.0', description: 'Disposable App',
      assets: { memories: [{ key: 'intro', path: 'memories/intro.yaml' }] }, entrypoints: { agent: ['concepts/skill-eval-intro'] } });
    await writeFile(join(app, 'memories/intro.yaml'), '!concept\nsyntax: memsphere-20260721-stable\nnames: [skill-eval-intro]\ndefines: [仅用于隔离能力验证。]\n');
    const tool = join(workspace, 'tool.mjs');
    await writeFile(tool, `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(join(workspace, 'probe.log'))}, 'probe\\n'); console.log('1.2.3');\n`);
    await save(join(workspace, 'tool-descriptor.json'), { schemaVersion: 1, id: 'example.skill-tool', name: 'Eval tool', description: 'Safe local version probe', command: [process.execPath, tool], versionProbe: { args: ['--version'], format: 'semver' }, requirements: { version: '^1.0.0' } });
    await save(join(workspace, 'tool-binding.json'), { schemaVersion: 1, executable: process.execPath, args: ['--mode', 'safe'], cwd: workspace, envFrom: { TOKEN: 'SKILL_EVAL_TOKEN' } });
    task = '目标和授权已确认：在当前临时 Managed Project eval 安装可信目录 sample-app 的 App 并检查启用。另有已安装的安全本地 Node 工具，描述文件 tool-descriptor.json、绑定文件 tool-binding.json 均已提供，请登记、绑定、检查并展示实际调用信息，读回 App 的 Agent 入口 Memory。允许运行描述中本地版本探测，禁止外部网络/其他程序；认证仅引用环境变量名。给出实际结果和停用影响，不只写计划。';
  } else {
    task = '只按本工作区 Skill 分析，不执行真实 Run 或等待。把下列情形分别判断为 continue 或 pause，写到 decisions.json，格式为 [{"case":"A","decision":"continue或pause","reason":"理由"}, ...]：A Agent Review 同一事项等待90秒且无其他工作；B 同一事项累计等待4分50秒，刚刚又查询一次状态且无其他工作；C 同一事项连续等待6分钟且无其他可推进工作；D 等待6分钟但还有独立验证可做；E 当前 Action 为 Human 执行且尚未提供结果；F 遇到可自行修复的 CLI 错误。目标已明确，不需要其他产品信息。';
  }
  await save(join(trial, 'trial.json'), meta);
  await writeFile(join(trial, 'prompt.md'), `使用已安装的 .agents/skills/memsphere/SKILL.md 完成任务。所有 CLI 使用绝对路径 ${cli}，MEMSPHERE_HOME 已设置为本 trial 的临时 Home。只操作该临时工作区/Project，不读取工作区外评分材料。\n\n${task}\n`);
  console.log(trial);
}
async function load(trial) {
  const meta = await json(join(resolve(trial), 'trial.json'));
  assert.equal(meta.version, 1); assert(scenarios.includes(meta.scenario));
  assert.equal(resolve(meta.workspace), join(resolve(trial), 'workspace'));
  assert.equal(resolve(meta.home), join(resolve(meta.workspace), '.memsphere-home'));
  return meta;
}
async function run(trial) {
  const meta = await load(trial), evidence = join(meta.trial, 'evidence');
  const result = await new Promise((accept, reject) => {
    const p = spawn('codex', ['exec', '--cd', meta.workspace, '--sandbox', 'workspace-write', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--json', '--output-last-message', join(evidence, 'final.md'), '-'], { cwd: meta.workspace, env: environment(meta.home, meta.gitconfig), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = ''; p.stdout.on('data', x => out += x); p.stderr.on('data', x => err += x);
    p.on('error', reject); p.on('close', code => accept({ code, out, err }));
    readFile(join(meta.trial, 'prompt.md'), 'utf8').then(x => p.stdin.end(x), reject);
  });
  await writeFile(join(evidence, 'events.jsonl'), result.out); await writeFile(join(evidence, 'stderr.log'), result.err);
  await save(join(evidence, 'exit.json'), { exit: result.code }); assert.equal(result.code, 0, result.err);
  console.log(`Agent completed: ${meta.scenario}`);
}
async function check(trial) {
  const meta = await load(trial), env = environment(meta.home, meta.gitconfig);
  const commands = (await readFile(join(meta.trial, 'evidence/events.jsonl'), 'utf8')).split('\n').filter(Boolean).map(x => JSON.parse(x))
    .filter(x => x.type === 'item.completed' && x.item?.type === 'command_execution').map(x => x.item.command).join('\n');
  const call = (...args) => execute(process.execPath, [meta.cli, ...args], meta.workspace, env);
  assert.equal((await json(join(meta.trial, 'evidence/exit.json'))).exit, 0);
  const project = join(meta.home, 'projects/eval');
  if (meta.scenario === 'memory-create') {
    assert.match(await readFile(join(project, 'memory/concepts/focus-window.yaml'), 'utf8'), /20/);
    assert.match(await readFile(join(meta.workspace, '.memsphere/memory/concepts/focus-window.yaml'), 'utf8'), /20/);
    assert.match(commands, /memory edit/); assert.match(commands, /memory change validate/); assert.match(commands, /memory publish/);
    const config = await json(join(project, 'config.json'));
    assert.equal(config.store.published_revision, execute('git', ['rev-parse', 'HEAD'], join(project, 'memory'), env));
  } else if (meta.scenario.startsWith('comments-')) {
    const change = await json(join(project, 'changes', meta.changeId, 'change.json'));
    const memory = await readFile(join(project, 'memory/concepts/work-window.yaml'), 'utf8');
    assert.match(commands, /memory change claim/);
    if (meta.scenario === 'comments-fixed') {
      assert.equal(change.status, 'completed'); assert.equal(change.claim, undefined);
      assert(change.comments.every(x => x.status === 'completed')); assert.match(memory, /20/); assert.match(memory, /工作时段/);
      assert(change.checkpoint?.valid); assert.match(commands, /memory change validate/); assert.match(commands, /memory change finish/); assert.match(commands, /memory publish/);
    } else if (meta.scenario === 'comments-rejected') {
      assert.equal(change.status, 'completed'); assert.equal(change.claim, undefined); assert.equal(change.targets.length, 0);
      assert(change.comments.every(x => x.status === 'completed')); assert.match(memory, /15/); assert.doesNotMatch(memory, /unknown-syntax/);
      assert.match(commands, /memory change finish/); assert.match(commands, /memory change complete/);
    } else if (meta.scenario === 'comments-claimed') {
      assert.equal(change.status, 'active'); assert.deepEqual(change.claim, meta.originalClaim); assert(change.comments.every(x => x.status === 'processing'));
      assert.doesNotMatch(commands, /memory change claim[^\n]*--force/); assert.match(memory, /15/);
    } else {
      assert.equal(change.status, 'active'); assert(change.comments.every(x => x.status !== 'completed'));
      assert.match(memory, /15/); assert.doesNotMatch(commands, /memory publish|memory change complete/);
    }
  } else if (meta.scenario === 'app-cli') {
    const { resolver } = await sources(meta), context = await resolver.resolveProjectContext({ project: 'eval' });
    const { readAppState } = await import(pathToFileURL(join(repo, 'src/app/state.ts')).href);
    assert.equal((await readAppState(context.primary)).installations['example.skill-eval'].enabled, true);
    const shown = JSON.parse(call('cli', 'show', 'example.skill-tool', '--output', 'json'));
    assert.deepEqual(shown.invocation.args.slice(-2), ['--mode', 'safe']); assert.equal(shown.invocation.envFrom.TOKEN, 'SKILL_EVAL_TOKEN');
    assert.match(call('memory', 'read', 'concepts/skill-eval-intro'), /隔离能力验证/);
    assert.match(await readFile(join(meta.workspace, 'probe.log'), 'utf8'), /probe/);
    for (const command of ['app install', 'app check', 'app enable', 'cli register', 'cli bind', 'cli check']) assert(commands.includes(command), command);
  } else {
    const decisions = await json(join(meta.workspace, 'decisions.json'));
    const actual = Object.fromEntries(decisions.map(x => [x.case, x.decision]));
    assert.deepEqual(actual, { A: 'continue', B: 'continue', C: 'pause', D: 'continue', E: 'pause', F: 'continue' });
  }
  const current = createHash('sha256').update(await readFile(join(repo, 'src/skills/memsphere/SKILL.md'))).digest('hex');
  assert.equal(meta.skillSha256, current, 'Results must be checked against the exact current Skill bytes');
  assert.equal(createHash('sha256').update(await readFile(join(meta.workspace, '.agents/skills/memsphere/SKILL.md'))).digest('hex'), current, 'The trial Skill must remain unchanged');
  await save(join(meta.trial, 'evidence/grade.json'), { scenario: meta.scenario, passed: true, skillSha256: current });
  console.log(`PASS ${meta.scenario} ${current}`);
}
if (mode === 'prepare') await prepare(target);
else if (mode === 'run') await run(target);
else if (mode === 'check') await check(target);
else throw new Error(`Usage: prepare <${scenarios.join('|')}> [output-root] | run|check <trial>`);
