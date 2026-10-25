import { Command, Option } from "commander";
import { requireCommandState } from "../home/command-state-store.js";
import { readConfig } from "../config.js";
import { openContextControl } from "../project/context-control.js";
import { failure } from "../context_control/service.js";
import { contextOnlyCommand, type Options } from "./context-control.js";

const operations: Array<[string[], string, string[]]> = [
  [["report"], "report", ["name", "artifact", "artifactFile", "file", "contentType", "revisedFrom", "dependsOn", "tag", "output"]],
  [["review", "create"], "review-create", ["artifact", "reviewer", "comment", "commentFile", "output"]],
  [["external", "add"], "external-add", ["source", "content", "contentType", "file", "output"]],
  [["artifact", "tag"], "artifact-tag", ["artifact", "tag", "output"]],
  [["outputs", "update"], "outputs-update", ["add", "remove", "output"]],
  [["finish"], "finish", ["artifact", "output"]],
  [["abandon"], "abandon", ["reason", "reasonFile", "output"]]
];
/** Shares native option parsers and the same business handler; never shells out to another CLI. */
export function registerContinueCommand(program: Command, nativeRun: Command) {
  const continuation = program.command("continue <context-id> [command...]").description("Continue a stateful command group using its existing context ID").helpOption(false).allowUnknownOption();
  const router = new Command("continue").helpOption(false);
  const help = async (target: Command) => {
    const context = await load();
    console.log(`contextId: ${context.id}\ncommandGroup: ${context.commandGroup}\nproject: ${context.parameters.project}\nrun: ${context.groupId}`);
    if (!context.available) { console.log(`No further transitions (${context.runStatus}). Use ordinary run status/show commands.`); return; }
    console.log(target === router ? "Available: report, review create, external add, artifact tag, outputs update, finish, abandon\nContent, Artifact IDs, comments and dependencies remain explicit.\nUse: memsphere continue <context-id> <command> --help" : target.helpInformation());
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
    if (!run) throw failure("NOT_FOUND", "CommandState does not refer to a free exploration Run");
    return { ...row.value, runStatus: run.status, available: row.value.status === "active" && run.status === "running" };
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
      await contextOnlyCommand(operation, { ...options, run: context.groupId, contextId: context.id });
    });
  }
}
