import { defaultConfigPath, resolvePath, writeConfig } from "../config.js";
import { ensureReviewDirectory } from "../review/store.js";
import { ensureRunDirectory } from "../run/store.js";
import { ensureMemoryDirectories } from "../validation.js";

type InitOptions = {
  memoryRoot?: string;
  reviewsRoot?: string;
  runsRoot?: string;
  force?: boolean;
};

export async function initCommand(options: InitOptions): Promise<void> {
  const memoryRootConfigValue = options.memoryRoot ?? "~/.vibe-mem/memory";
  const reviewsRootConfigValue = options.reviewsRoot ?? "~/.vibe-mem/reviews";
  const runsRootConfigValue = options.runsRoot ?? "~/.vibe-mem/runs";
  const memoryRoot = resolvePath(memoryRootConfigValue);
  const reviewsRoot = resolvePath(reviewsRootConfigValue);
  const runsRoot = resolvePath(runsRootConfigValue);

  await writeConfig(
    {
      memoryRoot: memoryRootConfigValue,
      reviewsRoot: reviewsRootConfigValue,
      runsRoot: runsRootConfigValue
    },
    {
      force: options.force
    }
  );

  await ensureMemoryDirectories(memoryRoot);
  await ensureReviewDirectory(reviewsRoot);
  await ensureRunDirectory(runsRoot);

  console.log(`Created config: ${defaultConfigPath}`);
  console.log(`Created memory root: ${memoryRoot}`);
  console.log(`Created reviews root: ${reviewsRoot}`);
  console.log(`Created runs root: ${runsRoot}`);
}
