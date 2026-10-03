import { z } from "zod";
import { isAbsolute, posix } from "node:path";
import { projectControlPlaneConfigSchema } from "../control-plane/schema.js";
import { projectViewConfigSchema } from "../view/package-config.js";

export const projectNamePattern = /^[a-z0-9._-]+$/;
export const projectNameSchema = z.string().min(1).regex(projectNamePattern, {
  message: "project name may only contain lowercase ASCII letters, digits, '.', '_' and '-'"
}).refine(isPortableProjectName, {
  message: "project name must be a portable directory name and not a Windows reserved device name"
});

export const projectManifestSchema = z.object({
  format_version: z.literal(1),
  name: projectNameSchema,
  created_at: z.string().datetime()
}).strict();

const managedStoreSchema = z.object({
  type: z.literal("managed"),
  branch: z.string().min(1).default("master"),
  upstream: z.string().min(1).optional(),
  published_revision: z.string().min(1)
}).strict();

const embeddedStoreSchema = z.object({
  type: z.literal("embedded"),
  repository_path: z.string().min(1).refine(isAbsolute, "repository_path must be absolute"),
  memory_path: z.string().min(1).refine(isSafeRepositoryRelativePath, {
    message: "memory_path must be a normalized repository-relative path"
  })
}).strict();

const modelStorePathSchema = z.string().refine(value => value.trim().length > 0 && !value.includes("\0"), "must be a nonblank path without NUL characters");
export const modelRegistrationConfigSchema = z.object({
  storeId: z.string().min(1).refine(value => value.trim().length > 0, "store ID must not be blank"),
  stores: z.record(z.string().min(1), z.object({
    factory: z.literal("memsphere/filesystem-json"), directory: modelStorePathSchema
  }).strict()),
  excludedDirectories: z.array(modelStorePathSchema).optional()
}).strict().superRefine((config, context) => {
  if (!Object.hasOwn(config.stores, config.storeId)) context.addIssue({ code: "custom", path: ["storeId"], message: "selected Store ID has no configuration" });
});

export const projectConfigSchema = z.object({
  store: z.discriminatedUnion("type", [managedStoreSchema, embeddedStoreSchema]),
  modelsDirectory: z.string().refine(value => value.trim().length > 0 && !value.includes("\0"), "modelsDirectory must be a nonblank path without NUL characters").optional(),
  modelRegistration: modelRegistrationConfigSchema.optional(),
  control_plane: projectControlPlaneConfigSchema.optional(),
  view: projectViewConfigSchema.optional()
}).strict();

export type ProjectManifest = z.infer<typeof projectManifestSchema>;
export type ProjectConfigFile = z.infer<typeof projectConfigSchema>;

export type ProjectRecord = {
  name: string;
  root: string;
  missing: boolean;
};

export type ProjectPaths = {
  root: string;
  manifestPath: string;
  configPath: string;
  memoryRoot: string;
  changesRoot: string;
  runsRoot: string;
  archiveRoot: string;
  evalsRoot: string;
  runtimeRoot: string;
};

export function assertProjectName(name: string): string {
  return projectNameSchema.parse(name);
}

function isPortableProjectName(name: string): boolean {
  if (name === "." || name === ".." || name.endsWith(".")) return false;
  const windowsBaseName = name.split(".", 1)[0];
  return !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(windowsBaseName);
}

function isSafeRepositoryRelativePath(path: string): boolean {
  if (path.includes("\\") || isAbsolute(path) || path.startsWith("/")) return false;
  const normalized = posix.normalize(path);
  return normalized === path && normalized !== ".." && !normalized.startsWith("../");
}
