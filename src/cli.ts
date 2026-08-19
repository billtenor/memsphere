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
import { initCommand } from "./commands/init.js";
import { memoryListCommand, memoryReadCommand } from "./commands/memory.js";
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
  runBindingShowCommand,
  runBindingUpdateCommand,
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
  .version(version);

program
  .command("init")
  .description("Create or refresh a memsphere scope and its reserved memory.")
  .option("--global", "initialize the global ~/.memsphere scope")
  .option("--folder <path>", "initialize a specific folder scope at <path>/.memsphere")
  .option("--memory-root <path>", "memory root directory")
  .option("--reviews-root <path>", "review files root directory")
  .option("--runs-root <path>", "run state files root directory")
  .option("--archive-root <path>", "archived review and run root directory")
  .option("--force", "overwrite the existing config")
  .action(initCommand);

program
  .command("validate")
  .description("Validate config, memory directories, and YAML memory entities.")
  .action(validateCommand);

const memory = program
  .command("memory")
  .description("Discover and read memory entities.");

memory
  .command("list")
  .description("List memory entities or the direct child nodes of one memory.")
  .argument("[reference]", "memory logical reference, canonical name, or alias")
  .addOption(new Option("--kind <kind>", "filter or narrow resolution by memory kind").choices([...memoryKinds]))
  .option("--query <text>", "match a top-level canonical name or alias")
  .option("--node <node-ref>", "list direct children of a memory node")
  .addOption(new Option("--output <format>", "output format").choices(["yaml", "json", "text"]).default("yaml"))
  .action((reference, options) => memoryListCommand(reference, options));

memory
  .command("read")
  .description("Read one memory entity by logical reference, canonical name, or alias.")
  .argument("<reference>", "logical reference, canonical name, or alias")
  .addOption(new Option("--kind <kind>", "narrow name resolution by memory kind").choices([...memoryKinds]))
  .option("--node <node-ref>", "read one memory node with its required context")
  .addOption(new Option("--output <format>", "output format").choices(["yaml", "json"]).default("yaml"))
  .action((reference, options) => memoryReadCommand(reference, options));

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

const runBinding = run
  .command("binding")
  .description("Inspect or update future Review Slot bindings for a running Run.");

runBinding
  .command("show")
  .description("Show frozen Actors, current Slot bindings, affected scopes, and binding history.")
  .requiredOption("--run <id>", "run id")
  .addOption(new Option("--output <format>", "output format").choices(["json", "text"]).default("text"))
  .action(runBindingShowCommand);

runBinding
  .command("update")
  .description("Replace one Slot binding for Reviews that have not been created yet.")
  .requiredOption("--run <id>", "run id")
  .requiredOption("--slot <procedure::slot>", "fully qualified Review Slot key")
  .option("--actor <id>", "bind a frozen Actor; repeat for multiple Actors", (value, previous: string[]) => [...previous, value], [])
  .option("--skip", "explicitly skip this Slot for future Reviews")
  .addOption(new Option("--output <format>", "output format").choices(["json", "text"]).default("text"))
  .action(runBindingUpdateCommand);

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
  .option("--config <path>", "config file path")
  .action(migrateMemorySyntaxCommand);

migrate
  .command("artifact-contract-v2")
  .description("Migrate Memory Artifact contracts to type, format, and schema v2.")
  .option("--check", "scan and print a read-only migration manifest")
  .option("--write", "stage, validate, back up, and apply the migration")
  .option("--config <path>", "config file path")
  .action(migrateArtifactContractV2Command);

migrate
  .command("schema-contract-v2")
  .description("Migrate Schema contracts to inferred types and inherited formats v2.")
  .option("--check", "scan and print a read-only migration manifest")
  .option("--write", "stage, validate, back up, and apply the migration")
  .option("--config <path>", "config file path")
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

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exitCode = 1;
});
