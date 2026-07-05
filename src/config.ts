import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { z } from "zod";

const configSchema = z.object({
  memoryRoot: z.string().min(1),
  reviewsRoot: z.string().min(1).optional(),
  runsRoot: z.string().min(1).optional()
});

type VibeMemConfigFile = z.infer<typeof configSchema>;

export type VibeMemConfig = {
  configPath: string;
  scopeRoot: string;
  memoryRoot: string;
  reviewsRoot: string;
  runsRoot: string;
};

export const defaultConfigPath = join(homedir(), ".vibe-mem", "config.json");
export const defaultMemoryRoot = join(homedir(), ".vibe-mem", "memory");
export const defaultReviewsRoot = join(homedir(), ".vibe-mem", "reviews");
export const defaultRunsRoot = join(homedir(), ".vibe-mem", "runs");
export const scopeDirectoryName = ".vibe-mem";
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

export async function readConfig(configPath?: string): Promise<VibeMemConfig> {
  const resolvedConfigPath = configPath ? resolvePath(configPath) : await findConfigPath();
  if (!resolvedConfigPath) {
    throw new Error("config file does not exist. Run vibe-mem init.");
  }

  return readConfigAt(resolvedConfigPath);
}

export async function readConfigAt(configPath: string): Promise<VibeMemConfig> {
  const raw = await readFile(configPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  const config = configSchema.parse(parsed);
  const scopeRoot = dirname(configPath);

  return {
    configPath,
    scopeRoot,
    memoryRoot: resolveConfigPath(config.memoryRoot, scopeRoot),
    reviewsRoot: resolveConfigPath(config.reviewsRoot ?? "reviews", scopeRoot),
    runsRoot: resolveConfigPath(config.runsRoot ?? "runs", scopeRoot)
  };
}

export async function writeConfig(
  config: VibeMemConfigFile,
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
