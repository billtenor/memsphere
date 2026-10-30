import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withNativeFileLock } from "../file-lock.js";
import { resolveWorkspaceIdentity } from "../project/workspace.js";

/** Reject overlapping formal writes to the same physical worktree (shared index),
 * or the same Memory directory when it is outside Git. No Project-wide queue. */
export async function withMemoryWriteAccess<T>(memoryRoot: string, action: () => Promise<T>, busyCode = "MEMORY_PUBLISH_BUSY"): Promise<T> {
  const root = await realpath(memoryRoot);
  const workspace = await resolveWorkspaceIdentity(root);
  const directory = join(tmpdir(), "memsphere-memory-write-claims");
  await mkdir(directory, { recursive: true });
  const key = workspace.instanceKey;
  const claim = join(directory, `${createHash("sha256").update(key).digest("hex")}.claim`);
  let entered = false;
  try {
    return await withNativeFileLock(claim, () => { entered = true; return action(); }, { timeoutMs: 0 });
  } catch (error) {
    if (!entered && (error as { code?: string }).code === "LOCK_TIMEOUT")
      throw Object.assign(new Error(`Memory publication or apply is already running: ${workspace.kind === "git" ? workspace.path : root}`), { code: busyCode });
    throw error;
  }
}
