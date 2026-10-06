import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { AppError, relativePath } from "./contracts.js";

export function digest(bytes: string | Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
export async function readJson(path: string): Promise<unknown> { return JSON.parse(await readFile(path, "utf8")); }
export function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === "ENOENT"; }
export async function packagePath(root: string, path: string): Promise<string> {
  relativePath.parse(path);
  const base = await realpath(root);
  const candidate = resolve(base, path);
  const actual = await realpath(candidate);
  if (!actual.startsWith(`${base}${sep}`)) throw new AppError("APP_PATH_ESCAPE", `Asset escapes package: ${path}`);
  if ((await lstat(candidate)).isSymbolicLink()) throw new AppError("APP_PATH_ESCAPE", `Symbolic asset: ${path}`);
  return candidate;
}
/** Include every delivered byte; never follow links or special files into a cache. */
export async function packageDigest(root: string): Promise<string> {
  const entries: Array<[string, string]> = [];
  async function visit(path: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new AppError("APP_PATH_ESCAPE", `Symbolic package entry: ${path}`);
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(resolve(path, name));
    } else if (info.isFile()) entries.push([relative(root, path).split(sep).join("/"), digest(await readFile(path))]);
    else throw new AppError("APP_INVALID_FILE", `Unsupported package entry: ${path}`);
  }
  await visit(root);
  return digest(JSON.stringify(entries));
}
