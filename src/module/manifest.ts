import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { satisfies, valid, validRange } from "semver";
import { z } from "zod";
import { viewPackageCapabilitySchema, viewPackageContributionCellSchema } from "../view/package-config.js";

const moduleIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export const moduleManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).regex(moduleIdPattern, "Module id must use lowercase reverse-domain segments"),
  version: z.string().refine(value => valid(value) !== null, "Module version must be valid SemVer"),
  source: z.object({
    type: z.enum(["local", "npm", "git"]),
    locator: z.string().min(1).optional(),
    homepage: z.string().url().optional(),
    license: z.string().min(1).optional()
  }).strict().optional(),
  view: z.object({
    entry: z.string().refine(isSafePackageEntry, "View entry must be a package-relative ./ path"),
    sdk: z.string().refine(value => validRange(value) !== null, "View SDK range must be valid SemVer"),
    capabilities: z.array(viewPackageCapabilitySchema).optional(),
    dependencies: z.array(z.object({
      id: z.string().min(1).regex(moduleIdPattern, "Dependency id must use lowercase reverse-domain segments"),
      version: z.string().refine(value => validRange(value) !== null, "Dependency range must be valid SemVer")
    }).strict()).optional(),
    styles: z.array(z.object({
      id: z.string().min(1),
      file: z.string().refine(isSafePackageEntry, "Style file must be a package-relative ./ path"),
      scope: z.enum(["module", "global"]),
      namespace: z.string().min(1).optional()
    }).strict()).optional(),
    themes: z.array(z.object({
      id: z.string().min(1),
      file: z.string().refine(isSafePackageEntry, "Theme file must be a package-relative ./ path")
    }).strict()).optional(),
    contributions: z.array(z.object({
      id: z.string().min(1),
      cell: viewPackageContributionCellSchema,
      priority: z.number().int().min(0).max(999)
    }).strict()).optional()
  }).strict()
}).strict().superRefine((manifest, context) => {
  for (const [field, values] of [
    ["capabilities", manifest.view.capabilities],
    ["dependencies", manifest.view.dependencies?.map(value => value.id)],
    ["styles", manifest.view.styles?.map(value => value.id)],
    ["themes", manifest.view.themes?.map(value => value.id)],
    ["contributions", manifest.view.contributions?.map(value => value.id)]
  ] as const) {
    if (values && new Set(values).size !== values.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["view", field], message: `${field} must be unique` });
    }
  }
  for (const [index, style] of (manifest.view.styles ?? []).entries()) {
    const required = style.scope === "global" ? "styles.global" : "styles.scoped";
    if (!manifest.view.capabilities?.includes(required)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["view", "styles", index],
        message: `${style.scope} style requires ${required} capability`
      });
    }
  }
});

export type ModuleManifest = z.infer<typeof moduleManifestSchema>;

export function parseModuleManifest(value: unknown): ModuleManifest {
  return moduleManifestSchema.parse(value);
}

export async function readModuleManifest(path: string): Promise<ModuleManifest> {
  return parseModuleManifest(JSON.parse(await readFile(path, "utf8")));
}

export function resolveModuleViewEntry(moduleRoot: string, manifest: ModuleManifest): string {
  return resolveModulePackageFile(moduleRoot, manifest.view.entry);
}

export function resolveModulePackageFile(moduleRoot: string, file: string): string {
  if (!isSafePackageEntry(file)) throw new Error(`Module file must be a safe package-relative path: ${file}`);
  const root = resolve(moduleRoot);
  const entry = resolve(root, file);
  const fromRoot = relative(root, entry);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`Module file escapes its package: ${file}`);
  }
  return entry;
}

export function isViewSdkCompatible(manifest: ModuleManifest, sdkVersion: string): boolean {
  if (valid(sdkVersion) === null) throw new Error(`View SDK version must be valid SemVer: ${sdkVersion}`);
  return satisfies(sdkVersion, manifest.view.sdk, { includePrerelease: true });
}

function isSafePackageEntry(value: string): boolean {
  if (!value.startsWith("./") || value.includes("\\") || value.includes("\0")) return false;
  const segments = value.slice(2).split("/");
  return segments.length > 0 && segments.every(segment => segment.length > 0 && segment !== "." && segment !== "..");
}
