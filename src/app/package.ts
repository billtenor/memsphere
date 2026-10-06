import { readFile, realpath } from "node:fs/promises";
import { Ajv } from "ajv";
import { appManifestSchema, cliDescriptorSchema, modelPackageSchema, AppError, type AppManifest } from "./contracts.js";
import { digest, packageDigest, packagePath, readJson } from "./files.js";
import { parseMemoryYaml } from "../memory/yaml.js";
import { parseMemoryEntity } from "../memory/store.js";
import { memoryKinds, memoryKindTags } from "../memory/kinds.js";
import { moduleManifestSchema } from "../module/manifest.js";
import type { AppInstallation } from "./state.js";

export async function readAppPackage(directory: string) {
  const root = await realpath(directory);
  const manifest = appManifestSchema.parse(await readJson(await packagePath(root, "app.json")));
  const memories: Array<AppInstallation["memories"][number] & { source: Buffer }> = [];
  for (const asset of manifest.assets.memories) {
    const source = await readFile(await packagePath(root, asset.path));
    const raw = parseMemoryYaml(source.toString("utf8"));
    const kind = memoryKinds.find(kind => raw && typeof raw === "object" && (raw as { tag?: string }).tag === memoryKindTags[kind]);
    if (!kind) throw new AppError("APP_INVALID_MEMORY", `Unknown Memory kind: ${asset.path}`);
    const entity = parseMemoryEntity(kind, raw);
    memories.push({ key: asset.key, path: `${kind}/app-${digest(manifest.id).slice(0, 16)}-${asset.key}.yaml`,
      reference: `${kind}/${entity.names[0]}`, digest: digest(source), source });
  }
  if (new Set(memories.map(m => m.reference)).size !== memories.length) throw new AppError("APP_DUPLICATE_MEMORY", "Duplicate Memory identity");
  const descriptors = await Promise.all(manifest.assets.cliDescriptors.map(async asset => cliDescriptorSchema.parse(await readJson(await packagePath(root, asset.path)))));
  if (new Set(descriptors.map(d => d.id)).size !== descriptors.length) throw new AppError("CLI_CONFLICT", "Duplicate CLI identity");
  const views = await Promise.all(manifest.assets.viewPackages.map(async asset => {
    const path = await packagePath(root, asset.path);
    const definition = moduleManifestSchema.parse(await readJson(await packagePath(path, "module.json")));
    await packagePath(path, definition.view.entry.replace(/^\.\//, ""));
    return { key: asset.key, path, definition, digest: await packageDigest(path) };
  }));
  const models = await Promise.all(manifest.assets.modelPackages.map(async asset => {
    const path = await packagePath(root, asset.path);
    const definition = modelPackageSchema.parse(await readJson(await packagePath(path, "model-package.json")));
    if (new Set(definition.models.map(model => model.modelRef)).size !== definition.models.length)
      throw new AppError("APP_MODEL_CONFLICT", `Duplicate modelRef in package: ${definition.id}`);
    for (const model of definition.models) await packagePath(path, model.path);
    return { key: asset.key, path, definition, digest: await packageDigest(path) };
  }));
  for (const extension of manifest.assets.dataExtensions) await packagePath(root, extension.entry);
  if (manifest.backend) await packagePath(root, manifest.backend.entry);
  if (manifest.configuration) await packagePath(root, manifest.configuration);
  return { root, manifest, memories, descriptors, views, models, packageDigest: await packageDigest(root) };
}
export async function validateAppConfig(root: string, manifest: AppManifest, input: unknown): Promise<Record<string, unknown>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError("APP_CONFIG_INVALID", "Configuration must be an object");
  if (manifest.configuration) {
    const schema = await readJson(await packagePath(root, manifest.configuration));
    const validate = new Ajv({ allErrors: true, strict: false, ownProperties: true }).compile(schema as object);
    if (!validate(input)) throw new AppError("APP_CONFIG_INVALID", "App configuration does not match its Schema", validate.errors);
  }
  return structuredClone(input as Record<string, unknown>);
}
export function resolveConfigValues(value: unknown, config: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map(v => resolveConfigValues(v, config));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 1 && typeof record.configKey === "string") {
      if (!Object.hasOwn(config, record.configKey)) throw new AppError("APP_CONFIG_MISSING", `Missing configuration: ${record.configKey}`);
      return config[record.configKey];
    }
    return Object.fromEntries(Object.entries(record).map(([key, v]) => [key, resolveConfigValues(v, config)]));
  }
  return value;
}
