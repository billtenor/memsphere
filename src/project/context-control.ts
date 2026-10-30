import { withContextControlAccess } from "./context-control-access.js";
import { readModelOperationStamp } from "./model-operation.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Context } from "../data/api/context.js";
import { JsonPayloadSerializer } from "../data/extensions/json-serializer/index.js";
import { readAll } from "../data/extensions/shared/payload.js";
import { withNativeFileLock } from "../file-lock.js";
import { ContextControl, failure, type Stores, type RunLock, type ContentReader } from "../context_control/service.js";
import { ENTITIES, modelId, storeId, definitionHash, readContextControlModels } from "../context_control/model-assets.js";
import { createBusinessStore, openBusinessStore, readBusinessProject } from "./business-stores.js";
import { checkModelDefinition } from "./model-validation.js";
import { mutateModel } from "./model-service.js";
import { createProjectModelHost } from "./models.js";

export async function openContextControl(root: string, initialize = false, legacyUpgrade = false): Promise<ContextControl | undefined> {
  if (initialize) await initializeContextControl(root);
  return withContextControlAccess(root, async () => {
    const service = await openContextControlUnlocked(root, legacyUpgrade);
    if (!service) return undefined;
    let stamp = await readModelOperationStamp(root);
    return new Proxy(service, { get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => withContextControlAccess(root, async () => {
        const latest = await readModelOperationStamp(root);
        if (latest !== stamp) {
          const fresh = await openContextControlUnlocked(root, legacyUpgrade);
          if (!fresh) throw failure("STORE_INCOMPATIBLE", "Context control bindings were removed");
          Object.assign(target.stores, fresh.stores); stamp = latest;
        }
        return value.apply(target, args);
      });
    } });
  });
}

async function openContextControlUnlocked(root: string, legacyUpgrade: boolean): Promise<ContextControl | undefined> {
  const config = await readBusinessProject(root);
  const bindings = ENTITIES.map(e => config.dataStores?.[storeId(e)]);
  if (bindings.every(b => !b)) return undefined;
  if (bindings.some(b => !b)) throw failure("INITIALIZATION_INCOMPLETE", "Context control Store bindings are incomplete; start a free exploration to initialize");
  if (!legacyUpgrade) {
    const host = await createProjectModelHost({}, { root, ...config });
    for (const asset of readContextControlModels()) {
      if (!isDeepStrictEqual((await host.definition(asset.id)).definition, asset.definition)) throw failure("MODEL_INCOMPATIBLE", `Context control models need an explicit upgrade: memsphere project models initialize (${asset.id})`);
    }
  }
  const stores = {} as Stores;
  for (const entity of ENTITIES) {
    const oldSource = legacyUpgrade ? (await (await createProjectModelHost({}, { root, ...config })).source(modelId(entity))).source : undefined;
    const runtime = oldSource === undefined ? undefined : (await checkModelDefinition({}, { modelRef: modelId(entity), source: oldSource, definition: JSON.parse(oldSource.replace(/^\uFEFF/, "")) })).runtime;
    const opened = await openBusinessStore({}, root, storeId(entity), { runtime });
    if (opened.store.kind !== "ValueStore" || opened.binding.model !== modelId(entity)) throw failure("STORE_INCOMPATIBLE", `Wrong context control Store: ${storeId(entity)}`);
    stores[entity] = opened.store;
  }
  const lock: RunLock = async (runId, action, signal) => {
    const dir = join(root, ".runtime", "context-control"); await mkdir(dir, { recursive: true });
    const key = createHash("sha256").update(runId).digest("hex");
    return withNativeFileLock(join(dir, `${key}.lock`), action, { signal });
  };
  const contentReader: ContentReader = async (ref, context) => {
    const opened = await openBusinessStore(context, root, ref.storeId);
    const row = await opened.store.get(context, ref.dataId);
    if (!row) throw failure("NOT_FOUND", `Referenced content not found: ${ref.storeId}/${ref.dataId}`);
    if ("data" in row) return { bytes: await readAll(context, row.data.payload.content), contentType: row.data.payload.contentType };
    const content = await new JsonPayloadSerializer().serialize(context, opened.runtime.descriptor, row.value);
    return { bytes: await readAll(context, content), contentType: "application/json" };
  };
  return new ContextControl(stores, lock, contentReader);
}

export async function initializeContextControl(root: string) {
  const assets = readContextControlModels();
  for (const asset of assets) {
    const config = await readBusinessProject(root);
    const host = await createProjectModelHost({}, { root, ...config });
    const existing = (await host.list()).find(m => m.id === asset.id);
    if (!existing) {
      try { await mutateModel({}, root, "create", asset.id, { source: asset.source, fields: { name: asset.name, package: asset.package, package_name: asset.packageName } }); }
      catch (error) { if ((error as { code?: string }).code !== "ALREADY_EXISTS") throw error; }
    } else {
      const saved = await host.definition(asset.id);
      if (!isDeepStrictEqual(saved.definition, asset.definition)) {
        if (config.dataStores?.[storeId(asset.entity)] || definitionHash(saved.definition) !== asset.baselineSha256) throw failure("MODEL_INCOMPATIBLE", `Context control model differs; update explicitly before starting: ${asset.id}`);
        await mutateModel({}, root, "update", asset.id, { source: asset.source });
      }
    }
    const current = await readBusinessProject(root);
    const binding = current.dataStores?.[storeId(asset.entity)];
    if (!binding) {
      try { await createBusinessStore({}, root, storeId(asset.entity), { kind: "value", model: asset.id, factory: "memsphere/filesystem-json", config: { directory: `data/context_control/${asset.entity}s` } }); }
      catch (error) { if ((error as { code?: string }).code !== "ALREADY_EXISTS") throw error; }
    }
    // A concurrent initializer may have won. Always check the actual installed binding.
    const opened = await openBusinessStore({}, root, storeId(asset.entity));
    if (opened.store.kind !== "ValueStore" || opened.binding.model !== asset.id) throw failure("STORE_INCOMPATIBLE", `Wrong Store binding: ${storeId(asset.entity)}`);
    const installed = await (await createProjectModelHost({}, { root, ...await readBusinessProject(root) })).definition(asset.id);
    if (!isDeepStrictEqual(installed.definition, asset.definition)) throw failure("MODEL_INCOMPATIBLE", `Wrong model definition: ${asset.id}`);
  }
}
