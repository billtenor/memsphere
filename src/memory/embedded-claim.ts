import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { gitHashObject } from "../git.js";
import { repositoryMemoryPath } from "./embedded-capture.js";
import type { MemoryChangeSet } from "./changeset.js";

type Mutation = { path: string; before?: Buffer; after?: Buffer };
export class EmbeddedClaimWriteError extends Error {
  readonly code = "EMBEDDED_CLAIM_WRITE_FAILED";
  constructor(readonly details: { changeId: string; checkpointDigest?: string; writtenPaths: string[]; pendingPaths: string[]; metadataConfirmed: boolean }, cause: unknown) {
    super(`Embedded claim failed; written: ${details.writtenPaths.join(", ") || "none"}; pending: ${details.pendingPaths.join(", ") || "none"}; metadata confirmed: ${details.metadataConfirmed}. Re-read current files and retry claim. ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}
async function currentFile(root: string, path: string): Promise<Buffer | undefined> {
  const destination = join(root, path);
  const info = await lstat(destination).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; });
  if (!info) {
    let parent = dirname(destination);
    for (;;) {
      const resolved = await realpath(parent).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; });
      if (resolved) {
        const actualRoot = await realpath(root);
        if (resolved !== actualRoot && !resolved.startsWith(`${actualRoot}${sep}`)) throw new Error(`claim destination escapes Memory root: ${path}`);
        break;
      }
      const next = dirname(parent); if (next === parent) throw new Error(`claim parent is unavailable: ${path}`); parent = next;
    }
    return undefined;
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`claim requires a regular Memory file: ${path}`);
  const actual = await realpath(destination), actualRoot = await realpath(root);
  if (!actual.startsWith(`${actualRoot}${sep}`)) throw new Error(`claim file escapes Memory root: ${path}`);
  return readFile(actual);
}
/** Preflight all targets before returning any write capability. */
export async function prepareEmbeddedClaim(input: { change: MemoryChangeSet; root: string; repositoryRoot: string; memoryPath: string; checkpointRoot?: string }) {
  const mutations: Mutation[] = [];
  if (!input.checkpointRoot) for (const scope of input.change.scope) {
    const bytes = await currentFile(input.root, scope.path);
    if (!bytes || await gitHashObject(bytes, input.repositoryRoot, repositoryMemoryPath(input.memoryPath, scope.path)) !== scope.base_digest) {
      throw new Error(`edit conflict: scoped Memory changed or was deleted since ChangeSet creation: ${scope.path}`);
    }
  }
  for (const target of input.change.targets) {
    if (!input.checkpointRoot) throw new Error(`ChangeSet ${input.change.id} has no checkpoint candidate`);
    const sourceBytes = await currentFile(input.root, target.path);
    const sourceBlob = sourceBytes && await gitHashObject(sourceBytes, input.repositoryRoot, repositoryMemoryPath(input.memoryPath, target.path));
    if (target.operation === "delete") {
      if (sourceBytes && sourceBlob !== target.base_digest) throw new Error(`edit conflict: claim would delete changed Memory: ${target.path}`);
      mutations.push({ path: target.path, before: sourceBytes }); continue;
    }
    const candidate = await readFile(join(input.checkpointRoot, target.path));
    const destinationPath = target.destination_path ?? target.path;
    const candidateBlob = target.candidate_blob_digest ?? await gitHashObject(candidate, input.repositoryRoot, repositoryMemoryPath(input.memoryPath, destinationPath));
    if (target.operation === "rename") {
      const destination = await currentFile(input.root, destinationPath);
      const destinationBlob = destination && await gitHashObject(destination, input.repositoryRoot, repositoryMemoryPath(input.memoryPath, destinationPath));
      const candidateAtSource = await gitHashObject(candidate, input.repositoryRoot, repositoryMemoryPath(input.memoryPath, target.path));
      if (sourceBytes && sourceBlob !== target.base_digest && sourceBlob !== candidateAtSource || destination && destinationBlob !== candidateBlob || !sourceBytes && !destination) {
        throw new Error(`edit conflict: claim rename would overwrite or recreate changed Memory: ${target.path} -> ${destinationPath}`);
      }
      mutations.push({ path: destinationPath, before: destination, after: candidate }, { path: target.path, before: sourceBytes });
    } else {
      if (sourceBytes && sourceBlob !== target.base_digest && sourceBlob !== candidateBlob || !sourceBytes && target.operation === "update") {
        throw new Error(`edit conflict: claim would overwrite changed or deleted Memory: ${target.path}`);
      }
      mutations.push({ path: target.path, before: sourceBytes, after: candidate });
    }
  }
  return {
    paths: mutations.map(m => m.path),
    async apply(beforeWrite?: (path: string, index: number) => Promise<void>): Promise<string[]> {
      const written: string[] = [];
      for (const [index, mutation] of mutations.entries()) {
        try {
          await beforeWrite?.(mutation.path, index);
          const now = await currentFile(input.root, mutation.path);
          if (Boolean(now) !== Boolean(mutation.before) || now && !now.equals(mutation.before!)) throw new Error(`Memory changed after claim preflight: ${mutation.path}`);
          if (now && mutation.after && now.equals(mutation.after) || !now && !mutation.after) continue;
          if (mutation.after) {
            const destination = join(input.root, mutation.path);
            await mkdir(dirname(destination), { recursive: true });
            const staging = await mkdtemp(join(dirname(destination), ".memsphere-claim-"));
            try {
              const prepared = join(staging, "memory");
              // A failed write must leave the worktree file intact so claim can be retried.
              await writeFile(prepared, mutation.after);
              if (now) await chmod(prepared, (await lstat(destination)).mode & 0o777);
              const current = await currentFile(input.root, mutation.path);
              if (Boolean(current) !== Boolean(now) || current && !current.equals(now!)) throw new Error(`Memory changed while preparing claim write: ${mutation.path}`);
              await rename(prepared, destination);
            } finally {
              await rm(staging, { recursive: true, force: true }).catch(() => undefined);
            }
          } else await rm(join(input.root, mutation.path));
          written.push(mutation.path);
        } catch (cause) {
          throw new EmbeddedClaimWriteError({ changeId: input.change.id, checkpointDigest: input.change.checkpoint?.digest,
            writtenPaths: written, pendingPaths: mutations.slice(index).map(m => m.path), metadataConfirmed: false }, cause);
        }
      }
      return written;
    }
  };
}
