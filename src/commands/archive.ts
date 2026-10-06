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

export async function archiveListCommand(kind?: string, options: PaginationOptions & { output?: "text" | "json" } = {}): Promise<void> {
  parseListLimit(options.limit);
  const normalizedKind = normalizeArchiveKind(kind);
  const config = await readConfig();
  const entries = await listArchived({
    archiveRoot: config.archiveRoot,
    kind: normalizedKind
  });
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
  const entry = await archiveRun({
    archiveRoot: config.archiveRoot,
    runsRoot: config.runsRoot,
    id
  });
  console.log(`archived run ${entry.id}`);
}

export async function archiveRestoreRunCommand(id: string): Promise<void> {
  const config = await readConfig();
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
