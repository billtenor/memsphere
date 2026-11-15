import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { gitHashObject, gitOutput, runGit } from "../src/git.js";
import { memoryChangeSetSchema, readMemoryChange, validateMemoryChange, withMemoryChangeDetailSnapshot } from "../src/memory/changeset.js";
import { resolveWorkspaceIdentity } from "../src/project/workspace.js";
import { concept, fixture } from "./helpers/embedded-continuation.js";

/** Encode an actual historical v1 record and frozen description, without v2
 * context/blob evidence or bindings. Its bytes must survive v2 continuation. */
async function legacyCheckpoint(f: { home: string; main: string; linked: string; memory: string; changes: string }, body: string) {
  const workspace = await resolveWorkspaceIdentity(), base = await gitOutput(["rev-parse", "HEAD"]);
  const now = new Date().toISOString(), id = "change-legacy-v1";
  const change = memoryChangeSetSchema.parse({ format_version: 1, id, project: "embedded", workspace_key: workspace.key,
    base_revision: base, status: "active", created_at: now, updated_at: now, store_type: "embedded",
    source_worktree: { instance_key: workspace.instanceKey, root: f.linked, repository_root: f.main, memory_path: "memory" },
    targets: [{ operation: "update", reference: "concepts/example", path: "concepts/example.yaml",
      base_digest: await gitOutput(["rev-parse", `${base}:memory/concepts/example.yaml`]), added_revision: base }], scope: [], comments: [] });
  const validation = { base_revision: base, created_at: now, valid: true, issues: [] };
  const content = createHash("sha256").update(JSON.stringify(change.targets)).update("\0concepts/example.yaml\0\0").update(body).digest("hex");
  const description = { format_version: 1, content_digest: content, material: {
    id, project: "embedded", store_type: "embedded", status: "active", base_revision: base,
    source_worktree: change.source_worktree, targets: change.targets, scope: [], validation } };
  const identity = structuredClone(description); identity.material.validation.created_at = "";
  const digest = createHash("sha256").update("memsphere-checkpoint-v1\0").update(JSON.stringify(identity)).digest("hex");
  const directory = join(f.changes, id, "checkpoints", digest), metadata = join(f.changes, id, "change.json");
  await mkdir(join(directory, "memory/concepts"), { recursive: true });
  await writeFile(join(directory, "checkpoint.json"), JSON.stringify(description));
  await writeFile(join(directory, "memory/concepts/example.yaml"), body);
  change.checkpoint = { digest, ...validation }; await writeFile(metadata, JSON.stringify(change));
  await writeFile(join(f.memory, "concepts/example.yaml"), body);
  // The public fixed-checkpoint reader verifies v1's domain and content hashes.
  await withMemoryChangeDetailSnapshot({ home: f.home, project: "embedded", changeId: id, checkpointDigest: digest, use: async snapshot => {
    assert.equal(await readFile(join(snapshot.memoryRoot, "concepts/example.yaml"), "utf8"), body);
  } });
  return { id, digest, directory, metadata };
}

for (const conversion of ["attributes", "clean-filter"] as const) {
  test(`v1 ordinary completion does not invent historical blobs from later ${conversion}`, async () => fixture(async f => {
    const body = conversion === "attributes" ? concept("Base").replaceAll("\n", "\r\n") : concept("Unmerged feature");
    const legacy = await legacyCheckpoint(f, body);
    const metadataBefore = await readFile(legacy.metadata), frozen = await readFile(join(legacy.directory, "checkpoint.json"));
    const rule = conversion === "attributes" ? "text eol=lf" : "filter=collapse";
    if (conversion === "clean-filter") {
      const script = join(f.home, "collapse.cjs"); await writeFile(script, `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(${JSON.stringify(concept("Base"))}));`);
      const command = [process.execPath, script].map(path => `"${path.replaceAll("\\", "/")}"`).join(" ");
      await runGit(["config", "filter.collapse.clean", command]);
    }
    for (const root of [f.main, f.linked]) await writeFile(join(root, ".gitattributes"), `memory/concepts/example.yaml ${rule}\n`);
    const masterBlob = await gitOutput(["rev-parse", "master:memory/concepts/example.yaml"]);
    assert.notEqual(await gitHashObject(Buffer.from(body), f.main), masterBlob);
    assert.equal(await gitHashObject(Buffer.from(body), f.main, "memory/concepts/example.yaml"), masterBlob);
    const current = await readMemoryChange({ home: f.home, project: "embedded", changeId: legacy.id });
    assert.equal(current.status, "active"); assert.equal(current.candidate_revision, undefined);
    assert.deepEqual(await readFile(legacy.metadata), metadataBefore);
    const next = await validateMemoryChange(legacy.id); assert.equal(next.changeId, legacy.id); assert.deepEqual(next.issues, []);
    assert.equal((await readMemoryChange({ home: f.home, project: "embedded", changeId: legacy.id })).status, "active");
    assert.deepEqual((await readdir(f.changes)).filter(id => id.startsWith("change-")), [legacy.id]);
    assert.deepEqual(await readFile(join(legacy.directory, "checkpoint.json")), frozen);
    assert.equal(await readFile(join(legacy.directory, "memory/concepts/example.yaml"), "utf8"), body);
    assert.equal(JSON.parse(await readFile(join(f.changes, legacy.id, "checkpoints", next.checkpointDigest, "checkpoint.json"), "utf8")).format_version, 2);
  }));
}

test("actual raw v1 candidate integration still completes its original record", async () => fixture(async f => {
  const legacy = await legacyCheckpoint(f, concept("Integrated feature"));
  const frozen = await readFile(join(legacy.directory, "checkpoint.json"));
  await runGit(["add", "memory"]); await runGit(["commit", "-m", "legacy feature"]);
  const feature = await gitOutput(["rev-parse", "HEAD"]);
  await runGit(["merge", "--no-ff", feature, "-m", "integrate legacy feature"], { cwd: f.main });
  assert.equal((await readMemoryChange({ home: f.home, project: "embedded", changeId: legacy.id })).status, "completed");
  assert.deepEqual(await readFile(join(legacy.directory, "checkpoint.json")), frozen);
}));
