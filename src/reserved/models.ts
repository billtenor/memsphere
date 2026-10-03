import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { JSON_SCHEMA_DRAFT_07 } from "../data/extensions/json-schema/index.js";
import { validateJsonSchemaDefinition } from "../data/extensions/json-schema-metamodel/index.js";
import { RAW_MODEL, RawModelRuntime } from "../data/extensions/raw/index.js";
import { portableNameKey, validateFilename, validateRelativeFilePath } from "../data/extensions/shared/filesystem.js";
import { bytesContent } from "../data/extensions/shared/payload.js";
import { IMPORTED_MODEL_DEFINITIONS_STORE, SYSTEM_JSON_SCHEMA_MODELS_STORE, SYSTEM_RAW_MODELS_STORE, validateModelRegistration, type ModelRegistration } from "../project/model-registration-contract.js";
import { validateModelSchemaReferences } from "../project/model-schema-references.js";

const registrationSchema = z.unknown().transform(value => { validateModelRegistration(value); return value; });
const entrySchema = z.object({ source: z.string().min(1), metaModel: z.enum([JSON_SCHEMA_DRAFT_07, RAW_MODEL]), registration: registrationSchema }).strict();
const nonemptyName = z.string().min(1).refine(value => value.trim() === value && value.length > 0, "name must not have surrounding whitespace");
const packageSchema = z.object({ id: nonemptyName, name: nonemptyName, description: z.string(), models: z.array(entrySchema).min(1) }).strict();
export const reservedModelManifestSchema = z.object({ version: z.literal(1), system_models: z.array(entrySchema).min(1), market_packages: z.array(packageSchema) }).strict();
export type ReservedModelManifest = z.infer<typeof reservedModelManifestSchema>;
export type BundledModelDescriptor = {
  sourcePath: string;
  source: string;
  definition: unknown;
  metaModel: string;
  registration: ModelRegistration;
};
export type BundledModelPackage = { id: string; name: string; description: string; models: BundledModelDescriptor[] };
export type ReservedModelCatalog = { manifest: ReservedModelManifest; systemModels: BundledModelDescriptor[]; marketPackages: BundledModelPackage[] };

export function bundledReservedModelsRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../reserved-models");
}

function assertDirectory(path: string): void {
  if (!lstatSync(path).isDirectory()) throw new TypeError(`Model asset parent is not a regular directory: ${path}`);
}

/** Read only ordinary files through ordinary parents; never create paths or follow asset symlinks. */
function readSource(root: string, path: string): string {
  validateRelativeFilePath(path);
  const segments = path.split("/");
  let current = root;
  assertDirectory(current);
  for (const [index, segment] of segments.entries()) {
    const names = readdirSync(current);
    const aliases = names.filter(name => portableNameKey(name) === portableNameKey(segment));
    if (aliases.length !== 1 || aliases[0] !== segment) throw new TypeError(`Missing or ambiguous model asset path: ${path}`);
    current = join(current, segment);
    if (index !== segments.length - 1) assertDirectory(current);
  }
  if (!lstatSync(current).isFile()) throw new TypeError(`Model asset is not a regular file: ${path}`);
  const handle = openSync(current, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW));
  try {
    if (!fstatSync(handle).isFile()) throw new TypeError(`Model asset is not a regular file: ${path}`);
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(handle));
  } finally { closeSync(handle); }
}

function sourceFiles(root: string, prefix: string): string[] {
  const path = join(root, prefix);
  assertDirectory(path);
  const result: string[] = [];
  const names = new Set<string>();
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    validateFilename(entry.name);
    const key = portableNameKey(entry.name);
    if (names.has(key)) throw new TypeError(`Ambiguous model asset filename: ${prefix}/${entry.name}`);
    names.add(key);
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) result.push(...sourceFiles(root, relative));
    else if (!entry.isFile()) throw new TypeError(`Model asset is not a regular file: ${relative}`);
    else if (entry.name.endsWith(".json")) result.push(relative);
  }
  return result;
}

