import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { gitOutput, runGit } from "../../../src/git.js";
import { claimMemoryChange, validateMemoryChange } from "../../../src/memory/changeset.js";
import { concept, fixture } from "../../helpers/embedded-continuation.js";

for (const evidence of ["record-missing", "context-missing", "generation-unavailable", "same-root-recycled"] as const) {
  test(`unverified existing claim requires force: ${evidence}`, async () => fixture(async f => {
    const owner = join(f.home, "owner");
    await runGit(["worktree", "add", "--detach", owner]); process.chdir(owner);
    await writeFile(join(owner, "memory/concepts/example.yaml"), concept("Claimed candidate"));
    const first = await validateMemoryChange(); await claimMemoryChange({ changeId: first.changeId });
    const metadata = join(f.changes, first.changeId, "change.json");
    const filesystem = (await import("node:fs/promises")).default;
    const { syncBuiltinESMExports } = await import("node:module");
    const originalStat = filesystem.stat;
    try {
      if (evidence === "same-root-recycled") {
        process.chdir(f.main); await runGit(["worktree", "remove", "--force", owner]);
        await runGit(["worktree", "add", "--detach", owner]); process.chdir(owner);
      } else {
        const record = JSON.parse(await readFile(metadata, "utf8"));
        if (evidence !== "context-missing") for (const binding of record.bindings.worktrees) delete binding.generation;
        await writeFile(metadata, JSON.stringify(record));
        if (evidence === "generation-unavailable" || evidence === "context-missing") {
          const admin = await gitOutput(["rev-parse", "--absolute-git-dir"]);
          filesystem.stat = (async (path: unknown, options: unknown) => {
            const result = await (originalStat as Function)(path, options);
            if (path === admin && (options as { bigint?: boolean })?.bigint) result.birthtimeNs = 0n;
            return result;
          }) as typeof originalStat;
          syncBuiltinESMExports();
        }
      }
      const before = await readFile(metadata), body = await readFile(join(owner, "memory/concepts/example.yaml"));
      const candidate = join(f.changes, first.changeId, "checkpoints", first.checkpointDigest, "memory/concepts/example.yaml");
      const frozen = await readFile(candidate);
      await assert.rejects(validateMemoryChange(first.changeId), /claim ownership cannot be confirmed/);
      await assert.rejects(claimMemoryChange({ changeId: first.changeId }), /use --force/);
      assert.deepEqual(await readFile(metadata), before); assert.deepEqual(await readFile(candidate), frozen);
      assert.deepEqual(await readFile(join(owner, "memory/concepts/example.yaml")), body);
      assert((await claimMemoryChange({ changeId: first.changeId, force: true })).change.claim);
    } finally { filesystem.stat = originalStat; syncBuiltinESMExports(); }
  }));
}
