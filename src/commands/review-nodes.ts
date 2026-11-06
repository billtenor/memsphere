import { tryReviewerResource } from "../acp/reviewer-resources.js";
import { Command, Option } from "commander";
import { readFile } from "node:fs/promises";
import { boundReviewNodeContext, boundReviewNodeView, mutateBoundReviewNode, submitBoundReviewNodes } from "../acp/review-session.js";
import { nodeCommentInputSchema, nodeCommentUpdateSchema, nodeReportSchema, nodeUpdateSchema } from "../review-nodes.js";
import { renderReviewNodeOutput } from "../prompts/review-nodes.js";
import { contextOnlyCommand, type Options } from "./context-control.js";

export type ReviewNodeOptions = { assignment?: string; node?: string; comment?: string; all?: boolean; artifact?: string; artifactFile?: string; output?: "text" | "json" };
export async function reviewNodeCommand(operation: string, options: ReviewNodeOptions) {
  for (const key of ["vote", "summary", "summaryFile", "body", "bodyFile", "bodyStdin", "severity", "target", "sourceHash", "submissionId", "context"]) {
    if ((options as Record<string, unknown>)[key] !== undefined) throw new Error(`review_node_content_must_use_artifact: ${key}`);
  }
  const binding = process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID;
  if (!binding || options.assignment && options.assignment !== binding) throw new Error("review_assignment_not_bound");
  const reading = ["show", "list"].includes(operation);
  if (options.node && options.all) throw new Error("review_show_node_all_exclusive");
  if (reading || operation === "comment-delete") {
    if (options.artifact !== undefined || options.artifactFile !== undefined) throw new Error("review_no_artifact_expected");
  } else if ((options.artifact !== undefined) === (options.artifactFile !== undefined)) throw new Error("review_artifact_source_required_exclusive");
  const input = reading || operation === "comment-delete" ? undefined : JSON.parse(options.artifact ?? await readFile(options.artifactFile!, "utf8"));
  let result: unknown;
  if (reading) result = await boundReviewNodeView({ nodeId: options.node, all: options.all, list: operation === "list" });
  else if (operation === "submit") result = await submitBoundReviewNodes(input);
  else if (operation === "report") result = await mutateBoundReviewNode({ operation, artifact: nodeReportSchema.parse(input) });
  else if (operation === "update") {
    if (!options.node) throw new Error("review_update_node_required");
    result = await mutateBoundReviewNode({ operation, nodeId: options.node, artifact: nodeUpdateSchema.parse(input) });
  } else if (operation === "comment-add") result = await mutateBoundReviewNode({ operation, nodeId: options.node, artifact: nodeCommentInputSchema.parse(input) });
  else if (operation === "comment-update" || operation === "comment-delete") {
    if (!options.comment) throw new Error("review_comment_required");
    result = operation === "comment-delete" ? await mutateBoundReviewNode({ operation, commentId: options.comment }) : await mutateBoundReviewNode({ operation, commentId: options.comment, artifact: nodeCommentUpdateSchema.parse(input) });
  } else throw new Error("review_operation_invalid");
  if (options.output === "json") console.log(JSON.stringify(result));
  else { const context = await boundReviewNodeContext(); console.log(renderReviewNodeOutput(operation, result, context.run.language ?? "zh-CN")); }
}
// Commander can consume shared flags on a parent command. Prefer explicitly
// supplied options over child defaults, so native and Continue agree.
function explicitOptions(command: Command, options: ReviewNodeOptions): ReviewNodeOptions {
  const result = { ...options };
  for (let current: Command | null = command; current; current = current.parent) {
    for (const [key, value] of Object.entries(current.opts())) {
      if (current.getOptionValueSource(key) === "cli") Object.assign(result, { [key]: value });
    }
  }
  return result;
}
export function registerReviewNodeCommands(run: Command) {
  const review = run.commands.find(c => c.name() === "review")!;
  const write = (c: Command) => c.option("--assignment <id>").option("--artifact <value>", "JSON artifact string").option("--artifact-file <path>", "JSON artifact file").addOption(new Option("--output <format>").choices(["text", "json"]).default("text"));
  write(review.command("report").description("Report the current review node and advance.")).action(o => reviewNodeCommand("report", o));
  write(review.command("update").description("Replace a node without advancing.")).requiredOption("--node <id>").action(o => reviewNodeCommand("update", o));
  const comment = review.commands.find(c => c.name() === "comment")!;
  for (const option of comment.options) if (["assignment", "severity"].includes(option.attributeName())) option.mandatory = false;
  write(comment.command("add").description("Add a Comment to the current or selected node.")).option("--node <id>").action((o, c) => reviewNodeCommand("comment-add", explicitOptions(c, o)));
  write(comment.command("update").description("Edit Comment body/severity without advancing.")).requiredOption("--comment <id>").action((o, c) => reviewNodeCommand("comment-update", explicitOptions(c, o)));
  comment.command("delete").description("Delete a Comment without changing progress or judgment.").option("--assignment <id>").requiredOption("--comment <id>").addOption(new Option("--output <format>").choices(["text", "json"]).default("text")).action((o, c) => reviewNodeCommand("comment-delete", explicitOptions(c, o)));
  const submit = review.commands.find(c => c.name() === "submit")!;
  submit.options.find(o => o.attributeName() === "vote")!.mandatory = false;
  submit.option("--artifact <value>").option("--artifact-file <path>");
  // Existing human/free-exploration routes keep their original handlers and targets.
  for (const op of ["list", "show"]) {
    const command = review.commands.find(c => c.name() === op)!;
    command.options.forEach(o => { if (["run", "review", "artifact"].includes(o.attributeName())) o.mandatory = false; });
    command.option("--assignment <id>").option("--round <id>", "fixed acceptance Round for an authorized context Artifact");
    if (op === "show") command.option("--node <id>").option("--all");
    command.action(async o => {
      if (o.assignment || process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID) {
        if (await tryReviewerResource(`review-${op}`, o)) return;
        if (o.review || o.artifact) throw new Error("review_query_target_conflict");
        await reviewNodeCommand(op, o);
      } else await contextOnlyCommand(`review-${op}`, o as Options);
    });
  }
}
/** Continue reuses native option definitions and handlers, without Runner CommandState. */
export async function reviewerContinue(nativeRun: Command, tail: string[]) {
  const review = nativeRun.commands.find(c => c.name() === "review")!, router = new Command("continue");
  for (const path of [["report"], ["update"], ["comment", "add"], ["comment", "update"], ["comment", "delete"], ["list"], ["show"], ["submit"]]) {
    let native = review, route = router;
    for (const name of path) { native = native.commands.find(c => c.name() === name)!; route = route.commands.find(c => c.name() === name) ?? route.command(name).description(native.description()); }
    for (const o of native.options.filter(o => ["node", "comment", "artifact", "artifactFile", "all", "output"].includes(o.attributeName()))) {
      const copy = new Option(o.flags, o.description); copy.mandatory = o.mandatory; if (o.defaultValue !== undefined) copy.default(o.defaultValue); if (o.argChoices) copy.choices(o.argChoices); route.addOption(copy);
    }
    route.action(o => reviewNodeCommand(path.join("-"), o));
  }
  await (await import("./cli-errors.js")).parseCli(router, [process.execPath, "continue", ...(tail.length ? tail : ["--help"])]);
}
