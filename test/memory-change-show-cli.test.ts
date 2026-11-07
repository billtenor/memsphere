import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertChangeShowRejected, changeShowFixture } from "./helpers/change-show.js";

test("Reviewer ChangeSet default options", async t => {
  const f = await changeShowFixture(t);
  const reference = ["--reference", "concepts/review-evidence"];
  await t.test("omitted part equals explicit summary", () => {
    assert.deepEqual(f.read(), f.read(["--part", "summary"]));
  });
  await t.test("reference filters summary without selecting body content", () => {
    assert.deepEqual(f.read(reference), f.read([...reference, "--part", "summary"]));
    assert.equal(f.read(reference).files.length, 1);
    assert.equal(f.read(reference).content, undefined);
  });
  await t.test("omitted side equals explicit after for body content", () => {
    assert.deepEqual(f.read([...reference, "--part", "memory"]), f.read([...reference, "--part", "memory", "--side", "after"]));
  });
});

test("Reviewer ChangeSet material receipts", async t => {
  const f = await changeShowFixture(t);
  await t.test("body reads preserve both sides of create, update, delete and rename", async () => {
    const body = async (reference: string, side = "after") => (await f.readMaterial(["--part", "memory", "--reference", reference, "--side", side])).content;
    assert.match(await body("concepts/review-evidence"), /Pinned content/);
    assert.equal(await body("concepts/review-evidence", "before"), null);
    assert.match(await body("concepts/existing", "before"), /defines: \[\]/);
    assert.match(await body("concepts/existing"), /Updated existing content/);
    assert.equal(await body("concepts/deleted"), null);
    assert.match(await body("concepts/deleted", "before"), /deleted/);
    const renamed = f.read().files.find((file: { operation: string }) => file.operation === "rename");
    assert.ok(renamed);
    assert.match(await body(renamed.reference, "before"), /old-name/);
    assert.match(await body(renamed.reference), /new-name/);
  });
  await t.test("diff receipts cover changed files and exact reference filtering", () => {
    const diffs = f.read(["--part", "diff"]).files;
    assert.equal(diffs.length, 4);
    assert.ok(diffs.every((file: { diff: string }) => file.diff.includes("@@")));
    const single = f.read(["--part", "diff", "--reference", "concepts/review-evidence"]).files;
    assert.equal(single.length, 1); assert.match(single[0].diff, /\+.*Pinned content/);
  });
  await t.test("validation receipt reports the validated checkpoint result", () => {
    assert.equal(f.read(["--part", "validation"]).validation.valid, true);
  });
});

test("Reviewer ChangeSet read boundary", async t => {
  const f = await changeShowFixture(t);
  await t.test("reading material preserves the ChangeSet metadata", async () => {
    const original = await readFile(f.metadata, "utf8");
    await f.snapshot();
    assert.equal(await readFile(f.metadata, "utf8"), original);
  });
  await t.test("material receipts omit internal storage paths", async () => {
    assert.doesNotMatch(JSON.stringify(await f.snapshot()), /candidateRoot|source_worktree|memoryRoot/);
  });
  await t.test("body reads require an explicit reference", () => {
    assertChangeShowRejected(f.invoke(["--part", "memory"]), 1, /requires --reference/);
  });
  await t.test("pinned reads require an explicit checkpoint", () => {
    assertChangeShowRejected(f.command(["memory", "change", "show", f.edit.change.id]), 1, /required option.*--checkpoint/);
  });
  await t.test("unknown references do not resolve outside the change", () => {
    assertChangeShowRejected(f.invoke(["--reference", "../../config.json"]), 1, /reference not found or ambiguous/);
  });
  for (const extra of [["--project", "other"], ["--project=other"], ["--project", "project", "--project=other"]]) {
    await t.test(`cross-Project selector is denied: ${extra.join(" ")}`, () => {
      assertChangeShowRejected(f.invoke(extra), 1, /conflicts with this Agent Review Session/);
    });
  }
  for (const operation of ["validate", "claim", "resume", "complete", "finish"]) {
    await t.test(`Reviewer cannot mutate a ChangeSet using ${operation}`, () => {
      const result = f.command(["memory", "change", operation, f.edit.change.id]);
      assertChangeShowRejected(result, 1, /conflicts with this Agent Review Session|command is not allowed/);
    });
  }
});
