import assert from "node:assert/strict";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { atomicWriteJson } from "../src/persistence.js";
import { checkpointRecordToken, publishCheckpoint, withCheckpointRecordLock } from "../src/memory/checkpoint-publication.js";
import { addMemoryChangeScope, createMemoryChangeComment, publishMemoryChange, readMemoryChange, validateMemoryChange } from "../src/memory/changeset.js";
import { changeShowFixture } from "./helpers/change-show.js";
import { processGates } from "./fixtures/process-gates.mjs";

test("Managed publish rollback preserves competing checkpoint and candidate metadata", { timeout: 120_000 }, async t => {
  const f = await changeShowFixture(t);
  const root = join(f.projectRoot, "memory"), runtime = join(f.projectRoot, ".runtime");
  const common = { home: f.home, project: "project", changeId: f.edit.change.id };
  const actor = { kind: "human" as const, id: "owner", name: "Owner" };
  const comment = { ...common, actor, memoryReference: "concepts/existing", path: "concepts/existing.yaml" };
  await addMemoryChangeScope({ ...common, reference: "concepts/scope-only" });
  await createMemoryChangeComment({ ...comment, body: "Retain this pre-existing comment" });
  const d0 = f.checkpoint.checkpointDigest;
  const oldRecord = await readMemoryChange(common);
  const oldDirectory = join(f.root, "old-checkpoint");
  await cp(f.versionRoot(d0), oldDirectory, { recursive: true });

  // Prepare a genuine validated result through the application, then restore
  // the earlier fixture boundary so its final commit can race with publication.
  await writeFile(f.candidate, (await readFile(f.candidate, "utf8")).replace("Pinned content", "Concurrent content"));
  const next = await validateMemoryChange(f.edit.change.id);
  assert.deepEqual(next.issues, []);
  const d1 = next.checkpointDigest;
  assert.notEqual(d1, d0);
  f.setDigest(d1);
  const expectedViews = await f.snapshot();
  const nextRecord = await readMemoryChange(common);
  const prepared = join(f.root, "validated-checkpoint");
  await cp(f.versionRoot(d1), prepared, { recursive: true });
  const description = JSON.parse(await readFile(join(prepared, "checkpoint.json"), "utf8"));
  await withCheckpointRecordLock(runtime, f.edit.change.id, async () => {
    await cp(oldDirectory, f.versionRoot(d0), { recursive: true });
    await rm(f.versionRoot(d1), { recursive: true });
    await atomicWriteJson(f.metadata, oldRecord);
  });
  const publishPrepared = () => publishCheckpoint({
    runtimeRoot: runtime, changeId: f.edit.change.id, checkpointsRoot: join(f.projectRoot, "changes", f.edit.change.id, "checkpoints"),
    digest: d1, candidateRoot: join(prepared, "memory"), description, expectedToken: checkpointRecordToken(oldRecord),
    readCurrent: async () => { const current = await readMemoryChange(common); return { token: checkpointRecordToken(current), digest: current.checkpoint?.digest }; },
    verify: async directory => JSON.parse(await readFile(join(directory, "checkpoint.json"), "utf8")),
    commit: async () => atomicWriteJson(f.metadata, nextRecord)
  });

  const gates = await processGates(t.signal);
  const hookProgram = join(f.root, "publication-hook.mjs"), hook = join(root, ".git/hooks/pre-commit");
  const shellQuote = (value: string) => "'" + value.replaceAll("\\", "/").replaceAll("'", "'\\''") + "'";
  await writeFile(hookProgram, `import {processGate} from ${JSON.stringify(new URL("./fixtures/process-gates.mjs", import.meta.url).href)};
await processGate(${gates.endpoint}, 'publish', 'commit-entered');
await processGate(${gates.endpoint}, 'wait', 'fail-commit');
console.error('controlled publish commit failure'); process.exit(1);
`);
  await mkdir(join(root, ".git/hooks"), { recursive: true });
  await writeFile(hook, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(hookProgram)}\n`, { mode: 0o700 });
  try {
    await t.test("a failed publish cannot overwrite checkpoint, scope or Comment writers", async () => {
      const publishing = publishMemoryChange(f.edit.change.id).then(() => undefined, error => error as Error);
      let checkpointError: unknown, scopeError: unknown, commentError: unknown, validationError: unknown;
      let failure: Error | undefined;
      try {
        await Promise.race([gates.wait("commit-entered"), publishing.then(error => { throw error ?? new Error("Publish ended before the Git barrier"); })]);
        checkpointError = await publishPrepared().then(() => undefined, error => error);
        scopeError = await addMemoryChangeScope({ ...common, reference: "concepts/late-delete" }).then(() => undefined, error => error);
        commentError = await createMemoryChangeComment({ ...comment, body: "Concurrent comment" }).then(() => undefined, error => error);
        validationError = await validateMemoryChange(f.edit.change.id).then(() => undefined, error => error);
      } finally {
        gates.publish("fail-commit");
        failure = await publishing;
      }
      assert.match(failure?.message ?? "unexpected publication success", /controlled publish commit failure/);
      assert.equal((scopeError as { code?: string })?.code, "CHANGESET_WRITE_BUSY");
      assert.equal((commentError as { code?: string })?.code, "CHANGESET_WRITE_BUSY");
      assert.equal((validationError as { code?: string })?.code, "MEMORY_PUBLISH_BUSY");
      assert.equal((checkpointError as { code?: string })?.code, "CHANGESET_WRITE_BUSY");
      await publishPrepared(); // Retry only after the failed publish released its claim.
      assert.deepEqual(await readMemoryChange(common), nextRecord);
      assert.deepEqual(await f.snapshot(), expectedViews);
      await assert.rejects(readFile(join(f.versionRoot(d0), "checkpoint.json")), { code: "ENOENT" });
    });
    await t.test("later publish rollback retains the newer complete version after old-version cleanup", async () => {
      // The minimal fixture has empty kind directories, which Git clean removes.
      // Restore those fixture prerequisites before exercising another publish.
      await mkdir(join(root, "procedures"), { recursive: true });
      await mkdir(join(root, "schemas"), { recursive: true });
      await assert.rejects(publishMemoryChange(f.edit.change.id), /controlled publish commit failure/);
      assert.deepEqual(await readMemoryChange(common), nextRecord);
      assert.deepEqual(await f.snapshot(), expectedViews);
      await assert.rejects(readFile(join(f.versionRoot(d0), "checkpoint.json")), { code: "ENOENT" });
    });
  } finally {
    gates.publish("fail-commit");
    await gates.close();
    await rm(hook, { force: true });
  }
});
