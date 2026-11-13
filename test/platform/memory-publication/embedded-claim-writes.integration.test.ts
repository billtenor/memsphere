import assert from "node:assert/strict";
import { readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { claimMemoryChange, readMemoryChange } from "../../../src/memory/changeset.js";
import { EmbeddedClaimWriteError } from "../../../src/memory/embedded-claim.js";
import { concept, fixture, claimFixture } from "../../helpers/embedded-continuation.js";

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

for (const userEdit of [false, true]) {
  test(`claim staging write fails after partial bytes and ${userEdit ? "protects a subsequent user edit" : "safely retries"}`, async () => fixture(async f => claimFixture(f, async (id, root) => {
    const filesystem = (await import("node:fs/promises")).default;
    const { syncBuiltinESMExports } = await import("node:module");
    const originalWrite = filesystem.writeFile;
    const metadata = join(f.changes, id, "change.json"), before = await readFile(metadata);
    let injected = false;
    try {
      filesystem.writeFile = (async (path: unknown, data: unknown, options: unknown) => {
        if (String(path).includes(".memsphere-claim-") || path === join(root, "memory/concepts/example.yaml")) {
          injected = true;
          await (originalWrite as Function)(path, Buffer.from(data as Uint8Array).subarray(0, 8), options);
          throw Object.assign(new Error("injected partial staging write"), { code: "EIO" });
        }
        return (originalWrite as Function)(path, data, options);
      }) as typeof originalWrite;
      syncBuiltinESMExports();
      await assert.rejects(claimMemoryChange({ changeId: id }), error => {
        assert(error instanceof EmbeddedClaimWriteError);
        assert.deepEqual(error.details.writtenPaths, []);
        assert.deepEqual(error.details.pendingPaths, ["concepts/example.yaml", "concepts/second.yaml"]);
        assert.equal(error.details.metadataConfirmed, false);
        assert.match(error.message, /injected partial staging write/);
        return true;
      });
    } finally { filesystem.writeFile = originalWrite; syncBuiltinESMExports(); }
    assert.equal(injected, true);
    assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("Base"));
    await assert.rejects(readFile(join(root, "memory/concepts/second.yaml")), { code: "ENOENT" });
    assert.deepEqual(await readFile(metadata), before);
    assert.equal((await readdir(join(root, "memory/concepts"))).some(name => name.startsWith(".memsphere-claim-")), false);
    if (userEdit) {
      await writeFile(join(root, "memory/concepts/example.yaml"), concept("User"));
      await assert.rejects(claimMemoryChange({ changeId: id }), /edit conflict/);
      assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("User"));
      assert.deepEqual(await readFile(metadata), before);
    } else {
      assert((await claimMemoryChange({ changeId: id })).change.claim);
      assert.equal(await readFile(join(root, "memory/concepts/example.yaml"), "utf8"), concept("Changed"));
      assert.equal(await readFile(join(root, "memory/concepts/second.yaml"), "utf8"), concept("Second", "second"));
    }
  })));
}

