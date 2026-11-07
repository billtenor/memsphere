import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Config } from "../src/data/api/config.js";
import type { Model } from "../src/data/api/model.js";
import type { ModelRuntimeRegistry } from "../src/data/api/model-runtime.js";
import type { Scalar } from "../src/data/api/reflection.js";
import {
  RAW_MODEL, RawModelRuntime, RawModelRuntimeFactory, rawExtension,
  type RawModelDefinition
} from "../src/data/extensions/raw/index.js";
import { filesystemDataStoreExtension } from "../src/data/extensions/filesystem-datastore/index.js";
import { bytesContent, readAll } from "../src/data/extensions/shared/payload.js";
import { DefaultDataManager } from "../src/data/management/data-manager.js";
import { DefaultDataExtensionRegistry } from "../src/data/management/extension-registry.js";

function model(definition: unknown = {}, id = "tests/artifact.json", metaModel = RAW_MODEL): Model {
  return {
    data: {
      id, model: metaModel,
      payload: {
        contentType: "application/json",
        content: { stream() { throw new Error("Raw runtime must use the decoded definition, not read Payload"); } }
      }
    },
    definition
  };
}

const noDependencies: ModelRuntimeRegistry = {
  get() { throw new Error("Raw runtime must not look up dependencies"); },
  register() { throw new Error("Runtime registration belongs to the caller"); }
};

function compile(definition: unknown = {}, id?: string) {
  return new RawModelRuntimeFactory().createRuntime({}, model(definition, id), noDependencies);
}

test("raw models share a Runtime standard while retaining separate Stores and explicit persistence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memsphere-raw-models-"));
  try {
    const manager = new DefaultDataManager({
      extensions: new DefaultDataExtensionRegistry([rawExtension, filesystemDataStoreExtension]),
      models: [{ model: model({}, "Artifact") }, { model: model({}, "Log") }],
      stores: ["Artifact", "Log"].map(id => ({
        id: `${id}-store`, model: id, kind: "DataStore" as const, factory: "memsphere/filesystem",
        config: new Config({ directory: join(directory, id) })
      }))
    });
    const artifactStore = await manager.getStore({}, "Artifact-store");
    const logStore = await manager.getStore({}, "Log-store");
    if (artifactStore.kind !== "DataStore" || logStore.kind !== "DataStore") throw new Error("Expected raw Stores");
    const id = "same.txt";
    for (const [store, text] of [[artifactStore, "artifact"], [logStore, "log"]] as const) {
      await store.create({}, {
        id, model: store.model,
        payload: { contentType: "text/plain", content: bytesContent(new TextEncoder().encode(text)) }
      });
    }
    const stored = await artifactStore.get({}, id);
    assert.equal(stored?.data.model, "Artifact");
    assert.equal((await logStore.get({}, id))?.data.model, "Log");
    const artifact = await manager.getRuntime({}, "Artifact");
    const value = artifact.reflect(await readAll({}, stored!.data.payload.content));
    if (value.kind !== "scalar") throw new Error("Expected raw bytes scalar");
    const replacement = new TextEncoder().encode("changed artifact");
    value.set(replacement);
    assert.equal(await readFile(join(directory, "Artifact", id), "utf8"), "artifact");
    await artifactStore.update({}, {
      id, model: artifactStore.model,
      payload: { contentType: "text/plain", content: bytesContent(value.value as Uint8Array) }
    });
    assert.equal(await readFile(join(directory, "Artifact", id), "utf8"), "changed artifact");
    assert.equal(await readFile(join(directory, "Log", id), "utf8"), "log");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
