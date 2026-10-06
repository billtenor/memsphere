import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Context } from "../data/api/context.js";
import type { DataStore } from "../data/api/data-store.js";
import { Config } from "../data/api/config.js";
import { FilesystemDataStoreFactory } from "../data/extensions/filesystem-datastore/index.js";
import { JSON_SCHEMA_DRAFT_07 } from "../data/extensions/index.js";
import { bytesContent, readAll } from "../data/extensions/shared/payload.js";
import { atomicWriteJson } from "../persistence.js";
import { readBundledMarketModelPackages } from "../reserved/models.js";
import { checkModelDefinition } from "./model-validation.js";
import { commitModelOperation, optionalFileBytes, recoverModelOperation, type ModelFileChange } from "./model-operation.js";
import { validateModelSchemaReferences } from "./model-schema-references.js";
import { createProjectModelHost } from "./models.js";
import { createModelRegistrationStore, IMPORTED_MODEL_DEFINITIONS_STORE, pathExists, readModelRegistrations, validateModelRegistration, type ProjectModelInput, type ModelRegistration } from "./model-registration.js";
export type ModelMarketPackage = {
  id: string;
  name: string;
  description: string;
  models: {
    registration: ModelRegistration;
    definition: unknown;
    source: string;
    metaModel: string;
  }[];
};
export function listModelMarket(sourceRoot?: string): ModelMarketPackage[] {
  return readBundledMarketModelPackages(sourceRoot).map(pack => ({ ...pack, models: pack.models.map(({ sourcePath: _sourcePath, ...model }) => model) }));
}
/** Caller serializes this operation with Project settings/config mutation. */
export async function importModelMarketPackage(context: Context, input: ProjectModelInput, packageId: string, options: {
  sourceRoot?: string;
  afterStage?: () => Promise<void>;
  beforePublish?: () => Promise<void>;
  removeCandidate?: (path: string) => Promise<void>;
} = {}) {
  await recoverModelOperation(input.root);
  const pack = listModelMarket(options.sourceRoot).find(p => p.id === packageId);
  if (!pack) throw Object.assign(new Error(`Unknown model package: ${packageId}`), { code: "MODEL_PACKAGE_NOT_FOUND" });
  // Validate the complete package before writing even a candidate directory.
  for (const model of pack.models) {
    validateModelRegistration(model.registration);
    await checkModelDefinition(context, { modelRef: model.registration.modelRef, ...model });
  }
  const state = await readModelRegistrations(context, input);
  if (state.diagnostics.length) throw new TypeError("Cannot import with damaged registration records");
  const stagingRoot = join(state.paths.registrationDirectory, "staging");
  if (await pathExists(stagingRoot) && (await readdir(stagingRoot)).length)
    throw Object.assign(new Error("Pending model import candidate requires explicit cleanup"), { code: "MODEL_IMPORT_CLEANUP_REQUIRED" });
  const importedRoot = join(state.paths.registrationDirectory, "imported");
  if (await pathExists(importedRoot)) {
    const publishedRecords = new Set(state.records.filter(record => record.origin === "market").map(record => `${record.id}.json`));
    const pending = (await readdir(importedRoot)).filter(name => !name.startsWith(".memsphere-") && !publishedRecords.has(name));
    if (pending.length) throw Object.assign(new Error("Unpublished import registrations require explicit cleanup"), { code: "MODEL_IMPORT_CLEANUP_REQUIRED", pendingModelRefs: pending });
  }
  const host = await createProjectModelHost(context, input);
  const summaries = await host.list();
  let identical = 0;
  const conflicts: string[] = [];
  for (const model of pack.models) {
    const existing = summaries.find(item => item.id === model.registration.modelRef);
    if (existing) {
      const record = state.records.find(item => item.registration.modelRef === existing.id);
      if (record?.origin === "market" && existing.status === "available" && isDeepStrictEqual(record.registration, model.registration) && (await host.definition(existing.id)).source === model.source) identical++;
      else conflicts.push(existing.id);
    }
  }
  if (conflicts.length || identical && identical !== pack.models.length) throw Object.assign(new Error(`Existing content differs; package not imported: ${conflicts.join(", ")}`), { code: "MODEL_PACKAGE_CONFLICT", conflicts });
  if (identical === pack.models.length) return { status: "unchanged" as const, package: packageId, modelRefs: pack.models.map(model => model.registration.modelRef) };
  const changes: ModelFileChange[] = [];
  const recordIds: string[] = [];
  for (const model of pack.models) {
    const path = join(state.paths.registrationDirectory, "imported-definitions", model.registration.modelRef);
    const before = await optionalFileBytes(path);
    if (before) throw Object.assign(new Error(`Unpublished model exists: ${model.registration.modelRef}`), { code: "MODEL_IMPORT_CLEANUP_REQUIRED" });
    changes.push({ path, before, after: Buffer.from(model.source) });
    const id = randomUUID(); recordIds.push(id);
    const recordPath = join(state.paths.registrationDirectory, "imported", `${id}.json`);
    changes.push({ path: recordPath, before: undefined, after: Buffer.from(`${JSON.stringify({ id, revision: 1, createdAt: Date.now(), updatedAt: Date.now(), value: model.registration }, null, 2)}\n`) });
  }
  const publicationPath = join(state.paths.registrationDirectory, "published-imports.json");
  const before = await optionalFileBytes(publicationPath);
  const prior = before ? JSON.parse(before.toString("utf8")) as { recordIds: string[] } : { recordIds: [] };
  if (!Array.isArray(prior.recordIds) || prior.recordIds.some(id => typeof id !== "string")) throw new TypeError("Invalid publication state");
  changes.push({ path: publicationPath, before, after: Buffer.from(`${JSON.stringify({ recordIds: [...prior.recordIds, ...recordIds] }, null, 2)}\n`) });
  await options.afterStage?.();
  context.signal?.throwIfAborted();
  await commitModelOperation(input.root, "model.market.import", changes, { afterFile: async index => {
    if (index === changes.length - 2) { await options.beforePublish?.(); context.signal?.throwIfAborted(); }
  } });
  return { status: "imported" as const, package: packageId, modelRefs: pack.models.map(model => model.registration.modelRef) };
}
/** Explicit recovery of known import candidates; published package content is never removed. */
export async function cleanupModelMarketCandidates(context: Context, input: ProjectModelInput) {
  const state = await readModelRegistrations(context, input);
  const root = state.paths.registrationDirectory;
  const stagingRoot = join(root, "staging");
  if (!await pathExists(stagingRoot))
    return { cleanedModelRefs: [] as string[] };
  const publicationPath = join(root, "published-imports.json");
  const published = await pathExists(publicationPath) ? JSON.parse(await readFile(publicationPath, "utf8")) as {
    recordIds: string[];
  } : { recordIds: [] };
  const definitionStore = await new FilesystemDataStoreFactory().createStore(context, IMPORTED_MODEL_DEFINITIONS_STORE, JSON_SCHEMA_DRAFT_07, new Config({ directory: join(root, "imported-definitions") }));
  const recordStore = await createModelRegistrationStore(context, "model-import-cleanup", join(root, "imported"));
  const cleanedModelRefs: string[] = [];
  for (const entry of await readdir(stagingRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9-]{36}$/.test(entry.name))
      throw new TypeError(`Unknown model import candidate: ${entry.name}`);
    const stage = join(stagingRoot, entry.name);
    const receiptPath = join(stage, "candidate.json");
    if (!await pathExists(receiptPath)) {
      if ((await readdir(stage)).length)
        throw new TypeError(`Missing candidate receipt: ${entry.name}`);
      await rm(stage, { recursive: true });
      continue;
    }
    const receipt: unknown = JSON.parse(await readFile(receiptPath, "utf8"));
    if (!receipt || typeof receipt !== "object" || !("packageId" in receipt) || typeof receipt.packageId !== "string" || !("recordIds" in receipt) || !Array.isArray(receipt.recordIds) || receipt.recordIds.some(id => typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) || !("modelRefs" in receipt) || !Array.isArray(receipt.modelRefs) || receipt.modelRefs.some(id => typeof id !== "string"))
      throw new TypeError(`Invalid candidate receipt: ${entry.name}`);
    const pack = listModelMarket().find(p => p.id === receipt.packageId);
    // Retiring a market listing must not strand its existing import candidates.
    const modelRefs = pack?.models.map(m => m.registration.modelRef)
      ?? (receipt.packageId === "memsphere.examples.orders" ? ["memsphere/examples/order.json"] : undefined);
    if (!modelRefs || !isDeepStrictEqual(receipt.modelRefs, modelRefs) || receipt.recordIds.length !== modelRefs.length)
      throw new TypeError(`Unrecognized candidate package: ${entry.name}`);
    for (const [index, id] of (receipt.recordIds as string[]).entries()) {
      context.signal?.throwIfAborted();
      if (!published.recordIds.includes(id)) {
        await recordStore.delete(context, id);
        await definitionStore.delete(context, (receipt.modelRefs as string[])[index]!);
      }
      cleanedModelRefs.push((receipt.modelRefs as string[])[index]!);
    }
    await rm(stage, { recursive: true, force: true });
  }
  return { cleanedModelRefs: [...new Set(cleanedModelRefs)] };
}
