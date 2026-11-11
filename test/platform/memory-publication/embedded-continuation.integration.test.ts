import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveWorkspaceIdentity } from "../../../src/project/workspace.js";
import { gitOutput, runGit } from "../../../src/git.js";
import { claimMemoryChange, readMemoryChange, validateMemoryChange, queryActiveEmbeddedChanges, withMemoryChangeDetailSnapshot, createViewMemoryChange } from "../../../src/memory/changeset.js";
import { resolveProjectContext } from "../../../src/project/resolver.js";
import { createGhTransport, discoverPullRequests } from "../../../src/memory/embedded-context.js";
import { EmbeddedChangeAmbiguityError } from "../../../src/memory/embedded-bindings.js";
import { EmbeddedClaimWriteError } from "../../../src/memory/embedded-claim.js";
import { currentMemorySyntax } from "../../../src/memory/syntax.js";
import { readProjectRegistry } from "../../../src/project/registry.js";

const concept = (text: string, name = "example") => `!concept\nsyntax: ${currentMemorySyntax}\nnames: [${name}]\ndefines: [${text}]\n`;
async function fixture(run: (f: { main: string; linked: string; home: string; memory: string; changes: string }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "memsphere-continuation-"));
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME, project: process.env.MEMSPHERE_PROJECT, git: process.env.GIT_CONFIG_GLOBAL };
  try {
    const main = join(root, "main"), linked = join(root, "linked"), home = join(root, "home"), git = join(root, "gitconfig");
    await mkdir(main); await writeFile(git, "[user]\nname = Fixture\nemail = fixture@example.com\n");
    process.env.GIT_CONFIG_GLOBAL = git; process.env.MEMSPHERE_HOME = home; process.env.MEMSPHERE_PROJECT = "embedded";
    await runGit(["init", "-b", "master"], { cwd: main });
    for (const kind of ["concepts", "statements", "procedures", "schemas"]) await mkdir(join(main, "memory", kind), { recursive: true });
    await writeFile(join(main, "memory/concepts/example.yaml"), concept("Base"));
    await runGit(["add", "memory"], { cwd: main }); await runGit(["commit", "-m", "base"], { cwd: main });
    process.chdir(main);
    const projectRoot = join(home, "projects", "embedded");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, "project.json"), JSON.stringify({ format_version: 1, name: "embedded", created_at: "2026-01-01T00:00:00.000Z" }));
    await writeFile(join(projectRoot, "config.json"), JSON.stringify({ store: { type: "embedded", repository_path: main, memory_path: "memory" } }));
    const identity = await resolveWorkspaceIdentity(main);
    await writeFile(join(home, "registry.json"), JSON.stringify({ format_version: 1, projects: { embedded: { root: projectRoot } }, workspaces: { [identity.key]: { primary: "embedded", mounted: [] } } }));
    await runGit(["worktree", "add", "--detach", linked], { cwd: main }); process.chdir(linked);
    const project = (await readProjectRegistry(home)).projects.embedded;
    await run({ main, linked, home, memory: join(linked, "memory"), changes: join(project.root, "changes") });
  } finally {
    process.chdir(previous.cwd);
    for (const [key, value] of [["MEMSPHERE_HOME", previous.home], ["MEMSPHERE_PROJECT", previous.project], ["GIT_CONFIG_GLOBAL", previous.git]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}

test("ordinary Embedded retains its ID and complete baseline across commit, clean validation and detached-to-branch", async () => fixture(async f => {
  const file = join(f.memory, "concepts/example.yaml");
  await writeFile(file, concept("First")); const first = await validateMemoryChange();
  assert.deepEqual(first.issues, []);
  await runGit(["add", "memory"]); await runGit(["commit", "-m", "first"]);
  const clean = await validateMemoryChange(); assert.equal(clean.changeId, first.changeId); assert.equal(clean.baseRevision, first.baseRevision);
  await writeFile(file, concept("Revised")); const revised = await validateMemoryChange(first.changeId);
  assert.equal(revised.changeId, first.changeId); assert.deepEqual(revised.issues, []);
  await runGit(["switch", "-c", "feature"]);
  const branched = await validateMemoryChange(); assert.equal(branched.changeId, first.changeId);
  assert.deepEqual(branched.bindings?.branches, [{ ref: "refs/heads/feature" }]);
  const old = join(f.changes, first.changeId, "checkpoints", first.checkpointDigest, "memory/concepts/example.yaml");
  assert.equal(await readFile(old, "utf8"), concept("First"));
  const change = await readMemoryChange({ home: f.home, project: "embedded", changeId: first.changeId });
  assert.equal(change.status, "active"); assert.equal(change.targets.length, 1);
  assert.deepEqual((await readdir(f.changes)).filter(id => id.startsWith("change-")), [first.changeId]);
}));

test("committed delete restored as untracked original is a zero candidate, not a same-path rename", async () => fixture(async f => {
  const file = join(f.memory, "concepts/example.yaml");
  await rm(file); const first = await validateMemoryChange();
  await runGit(["add", "memory"]); await runGit(["commit", "-m", "delete"]);
  await writeFile(file, concept("Base"));
  const restored = await validateMemoryChange(first.changeId); assert.equal(restored.empty, true);
  const change = await readMemoryChange({ home: f.home, project: "embedded", changeId: first.changeId });
  assert.equal(change.status, "active"); assert.deepEqual(change.targets, []);
  await writeFile(file, concept("Again")); assert.equal((await validateMemoryChange()).changeId, first.changeId);
}));

test("first validation after commit captures submitted Memory and completes after actual master integration", async () => fixture(async f => {
  await runGit(["switch", "-c", "feature"]);
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("Feature"));
  await runGit(["add", "memory"]); await runGit(["commit", "-m", "feature"]);
  const first = await validateMemoryChange(); assert.deepEqual(first.issues, []);
  await runGit(["merge", "--no-ff", "feature", "-m", "integrate"], { cwd: f.main });
  const change = await readMemoryChange({ home: f.home, project: "embedded", changeId: first.changeId });
  assert.equal(change.status, "completed");
  await assert.rejects(validateMemoryChange(first.changeId), /already completed/);
  await assert.rejects(validateMemoryChange(), /no Embedded Memory changes/);
}));

test("active invalid candidate preserves bindings and repairs under the same ID", async () => fixture(async f => {
  const file = join(f.memory, "concepts/example.yaml");
  await writeFile(file, "!concept\nnames: [broken\n");
  const invalid = await validateMemoryChange(); assert(invalid.issues.length);
  await writeFile(file, concept("Fixed")); const fixed = await validateMemoryChange();
  assert.equal(fixed.changeId, invalid.changeId); assert.deepEqual(fixed.issues, []);
}));

test("CRLF attributes compare target Git blobs and recognize actual integration", async () => fixture(async f => {
  await runGit(["switch", "-c", "feature"]);
  await runGit(["config", "core.autocrlf", "false"]);
  await writeFile(join(f.main, ".gitattributes"), "memory/concepts/*.yaml text eol=crlf\n");
  // Keep attributes in both baseline and feature without introducing Memory changes.
  await runGit(["add", ".gitattributes"], { cwd: f.main }); await runGit(["commit", "-m", "attributes"], { cwd: f.main });
  await runGit(["merge", "master"]);
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("Base").replaceAll("\n", "\r\n"));
  await assert.rejects(validateMemoryChange(), /no Embedded Memory changes/);
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("CRLF feature").replaceAll("\n", "\r\n"));
  const changed = await validateMemoryChange();
  await runGit(["add", "memory"]); await runGit(["commit", "-m", "memory"]);
  await runGit(["merge", "feature"], { cwd: f.main });
  assert.equal((await readMemoryChange({ home: f.home, project: "embedded", changeId: changed.changeId })).status, "completed");
}));

