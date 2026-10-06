import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { archiveRun, listArchived, restoreRun } from "../src/archive/store.js";
import { agentActivityIds } from "../src/acp/activity.js";
import { prepareRunData, runDataStoreIds, saveRunContent } from "../src/project/run-data.js";
import { opaqueRunData } from "./helpers/run-data.js";

const id = "run-transfer";
const artifactId = `${id}/artifacts/001-report.md`;

async function fixture(legacy = false) {
  const root = await mkdtemp(join(tmpdir(), "memsphere-store-transfer-"));
  const runsRoot = join(root, "runs");
  const archiveRoot = join(root, "archives");
  const data = opaqueRunData();
  prepareRunData({ runsRoot, archiveRoot, manager: data.manager });
  const statePath = legacy ? join(runsRoot, `${id}.json`) : join(runsRoot, id, `${id}.json`);
  await mkdir(legacy ? runsRoot : join(runsRoot, id), { recursive: true });
  await writeFile(statePath, JSON.stringify({ contractVersion: 3, id, name: id, status: "abandoned", procedureName: "test", memoryRoot: "/memory", createdAt: "2026-01-01", updatedAt: "2026-01-01", stack: [], procedureSnapshots: {}, events: [{ at: "2026-01-01", frame: "procedure", stepId: "flow[1]", artifact: { name: "report", type: "string", format: { name: "markdown", options: {} }, storage: "file", path: artifactId, fileName: "001-report.md", contentType: "text/markdown" } }] }));
  await saveRunContent(runsRoot, "artifact", artifactId, "text/markdown", Buffer.from("original readable content\n"), "create");
  return { root, runsRoot, archiveRoot, statePath, data, input: { runsRoot, archiveRoot, id } };
}

async function addAttempt(f: Awaited<ReturnType<typeof fixture>>, status: "queued" | "running" | "submitted" | "failed" | "cancelled" = "submitted") {
  const run = JSON.parse(await readFile(f.statePath, "utf8"));
  run.artifactReviews = [{
    id: "review", stepId: "flow[1]", artifactName: "report", policyId: "artifact_acceptance.unanimous", status: "cancelled", currentRoundId: "round", createdAt: "2026-01-01", updatedAt: "2026-01-01", submissions: [],
    controlPlane: { revision: "test", artifactScope: "test#flow[1]", policyId: "artifact_acceptance.unanimous", bindings: {}, permissions: {} },
    rounds: [{ id: "round", sequence: 1, submissionId: "submission", status: "cancelled", revision: 1, createdAt: "2026-01-01", votes: [], assignments: [{ id: "assignment", actorId: "bot", actorName: "Bot", actorKind: "agent", slotIds: [], permissions: [], binding: "advisory", status: "cancelled", draft: { comments: [] }, attempts: [{ id: "attempt", sequence: 1, status, provider: "codex", createdAt: "2026-01-01" }] }] }]
  }];
  await writeFile(f.statePath, JSON.stringify(run));
  return agentActivityIds({ runsRoot: f.runsRoot, runId: id, reviewId: "review", roundId: "round", assignmentId: "assignment", attemptId: "attempt" });
}

