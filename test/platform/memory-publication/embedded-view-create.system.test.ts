import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createViewServer } from "../../../src/commands/view.js";
import { readViewConfig } from "../../../src/config.js";
import { gitOutput, runGit } from "../../../src/git.js";
import { claimMemoryChange, validateMemoryChange } from "../../../src/memory/changeset.js";
import { concept, fixture } from "../../helpers/embedded-continuation.js";

test("View POST reconciles a merged ChangeSet before creating the next round without prior list/detail reads", { timeout: 30_000 }, async () => fixture(async f => {
  process.chdir(f.main);
  const server = createViewServer(await readViewConfig());
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const create = async () => {
      const response = await fetch(`${origin}/api/projects/embedded/changes`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ memoryReference: "concepts/example", operator: { kind: "browser", id: "123e4567-e89b-42d3-a456-426614174000" } }) });
      const payload = await response.json() as { change: { id: string; status: string }; error?: string };
      assert.equal(response.status, 201, JSON.stringify(payload)); return payload.change;
    };
    const first = await create();
    process.chdir(f.linked); await claimMemoryChange({ changeId: first.id });
    await writeFile(join(f.memory, "concepts/example.yaml"), concept("Feature")); await validateMemoryChange(first.id);
    await runGit(["add", "memory"]); await runGit(["commit", "-m", "feature"]);
    const feature = await gitOutput(["rev-parse", "HEAD"]);
    await runGit(["merge", feature], { cwd: f.main });
    const record = join(f.changes, first.id, "change.json");
    assert.equal(JSON.parse(await readFile(record, "utf8")).status, "active");
    process.chdir(f.main);
    const next = await create();
    assert.notEqual(next.id, first.id); assert.equal(next.status, "active");
    assert.equal(JSON.parse(await readFile(record, "utf8")).status, "completed");
    assert((await claimMemoryChange({ changeId: next.id })).change.claim);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}));

for (const empty of [false, true]) {
  test(`View preserves newly added review scope after ${empty ? "empty" : "nonempty"} checkpoint without stale edits`, { timeout: 30_000 }, async () => fixture(async f => {
    await writeFile(join(f.main, "memory/concepts/second.yaml"), concept("Second baseline", "second"));
    await runGit(["add", "memory"], { cwd: f.main }); await runGit(["commit", "-m", "second Memory"], { cwd: f.main });
    await runGit(["merge", "master"]);
    await writeFile(join(f.memory, "concepts/example.yaml"), concept("Candidate")); const first = await validateMemoryChange();
    if (empty) { await writeFile(join(f.memory, "concepts/example.yaml"), concept("Base")); await validateMemoryChange(first.changeId); }
    process.chdir(f.main);
    const server = createViewServer(await readViewConfig()); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/embedded/changes/${first.changeId}`;
      const response = await fetch(`${origin}/memories`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memoryReference: "concepts/second" }) });
      assert.equal(response.status, 200, await response.text());
      const detail = await (await fetch(origin)).json() as any;
      assert.equal(detail.change.scopeCount, 1); assert(detail.change.memoryPaths.includes("concepts/second.yaml"));
      const scoped = detail.targetMemories.find((m: any) => m.reference === "concepts/second");
      assert(scoped); assert.equal(scoped.operation, "unchanged"); assert.match(JSON.stringify(scoped.memory), /Second baseline/);
      assert.deepEqual(detail.targets.map((t: any) => t.path), empty ? [] : ["concepts/example.yaml"]);
      if (empty) assert(!JSON.stringify(detail.targetMemories).includes("Candidate"));
      const comment = await fetch(`${origin}/comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        operator: { kind: "browser", id: "123e4567-e89b-42d3-a456-426614174000" }, memoryReference: "concepts/second", path: "concepts/second.yaml", body: "Review newly selected context" }) });
      assert.equal(comment.status, 201, await comment.text());
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }));
}

test("View returns HTTP 409 with all ambiguity candidates and leaves both records unchanged", { timeout: 30_000 }, async () => fixture(async f => {
  const ids: string[] = [];
  for (const text of ["First", "Second"]) {
    await runGit(["switch", "-c", text.toLowerCase()]);
    await writeFile(join(f.memory, "concepts/example.yaml"), concept(text)); ids.push((await validateMemoryChange()).changeId);
  }
  // Explicit selection accumulates canonical branch evidence, without a registry.
  process.chdir(f.main);
  await writeFile(join(f.main, "memory/concepts/example.yaml"), concept("Canonical candidate"));
  for (const id of ids) await validateMemoryChange(id);
  const before = await Promise.all(ids.map(id => readFile(join(f.changes, id, "change.json"))));
  const server = createViewServer(await readViewConfig()); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/embedded/changes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memoryReference: "concepts/example", operator: { kind: "browser", id: "123e4567-e89b-42d3-a456-426614174000" } }) });
    const payload = await response.json() as any;
    assert.equal(response.status, 409, JSON.stringify(payload)); assert.equal(payload.code, "EMBEDDED_CHANGE_AMBIGUOUS");
    assert.deepEqual(payload.candidates.map((c: any) => c.id).sort(), ids.sort());
    for (const [index, id] of ids.entries()) assert.deepEqual(await readFile(join(f.changes, id, "change.json")), before[index]);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}));
