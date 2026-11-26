import { registerResultAction, bindCliOutputs, setReviewerOutputProtocol } from "./output.js";
import { artifactReviewRoundControlPlane } from "../artifact-review.js";
import { reviewReceipt } from "./review-output.js";
import { tryReviewerResource } from "../acp/reviewer-resources.js";
import { Command, Option } from "commander";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { boundReviewNodeContext, boundReviewNodeView, mutateBoundReviewNode, submitBoundReviewNodes } from "../acp/review-session.js";
import { currentReviewNode, nodeCommentInputSchema, nodeCommentUpdateSchema, nodeReportSchema, nodeSubmitSchema, nodeUpdateSchema, type NodeMutation } from "../review-nodes.js";
import { emitReviewNodeResult } from "./review-node-output.js";
import { contextOnlyCommand, type ContextCommandScope, type Options } from "./context-control.js";
import { readConfig } from "../config.js";
import { openContextControl } from "../project/context-control.js";
import { ExplorationReviews, explorationReviewIdentity, isModelReviewHandle, mutateModelReviewNode } from "../context_control/exploration-review.js";
import { explorationReviewView, readArtifactReviewForRunner } from "../context_control/review-repository.js";
import { invalidCliOptions } from "./cli-errors.js";
import { failure } from "../context_control/errors.js";
import { currentCommandState, releaseCommandTarget, type CommandStateRow } from "../home/command-state-store.js";

export type ReviewNodeOptions = { run?: string; review?: string; assignment?: string; node?: string; comment?: string; all?: boolean; artifact?: string; artifactFile?: string; output?: "text" | "json"; sessionRow?: CommandStateRow };
export async function reviewNodeCommand(operation: string, options: ReviewNodeOptions, scope?: ContextCommandScope) {
  for (const key of ["vote", "summary", "summaryFile", "body", "bodyFile", "bodyStdin", "severity", "target", "sourceHash", "submissionId", "context"]) {
    if ((options as Record<string, unknown>)[key] !== undefined) throw invalidCliOptions("use_artifact", "--artifact", "--artifact-file");
  }
  const binding = process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID;
  if (binding && (options.review || options.run || options.assignment && options.assignment !== binding)) throw new Error("review_assignment_not_bound");
  if (!binding && (!options.run || !options.review || options.assignment)) throw failure("INVALID_ARGUMENT", "Specify an exploration Run and Review");
  const reading = ["show", "list"].includes(operation);
  if (options.node && options.all) throw invalidCliOptions("mutually_exclusive", "--node", "--all");
  if (reading || operation === "comment-delete") {
    if (options.artifact !== undefined || options.artifactFile !== undefined) throw invalidCliOptions("not_allowed", "--artifact", "--artifact-file");
  } else if ((options.artifact !== undefined) === (options.artifactFile !== undefined)) throw invalidCliOptions("exactly_one_required", "--artifact", "--artifact-file");
  const input = reading || operation === "comment-delete" ? undefined : JSON.parse(options.artifact ?? await readFile(options.artifactFile!, "utf8"));
  if (!binding) { return explorationReviewNodes(operation, options, input, scope); }
  const context = await boundReviewNodeContext();
  setReviewerOutputProtocol(isModelReviewHandle(context.review.id) ? "graph" : "flow");
  if (!context.assignment.nodeTree) throw failure("REVIEW_PROTOCOL_UNSUPPORTED", "This Assignment uses the historical Review protocol");
  let result: unknown;
  if (reading) result = await boundReviewNodeView({ nodeId: options.node, all: options.all, list: operation === "list" });
  else if (operation === "submit") result = await submitBoundReviewNodes(input);
  else if (operation === "report") result = await mutateBoundReviewNode({ operation, artifact: nodeReportSchema.parse(input) });
  else if (operation === "update") {
    if (!options.node) throw invalidCliOptions("required", "--node");
    result = await mutateBoundReviewNode({ operation, nodeId: options.node, artifact: nodeUpdateSchema.parse(input) });
  } else if (operation === "comment-add") result = await mutateBoundReviewNode({ operation, nodeId: options.node, artifact: nodeCommentInputSchema.parse(input) });
  else if (operation === "comment-update" || operation === "comment-delete") {
    if (!options.comment) throw invalidCliOptions("required", "--comment");
    result = operation === "comment-delete" ? await mutateBoundReviewNode({ operation, commentId: options.comment }) : await mutateBoundReviewNode({ operation, commentId: options.comment, artifact: nodeCommentUpdateSchema.parse(input) });
  } else throw new Error("review_operation_invalid");
  return emitReviewNodeResult(operation, result, { locale: context.run.language, reviewer: true, boundReviewId: context.review.id });
}

