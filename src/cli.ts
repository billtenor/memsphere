#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command, Option } from "commander";
import {
  archiveListCommand,
  archiveRestoreReviewCommand,
  archiveRestoreRunCommand,
  archiveReviewCommand,
  archiveRunCommand
} from "./commands/archive.js";
import {
  memoryChangeResumeCommand,
  memoryChangeValidateCommand,
  memoryDeleteCommand,
  memoryEditCommand,
  memoryListCommand,
  memoryPublishCommand,
  memoryPushCommand,
  memoryRecoverCommand,
  memoryReadCommand,
  memoryRenameCommand,
  memorySyncCommand,
  memorySyncPublishCommand
} from "./commands/memory.js";
import {
  projectBindCommand,
  projectCloneCommand,
  projectCreateCommand,
  projectListCommand,
  projectMountCommand,
  projectPruneCommand,
  projectRegisterCommand,
  projectShowCommand,
  projectUnbindCommand,
  projectUnmountCommand
} from "./commands/project.js";
import {
  migrateArtifactContractV2Command,
  migrateMemorySyntaxCommand,
  migrateSchemaContractV2Command
} from "./commands/migrate.js";
import { memoryKinds } from "./memory/kinds.js";
import {
  runEnterSchemaCommand,
  runArtifactContractShowCommand,
  runArtifactShowCommand,
  runRepeatCommand,
  runReportCommand,
  runReviewCommentCommand,
  runReviewResolveCommand,
  runReviewRetryCommand,
  runReviewAssignmentShowCommand,
  runReviewSubmitCommand,
  runReviewVoteCommand,
  runReviewWaitCommand,
  runSchemaShowCommand,
  runShowCommand,
  runSkipCommand,
  runStartCommand,
  runStepShowCommand,
  runStatusCommand,
  runTryRunCommand
} from "./commands/run.js";
import { skillInitCommand } from "./commands/skill.js";
import { validateCommand } from "./commands/validate.js";
import { runArtifactReviewAgentWorker } from "./acp/review-worker.js";
import {
  viewRestartCommand,
  viewServeCommand,
  viewStartCommand,
  viewStatusCommand,
  viewStopCommand
} from "./commands/view.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };
const program = new Command();

program
  .name("memsphere")
  .description("Manage local YAML-backed memory entities for AI runtimes.")
  .version(version)
  .option("--project <name>", "use one Project for this command without changing Workspace binding");

program.hook("preAction", () => {
  const selected = program.opts<{ project?: string }>().project;
  if (selected) process.env.MEMSPHERE_PROJECT = selected;
});

const project = program
  .command("project")
  .description("Manage persistent Memsphere Projects and Workspace bindings.");

project.command("create")
  .argument("<name>", "globally unique Project name")
  .option("--embedded <memory-path>", "use Memory inside the current Git repository")
  .option("--bind", "bind the current Workspace after creation")
  .action(projectCreateCommand);

project.command("clone")
  .argument("<repository>", "Git URL or local repository")
  .requiredOption("--name <name>", "globally unique Project name")
  .option("--branch <branch>", "controlled local branch")
  .option("--upstream <remote-branch>", "organization upstream, for example origin/master")
  .option("--bind", "bind the current Workspace after cloning")
  .action(projectCloneCommand);

project.command("register")
  .argument("<project-root>", "existing complete Project Root")
  .option("--bind", "bind the current Workspace after registration")
  .action(projectRegisterCommand);

project.command("list")
  .addOption(new Option("--output <format>", "output format").choices(["text", "json"]).default("text"))
  .action(projectListCommand);

project.command("show")
  .argument("[name]", "Project name; defaults to the current Primary")
  .addOption(new Option("--output <format>", "output format").choices(["text", "json"]).default("text"))
  .action(projectShowCommand);

project.command("bind")
  .argument("<name>", "Project name")
  .action(projectBindCommand);

project.command("unbind").action(projectUnbindCommand);
project.command("mount").argument("<name>", "read-only Project name").action(projectMountCommand);
project.command("unmount").argument("<name>", "mounted Project name").action(projectUnmountCommand);
project.command("prune").description("Remove missing registrations and their bindings.").action(projectPruneCommand);

program
  .command("validate")
  .description("Validate config, memory directories, and YAML memory entities.")
  .option("--memory-root <path>", "validate one Memory root without Home, Registry or Binding")
  .addOption(new Option("--format <format>", "diagnostic output format").choices(["text", "json"]).default("text"))
  .action(validateCommand);

const memory = program
  .command("memory")
  .description("Discover and read memory entities.");

