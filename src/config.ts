import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

const configSchema = z.object({
  memoryRoot: z.string().min(1)
});

export type VibeMemConfig = z.infer<typeof configSchema>;

export const defaultConfigPath = join(homedir(), ".vibe-mem", "config.json");
export const defaultMemoryRoot = join(homedir(), ".vibe-mem", "memory");

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

export async function readConfig(configPath = defaultConfigPath): Promise<VibeMemConfig> {
  const raw = await readFile(configPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  const config = configSchema.parse(parsed);

  return {
    memoryRoot: resolvePath(config.memoryRoot)
  };
}

export async function writeConfig(
  config: VibeMemConfig,
  options: { configPath?: string; force?: boolean } = {}
): Promise<void> {
  const configPath = options.configPath ?? defaultConfigPath;

  if (existsSync(configPath) && !options.force) {
    throw new Error(`${configPath} already exists. Use --force to overwrite it.`);
  }

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
