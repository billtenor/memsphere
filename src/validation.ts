import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ZodError } from "zod";
import { defaultConfigPath, readConfig } from "./config.js";
import { memoryKinds, type MemoryKind } from "./memory/kinds.js";
import { listMemoryFiles, pathExists, readMemoryFile } from "./memory/store.js";

export type ValidationIssue = {
  path: string;
  message: string;
};

export type ValidationResult = {
  configPath: string;
  memoryRoot?: string;
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

export async function validateMemoryStore(configPath = defaultConfigPath): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  if (!(await pathExists(configPath))) {
    return {
      configPath,
      issues: [{ path: configPath, message: "config file does not exist. Run vibe-mem init." }]
    };
  }

  let memoryRoot: string | undefined;

  try {
    memoryRoot = (await readConfig(configPath)).memoryRoot;
  } catch (error) {
    return {
      configPath,
      issues: [{ path: configPath, message: formatError(error) }]
    };
  }

  if (!(await pathExists(memoryRoot))) {
    issues.push({ path: memoryRoot, message: "memory root does not exist" });
  }

  for (const kind of memoryKinds) {
    const dir = join(memoryRoot, kind);

    if (!(await pathExists(dir))) {
      issues.push({ path: dir, message: "memory kind directory does not exist" });
      continue;
    }

    await validateKindDirectory(memoryRoot, kind, issues);
  }

  return {
    configPath,
    memoryRoot,
    issues
  };
}

async function validateKindDirectory(
  memoryRoot: string,
  kind: MemoryKind,
  issues: ValidationIssue[]
): Promise<void> {
  let filePaths: string[];

  try {
    filePaths = await listMemoryFiles(memoryRoot, kind);
  } catch (error) {
    issues.push({
      path: join(memoryRoot, kind),
      message: formatError(error)
    });
    return;
  }

  for (const filePath of filePaths) {
    try {
      await readMemoryFile(kind, filePath);
    } catch (error) {
      issues.push({
        path: filePath,
        message: formatError(error)
      });
    }
  }
}