memory
  .command("list")
  .description("List memory entities or the direct child nodes of one memory.")
  .argument("[reference]", "canonical logical reference, or bare canonical name or alias")
  .addOption(new Option("--kind <kind>", "filter or narrow resolution by memory kind").choices([...memoryKinds]))
  .option("--query <text>", "match a top-level canonical name or alias")
  .option("--node <node-ref>", "list direct children of a memory node")
  .addOption(new Option("--output <format>", "output format").choices(["yaml", "json", "text"]).default("yaml"))
  .action((reference, options) => memoryListCommand(reference, options));

memory
  .command("read")
  .description("Read one memory entity by canonical logical reference, or bare canonical name or alias.")
  .argument("<reference>", "canonical logical reference, or bare canonical name or alias")
  .addOption(new Option("--kind <kind>", "narrow name resolution by memory kind").choices([...memoryKinds]))
  .option("--node <node-ref>", "read one memory node with its required context")
  .addOption(new Option("--output <format>", "output format").choices(["yaml", "json"]).default("yaml"))
  .action((reference, options) => memoryReadCommand(reference, options));

memory.command("edit")
  .description("Create or extend a Managed Memory ChangeSet.")
  .argument("<references...>", "existing bare selectors or canonical logical references")
  .option("--change <id>", "append targets to an existing ChangeSet")
  .action(memoryEditCommand);

memory.command("delete")
  .argument("<references...>", "existing Memory references")
  .option("--change <id>", "append targets to an existing ChangeSet")
  .action(memoryDeleteCommand);

memory.command("rename")
  .argument("<reference>", "existing Memory reference")
  .argument("<new-name>", "new lowercase ASCII kebab-case canonical name")
  .option("--change <id>", "append target to an existing ChangeSet")
  .action(memoryRenameCommand);

memory.command("publish")
  .requiredOption("--change <id>", "ChangeSet id")
  .option("--message <text>", "Git commit message")
  .action(memoryPublishCommand);

memory.command("recover")
  .argument("<reference>", "frozen Memory reference")
  .option("--restore", "discard the external modification")
  .option("--create-change", "save the external modification as a ChangeSet candidate, then restore")
  .action(memoryRecoverCommand);

memory.command("push").description("Push the controlled Managed Memory branch without force.").action(memoryPushCommand);
const memorySync = memory.command("sync").description("Merge the configured organization upstream.").action(memorySyncCommand);
memorySync.command("publish")
  .requiredOption("--change <id>", "Sync ChangeSet id")
  .option("--message <text>", "merge commit message")
  .action(memorySyncPublishCommand);

const memoryChange = memory.command("change").description("Manage Managed Memory ChangeSet candidates.");
memoryChange.command("resume")
  .argument("<change-id>", "ChangeSet id")
  .action(memoryChangeResumeCommand);

memoryChange.command("validate")
  .description("Validate a Managed ChangeSet against its effective Memory Store.")
  .argument("<change-id>", "ChangeSet id")
  .addOption(new Option("--format <format>", "diagnostic output format").choices(["text", "json"]).default("text"))
  .action(memoryChangeValidateCommand);

const view = program
  .command("view")
  .description("Manage the local memory browser and review UI.");

view
  .command("start")
  .description("Start the View service in the background.")
  .action(viewStartCommand);

view
  .command("stop")
  .description("Stop the managed View service.")
  .action(viewStopCommand);

view
  .command("restart")
  .description("Restart the managed View service.")
  .action(viewRestartCommand);

view
  .command("status")
  .description("Show the managed View service status.")
  .action(viewStatusCommand);

view
  .command("serve", { hidden: true })
  .description("Run the internal View HTTP server.")
  .option("--config <path>", "config file path")
  .option("--state <path>", "service state file path")
  .action(viewServeCommand);

const skill = program
  .command("skill")
  .description("Manage memsphere Agent skills.");

skill
  .command("init")
  .description("Install memsphere Agent skills.")
  .option("--global", "install into ~/.agents/skills")
  .option("--directory <path>", "skills directory")
  .option("--force", "overwrite the existing skill")
  .action(skillInitCommand);

const run = program
  .command("run")
  .description("Execute a procedure with step-gated progress reporting.");

run
  .command("start")
  .description("Start a run from a procedure.")
  .argument("[procedure-name]", "procedure primary name or alias")
  .requiredOption("--name <name>", "name for this run")
  .option("--file <path>", "start from a Procedure YAML file without installing it")
  .option("--review-config <path>", "bind Review Slots to Actors and select Decision Policies")
  .action((procedureName, options) => runStartCommand(procedureName, options));

run
  .command("report")
  .description("Report the current step artifact and advance the run.")
  .requiredOption("--run <id>", "run id")
  .option("--artifact <value>", "artifact value")
  .option("--artifact-file <path>", "read artifact value from file")
  .option("--revision-summary <text>", "revision summary")
  .option("--revision-summary-file <path>", "read the revision summary from file")
  .action(runReportCommand);

