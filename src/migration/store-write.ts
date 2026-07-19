import { createHash } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MemsphereConfig } from "../config.js";

export type MigrationSourceFile = {
  path: string;
  absolutePath: string;
  sha256: string;
};

export async function withMemoryStoreMigrationLock<T>(
  config: MemsphereConfig,
  migration: string,
  work: () => Promise<T>
): Promise<T> {
  const lockPath = join(config.scopeRoot, "migrations", "memory-store.lock");
  await mkdir(dirname(lockPath), { recursive: true });
  const lock = await open(lockPath, "wx").catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new Error(`Another Memory migration is already running: ${lockPath}`);
    }
    throw error;
  });

  try {
    return await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${migration}: ${message}`, { cause: error });
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

export async function assertMigrationSourcesUnchanged(files: readonly MigrationSourceFile[]): Promise<void> {
  for (const file of files) {
    const current = await readFile(file.absolutePath);
    const actual = createHash("sha256").update(current).digest("hex");
    if (actual !== file.sha256) {
      throw new Error(`Memory changed while migration was being prepared: ${file.path}`);
    }
  }
}