async function explorationReviewNodes(operation: string, options: ReviewNodeOptions, input: unknown, scope?: ContextCommandScope) {
  const session = options.sessionRow ?? await currentCommandState();
  const target = explorationReviewIdentity(options.review!);
  if (!target || target.runId !== options.run) throw failure("INVALID_ARGUMENT", "Review does not belong to this Run");
  const config = scope?.config ?? await readConfig();
  const service = scope?.service ?? await openContextControl(config.scopeRoot);
  if (!service) throw failure("NOT_FOUND", "Context Control Stores not found");
  const repository = new ExplorationReviews(service);
  const { run, round, row, actor } = await repository.locate(target.runId, target.recordId);
  if (actor !== "runner") throw failure("PERMISSION_DENIED", "Only the assigned Project reviewer can write to this Review");
  let saved: { operation?: string; savedNodeId?: string; savedCommentIds?: string[]; commentId?: string } = {};
  if (operation === "submit") {
    const submission = nodeSubmitSchema.parse(input);
    await repository.submit(run.id, row.value.id, round.id, actor, submission.vote, submission.summary);
  } else {
    let mutation: NodeMutation;
    if (operation === "report") {
      const current = currentReviewNode(row.value);
      if (!current) throw failure("REVIEW_CONFLICT", "There is no current Review node");
      mutation = { operation, expectedNodeId: current.nodeId, artifact: nodeReportSchema.parse(input) };
    } else if (operation === "update" && options.node) mutation = { operation, nodeId: options.node, artifact: nodeUpdateSchema.parse(input) };
    else if (operation === "comment-add") mutation = { operation, nodeId: options.node, artifact: nodeCommentInputSchema.parse(input) };
    else if (operation === "comment-update" && options.comment) mutation = { operation, commentId: options.comment, artifact: nodeCommentUpdateSchema.parse(input) };
    else if (operation === "comment-delete" && options.comment) mutation = { operation, commentId: options.comment };
    else throw failure("INVALID_ARGUMENT", "Provide the required Review node or Comment target");
    await repository.materials(run.id, row.value);
    const allowed = new Set(row.value.exploration!.materials.map(ref => `${ref.kind}:${ref.id}`));
    await repository.mutate(run.id, row.value.id, round.id, actor, async value => {
      const created: string[] = [];
      const nodeId = mutation.operation === "report" ? mutation.expectedNodeId
        : mutation.operation === "update" ? mutation.nodeId : undefined;
      mutateModelReviewNode(value, mutation, allowed, service.runtime.now, () => {
        const id = `comment-${randomUUID()}`;
        created.push(id);
        return id;
      });
      saved = { operation, savedNodeId: nodeId, savedCommentIds: mutation.operation === "comment-update" ? [mutation.commentId] : created,
        commentId: "commentId" in mutation ? mutation.commentId : operation === "comment-add" ? created[0] : undefined };
    });
  }
  let warning: string | undefined;
  if (operation === "submit") {
    try { await releaseCommandTarget(session, config.project!.name, run.id, { review: options.review }); }
    catch { warning = `Review submitted. Return to the Run with memsphere run enter --run ${run.id}`; }
  }
  const current = (await repository.locate(run.id, row.value.id)).row.value;
  const result = await explorationReviewView(repository, run.id, current);
  return emitReviewNodeResult(operation, { ...result, ...saved }, { locale: run.language, project: config.project?.name });
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
  const target = (c: Command) => c.option("--run <id>").option("--review <id>");
  const write = (c: Command) => target(c).option("--assignment <id>").option("--artifact <value>", "JSON artifact string").option("--artifact-file <path>", "JSON artifact file").addOption(new Option("--output <format>").choices(["text", "json"]).default("text"));
  registerResultAction(write(review.command("report").description("Report the current review node and advance.")), o => reviewNodeCommand("report", o));
  registerResultAction(write(review.command("update").description("Replace a node without advancing.")).requiredOption("--node <id>"), o => reviewNodeCommand("update", o));
  const comment = review.commands.find(c => c.name() === "comment")!;
  for (const option of comment.options) if (["assignment", "severity"].includes(option.attributeName())) option.mandatory = false;
  registerResultAction(write(comment.command("add").description("Add a Comment to the current or selected node.")).option("--node <id>"), (o, c) => reviewNodeCommand("comment-add", explicitOptions(c, o)));
  registerResultAction(write(comment.command("update").description("Edit Comment body/severity without advancing.")).requiredOption("--comment <id>"), (o, c) => reviewNodeCommand("comment-update", explicitOptions(c, o)));
  registerResultAction(target(comment.command("delete").description("Delete a Comment without changing progress or judgment.")).option("--assignment <id>").requiredOption("--comment <id>").addOption(new Option("--output <format>").choices(["text", "json"]).default("text")), (o, c) => reviewNodeCommand("comment-delete", explicitOptions(c, o)));
  const submit = review.commands.find(c => c.name() === "submit")!;
  for (const option of submit.options) if (["vote", "assignment"].includes(option.attributeName())) option.mandatory = false;
  target(submit);
  submit.option("--artifact <value>").option("--artifact-file <path>");
  // Existing human/free-exploration routes keep their original handlers and targets.
  for (const op of ["list", "show"]) {
    const command = review.commands.find(c => c.name() === op)!;
    command.options.forEach(o => { if (["run", "review", "artifact"].includes(o.attributeName())) o.mandatory = false; });
    command.option("--assignment <id>").option("--round <id>", "fixed acceptance Round for an authorized context Artifact");
    if (op === "show") command.option("--node <id>").option("--all")
      .option("--assignment-page <number>", "Page of assignments in authorized round details (10 per page)");
    registerResultAction(command, async o => {
      if (o.node && o.all) throw invalidCliOptions("mutually_exclusive", "--node", "--all");
      const page = o.assignmentPage === undefined ? 1 : Number(o.assignmentPage);
      if (o.assignmentPage !== undefined && (!o.all || !o.round || !o.review || o.assignment ||
          process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID || !/^[1-9]\d*$/.test(o.assignmentPage) ||
          !Number.isSafeInteger(page))) {
        throw failure("INVALID_ARGUMENT", "Assignment pages require a fixed round and --all");
      }
      if (o.assignment || process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID) {
        const resourceResult = await tryReviewerResource(`review-${op}`, o);
        if (resourceResult) return resourceResult;
        if (o.review || o.artifact) throw new Error("review_query_target_conflict");
        return reviewNodeCommand(op, o);
      } else if (op === "show" && o.review && (!o.run || o.review.startsWith("graph-review-"))) {
        const config = await readConfig();
        const context = await readArtifactReviewForRunner({ runsRoot: config.runsRoot, reviewId: o.review });
        if (o.run && o.run !== context.run.id) throw failure("NOT_FOUND", "Review is outside the requested Run");
        const round = o.round ? context.review.rounds.find(round => round.id === o.round) : context.round;
        if (!round) throw failure("NOT_FOUND", "Review Round not found");
        if (!artifactReviewRoundControlPlane(context.review, round).permissions.runner.effective.includes("artifact.read")) {
          throw failure("PERMISSION_DENIED", "Runner requires artifact.read");
        }
        return reviewReceipt("run review show", {
          ...context, round, project: config.project?.name,
          assignmentPage: page, fullComments: Boolean(o.all), statusOnly: round.id !== context.review.currentRoundId
        });
      } else {
        if (o.assignmentPage !== undefined) throw failure("INVALID_ARGUMENT", "Assignment pages require a formal Review round");
        return contextOnlyCommand(`review-${op}`, o as Options);
      }
    });
  }
}
/** Continue reuses native option definitions and handlers, without Runner CommandState. */
export function createReviewerContinueRouter(nativeRun: Command): Command {
  const review = nativeRun.commands.find(c => c.name() === "review")!, router = new Command("continue");
  for (const path of [["report"], ["update"], ["comment", "add"], ["comment", "update"], ["comment", "delete"], ["list"], ["show"], ["submit"]]) {
    let native = review, route = router;
    for (const name of path) { native = native.commands.find(c => c.name() === name)!; route = route.commands.find(c => c.name() === name) ?? route.command(name).description(native.description()); }
    for (const o of native.options.filter(o => ["node", "comment", "artifact", "artifactFile", "all", "output"].includes(o.attributeName()))) {
      const copy = new Option(o.flags, o.description); copy.mandatory = o.mandatory; if (o.defaultValue !== undefined) copy.default(o.defaultValue); if (o.argChoices) copy.choices(o.argChoices); route.addOption(copy);
    }
    registerResultAction(route, o => reviewNodeCommand(path.join("-"), o));
  }
  bindCliOutputs(router);
  return router;
}

export async function reviewerContinue(nativeRun: Command, args: string[]): Promise<void> {
  const { parseCli } = await import("./cli-errors.js");
  await parseCli(createReviewerContinueRouter(nativeRun),
    [process.execPath, "continue", ...(args.length ? args : ["--help"])], { rethrow: true });
}
