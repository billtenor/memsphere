#!/usr/bin/env node
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
import { migrateArtifactContractV2Command } from "./commands/migrate.js";
import { memoryKinds } from "./memory/kinds.js";
import {
  runEnterSchemaCommand,
  runRepeatCommand,
  runReportCommand,
  runStartCommand,
  runStatusCommand
} from "./commands/run.js";
import { skillInitCommand } from "./commands/skill.js";
import { validateCommand } from "./commands/validate.js";
import {
  viewRestartCommand,
  viewServeCommand,
  viewStartCommand,
  viewStatusCommand,
  viewStopCommand
} from "./commands/view.js";

const program = new Command();

program
  .name("memsphere")
  .description("Manage local YAML-backed memory entities for AI runtimes.")
  .version("0.1.0");

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
  .description("List memory entities in the current scope.")
  .addOption(new Option("--kind <kind>", "filter by memory kind").choices([...memoryKinds]))
  .option("--query <text>", "match an exact canonical name or alias")
  .addOption(new Option("--output <format>", "output format").choices(["yaml", "json", "text"]).default("yaml"))
  .action((options) => memoryListCommand(options));

memory
  .command("read")
  .description("Read one memory entity by logical reference, canonical name, or alias.")
  .argument("<reference>", "logical reference, canonical name, or alias")
  .addOption(new Option("--kind <kind>", "narrow name resolution by memory kind").choices([...memoryKinds]))
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
  .argument("<procedure-name>", "procedure primary name or alias")
  .action(runStartCommand);

run
  .command("report")
  .description("Report the current step artifact and advance the run.")
  .requiredOption("--run <id>", "run id")
  .option("--artifact <value>", "artifact value")
  .option("--artifact-file <path>", "read artifact value from file")
  .action(runReportCommand);

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
  .command("status")
  .description("Show run status or list recent runs.")
  .option("--run <id>", "run id")
  .action(runStatusCommand);

const migrate = program
  .command("migrate")
  .description("Migrate persisted memsphere data between contract versions.");

migrate
  .command("artifact-contract-v2")
  .description("Migrate Memory Artifact contracts to type, format, and schema v2.")
  .option("--check", "scan and print a read-only migration manifest")
  .option("--write", "stage, validate, back up, and apply the migration")
  .option("--config <path>", "config file path")
  .action(migrateArtifactContractV2Command);

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
