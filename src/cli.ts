#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
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
  .option("--memory-root <path>", "memory root directory")
  .option("--reviews-root <path>", "review files root directory")
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
  .description("Install vibe-mem Agent skills into .agents/skills.")
  .option("--directory <path>", "skills directory", ".agents/skills")
  .option("--force", "overwrite the existing skill")
  .action(skillInitCommand);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exitCode = 1;
});
