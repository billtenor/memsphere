import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Config } from "../src/data/api/config.js";
import { FilesystemDataStoreFactory } from "../src/data/extensions/filesystem-datastore/index.js";
import { FilesystemJsonValueStoreFactory } from "../src/data/extensions/filesystem-json-valuestore/index.js";
import { createPlainRuntime } from "../src/data/extensions/shared/reflection.js";

const runtime = createPlainRuntime({ id: "test/record.json", root: { kind: "object", fields: [], field: () => undefined } });
for (const kind of ["data", "value"] as const) {
  const open = (directory: string) => kind === "data"
    ? new FilesystemDataStoreFactory().openExisting({}, "test/store", runtime.descriptor.id, new Config({ directory }))
    : new FilesystemJsonValueStoreFactory().openExisting({}, "test/store", runtime, new Config({ directory }));

  test(`${kind} openExisting and empty reads do not create directories or lock metadata`, async (t) => {
    const directory = await fs.mkdtemp(join(tmpdir(), "memsphere-pure-open-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const store = await open(directory);
    assert.deepEqual(await store.list({}), { items: [] });
    assert.equal(await store.has({}, kind === "data" ? "missing.json" : "missing"), false);
    assert.equal(await store.get({}, kind === "data" ? "missing.json" : "missing"), undefined);
    await assert.rejects(open(join(directory, "missing", "nested")), { code: "ENOENT" });
    assert.deepEqual(await fs.readdir(directory), []);
  });

  test(`${kind} openExisting does not recreate a root removed during open`, async (t) => {
    const directory = await fs.mkdtemp(join(tmpdir(), "memsphere-open-race-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const root = join(directory, "root");
    await fs.mkdir(root);
    const realpath = fs.realpath.bind(fs);
    const probe = t.mock.method(fs, "realpath", async (path, ...args) => {
      const canonical = await realpath(path, ...args);
      if (String(path) === root) await fs.rmdir(root);
      return canonical;
    });
    await assert.rejects(open(root), { code: "ENOENT" });
    probe.mock.restore();
    assert.deepEqual(await fs.readdir(directory), []);
  });

  test(`${kind} Factory rejects malformed configuration before creating its root`, async (t) => {
    const directory = await fs.mkdtemp(join(tmpdir(), "memsphere-config-preflight-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    for (const json of [null, [], { directory: " " }, { directory: join(directory, "child"), unknown: true }]) {
      const config = new Config(json as any);
      await assert.rejects(kind === "data"
        ? new FilesystemDataStoreFactory().createStore({}, "test/store", runtime.descriptor.id, config)
        : new FilesystemJsonValueStoreFactory().createStore({}, "test/store", runtime, config));
    }
    assert.deepEqual(await fs.readdir(directory), []);
  });
}
