import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { initializedContextFixture } from "../../helpers/initialized-context.js";
import { ownTestProcess } from "../../helpers/owned-process.js";
import { openContextControl } from "../../../src/project/context-control.js";
import { openBusinessStore } from "../../../src/project/business-stores.js";
import type { GraphProcedureMemory } from "../../../src/memory/ast.js";
import { graphStoreMemorySyntax } from "../../../src/memory/syntax.js";

const exec = promisify(execFile);
const adapterUrl = new URL("../../../src/project/graph-business-artifact.ts", import.meta.url).href;
const worker = `
  import { graphBusinessStores } from ${JSON.stringify(adapterUrl)};
  const [root, runId] = process.argv.slice(1);
  await graphBusinessStores(root).lock(runId, async () => {
    await new Promise(resolve => {
      process.once("message", resolve);
      process.send("locked");
    });
  });
  process.disconnect();
`;

for (const mode of ["normal", "terminated"] as const) test(`graph Store Run lock spans worktrees and releases after ${mode} exit`, { timeout: 30000 }, async t => {
  const f = await initializedContextFixture(t, { "record.json": { type: "object" } });
  await f.createStore();
  await exec("git", ["init", "-b", "master"], { cwd: f.cwd, signal: t.signal });
  await exec("git", ["-c", "user.name=Graph Test", "-c", "user.email=graph@example.invalid", "commit", "--allow-empty", "-m", "Fixture"], { cwd: f.cwd, signal: t.signal });
  const other = join(f.directory, "other-worktree");
  await exec("git", ["worktree", "add", "--detach", other, "HEAD"], { cwd: f.cwd, signal: t.signal });
  const service = (await openContextControl(f.root))!;
  const graph: GraphProcedureMemory = {
    tag: "!procedure", mode: "graph", syntax: graphStoreMemorySyntax, names: ["lock-probe"], defines: ["Writes one value"], goals: [],
    actions: [{ tag: "!action", id: "write", description: "Write", dependencies: [{ tag: "!dependency", from: "START" }],
      artifact: { name: "Record", model: { definedBy: "json-schema/draft-07.json", definition: '{"type":"object"}' }, payload: { contentType: "application/json" }, store: { store_id: "records", operation: "upsert" } } }]
  };
  const start = async () => service.withGraph(async g => {
    const { run, steps } = await g.start({ name: "Lock probe", procedure: graph });
    await g.enter(run.id, steps[0].id);
    return [run.id, steps[0].id] as const;
  });
  const [runId, stepId] = await start();
  const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", worker, f.root, runId], { cwd: other, stdio: ["ignore", "ignore", "inherit", "ipc"] });
  ownTestProcess(child, t.signal, f.beforeCleanup);
  const exited = once(child, "exit");
  const ready = await Promise.race([once(child, "message", { signal: t.signal }).then(r => r[0]), exited.then(r => `exit ${r[0]}`)]);
  assert.equal(ready, "locked");
  const { store } = await openBusinessStore({}, f.root, "records");
  await assert.rejects(service.withGraph(g => g.report(runId, stepId, { text: "{}", writeOptions: { data_id: "held" } })), { code: "LOCK_TIMEOUT" });
  await assert.rejects(service.withGraph(g => g.rewind(runId, stepId, "Change")), { code: "LOCK_TIMEOUT" });
  await assert.rejects(service.withGraph(g => g.abandon(runId)), { code: "LOCK_TIMEOUT" });
  assert.equal(await store.get({}, "held"), undefined);
  const snapshot = await service.withGraph(g => g.snapshot(runId));
  assert.equal(snapshot.steps[0].status, "running");
  const [independent, independentStep] = await start();
  await service.withGraph(g => g.report(independent, independentStep, { text: "{}", writeOptions: { data_id: "independent" } }));
  assert(await store.get({}, "independent"));
  if (mode === "normal") child.send("release"); else child.kill("SIGKILL");
  await exited;
  const rewound = await service.withGraph(g => g.rewind(runId, stepId, "Replace blocked candidate"));
  await assert.rejects(service.withGraph(g => g.retryBusinessStore(runId, stepId)));
  assert.equal(await store.get({}, "held"), undefined);
  await service.withGraph(async g => {
    await g.enter(runId, rewound.replacementStepId);
    const result = await g.report(runId, rewound.replacementStepId, { text: "{}" });
    assert.equal(result.step.status, "done");
  });
});
