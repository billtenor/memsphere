import assert from "node:assert/strict";
import fs, { mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Config, type JsonObject } from "../src/data/api/config.js";
import type { Data } from "../src/data/api/data.js";
import type { AppendableDataStore } from "../src/data/api/data-store.js";
import type { PayloadContent } from "../src/data/api/payload.js";
import { FilesystemDataStoreFactory, filesystemDataStoreExtension } from "../src/data/extensions/filesystem-datastore/index.js";
import { bytesContent, readAll } from "../src/data/extensions/shared/payload.js";

const MODEL = "example/file-v1.json";
const STORE = "example/files";
const factory = new FilesystemDataStoreFactory();

async function withDirectory(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "memsphere-data-filesystem-"));
  try { await action(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

async function withStore(action: (store: AppendableDataStore, directory: string) => Promise<void>): Promise<void> {
  await withDirectory(async (directory) => {
    await action(await factory.createStore({}, STORE, MODEL, new Config({ directory })), directory);
  });
}

function data(id: string, bytes: Uint8Array | string = new Uint8Array([0, 255, 128, 13, 10, 0]), contentType = "application/octet-stream", model = MODEL): Data {
  return { id, model, payload: { contentType, content: bytesContent(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes) } };
}

async function bytesOf(payload: PayloadContent): Promise<Uint8Array> {
  return readAll({}, payload);
}

function streamingData(id: string, firstChunk = "first") {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let secondRead!: () => void;
  const waiting = new Promise<void>((resolve) => { secondRead = resolve; });
  let opens = 0;
  let reads = 0;
  let cancelled = false;
  const source = data(id);
  source.payload.content = {
    stream() {
      opens += 1;
      assert.equal(opens, 1, "a one-shot Payload must not be reopened");
      return new ReadableStream<Uint8Array>({
        start(value) { controller = value; },
        pull(value) {
          reads += 1;
          if (reads === 1) value.enqueue(new TextEncoder().encode(firstChunk));
          else secondRead();
        },
        cancel() { cancelled = true; }
      }, { highWaterMark: 0 });
    }
  };
  return {
    data: source,
    waiting,
    get controller() { return controller; },
    get opens() { return opens; },
    get cancelled() { return cancelled; }
  };
}

test("filesystem extension supplies one independent DataStore factory", () => {
  assert.equal(filesystemDataStoreExtension.id, "memsphere/filesystem-datastore");
  assert.equal(filesystemDataStoreExtension.version, "0.1.0");
  assert.equal(filesystemDataStoreExtension.dataStoreFactories?.length, 1);
  assert.equal(filesystemDataStoreExtension.dataStoreFactories?.[0].id, "memsphere/filesystem");
  assert.equal(factory.id, "memsphere/filesystem");
  assert.equal("payloadSerializers" in filesystemDataStoreExtension, false);
});

test("filesystem DataStore saves ordinary readable files and raw binary bytes, without envelopes or locks", async () => {
  await withStore(async (store, directory) => {
    assert.equal(store.kind, "DataStore");
    assert.equal(store.id, STORE);
    assert.equal(store.model, MODEL);
    const text = "# 设计文档\n\n普通 Markdown，不增加文件头。\n";
    const json = '{\n  "orderNo": "order-001"\n}\n';
    const binary = new Uint8Array([0, 255, 128, 0, 195, 40, 13, 10]);
    await store.create({}, data("design.md", text, "text/markdown"));
    await store.create({}, data("order-001.json", json, "application/json"));
    assert.equal(await store.create({}, data("photo.jpg", binary, "image/jpeg")), undefined);
    const record = (await store.get({}, "photo.jpg"))!;
    assert.equal(await readFile(join(directory, "design.md"), "utf8"), text);
    assert.equal(await readFile(join(directory, "order-001.json"), "utf8"), json);
    assert.deepEqual(new Uint8Array(await readFile(join(directory, "photo.jpg"))), binary);
    assert.deepEqual((await readdir(directory)).sort(), ["design.md", "order-001.json", "photo.jpg"]);
    assert.deepEqual(Object.keys(record).sort(), ["data", "updatedAt"]);
    assert.equal(record.updatedAt, (await stat(join(directory, "photo.jpg"))).mtimeMs);
    assert.equal(record.data.id, "photo.jpg");
    assert.equal(record.data.model, MODEL);
    assert.equal(record.data.payload.contentType, "image/jpeg");
    assert.deepEqual(await bytesOf(record.data.payload.content), binary);
  });
});

test("filesystem CRUD supports reopens, snapshots, filesystem mtimes and externally created files", async () => {
  await withStore(async (store, directory) => {
    assert.equal(await store.get({}, "item.bin"), undefined);
    assert.equal(await store.has({}, "item.bin"), false);
    const original = new Uint8Array([1, 2, 3]);
    assert.equal(await store.create({}, data("item.bin", original)), undefined);
    const created = (await store.get({}, "item.bin"))!;
    assert.equal(await store.has({}, "item.bin"), true);
    await assert.rejects(store.create({}, data("item.bin")), /already exists/);
    await assert.rejects(store.update({}, data("missing.bin")), /does not exist/);
    const read = (await store.get({}, "item.bin"))!;
    (await bytesOf(read.data.payload.content)).fill(0);
    assert.equal(await store.update({}, data("item.bin", new Uint8Array([4, 5]))), undefined);
    const updated = (await store.get({}, "item.bin"))!;
    assert.equal(updated.revision, undefined);
    assert.equal(updated.createdAt, undefined);
    assert.deepEqual(await bytesOf(created.data.payload.content), original);
    assert.deepEqual(await bytesOf(read.data.payload.content), original);
    const reopened = await factory.createStore({}, STORE, MODEL, new Config({ directory }));
    assert.deepEqual(await bytesOf((await reopened.get({}, "item.bin"))!.data.payload.content), new Uint8Array([4, 5]));
    const timestamp = 1_700_000_000;
    await utimes(join(directory, "item.bin"), timestamp, timestamp);
    assert.equal((await store.get({}, "item.bin"))!.updatedAt, (await stat(join(directory, "item.bin"))).mtimeMs);
    await writeFile(join(directory, "manual.txt"), "Created by an editor\n", "utf8");
    const manual = (await store.get({}, "manual.txt"))!;
    assert.equal(manual.data.payload.contentType, "text/plain");
    assert.equal(new TextDecoder().decode(await bytesOf(manual.data.payload.content)), "Created by an editor\n");
    assert.equal(await reopened.delete({}, "item.bin"), true);
    assert.equal(await store.delete({}, "item.bin"), false);
    assert.deepEqual(await bytesOf(updated.data.payload.content), new Uint8Array([4, 5]));
  });
});

test("relative file IDs support nested CRUD, duplicate leaves, Unicode directories and reopens", async () => {
  await withStore(async (store, directory) => {
    const id = "业务 数据/订单💾/order-001.json";
    assert.equal(await store.get({}, id), undefined);
    assert.equal(await store.has({}, id), false);
    assert.equal(await store.delete({}, id), false);
    const json = '{\n  "orderNo": "订单一"\n}\n';
    await store.create({}, data(id, json, "application/json"));
    const created = (await store.get({}, id))!;
    assert.equal(created.data.id, id);
    assert.equal(created.data.model, MODEL);
    assert.equal(created.data.payload.contentType, "application/json");
    assert.equal(await readFile(join(directory, "业务 数据", "订单💾", "order-001.json"), "utf8"), json);
    assert.equal(await store.has({}, id), true);
    await assert.rejects(store.create({}, data(id, json, "application/json")), /already exists/);
    const sibling = "业务 数据/发货/order-001.json";
    await store.create({}, data(sibling, '{"shipment":1}', "application/json"));
    const reopened = await factory.createStore({}, STORE, MODEL, new Config({ directory }));
    assert.equal((await reopened.get({}, id))!.data.id, id);
    await reopened.update({}, data(id, '{"orderNo":"订单二"}', "application/json"));
    const updated = (await reopened.get({}, id))!;
    assert.equal(updated.data.id, id);
    assert.equal(new TextDecoder().decode(await bytesOf((await store.get({}, sibling))!.data.payload.content)), '{"shipment":1}');
    await store.create({}, data("folder.json/manual.md", "# Markdown", "text/markdown"));
    assert.equal((await store.get({}, "folder.json/manual.md"))!.data.payload.contentType, "text/markdown");
    await assert.rejects(store.create({}, data("folder.json/not-a-json.bin", "bytes", "application/json")), /must match/);
    assert.deepEqual((await store.list({})).items.map(({ id: path }) => path), [id, sibling, "folder.json/manual.md"].sort());
    assert.equal(await reopened.delete({}, id), true);
    assert.equal(await store.delete({}, id), false);
    assert.equal((await stat(join(directory, "业务 数据", "订单💾"))).isDirectory(), true);
    assert.deepEqual(await readdir(join(directory, "业务 数据", "订单💾")), []);
    assert.equal(await store.has({}, sibling), true);
  });
});

test("relative IDs validate every segment and never interpret traversal or Windows paths", async () => {
  await withStore(async (store, directory) => {
    const invalid = [
      "a//b.bin", "a/./b.bin", "a/../b.bin", "a/b/../../escape.bin", "./a.bin", "/a.bin",
      "a/b.bin/", "a\\b.bin", "a/b\\c.bin", "C:/a.bin", "//server/share/a.bin",
      "a/CON/b.bin", "a/space /b.bin", "a/end./b.bin", "a/.memsphere-internal/b.bin",
      "a/e\u0301/b.bin", "a/b\u0000/c.bin", `a/${"z".repeat(256)}/b.bin`
    ];
    for (const id of invalid) {
      await assert.rejects(store.create({}, data(id)));
      await assert.rejects(store.update({}, data(id)));
      await assert.rejects(store.get({}, id));
      await assert.rejects(store.has({}, id));
      await assert.rejects(store.delete({}, id));
    }
    assert.deepEqual(await readdir(directory), []);
    await store.create({}, data("Reports/Month 01/item.bin", "bytes"));
    await assert.rejects(store.create({}, data("reports/Month 01/item.bin")), /case alias/);
    await assert.rejects(store.get({}, "Reports/month 01/item.bin"), /case alias/);
    await assert.rejects(store.delete({}, "reports/Month 01/item.bin"), /case alias/);
  });
});

test("nested paths never create directories for invalid MIME, failed payloads or missing updates", async () => {
  await withStore(async (store, directory) => {
    await assert.rejects(store.create({}, data("wrong/type/item.json", "{}", "text/plain")), /must match/);
    await assert.rejects(store.create({}, data("unknown/type/item.unmapped")), /No contentType configured/);
    await assert.rejects(store.create({}, data("wrong/model/item.bin", "data", "application/octet-stream", "different-model")), /model does not match/);
    await assert.rejects(store.update({}, data("missing/parents/item.bin")), { code: "ENOENT" });
    const failing = data("failed/payload/item.bin");
    failing.payload.content = { stream() { return new ReadableStream({ start(controller) { controller.error(new Error("invalid source")); } }); } };
    await assert.rejects(store.create({}, failing), /invalid source/);
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const aborted = data("aborted/parents/item.bin");
    aborted.payload.content = { stream() { return new ReadableStream<Uint8Array>({ pull() { started(); } }); } };
    const pending = store.create({ signal: controller.signal }, aborted);
    await ready;
    controller.abort(new Error("stop before parent creation"));
    await assert.rejects(pending, /stop before parent creation/);
    assert.deepEqual(await readdir(directory), []);
  });
});

test("relative reads, writes and enumeration never traverse symlink directories", async () => {
  await withDirectory(async (outer) => {
    const directory = join(outer, "store");
    const outside = join(outer, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "existing.bin"), "outside must stay unchanged");
    const store = await factory.createStore({}, STORE, MODEL, new Config({ directory }));
    await symlink(outside, join(directory, "linked"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(store.get({}, "linked/existing.bin"), /symlink|directory/i);
    await assert.rejects(store.has({}, "linked/existing.bin"), /symlink|directory/i);
    await assert.rejects(store.delete({}, "linked/existing.bin"), /symlink|directory/i);
    await assert.rejects(store.update({}, data("linked/existing.bin", "changed")), /symlink|directory/i);
    await assert.rejects(store.create({}, data("linked/new.bin", "new")), /symlink|directory/i);
    assert.deepEqual(await store.list({}), { items: [] });
    assert.deepEqual(await readdir(outside), ["existing.bin"]);
    assert.equal(await readFile(join(outside, "existing.bin"), "utf8"), "outside must stay unchanged");
    await writeFile(join(directory, "not-a-directory"), "file");
    await assert.rejects(store.create({}, data("not-a-directory/new.bin")), /directory/i);
  });
});

test("filesystem DataStore rejects all version conditions instead of silently claiming CAS", async () => {
  await withStore(async (store, directory) => {
    await store.create({}, data("item.bin", "original"));
    for (const expectedRevision of [1, 2, Number.MAX_SAFE_INTEGER]) {
      await assert.rejects(store.update({}, data("item.bin", "replacement"), { expectedRevision }), /does not support expectedRevision/);
      await assert.rejects(store.delete({}, "item.bin", { expectedRevision }), /does not support expectedRevision/);
      await assert.rejects(store.delete({}, "missing.bin", { expectedRevision }), /does not support expectedRevision/);
    }
    for (const expectedRevision of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(store.update({}, data("item.bin"), { expectedRevision }), /positive safe integer/);
      await assert.rejects(store.delete({}, "item.bin", { expectedRevision }), /positive safe integer/);
    }
    assert.equal(await readFile(join(directory, "item.bin"), "utf8"), "original");
    assert.deepEqual(await readdir(directory), ["item.bin"]);
  });
});

test("model isolation uses explicitly configured directories, not hidden model namespaces", async () => {
  await withDirectory(async (directory) => {
    const firstDirectory = join(directory, "orders");
    const secondDirectory = join(directory, "products");
    const first = await factory.createStore({}, "orders", "order-model.json", new Config({ directory: firstDirectory }));
    const second = await factory.createStore({}, "products", "product-model.json", new Config({ directory: secondDirectory }));
    await first.create({}, data("item.json", '{"order":1}', "application/json", "order-model.json"));
    await second.create({}, data("item.json", '{"product":1}', "application/json", "product-model.json"));
    assert.equal(await readFile(join(firstDirectory, "item.json"), "utf8"), '{"order":1}');
    assert.equal(await readFile(join(secondDirectory, "item.json"), "utf8"), '{"product":1}');
    const sameDirectory = await factory.createStore({}, "alias", "another-model.json", new Config({ directory: firstDirectory }));
    assert.equal((await sameDirectory.get({}, "item.json"))!.data.model, "another-model.json");
    await assert.rejects(first.create({}, data("wrong.bin")), /model does not match/);
    await assert.rejects(first.update({}, data("item.json", "{}", "application/json")), /model does not match/);
    assert.deepEqual((await readdir(directory)).sort(), ["orders", "products"]);
  });
});

test("default suffixes recover contentType and enforce exact MIME agreement without rewriting IDs", async () => {
  await withStore(async (store) => {
    const pairs = [["a.JSON", "application/json"], ["b.markdown", "text/markdown"], ["c.JPEG", "image/jpeg"], ["d.yaml", "application/yaml"], ["e.svg", "image/svg+xml"]];
    for (const [id, contentType] of pairs) {
      await store.create({}, data(id, "bytes", contentType));
      assert.equal((await store.get({}, id))!.data.payload.contentType, contentType);
    }
    for (const contentType of ["image/png", "Application/Json", "application/json; charset=utf-8", ""]) {
      await assert.rejects(store.create({}, data("wrong.json", "{}", contentType)), /must match the filename mapping/);
    }
    for (const id of ["unknown", "unknown.unmapped"]) {
      await assert.rejects(store.create({}, data(id)), /No contentType configured/);
      await assert.rejects(store.get({}, id), /No contentType configured/);
      await assert.rejects(store.has({}, id), /No contentType configured/);
      await assert.rejects(store.delete({}, id), /No contentType configured/);
    }
  });
});

test("custom MIME mapping overrides suffixes, supports longest compound match and snapshots configuration", async () => {
  await withDirectory(async (directory) => {
    const jsonSuffixes = [".JSONDATA"];
    const configured = {
      "application/json": jsonSuffixes,
      "application/vnd.acme.order+json": [".order.json"],
      "application/gzip": [".gz"],
      "application/x-tar": [".tar.gz"]
    };
    const config = new Config({ directory, contentTypeExtensions: configured });
    const pending = factory.createStore({}, STORE, MODEL, config);
    config.json.directory = join(directory, "unexpected");
    jsonSuffixes[0] = ".mutated";
    configured["application/vnd.acme.order+json"][0] = ".changed";
    const store = await pending;
    for (const [id, contentType] of [["order.jsondata", "application/json"], ["item.ORDER.JSON", "application/vnd.acme.order+json"], ["archive.tar.gz", "application/x-tar"], ["compressed.gz", "application/gzip"]]) {
      await store.create({}, data(id, "original", contentType));
      assert.equal((await store.get({}, id))!.data.payload.contentType, contentType);
    }
    await assert.rejects(store.get({}, "old.json"), /No contentType configured/);
    await assert.rejects(store.get({}, "new.mutated"), /No contentType configured/);
    assert.equal(await readFile(join(directory, "order.jsondata"), "utf8"), "original");
  });
});

test("factory rejects invalid mappings and removed lock options before filesystem work", async () => {
  const invalidMappings: JsonObject[] = [
    { "text/custom": [".json"] },
    { "text/custom": [".a", ".A"] },
    { "text/custom": ".custom" },
    { "text/custom": [null] },
    { "text/custom": ["custom"] },
    { "text/custom": ["../bad"] },
    { "text/custom": [".bad."] },
    { "text/custom": [".a..b"] },
    { "text/custom": [".a/b"] },
    { "Text/Custom": [".custom"] },
    { "text/custom; charset=utf-8": [".custom"] },
    { "text/*": [".custom"] },
    { "not-mime": [".custom"] }
  ];
  const invalidConfigs: JsonObject[] = [
    {}, { directory: "" }, { directory: false }, { directory: null },
    { directory: "not-created", lockTimeoutMs: 100 },
    { directory: "not-created", anything: true },
    ...[null, [], "mapping", 1].map((contentTypeExtensions) => ({ directory: "not-created", contentTypeExtensions })),
    ...invalidMappings.map((contentTypeExtensions) => ({ directory: "not-created", contentTypeExtensions }))
  ];
  for (const config of invalidConfigs) await assert.rejects(factory.createStore({}, STORE, MODEL, new Config(config)));
  await assert.rejects(factory.createStore({}, STORE, "", new Config({ directory: "not-created" })), /model.*non-empty/);
  await assert.rejects(factory.createStore({}, "", MODEL, new Config({ directory: "not-created" })), /store id.*non-empty/);
});

test("empty suffix arrays disable defaults and allow explicitly reassigning an extension", async () => {
  await withDirectory(async (directory) => {
    const store = await factory.createStore({}, STORE, MODEL, new Config({
      directory,
      contentTypeExtensions: {
        "application/json": [],
        "text/plain": [],
        "application/vnd.acme.order+json": [".json"]
      }
    }));
    await store.create({}, data("order.json", "{}", "application/vnd.acme.order+json"));
    assert.equal((await store.get({}, "order.json"))!.data.payload.contentType, "application/vnd.acme.order+json");
    await assert.rejects(store.create({}, data("generic.json", "{}", "application/json")), /must match/);
    await assert.rejects(store.get({}, "note.txt"), /No contentType configured/);
  });
});

test("portable readable IDs reject path traversal and Windows-invalid names on every OS", async () => {
  await withStore(async (store, directory) => {
    const invalid = ["", "../escape.bin", "/absolute.bin", "a\\b.bin", "C:drive.bin", "a\u0000.bin", "bad?.bin", "bad*.bin", "bad<.bin", "bad>.bin", "bad|.bin", 'bad".bin', "CON.bin", "nul.bin", "COM1.json", "lpt9.txt", "COM¹.txt", "NUL .bin", "trail.bin.", "trail.bin ", ".", "..", ".memsphere-user.bin", "bad\ud800.bin", "e\u0301.bin", `${"x".repeat(252)}.bin`];
    for (const id of invalid) {
      await assert.rejects(store.create({}, data(id)));
      await assert.rejects(store.get({}, id));
      await assert.rejects(store.delete({}, id));
    }
    for (const id of ["中文💾.bin", "café.bin", "Order 001.bin"]) await store.create({}, data(id));
    await assert.rejects(store.create({}, data("order 001.bin")), /case alias/);
    await assert.rejects(store.get({}, "CAFÉ.bin"), /case alias/);
    assert.deepEqual((await readdir(directory)).map((id) => id.normalize("NFC")).sort(), ["中文💾.bin", "café.bin", "Order 001.bin"].sort());
  });
});

test("list enumerates filenames without opening payloads and scopes pagination to the configured Store", async (t) => {
  await withStore(async (store, directory) => {
    for (const id of ["c.json", "a.md", "b.bin"]) await writeFile(join(directory, id), "not parsed by list");
    await writeFile(join(directory, "unsupported.other"), "ignored");
    await writeFile(join(directory, ".memsphere-abandoned.tmp"), "ignored");
    await mkdir(join(directory, "folder.json"));
    const mock = t.mock.method(fs, "open", () => { throw new Error("list must not open payloads"); });
    try {
      const first = await store.list({}, { limit: 2 });
      assert.deepEqual(first.items, [{ id: "a.md" }, { id: "b.bin" }]);
      assert.ok(first.nextCursor);
      const next = await store.list({}, { limit: 2, cursor: first.nextCursor });
      assert.deepEqual(next, { items: [{ id: "c.json" }] });
      const reopened = await factory.createStore({}, STORE, MODEL, new Config({ directory }));
      assert.deepEqual(await reopened.list({}, { cursor: first.nextCursor }), next);
      const differentModel = await factory.createStore({}, STORE, "other-model", new Config({ directory }));
      await assert.rejects(differentModel.list({}, { cursor: first.nextCursor }), /cursor/);
      const differentId = await factory.createStore({}, "other-files", MODEL, new Config({ directory }));
      await assert.rejects(differentId.list({}, { cursor: first.nextCursor }), /cursor/);
      await assert.rejects(store.list({}, { cursor: "invalid" }), /cursor/);
      for (const limit of [0, -1, 1.5, NaN, Infinity, 1001]) await assert.rejects(store.list({}, { limit }));
    } finally { mock.mock.restore(); }
  });
});

test("recursive list returns full relative IDs in stable pages without opening any payload", async (t) => {
  await withStore(async (store, directory) => {
    const ids = ["z.bin", "a/one.bin", "a/deep/two.bin", "b/one.bin", "资料/测试.md"];
    for (const id of ids) {
      const segments = id.split("/");
      await mkdir(join(directory, ...segments.slice(0, -1)), { recursive: true });
      await writeFile(join(directory, ...segments), "not parsed by recursive list");
    }
    await writeFile(join(directory, "a", "unsupported.other"), "ignored");
    await mkdir(join(directory, "a", ".memsphere-ignored"));
    await writeFile(join(directory, "a", ".memsphere-ignored", "hidden.bin"), "ignored");
    const mock = t.mock.method(fs, "open", () => { throw new Error("list must not read any body"); });
    try {
      const found: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await store.list({}, { limit: 2, cursor });
        found.push(...page.items.map(({ id }) => id));
        cursor = page.nextCursor;
      } while (cursor);
      assert.deepEqual(found, ids.sort());
      assert.equal(new Set(found).size, ids.length);
    } finally { mock.mock.restore(); }
  });
});

test("concurrent create never overwrites an existing file and leaves no lock or temporary artifacts", async () => {
  await withStore(async (store, directory) => {
    const second = await factory.createStore({}, STORE, MODEL, new Config({ directory }));
    const results = await Promise.allSettled([store.create({}, data("item.bin", "one")), second.create({}, data("item.bin", "two"))]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.ok(["one", "two"].includes(await readFile(join(directory, "item.bin"), "utf8")));
    assert.deepEqual(await readdir(directory), ["item.bin"]);
  });
});

test("abort before commit and failed streams preserve original content", async () => {
  await withStore(async (store, directory) => {
    await store.create({}, data("item.bin", "original"));
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    let cancelled = false;
    const replacement = data("item.bin");
    replacement.payload.content = {
      stream() { return new ReadableStream<Uint8Array>({ pull() { started(); }, cancel() { cancelled = true; } }); }
    };
    const pending = store.update({ signal: controller.signal }, replacement);
    await ready;
    controller.abort(new Error("stop updating"));
    await assert.rejects(pending, /stop updating/);
    assert.equal(cancelled, true);
    const failing = data("item.bin");
    failing.payload.content = { stream() { return new ReadableStream({ start(stream) { stream.error(new Error("broken source")); } }); } };
    await assert.rejects(store.update({}, failing), /broken source/);
    const aborted = { signal: AbortSignal.abort(new Error("already cancelled")) };
    await assert.rejects(store.create(aborted, data("new.bin")), /already cancelled/);
    await assert.rejects(store.get(aborted, "item.bin"), /already cancelled/);
    await assert.rejects(store.list(aborted), /already cancelled/);
    await assert.rejects(store.delete(aborted, "item.bin"), /already cancelled/);
    assert.equal(await readFile(join(directory, "item.bin"), "utf8"), "original");
    assert.deepEqual(await readdir(directory), ["item.bin"]);
  });
});

test("create and update consume one-shot sources incrementally and publish only after EOF", async () => {
  for (const mode of ["create", "update"] as const) {
    await withStore(async (store, directory) => {
      if (mode === "update") await store.create({}, data("item.bin", "old"));
      const input = streamingData("item.bin");
      let finished = false;
      const pending = store[mode]({}, input.data).then(() => { finished = true; });
      await input.waiting;
      assert.equal(finished, false);
      assert.equal(input.opens, 1);
      // The second pull occurs only after the first chunk has reached the temp file.
      const temporary = (await readdir(directory)).find((name) => name.startsWith(".memsphere-"))!;
      assert.equal(await readFile(join(directory, temporary), "utf8"), "first");
      if (mode === "create") assert.equal(await store.has({}, "item.bin"), false);
      else assert.equal(await readFile(join(directory, "item.bin"), "utf8"), "old");
      input.controller.enqueue(new TextEncoder().encode("second"));
      input.controller.close();
      await pending;
      assert.equal(finished, true);
      assert.equal(await readFile(join(directory, "item.bin"), "utf8"), "firstsecond");
      assert.deepEqual(await readdir(directory), ["item.bin"]);
    });
  }
});

test("partial streamed writes are not published after source errors or cancellation", async () => {
  for (const mode of ["create", "update"] as const) {
    for (const failure of ["error", "abort"] as const) {
      await withStore(async (store, directory) => {
        const id = "nested/item.bin";
        if (mode === "update") await store.create({}, data(id, "old"));
        const input = streamingData(id);
        const abort = new AbortController();
        const pending = store[mode]({ signal: abort.signal }, input.data);
        const rejected = assert.rejects(pending, /stop partway/);
        await input.waiting;
        if (failure === "error") input.controller.error(new Error("stop partway"));
        else abort.abort(new Error("stop partway"));
        await rejected;
        assert.equal(input.opens, 1);
        if (failure === "abort") assert.equal(input.cancelled, true);
        if (mode === "create") assert.deepEqual(await readdir(directory), []);
        else {
          assert.equal(await readFile(join(directory, "nested", "item.bin"), "utf8"), "old");
          assert.deepEqual(await readdir(join(directory, "nested")), ["item.bin"]);
        }
      });
    }
  }
});

test("append consumes only new bytes progressively and finishes after EOF", async () => {
  await withStore(async (store, directory) => {
    await store.create({}, data("logs/item.bin", "existing"));
    const input = streamingData("logs/item.bin");
    let finished = false;
    const pending = store.append({}, input.data).then((result) => {
      assert.equal(result, undefined);
      finished = true;
    });
    await input.waiting;
    assert.equal(finished, false);
    assert.equal(await readFile(join(directory, "logs", "item.bin"), "utf8"), "existingfirst");
    input.controller.enqueue(new TextEncoder().encode("second"));
    input.controller.close();
    await pending;
    assert.equal(input.opens, 1);
    assert.equal(await readFile(join(directory, "logs", "item.bin"), "utf8"), "existingfirstsecond");
    assert.deepEqual(await readdir(join(directory, "logs")), ["item.bin"]);
  });
});

test("append validates model, content type and existing identity before consuming input", async () => {
  await withStore(async (store, directory) => {
    await store.create({}, data("item.bin", "original"));
    const invalid = [
      data("missing.bin"),
      data("absent/parents/item.bin"),
      data("item.bin", "", "application/octet-stream", "wrong-model"),
      data("item.bin", "", "text/plain"),
      data("../item.bin"),
      data("ITEM.bin")
    ];
    for (const input of invalid) {
      let consumed = false;
      input.payload.content = { stream() { consumed = true; throw new Error("must not consume"); } };
      await assert.rejects(store.append({}, input));
      assert.equal(consumed, false);
    }
    await assert.rejects(store.append({ signal: AbortSignal.abort(new Error("stop before open")) }, data("item.bin")), /stop before open/);
    assert.equal(await readFile(join(directory, "item.bin"), "utf8"), "original");
    assert.deepEqual(await readdir(directory), ["item.bin"]);
  });
});

test("append source failure and cancellation reject without rolling back the written prefix", async () => {
  for (const failure of ["error", "abort"] as const) {
    await withStore(async (store, directory) => {
      await store.create({}, data("item.bin", "original"));
      const input = streamingData("item.bin", "partial");
      const abort = new AbortController();
      const rejected = assert.rejects(store.append({ signal: abort.signal }, input.data), /append interrupted/);
      await input.waiting;
      if (failure === "error") input.controller.error(new Error("append interrupted"));
      else abort.abort(new Error("append interrupted"));
      await rejected;
      assert.equal(await readFile(join(directory, "item.bin"), "utf8"), "originalpartial");
      assert.deepEqual(await readdir(directory), ["item.bin"]);
      assert.equal(input.opens, 1);
      if (failure === "abort") assert.equal(input.cancelled, true);
    });
  }
});