test("Run archive and restore transfer opaque Store content without list or local content paths", async () => {
  const f = await fixture();
  try {
    const archived = await archiveRun(f.input);
    assert.equal(f.data.records.has(f.data.key(`${runDataStoreIds.artifact}/current`, artifactId)), false);
    assert.equal(Buffer.from(f.data.records.get(f.data.key(`${runDataStoreIds.artifact}/archive`, artifactId))!.bytes).toString(), "original readable content\n");
    await assert.rejects(readFile(f.statePath), { code: "ENOENT" });
    assert.deepEqual((await listArchived({ archiveRoot: f.archiveRoot })).map((entry) => entry.id), [id]);
    await archiveRun(f.input);
    assert.equal((await archiveRun(f.input)).archivedAt, archived.archivedAt);
    await restoreRun(f.input);
    await restoreRun(f.input);
    assert.deepEqual(await listArchived({ archiveRoot: f.archiveRoot }), []);
    assert.equal(Buffer.from(f.data.records.get(f.data.key(`${runDataStoreIds.artifact}/current`, artifactId))!.bytes).toString(), "original readable content\n");
    assert.equal(JSON.parse(await readFile(join(f.runsRoot, id, ".archive.json"), "utf8")).archivedAt, archived.archivedAt);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("a failed destination write preserves the source and redo overwrites partial target content", async () => {
  const f = await fixture();
  try {
    f.data.setHook((operation, store, dataId) => {
      if (operation === "create" && store.endsWith("/archive")) {
        f.data.records.set(f.data.key(store, dataId), { contentType: "text/markdown", bytes: Buffer.from("partial") });
        throw new Error("destination failure");
      }
    });
    await assert.rejects(archiveRun(f.input), /destination failure/);
    assert(JSON.parse(await readFile(f.statePath, "utf8")));
    assert.deepEqual(await listArchived({ archiveRoot: f.archiveRoot }), []);
    f.data.setHook(undefined);
    await archiveRun(f.input);
    assert.equal(Buffer.from(f.data.records.get(f.data.key(`${runDataStoreIds.artifact}/archive`, artifactId))!.bytes).toString(), "original readable content\n");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("post-commit cleanup failure retries deletion without copying stale source over the committed target", async () => {
  const f = await fixture();
  try {
    f.data.setHook((operation, store) => { if (operation === "delete" && store.endsWith("/current")) throw new Error("cleanup failure"); });
    await assert.rejects(archiveRun(f.input), /cleanup failure/);
    await assert.rejects(readFile(f.statePath), { code: "ENOENT" });
    f.data.records.get(f.data.key(`${runDataStoreIds.artifact}/current`, artifactId))!.bytes = Buffer.from("stale source");
    f.data.setHook(undefined);
    const before = f.data.calls.length;
    await archiveRun(f.input);
    assert(!f.data.calls.slice(before).some((call) => call.startsWith("update:")));
    assert.equal(Buffer.from(f.data.records.get(f.data.key(`${runDataStoreIds.artifact}/archive`, artifactId))!.bytes).toString(), "original readable content\n");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("legacy layout survives metadata failure and status-move failure before an archive retry", async () => {
  const f = await fixture(true);
  try {
    const path = join(f.archiveRoot, "runs", id);
    await mkdir(join(path, ".archive.json"), { recursive: true });
    await assert.rejects(archiveRun(f.input));
    assert(JSON.parse(await readFile(f.statePath, "utf8")));
    assert.deepEqual(await listArchived({ archiveRoot: f.archiveRoot }), []);
    await rmdir(join(path, ".archive.json"));
    let blocked = false;
    f.data.setHook(async (operation, store) => {
      if (!blocked && ["create", "update"].includes(operation) && store.endsWith("/archive")) { blocked = true; await mkdir(join(path, `${id}.json`)); }
    });
    await assert.rejects(archiveRun(f.input));
    assert.equal(JSON.parse(await readFile(join(path, ".archive.json"), "utf8")).layout, "legacy-file");
    await rmdir(join(path, `${id}.json`));
    f.data.setHook(undefined);
    await archiveRun(f.input);
    await restoreRun(f.input);
    assert(JSON.parse(await readFile(f.statePath, "utf8")));
    await assert.rejects(readFile(join(f.runsRoot, id, ".archive.json")), { code: "ENOENT" });
    assert.deepEqual(await listArchived({ archiveRoot: f.archiveRoot }), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("archive discards old Memory Git placeholders without persisting them or leaving cleanup blocked", async () => {
  const f = await fixture();
  try {
    const run = JSON.parse(await readFile(f.statePath, "utf8"));
    run.memorySnapshot = { path: "memory", files: [] };
    await writeFile(f.statePath, JSON.stringify(run));
    const placeholders = join(f.runsRoot, id, "memory", "concepts", "nested");
    await mkdir(placeholders, { recursive: true });
    await writeFile(join(placeholders, ".gitkeep"), "");
    await archiveRun(f.input);
    await assert.rejects(readFile(join(placeholders, ".gitkeep")), { code: "ENOENT" });
    assert(!f.data.calls.some((call) => call.endsWith("/.gitkeep")));
    await archiveRun(f.input);
    await restoreRun(f.input);
    assert.deepEqual(await listArchived({ archiveRoot: f.archiveRoot }), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

for (const status of ["queued", "running", "submitted", "failed", "cancelled"] as const) {
  for (const present of ["none", "log", "snapshot", "both"]) test(`archive/restore allows optional activity absence without inventing presence flags (${status}, ${present})`, async () => {
    const f = await fixture();
    try {
      const ids = await addAttempt(f, status);
      const includeLog = ["log", "both"].includes(present);
      const includeSnapshot = ["snapshot", "both"].includes(present);
      if (includeLog) await saveRunContent(f.runsRoot, "activityLog", ids.log, "application/x-ndjson", Buffer.from("{\"original\":true}\n"));
      if (includeSnapshot) await saveRunContent(f.runsRoot, "activitySnapshot", ids.snapshot, "application/json", Buffer.from("{\"original\":true}\n"));
      await archiveRun(f.input);
      for (const [kind, dataId, expected] of [["activityLog", ids.log, includeLog], ["activitySnapshot", ids.snapshot, includeSnapshot]] as const) {
        assert.equal(f.data.records.has(f.data.key(`${runDataStoreIds[kind]}/archive`, dataId)), expected);
      }
      await restoreRun(f.input);
      for (const [kind, dataId, expected] of [["activityLog", ids.log, includeLog], ["activitySnapshot", ids.snapshot, includeSnapshot]] as const) {
        assert.equal(f.data.records.has(f.data.key(`${runDataStoreIds[kind]}/current`, dataId)), expected);
      }
      assert.deepEqual(await listArchived({ archiveRoot: f.archiveRoot }), []);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
}

test("activity read errors are not treated as optional absence and leave source status/content intact", async () => {
  const f = await fixture();
  try {
    const ids = await addAttempt(f);
    f.data.setHook((operation, store, dataId) => {
      if (operation === "get" && store.endsWith("/current") && dataId === ids.log) throw Object.assign(new Error("read denied"), { code: "EACCES" });
    });
    await assert.rejects(archiveRun(f.input), { code: "EACCES" });
    assert(JSON.parse(await readFile(f.statePath, "utf8")));
    assert(f.data.records.has(f.data.key(`${runDataStoreIds.artifact}/current`, artifactId)));
    assert.deepEqual(await listArchived({ archiveRoot: f.archiveRoot }), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("an activity file discovered then lost before verification prevents the status switch", async () => {
  const f = await fixture();
  try {
    const ids = await addAttempt(f);
    await saveRunContent(f.runsRoot, "activityLog", ids.log, "application/x-ndjson", Buffer.from("{\"original\":true}\n"));
    let reads = 0;
    f.data.setHook((operation, store, dataId) => {
      if (operation === "get" && store.endsWith("/current") && dataId === ids.log && ++reads === 2) f.data.records.delete(f.data.key(store, dataId));
    });
    await assert.rejects(archiveRun(f.input), /disappeared during transfer/);
    assert(JSON.parse(await readFile(f.statePath, "utf8")));
    assert(f.data.records.has(f.data.key(`${runDataStoreIds.artifact}/current`, artifactId)));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("restore cleanup retains unknown files, removes ghost listing and redo never copies stale archive content back", async () => {
  const f = await fixture();
  try {
    await archiveRun(f.input);
    const archivePath = join(f.archiveRoot, "runs", id);
    const unknown = join(archivePath, "unmanaged.txt");
    await writeFile(unknown, "do not delete");
    await assert.rejects(restoreRun(f.input), /Unmanaged Run file retained/);
    assert.equal(await readFile(unknown, "utf8"), "do not delete");
    assert.deepEqual(await listArchived({ archiveRoot: f.archiveRoot }), []);
    f.data.records.set(f.data.key(`${runDataStoreIds.artifact}/archive`, artifactId), { contentType: "text/markdown", bytes: Buffer.from("stale archive") });
    await rm(unknown);
    const before = f.data.calls.length;
    await restoreRun(f.input);
    assert(!f.data.calls.slice(before).some((call) => call.startsWith("update:") || call.startsWith("create:")));
    assert.equal(Buffer.from(f.data.records.get(f.data.key(`${runDataStoreIds.artifact}/current`, artifactId))!.bytes).toString(), "original readable content\n");
    assert.deepEqual(await listArchived({ archiveRoot: f.archiveRoot }), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
