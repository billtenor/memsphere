import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentActivityRecorder, agentActivityIds, readAgentActivitySnapshot } from "../src/acp/activity.js";
import { exportRunArtifact } from "../src/commands/run.js";
import { RunMemoryProvider, runMemoryFiles } from "../src/memory/run-provider.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";
import { prepareRunData, readRunContent, runDataModels, runDataStore, saveRunContent } from "../src/project/run-data.js";
import { currentSchemaFinalization, enterSchema, readRun, reportRun, startRun, type RunState } from "../src/run/store.js";
import { opaqueRunData } from "./helpers/run-data.js";

function state(): RunState {
  return { contractVersion: 3, id: "run-access", name: "Access", status: "running", procedureName: "test", memoryRoot: "/memory", createdAt: "2026-01-01", updatedAt: "2026-01-01", procedureSnapshots: {}, events: [], stack: [{ type: "procedure", memoryName: "test", index: 0, steps: [{ id: "flow[1]", kind: "action", instruction: "write", artifact: "report", type: "string", format: { name: "markdown", options: {} } }] }] };
}

test("Run snapshot excludes Git placeholders, preserves source files and reports/exports via opaque Stores", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-run-snapshot-content-"));
  try {
    const memoryRoot = join(root, "memory");
    const runsRoot = join(root, "runs");
    await mkdir(join(memoryRoot, "procedures"), { recursive: true });
    await mkdir(join(memoryRoot, "concepts"));
    await writeFile(join(memoryRoot, "concepts", ".gitkeep"), "");
    await writeFile(join(memoryRoot, "procedures", ".gitkeep"), "");
    const procedure = `!procedure\nsyntax: ${currentMemorySyntax}\nnames: [probe]\nflow:\n  - !action\n    action: Write report.\n    artifact: !artifact\n      name: report\n      format: markdown\n`;
    await writeFile(join(memoryRoot, "procedures", "arbitrary.yaml"), procedure);
    const data = opaqueRunData();
    prepareRunData({ runsRoot, archiveRoot: join(root, "archive"), manager: data.manager });
    const run = await startRun({ name: "Snapshot probe", memoryRoot, memorySnapshotRoot: memoryRoot, runsRoot, procedureName: "probe" });
    assert.deepEqual(run.memorySnapshot?.files, [`${run.id}/memory/procedures/arbitrary.yaml`]);
    assert.equal(await readFile(join(memoryRoot, "concepts", ".gitkeep"), "utf8"), "");
    assert.equal(await readFile(join(memoryRoot, "procedures", "arbitrary.yaml"), "utf8"), procedure);
    assert(!data.calls.some((call) => call.endsWith("/.gitkeep")));
    const local = join(root, "report.md");
    await writeFile(local, "# Readable report\n\nOriginal bytes.\n");
    const reported = await reportRun({ runsRoot, runId: run.id, artifact: { kind: "file", path: local } });
    assert.equal(reported.status, "done");
    const copy = join(root, "exported.md");
    await exportRunArtifact(runsRoot, reported, "probe#flow[1]", copy);
    assert.equal(await readFile(copy, "utf8"), await readFile(local, "utf8"));
    await assert.rejects(readFile(join(runsRoot, reported.events[0].artifact.path!)), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Schema finalization exports an opaque middle Artifact, retains progress on invalid report and accepts the edited local copy", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-schema-store-export-"));
  try {
    const memoryRoot = join(root, "memory");
    const runsRoot = join(root, "runs");
    await mkdir(join(memoryRoot, "procedures"), { recursive: true });
    await writeFile(join(memoryRoot, "procedures", "schema.yaml"), `!procedure\nsyntax: ${currentMemorySyntax}\nnames: [probe]\nflow:\n  - !action\n    action: Write delivery.\n    artifact: !artifact\n      name: delivery\n      type: object\n      format: { name: markdown, layout: outline }\n      schema: !schema\n        fields: [summary]\n`);
    const data = opaqueRunData();
    prepareRunData({ runsRoot, archiveRoot: join(root, "archive"), manager: data.manager });
    const started = await startRun({ name: "Schema probe", memoryRoot, runsRoot, procedureName: "probe" });
    await enterSchema({ memoryRoot, runsRoot, runId: started.id });
    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Delivery" } });
    const middle = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "ready" } });
    const finalization = currentSchemaFinalization(middle);
    assert(finalization);
    assert(!finalization.draft.path.includes("/drafts/"));
    const workingCopy = join(root, "working-copy.md");
    const persistedBeforeExport = await readRun(runsRoot, started.id);
    await exportRunArtifact(runsRoot, middle, "probe#flow[1]", workingCopy);
    const original = await readFile(workingCopy, "utf8");
    assert.match(original, /ready/);
    assert.deepEqual(await readRun(runsRoot, started.id), persistedBeforeExport);
    await writeFile(workingCopy, "# Missing the required summary\n");
    await assert.rejects(reportRun({ runsRoot, runId: started.id, artifact: { kind: "file", path: workingCopy } }));
    assert(currentSchemaFinalization(await readRun(runsRoot, started.id)));
    await writeFile(workingCopy, original.replace("ready", "edited locally"));
    const done = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "file", path: workingCopy } });
    assert.equal(done.status, "done");
    const exported = join(root, "accepted.md");
    await exportRunArtifact(runsRoot, done, "probe#flow[1]", exported);
    assert.match(await readFile(exported, "utf8"), /edited locally/);
    assert.equal((await readRunContent(runsRoot, "artifact", finalization.draft.path))?.toString(), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Project host caches eight isolated model/area Stores and preserves raw filesystem bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-run-host-"));
  try {
    const first = { runsRoot: join(root, "a", "runs"), archiveRoot: join(root, "a", "archives") };
    const second = { runsRoot: join(root, "b", "runs"), archiveRoot: join(root, "b", "archives") };
    const manager = prepareRunData(first);
    assert.equal(prepareRunData(first), manager);
    assert.notEqual(prepareRunData(second), manager);
    const stores = await Promise.all(Object.values(runDataModels).flatMap((model) => ["current", "archive"].map((area) => manager.getStore({}, `${model}/${area}`))));
    assert.equal(new Set(stores).size, 8);
    assert.equal(await runDataStore(first.runsRoot, "artifact"), stores[0]);
    assert.equal(await runDataStore(join(first.archiveRoot, "runs"), "artifact"), stores[1]);
    const id = "run-access/agent-activity/review/round/assignment/attempt.acp.jsonl";
    await saveRunContent(first.runsRoot, "activityLog", id, "application/x-ndjson", Buffer.from("{\"raw\":true}\n"));
    assert.equal((await readFile(join(first.runsRoot, id))).toString(), "{\"raw\":true}\n");
    assert.equal((await readRunContent(first.runsRoot, "activityLog", id))?.toString(), "{\"raw\":true}\n");
    assert.equal(await readRunContent(second.runsRoot, "activityLog", id), undefined);
    assert.equal(await readRunContent(join(first.archiveRoot, "runs"), "activityLog", id), undefined);
    assert.equal((await manager.getRuntime({}, runDataModels.artifact)).descriptor.id, runDataModels.artifact);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Run Memory reads noncanonical filenames from a manifest and opaque content, without scanning storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-run-provider-"));
  try {
    const data = opaqueRunData();
    prepareRunData({ runsRoot: root, archiveRoot: join(root, "archive"), manager: data.manager });
    const run = state();
    run.memorySnapshot = { path: "memory", files: [] };
    for (const [kind, tag] of [["concepts", "concept"], ["statements", "statement"], ["procedures", "procedure"], ["schemas", "schema"]]) {
      const id = `${run.id}/memory/${kind}/nested/not-the-name.yaml`;
      run.memorySnapshot.files!.push(id);
      const extra = tag === "procedure" ? "flow: []\n" : tag === "schema" ? "fields: [example]\n" : tag === "statement" ? "asserts: [Keep the content.]\n" : "";
      await saveRunContent(root, "memory", id, "application/yaml", Buffer.from(`!${tag}\nsyntax: ${currentMemorySyntax}\nnames: [${tag}-model]\n${extra}`));
    }
    const provider = new RunMemoryProvider(root, run);
    const descriptors = await provider.list();
    assert.equal(descriptors.length, 4);
    for (const descriptor of descriptors) assert.deepEqual((await provider.read(descriptor.id)).names, descriptor.names);
    assert.equal((await provider.list({ kind: "schemas" })).length, 1);
    run.memorySnapshot.files!.push(run.memorySnapshot.files![0]);
    assert.throws(() => runMemoryFiles(run), /Duplicate/);
    run.memorySnapshot.files = ["run-access/memory/concepts/../escape.yaml"];
    assert.throws(() => runMemoryFiles(run), /Invalid/);
    delete run.memorySnapshot.files;
    assert.throws(() => runMemoryFiles(run), /backfill-run-memory-manifest/);
    assert.equal(await readRunContent(root, "artifact", "run-access/artifacts/missing.md"), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Artifact export selects the existing event, protects managed roots and force replaces a hard-linked working copy", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-run-export-"));
  try {
    const runsRoot = join(root, "runs");
    const data = opaqueRunData();
    prepareRunData({ runsRoot, archiveRoot: join(root, "archives"), manager: data.manager });
    const run = state();
    const id = `${run.id}/artifacts/report.md`;
    run.events.push({ at: "2026-01-01", frame: "test", stepId: "flow[1]", artifact: { name: "report", type: "string", format: { name: "markdown", options: {} }, storage: "file", path: id } });
    await saveRunContent(runsRoot, "artifact", id, "text/markdown", Buffer.from("fresh candidate\n"));
    const before = JSON.stringify(run);
    const target = join(root, "copy.md");
    await exportRunArtifact(runsRoot, run, "test#flow[1]", target);
    assert.equal(await readFile(target, "utf8"), "fresh candidate\n");
    await assert.rejects(exportRunArtifact(runsRoot, run, "test#flow[1]", target), { code: "EEXIST" });
    const frozen = join(root, "frozen.md");
    await writeFile(frozen, "immutable\n");
    await rm(target);
    await link(frozen, target);
    await exportRunArtifact(runsRoot, run, "test#flow[1]", target, true);
    assert.equal(await readFile(frozen, "utf8"), "immutable\n");
    assert.equal(await readFile(target, "utf8"), "fresh candidate\n");
    await mkdir(runsRoot);
    await assert.rejects(exportRunArtifact(runsRoot, run, "test#flow[1]", join(runsRoot, "copy.md")), /outside managed/);
    assert.equal(JSON.stringify(run), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const persisted of ["zero", "complete", "partial", "malformed"] as const) test(`Activity failure rebuilds only saved records (${persisted}) without replaying failed batches`, async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-run-log-failure-"));
  try {
    const data = opaqueRunData();
    prepareRunData({ runsRoot: root, archiveRoot: join(root, "archive"), manager: data.manager });
    const location = { runsRoot: root, runId: "run-access", reviewId: "review", roundId: "round", assignmentId: "assignment", attemptId: "attempt" };
    const ids = agentActivityIds(location);
    const errors: unknown[] = [];
    const recorder = new AgentActivityRecorder({ ...location, workspaceRoot: root, onError: (error) => errors.push(error) });
    recorder.recordLifecycle("running", "saved first");
    await recorder.flush();
    let failed = false;
    data.setHook((operation, store, id) => {
      if (failed || operation !== "append") return;
      failed = true;
      const record = data.records.get(data.key(store, id))!;
      const saved = `${JSON.stringify({ version: 1, recordedAt: "2026-01-01", lifecycle: { status: "running", title: "persisted subset" } })}\n`;
      if (persisted === "complete") record.bytes = Buffer.concat([record.bytes, Buffer.from(saved)]);
      if (persisted === "partial") record.bytes = Buffer.concat([record.bytes, Buffer.from("{\"version\":")]);
      if (persisted === "malformed") record.bytes = Buffer.concat([record.bytes, Buffer.from("not JSON\n")]);
      throw new Error("partial transport failure");
    });
    recorder.recordLifecycle("running", "must not become a ghost");
    await recorder.flush();
    data.setHook(undefined);
    // A flush with no new raw events must publish only what the actual source contains.
    await recorder.close();
    assert.equal(errors.length, 1);
    const raw = await readRunContent(root, "activityLog", ids.log);
    assert(!raw?.toString().includes("must not become a ghost"));
    if (persisted === "malformed") await assert.rejects(readAgentActivitySnapshot(location), /invalid Agent Activity JSONL/);
    else {
      const snapshot = await readAgentActivitySnapshot(location);
      assert(!snapshot.events.some((event) => event.title === "must not become a ghost"));
      assert.equal(snapshot.events.some((event) => event.title === "persisted subset"), persisted === "complete");
      assert.equal(snapshot.events[0]?.title, "saved first");
    }
    assert.equal(data.calls.filter((call) => call.startsWith("append:")).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
