#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { runEnterSchemaCommand, runReportCommand, runStartCommand, runStatusCommand } from "./commands/run.js";
import { skillInitCommand } from "./commands/skill.js";
import { validateCommand } from "./commands/validate.js";
import { viewCommand } from "./commands/view.js";

const program = new Command();

program
  .name("vibe-mem")
  .description("Manage local YAML-backed memory entities for AI runtimes.")
  .version("0.1.0");

program
  .command("init")
  .description("Create the default config file and memory directory structure.")
  .option("--global", "initialize the global ~/.vibe-mem scope")
  .option("--folder <path>", "initialize a specific folder scope at <path>/.vibe-mem")
  .option("--memory-root <path>", "memory root directory")
  .option("--reviews-root <path>", "review files root directory")
  .option("--runs-root <path>", "run state files root directory")
  .option("--force", "overwrite the existing config file")
  .action(initCommand);

program
  .command("validate")
  .description("Validate config, memory directories, and YAML memory entities.")
  .action(validateCommand);

program
  .command("list")
  .description("List memory entities.")
  .argument("[kind]", "one of: procedures, concepts, statements, schemas")
  .action(listCommand);

program
  .command("view")
  .description("Start a local memory browser and review UI.")
  .option("--host <host>", "host to bind", "127.0.0.1")
  .option("--port <port>", "port to bind; 0 picks a random open port", "0")
  .action(viewCommand);

const skill = program
  .command("skill")
  .description("Manage vibe-mem Agent skills.");

skill
  .command("init")
  .description("Install vibe-mem Agent skills.")
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
  .argument("<schema-name>", "schema primary name or alias")
  .requiredOption("--run <id>", "run id")
  .action(runEnterSchemaCommand);

run
  .command("status")
  .description("Show run status or list recent runs.")
  .option("--run <id>", "run id")
  .action(runStatusCommand);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exitCode = 1;
});