async function ghFixture(home: string, prs: number[]) {
  const script = join(home, "gh-fixture.cjs");
  await writeFile(script, `const args=process.argv.slice(2); if(args[0]!=="api"||args[1]!=="--hostname"||args[2]!=="github.com")process.exit(9);
    const endpoint=args.at(-1); const result=endpoint.includes("/pulls?") ? [[],${JSON.stringify(prs.map(number => ({ number, head: { ref: "feature", repo: { full_name: "owner/repo" } }, base: { ref: "master", repo: { full_name: "owner/repo" } } })))}] : {full_name:"owner/repo",fork:false};
    if(endpoint.includes("/pulls?")&&(!args.includes("--paginate")||!args.includes("--slurp")))process.exit(10);
    process.stdout.write(JSON.stringify(result));`);
  return createGhTransport(process.execPath, [script]);
}

test("real gh process discovers later-page PR and supplements the detached/branch record", async () => fixture(async f => {
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("Change"));
  const first = await validateMemoryChange();
  await runGit(["switch", "-c", "feature"]);
  await runGit(["remote", "add", "origin", "https://github.com/owner/repo.git"]);
  await runGit(["config", "push.default", "current"]);
  const unavailable = await validateMemoryChange(undefined, { prTransport: createGhTransport(join(f.home, "missing-gh")) });
  assert.equal(unavailable.changeId, first.changeId); assert.equal(unavailable.prDiscovery?.status, "unknown");
  const result = await validateMemoryChange(undefined, { prTransport: await ghFixture(f.home, [153]) });
  assert.equal(result.changeId, first.changeId);
  assert.deepEqual(result.bindings?.pull_requests, [{ host: "github.com", repository: "owner/repo", number: 153 }]);
  assert.equal(result.bindings?.worktrees.length, 1);
  const multi = await ghFixture(f.home, [153, 154]);
  await assert.rejects(validateMemoryChange(undefined, { prTransport: multi }), EmbeddedChangeAmbiguityError);
  const explicit = await validateMemoryChange(first.changeId, { prTransport: multi });
  assert.equal(explicit.bindings?.pull_requests.length, 2);
  const discovered = await discoverPullRequests(f.linked, "refs/heads/feature", [], multi);
  assert.equal(discovered.discovery.status, "ambiguous");
}));

