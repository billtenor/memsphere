import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import {
  acpProviderConfigSchema,
  resolveProjectControlPlane,
  type ControlPlaneConfig
} from "./control-plane/index.js";
import { defaultPromptLocale, promptLocales, type PromptLocale } from "./prompts/locale.js";
import { homePaths, resolveMemsphereHome } from "./home.js";
import { resolveProjectContext } from "./project/resolver.js";
import { projectConfigSchema } from "./project/model.js";

export type MemsphereConfig = {
  configPath: string;
  scopeRoot: string;
  homeRoot?: string;
  language: PromptLocale;
  memoryRoot: string;
  reviewsRoot: string;
  runsRoot: string;
  archiveRoot: string;
  controlPlane?: ControlPlaneConfig;
  debug: {
    agentReview: boolean;
    root: string;
  };
  view: {
    host: string;
    port: number;
  };
  project?: {
    name: string;
    revision?: string;
    store?: import("./project/model.js").ProjectConfigFile["store"];
    mounted: Array<{
      name: string;
      memoryRoot: string;
      revision?: string;
      store: import("./project/model.js").ProjectConfigFile["store"];
    }>;
  };
};

export async function readConfig(configPath?: string): Promise<MemsphereConfig> {
  if (configPath) return readConfigAt(resolve(configPath));
  return readProjectExecutionConfig();
}

export async function readViewConfig(configPath?: string): Promise<MemsphereConfig> {
  if (configPath) return readConfigAt(resolve(configPath));
  return readProjectExecutionConfig({ memoryScope: "canonical" });
}

export async function readConfigAt(configPath: string): Promise<MemsphereConfig> {
  const resolvedConfigPath = resolve(configPath);
  const projectManifestPath = join(dirname(resolvedConfigPath), "project.json");
  if (!(await pathExists(projectManifestPath))) {
    throw new Error(
      `legacy Scope config is not supported: ${resolvedConfigPath}; register or create a Project instead`
    );
  }
  projectConfigSchema.parse(JSON.parse(await readFile(resolvedConfigPath, "utf8")));
  return readProjectExecutionConfig({ projectConfigPath: resolvedConfigPath });
}

export const globalConfigSchema = z.object({
  language: z.enum(promptLocales).optional(),
  acp_providers: acpProviderConfigSchema.optional(),
  view: z.object({
    host: z.string().min(1),
    port: z.number().int().min(0).max(65535)
  }).strict().optional(),
  debug: z.object({ agent_review: z.boolean().optional() }).strict().optional()
}).strict();

async function readProjectExecutionConfig(options: {
  projectConfigPath?: string;
  home?: string;
  project?: string;
  memoryScope?: "workspace" | "canonical";
} = {}): Promise<MemsphereConfig> {
  const home = options.home ?? resolveMemsphereHome();
  const global = await readGlobalConfig(homePaths(home).configPath);
  const explicitRoot = options.projectConfigPath ? dirname(options.projectConfigPath) : undefined;
  const context = explicitRoot
    ? await resolveContextByRoot(home, explicitRoot)
    : await resolveProjectContext({
      home,
      project: options.project ?? process.env.MEMSPHERE_PROJECT,
      memoryScope: options.memoryScope
    });
  const revision = await storeRevision(context.primary.memoryRoot, context.primary.config.store.type);
  const mounted = await Promise.all(context.mounted.map(async (project) => ({
    name: project.name,
    memoryRoot: project.memoryRoot,
    revision: await storeRevision(project.memoryRoot, project.config.store.type),
    store: project.config.store
  })));
  return {
    configPath: context.primary.paths.configPath,
    scopeRoot: context.primary.paths.root,
    homeRoot: home,
    language: global.language ?? defaultPromptLocale,
    memoryRoot: context.primary.memoryRoot,
    reviewsRoot: context.primary.paths.reviewsRoot,
    runsRoot: context.primary.paths.runsRoot,
    archiveRoot: context.primary.paths.archiveRoot,
    controlPlane: context.primary.config.control_plane
      ? resolveProjectControlPlane(context.primary.config.control_plane, global.acp_providers)
      : undefined,
    debug: { agentReview: global.debug?.agent_review ?? false, root: join(homePaths(home).runtimeRoot, "debug") },
    view: global.view ?? { host: "127.0.0.1", port: 0 },
    project: { name: context.primary.name, revision, store: context.primary.config.store, mounted }
  };
}

export async function readProjectConfig(project: string, home?: string): Promise<MemsphereConfig> {
  return readProjectExecutionConfig({ project, home, memoryScope: "canonical" });
}

async function readGlobalConfig(path: string): Promise<z.infer<typeof globalConfigSchema>> {
  try {
    return globalConfigSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return {};
    throw new Error(`invalid global config: ${path}`, { cause: error });
  }
}

async function resolveContextByRoot(home: string, root: string) {
  const manifest = JSON.parse(await readFile(join(root, "project.json"), "utf8")) as { name?: unknown };
  if (typeof manifest.name !== "string") throw new Error(`invalid Project manifest: ${join(root, "project.json")}`);
  return resolveProjectContext({ home, project: manifest.name, memoryScope: "canonical" });
}

async function storeRevision(memoryRoot: string, type: "managed" | "embedded"): Promise<string | undefined> {
  try {
    const { gitOutput } = await import("./git.js");
    return await gitOutput(["rev-parse", "HEAD"], memoryRoot);
  } catch {
    return type === "managed" ? undefined : "uncommitted";
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
