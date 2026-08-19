import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { gitOutput } from "../git.js";

export type WorkspaceIdentity = {
  key: string;
  path: string;
  kind: "git" | "directory";
};

export async function resolveWorkspaceIdentity(cwd = process.cwd()): Promise<WorkspaceIdentity> {
  const path = await realpath(resolve(cwd));
  try {
    const topLevel = await gitOutput(["rev-parse", "--show-toplevel"], path);
    const commonDirOutput = await gitOutput(["rev-parse", "--git-common-dir"], path);
    const commonDir = await realpath(isAbsolute(commonDirOutput) ? commonDirOutput : resolve(path, commonDirOutput));
    return { key: `git:${normalizeKey(commonDir)}`, path: await realpath(topLevel), kind: "git" };
  } catch {
    return { key: `dir:${normalizeKey(path)}`, path, kind: "directory" };
  }
}

function normalizeKey(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