test("same HEAD worktrees stay separate and switching unrelated branches does not inherit ownership", async () => fixture(async f => {
  const file = join(f.memory, "concepts/example.yaml");
  await runGit(["switch", "-c", "a"]); await writeFile(file, concept("A"));
  const a = await validateMemoryChange();
  await runGit(["switch", "-c", "b"]); await writeFile(file, concept("B"));
  const b = await validateMemoryChange(); assert.notEqual(b.changeId, a.changeId);
  await runGit(["switch", "a"]); assert.equal((await validateMemoryChange()).changeId, a.changeId);
  const another = join(f.home, "another");
  await runGit(["worktree", "add", "--detach", another]); process.chdir(another);
  await writeFile(join(another, "memory/concepts/example.yaml"), concept("Separate"));
  const other = await validateMemoryChange(); assert.notEqual(other.changeId, a.changeId); assert.notEqual(other.changeId, b.changeId);
  const before = await readFile(join(f.changes, b.changeId, "change.json"), "utf8");
  await validateMemoryChange(a.changeId);
  assert.equal(await readFile(join(f.changes, b.changeId, "change.json"), "utf8"), before);
  await assert.rejects(validateMemoryChange(), EmbeddedChangeAmbiguityError);
}));

test("merge master, amend and rebase retain full Memory changes and the same ID", async () => fixture(async f => {
  await runGit(["switch", "-c", "feature"]);
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("Feature"));
  const first = await validateMemoryChange();
  await runGit(["add", "memory"]); await runGit(["commit", "-m", "feature"]);
  await runGit(["commit", "--amend", "-m", "amended"]);
  assert.equal((await validateMemoryChange()).changeId, first.changeId);
  await writeFile(join(f.main, "upstream.txt"), "upstream");
  await runGit(["add", "upstream.txt"], { cwd: f.main }); await runGit(["commit", "-m", "upstream"], { cwd: f.main });
  await runGit(["rebase", "master"]);
  const rebased = await validateMemoryChange(); assert.equal(rebased.changeId, first.changeId); assert.notEqual(rebased.baseRevision, first.baseRevision);
  await runGit(["merge", "master"]); assert.equal((await validateMemoryChange()).changeId, first.changeId);
  await runGit(["merge", "--squash", "feature"], { cwd: f.main }); await runGit(["commit", "-m", "squash"], { cwd: f.main });
  assert.equal((await readMemoryChange({ home: f.home, project: "embedded", changeId: first.changeId })).status, "completed");
}));

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

