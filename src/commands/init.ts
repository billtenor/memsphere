import { defaultConfigPath, resolvePath, writeConfig } from "../config.js";
import { ensureMemoryDirectories } from "../validation.js";

type InitOptions = {
  memoryRoot?: string;
  force?: boolean;
};

export async function initCommand(options: InitOptions): Promise<void> {
  const memoryRootConfigValue = options.memoryRoot ?? "~/.vibe-mem/memory";
  const memoryRoot = resolvePath(memoryRootConfigValue);

  await writeConfig(
    {
      memoryRoot: memoryRootConfigValue
    },
    {
      force: options.force
    }
  );

  await ensureMemoryDirectories(memoryRoot);

  console.log(`Created config: ${defaultConfigPath}`);
  console.log(`Created memory root: ${memoryRoot}`);
}
