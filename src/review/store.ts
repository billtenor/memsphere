import { copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, extname, isAbsolute, join, normalize } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";

export const reviewStatuses = ["draft", "submitted", "processing", "done"] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];

export type ReviewComment = {
  id: string;
  source?: "memory" | "task";
  memoryId: string;
  memoryName: string;
  kind: string;
  runId?: string;
  runName?: string;
  stepId?: string;
  artifactName?: string;
  target?: string;
  location?: {
    anchor: string;
    line: number;
    hash?: string;
  };
  snapshot?: string;
  body: string;
  createdAt: string;
};

export type ReviewSnapshot = {
  label: string;
  path: string;
  kind: "memory" | "task";
  createdAt: string;
};

export type ReviewTarget = {
  source: "memory" | "task";
  id: string;
  name?: string;
  path?: string;
  runId?: string;
};

export type ReviewFile = {
  id: string;
  source?: "memory" | "task";
  target?: ReviewTarget;
  title: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  doneAt?: string;
  memoryRoot: string;
  snapshots: ReviewSnapshot[];
  comments: ReviewComment[];
  agent?: {
    summary?: string;
  };
};

export type ReviewListSummary = {
  id: string;
  source: "memory" | "task";
  title: string;
  status: ReviewStatus;
  target?: ReviewTarget;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  snapshotKinds: Array<"memory" | "task">;
};

const commentSchema = z.object({
  id: z.string(),
  source: z.enum(["memory", "task"]).optional(),
  memoryId: z.string(),
  memoryName: z.string(),
  kind: z.string(),
  runId: z.string().optional(),
  runName: z.string().optional(),
  stepId: z.string().optional(),
  artifactName: z.string().optional(),
  target: z.string().optional(),
  location: z.object({
    anchor: z.string(),
    line: z.number(),
    hash: z.string().optional()
  }).optional(),
  snapshot: z.string().optional(),
  body: z.string(),
  createdAt: z.string()
});

const reviewSchema = z.object({
  id: z.string(),
  source: z.enum(["memory", "task"]).optional(),
  target: z.object({
    source: z.enum(["memory", "task"]),
    id: z.string(),
    name: z.string().optional(),
    path: z.string().optional(),
    runId: z.string().optional()
  }).optional(),
  title: z.string(),
  status: z.enum(reviewStatuses),
  createdAt: z.string(),
  updatedAt: z.string(),
  submittedAt: z.string().optional(),
  doneAt: z.string().optional(),
  memoryRoot: z.string(),
  snapshots: z.array(z.object({
    label: z.string(),
    path: z.string(),
    kind: z.enum(["memory", "task"]),
    createdAt: z.string()
  })).min(1),
  comments: z.array(commentSchema),
  agent: z.object({ summary: z.string().optional() }).optional()
});