test("active query ignores corrupt archives and does not reconcile completion", async () => fixture(async f => {
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("Candidate")); const first = await validateMemoryChange();
  await runGit(["add", "memory"]); await runGit(["commit", "-m", "candidate"]);
  await runGit(["merge", await gitOutput(["rev-parse", "HEAD"], f.linked)], { cwd: f.main });
  const { primary, workspace } = await resolveProjectContext({ project: "embedded" });
  const corrupt = join(primary.paths.archiveRoot, "changes", "broken"); await mkdir(corrupt, { recursive: true }); await writeFile(join(corrupt, "change.json"), "bad JSON");
  const before = await readFile(join(f.changes, first.changeId, "change.json"), "utf8");
  const active = await queryActiveEmbeddedChanges(primary, workspace.key);
  assert.equal(active.length, 1); assert.equal(active[0].status, "active");
  assert.equal(await readFile(join(f.changes, first.changeId, "change.json"), "utf8"), before);
}));

async function claimFixture(f: { memory: string; home: string; linked: string }, run: (id: string, destination: string) => Promise<void>) {
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("Changed"));
  await writeFile(join(f.memory, "concepts/second.yaml"), concept("Second", "second"));
  const first = await validateMemoryChange();
  const destination = join(f.home, "claim"); await runGit(["worktree", "add", "--detach", destination]); process.chdir(destination);
  await run(first.changeId, destination);
}

test("claim preflights every file and refuses conflicts before writing the first target", async () => fixture(async f => claimFixture(f, async (id, root) => {
  await writeFile(join(root, "memory/concepts/second.yaml"), concept("User", "second"));
  await assert.rejects(claimMemoryChange({ changeId: id }), /edit conflict/);
  assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("Base"));
  assert.equal((await readMemoryChange({ home: f.home, project: "embedded", changeId: id })).claim, undefined);
})));

for (const userEdit of [false, true]) {
  test(`claim reports partial real writes and ${userEdit ? "preserves subsequent user edits" : "can safely retry"}`, async () => fixture(async f => claimFixture(f, async (id, root) => {
    await assert.rejects(claimMemoryChange({ changeId: id, beforeWrite: async (_, index) => { if (index === 1) throw new Error("injected EIO"); } }), error => {
      assert(error instanceof EmbeddedClaimWriteError); assert.deepEqual(error.details.writtenPaths, ["concepts/example.yaml"]); assert.deepEqual(error.details.pendingPaths, ["concepts/second.yaml"]); assert.equal(error.details.metadataConfirmed, false); return true;
    });
    assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("Changed"));
    assert.equal((await readMemoryChange({ home: f.home, project: "embedded", changeId: id })).claim, undefined);
    if (userEdit) {
      await writeFile(join(root, "memory/concepts/example.yaml"), concept("User"));
      await assert.rejects(claimMemoryChange({ changeId: id }), /edit conflict/);
      assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("User"));
    } else {
      const claimed = await claimMemoryChange({ changeId: id }); assert(claimed.change.claim);
      assert.equal(await readFile(join(root, "memory/concepts/second.yaml"), "utf8"), concept("Second", "second"));
    }
  })));
}

for (const acknowledged of [false, true]) {
  test(`claim all writes then ${acknowledged ? "acknowledgement" : "metadata commit"} fails with accurate state`, async () => fixture(async f => claimFixture(f, async (id, root) => {
    const fail = async () => { throw new Error("metadata boundary"); };
    const pending = claimMemoryChange({ changeId: id, ...(acknowledged ? { afterMetadataCommit: fail } : { beforeMetadataCommit: fail }) });
    if (acknowledged) assert.match((await pending).warnings.join(" "), /confirmed by re-reading/);
    else await assert.rejects(pending, error => { assert(error instanceof EmbeddedClaimWriteError); assert.equal(error.details.writtenPaths.length, 2); assert.deepEqual(error.details.pendingPaths, []); return true; });
    assert.equal(await readFile(join(root, "memory/concepts/second.yaml"), "utf8"), concept("Second", "second"));
    const before = await readMemoryChange({ home: f.home, project: "embedded", changeId: id }); assert.equal(Boolean(before.claim), acknowledged);
    assert((await claimMemoryChange({ changeId: id })).change.claim);
  })));
}