run
  .command("show")
  .description("Show a concise Run outline with its steps and Artifact summaries.")
  .requiredOption("--run <id>", "run id")
  .addOption(new Option("--output <format>", "output format").choices(["json", "text"]).default("text"))
  .action(runShowCommand);

run
  .command("try-run")
  .description("Generate Agent Review launch and Prompt evidence without starting ACP Agents.")
  .requiredOption("--run <id>", "run id")
  .action(runTryRunCommand);

const runStep = run
  .command("step")
  .description("Inspect one Run step.");

runStep
  .command("show")
  .description("Show the detailed contract and instructions for one Run step.")
  .requiredOption("--run <id>", "run id")
  .requiredOption("--step <ref>", "step ref from run show")
  .addOption(new Option("--output <format>", "output format").choices(["json", "text"]).default("text"))
  .action(runStepShowCommand);

const runArtifact = run
  .command("artifact")
  .description("Inspect a reported or reviewed Artifact.");

runArtifact
  .command("show")
  .description("Show a reported or reviewed Artifact value.")
  .option("--assignment <id>", "Artifact Review Assignment bound to the active ACP Session")
  .option("--run <id>", "run id")
  .option("--step <ref>", "step ref from run show")
  .addOption(new Option("--output <format>", "output format").choices(["json", "text"]).default("text"))
  .action(runArtifactShowCommand);

const runArtifactContract = runArtifact
  .command("contract")
  .description("Inspect the frozen contract for an Artifact.");

runArtifactContract
  .command("show")
  .description("Show the complete frozen Action and Artifact contract.")
  .option("--assignment <id>", "Artifact Review Assignment bound to the active ACP Session")
  .option("--run <id>", "run id")
  .option("--step <ref>", "step ref from run show")
  .addOption(new Option("--output <format>", "output format").choices(["json", "text"]).default("text"))
  .action(runArtifactContractShowCommand);

const runSchema = run
  .command("schema")
  .description("Inspect the active Schema writing context and managed draft.");

runSchema
  .command("show")
  .description("Show Schema progress, production constraints, and the managed draft path.")
  .requiredOption("--run <id>", "run id")
  .addOption(new Option("--output <format>", "output format").choices(["json", "text"]).default("text"))
  .action(runSchemaShowCommand);

const runReview = run
  .command("review")
  .description("Wait for and decide an Artifact Review.");

runReview
  .command("wait")
  .description("Wait until assigned reviews are submitted or the current round is decided.")
  .requiredOption("--review <id>", "artifact review id")
  .action(runReviewWaitCommand);

runReview
  .command("vote")
  .description("Cast the Runner decision vote for the current Artifact Review round.")
  .requiredOption("--review <id>", "artifact review id")
  .requiredOption("--round <id>", "artifact review round id")
  .addOption(new Option("--vote <vote>", "Runner vote").choices(["approve", "request_changes"]).makeOptionMandatory())
  .option("--comment <text>", "Runner decision comment")
  .option("--comment-file <path>", "read the Runner decision comment from a file")
  .action(runReviewVoteCommand);

runReview
  .command("retry")
  .description("Retry one failed Agent Assignment in the current Review round.")
  .requiredOption("--review <id>", "artifact review id")
  .requiredOption("--assignment <identity-or-assignment-id>", "agent identity or assignment id")
  .addOption(new Option("--output <format>", "output format").choices(["json", "text"]).default("text"))
  .action(runReviewRetryCommand);

runReview
  .command("resolve")
  .description("Record the Runner disposition for an advisory comment.")
  .requiredOption("--review <id>", "artifact review id")
  .requiredOption("--round <id>", "artifact review round id")
  .requiredOption("--comment <id>", "advisory comment id")
  .addOption(new Option("--disposition <value>", "Runner disposition").choices([
    "accepted-fixed",
    "accepted-followup",
    "rejected-out-of-scope",
    "rejected-not-blocking",
    "rejected-invalid"
  ]).makeOptionMandatory())
  .option("--note <text>", "disposition note")
  .option("--note-file <path>", "read disposition note from file")
  .option("--validation-summary <text>", "validation performed for accepted-fixed")
  .option("--validation-summary-file <path>", "read validation summary from file")
  .addOption(new Option("--output <format>", "output format").choices(["json", "text"]).default("text"))
  .action(runReviewResolveCommand);

const runReviewAssignment = runReview
  .command("assignment")
  .description("Inspect the Agent Assignment bound to the active ACP Session.");

runReviewAssignment
  .command("show")
  .description("Show this Agent's Assignment status, role, permissions, and own draft.")
  .requiredOption("--assignment <id>", "artifact review assignment id")
  .addOption(new Option("--output <format>", "output format").choices(["json", "text"]).default("text"))
  .action(runReviewAssignmentShowCommand);

