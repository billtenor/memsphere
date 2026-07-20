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

  if (result.issues.some((issue) => issue.migration === "syntax")) {
    console.error("");
    console.error("Hint: This Memory store contains an older YAML syntax with a registered migration path.");
    console.error("Check the migration first: memsphere migrate syntax --check");
    console.error("After reviewing the changes: memsphere migrate syntax --write");
  }

  process.exitCode = 1;
}
