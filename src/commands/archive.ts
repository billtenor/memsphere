import {
  archiveReview,
  archiveRun,
  listArchived,
  restoreReview,
  restoreRun,
  type ArchiveKind
} from "../archive/store.js";
import { readConfig } from "../config.js";

type ListOptions = {
  kind?: string;
};

type IdOptions = {
  id: string;
};

export async function archiveListCommand(kind?: string): Promise<void> {
  const config = await readConfig();
  const normalizedKind = normalizeArchiveKind(kind);
  const entries = await listArchived({
    archiveRoot: config.archiveRoot,
    kind: normalizedKind
  });

  if (!entries.length) {
    console.log("No archived items found.");
    return;
  }

  for (const entry of entries) {
    console.log(`${entry.kind} ${entry.id}${entry.archivedAt ? ` archived ${entry.archivedAt}` : ""}`);
  }
}

export async function archiveReviewCommand(id: string): Promise<void> {
  const config = await readConfig();
  const entry = await archiveReview({
    archiveRoot: config.archiveRoot,
    reviewsRoot: config.reviewsRoot,
    id
  });
  console.log(`archived review ${entry.id}`);
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

export async function archiveRestoreReviewCommand(id: string): Promise<void> {
  const config = await readConfig();
  const review = await restoreReview({
    archiveRoot: config.archiveRoot,
    reviewsRoot: config.reviewsRoot,
    id
  });
  console.log(`restored review ${review.id}`);
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
  if (kind === "reviews" || kind === "runs") return kind;
  throw new Error(`unknown archive kind "${kind}". Expected one of: reviews, runs`);
}