runReview
  .command("comment")
  .description("Add a structured comment to this Agent Assignment.")
  .requiredOption("--assignment <id>", "artifact review assignment id")
  .option("--body <text>", "single-line Markdown comment body")
  .option("--body-stdin", "read a multiline Markdown comment body from standard input")
  .addOption(new Option("--severity <severity>", "comment severity").choices(["blocking", "risk", "suggestion"]).makeOptionMandatory())
  .option("--target <target>", "comment anchor target")
  .option("--location <location>", "comment anchor location")
  .option("--source-hash <hash>", "comment anchor source hash")
  .option("--submission-id <id>", "comment anchor submission id")
  .option("--context <text>", "comment anchor context excerpt")
  .addOption(new Option("--output <format>", "output format").choices(["json", "text"]).default("text"))
  .action(runReviewCommentCommand);

runReview
  .command("submit")
  .description("Submit the Vote and complete this Agent Assignment.")
  .requiredOption("--assignment <id>", "artifact review assignment id")
  .addOption(new Option("--vote <vote>", "review vote").choices(["approve", "request_changes", "abstain"]).makeOptionMandatory())
  .option("--summary <text>", "overall review summary")
  .option("--summary-file <path>", "read overall review summary from file")
  .addOption(new Option("--output <format>", "output format").choices(["json", "text"]).default("text"))
  .action(runReviewSubmitCommand);

runReview
  .command("agent-worker", { hidden: true })
  .description("Run one internal ACP Agent Review worker.")
  .requiredOption("--config <path>", "config file path")
  .requiredOption("--review <id>", "artifact review id")
  .requiredOption("--round <id>", "artifact review round id")
  .requiredOption("--assignment <id>", "artifact review assignment id")
  .requiredOption("--node-executable <path>", "Node executable path")
  .requiredOption("--cli-entrypoint <path>", "CLI entrypoint path")
  .action(runArtifactReviewAgentWorker);

run
  .command("enter-schema")
  .description("Enter a schema artifact writing flow.")
  .argument("[schema-name]", "schema primary name or alias; omit for the current inline schema")
  .requiredOption("--run <id>", "run id")
  .action(runEnterSchemaCommand);

run
  .command("repeat")
  .description("Choose a repeat count for the current Schema Repeat step.")
  .argument("<count>", "non-negative repeat count within the Schema limit")
  .requiredOption("--run <id>", "run id")
  .action(runRepeatCommand);

run
  .command("skip")
  .description("Skip the current optional Schema field step.")
  .requiredOption("--run <id>", "run id")
  .action(runSkipCommand);

run
  .command("status")
  .description("Show run status or list recent runs.")
  .option("--run <id>", "run id")
  .action(runStatusCommand);

const migrate = program
  .command("migrate")
  .description("Migrate persisted memsphere data between contract versions.");

migrate
  .command("syntax")
  .description("Migrate Memory YAML to a registered syntax version.")
  .option("--check", "scan and print a read-only migration manifest")
  .option("--write", "stage, validate, back up, and apply the migration")
  .option("--to <syntax>", "target syntax; defaults to the current stable syntax")
  .action(migrateMemorySyntaxCommand);

migrate
  .command("artifact-contract-v2")
  .description("Migrate Memory Artifact contracts to type, format, and schema v2.")
  .option("--check", "scan and print a read-only migration manifest")
  .option("--write", "stage, validate, back up, and apply the migration")
  .action(migrateArtifactContractV2Command);

migrate
  .command("schema-contract-v2")
  .description("Migrate Schema contracts to inferred types and inherited formats v2.")
  .option("--check", "scan and print a read-only migration manifest")
  .option("--write", "stage, validate, back up, and apply the migration")
  .action(migrateSchemaContractV2Command);

const archive = program
  .command("archive")
  .description("Archive and restore completed reviews and runs.");

archive
  .command("list")
  .description("List archived items.")
  .argument("[kind]", "one of: reviews, runs")
  .action(archiveListCommand);

archive
  .command("review")
  .description("Archive a done review.")
  .argument("<id>", "review id")
  .action(archiveReviewCommand);

archive
  .command("run")
  .description("Archive a done run.")
  .argument("<id>", "run id")
  .action(archiveRunCommand);

const restore = archive
  .command("restore")
  .description("Restore an archived review or run.");

restore
  .command("review")
  .description("Restore an archived review.")
  .argument("<id>", "review id")
  .action(archiveRestoreReviewCommand);

restore
  .command("run")
  .description("Restore an archived run.")
  .argument("<id>", "run id")
  .action(archiveRestoreRunCommand);

await program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exitCode = 1;
});
