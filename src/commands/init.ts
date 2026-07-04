import { defaultConfigPath, resolvePath, writeConfig } from "../config.js";
import { ensureReviewDirectory } from "../review/store.js";
import { ensureMemoryDirectories } from "../validation.js";

type InitOptions = {
  memoryRoot?: string;
  reviewsRoot?: string;
  force?: boolean;
};

export async function initCommand(options: InitOptions): Promise<void> {
  const memoryRootConfigValue = options.memoryRoot ?? "~/.vibe-mem/memory";
  const reviewsRootConfigValue = options.reviewsRoot ?? "~/.vibe-mem/reviews";
  const memoryRoot = resolvePath(memoryRootConfigValue);
  const reviewsRoot = resolvePath(reviewsRootConfigValue);

  await writeConfig(
    {
      memoryRoot: memoryRootConfigValue,
      reviewsRoot: reviewsRootConfigValue
    },
    {
      force: options.force
    }
  );

  await ensureMemoryDirectories(memoryRoot);
  await ensureReviewDirectory(reviewsRoot);

  console.log(`Created config: ${defaultConfigPath}`);
  console.log(`Created memory root: ${memoryRoot}`);
  console.log(`Created reviews root: ${reviewsRoot}`);
}
