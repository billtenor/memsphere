import { configFileName, findGitRoot, resolvePath, scopeDirectoryName, writeConfig } from "../config.js";
import { ensureReviewDirectory } from "../review/store.js";
import { installReservedMemories } from "../reserved/store.js";
import { ensureRunDirectory } from "../run/store.js";
import { ensureMemoryDirectories } from "../validation.js";
import { join } from "node:path";

type InitOptions = {
  memoryRoot?: string;
  reviewsRoot?: string;
  runsRoot?: string;
  global?: boolean;
  folder?: string;
  force?: boolean;
};

export async function initCommand(options: InitOptions): Promise<void> {
  if (options.global && options.folder) {
    throw new Error("--global and --folder cannot be used together");
  }

  const scopeRoot = await initScopeRoot(options);
  const configPath = join(scopeRoot, scopeDirectoryName, configFileName);
  const memoryRootConfigValue = options.memoryRoot ?? "memory";
  const reviewsRootConfigValue = options.reviewsRoot ?? "reviews";
  const runsRootConfigValue = options.runsRoot ?? "runs";
  const memoryRoot = resolveScopedPath(scopeRoot, memoryRootConfigValue);
  const reviewsRoot = resolveScopedPath(scopeRoot, reviewsRootConfigValue);
  const runsRoot = resolveScopedPath(scopeRoot, runsRootConfigValue);

  await writeConfig(
    {
      memoryRoot: memoryRootConfigValue,
      reviewsRoot: reviewsRootConfigValue,
      runsRoot: runsRootConfigValue
    },
    {
      configPath,
      force: options.force
    }
  );

  await ensureMemoryDirectories(memoryRoot);
  await ensureReviewDirectory(reviewsRoot);
  await ensureRunDirectory(runsRoot);
  const reservedMemoryRoot = await installReservedMemories(join(scopeRoot, scopeDirectoryName));

  console.log(`Created config: ${configPath}`);
  console.log(`Created memory root: ${memoryRoot}`);
  console.log(`Created reviews root: ${reviewsRoot}`);
  console.log(`Created runs root: ${runsRoot}`);
  console.log(`Installed reserved memory root: ${reservedMemoryRoot}`);
}

async function initScopeRoot(options: InitOptions): Promise<string> {
  if (options.global) {
    return join(resolvePath("~"), "");
  }

  if (options.folder) {
    return resolvePath(options.folder);
  }

  const gitRoot = await findGitRoot();
  if (!gitRoot) {
    throw new Error("not inside a git repository. Use --global or --folder <path>.");
  }
  return gitRoot;
}

function resolveScopedPath(scopeRoot: string, value: string): string {
  const resolved = resolvePath(value);
  if (value.startsWith("~") || value.startsWith("/")) return resolved;
  return resolvePath(join(scopeRoot, scopeDirectoryName, value));
}
