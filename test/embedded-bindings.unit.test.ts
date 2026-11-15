import assert from "node:assert/strict";
import test from "node:test";
import { mergeEmbeddedBindings, selectEmbeddedChange, EmbeddedChangeAmbiguityError, type BindingContext } from "../src/memory/embedded-bindings.js";
import { githubRepository, remoteHeadRef } from "../src/memory/embedded-context.js";

const context: BindingContext = { repositoryKey: "repo", instanceKey: "worktree", branch: "refs/heads/feature", pullRequests: [], root: "/worktree", instanceGeneration: "generation-1" };
const record = (id: string, binding: BindingContext) => ({ id, workspace_key: "repo", status: "active", targets: [], bindings: mergeEmbeddedBindings(undefined, binding) });

test("cross-layer matches list both records; explicit choice preserves other associations", () => {
  const pr = { host: "github.com", repository: "owner/repo", number: 153 };
  const branch = record("branch", context), pull = record("pr", { ...context, branch: "refs/heads/other", instanceKey: "elsewhere", pullRequests: [pr] });
  assert.throws(() => selectEmbeddedChange([branch, pull], { ...context, pullRequests: [pr] }), error => {
    assert(error instanceof EmbeddedChangeAmbiguityError); assert.deepEqual(error.candidates.map(c => c.id), ["branch", "pr"]); return true;
  });
  const before = structuredClone(pull);
  assert.equal(selectEmbeddedChange([branch, pull], context, "branch"), branch);
  assert.deepEqual(pull, before);
  assert.equal(selectEmbeddedChange([{ ...branch, status: "completed" }], context), undefined);
  assert.equal(selectEmbeddedChange([{ ...branch, workspace_key: "other" }], context), undefined);
});

test("detached fallback and branch upgrade differ from switching unrelated named branches", () => {
  const detached = record("detached", { ...context, branch: null });
  assert.equal(selectEmbeddedChange([detached], context), detached);
  const named = record("named", context);
  assert.equal(selectEmbeddedChange([named], { ...context, branch: "refs/heads/new" }), undefined);
  assert.throws(() => selectEmbeddedChange([{ id: "legacy", workspace_key: "repo", status: "active", targets: [], source_worktree: { instance_key: "worktree", root: context.root } }], context), /--change/);
  const recycled = { id: "legacy", workspace_key: "repo", status: "active", targets: [], source_worktree: { instance_key: "worktree", root: "/old-root" } };
  assert.equal(selectEmbeddedChange([recycled], { ...context, root: "/new-root" }), undefined);
  assert.throws(() => selectEmbeddedChange([recycled], { ...context, root: "/old-root" }), /--change/);
});

test("binding sets preserve branch case, normalize PR identity and union old worktrees", () => {
  const original = mergeEmbeddedBindings(undefined, { ...context, pullRequests: [{ host: "GitHub.COM", repository: "Owner/Repo", number: 153 }] });
  const merged = mergeEmbeddedBindings(original, { ...context, instanceKey: "second", branch: "refs/heads/Feature", pullRequests: [{ host: "github.com", repository: "owner/repo", number: 153 }] });
  assert.equal(merged.pull_requests.length, 1); assert.equal(merged.branches.length, 2); assert.equal(merged.worktrees.length, 2);
});

test("new worktree bindings reject recycled roots or generations and require explicit choice without proof", () => {
  const detached = { ...context, branch: null };
  const original = record("original", detached);
  assert.equal(selectEmbeddedChange([original], { ...detached, root: "/other", instanceGeneration: "generation-2" }), undefined);
  assert.equal(selectEmbeddedChange([original], { ...detached, instanceGeneration: "generation-2" }), undefined);
  for (const missing of [{ instanceGeneration: undefined }, { root: undefined }]) {
    assert.throws(() => selectEmbeddedChange([original], { ...detached, ...missing }), error => {
      assert(error instanceof EmbeddedChangeAmbiguityError); assert.deepEqual(error.candidates.map(c => c.id), [original.id]); return true;
    });
  }
  const unproven = { ...original, bindings: { ...original.bindings, worktrees: [{ instance_key: context.instanceKey, root: context.root }] } };
  assert.throws(() => selectEmbeddedChange([unproven], detached), /--change/);
  assert.equal(selectEmbeddedChange([original], detached, original.id), original);
});

test("push refspec resolves exact and wildcard remote head names without guessing multiple destinations", () => {
  assert.equal(remoteHeadRef(new Map([["remote.push.push", ["refs/heads/feature:refs/heads/remote-name"]]]), "feature", "push"), "refs/heads/remote-name");
  assert.equal(remoteHeadRef(new Map([["remote.push.push", ["refs/heads/*:refs/heads/prefix/*"]]]), "feature", "push"), "refs/heads/prefix/feature");
  assert.equal(remoteHeadRef(new Map([["remote.push.push", ["refs/heads/feature:refs/heads/a", "refs/heads/feature:refs/heads/b"]]]), "feature", "push"), undefined);
  assert.equal(remoteHeadRef(new Map([["push.default", ["upstream"]], ["branch.feature.remote", ["push"]], ["branch.feature.merge", ["refs/heads/other"]]]), "feature", "push"), "refs/heads/other");
  assert.equal(remoteHeadRef(new Map(), "feature", "push"), undefined);
  assert.deepEqual(githubRepository("git@github.com:Owner/Repo.git"), { host: "github.com", repository: "owner/repo" });
  assert.equal(githubRepository("https://git.example.com/owner/repo.git"), undefined);
});
