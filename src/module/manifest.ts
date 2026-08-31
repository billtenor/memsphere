import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { satisfies, valid, validRange } from "semver";
import { z } from "zod";

const moduleIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export const moduleManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).regex(moduleIdPattern, "Module id must use lowercase reverse-domain segments"),
  version: z.string().refine(value => valid(value) !== null, "Module version must be valid SemVer"),
  view: z.object({
    entry: z.string().refine(isSafePackageEntry, "View entry must be a package-relative ./ path"),
    sdk: z.string().refine(value => validRange(value) !== null, "View SDK range must be valid SemVer")
  }).strict()
}).strict();

export type ModuleManifest = z.infer<typeof moduleManifestSchema>;

export function parseModuleManifest(value: unknown): ModuleManifest {
  return moduleManifestSchema.parse(value);
}

export async function readModuleManifest(path: string): Promise<ModuleManifest> {
  return parseModuleManifest(JSON.parse(await readFile(path, "utf8")));
}

export function resolveModuleViewEntry(moduleRoot: string, manifest: ModuleManifest): string {
  const root = resolve(moduleRoot);
  const entry = resolve(root, manifest.view.entry);
  const fromRoot = relative(root, entry);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`Module View entry escapes its package: ${manifest.view.entry}`);
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
