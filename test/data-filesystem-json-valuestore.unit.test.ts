import assert from "node:assert/strict";
import test from "node:test";
import { FilesystemJsonValueStoreFactory, filesystemJsonValueStoreExtension } from "../src/data/extensions/filesystem-json-valuestore/index.js";


test("filesystem JSON ValueStore is one independent ValueStore factory", () => {
  assert.equal(filesystemJsonValueStoreExtension.id, "memsphere/filesystem-json-valuestore");
  assert.equal(filesystemJsonValueStoreExtension.version, "0.1.0");
  assert.equal(filesystemJsonValueStoreExtension.valueStoreFactories?.length, 1);
  assert.equal(filesystemJsonValueStoreExtension.valueStoreFactories?.[0].id, "memsphere/filesystem-json");
  assert.equal(new FilesystemJsonValueStoreFactory().id, "memsphere/filesystem-json");
  assert.equal("dataStoreFactories" in filesystemJsonValueStoreExtension, false);
  assert.equal("payloadSerializers" in filesystemJsonValueStoreExtension, false);
});
