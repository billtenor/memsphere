import {
  archiveRun,
  listArchived,
  restoreRun,
  type ArchiveKind
} from "../archive/store.js";
import { readConfig } from "../config.js";
import { resolve } from "node:path";
import { compareStrings, parseListLimit, type PaginationOptions } from "../pagination.js";
import { z } from "zod";
import { savedResult, publishResult, paginateCliItems } from "./output.js";

const archiveListResult = z.object({
  items: z.array(z.object({
    kind: z.enum(["runs", "changes"]),
    id: z.string(),
    archivedAt: z.string().optional()
  }).strict()),
  nextCursor: z.string().optional()
}).strict();

const archiveRunResult = z.object({ runId: z.string(), archived: z.boolean() }).strict();
import { join } from "node:path";
import { readRun } from "../run/store.js";
import { openContextControl } from "../project/context-control.js";
import type { MemsphereConfig } from "../config.js";

async function contextArchiveRun(config: MemsphereConfig, id: string) {
  const service = config.project && await openContextControl(config.scopeRoot);
  const run = service && await service.findRun(id);
  if (!run) return undefined;
  for (const root of [config.runsRoot, join(config.archiveRoot, "runs")]) {
    try { await readRun(root, id); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    throw new Error("Run ID exists in both legacy and model Stores");
  }
  return { service: service!, run };
}

export async function archiveListCommand(kind?: string, options: PaginationOptions & { output?: "text" | "json" } = {}): Promise<void> {
  parseListLimit(options.limit);
  const normalizedKind = normalizeArchiveKind(kind);
  const config = await readConfig();
  const entries = await listArchived({
    archiveRoot: config.archiveRoot,
    kind: normalizedKind
  });
  if (!normalizedKind || normalizedKind === "runs") {
    const service = config.project && await openContextControl(config.scopeRoot);
    if (service) for (const run of await service.listRuns()) {
      await contextArchiveRun(config, run.id);
      if (run.archived) entries.push({ kind: "runs", id: run.id, path: `context_control/runs/${run.id}` });
    }
  }
  const page = paginateCliItems(entries.sort((a, b) => compareStrings(b.archivedAt ?? b.id, a.archivedAt ?? a.id)
    || compareStrings(a.kind, b.kind) || compareStrings(a.id, b.id)), options, {
    command: "archive list", scope: { archiveRoot: resolve(config.archiveRoot) }, filters: { kind: normalizedKind }
  }, "established");
  publishResult("archive list", () => archiveListResult.parse({
    items: page.items.map(({ kind, id, archivedAt }) => ({ kind, id, archivedAt })),
    nextCursor: page.nextCursor
  }), { format: options.output });
}

export async function archiveRunCommand(id: string): Promise<void> {
  const config = await readConfig();
  const context = await contextArchiveRun(config, id);
  if (context) await context.service.archive(id);
  else await archiveRun({ archiveRoot: config.archiveRoot, runsRoot: config.runsRoot, id });
  publishResult("archive run", () => archiveRunResult.parse({ runId: id, archived: true }), { saved: savedResult(id, ["archive", "list"]) });
}

export async function archiveRestoreRunCommand(id: string): Promise<void> {
  const config = await readConfig();
  const context = await contextArchiveRun(config, id);
  if (context) await context.service.archive(id, false);
  else await restoreRun({ archiveRoot: config.archiveRoot, runsRoot: config.runsRoot, id });
  publishResult("archive restore run", () => archiveRunResult.parse({ runId: id, archived: false }), { saved: savedResult(id, ["run", "show", "--run", id]) });
}

function normalizeArchiveKind(kind: string | undefined): ArchiveKind | undefined {
  if (kind === undefined) return undefined;
  if (kind === "runs" || kind === "changes") return kind;
  throw new TypeError(`unknown archive kind "${kind}". Expected: runs or changes`);
}