const reviewListSummarySchema: z.ZodType<ReviewListSummary> = z.object({
  id: z.string(),
  source: z.enum(["memory", "task"]),
  title: z.string(),
  status: z.enum(reviewStatuses),
  target: z.object({
    source: z.enum(["memory", "task"]),
    id: z.string(),
    name: z.string().optional(),
    path: z.string().optional(),
    runId: z.string().optional()
  }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  commentCount: z.number().int().nonnegative(),
  snapshotKinds: z.array(z.enum(["memory", "task"]))
});

const reviewSummaryCacheSchema = z.object({
  source: z.object({ size: z.number().int().nonnegative(), mtimeMs: z.number().nonnegative() }),
  summary: reviewListSummarySchema
});

type CreateReviewInput = {
  title?: string;
  source?: "memory" | "task";
  target?: ReviewTarget;
  memoryRoot: string;
  reviewsRoot: string;
  snapshotFiles?: Array<{
    label: string;
    path: string;
    kind: "memory" | "task";
    directory?: boolean;
    entryPath?: string;
    rewriteRunMemoryRoot?: string;
    snapshotPath?: string;
    snapshotDirectoryPath?: string;
  }>;
};

type UpdateReviewInput = {
  title?: string;
  status?: ReviewStatus;
  comments?: ReviewComment[];
};

export async function ensureReviewDirectory(reviewsRoot: string): Promise<string> {
  await mkdir(reviewsRoot, { recursive: true });
  return reviewsRoot;
}

export async function listReviews(reviewsRoot: string): Promise<ReviewFile[]> {
  const dir = await ensureReviewDirectory(reviewsRoot);
  const entries = await readdir(dir, { withFileTypes: true });
  const reviews: ReviewFile[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const filePath = join(dir, entry.name, "review.yaml");
      if (await pathExists(filePath)) {
        reviews.push(await readReviewByFile(filePath));
      }
    }
  }

  return reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listReviewSummaries(
  reviewsRoot: string,
  subject?: { memoryId?: string; memoryPath?: string }
): Promise<ReviewListSummary[]> {
  const dir = await ensureReviewDirectory(reviewsRoot);
  const entries = await readdir(dir, { withFileTypes: true });
  const summaries: ReviewListSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const reviewPath = join(dir, entry.name, "review.yaml");
    if (!(await pathExists(reviewPath))) continue;
    const summary = await readReviewSummary(entry.name, reviewPath);
    if (summary.target?.source !== "task") summaries.push(summary);
  }
  return summaries
    .filter((review) => {
      if (!subject?.memoryId && !subject?.memoryPath) return true;
      if (subject.memoryPath && review.target?.path) return review.target.path === subject.memoryPath;
      return Boolean(subject.memoryId && review.target?.id === subject.memoryId);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function readReviewSummary(directoryName: string, reviewPath: string): Promise<ReviewListSummary> {
  const source = await stat(reviewPath);
  const cachePath = join(dirname(reviewPath), "summary.json");
  try {
    const cached = reviewSummaryCacheSchema.parse(JSON.parse(await readFile(cachePath, "utf8")));
    if (
      cached.summary.id === directoryName
      && cached.source.size === source.size
      && cached.source.mtimeMs === source.mtimeMs
    ) return cached.summary;
  } catch {
    // Legacy or stale Review: rebuild the derived summary once from the canonical YAML.
  }
  const review = await readReviewByFile(reviewPath);
  if (review.id !== directoryName) throw new Error(`review directory id does not match review.yaml: ${directoryName}`);
  const summary = reviewSummary(review);
  await writeReviewSummaryCache(cachePath, { size: source.size, mtimeMs: source.mtimeMs }, summary).catch(() => undefined);
  return summary;
}

function reviewSummary(review: ReviewFile): ReviewListSummary {
  const firstComment = review.comments[0];
  const memorySnapshot = review.snapshots.find((snapshot) => snapshot.kind === "memory");
  const target = review.target ?? (firstComment || memorySnapshot ? {
    source: "memory" as const,
    id: firstComment?.memoryId ?? "",
    name: firstComment?.memoryName,
    path: memorySnapshot?.label
  } : undefined);
  return {
    id: review.id,
    source: review.source ?? target?.source ?? "memory",
    title: review.title,
    status: review.status,
    target,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    commentCount: review.comments.length,
    snapshotKinds: [...new Set(review.snapshots.map((snapshot) => snapshot.kind))]
  };
}

export async function getReview(reviewsRoot: string, id: string): Promise<ReviewFile | undefined> {
  const filePath = directoryReviewPath(reviewsRoot, id);
  try {
    return await readReviewByFile(filePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function readReviewSnapshot(
  reviewsRoot: string,
  id: string,
  kind?: "memory" | "task"
): Promise<{ snapshot: ReviewSnapshot; content: string; snapshotRoot: string } | undefined> {
  const review = await getReview(reviewsRoot, id);
  if (!review) return undefined;
  const snapshot = review.snapshots.find((item) => !kind || item.kind === kind);
  if (!snapshot) return undefined;
  const safePath = safeRelativePath(snapshot.path);
  const content = await readFile(join(reviewsRoot, id, safePath), "utf8");
  return { snapshot, content, snapshotRoot: snapshotArtifactRoot(reviewsRoot, id, snapshot, safePath) };
}

export async function createReview(input: CreateReviewInput): Promise<ReviewFile> {
  await ensureReviewDirectory(input.reviewsRoot);
  const now = new Date().toISOString();
  const id = makeReviewId(now);
  const review: ReviewFile = {
    id,
    source: input.source ?? "memory",
    target: input.target,
    title: input.title?.trim() || `Review ${new Date(now).toLocaleString()}`,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    memoryRoot: input.source === "task" ? "snapshots/memory" : "snapshots",
    snapshots: await createSnapshots(input.reviewsRoot, id, input.snapshotFiles ?? [], now),
    comments: []
  };
  await writeReviewToDirectory(input.reviewsRoot, review);
  return review;
}

export async function updateReview(reviewsRoot: string, id: string, patch: UpdateReviewInput): Promise<ReviewFile | undefined> {
  const review = await getReview(reviewsRoot, id);
  if (!review) return undefined;

  const now = new Date().toISOString();
  if (typeof patch.title === "string" && patch.title.trim()) {
    review.title = patch.title.trim();
  }
  if (patch.comments) {
    review.comments = patch.comments;
  }
  if (patch.status && patch.status !== review.status) {
    review.status = patch.status;
    if (patch.status === "submitted") review.submittedAt = now;
    if (patch.status === "done") review.doneAt = now;
  }
  review.updatedAt = now;
  await writeReview(reviewsRoot, review);
  return review;
}

export async function deleteReview(reviewsRoot: string, id: string): Promise<boolean> {
  const filePath = directoryReviewPath(reviewsRoot, id);
  if (!(await pathExists(filePath))) return false;
  await rm(join(reviewsRoot, id), { recursive: true, force: true });
  return true;
}

function directoryReviewPath(reviewsRoot: string, id: string): string {
  return join(reviewsRoot, id, "review.yaml");
}

async function readReviewByFile(filePath: string): Promise<ReviewFile> {
  const raw = await readFile(filePath, "utf8");
  return reviewSchema.parse(parse(raw));
}

async function writeReview(reviewsRoot: string, review: ReviewFile): Promise<void> {
  await writeReviewToDirectory(reviewsRoot, review);
}

async function writeReviewToDirectory(reviewsRoot: string, review: ReviewFile): Promise<void> {
  const reviewDir = join(reviewsRoot, review.id);
  await mkdir(reviewDir, { recursive: true });
  const reviewPath = join(reviewDir, "review.yaml");
  await writeFile(reviewPath, stringify(review, { lineWidth: 0 }), "utf8");
  const source = await stat(reviewPath);
  await writeReviewSummaryCache(
    join(reviewDir, "summary.json"),
    { size: source.size, mtimeMs: source.mtimeMs },
    reviewSummary(review)
  );
}

async function writeReviewSummaryCache(
  cachePath: string,
  source: { size: number; mtimeMs: number },
  summary: ReviewListSummary
): Promise<void> {
  await writeFile(cachePath, `${JSON.stringify({ source, summary })}\n`, "utf8");
}

async function createSnapshots(
  reviewsRoot: string,
  reviewId: string,
  files: NonNullable<CreateReviewInput["snapshotFiles"]>,
  createdAt: string
): Promise<ReviewSnapshot[]> {
  if (!files.length) {
    throw new Error("review requires at least one snapshot file");
  }

  const snapshotsDir = join(reviewsRoot, reviewId, "snapshots");
  await mkdir(snapshotsDir, { recursive: true });
  const snapshots: ReviewSnapshot[] = [];

  for (const [index, file] of files.entries()) {
    if (!(await pathExists(file.path))) continue;
    const source = await stat(file.path);
    const snapshotName = `${String(index + 1).padStart(2, "0")}-${safeSnapshotName(file.label || basename(file.path), file.path)}`;
    const snapshotPath = join(snapshotsDir, snapshotName);
    let storedPath = `snapshots/${snapshotName}`;

    if (file.directory && source.isDirectory()) {
      const directoryPath = file.snapshotDirectoryPath
        ? safeRelativePath(file.snapshotDirectoryPath)
        : safeSnapshotDirectoryName(basename(file.path));
      const snapshotDirectory = join(snapshotsDir, directoryPath);
      await cp(file.path, snapshotDirectory, { recursive: true });
      storedPath = `snapshots/${directoryPath}/${file.entryPath ?? ""}`;
      if (file.kind === "task" && file.entryPath) {
        await rewriteRunMemoryRoot(join(snapshotDirectory, file.entryPath), file.rewriteRunMemoryRoot ?? "snapshots/memory");
      }
    } else {
      if (file.snapshotPath) {
        const safePath = safeRelativePath(file.snapshotPath);
        const nestedSnapshotPath = join(snapshotsDir, safePath);
        await mkdir(dirname(nestedSnapshotPath), { recursive: true });
        await copyFile(file.path, nestedSnapshotPath);
        storedPath = `snapshots/${safePath}`;
      } else {
        await copyFile(file.path, snapshotPath);
      }
    }

    snapshots.push({
      label: file.label,
      path: storedPath,
      kind: file.kind,
      createdAt
    });
  }

  if (!snapshots.length) {
    throw new Error("review snapshot files were not found");
  }
  return snapshots;
}

function safeSnapshotName(label: string, sourcePath: string): string {
  const ext = extname(sourcePath);
  const base = label.replace(ext, "").trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "") || "snapshot";
  return `${base}${ext || ".txt"}`;
}

function safeSnapshotDirectoryName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "") || "snapshot";
}

async function rewriteRunMemoryRoot(path: string, memoryRoot: string): Promise<void> {
  const raw = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  await writeFile(path, `${JSON.stringify({ ...parsed, memoryRoot }, null, 2)}\n`, "utf8");
}

function safeRelativePath(path: string): string {
  const normalized = normalize(path);
  if (isAbsolute(normalized) || normalized.startsWith("..")) {
    throw new Error(`invalid snapshot path: ${path}`);
  }
  return normalized;
}

function snapshotArtifactRoot(reviewsRoot: string, reviewId: string, snapshot: ReviewSnapshot, safePath: string): string {
  const runsPrefix = join("snapshots", "runs") + "/";
  if (snapshot.kind === "task" && safePath.replace(/\\/g, "/").startsWith(runsPrefix)) {
    return join(reviewsRoot, reviewId, "snapshots", "runs");
  }
  return join(reviewsRoot, reviewId, "snapshots");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function makeReviewId(iso: string): string {
  const stamp = iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-").toLowerCase();
  return `review-${stamp}-${randomUUID().slice(0, 8)}`;
}
