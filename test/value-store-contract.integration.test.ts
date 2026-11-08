// @integration-platform: native — verifies real filesystem, process or build-adapter behavior.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemJsonValueStoreFactory } from "../src/data/extensions/filesystem-json-valuestore/index.js";
import { Config } from "../src/data/api/config.js";
import { checkModelDefinition } from "../src/project/model-validation.js";
import { valueStoreContract } from "./support/value-store-contract.js";
valueStoreContract("filesystem ValueStore", async t => {
  const directory = await mkdtemp(join(tmpdir(), "memsphere-store-contract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { runtime } = await checkModelDefinition({}, { modelRef: "record.json", definition: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } });
  const factory = new FilesystemJsonValueStoreFactory(), config = new Config({ directory });
  const reopen = () => factory.createStore({}, "records", runtime!, config);
  return { store: await reopen(), reopen };
});
