import { Command, Option } from "commander";
import { requireCommandState } from "../home/command-state-store.js";
import { readConfig } from "../config.js";
import { openContextControl } from "../project/context-control.js";
import { failure } from "../context_control/service.js";
import { contextOnlyCommand, type Options } from "./context-control.js";
import { isGraphRun } from "../context_control/graph-runtime.js";
import { graphReviewHandle } from "../context_control/review-repository.js";

const operations: Array<[string[], string, string[]]> = [
  [["review", "wait"], "review-wait", []],
  [["review", "vote"], "review-vote", ["vote", "comment", "commentFile"]],
  [["review", "resolve"], "review-resolve", ["comment", "disposition", "note", "noteFile", "validationSummary", "validationSummaryFile", "output"]],
  [["review", "submit-for-human"], "review-submit-for-human", ["assignment", "vote", "commentsFile", "summary", "summaryFile", "authorizationNote", "authorizationNoteFile", "output"]],
  [["review", "retry"], "review-retry", ["assignment", "output"]],
  [["report"], "report", ["name", "artifact", "artifactFile", "file", "contentType", "revisedFrom", "dependsOn", "tag", "output", "revisionSummary", "revisionSummaryFile"]],
  [["review", "create"], "review-create", ["artifact", "reviewer", "comment", "commentFile", "output"]],
  [["external", "add"], "external-add", ["source", "content", "contentType", "file", "output"]],
  [["artifact", "tag"], "artifact-tag", ["artifact", "tag", "output"]],
  [["outputs", "update"], "outputs-update", ["add", "remove", "output"]],
  [["finish"], "finish", ["artifact", "output"]],
  [["abandon"], "abandon", ["reason", "reasonFile", "output"]]
];
/** Shares native option parsers and the same business handler; never shells out to another CLI. */
export function registerContinueCommand(program: Command, nativeRun: Command) {
  const continuation = program.command("continue <context-id> [command...]").description("Continue production in an existing free exploration Run or graph Step; use native run commands to read it.").helpOption(false).allowUnknownOption();
  const router = new Command("continue").helpOption(false);
  const help = async (target: Command) => {
    const context = await load();
    console.log(`contextId: ${context.id}\ncommandGroup: ${context.commandGroup}\nproject: ${context.parameters.project}\nrun: ${context.groupId}`);
    if (context.parameters.step) console.log(`step: ${context.parameters.step}`);
    if (!context.available) { console.log(`No further transitions (${context.runStatus}). Use ordinary run status/show commands.`); return; }
    console.log(target === router ? context.parameters.step ? "Available: report, review wait, review vote, review retry, review resolve, review submit-for-human\nThis context remains bound to its Step through submission and review.\nUse: memsphere continue <context-id> <command> --help" : "Available: report, review create, external add, artifact tag, outputs update, finish, abandon\nContent, Artifact IDs, comments and dependencies remain explicit.\nUse: memsphere continue <context-id> <command> --help" : target.helpInformation());
  };
  const load = async () => {
    const id = continuation.processedArgs[0] as string;
    const row = await requireCommandState(id);
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
    if (isGraphRun(run) !== Boolean(stepId)) throw failure("INVALID_STATE", "Graph CommandState requires a fixed Step binding");
    const step = stepId ? (await service!.snapshot(run.id)).steps.find(s => s.id === stepId) : undefined;
    if (stepId && !step) throw failure("NOT_FOUND", "CommandState Step not found");
    return { ...row.value, roundId: step?.reviewRounds?.at(-1)?.id, runStatus: step?.status ?? run.status, available: row.value.status === "active" && run.status === "running" && step?.status !== "done" };
  };
  continuation.action(async () => {
    const tail = continuation.args.slice(1);
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
    command.action(async (options: Options & { help?: boolean }) => {
      if (options.help) { await help(target); return; }
      const context = await load();
      if (!context.available) throw failure("RUN_FINISHED", `No transitions available (${context.runStatus})`);
      if (operation.startsWith("review-") && ["review-wait", "review-vote", "review-retry", "review-resolve", "review-submit-for-human"].includes(operation)) {
        const stepId = context.parameters.step;
        if (!stepId || !context.roundId) throw failure("INVALID_ARGUMENT", "This command requires a graph Step Review");
        const commands = await import("./run.js");
        const review = graphReviewHandle(context.groupId, stepId);
        if (operation === "review-wait") await commands.runReviewWaitCommand({ review });
        else if (operation === "review-vote") await commands.runReviewVoteCommand({ ...options, review, round: context.roundId } as Parameters<typeof commands.runReviewVoteCommand>[0]);
        else if (operation === "review-retry") await commands.runReviewRetryCommand({ ...options, review });
        else if (operation === "review-resolve") await commands.runReviewResolveCommand({ ...options, review, round: context.roundId } as Parameters<typeof commands.runReviewResolveCommand>[0]);
        else await commands.runReviewSubmitForHumanCommand({ ...options, run: context.groupId, review, round: context.roundId } as Parameters<typeof commands.runReviewSubmitForHumanCommand>[0]);
        return;
      }
      if (context.parameters.step && operation !== "report") throw failure("INVALID_ARGUMENT", "Use the Step report or review commands shown by its current prompt");
      await contextOnlyCommand(operation, { ...options, run: context.groupId, ...(context.parameters.step ? { step: context.parameters.step } : {}), contextId: context.id });
    });
  }
}
