import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { gitOutput } from "../git.js";

export type WorkspaceIdentity = {
  key: string;
  instanceKey: string;
  path: string;
  kind: "git" | "directory";
};

export async function resolveWorkspaceIdentity(cwd = process.cwd()): Promise<WorkspaceIdentity> {
  const path = await realpath(resolve(cwd));
  try {
    const topLevel = await gitOutput(["rev-parse", "--show-toplevel"], path);
    const commonDirOutput = await gitOutput(["rev-parse", "--git-common-dir"], path);
    const gitDirOutput = await gitOutput(["rev-parse", "--git-dir"], path);
    const commonDir = await realpath(isAbsolute(commonDirOutput) ? commonDirOutput : resolve(path, commonDirOutput));
    const gitDir = await realpath(isAbsolute(gitDirOutput) ? gitDirOutput : resolve(path, gitDirOutput));
    return {
      key: `git:${normalizeKey(commonDir)}`,
      instanceKey: `git-worktree:${normalizeKey(gitDir)}`,
      path: await realpath(topLevel),
      kind: "git"
    };
  } catch {
    const key = `dir:${normalizeKey(path)}`;
    return { key, instanceKey: key, path, kind: "directory" };
  }
}

function normalizeKey(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
