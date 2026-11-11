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
