import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { gitHashObject, gitOutput, gitOutputRaw } from "../git.js";
import { memoryKinds } from "./kinds.js";
import type { MemoryChangeSet } from "./changeset.js";

type Target = MemoryChangeSet["targets"][number];
type FileState = { repositoryPath: string; path: string; base?: string; blob?: string; bytes?: Buffer };
export type EmbeddedInspection = { targets: Target[]; files: FileState[]; fingerprint: string; attributesFingerprint: string };
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function repositoryMemoryPath(memoryPath: string, path: string): string {
  return memoryPath === "." ? path : `${memoryPath.replace(/\/$/, "")}/${path}`;
}
function safePath(memoryPath: string, repositoryPath: string): string | undefined {
  const path = memoryPath === "." ? repositoryPath : repositoryPath.startsWith(`${memoryPath}/`) ? repositoryPath.slice(memoryPath.length + 1) : "";
  const parts = path.split("/");
  if (!memoryKinds.includes(parts[0] as typeof memoryKinds[number]) || parts.length < 2 || parts.some(p => !p || p === "." || p === "..") || !/\.ya?ml$/i.test(path) || path.includes("\\")) return undefined;
  return path;
}
export async function embeddedAttributesFingerprint(root: string, paths: string[]): Promise<string> {
  const attributes: string[] = [];
  for (let start = 0; start < paths.length; start += 100) attributes.push(await gitOutput(["check-attr", "-z", "--all", "--", ...paths.slice(start, start + 100)], root));
  const configuration = (await gitOutput(["config", "--null", "--list"], root)).split("\0")
    .filter(entry => /^(?:core\.(?:autocrlf|eol|attributesfile)|filter\.)/i.test(entry)).sort();
  return hash(JSON.stringify([attributes, configuration]));
}
/** Inspect final paths, not concatenated tracked/untracked status records. No candidate directory is written. */
export async function inspectOrdinaryEmbeddedTargets(root: string, memoryRoot: string, memoryPath: string, base: string): Promise<EmbeddedInspection> {
  const listing = await gitOutput(["ls-tree", "-r", "-z", base, "--", memoryPath], root);
  const baselines = new Map<string, string>();
  for (const row of listing.split("\0").filter(Boolean)) {
    const tab = row.indexOf("\t");
    const [mode, kind, oid] = row.slice(0, tab).split(" ");
    const name = row.slice(tab + 1);
    if (safePath(memoryPath, name) === undefined) continue;
    if (kind !== "blob" || !/^100/.test(mode)) throw new Error(`Embedded Memory must be a regular Git file: ${name}`);
    baselines.set(name, oid);
  }
  const names = new Set([...baselines.keys(), ...(await gitOutput(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", memoryPath], root)).split("\0").filter(Boolean)]);
  const files: FileState[] = [];
  const resolvedMemoryRoot = await realpath(memoryRoot);
  for (const repositoryPath of [...names].sort()) {
    const path = safePath(memoryPath, repositoryPath);
    if (path === undefined) continue;
    const live = join(memoryRoot, path);
    const info = await lstat(live).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; });
    const state: FileState = { repositoryPath, path, base: baselines.get(repositoryPath) };
    if (info) {
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Embedded Memory must be a regular file: ${path}`);
      const actual = await realpath(live);
      if (!actual.startsWith(`${resolvedMemoryRoot}${sep}`)) throw new Error(`Embedded Memory escapes its root: ${path}`);
      state.bytes = await readFile(actual);
      state.blob = await gitHashObject(state.bytes, root, repositoryPath);
    }
    files.push(state);
  }
  const targets: Target[] = [];
  for (const state of files) {
    if (state.base === state.blob) continue;
    const operation = !state.base ? "create" : !state.blob ? "delete" : "update";
    const [kind, ...rest] = state.path.split("/");
    targets.push({ operation, reference: `${kind}/${rest.join("-").replace(/\.ya?ml$/i, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`,
      path: state.path, added_revision: base, ...(state.base ? { base_digest: state.base } : {}),
      ...(state.blob ? { candidate_blob_digest: state.blob } : {}) });
  }
  // Preserve Git's changed-rename hints when both normalized endpoints remain.
  const status = (await gitOutput(["diff", "--name-status", "-z", "-M", base, "--", memoryPath], root)).split("\0");
  const hints = new Map<string, string>();
  for (let i = 0; i < status.length;) {
    const code = status[i++]; if (!code) continue;
    if (code.startsWith("R") || code.startsWith("C")) { const old = status[i++], next = status[i++]; if (code.startsWith("R")) hints.set(old, next); }
    else i++;
  }
  const deleted = targets.filter(t => t.operation === "delete");
  for (const old of deleted) {
    const oldRepoPath = repositoryMemoryPath(memoryPath, old.path);
    const candidates = targets.filter(t => t.operation === "create" && t.path !== old.path);
    let next = candidates.find(t => repositoryMemoryPath(memoryPath, t.path) === hints.get(oldRepoPath));
    if (!next) {
      const baseBytes = Buffer.from(await gitOutputRaw(["show", `${base}:${oldRepoPath}`], root));
      for (const added of candidates) {
        const bytes = files.find(f => f.path === added.path)!.bytes!;
        // Compare at each real endpoint: a rename can also change the clean filter.
        const destination = repositoryMemoryPath(memoryPath, added.path);
        if (await gitHashObject(bytes, root, oldRepoPath) === old.base_digest
          || await gitHashObject(baseBytes, root, destination) === added.candidate_blob_digest) { next = added; break; }
      }
    }
    if (next) {
      old.operation = "rename"; old.destination_path = next.path; old.candidate_blob_digest = next.candidate_blob_digest;
      targets.splice(targets.indexOf(next), 1);
    }
  }
  targets.sort((a, b) => a.path.localeCompare(b.path));
  const attributesFingerprint = await embeddedAttributesFingerprint(root, files.map(f => f.repositoryPath));
  const fingerprint = hash(JSON.stringify([base, attributesFingerprint, files.map(f => [f.repositoryPath, f.base, f.blob, f.bytes ? hash(f.bytes) : null])]));
  return { targets, files, fingerprint, attributesFingerprint };
}
export async function captureOrdinaryEmbeddedTargets(root: string, memoryRoot: string, memoryPath: string, base: string): Promise<EmbeddedInspection & { candidateRoot: string }> {
  const inspection = await inspectOrdinaryEmbeddedTargets(root, memoryRoot, memoryPath, base);
  const candidateRoot = join(await mkdtemp(join(tmpdir(), "memsphere-embedded-change-")), "memory");
  try {
    await mkdir(candidateRoot);
    for (const target of inspection.targets) {
      if (target.operation === "delete") continue;
      const bytes = inspection.files.find(f => f.path === (target.destination_path ?? target.path))!.bytes!;
      const destination = join(candidateRoot, target.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    }
    return { ...inspection, candidateRoot };
  } catch (error) {
    await rm(dirname(candidateRoot), { recursive: true, force: true });
    throw error;
  }
}
