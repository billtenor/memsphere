import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { z } from "zod";
import { controlPlaneConfigSchema, type ControlPlaneConfig } from "./control-plane/index.js";

export const configSchema = z.object({
  memoryRoot: z.string().min(1),
  reviewsRoot: z.string().min(1).optional(),
  runsRoot: z.string().min(1).optional(),
  archiveRoot: z.string().min(1).optional(),
  view: z.object({
    host: z.string().min(1),
    port: z.number().int().min(0).max(65535)
  }).strict().optional(),
  debug: z.object({
    agent_review: z.boolean().optional()
  }).strict().optional(),
  control_plane: controlPlaneConfigSchema.optional()
}).strict();

export type MemsphereConfigFile = z.input<typeof configSchema>;

export type MemsphereConfig = {
  configPath: string;
  scopeRoot: string;
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
};

export const defaultConfigPath = join(homedir(), ".memsphere", "config.json");
export const defaultMemoryRoot = join(homedir(), ".memsphere", "memory");
export const defaultReviewsRoot = join(homedir(), ".memsphere", "reviews");
export const defaultRunsRoot = join(homedir(), ".memsphere", "runs");
export const scopeDirectoryName = ".memsphere";
export const configFileName = "config.json";

export function expandHome(input: string): string {
  if (input === "~") {
    return homedir();
  }

  if (input.startsWith("~/")) {
    return join(homedir(), input.slice(2));
  }

  return input;
}

export function resolvePath(input: string): string {
  return resolve(expandHome(input));
}

export async function findConfigPath(cwd = process.cwd()): Promise<string | undefined> {
  let current = resolve(cwd);
  const root = parse(current).root;

  while (true) {
    const candidate = join(current, scopeDirectoryName, configFileName);
    if (await pathExists(candidate)) return candidate;
    if (current === root) break;
    current = dirname(current);
  }

  if (await pathExists(defaultConfigPath)) return defaultConfigPath;
  return undefined;
}

export async function findGitRoot(cwd = process.cwd()): Promise<string | undefined> {
  let current = resolve(cwd);
  const root = parse(current).root;

  while (true) {
    if (await pathExists(join(current, ".git"))) return current;
    if (current === root) return undefined;
    current = dirname(current);
  }
}

export async function readConfig(configPath?: string): Promise<MemsphereConfig> {
  const resolvedConfigPath = configPath ? resolvePath(configPath) : await findConfigPath();
  if (!resolvedConfigPath) {
    throw new Error("config file does not exist. Run memsphere init.");
  }

  return readConfigAt(resolvedConfigPath);
}

export async function readConfigAt(configPath: string): Promise<MemsphereConfig> {
  const raw = await readFile(configPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  const config = configSchema.parse(parsed);
  const scopeRoot = dirname(configPath);

  return {
    configPath,
    scopeRoot,
    memoryRoot: resolveConfigPath(config.memoryRoot, scopeRoot),
    reviewsRoot: resolveConfigPath(config.reviewsRoot ?? "reviews", scopeRoot),
    runsRoot: resolveConfigPath(config.runsRoot ?? "runs", scopeRoot),
    archiveRoot: resolveConfigPath(config.archiveRoot ?? "archives", scopeRoot),
    controlPlane: config.control_plane,
    debug: {
      agentReview: config.debug?.agent_review ?? false,
      root: resolveConfigPath("debug", scopeRoot)
    },
    view: config.view ?? { host: "127.0.0.1", port: 0 }
  };
}

export async function writeConfig(
  config: MemsphereConfigFile,
  options: { configPath?: string; force?: boolean } = {}
): Promise<void> {
  const configPath = options.configPath ?? defaultConfigPath;

  if (existsSync(configPath) && !options.force) {
    throw new Error(`${configPath} already exists. Use --force to overwrite it.`);
  }

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function resolveConfigPath(input: string, scopeRoot: string): string {
  const expanded = expandHome(input);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(scopeRoot, expanded);
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
