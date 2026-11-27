import { z } from "zod";
import { reviewRuleSchema, reviewSourceSchema } from "../review-nodes.js";
import { cliCommandSchema, nextAction } from "../prompts/cli-output.js";
import type { PromptLocale } from "../prompts/locale.js";
import { cliCommand, commandFacts, paginateCliItems } from "./output.js";
import type { PaginationOptions } from "../pagination.js";

const str = z.string();
const opt = str.optional();
const count = z.number().int().nonnegative();
const ids = z.array(str);
const ref = z.object({ kind: z.enum(["artifact", "external"]), id: str }).strict();

export const reviewComment = z.object({
  commentId: opt, id: opt, body: str, severity: opt, createdAt: opt, updatedAt: opt,
  anchor: z.object({ submissionId: opt, target: opt, location: opt, sourceHash: opt, context: opt, targetRef: ref.optional() }).strict().optional()
}).strict();

const nodeShape = {
  nodeId: str, name: str, kind: z.literal("open_review").optional(),
  reported: z.boolean(), applicable: z.boolean().optional(),
  requiresReport: z.boolean(), complete: z.boolean(), hasContent: z.boolean(), isCurrent: z.boolean(),
  source: reviewSourceSchema.optional(), defines: ids.optional(), path: ids.optional(),
  asserts: z.array(reviewRuleSchema).optional(), suggests: z.array(reviewRuleSchema).optional(),
  ruleResults: z.array(z.object({ rulePath: str, result: z.enum(["not_satisfied", "undetermined"]), commentIds: ids }).strict()).optional(),
  reasonCommentId: opt, commentIds: ids, comments: z.array(reviewComment).optional(),
  assertCount: count.optional(), suggestCount: count.optional()
};
const node = z.object(nodeShape).strict();
type Tree = z.infer<typeof node> & { children: Tree[] };
const tree: z.ZodType<Tree> = z.lazy(() => node.extend({ children: z.array(tree) }));

const nodeResult = z.object({
  runId: opt, stepId: opt, reviewId: opt, roundId: opt, artifactId: opt, status: opt,
  operation: opt, savedNodeId: opt, commentId: opt, savedCommentIds: ids.optional(),
  progress: z.object({ phase: str, processed: count, total: count }).strict().optional(),
  node: node.optional(), nodes: z.array(node).optional(), tree: tree.optional(), comments: z.array(reviewComment).optional(),
  vote: z.union([str, z.object({ value: str, summary: opt }).strict()]).optional(),
  summary: opt, reviewer: opt, createdAt: opt,
  materials: z.array(ref.extend({ sha256: opt, contentType: opt })).optional(),
  configuration: z.object({ reviewer: opt, asserts: ids.optional(), suggests: ids.optional() }).strict().optional(),
  warnings: z.array(z.enum(["REVIEW_SESSION_NOT_BOUND", "REVIEW_DISPATCH_PENDING"])).max(2).optional(),
  nextAction
}).strict();
const nodeSummary = nodeResult.pick({
  reviewId: true, roundId: true, artifactId: true, stepId: true, createdAt: true, reviewer: true,
  status: true, progress: true
});
const nodePage = z.object({ runId: str, items: z.array(nodeSummary), nextCursor: opt }).strict();

type ReceiptOptions = { locale?: PromptLocale; reviewer?: boolean; project?: string };
type ReviewView = z.input<typeof nodeResult>;

function publicReviewView(raw: unknown): ReviewView {
  const value = raw as Omit<ReviewView, "vote"> & { vote?: { value: string; summary?: string } | string };
  return {
    runId: value.runId, stepId: value.stepId, reviewId: value.reviewId, roundId: value.roundId,
    artifactId: value.artifactId, status: value.status, operation: value.operation,
    savedNodeId: value.savedNodeId, commentId: value.commentId, savedCommentIds: value.savedCommentIds,
    progress: value.progress, node: value.node, nodes: value.nodes, tree: value.tree, comments: value.comments,
    vote: typeof value.vote === "object" ? { value: value.vote.value, summary: value.vote.summary } : value.vote,
    summary: value.summary, reviewer: value.reviewer, materials: value.materials, configuration: value.configuration,
    createdAt: value.createdAt
  };
}

