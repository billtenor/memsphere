import { resolve } from "node:path";
import { z } from "zod";
import { atomicWriteJson, withFileLock } from "../persistence.js";
import type { ProjectContext, ResolvedProject } from "../project/resolver.js";
import { AppError, appManifestSchema, cliBindingSchema, cliDescriptorSchema } from "./contracts.js";
import { digest, isMissing, readJson } from "./files.js";

const memoryAsset = z.object({ key: z.string(), path: z.string(), reference: z.string(), digest: z.string() }).strict();
export const installationSchema = z.object({
  manifest: appManifestSchema, packageDigest: z.string(), packageRoot: z.string(),
  installedAt: z.string(), enabled: z.boolean(), config: z.record(z.unknown()),
  memories: z.array(memoryAsset), descriptors: z.array(cliDescriptorSchema),
  bindings: z.record(cliBindingSchema), operationId: z.string(), memoryRevision: z.string().optional(), changeId: z.string().optional(),
  bindingOverrides: z.record(cliBindingSchema).optional()
}).strict();
export const appStateSchema = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(), memoryRoot: z.string(),
  installations: z.record(installationSchema),
  operations: z.record(z.object({ id: z.string(), packageDigest: z.string(), memories: z.array(memoryAsset),
    changeId: z.string().optional(), error: z.string().optional() }).strict())
}).strict();
export type AppState = z.infer<typeof appStateSchema>;
export type AppInstallation = z.infer<typeof installationSchema>;
export type AppProject = Pick<ResolvedProject, "name" | "paths" | "memoryRoot" | "config">;
export function appStatePath(project: Pick<AppProject, "paths" | "memoryRoot">): string {
  return resolve(project.paths.root, "apps", digest(resolve(project.memoryRoot)), "state.json");
}
export function appLockPath(project: Pick<AppProject, "paths" | "memoryRoot">): string { return `${appStatePath(project)}.lock`; }
export async function readAppState(project: Pick<AppProject, "paths" | "memoryRoot">): Promise<AppState> {
  try {
    const state = appStateSchema.parse(await readJson(appStatePath(project)));
    if (state.memoryRoot !== resolve(project.memoryRoot)) throw new Error("Memory scope mismatch");
    return state;
  } catch (error) {
    if (isMissing(error)) return { schemaVersion: 1, revision: 0, memoryRoot: resolve(project.memoryRoot), installations: {}, operations: {} };
    throw new AppError("APP_STATE_INVALID", "Cannot read App installation state; refusing to infer unowned Memory", { cause: String(error) });
  }
}
export async function writeAppState(project: Pick<AppProject, "paths" | "memoryRoot">, state: AppState): Promise<void> {
  state.revision++;
  await atomicWriteJson(appStatePath(project), appStateSchema.parse(state));
}
export function withAppLock<T>(project: Pick<AppProject, "paths" | "memoryRoot">, action: () => Promise<T>): Promise<T> {
  return withFileLock(appLockPath(project), action);
}
export function assertWritableAppTarget(context: ProjectContext, project: ResolvedProject): void {
  if (project.name !== context.primary.name || project.paths.root !== context.primary.paths.root || project.memoryRoot !== context.primary.memoryRoot)
    throw new AppError("APP_READ_ONLY_SOURCE", `Cannot write Mounted source: ${project.name}`, { project: project.name, role: "mounted" });
}
export function requireApp(state: AppState, id: string): AppInstallation {
  if (!Object.hasOwn(state.installations, id)) throw new AppError("APP_NOT_FOUND", `App is not installed: ${id}`);
  return state.installations[id];
}
