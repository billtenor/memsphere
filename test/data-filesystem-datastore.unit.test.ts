import assert from "node:assert/strict";
import test from "node:test";
import { Config, type JsonObject } from "../src/data/api/config.js";
import { FilesystemDataStoreFactory, filesystemDataStoreExtension } from "../src/data/extensions/filesystem-datastore/index.js";


const MODEL = "example/file-v1.json";

const STORE = "example/files";

const factory = new FilesystemDataStoreFactory();


test("filesystem extension supplies one independent DataStore factory", () => {
  assert.equal(filesystemDataStoreExtension.id, "memsphere/filesystem-datastore");
  assert.equal(filesystemDataStoreExtension.version, "0.1.0");
  assert.equal(filesystemDataStoreExtension.dataStoreFactories?.length, 1);
  assert.equal(filesystemDataStoreExtension.dataStoreFactories?.[0].id, "memsphere/filesystem");
  assert.equal(factory.id, "memsphere/filesystem");
  assert.equal("payloadSerializers" in filesystemDataStoreExtension, false);
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
