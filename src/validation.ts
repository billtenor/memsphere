import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ZodError } from "zod";
import { configSchema, findConfigPath, readConfigAt, type MemsphereConfig } from "./config.js";
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
  const resolvedConfigPath = configPath ?? await findConfigPath();

  if (!resolvedConfigPath || !(await pathExists(resolvedConfigPath))) {
    return {
      configPath: resolvedConfigPath ?? "(not found)",
      issues: [{ path: resolvedConfigPath ?? "(not found)", message: "config file does not exist. Run memsphere init." }]
    };
  }

  let memoryRoot: string | undefined;
  let reviewsRoot: string | undefined;
  let runsRoot: string | undefined;
  let config: MemsphereConfig;

  try {
    const parsedConfig = configSchema.safeParse(JSON.parse(await readFile(resolvedConfigPath, "utf8")));
    if (!parsedConfig.success) {
      return {
        configPath: resolvedConfigPath,
        issues: parsedConfig.error.issues.map((issue) => ({
          path: configIssuePath(resolvedConfigPath, issue.path),
          message: issue.message
        }))
      };
    }
    config = await readConfigAt(resolvedConfigPath);
    memoryRoot = config.memoryRoot;
    reviewsRoot = config.reviewsRoot;
    runsRoot = config.runsRoot;
  } catch (error) {
    return {
      configPath: resolvedConfigPath,
      issues: [{ path: resolvedConfigPath, message: formatError(error) }]
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

  return {
    configPath: resolvedConfigPath,
    memoryRoot,
    reviewsRoot,
    runsRoot,
    issues
  };
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
      issues.push({
        path: filePath,
        message: formatError(error),
        migration: await usesMigratableSyntax(filePath) ? "syntax" : undefined
      });
    }
  }
  return { descriptors, files };
}

function configIssuePath(configPath: string, path: PropertyKey[]): string {
  let suffix = "";
  for (const part of path) {
    suffix += typeof part === "number" ? `[${part}]` : `${suffix ? "." : ""}${String(part)}`;
  }
  return suffix ? `${configPath}#${suffix}` : configPath;
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
