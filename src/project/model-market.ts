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
import { validateJsonSchemaDefinition } from "../data/extensions/json-schema-metamodel/index.js";
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
export function listModelMarket(): ModelMarketPackage[] {
  return readBundledMarketModelPackages().map(pack => ({ ...pack, models: pack.models.map(({ sourcePath: _sourcePath, ...model }) => model) }));
}
/** Caller serializes this operation with Project settings/config mutation. */
export async function importModelMarketPackage(context: Context, input: ProjectModelInput, packageId: string, options: {
  afterStage?: () => Promise<void>;
  beforePublish?: () => Promise<void>;
  removeCandidate?: (path: string) => Promise<void>;
} = {}) {
  const pack = listModelMarket().find(p => p.id === packageId);
  if (!pack)
    throw Object.assign(new Error(`Unknown model package: ${packageId}`), { code: "MODEL_PACKAGE_NOT_FOUND" });
  const state = await readModelRegistrations(context, input);
  if (state.diagnostics.length)
    throw new TypeError("Cannot import with damaged registration records");
  const host = await createProjectModelHost(context, input);
  const summaries = await host.list();
  const conflicts: string[] = [];
  let identical = 0;
  for (const model of pack.models) {
    validateModelRegistration(model.registration);
    const registered = state.records.find(r => r.registration.modelRef === model.registration.modelRef);
    const existing = summaries.find(s => s.id === model.registration.modelRef);
    if (existing) {
      if (registered?.origin === "market" && existing.status === "available" && isDeepStrictEqual(registered.registration, model.registration) && (await host.definition(existing.id)).source === model.source)
        identical++;
      else
        conflicts.push(model.registration.modelRef);
    }
    // The complete definition standard is independent of the business reflection subset.
    validateJsonSchemaDefinition(model.definition);
  }
  validateModelSchemaReferences(pack.models);
  if (conflicts.length || identical && identical !== pack.models.length)
    throw Object.assign(new Error(`Existing content differs; package not imported: ${conflicts.join(", ")}`), { code: "MODEL_PACKAGE_CONFLICT", conflicts });
  if (identical === pack.models.length)
    return { status: "unchanged" as const, package: packageId, modelRefs: pack.models.map(m => m.registration.modelRef) };
  const root = state.paths.registrationDirectory;
  const stagingRoot = join(root, "staging");
  if (await pathExists(stagingRoot)) {
    const candidates = await readdir(stagingRoot);
    if (candidates.length)
      throw Object.assign(new Error("Pending model import candidate requires cleanup before retry"), { code: "MODEL_IMPORT_CLEANUP_REQUIRED", pendingModelRefs: pack.models.map(m => m.registration.modelRef) });
  }
  const stage = join(stagingRoot, randomUUID());
  await mkdir(stage, { recursive: true });
  const candidateIds = pack.models.map(() => randomUUID());
  const created: {
    kind: "record" | "definition";
    id: string;
  }[] = [];
  let finalStore: DataStore | undefined;
  let recordStore: Awaited<ReturnType<typeof createModelRegistrationStore>> | undefined;
  const publicationPath = join(root, "published-imports.json");
  try {
    await atomicWriteJson(join(stage, "candidate.json"), { packageId, recordIds: candidateIds, modelRefs: pack.models.map(m => m.registration.modelRef) });
    const stageRecords = await createModelRegistrationStore(context, "model-import-candidate", join(stage, "imported"));
    for (const [index, model] of pack.models.entries()) {
      await stageRecords.create(context, candidateIds[index]!, model.registration);
      const path = join(stage, "definitions", model.registration.modelRef);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(model.source), { flag: "wx" });
      if (!(await readFile(path)).equals(Buffer.from(model.source)))
        throw new Error("Candidate definition byte verification failed");
    }
    await options.afterStage?.();
    context.signal?.throwIfAborted();
    // Only registered/published records are read by the host. Raw candidate files are never discovered.
    finalStore = await new FilesystemDataStoreFactory().createStore(context, IMPORTED_MODEL_DEFINITIONS_STORE, JSON_SCHEMA_DRAFT_07, new Config({ directory: join(root, "imported-definitions") }));
    recordStore = await createModelRegistrationStore(context, "model-imported", join(root, "imported"));
    for (const [index, model] of pack.models.entries()) {
      if (await finalStore.has(context, model.registration.modelRef))
        throw Object.assign(new Error(`Unpublished model content exists: ${model.registration.modelRef}`), { code: "MODEL_IMPORT_CLEANUP_REQUIRED", pendingModelRefs: [model.registration.modelRef] });
      await finalStore.create(context, { id: model.registration.modelRef, model: JSON_SCHEMA_DRAFT_07, payload: { contentType: "application/json", content: bytesContent(Buffer.from(model.source)) } });
      created.push({ kind: "definition", id: model.registration.modelRef });
      const stored = await finalStore.get(context, model.registration.modelRef);
      if (!stored || !Buffer.from(await readAll(context, stored.data.payload.content)).equals(Buffer.from(model.source)))
        throw new Error("Imported model byte verification failed");
      await recordStore.create(context, candidateIds[index]!, model.registration);
      created.push({ kind: "record", id: candidateIds[index]! });
    }
    await options.beforePublish?.();
    context.signal?.throwIfAborted();
    const old = await pathExists(publicationPath) ? JSON.parse(await readFile(publicationPath, "utf8")) as {
      recordIds: string[];
    } : { recordIds: [] };
    await atomicWriteJson(publicationPath, { recordIds: [...old.recordIds, ...candidateIds] });
    // The complete package is now published. Cleanup failure does not misreport a successful import as failed.
    let pendingCleanup = false;
    try {
      await rm(stage, { recursive: true, force: true });
    }
    catch {
      pendingCleanup = true;
    }
    return { status: "imported" as const, package: packageId, modelRefs: pack.models.map(m => m.registration.modelRef), ...(pendingCleanup ? { pendingCleanup: true, pendingModelRefs: pack.models.map(m => m.registration.modelRef) } : {}) };
  }
  catch (error) {
    const pending: string[] = [];
    for (const item of created.reverse())
      try {
        if (item.kind === "record")
          await recordStore!.delete({}, item.id);
        else
          await finalStore!.delete({}, item.id);
      }
      catch {
        pending.push(item.id);
      }
    try {
      if (options.removeCandidate)
        await options.removeCandidate(stage);
      else
        await rm(stage, { recursive: true, force: true });
    }
    catch {
      pending.push(...pack.models.map(m => m.registration.modelRef));
    }
    if (pending.length)
      throw Object.assign(new Error(`Import failed; pending cleanup: ${pending.join(", ")}`), { code: "MODEL_IMPORT_CLEANUP_REQUIRED", pendingModelRefs: pending, cause: error });
    throw error;
  }
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
