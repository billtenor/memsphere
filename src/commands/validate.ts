import { resolve } from "node:path";
import { validateMemoryRoot, validateMemoryStore } from "../validation.js";
import { checkpointWorkspaceChanges } from "../memory/changeset.js";

export async function validateCommand(options: { memoryRoot?: string; format?: "text" | "json" } = {}): Promise<void> {
  if (!options.memoryRoot) await checkpointWorkspaceChanges();
  const result = options.memoryRoot
    ? { configPath: "(stateless)", ...(await validateMemoryRoot(resolve(options.memoryRoot))), reviewsRoot: undefined, runsRoot: undefined }
    : await validateMemoryStore();

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify({ valid: result.issues.length === 0, ...result }, null, 2)}\n`);
    if (result.issues.length > 0) process.exitCode = 1;
    return;
  }

  if (result.issues.length === 0) {
    console.log("memsphere validation passed");
    if (!options.memoryRoot) console.log(`config: ${result.configPath}`);

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
    console.error(`- ${issue.path}${issue.line ? `:${issue.line}:${issue.column ?? 1}` : ""}: ${issue.message}`);
  }

  if (result.issues.some((issue) => issue.migration === "syntax")) {
    console.error("");
    console.error("Hint: This Memory store contains an older YAML syntax with a registered migration path.");
    console.error("Check the migration first: memsphere migrate syntax --check");
    console.error("After reviewing the changes: memsphere migrate syntax --write");
  }

  process.exitCode = 1;
}
