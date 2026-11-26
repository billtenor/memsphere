import { writeCliChunk } from "../cli-transport.js";
import { publicReceipt } from "../prompts/contracts/dispatch.js";
import { cliContinueSchema } from "../prompts/cli-output.js";
import { bindCliOutputs } from "./output.js";
import { createReviewerContinueRouter, reviewNodeCommand, type ReviewNodeOptions } from "./review-nodes.js";
import { Command, Option } from "commander";
import { currentCommandState } from "../home/command-state-store.js";
import { readConfig } from "../config.js";
import { openContextControl } from "../project/context-control.js";
import { failure } from "../context_control/service.js";
import { contextOnlyCommand, type Options } from "./context-control.js";
import { isGraphRun } from "../context_control/graph-runtime.js";
import { requireEffectiveStep } from "../context_control/graph-rewind.js";
import { graphReviewHandle } from "../context_control/review-repository.js";
import { parseCli, registerCliOutputRouter } from "./cli-errors.js";
import { cliLocale } from "./output.js";
import { renderPrompt } from "../prompts/renderer.js";

const operations: Array<[string[], string, string[]]> = [
  [["enter-schema"], "schema-enter", ["output", "step", "name", "contentType", "revisedFrom"]],
  [["step", "show"], "step-show", ["step", "output"]],
  [["step", "configure"], "step-configure", ["step", "asserts", "suggests", "reviewer", "clearAsserts", "clearSuggests", "clearReviewer", "output"]],
  [["schema", "show"], "schema-show", ["output"]],
  [["schema", "report"], "schema-report", ["position", "artifact", "artifactFile", "output"]],
  [["skip"], "schema-skip", ["position", "output"]],
  [["repeat"], "schema-repeat", ["position", "output"]],
  [["artifact", "export"], "schema-export", ["file", "force", "output"]],
  [["review", "wait"], "review-wait", ["output"]],
  [["review", "vote"], "review-vote", ["vote", "comment", "commentFile", "output"]],
  [["review", "resolve"], "review-resolve", ["comment", "disposition", "note", "noteFile", "validationSummary", "validationSummaryFile", "output"]],
  [["review", "submit-for-human"], "review-submit-for-human", ["assignment", "vote", "commentsFile", "summary", "summaryFile", "authorizationNote", "authorizationNoteFile", "output"]],
  [["review", "retry"], "review-retry", ["assignment", "output"]],
  [["review", "start"], "review-start", ["artifact", "output"]],
  [["review", "list"], "review-list", ["artifact", "progressive", "output"]],
  [["review", "show"], "review-show", ["node", "all", "output"]],
  [["review", "report"], "review-report", ["artifact", "artifactFile", "output"]],
  [["review", "update"], "review-update", ["node", "artifact", "artifactFile", "output"]],
  [["review", "comment", "add"], "review-comment-add", ["node", "artifact", "artifactFile", "output"]],
  [["review", "comment", "update"], "review-comment-update", ["comment", "artifact", "artifactFile", "output"]],
  [["review", "comment", "delete"], "review-comment-delete", ["comment", "output"]],
  [["review", "submit"], "review-submit", ["artifact", "artifactFile", "output"]],
  [["report"], "report", ["name", "artifact", "artifactFile", "file", "contentType", "revisedFrom", "dependsOn", "tag", "output", "revisionSummary", "revisionSummaryFile", "writeOptions"]],
  [["review", "create"], "review-create", ["artifact", "reviewer", "comment", "commentFile", "output"]],
  [["external", "add"], "external-add", ["source", "content", "contentType", "file", "change", "checkpoint", "output"]],
  [["artifact", "tag"], "artifact-tag", ["artifact", "tag", "output"]],
  [["outputs", "update"], "outputs-update", ["add", "remove", "output"]],
  [["finish"], "finish", ["artifact", "authorization", "output"]],
  [["abandon"], "abandon", ["reason", "reasonFile", "output"]]
];
/** Shares native option parsers and the same business handler; never shells out to another CLI. */
export function registerContinueCommand(program: Command, nativeRun: Command) {
  const continuation = program.command("continue [command...]").description("Continue production in an existing free exploration Run or graph Step; use native run commands to read it.").helpOption(false).allowUnknownOption();
  const router = new Command("continue").helpOption(false);
  bindCliOutputs(router);
  const reviewerRouter = process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID ? createReviewerContinueRouter(nativeRun) : undefined;
  registerCliOutputRouter(continuation, reviewerRouter ?? router);
  const help = async (target: Command) => {
    const context = await load();
    const commands = operations.filter(([path, operation]) => {
      if (context.graph) return /^(schema-|review-(wait|vote|retry|resolve|submit-for-human)$)/.test(operation) || path.join(" ") === "report";
      return context.parameters.review
        ? /^review-(show|report|update|comment-|submit|wait|retry)/.test(operation)
        : !/^review-(wait|vote|resolve|submit|retry|show|report|update|comment)/.test(operation);
    }).map(([path]) => path.join(" "));
    const receipt = publicReceipt({ role: "native", route: "continue", options: {}, args: [] }, {
      project: context.parameters.project,
      runId: context.groupId,
      stepId: context.parameters.step,
      reviewId: context.parameters.review,
      status: context.runStatus ?? "unavailable",
      available: context.available,
      commands: target === router ? commands : [],
      usage: target === router ? undefined : target.helpInformation().trimEnd()
    });
    await writeCliChunk(renderPrompt("cli.continue", cliLocale(), cliContinueSchema.parse(receipt)) + "\n");
  };
  const load = async () => {
    const row = (await currentCommandState(true))!;
    const project = row.value.parameters.project;
    if (!project) throw failure("INVALID_STATE", "CommandState has no project");
    const selected = program.opts().project;
    if (selected && selected !== project) throw failure("INVALID_ARGUMENT", "--project conflicts with CommandState");
    process.env.MEMSPHERE_PROJECT = project;
    const config = await readConfig();
    const service = await openContextControl(config.scopeRoot);
    const run = service && await service.findRun(row.value.groupId);
    if (!run) throw failure("NOT_FOUND", "CommandState does not refer to a model-backed Run");
    const stepId = row.value.parameters.step;
    const graph = isGraphRun(run);
    if (graph && !stepId) throw failure("INVALID_STATE", "Graph CommandState requires a fixed Step binding");
    const step = stepId ? graph ? (await service!.inspect(run.id)).steps.find(s => s.id === stepId) : await service!.explorationStep(run.id, stepId) : undefined;
    if (stepId && !step) throw failure("NOT_FOUND", "CommandState Step not found");
    if (graph && stepId) requireEffectiveStep(run, stepId);
    return { ...row.value, row, graph, roundId: step?.reviewRounds?.at(-1)?.id, runStatus: graph ? step?.status ?? run.status : run.status, available: row.value.status === "active" && run.status === "running" && (!graph || step?.status !== "done") };
  };
  continuation.action(async () => {
    const tail = continuation.args;
    if (reviewerRouter) {
      await parseCli(reviewerRouter, [process.execPath, "continue", ...(tail.length ? tail : ["--help"])], { rethrow: true });
      return;
    }
    await load();
    if (!tail.length || tail[0] === "--help" || tail[0] === "-h") { await help(router); return; }
    const configure = (command: Command) => { command.exitOverride(); command.configureOutput({ outputError() {} }); command.commands.forEach(configure); };
    configure(router);
    await router.parseAsync(tail, { from: "user" });
  });
  for (const [path, operation, allowed] of operations) {
    let source = nativeRun, command = router;
    for (const segment of path) {
      source = source.commands.find(c => c.name() === segment)!;
      let child = command.commands.find(c => c.name() === segment);
      if (!child) { child = command.command(segment).description(source.description()).helpOption(false).option("-h, --help", "Show command help"); child.action(() => help(child!)); }
      command = child;
    }
    for (const option of source.options.filter(o => allowed.includes(o.attributeName()))) {
      const copy = new Option(option.flags, option.description);
      if (option.parseArg) copy.argParser(option.parseArg);
      if (option.argChoices) copy.choices(option.argChoices);
      if (option.defaultValue !== undefined) copy.default(option.defaultValue);
      command.addOption(copy);
    }
    const target = command;
    if (operation === "schema-repeat") command.argument("<count>", "Repeat count");
    if (operation === "schema-enter") command.argument("[schema-name]", "Schema for a new free exploration draft");
    command.action(async (...args: unknown[]) => {
      const options = (operation === "schema-repeat" ? { ...(args[1] as Options), count: args[0] as string } : operation === "schema-enter" ? { ...(args[1] as Options), schemaName: args[0] as string } : args[0]) as Options & { help?: boolean };
      if (options.help) { await help(target); return; }
      const context = await load();
      const reviewId = context.parameters.review;
      if (!context.graph && ["review-show", "review-list"].includes(operation)) {
        if (operation === "review-show" && !reviewId) throw failure("INVALID_ARGUMENT", "Enter a Review with run enter --run R --review V");
        await contextOnlyCommand(operation, { ...options, run: context.groupId, review: reviewId });
        return;
      }
      if (!context.available) throw failure("RUN_FINISHED", `No transitions available (${context.runStatus})`);
      if (reviewId) {
        if (operation === "review-wait") await (await import("./run.js")).runReviewWaitCommand({ review: reviewId, ...options, sessionRow: context.row });
        else if (operation === "review-retry") await (await import("./run.js")).runReviewRetryCommand({ ...options, review: reviewId });
        else if (["review-report", "review-update", "review-comment-add", "review-comment-update", "review-comment-delete", "review-submit"].includes(operation))
          await reviewNodeCommand(operation.slice(7), { ...(options as ReviewNodeOptions), run: context.groupId, review: reviewId, sessionRow: context.row });
        else throw failure("SESSION_CONTEXT_CONFLICT", "Return to the general Run context with run enter --run R");
        return;
      }
      if (operation.startsWith("review-") && ["review-wait", "review-vote", "review-retry", "review-resolve", "review-submit-for-human"].includes(operation)) {
        const stepId = context.parameters.step;
        if (!stepId || !context.roundId) throw failure("INVALID_ARGUMENT", "This command requires a graph Step Review");
        const commands = await import("./run.js");
        const review = graphReviewHandle(context.groupId, stepId);
        if (operation === "review-wait") await commands.runReviewWaitCommand({ review, ...options });
        else if (operation === "review-vote") await commands.runReviewVoteCommand({ ...options, review, round: context.roundId } as Parameters<typeof commands.runReviewVoteCommand>[0]);
        else if (operation === "review-retry") await commands.runReviewRetryCommand({ ...options, review });
        else if (operation === "review-resolve") await commands.runReviewResolveCommand({ ...options, review, round: context.roundId } as Parameters<typeof commands.runReviewResolveCommand>[0]);
        else await commands.runReviewSubmitForHumanCommand({ ...options, run: context.groupId, review, round: context.roundId } as Parameters<typeof commands.runReviewSubmitForHumanCommand>[0]);
        return;
      }
      if (context.graph && operation !== "report" && !operation.startsWith("schema-")) throw failure("INVALID_ARGUMENT", "Use the Step report or review commands shown by its current prompt");
      if (context.graph && operation === "schema-enter" && (options.step || options.schemaName || options.revisedFrom || options.name || options.contentType)) throw failure("INVALID_ARGUMENT", "The graph Step already fixes the Schema");
      const step = context.graph ? context.parameters.step : operation === "schema-enter" || operation.startsWith("step-") ? options.step : operation === "report" || operation.startsWith("schema-") ? context.parameters.step : undefined;
      if (!step && operation.startsWith("schema-") && operation !== "schema-enter") throw failure("INVALID_ARGUMENT", "Enter a Schema draft first with run enter-schema --run R --step S");
      if (!context.graph && ["review-report", "review-update", "review-comment-add", "review-comment-update", "review-comment-delete", "review-submit"].includes(operation))
        throw failure("INVALID_ARGUMENT", "Enter a Review with run enter --run R --review V");
      await contextOnlyCommand(operation, { ...options, run: context.groupId, step, sessionStateId: context.id, sessionRow: context.row });
    });
  }
}