for (const userChange of ["edit", "delete"] as const) {
  test(`claim preserves a user ${userChange} made after staging succeeds and before replacement`, async () => fixture(async f => claimFixture(f, async (id, root) => {
    const filesystem = (await import("node:fs/promises")).default;
    const { syncBuiltinESMExports } = await import("node:module");
    const originalWrite = filesystem.writeFile;
    const destination = join(root, "memory/concepts/example.yaml");
    const metadata = join(f.changes, id, "change.json"), before = await readFile(metadata);
    let changedDuringStaging = false;
    try {
      filesystem.writeFile = (async (path: unknown, data: unknown, options: unknown) => {
        await (originalWrite as Function)(path, data, options);
        if (!changedDuringStaging && String(path).includes(".memsphere-claim-")) {
          changedDuringStaging = true;
          if (userChange === "edit") await originalWrite(destination, concept("User during staging"));
          else await rm(destination);
        }
      }) as typeof originalWrite;
      syncBuiltinESMExports();
      await assert.rejects(claimMemoryChange({ changeId: id }), error => {
        assert(error instanceof EmbeddedClaimWriteError);
        assert.deepEqual(error.details.writtenPaths, []);
        assert.deepEqual(error.details.pendingPaths, ["concepts/example.yaml", "concepts/second.yaml"]);
        assert.equal(error.details.metadataConfirmed, false);
        if (userChange === "delete") assert.equal((error.cause as NodeJS.ErrnoException).code, "ENOENT");
        else assert.match(error.message, /Memory changed while preparing claim write/);
        return true;
      });
    } finally { filesystem.writeFile = originalWrite; syncBuiltinESMExports(); }
    assert.equal(changedDuringStaging, true);
    const assertUserState = async () => {
      if (userChange === "edit") assert.equal(await readFile(destination, "utf8"), concept("User during staging"));
      else await assert.rejects(readFile(destination), { code: "ENOENT" });
      await assert.rejects(readFile(join(root, "memory/concepts/second.yaml")), { code: "ENOENT" });
      assert.deepEqual(await readFile(metadata), before);
      assert.equal((await readdir(join(root, "memory/concepts"))).some(name => name.startsWith(".memsphere-claim-")), false);
    };
    await assertUserState();
    await assert.rejects(claimMemoryChange({ changeId: id }), /edit conflict/);
    await assertUserState();
    // The user explicitly restores the known baseline before retrying the same ChangeSet.
    await writeFile(destination, concept("Base"));
    assert((await claimMemoryChange({ changeId: id })).change.claim);
    assert.equal(await readFile(destination, "utf8"), concept("Changed"));
    assert.equal(await readFile(join(root, "memory/concepts/second.yaml"), "utf8"), concept("Second", "second"));
  })));
}

test("claim replacement rename failure preserves the original file and accurate state for retry", async () => fixture(async f => claimFixture(f, async (id, root) => {
  const filesystem = (await import("node:fs/promises")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const originalRename = filesystem.rename;
  const destination = join(root, "memory/concepts/example.yaml");
  const metadata = join(f.changes, id, "change.json"), before = await readFile(metadata);
  let replacementReached = false;
  try {
    filesystem.rename = (async (source: unknown, target: unknown) => {
      if (String(source).includes(".memsphere-claim-")) {
        replacementReached = true;
        assert.equal(await readFile(String(source), "utf8"), concept("Changed"));
        assert.equal(await realpath(String(target)), await realpath(destination));
        throw Object.assign(new Error("injected replacement rename failure"), { code: "EACCES" });
      }
      return (originalRename as Function)(source, target);
    }) as typeof originalRename;
    syncBuiltinESMExports();
    await assert.rejects(claimMemoryChange({ changeId: id }), error => {
      assert(error instanceof EmbeddedClaimWriteError);
      assert.deepEqual(error.details.writtenPaths, []);
      assert.deepEqual(error.details.pendingPaths, ["concepts/example.yaml", "concepts/second.yaml"]);
      assert.equal(error.details.metadataConfirmed, false);
      assert.match(error.message, /injected replacement rename failure/);
      return true;
    });
  } finally { filesystem.rename = originalRename; syncBuiltinESMExports(); }
  assert.equal(replacementReached, true);
  assert.equal(await readFile(destination, "utf8"), concept("Base"));
  await assert.rejects(readFile(join(root, "memory/concepts/second.yaml")), { code: "ENOENT" });
  assert.deepEqual(await readFile(metadata), before);
  assert.equal((await readdir(join(root, "memory/concepts"))).some(name => name.startsWith(".memsphere-claim-")), false);
  assert((await claimMemoryChange({ changeId: id })).change.claim);
  assert.equal(await readFile(destination, "utf8"), concept("Changed"));
  assert.equal(await readFile(join(root, "memory/concepts/second.yaml"), "utf8"), concept("Second", "second"));
})));
