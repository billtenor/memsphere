import { validateMemoryStore } from "../validation.js";

export async function validateCommand(): Promise<void> {
  const result = await validateMemoryStore();

  if (result.issues.length === 0) {
    console.log("memsphere validation passed");
    console.log(`config: ${result.configPath}`);

    if (result.memoryRoot) {
      console.log(`memoryRoot: ${result.memoryRoot}`);
    }

    if (result.reviewsRoot) {
      console.log(`reviewsRoot: ${result.reviewsRoot}`);
    }

    if (result.runsRoot) {
      console.log(`runsRoot: ${result.runsRoot}`);
    }

    return;
  }

  console.error("memsphere validation failed");

  for (const issue of result.issues) {
    console.error(`- ${issue.path}: ${issue.message}`);
  }

  process.exitCode = 1;
}
