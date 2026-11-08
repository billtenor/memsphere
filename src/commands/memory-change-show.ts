import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMemoryChangeDetailSnapshot } from "../memory/changeset.js";
import { resolveProjectContext } from "../project/resolver.js";

/** A pinned, read-only material entrypoint shared by runners and reviewers. */
export async function memoryChangeShowCommand(changeId: string, options: {
  checkpoint: string; part: string; reference?: string; side: string;
}): Promise<void> {
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  const payload = await withMemoryChangeDetailSnapshot({
    home: context.home, project: context.primary.name, changeId, checkpointDigest: options.checkpoint,
    use: async ({ change, files }) => {
      return memoryChangePart({ change, files }, options);
    }
  });
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

type Detail = Parameters<Parameters<typeof withMemoryChangeDetailSnapshot>[0]["use"]>[0];
export async function memoryChangePart({ change, files }: Pick<Detail, "change" | "files">, options: { part: string; reference?: string; side: string }) {
      const identity = { changeId: change.id, project: change.project, checkpointDigest: change.checkpoint!.digest };
      const selected = options.reference ? files.filter(file => file.reference === options.reference) : files;
      if (options.reference && selected.length !== 1) throw new Error(`ChangeSet Memory reference not found or ambiguous: ${options.reference}`);
      switch (options.part) {
        case "summary": return { ...identity, status: change.status, baseRevision: change.checkpoint!.base_revision,
          files: selected.map(file => ({ reference: file.reference, path: file.label, operation: file.operation })) };
        case "validation": return { ...identity, validation: change.checkpoint };
        case "memory": {
          if (!options.reference) throw new Error("memory change show --part memory requires --reference");
          const file = selected[0]!;
          const path = options.side === "before" ? file.basePath : file.candidatePath;
          return { ...identity, reference: file.reference, side: options.side, operation: file.operation,
            content: path ? await readFile(path, "utf8") : null };
        }
        case "diff": return { ...identity, files: await Promise.all(selected.filter(file => file.operation !== "unchanged").map(async file => ({
          reference: file.reference, path: file.label, operation: file.operation,
          diff: await unifiedDiff(file.basePath ? await readFile(file.basePath, "utf8") : "",
            file.candidatePath ? await readFile(file.candidatePath, "utf8") : "")
        }))) };
        default: throw new Error(`Unknown ChangeSet material: ${options.part}`);
      }
}

/** Pure fixed snapshot construction; registration happens only after the reader's final check. */
export async function captureMemoryChange(changeId: string, checkpoint: string) {
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  return withMemoryChangeDetailSnapshot({ home: context.home, project: context.primary.name, changeId, checkpointDigest: checkpoint,
    use: async detail => ({
      summary: await memoryChangePart(detail, { part: "summary", side: "after" }),
      diff: await memoryChangePart(detail, { part: "diff", side: "after" }),
      validation: await memoryChangePart(detail, { part: "validation", side: "after" }),
      memories: await Promise.all(detail.files.map(async file => ({
        before: await memoryChangePart(detail, { part: "memory", side: "before", reference: file.reference }),
        after: await memoryChangePart(detail, { part: "memory", side: "after", reference: file.reference })
      })))
    }) });
}

async function unifiedDiff(before: string, after: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "memsphere-change-diff-"));
  try {
    await Promise.all([writeFile(join(root, "before"), before), writeFile(join(root, "after"), after)]);
    return await new Promise<string>((resolve, reject) => {
      execFile("git", ["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--text", "--no-color", "--", "before", "after"],
        { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
          if (error && error.code !== 1) reject(error);
          else resolve(stdout);
        });
    });
  } finally { await rm(root, { recursive: true, force: true }); }
}
