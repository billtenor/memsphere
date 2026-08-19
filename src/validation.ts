import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ZodError } from "zod";
import { readConfig, readConfigAt, type MemsphereConfig } from "./config.js";
import { analyzeMemoryDescriptors } from "./memory/catalog.js";
import { memoryKinds, type MemoryKind } from "./memory/kinds.js";
import type { ProviderMemoryDescriptor } from "./memory/provider.js";
import { validateMemoryReferences } from "./memory/references.js";
import { listMemoryFiles, pathExists, readMemoryFile, type MemoryFile } from "./memory/store.js";
import { currentMemorySyntax, readMemorySyntax } from "./memory/syntax.js";
import { parseMemoryYaml } from "./memory/yaml.js";
import { canMigrateMemorySyntax } from "./migration/memory-syntax-path.js";

export type ValidationIssue = {
  path: string;
  message: string;
  migration?: "syntax";
  line?: number;
  column?: number;
};

export type ValidationResult = {
  configPath: string;
  memoryRoot?: string;
  reviewsRoot?: string;
  runsRoot?: string;
  issues: ValidationIssue[];
};

export async function ensureMemoryDirectories(memoryRoot: string): Promise<void> {
  await mkdir(memoryRoot, { recursive: true });

  for (const kind of memoryKinds) {
    await mkdir(join(memoryRoot, kind), { recursive: true });
  }
}

function formatError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function validateMemoryStore(configPath?: string): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const resolvedConfigPath = configPath;

  let memoryRoot: string | undefined;
  let reviewsRoot: string | undefined;
  let runsRoot: string | undefined;
  let config: MemsphereConfig;

  try {
    config = resolvedConfigPath ? await readConfigAt(resolvedConfigPath) : await readConfig();
    memoryRoot = config.memoryRoot;
    reviewsRoot = config.reviewsRoot;
    runsRoot = config.runsRoot;
  } catch (error) {
    return {
      configPath: resolvedConfigPath ?? "(Project Context)",
      issues: [{ path: resolvedConfigPath ?? "(Project Context)", message: formatError(error) }]
    };
  }

  if (!(await pathExists(memoryRoot))) {
    issues.push({ path: memoryRoot, message: "memory root does not exist" });
  }

  if (!(await pathExists(reviewsRoot))) {
    issues.push({ path: reviewsRoot, message: "reviews root does not exist" });
  }

  if (!(await pathExists(runsRoot))) {
    issues.push({ path: runsRoot, message: "runs root does not exist" });
  }

  issues.push(...(await validateMemoryRoot(memoryRoot)).issues);

  return {
    configPath: resolvedConfigPath ?? config.configPath,
    memoryRoot,
    reviewsRoot,
    runsRoot,
    issues
  };
}

export async function validateMemoryRoot(memoryRoot: string): Promise<{ memoryRoot: string; issues: ValidationIssue[] }> {
  const issues: ValidationIssue[] = [];
  if (!(await pathExists(memoryRoot))) {
    return { memoryRoot, issues: [{ path: memoryRoot, message: "memory root does not exist" }] };
  }
  const descriptors: ProviderMemoryDescriptor[] = [];
  const validFiles: MemoryFile[] = [];
  for (const kind of memoryKinds) {
    const dir = join(memoryRoot, kind);

    if (!(await pathExists(dir))) {
      issues.push({ path: dir, message: "memory kind directory does not exist" });
      continue;
    }

    const result = await validateKindDirectory(memoryRoot, kind, issues);
    descriptors.push(...result.descriptors);
    validFiles.push(...result.files);
  }

  const catalogIssues = analyzeMemoryDescriptors(descriptors);
  for (const issue of catalogIssues) {
    issues.push({
      path: join(memoryRoot, issue.kind),
      message: issue.message
    });
  }

  for (const issue of validateMemoryReferences(validFiles)) {
    issues.push(issue);
  }

  return { memoryRoot, issues };
}

async function validateKindDirectory(
  memoryRoot: string,
  kind: MemoryKind,
  issues: ValidationIssue[]
): Promise<{ descriptors: ProviderMemoryDescriptor[]; files: MemoryFile[] }> {
  let filePaths: string[];

  try {
    filePaths = await listMemoryFiles(memoryRoot, kind);
  } catch (error) {
    issues.push({
      path: join(memoryRoot, kind),
      message: formatError(error)
    });
    return { descriptors: [], files: [] };
  }

  const descriptors: ProviderMemoryDescriptor[] = [];
  const files: MemoryFile[] = [];
  for (const filePath of filePaths) {
    try {
      const file = await readMemoryFile(kind, filePath);
      files.push(file);
      descriptors.push({
        id: filePath,
        kind,
        names: [...file.entity.names],
        defines: structuredClone(file.entity.defines)
      });
    } catch (error) {
      const location = await errorLocation(filePath, error);
      issues.push({
        path: filePath,
        message: formatError(error),
        ...location,
        migration: await usesMigratableSyntax(filePath) ? "syntax" : undefined
      });
    }
  }
  return { descriptors, files };
}

async function errorLocation(
  filePath: string,
  error: unknown
): Promise<{ line?: number; column?: number }> {
  const offset = error && typeof error === "object" && "pos" in error
    && Array.isArray(error.pos) && typeof error.pos[0] === "number"
    ? error.pos[0]
    : undefined;
  if (offset === undefined) return {};
  const source = await readFile(filePath, "utf8").catch(() => "");
  const before = source.slice(0, Math.max(0, offset));
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

async function usesMigratableSyntax(filePath: string): Promise<boolean> {
  try {
    const entity = parseMemoryYaml(await readFile(filePath, "utf8"));
    const syntax = readMemorySyntax(entity);
    return canMigrateMemorySyntax(syntax, currentMemorySyntax);
  } catch {
    return false;
  }
}
