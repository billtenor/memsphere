import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { validateMemoryRoot, validateMemoryStore, type ValidationIssue } from "../validation.js";
import { nextAction } from "../prompts/cli-output.js";
import { cliCommand, emitCliResult } from "./output.js";

export const memoryDiagnostic = z.object({
  code: z.enum(["INVALID_MEMORY", "MIGRATION_REQUIRED", "INVALID_STORE", "SCHEMA_OPTIONAL_INVALID", "REFERENCE_INVALID",
    "REFERENCE_KIND_MISMATCH", "REFERENCE_NOT_FOUND", "REFERENCE_RULES_MISSING", "REFERENCE_CYCLE"]),
  path: z.string().optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional()
}).strict();

export function summarizeMemoryIssues(issues: ValidationIssue[], ...roots: (string | undefined)[]) {
  return issues.slice(0, 10).map(issue => {
    const file = roots.filter((root): root is string => Boolean(root)).map(root => relative(resolve(root), resolve(issue.path)))
      .find(candidate => candidate && !isAbsolute(candidate) && candidate !== ".." && !candidate.startsWith(".." + sep));
    const path = file && !isAbsolute(file) && file !== ".." && !file.startsWith(".." + sep)
      ? file.split(sep).join("/") : undefined;
    return {
      code: issue.code ?? (issue.migration ? "MIGRATION_REQUIRED" as const : path ? "INVALID_MEMORY" as const : "INVALID_STORE" as const),
      path, line: issue.line, column: issue.column
    };
  });
}

const validateResult = z.object({
  valid: z.boolean(),
  validationScope: z.enum(["memory-root", "project-store"]),
  changeSetEffect: z.literal("none"),
  issueCount: z.number().int().nonnegative(),
  issues: z.array(memoryDiagnostic).max(10),
  nextAction
}).strict();

export async function validateCommand(options: { memoryRoot?: string; format?: "text" | "json"; output?: "text" | "json" } = {}): Promise<void> {
  const result = options.memoryRoot
    ? await validateMemoryRoot(resolve(options.memoryRoot))
    : await validateMemoryStore();
  const issueCount = result.issues.length;
  const canMigrate = !options.memoryRoot && result.issues.some(issue => issue.migration === "syntax");
  emitCliResult("validate", validateResult, {
    valid: issueCount === 0,
    validationScope: options.memoryRoot ? "memory-root" : "project-store",
    changeSetEffect: "none",
    issueCount,
    issues: summarizeMemoryIssues(result.issues, result.memoryRoot),
    nextAction: canMigrate
      ? cliCommand(["migrate", "syntax", "--check"])
      : !options.memoryRoot && issueCount === 0 ? cliCommand(["memory", "change", "validate"]) : undefined
  }, { format: options.output ?? options.format, itemsField: "issues" });
  if (issueCount > 0) process.exitCode = 1;
}
