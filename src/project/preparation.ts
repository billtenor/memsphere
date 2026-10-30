import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const preparing = new AsyncLocalStorage<{ home: string; name: string; root: string; active: boolean }>();
export const projectPreparationPath = (root: string) => join(root, ".memsphere-project-creating.json");
export function currentProjectPreparation(home: string) {
  const value = preparing.getStore();
  return value?.active && value.home === resolve(home) ? value : undefined;
}
export async function assertProjectPrepared(root: string): Promise<void> {
  try { await readFile(projectPreparationPath(root)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  const owner = preparing.getStore();
  if (owner?.active && owner.root === resolve(root)) return;
  throw Object.assign(new Error(`Project preparation is unfinished: ${root}`), { code: "PROJECT_PREPARATION_PENDING" });
}
/** Exclusive directory creation owns this attempt; no other attempt's directory is removed. */
export async function withNewProjectDirectory<T>(home: string, name: string, root: string, action: () => Promise<T>): Promise<T> {
  await mkdir(root); // EEXIST is the atomic admission decision.
  const identity = await lstat(root);
  const token = randomUUID();
  const marker = projectPreparationPath(root);
  const scope = { home: resolve(home), name, root: await realpath(root), active: true };
  let complete = false;
  try {
    await writeFile(marker, token, { flag: "wx", mode: 0o600 });
    const result = await preparing.run(scope, action);
    await rm(marker);
    complete = true;
    return result;
  } finally {
    scope.active = false;
    if (!complete) {
      const current = await lstat(root).catch(() => undefined);
      const owner = await readFile(marker, "utf8").catch(() => undefined);
      if (current?.dev === identity.dev && current?.ino === identity.ino && owner === token) {
        // A registry fsync may report failure after publication. Preserve a published root.
        const { readProjectRegistry } = await import("./registry.js");
        const registry = await readProjectRegistry(home);
        if (registry.projects[name]?.root === root) await rm(marker);
        else await rm(root, { recursive: true, force: true });
      }
    }
  }
}
