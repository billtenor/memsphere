import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
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

export type ReviewFile = {
  id: string;
  source?: "memory" | "task";
  title: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  doneAt?: string;
  memoryRoot: string;
  comments: ReviewComment[];
  agent?: {
    summary?: string;
  };
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
  title: z.string(),
  status: z.enum(reviewStatuses),
  createdAt: z.string(),
  updatedAt: z.string(),
  submittedAt: z.string().optional(),
  doneAt: z.string().optional(),
  memoryRoot: z.string(),
  comments: z.array(commentSchema),
  agent: z.object({ summary: z.string().optional() }).optional()
});

type CreateReviewInput = {
  title?: string;
  source?: "memory" | "task";
  memoryRoot: string;
  reviewsRoot: string;
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
    if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;
    reviews.push(await readReviewByFile(join(dir, entry.name)));
  }

  return reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getReview(reviewsRoot: string, id: string): Promise<ReviewFile | undefined> {
  const filePath = reviewPath(reviewsRoot, id);
  try {
    return await readReviewByFile(filePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function createReview(input: CreateReviewInput): Promise<ReviewFile> {
  await ensureReviewDirectory(input.reviewsRoot);
  const now = new Date().toISOString();
  const id = makeReviewId(now);
  const review: ReviewFile = {
    id,
    source: input.source ?? "memory",
    title: input.title?.trim() || `Review ${new Date(now).toLocaleString()}`,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    memoryRoot: input.memoryRoot,
    comments: []
  };
  await writeReview(input.reviewsRoot, review);
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

function reviewPath(reviewsRoot: string, id: string): string {
  return join(reviewsRoot, `${id}.yaml`);
}

async function readReviewByFile(filePath: string): Promise<ReviewFile> {
  const raw = await readFile(filePath, "utf8");
  return reviewSchema.parse(parse(raw));
}

async function writeReview(reviewsRoot: string, review: ReviewFile): Promise<void> {
  await writeFile(reviewPath(reviewsRoot, review.id), stringify(review, { lineWidth: 0 }), "utf8");
}

function makeReviewId(iso: string): string {
  const stamp = iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-").toLowerCase();
  return `review-${stamp}-${randomUUID().slice(0, 8)}`;
}
