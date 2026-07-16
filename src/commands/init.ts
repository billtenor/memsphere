import { configFileName, findGitRoot, resolvePath, scopeDirectoryName, writeConfig } from "../config.js";
import { ensureReviewDirectory } from "../review/store.js";
import { installReservedMemories } from "../reserved/store.js";
import { ensureRunDirectory } from "../run/store.js";
import { ensureMemoryDirectories } from "../validation.js";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

type InitOptions = {
  memoryRoot?: string;
  reviewsRoot?: string;
  runsRoot?: string;
  archiveRoot?: string;
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
  const archiveRootConfigValue = options.archiveRoot ?? "archives";
  const memoryRoot = resolveScopedPath(scopeRoot, memoryRootConfigValue);
  const reviewsRoot = resolveScopedPath(scopeRoot, reviewsRootConfigValue);
  const runsRoot = resolveScopedPath(scopeRoot, runsRootConfigValue);
  const archiveRoot = resolveScopedPath(scopeRoot, archiveRootConfigValue);

  await writeConfig(
    {
      memoryRoot: memoryRootConfigValue,
      reviewsRoot: reviewsRootConfigValue,
      runsRoot: runsRootConfigValue,
      archiveRoot: archiveRootConfigValue,
      view: {
        host: "127.0.0.1",
        port: 3000
      }
    },
    {
      configPath,
      force: options.force
    }
  );

  await ensureMemoryDirectories(memoryRoot);
  await ensureReviewDirectory(reviewsRoot);
  await ensureRunDirectory(runsRoot);
  const reservedMemoryRoot = await installReservedMemories(join(scopeRoot, scopeDirectoryName), {
    force: options.force
  });
  await mkdir(archiveRoot, { recursive: true });

  console.log(`Created config: ${configPath}`);
  console.log(`Created memory root: ${memoryRoot}`);
  console.log(`Created reviews root: ${reviewsRoot}`);
  console.log(`Created runs root: ${runsRoot}`);
  console.log(`Installed reserved memory root: ${reservedMemoryRoot}`);
  console.log(`Created archive root: ${archiveRoot}`);
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
