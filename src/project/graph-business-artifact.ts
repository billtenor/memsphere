import { schemaRuntime } from "../context_control/schema-contract.js";
import { MEMSPHERE_SCHEMA_MODEL } from "../memory/schema-model.js";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { withNativeFileLock } from "../file-lock.js";
import { Config } from "../data/api/config.js";
import { parseFilesystemDataStoreConfig } from "../data/extensions/filesystem-datastore/index.js";
import { validateRelativeFilePath } from "../data/extensions/shared/filesystem.js";
import { bytesContent } from "../data/extensions/shared/payload.js";
import { inspectModelArtifactTarget, validateModelArtifactDataId } from "./model-artifact.js";
import { isContextControlStore } from "./context-control-access.js";
import { serviceError } from "./business-stores.js";
import type { BusinessPayload, BusinessTarget, GraphBusinessStores } from "../context_control/business-artifact.js";

export function graphBusinessStores(root: string): GraphBusinessStores {
  async function inspect(target: BusinessTarget) {
    const current = await inspectModelArtifactTarget(root, target.storeId, target.modelRef, target.operation);
    if (current.target.fingerprint !== target.fingerprint)
      throw serviceError("MODEL_ARTIFACT_TARGET_CHANGED", `Restore the frozen Store binding and model before retrying: ${target.storeId}`);
    return current.opened;
  }
  function acceptsBytes(opened: Awaited<ReturnType<typeof inspect>>) {
    const descriptor = opened.runtime.descriptor.root;
    return opened.store.kind === "DataStore" && descriptor.kind === "scalar" && descriptor.scalar === "bytes";
  }
  function validate(opened: Awaited<ReturnType<typeof inspect>>, payload: BusinessPayload) {
    opened.runtime.reflect(acceptsBytes(opened) ? payload.bytes : payload.value);
  }
  function dataId(opened: Awaited<ReturnType<typeof inspect>>, mime: string, fallback: string, requested?: string) {
    if (opened.store.kind === "DataStore" && opened.directory) {
      const mapping = parseFilesystemDataStoreConfig(new Config({ ...opened.binding.config, directory: opened.directory })).extensions;
      const suffix = mapping.find(([, type]) => type === mime)?.[0];
      const id = requested ?? (suffix ? fallback + suffix : fallback);
      validateRelativeFilePath(id);
      const type = mapping.find(([extension]) => id.toLowerCase().endsWith(extension))?.[1];
      if (type !== mime) throw serviceError("INVALID_ARGUMENT", `Record ID must map to MIME ${mime}: ${id}`);
      return id;
    }
    const id = requested ?? fallback;
    validateModelArtifactDataId(id);
    return id;
  }
  return {
    async lock(runId, action) {
      if (!/^run-[\w-]+$/.test(runId)) throw serviceError("INVALID_ARGUMENT", "Invalid graph Run ID");
      const directory = join(await realpath(root), ".runtime", "graph-store-locks");
      await mkdir(directory, { recursive: true });
      return withNativeFileLock(join(directory, `${runId}.lock`), action, { timeoutMs: 0 });
    },
    async freeze(binding, spec) {
      if (isContextControlStore(binding.store_id)) throw serviceError("SYSTEM_STORE_FORBIDDEN", `Artifact requires a business Store: ${binding.store_id}`);
      const { opened, target } = await inspectModelArtifactTarget(root, binding.store_id, undefined, binding.operation);
      const contentType = spec.payload.contentType;
      if (opened.store.kind === "DataStore" && opened.directory)
        dataId(opened, contentType, "artifact");
      if (!acceptsBytes(opened)) {
        const type = opened.runtime.descriptor.root;
        const destinationType = type.kind === "scalar" ? type.scalar : type.kind === "map" ? "object" : type.kind;
        const mime = contentType.split(";")[0].trim().toLowerCase();
        const schemaType = spec.model.definedBy === MEMSPHERE_SCHEMA_MODEL
          ? schemaRuntime(spec.model.definition).contract(contentType).type
          : spec.model.definedBy === "json-schema/draft-07.json" ? JSON.parse(spec.model.definition)?.type : undefined;
        const text = mime === "text/plain" || mime === "text/markdown";
        const sourceType = text && spec.model.definedBy !== MEMSPHERE_SCHEMA_MODEL
          ? "string" : schemaType === "integer" ? "number" : schemaType;
        if (typeof sourceType === "string" && sourceType !== destinationType)
          throw serviceError("STORE_MODEL_MISMATCH", `Artifact type ${sourceType} cannot write to Store type ${destinationType}`);
      }
      return { ...target, operation: binding.operation };
    },
    async prepare(target, payload, defaultId, requestedId, projectValue) {
      const opened = await inspect(target);
      const value = projectValue && !acceptsBytes(opened) ? await projectValue() : payload.value;
      validate(opened, { ...payload, value });
      return { destination: { ...target, dataId: dataId(opened, payload.contentType, defaultId, requestedId) }, value };
    },
    async write(destination, payload) {
      const opened = await inspect(destination);
      validate(opened, payload);
      const id = dataId(opened, payload.contentType, destination.dataId, destination.dataId);
      const store = opened.store;
      if (destination.operation === "create" && store.kind === "DataStore") {
        await store.create({}, { id, model: destination.modelRef, payload: { contentType: payload.contentType, content: bytesContent(payload.bytes) } });
        return { committedAt: new Date().toISOString() };
      }
      if (destination.operation === "upsert" && store.kind === "ValueStore" && store.upsert) {
        const stored = await store.upsert({}, id, payload.value);
        return { committedAt: new Date().toISOString(), ...(stored.revision === undefined ? {} : { revision: stored.revision }) };
      }
      throw serviceError("UNSUPPORTED_CAPABILITY", "Frozen Store operation is no longer supported");
    }
  };
}
