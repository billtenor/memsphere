import {
  archiveRun,
  listArchived,
  restoreRun,
  type ArchiveKind
} from "../archive/store.js";
import { readConfig } from "../config.js";
import { resolve } from "node:path";
import { compareStrings, paginateItems, parseListLimit, type PaginationOptions } from "../pagination.js";
import { emitCommandResult } from "./cli-errors.js";
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
  const page = paginateItems(entries.sort((a, b) => compareStrings(b.archivedAt ?? b.id, a.archivedAt ?? a.id)
    || compareStrings(a.kind, b.kind) || compareStrings(a.id, b.id)), options, {
    command: "archive list", scope: { archiveRoot: resolve(config.archiveRoot) }, filters: { kind: normalizedKind }
  });
  if (options.output === "json") {
    emitCommandResult(page, "json");
    return;
  }

  if (!page.items.length) {
    console.log("No archived items found.");
    return;
  }

  for (const entry of page.items) {
    console.log(`${entry.kind} ${entry.id}${entry.archivedAt ? ` archived ${entry.archivedAt}` : ""}`);
  }
  if (page.nextCursor) console.log(`nextCursor: ${page.nextCursor}`);
}

export async function archiveRunCommand(id: string): Promise<void> {
  const config = await readConfig();
  const context = await contextArchiveRun(config, id);
  if (context) { await context.service.archive(id); console.log(`archived run ${id}`); return; }
  const entry = await archiveRun({
    archiveRoot: config.archiveRoot,
    runsRoot: config.runsRoot,
    id
  });
  console.log(`archived run ${entry.id}`);
}

export async function archiveRestoreRunCommand(id: string): Promise<void> {
  const config = await readConfig();
  const context = await contextArchiveRun(config, id);
  if (context) { await context.service.archive(id, false); console.log(`restored run ${id}`); return; }
  const run = await restoreRun({
    archiveRoot: config.archiveRoot,
    runsRoot: config.runsRoot,
    id
  });
  console.log(`restored run ${run.id}`);
}

function normalizeArchiveKind(kind: string | undefined): ArchiveKind | undefined {
  if (kind === undefined) return undefined;
  if (kind === "runs" || kind === "changes") return kind;
  throw new TypeError(`unknown archive kind "${kind}". Expected: runs or changes`);
}
