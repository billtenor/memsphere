import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { gitOutput, runGit } from "../../../src/git.js";
import { validateMemoryChange } from "../../../src/memory/changeset.js";
import { concept, fixture } from "../../helpers/embedded-continuation.js";

for (const state of ["missing-master", "unrelated", "multiple-bases", "unmerged"] as const) {
  test(`Embedded validation rejects ${state} without a HEAD fallback or side effects`, async () => fixture(async f => {
    const file = join(f.memory, "concepts/example.yaml");
    await writeFile(file, concept("Candidate")); const first = await validateMemoryChange();
    const record = join(f.changes, first.changeId, "change.json"), before = await readFile(record);
    await runGit(["add", "memory"]); await runGit(["commit", "-m", "candidate before invalid Git state"]);
    const base = await gitOutput(["rev-parse", "HEAD"]), tree = await gitOutput(["rev-parse", "HEAD^{tree}"]);
    const commit = (...parents: string[]) => gitOutput(["commit-tree", tree, ...parents.flatMap(parent => ["-p", parent]), "-m", "fixture"]);
    if (state === "missing-master") {
      await runGit(["switch", "--detach"], { cwd: f.main }); await runGit(["branch", "-D", "master"]);
    } else if (state === "unrelated") await runGit(["update-ref", "refs/heads/master", await commit()]);
    else if (state === "multiple-bases") {
      const left = await commit(base);
      const right = await gitOutput(["commit-tree", tree, "-p", base, "-m", "other parent"]);
      await runGit(["update-ref", "refs/heads/master", await commit(left, right)]);
      await runGit(["update-ref", "HEAD", await commit(right, left)]);
    } else {
      await writeFile(join(f.linked, "conflict.txt"), "feature"); await runGit(["add", "conflict.txt"]); await runGit(["commit", "-m", "feature"]);
      await writeFile(join(f.main, "conflict.txt"), "master"); await runGit(["add", "conflict.txt"], { cwd: f.main }); await runGit(["commit", "-m", "master"], { cwd: f.main });
      await runGit(["merge", "master"], { allowFailure: true });
      assert.match(await gitOutput(["ls-files", "--unmerged"]), /conflict.txt/);
    }
    const head = await gitOutput(["rev-parse", "HEAD"]), index = await gitOutput(["ls-files", "--stage"]), status = await gitOutput(["status", "--porcelain"]);
    const diagnostic = state === "missing-master" ? /requires local master/ : state === "unrelated" ? /no common ancestor/ : state === "multiple-bases" ? /multiple common ancestors/ : /Resolve Git merge conflicts/;
    await assert.rejects(validateMemoryChange(first.changeId), diagnostic);
    assert.deepEqual(await readFile(record), before);
    assert.equal(await readFile(file, "utf8"), concept("Candidate"));
    assert.equal(await gitOutput(["rev-parse", "HEAD"]), head);
    assert.equal(await gitOutput(["ls-files", "--stage"]), index);
    assert.equal(await gitOutput(["status", "--porcelain"]), status);
    assert.deepEqual((await readdir(f.changes)).filter(id => id.startsWith("change-")), [first.changeId]);
    assert.equal(await readFile(join(f.changes, first.changeId, "checkpoints", first.checkpointDigest, "memory/concepts/example.yaml"), "utf8"), concept("Candidate"));
  }));
}