test("claim holds context admission through writes and metadata so validate cannot publish between them", async () => fixture(async f => claimFixture(f, async (id, root) => {
  let resume!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  const claiming = claimMemoryChange({ changeId: id, beforeWrite: async (_, index) => { if (!index) { entered(); await gate; } } });
  await ready;
  try {
    await writeFile(join(root, "memory/concepts/third.yaml"), concept("Third", "third"));
    await assert.rejects(validateMemoryChange(id), /context is being updated/);
    assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("Base"));
  } finally { resume(); }
  assert((await claiming).change.claim);
})));

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

test("rename uses destination attributes and claim preflights both ends before copying", async () => fixture(async f => {
  await writeFile(join(f.main, ".gitattributes"), "memory/concepts/renamed.yaml text eol=crlf\n");
  await runGit(["add", ".gitattributes"], { cwd: f.main }); await runGit(["commit", "-m", "attributes"], { cwd: f.main }); await runGit(["merge", "master"]);
  await rm(join(f.memory, "concepts/example.yaml")); await writeFile(join(f.memory, "concepts/renamed.yaml"), concept("Base").replaceAll("\n", "\r\n"));
  const first = await validateMemoryChange();
  const record = await readMemoryChange({ home: f.home, project: "embedded", changeId: first.changeId });
  assert.equal(record.targets[0]?.operation, "rename");
  const destination = join(f.home, "rename"); await runGit(["worktree", "add", "--detach", destination]); process.chdir(destination);
  await writeFile(join(destination, "memory/concepts/renamed.yaml"), concept("Conflict"));
  await assert.rejects(claimMemoryChange({ changeId: first.changeId }), /edit conflict/);
  assert.equal(await readFile(join(destination, "memory/concepts/example.yaml"), "utf8"), concept("Base"));
  await rm(join(destination, "memory/concepts/renamed.yaml"));
  await claimMemoryChange({ changeId: first.changeId });
  await assert.rejects(readFile(join(destination, "memory/concepts/example.yaml")), { code: "ENOENT" });
  assert.equal(await readFile(join(destination, "memory/concepts/renamed.yaml"), "utf8"), concept("Base").replaceAll("\n", "\r\n"));
}));

test("claim refuses changed conversion context before writing", async () => fixture(async f => claimFixture(f, async (id, root) => {
  await writeFile(join(root, ".gitattributes"), "memory/**/*.yaml text eol=crlf\n");
  await assert.rejects(claimMemoryChange({ changeId: id }), /Git attributes changed/);
  assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("Base"));
})));

test("View uses canonical branch binding and repeated creation reuses that record", async () => fixture(async f => {
  const a = await createViewMemoryChange({ home: f.home, project: "embedded", reference: "concepts/example", actor: { kind: "human", id: "reviewer", name: "Reviewer" } });
  const b = await createViewMemoryChange({ home: f.home, project: "embedded", reference: "concepts/example", actor: { kind: "human", id: "reviewer", name: "Reviewer" } });
  assert.equal(a.id, b.id); assert.deepEqual(a.bindings?.branches, [{ ref: "refs/heads/master" }]);
  const first = await claimMemoryChange({ changeId: a.id }); assert.equal(first.change.id, a.id);
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("View edit"));
  assert.equal((await validateMemoryChange()).changeId, a.id);
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

test("gh real transport propagates nonzero, malformed output and bounded timeout as unknown discovery", async () => fixture(async f => {
  await runGit(["switch", "-c", "feature"]); await runGit(["remote", "add", "origin", "git@github.com:owner/repo.git"]); await runGit(["config", "push.default", "current"]);
  const script = join(f.home, "bad-gh.cjs");
  for (const body of ["process.exit(7)", "process.stdout.write('malformed')"]) {
    await writeFile(script, body);
    assert.equal((await discoverPullRequests(f.linked, "refs/heads/feature", [], createGhTransport(process.execPath, [script]))).discovery.status, "unknown");
  }
  await writeFile(script, "setTimeout(()=>process.stdout.write('{}'),10000)");
  const transport = createGhTransport(process.execPath, [script]);
  await assert.rejects(transport([], f.linked, 40), error => Boolean((error as { killed?: boolean }).killed));
  const bounded = (args: string[], cwd: string) => transport(args, cwd, 40);
  assert.equal((await discoverPullRequests(f.linked, "refs/heads/feature", [], bounded)).discovery.status, "unknown");
}));