/** Synchronous for existing bootstrap callers; definitions have one source and one validation path. */
export function readReservedModelCatalog(sourceRoot = bundledReservedModelsRoot()): ReservedModelCatalog {
  const root = resolve(sourceRoot);
  const manifest = reservedModelManifestSchema.parse(JSON.parse(readSource(root, "manifest.json").replace(/^\uFEFF/, "")));
  const identities = new Set<string>();
  const packageIds = new Set<string>();
  const sources = new Map<string, { source: string; definition: unknown }>();
  const readEntry = (entry: z.infer<typeof entrySchema>, area: "system" | "market", pack?: { id: string; name: string }): BundledModelDescriptor => {
    validateRelativeFilePath(entry.source);
    validateRelativeFilePath(entry.registration.modelRef);
    const prefix = area === "system" ? "system-models/" : "market-models/";
    if (!entry.source.startsWith(prefix) || !entry.source.endsWith(".json")) throw new TypeError(`Invalid ${area} model asset source: ${entry.source}`);
    const registration = entry.registration;
    const identityKey = portableNameKey(registration.modelRef);
    if (identities.has(identityKey)) throw new TypeError(`Duplicate bundled modelRef: ${registration.modelRef}`);
    identities.add(identityKey);
    const storeId = area === "market" ? IMPORTED_MODEL_DEFINITIONS_STORE : entry.metaModel === RAW_MODEL ? SYSTEM_RAW_MODELS_STORE : SYSTEM_JSON_SCHEMA_MODELS_STORE;
    if (registration.storage !== "store" || registration.store_id !== storeId) throw new TypeError(`Invalid bundled model Store binding: ${registration.modelRef}`);
    if (area === "market" && entry.metaModel !== JSON_SCHEMA_DRAFT_07) throw new TypeError(`Unsupported market model standard: ${entry.metaModel}`);
    if (registration.package !== (pack?.id ?? "memsphere.builtin") || registration.package_name !== (pack?.name ?? "Memsphere 内置")) throw new TypeError(`Invalid bundled model package: ${registration.modelRef}`);
    let loaded = sources.get(entry.source);
    if (!loaded) {
      const source = readSource(root, entry.source);
      loaded = { source, definition: JSON.parse(source.replace(/^\uFEFF/, "")) as unknown };
      sources.set(entry.source, loaded);
    }
    if (entry.metaModel === JSON_SCHEMA_DRAFT_07) validateJsonSchemaDefinition(loaded.definition);
    else new RawModelRuntime({ data: { id: registration.modelRef, model: RAW_MODEL, payload: { contentType: "application/json", content: bytesContent(Buffer.from(loaded.source)) } }, definition: loaded.definition });
    return { sourcePath: join(root, entry.source), source: loaded.source, definition: structuredClone(loaded.definition), metaModel: entry.metaModel, registration: structuredClone(registration) };
  };
  const systemModels = manifest.system_models.map(entry => readEntry(entry, "system"));
  const marketPackages = manifest.market_packages.map(pack => {
    if (packageIds.has(pack.id)) throw new TypeError(`Duplicate model market package: ${pack.id}`);
    packageIds.add(pack.id);
    const models = pack.models.map(entry => readEntry(entry, "market", pack));
    validateModelSchemaReferences(models);
    return { id: pack.id, name: pack.name, description: pack.description, models };
  });
  validateModelSchemaReferences(systemModels.filter(model => model.metaModel === JSON_SCHEMA_DRAFT_07));
  for (const source of [...sourceFiles(root, "system-models"), ...sourceFiles(root, "market-models")]) {
    if (!sources.has(source)) throw new TypeError(`Model asset is missing from manifest: ${source}`);
  }
  return { manifest, systemModels, marketPackages };
}

export function readBundledSystemModels(sourceRoot = bundledReservedModelsRoot()): BundledModelDescriptor[] {
  return readReservedModelCatalog(sourceRoot).systemModels;
}

export function readBundledMarketModelPackages(sourceRoot = bundledReservedModelsRoot()): BundledModelPackage[] {
  return readReservedModelCatalog(sourceRoot).marketPackages;
}
