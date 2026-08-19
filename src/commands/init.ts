import { configFileName, findGitRoot, readConfigAt, resolvePath, scopeDirectoryName, writeConfig } from "../config.js";
import { ensureReviewDirectory } from "../review/store.js";
import { installReservedMemories } from "../reserved/store.js";
import { ensureRunDirectory } from "../run/store.js";
import { ensureMemoryDirectories } from "../validation.js";
import { join } from "node:path";
import { access, mkdir } from "node:fs/promises";
import { assertWindowsPrerequisites } from "../windows-prerequisites.js";

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
  await assertWindowsPrerequisites();
  if (options.global && options.folder) {
    throw new Error("--global and --folder cannot be used together");
  }

  const scopeRoot = await initScopeRoot(options);
  const configPath = join(scopeRoot, scopeDirectoryName, configFileName);
  const configExists = await pathExists(configPath);
  if (configExists && !options.force && hasConfigOverrides(options)) {
    throw new Error(`${configPath} already exists. Use --force to change its configured paths.`);
  }

  let memoryRoot: string;
  let reviewsRoot: string;
  let runsRoot: string;
  let archiveRoot: string;

  if (configExists && !options.force) {
    const config = await readConfigAt(configPath);
    ({ memoryRoot, reviewsRoot, runsRoot, archiveRoot } = config);
  } else {
    const memoryRootConfigValue = options.memoryRoot ?? "memory";
    const reviewsRootConfigValue = options.reviewsRoot ?? "reviews";
    const runsRootConfigValue = options.runsRoot ?? "runs";
    const archiveRootConfigValue = options.archiveRoot ?? "archives";
    memoryRoot = resolveScopedPath(scopeRoot, memoryRootConfigValue);
    reviewsRoot = resolveScopedPath(scopeRoot, reviewsRootConfigValue);
    runsRoot = resolveScopedPath(scopeRoot, runsRootConfigValue);
    archiveRoot = resolveScopedPath(scopeRoot, archiveRootConfigValue);

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
  }

  await ensureMemoryDirectories(memoryRoot);
  await ensureReviewDirectory(reviewsRoot);
  await ensureRunDirectory(runsRoot);
  const installedMemories = await installReservedMemories(join(scopeRoot, scopeDirectoryName), { memoryRoot });
  await mkdir(archiveRoot, { recursive: true });

  console.log(`${configExists && !options.force ? "Using existing" : "Created"} config: ${configPath}`);
  console.log(`Ensured memory root: ${memoryRoot}`);
  console.log(`Ensured reviews root: ${reviewsRoot}`);
  console.log(`Ensured runs root: ${runsRoot}`);
  console.log(`Installed system memories: ${installedMemories.installedSystemMemories}`);
  console.log(`Removed system memories: ${installedMemories.removedSystemMemories}`);
  console.log(`Installed reserved memories: ${installedMemories.installedReservedMemories}`);
  console.log(`Installed reserved memory root: ${installedMemories.reservedMemoryRoot}`);
  console.log(`Ensured archive root: ${archiveRoot}`);
}

function hasConfigOverrides(options: InitOptions): boolean {
  return [options.memoryRoot, options.reviewsRoot, options.runsRoot, options.archiveRoot].some((value) => value !== undefined);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
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