export function emitReviewNodeResult(operation: string, raw: unknown, options: ReceiptOptions & {
  warnings?: ReviewView["warnings"];
  boundReviewId?: string;
}) {
  const result = publicReviewView(raw);
  const launcher = options.reviewer ? "reviewer" : "memsphere";
  const scope = options.reviewer ? ["continue"] : [
    ...(options.project ? ["--project", options.project] : []), "run", "review"
  ];
  const target = options.reviewer ? [] : ["--run", result.runId!, "--review", result.reviewId!];
  const action = (args: string[]) => cliCommand([...scope, ...args, ...target], launcher);
  if (options.warnings?.length) result.warnings = options.warnings;
  if (result.warnings?.includes("REVIEW_SESSION_NOT_BOUND")) {
    result.nextAction = cliCommand([...(options.project ? ["--project", options.project] : []), "run", "enter", ...target]);
  } else if (!options.reviewer && result.reviewer && result.reviewer !== "runner" && !["submitted", "cancelled"].includes(result.status ?? "")) {
    result.nextAction = { kind: "wait", resume: cliCommand([
      ...(options.project ? ["--project", options.project] : []), "run", "review", "wait", "--review", result.reviewId!
    ]) };
  } else if (result.progress?.phase === "reviewing") result.nextAction = operation === "show" ? action(["report", "--artifact-file", "<node-result>"]) : action(["show"]);
  else if (result.progress?.phase === "final_review") result.nextAction = action(["submit", "--artifact-file", "<vote>"]);
  const command = operation.replace("comment-", "comment ");
  const changed = ["start", "report", "update", "comment-add", "comment-update", "comment-delete", "submit"].includes(operation);
  const identity = options.reviewer ? {} : {
    runId: result.runId, stepId: result.stepId, reviewId: result.reviewId, roundId: result.roundId, artifactId: result.artifactId
  };
  const base = { ...identity, status: result.status, progress: result.progress };
  const nextAction = result.progress?.phase === "submitted" || result.status === "submitted" || result.status === "cancelled"
    ? undefined : result.nextAction;
  let receipt: ReviewView;
  switch (operation) {
    case "start": receipt = { ...base, warnings: result.warnings, nextAction }; break;
    case "report": case "update":
      receipt = { ...base, operation, savedNodeId: result.savedNodeId, savedCommentIds: result.savedCommentIds, nextAction }; break;
    case "comment-add": case "comment-update": case "comment-delete":
      receipt = { ...base, operation, commentId: result.commentId, savedCommentIds: result.savedCommentIds, nextAction }; break;
    case "submit": receipt = { ...base, operation, vote: result.vote, summary: result.summary }; break;
    case "list": receipt = { ...base, tree: result.tree, vote: result.vote, summary: result.summary, nextAction }; break;
    case "show": receipt = { ...base, node: result.node, nodes: result.nodes, comments: result.comments,
      vote: result.vote, summary: result.summary, nextAction: result.comments ? undefined : nextAction }; break;
    default: throw new Error("Unknown review node operation");
  }
  const savedId = options.reviewer ? receipt.savedNodeId ?? receipt.commentId ?? options.boundReviewId : result.reviewId;
  return commandFacts(() => nodeResult.parse(receipt), { ...options, saved: changed && savedId ? { id: savedId, inspect: action(options.reviewer ? ["show", "--all"] : ["show"]) } : undefined });
}

export function emitReviewNodeList(runId: string, artifactId: string, items: z.input<typeof nodeSummary>[],
  options: ReceiptOptions & PaginationOptions) {
  const page = paginateCliItems(items, options, {
    command: "run review list", scope: { project: options.project, runId }, filters: { artifact: artifactId, progressive: true }
  }, "summary");
  return commandFacts(() => nodePage.parse({ runId, items: page.items, nextCursor: page.nextCursor }), options);
}
