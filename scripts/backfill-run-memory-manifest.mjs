#!/usr/bin/env node
// Explicit maintenance tool; never invoked by Run content readers.
import { randomUUID } from "node:crypto";
import { lstat, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const kinds = ["concepts", "statements", "procedures", "schemas"];

export async function backfillRunMemoryManifest(runFile, write = false) {
  const path = resolve(runFile);
  if (!(await lstat(path)).isFile()) throw new Error("Run status must be a regular file, not a symbolic link");
  const original = await readFile(path, "utf8");
  const run = JSON.parse(original);
  if (!/^run-[a-zA-Z0-9-]+$/.test(run.id) || basename(path) !== `${run.id}.json`) throw new Error("Run status filename must match its Run ID");
  if (!run.memorySnapshot) return { id: run.id, status: "no-snapshot", changed: false };
  if (Object.hasOwn(run.memorySnapshot, "files")) {
    if (!Array.isArray(run.memorySnapshot.files) || run.memorySnapshot.files.some((id) => typeof id !== "string")) throw new Error("Existing memorySnapshot.files is invalid; not overwritten");
    return { id: run.id, status: "already-present", changed: false, files: run.memorySnapshot.files };
  }
  if (run.memorySnapshot.path !== "memory") throw new Error("Expected the existing Run Memory snapshot path: memory");
  const directory = dirname(path);
  const runDirectory = basename(directory) === run.id ? directory : join(directory, run.id);
  const snapshot = join(runDirectory, "memory");
  if (!(await lstat(snapshot)).isDirectory()) throw new Error("Run Memory snapshot must be a regular directory");
  const files = [];
  async function visit(directory, relative) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name === ".gitkeep") continue;
      const relativePath = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Snapshot symbolic link is not supported: ${relativePath}`);
      if (entry.isDirectory()) await visit(join(directory, entry.name), relativePath);
      else if (entry.isFile()) files.push(`${run.id}/memory/${relativePath}`);
      else throw new Error(`Snapshot entry is not a file or directory: ${relativePath}`);
    }
  }
  for (const kind of kinds) {
    const kindPath = join(snapshot, kind);
    try {
      if (!(await lstat(kindPath)).isDirectory()) throw new Error(`Invalid snapshot kind directory: ${kind}`);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    await visit(kindPath, kind);
  }
  files.sort();
  if (!write) return { id: run.id, status: "needs-backfill", changed: false, files };
  // Guard against overwriting a state update made while the snapshot was inspected.
  if (await readFile(path, "utf8") !== original) throw new Error("Run status changed during inspection; retry the tool");
  run.memorySnapshot.files = files;
  const temporary = join(directory, `.memory-manifest.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { flag: "wx" });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
  return { id: run.id, status: "backfilled", changed: true, files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const index = args.indexOf("--run-file");
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith("--")
    || args.some((arg, i) => i !== index && i !== index + 1 && arg !== "--write")) {
    console.error("Usage: node scripts/backfill-run-memory-manifest.mjs --run-file <Run status JSON> [--write]");
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await backfillRunMemoryManifest(args[index + 1], args.includes("--write")), null, 2)); }
    catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
  }
}
