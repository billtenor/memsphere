import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runGit } from "../../../src/git.js";
import { validateMemoryChange, withMemoryChangeDetailSnapshot } from "../../../src/memory/changeset.js";
import { concept, fixture } from "../../helpers/embedded-continuation.js";

for (const mutation of ["head", "master", "branch", "body", "untracked", "attributes"] as const) {
  test(`prepared candidate refuses changed ${mutation} without publishing mixed evidence`, async () => fixture(async f => {
    const file = join(f.memory, "concepts/example.yaml");
    await writeFile(file, concept("First")); const first = await validateMemoryChange();
    const metadata = join(f.changes, first.changeId, "change.json"), before = await readFile(metadata, "utf8");
    await writeFile(file, concept("Next"));
    await assert.rejects(validateMemoryChange(first.changeId, { onPrepared: async () => {
      if (mutation === "head") { await runGit(["add", "memory"]); await runGit(["commit", "-m", "advance"]); }
      if (mutation === "master") { await writeFile(join(f.main, "upstream.txt"), "advance"); await runGit(["add", "."], { cwd: f.main }); await runGit(["commit", "-m", "advance"], { cwd: f.main }); }
      if (mutation === "branch") await runGit(["switch", "-c", "new-branch"]);
      if (mutation === "body") await writeFile(file, concept("Concurrent"));
      if (mutation === "untracked") await writeFile(join(f.memory, "concepts/new.yaml"), concept("New", "new"));
      if (mutation === "attributes") await writeFile(join(f.linked, ".gitattributes"), "memory/**/*.yaml text eol=crlf\n");
    } }), /changed during validation/);
    assert.equal(await readFile(metadata, "utf8"), before);
    assert.equal((await validateMemoryChange(first.changeId)).changeId, first.changeId);
  }));
}

test("two prepared first validations publish only one record without duplicate implicit creation", async () => fixture(async f => {
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("Candidate"));
  let winner: Awaited<ReturnType<typeof validateMemoryChange>> | undefined;
  await assert.rejects(validateMemoryChange(undefined, { onPrepared: async () => { winner = await validateMemoryChange(); } }), /associations changed/);
  assert(winner);
  assert.deepEqual((await readdir(f.changes)).filter(id => id.startsWith("change-")), [winner.changeId]);
  assert.equal((await validateMemoryChange()).changeId, winner.changeId);
}));

test("record metadata changed after preparation is not overwritten even for identical checkpoint evidence", async () => fixture(async f => {
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("Candidate")); const first = await validateMemoryChange();
  const path = join(f.changes, first.changeId, "change.json"); let actual = "";
  await assert.rejects(validateMemoryChange(first.changeId, { onPrepared: async () => {
    const record = JSON.parse(await readFile(path, "utf8")); record.bindings.branches.push({ ref: "refs/heads/concurrent" });
    actual = JSON.stringify(record); await writeFile(path, actual);
  } }), /changed during validation/);
  assert.equal(await readFile(path, "utf8"), actual);
}));

test("v2 checkpoint requires complete frozen blob and attributes evidence", async () => fixture(async f => {
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("Candidate")); const first = await validateMemoryChange();
  const path = join(f.changes, first.changeId, "checkpoints", first.checkpointDigest, "checkpoint.json");
  const original = await readFile(path, "utf8");
  for (const field of ["blob", "attributes"]) {
    const description = JSON.parse(original);
    if (field === "blob") delete description.material.targets[0].candidate_blob_digest;
    else delete description.material.git_context.attributes_fingerprint;
    await writeFile(path, JSON.stringify(description));
    await assert.rejects(withMemoryChangeDetailSnapshot({ home: f.home, project: "embedded", changeId: first.changeId, checkpointDigest: first.checkpointDigest, use: async () => undefined }));
  }
  await writeFile(path, original);
  await withMemoryChangeDetailSnapshot({ home: f.home, project: "embedded", changeId: first.changeId, checkpointDigest: first.checkpointDigest, use: async () => undefined });
}));

test("process exit before publication leaves the old checkpoint and the next process continues the same record", async () => fixture(async f => {
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("First")); const first = await validateMemoryChange();
  const metadata = join(f.changes, first.changeId, "change.json"), before = await readFile(metadata, "utf8");
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("Next"));
  const worker = join(f.home, "before-publication.mts");
  await writeFile(worker, `import {validateMemoryChange} from ${JSON.stringify(new URL("../../../src/memory/changeset.ts", import.meta.url).href)};
    await validateMemoryChange(${JSON.stringify(first.changeId)},{onPrepared:async()=>{process.exit(23)}});`);
  await assert.rejects(promisify(execFile)(process.execPath, ["--import", import.meta.resolve("tsx"), worker], { cwd: f.linked, env: process.env }), { code: 23 });
  assert.equal(await readFile(metadata, "utf8"), before);
  assert.equal((await validateMemoryChange()).changeId, first.changeId);
  assert.deepEqual((await readdir(f.changes)).filter(id => id.startsWith("change-")), [first.changeId]);
}));
