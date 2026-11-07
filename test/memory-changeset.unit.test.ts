import assert from "node:assert/strict";
import test from "node:test";
import { memoryChangeSetSchema } from "../src/memory/changeset.js";


test("ChangeSet metadata rejects path traversal", () => {
  assert.equal(memoryChangeSetSchema.safeParse({
    format_version: 1,
    id: "change-test",
    project: "project",
    workspace_key: "path:/workspace",
    base_revision: "abc123",
    status: "active",
    created_at: "2026-08-17T00:00:00.000Z",
    updated_at: "2026-08-17T00:00:00.000Z",
    store_type: "managed",
    targets: [{
      operation: "update",
      reference: "concepts/test",
      path: "../../outside.yaml",
      base_digest: "digest",
      added_revision: "abc123"
    }]
  }).success, false);
});


test("ChangeSet metadata accepts only the active lifecycle vocabulary", () => {
  const base = {
    format_version: 1 as const,
    id: "change-lifecycle",
    project: "project",
    workspace_key: "path:/workspace",
    base_revision: "abc123",
    created_at: "2026-08-17T00:00:00.000Z",
    updated_at: "2026-08-17T00:00:00.000Z",
    store_type: "managed" as const,
    targets: []
  };
  assert.equal(memoryChangeSetSchema.safeParse({ ...base, status: "active" }).success, true);
  assert.equal(memoryChangeSetSchema.safeParse({ ...base, status: "completed" }).success, true);
  assert.equal(memoryChangeSetSchema.safeParse({ ...base, status: "abandoned" }).success, true);
  assert.equal(memoryChangeSetSchema.safeParse({ ...base, status: "draft" }).success, false);
  assert.equal(memoryChangeSetSchema.safeParse({ ...base, status: "published" }).success, false);
});


test("ChangeSet metadata requires store_type while allowing Managed source worktrees", () => {
  const base = {
    format_version: 1 as const,
    id: "change-store-type",
    project: "project",
    workspace_key: "path:/workspace",
    base_revision: "abc123",
    status: "active" as const,
    created_at: "2026-08-17T00:00:00.000Z",
    updated_at: "2026-08-17T00:00:00.000Z",
    targets: []
  };
  const missing = memoryChangeSetSchema.safeParse(base);
  assert.equal(missing.success, false);
  if (!missing.success) assert.deepEqual(missing.error.issues[0]?.path, ["store_type"]);
  assert.equal(memoryChangeSetSchema.safeParse({
    ...base,
    store_type: "managed",
    source_worktree: {
      instance_key: "path:/workspace",
      root: "/workspace",
      repository_root: "/workspace",
      memory_path: "memory"
    }
  }).success, true);
});
