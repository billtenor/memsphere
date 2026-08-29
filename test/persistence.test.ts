import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { atomicReplaceDirectoryWithCommit } from "../src/persistence.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("directory replacement commits new content only after preparation succeeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-directory-commit-"));
  const source = join(root, "source");
  const destination = join(root, "destination");
  try {
    await mkdir(destination);
    await writeFile(join(destination, "value"), "old");
    let committed = false;
    await assert.rejects(atomicReplaceDirectoryWithCommit(source, destination, async () => {
      committed = true;
    }));
    assert.equal(committed, false);
    assert.equal(await readFile(join(destination, "value"), "utf8"), "old");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("directory replacement restores prior content when installation fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-directory-install-"));
  const source = join(root, "source");
  const destination = join(root, "destination");
  try {
    await mkdir(source);
    await mkdir(destination);
    await writeFile(join(source, "value"), "new");
    await writeFile(join(destination, "value"), "old");
    let renames = 0;
    await assert.rejects(atomicReplaceDirectoryWithCommit(source, destination, async () => undefined, {
      copy: async (from, to) => cp(from, to, { recursive: true }),
      rename: async (from, to) => {
        renames += 1;
        if (renames === 2) throw new Error("injected install failure");
        await rename(from, to);
      },
      remove: async (path) => rm(path, { recursive: true, force: true })
    }), /injected install failure/);
    assert.equal(await readFile(join(destination, "value"), "utf8"), "old");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("directory replacement rolls back new content when metadata commit fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-directory-rollback-"));
  const source = join(root, "source");
  const destination = join(root, "destination");
  try {
    await mkdir(source);
    await mkdir(destination);
    await writeFile(join(source, "value"), "new");
    await writeFile(join(destination, "value"), "old");
    await assert.rejects(atomicReplaceDirectoryWithCommit(source, destination, async () => {
      throw new Error("injected metadata failure");
    }), /injected metadata failure/);
    assert.equal(await readFile(join(destination, "value"), "utf8"), "old");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("directory replacement preserves and identifies the old content when install rollback also fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-directory-double-failure-"));
  const source = join(root, "source");
  const destination = join(root, "destination");
  try {
    await mkdir(source);
    await mkdir(destination);
    await writeFile(join(source, "value"), "new");
    await writeFile(join(destination, "value"), "old");
    let renames = 0;
    let reportedBackup = "";
    await assert.rejects(atomicReplaceDirectoryWithCommit(source, destination, async () => undefined, {
      copy: async (from, to) => cp(from, to, { recursive: true }),
      rename: async (from, to) => {
        renames += 1;
        if (renames === 2) throw new Error("injected install failure");
        if (renames === 3) throw new Error("injected rollback failure");
        await rename(from, to);
      },
      remove: async (path) => rm(path, { recursive: true, force: true })
    }), (error: unknown) => {
      assert(error instanceof AggregateError);
      assert.match(error.message, /previous content is preserved at/);
      reportedBackup = /preserved at ([^;]+)/.exec(error.message)?.[1] ?? "";
      return true;
    });
    assert(reportedBackup);
    assert.equal(await readFile(join(reportedBackup, "value"), "utf8"), "old");
    assert((await readdir(root)).some((entry) => entry.startsWith("destination.previous-")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("directory replacement preserves both versions when metadata rollback also fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-directory-commit-double-failure-"));
  const source = join(root, "source");
  const destination = join(root, "destination");
  try {
    await mkdir(source);
    await mkdir(destination);
    await writeFile(join(source, "value"), "new");
    await writeFile(join(destination, "value"), "old");
    let renames = 0;
    let message = "";
    await assert.rejects(atomicReplaceDirectoryWithCommit(source, destination, async () => {
      throw new Error("injected metadata failure");
    }, {
      copy: async (from, to) => cp(from, to, { recursive: true }),
      rename: async (from, to) => {
        renames += 1;
        if (renames === 4) throw new Error("injected rollback failure");
        await rename(from, to);
      },
      remove: async (path) => rm(path, { recursive: true, force: true })
    }), (error: unknown) => {
      assert(error instanceof AggregateError);
      message = error.message;
      assert.match(message, /previous content is preserved at/);
      assert.match(message, /rejected replacement is preserved at/);
      return true;
    });
    const previous = /previous content is preserved at ([^;]+)/.exec(message)?.[1] ?? "";
    const rejected = /rejected replacement is preserved at (.+)$/.exec(message)?.[1] ?? "";
    assert.equal(await readFile(join(previous, "value"), "utf8"), "old");
    assert.equal(await readFile(join(rejected, "value"), "utf8"), "new");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("directory replacement identifies both versions when moving the rejected replacement fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-directory-reject-failure-"));
  const source = join(root, "source");
  const destination = join(root, "destination");
  try {
    await mkdir(source);
    await mkdir(destination);
    await writeFile(join(source, "value"), "new");
    await writeFile(join(destination, "value"), "old");
    let renames = 0;
    let message = "";
    await assert.rejects(atomicReplaceDirectoryWithCommit(source, destination, async () => {
      throw new Error("injected metadata failure");
    }, {
      copy: async (from, to) => cp(from, to, { recursive: true }),
      rename: async (from, to) => {
        renames += 1;
        if (renames === 3) throw new Error("injected rejected-move failure");
        await rename(from, to);
      },
      remove: async (path) => rm(path, { recursive: true, force: true })
    }), (error: unknown) => {
      assert(error instanceof AggregateError);
      message = error.message;
      assert.match(message, /replacement remains at/);
      assert.match(message, /previous content is preserved at/);
      assert.equal(error.errors.length, 2);
      assert.match(String(error.errors[0]), /injected metadata failure/);
      assert.match(String(error.errors[1]), /injected rejected-move failure/);
      return true;
    });
    const current = /replacement remains at ([^;]+)/.exec(message)?.[1] ?? "";
    const previous = /previous content is preserved at (.+)$/.exec(message)?.[1] ?? "";
    assert.equal(current, destination);
    assert.equal(await readFile(join(current, "value"), "utf8"), "new");
    assert.equal(await readFile(join(previous, "value"), "utf8"), "old");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("directory replacement keeps a rejected copy after a transient cleanup failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-directory-cleanup-failure-"));
  const source = join(root, "source");
  const destination = join(root, "destination");
  try {
    await mkdir(source);
    await mkdir(destination);
    await writeFile(join(source, "value"), "new");
    await writeFile(join(destination, "value"), "old");
    let rejectedRemoveAttempts = 0;
    let message = "";
    await assert.rejects(atomicReplaceDirectoryWithCommit(source, destination, async () => {
      throw new Error("injected metadata failure");
    }, {
      copy: async (from, to) => cp(from, to, { recursive: true }),
      rename,
      remove: async (path) => {
        if (path.includes(".rejected-")) {
          rejectedRemoveAttempts += 1;
          if (rejectedRemoveAttempts === 1) throw new Error("transient rejected cleanup failure");
        }
        await rm(path, { recursive: true, force: true });
      }
    }), (error: unknown) => {
      assert(error instanceof AggregateError);
      message = error.message;
      assert.match(message, new RegExp(`previous content was restored at ${escapeRegExp(destination)}`));
      assert.match(message, /rejected replacement is preserved at/);
      return true;
    });
    const rejected = /rejected replacement is preserved at (.+)$/.exec(message)?.[1] ?? "";
    assert.equal(rejectedRemoveAttempts, 1);
    assert.equal(await readFile(join(destination, "value"), "utf8"), "old");
    assert.equal(await readFile(join(rejected, "value"), "utf8"), "new");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("directory replacement does not invent a previous path when the first commit cleanup fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-directory-first-cleanup-failure-"));
  const source = join(root, "source");
  const destination = join(root, "destination");
  try {
    await mkdir(source);
    await writeFile(join(source, "value"), "new");
    let message = "";
    await assert.rejects(atomicReplaceDirectoryWithCommit(source, destination, async () => {
      throw new Error("injected first metadata failure");
    }, {
      copy: async (from, to) => cp(from, to, { recursive: true }),
      rename,
      remove: async (path) => {
        if (path.includes(".rejected-")) throw new Error("injected first cleanup failure");
        await rm(path, { recursive: true, force: true });
      }
    }), (error: unknown) => {
      assert(error instanceof AggregateError);
      message = error.message;
      assert.match(message, /no previous directory existed/);
      assert.doesNotMatch(message, /\.previous-/);
      assert.match(message, /rejected replacement is preserved at/);
      return true;
    });
    const rejected = /rejected replacement is preserved at (.+)$/.exec(message)?.[1] ?? "";
    assert.equal(await readFile(join(rejected, "value"), "utf8"), "new");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
