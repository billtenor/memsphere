import { resolve } from "node:path";
import { validateMemoryRoot, validateMemoryStore } from "../validation.js";

const memoryChangeValidateCommand = "memsphere memory change validate [change-id]";

export async function validateCommand(options: { memoryRoot?: string; format?: "text" | "json" } = {}): Promise<void> {
  const validationScope = options.memoryRoot ? "memory-root" : "project-store";
  const result = options.memoryRoot
    ? { configPath: "(stateless)", ...(await validateMemoryRoot(resolve(options.memoryRoot))), runsRoot: undefined }
    : await validateMemoryStore();

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify({
      valid: result.issues.length === 0,
      ...result,
      validationScope,
      changeSetEffect: "none",
      ...(!options.memoryRoot ? { nextCommand: memoryChangeValidateCommand } : {})
    }, null, 2)}\n`);
    if (result.issues.length > 0) process.exitCode = 1;
    return;
  }

  if (result.issues.length === 0) {
    console.log("memsphere validation passed");
    if (!options.memoryRoot) console.log(`config: ${result.configPath}`);

    if (result.memoryRoot) {
      console.log(`memoryRoot: ${result.memoryRoot}`);
    }

    if (result.runsRoot) {
      console.log(`runsRoot: ${result.runsRoot}`);
    }

    if (options.memoryRoot) {
      console.log("Validation scope: stateless Memory root.");
      console.log("ChangeSet: not applicable in --memory-root mode.");
    } else {
      console.log("Validation scope: current Project Store.");
      console.log("ChangeSet: not created or updated.");
      console.log(`For unpublished Memory changes, run: ${memoryChangeValidateCommand}`);
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
