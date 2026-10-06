import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readConfigAt } from "../src/config.js";
import { archiveRun, restoreRun } from "../src/archive/store.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";
import { startRun, reportRun } from "../src/run/store.js";
import { prepareRunData, readRunContent, runDataModels, runDataStore, runDataStoreIds } from "../src/project/run-data.js";
import { installBundledSystemModels } from "../src/project/system-models.js";
import type { ProjectModelInput } from "../src/project/model-registration.js";

function projectInput(root: string, selected = "a"): ProjectModelInput {
  return { root, modelRegistration: { storeId: selected, stores: {
    a: { factory: "memsphere/filesystem-json", directory: "registrations-a" },
    b: { factory: "memsphere/filesystem-json", directory: "registrations-b" }
  } } };
}

async function install(root: string, selected: string, description: string) {
  const project = projectInput(root, selected);
  await installBundledSystemModels({}, project);
  const path = join(root, `registrations-${selected}`, "system/definitions/raw/memsphere/run/artifact.json");
  const source = ` {"description":${JSON.stringify(description)}}\n`;
  await writeFile(path, source);
  return { project, source };
}

test("Normal Project config selects the persisted raw definition without changing original content bytes", async () => {
  const home = await mkdtemp(join(tmpdir(), "memsphere-run-model-config-"));
  const previousHome = process.env.MEMSPHERE_HOME;
  try {
    process.env.MEMSPHERE_HOME = home;
    const root = join(home, "projects", "demo");
    const { project, source } = await install(root, "a", "Persisted from custom registration storage");
    await mkdir(join(root, "memory"), { recursive: true });
    await writeFile(join(root, "project.json"), JSON.stringify({ format_version: 1, name: "demo", created_at: new Date().toISOString() }));
    await writeFile(join(root, "config.json"), JSON.stringify({ store: { type: "managed", branch: "master", published_revision: "test" }, modelRegistration: project.modelRegistration }));
    await writeFile(join(home, "registry.json"), JSON.stringify({ format_version: 1, projects: { demo: { root } }, workspaces: {} }));
    const config = await readConfigAt(join(root, "config.json"));
    // Root-only access must preserve the assembly prepared by readConfigAt.
    const manager = prepareRunData({ runsRoot: config.runsRoot, archiveRoot: config.archiveRoot });
    const model = await manager.getModel({}, runDataModels.artifact);
    assert.deepEqual(model.definition, JSON.parse(source));
    assert.equal((await manager.getRuntime({}, runDataModels.artifact)).descriptor.root.description, "Persisted from custom registration storage");
    assert.equal(await manager.getRuntime({}, runDataModels.artifact), await manager.getRuntime({}, runDataModels.artifact));
  } finally {
    if (previousHome === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("Changing Project model storage replaces both current and archive assembly while other Projects stay isolated", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-run-model-switch-"));
  try {
    const a = await install(root, "a", "first definition");
    const b = await install(root, "b", "second definition");
    const roots = { runsRoot: join(root, "runs"), archiveRoot: join(root, "archives") };
    const first = prepareRunData({ ...roots, project: a.project });
    assert.equal(prepareRunData({ ...roots, project: structuredClone(a.project) }), first);
    const firstArchived = await runDataStore(join(roots.archiveRoot, "runs"), "artifact");
    const second = prepareRunData({ ...roots, project: b.project });
    assert.notEqual(second, first);
    assert.deepEqual((await first.getModel({}, runDataModels.artifact)).definition, { description: "first definition" });
    assert.deepEqual((await second.getModel({}, runDataModels.artifact)).definition, { description: "second definition" });
    assert.equal(prepareRunData(roots), second);
    assert.notEqual(await runDataStore(join(roots.archiveRoot, "runs"), "artifact"), firstArchived);
    assert.equal(await runDataStore(join(roots.archiveRoot, "runs"), "artifact"), await second.getStore({}, `${runDataStoreIds.artifact}/archive`));
    const otherRoot = join(root, "other");
    const other = await install(otherRoot, "a", "other Project");
    const third = prepareRunData({ runsRoot: join(otherRoot, "runs"), archiveRoot: join(otherRoot, "archives"), project: other.project });
    assert.notEqual(third, second);
    assert.deepEqual((await third.getModel({}, runDataModels.artifact)).definition, { description: "other Project" });
    assert.deepEqual((await second.getModel({}, runDataModels.artifact)).definition, { description: "second definition" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Archive transfer retains the configured Project model manager and round-trips raw Run content", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-archive-models-"));
  try {
    const { project } = await install(root, "a", "archive persistent definition");
    const roots = { runsRoot: join(root, "runs"), archiveRoot: join(root, "archives") };
    const memoryRoot = join(root, "memory");
    await mkdir(join(memoryRoot, "procedures"), { recursive: true });
    await writeFile(join(memoryRoot, "procedures/probe.yaml"), `!procedure\nsyntax: ${currentMemorySyntax}\nnames: [probe]\nflow:\n  - !action\n    action: Write.\n    artifact: !artifact\n      name: report\n      format: markdown\n`);
    const manager = prepareRunData({ ...roots, project });
    const run = await startRun({ name: "Persisted models archive", memoryRoot, runsRoot: roots.runsRoot, procedureName: "probe" });
    const done = await reportRun({ runsRoot: roots.runsRoot, runId: run.id, artifact: { kind: "inline", value: "# 原始内容\n\nKeep these bytes.\n" } });
    assert.equal(done.status, "done");
    const before = await readFile(join(roots.runsRoot, run.id, `${run.id}.json`));
    await archiveRun({ ...roots, id: run.id });
    assert.equal(prepareRunData(roots), manager);
    assert.deepEqual((await manager.getModel({}, runDataModels.artifact)).definition, { description: "archive persistent definition" });
    await restoreRun({ ...roots, id: run.id });
    assert.equal(prepareRunData(roots), manager);
    assert.deepEqual(await readFile(join(roots.runsRoot, run.id, `${run.id}.json`)), before);
    const artifact = done.events.find(event => event.artifact)?.artifact;
    assert.ok(artifact?.path);
    assert.equal((await readRunContent(roots.runsRoot, "artifact", artifact.path))!.toString(), "# 原始内容\n\nKeep these bytes.\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("A Project without installed system models refuses explicit model access instead of using bundled definitions", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-run-model-uninitialized-"));
  try {
    await writeFile(join(root, "project.json"), JSON.stringify({ format_version: 1, name: "old", created_at: new Date().toISOString() }));
    await writeFile(join(root, "config.json"), JSON.stringify({ store: { type: "managed", branch: "master", published_revision: "old" } }));
    const roots = { runsRoot: join(root, "runs"), archiveRoot: join(root, "archives") };
    const manager = prepareRunData(roots);
    await assert.rejects(manager.getModel({}, runDataModels.artifact), /No model binding|Model not found/);
    await assert.rejects(manager.getRuntime({}, runDataModels.artifact), /No model binding|Model not found/);
    await assert.rejects(readFile(join(root, "models/registrations/initialized.json")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Damaged persisted raw definitions fail model access while Run content Stores preserve arbitrary bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-run-model-damaged-"));
  try {
    const project = projectInput(root, "a");
    await installBundledSystemModels({}, project);
    await writeFile(join(root, "registrations-a/system/definitions/raw/memsphere/run/artifact.json"), '{"unsupported":true}');
    const roots = { runsRoot: join(root, "runs"), archiveRoot: join(root, "archives") };
    const manager = prepareRunData({ ...roots, project });
    await assert.rejects(manager.getRuntime({}, runDataModels.artifact), /Unsupported raw model definition property/);
    await assert.rejects(manager.getModel({}, runDataModels.artifact), /Unsupported raw model definition property/);
    const store = await runDataStore(roots.runsRoot, "artifact");
    const { bytesContent, readAll } = await import("../src/data/extensions/shared/payload.js");
    const bytes = Buffer.from([0, 255, 195, 10, 13, 127]);
    await store.create({}, { id: "content.bin", model: runDataModels.artifact, payload: { contentType: "application/octet-stream", content: bytesContent(bytes) } });
    const stored = await store.get({}, "content.bin");
    assert.deepEqual(Buffer.from(await readAll({}, stored!.data.payload.content)), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});
