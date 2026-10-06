import { z } from "zod";
import semver from "semver";

export const appId = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).max(120)
  .refine(value => !["__proto__", "constructor", "prototype"].includes(value), "reserved identity");
export const text = z.string().min(1).refine(value => !value.includes("\0"), "NUL is not allowed");
export const version = text.refine(value => semver.valid(value) === value, "expected SemVer");
export const relativePath = text.refine(value => !value.includes("\\") && !value.startsWith("/")
  && !/^[a-z]:/i.test(value) && value.split("/").every(part => part && part !== "." && part !== ".."), "expected a contained relative path");
export const cliDescriptorSchema = z.object({
  schemaVersion: z.literal(1), id: appId, name: text, description: text,
  command: z.array(text).min(1), help: z.array(text).optional(), documentation: text.optional(),
  requirements: z.object({ env: z.array(text).optional(), cwd: z.boolean().optional(),
    files: z.array(text).optional(), version: text.refine(value => Boolean(semver.validRange(value))).optional() }).strict().optional(),
  versionProbe: z.object({ args: z.array(text), format: z.literal("semver") }).strict().optional()
}).strict();
export const cliBindingSchema = z.object({
  schemaVersion: z.literal(1), executable: text.optional(), cwd: text.optional(),
  args: z.array(text).optional(), env: z.record(text).optional(), envFrom: z.record(text).optional(), files: z.array(text).optional()
}).strict();
const configValue = z.union([z.string(), z.object({ configKey: text }).strict()]);
const asset = z.object({ key: appId, path: relativePath }).strict();
export const appManifestSchema = z.object({
  schemaVersion: z.literal(1), id: appId, name: text, version, description: text,
  assets: z.object({
    memories: z.array(asset).default([]), viewPackages: z.array(asset).default([]),
    modelPackages: z.array(asset).default([]), cliDescriptors: z.array(asset).default([]),
    dataExtensions: z.array(z.object({ id: appId, version, entry: relativePath }).strict()).default([])
  }).strict().default({}),
  dependencies: z.array(z.object({ kind: z.enum(["app", "viewPackage", "modelPackage", "dataExtension", "cli", "memory"]),
    id: text, version: text.refine(value => Boolean(semver.validRange(value))).optional() }).strict()).default([]),
  entrypoints: z.object({ agent: z.array(text).default([]), view: z.array(z.object({
    packageKey: appId, instanceId: appId, path: text.refine(value => value.startsWith("/") && !value.startsWith("//") && !/[?#]/.test(value), "expected a relative Module route beginning with /").optional(), config: z.record(z.unknown()).optional()
  }).strict()).default([]) }).strict().default({}),
  configuration: relativePath.optional(),
  stores: z.array(z.object({ key: appId, model: text, kind: z.enum(["DataStore", "ValueStore"]),
    factory: text, config: z.record(z.unknown()) }).strict()).default([]),
  cliBindings: z.array(z.object({ cli: appId, args: z.array(configValue).optional(),
    cwd: configValue.optional(), env: z.record(configValue).optional() }).strict()).default([]),
  backend: z.object({ entry: relativePath, operations: z.record(appId, z.enum(["read", "write"])) }).strict().optional()
}).strict().superRefine((app, context) => {
  for (const [kind, assets] of Object.entries(app.assets)) {
    const ids = assets.map(a => "key" in a ? a.key : a.id);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["assets", kind], message: "duplicate asset identity" });
  }
  const viewKeys = new Set(app.assets.viewPackages.map(a => a.key));
  for (const entry of app.entrypoints.view) if (!viewKeys.has(entry.packageKey))
    context.addIssue({ code: "custom", path: ["entrypoints", "view"], message: `unknown packageKey: ${entry.packageKey}` });
  for (const [name, ids] of [["view instances", app.entrypoints.view.map(v => v.instanceId)],
    ["stores", app.stores.map(s => s.key)], ["CLI bindings", app.cliBindings.map(b => b.cli)]] as const)
    if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: `duplicate ${name}` });
});
export const modelPackageSchema = z.object({
  schemaVersion: z.literal(1), id: appId, name: text, version,
  models: z.array(z.object({ modelRef: text, path: relativePath, metaModel: text,
    name: text.optional(), description: text.optional(), tags: z.array(text).optional() }).strict()),
  dependencies: z.array(z.object({ id: text, version: text.refine(value => Boolean(semver.validRange(value))).optional() }).strict()).optional()
}).strict();
export type AppManifest = z.infer<typeof appManifestSchema>;
export type CliDescriptor = z.infer<typeof cliDescriptorSchema>;
export type CliBinding = z.infer<typeof cliBindingSchema>;

export class AppError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) { super(message); }
}
