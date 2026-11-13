import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteJson } from "../persistence.js";
import { withNativeFileLock } from "../file-lock.js";

/** All record writers use this permanent inode; readers never create a lock. */
export async function withCheckpointRecordLock<T>(runtimeRoot: string, changeId: string, action: () => Promise<T>): Promise<T> {
  const root = join(runtimeRoot, "checkpoint-locks");
  await mkdir(root, { recursive: true });
  const key = createHash("sha256").update(changeId).digest("hex");
  try {
    return await withNativeFileLock(join(root, `${key}.lock`), action, { timeoutMs: 0 });
  } catch (error) {
    if ((error as { code?: string }).code === "LOCK_TIMEOUT") {
      throw Object.assign(new Error(`ChangeSet ${changeId} is being updated; retry the operation`), { code: "CHANGESET_WRITE_BUSY" });
    }
    throw error;
  }
}

export function checkpointRecordToken(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** The commit callback runs under the record lock and must not reacquire it.
 * Callback injection also permits deterministic publication/failure tests. */
export async function publishCheckpoint<T>(input: {
  runtimeRoot: string;
  changeId: string;
  checkpointsRoot: string;
  digest: string;
  candidateRoot: string;
  description: T;
  expectedToken: string | null;
  readCurrent(): Promise<{ token: string | null; digest?: string }>;
  verify(directory: string): Promise<T>;
  commit(description: T): Promise<void>;
  afterCommit?(): Promise<void>;
  retainHistory?: boolean;
  commitSameDigest?: boolean;
  confirmCommit?(): Promise<boolean>;
  withAdmission?(commit: () => Promise<{ description: T; reused: boolean }>): Promise<{ description: T; reused: boolean }>;
}): Promise<{ description: T; reused: boolean }> {
  if (!/^[a-f0-9]{64}$/.test(input.digest)) throw new Error("Invalid checkpoint digest");
  // Staging sits outside the directory traversed by version cleanup.
  await mkdir(input.runtimeRoot, { recursive: true });
  const staged = await mkdtemp(join(input.runtimeRoot, ".checkpoint-staging-"));
  try {
    await cp(input.candidateRoot, join(staged, "memory"), { recursive: true });
    await atomicWriteJson(join(staged, "checkpoint.json"), input.description);
    const commitPrepared = () => withCheckpointRecordLock(input.runtimeRoot, input.changeId, async () => {
      const current = await input.readCurrent();
      const directory = join(input.checkpointsRoot, input.digest);
      if (current.digest === input.digest && !input.commitSameDigest) {
        return { description: await input.verify(directory), reused: true };
      }
      if (current.token !== input.expectedToken) {
        throw Object.assign(new Error(`ChangeSet ${input.changeId} changed during validation; validate again`), { code: "CHECKPOINT_CONFLICT" });
      }
      await mkdir(input.checkpointsRoot, { recursive: true });
      let description: T;
      try {
        await readFile(join(directory, "checkpoint.json"));
        description = await input.verify(directory);
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
        await rename(staged, directory);
        description = await input.verify(directory);
      }
      try {
        await input.commit(description);
      } catch (error) {
        // A write may have committed before its acknowledgement failed.
        if ((await input.readCurrent()).digest !== input.digest || input.confirmCommit && !await input.confirmCommit()) throw error;
        await input.verify(directory);
      }
      await input.afterCommit?.();
      const latest = await input.readCurrent();
      if (latest.digest !== input.digest || input.confirmCommit && !await input.confirmCommit()) throw new Error("Checkpoint commit did not publish the prepared version and metadata");
      for (const entry of input.retainHistory ? [] : await readdir(input.checkpointsRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name) && entry.name !== latest.digest) {
          await rm(join(input.checkpointsRoot, entry.name), { recursive: true, force: true });
        }
      }
      return { description, reused: current.digest === input.digest };
    });
    return await (input.withAdmission ? input.withAdmission(commitPrepared) : commitPrepared());
  } finally { await rm(staged, { recursive: true, force: true }); }
}
