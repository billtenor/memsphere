import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ZodError } from "zod";
import { findConfigPath, readConfig, readConfigAt } from "./config.js";
import { analyzeMemoryDescriptors } from "./memory/catalog.js";
import { memoryKinds, type MemoryKind } from "./memory/kinds.js";
import type { ProviderMemoryDescriptor } from "./memory/provider.js";
import { listMemoryFiles, pathExists, readMemoryFile } from "./memory/store.js";

export type ValidationIssue = {
  path: string;
  message: string;
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

  try {
    const config = configPath ? await readConfig(configPath) : await readConfigAt(resolvedConfigPath);
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
  for (const kind of memoryKinds) {
    const dir = join(memoryRoot, kind);

    if (!(await pathExists(dir))) {
      issues.push({ path: dir, message: "memory kind directory does not exist" });
      continue;
    }

    descriptors.push(...await validateKindDirectory(memoryRoot, kind, issues));
  }

  const catalogIssues = analyzeMemoryDescriptors(descriptors);
  for (const issue of catalogIssues) {
    issues.push({
      path: join(memoryRoot, issue.kind),
      message: issue.message
    });
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
): Promise<ProviderMemoryDescriptor[]> {
  let filePaths: string[];

  try {
    filePaths = await listMemoryFiles(memoryRoot, kind);
  } catch (error) {
    issues.push({
      path: join(memoryRoot, kind),
      message: formatError(error)
    });
    return [];
  }

  const descriptors: ProviderMemoryDescriptor[] = [];
  for (const filePath of filePaths) {
    try {
      const file = await readMemoryFile(kind, filePath);
      descriptors.push({
        id: filePath,
        kind,
        names: [...file.entity.names],
        defines: structuredClone(file.entity.defines)
      });
    } catch (error) {
      issues.push({
        path: filePath,
        message: formatError(error)
      });
    }
  }
  return descriptors;
}
