import { cliShell, formatCliLauncher, type CliShell } from "../prompts/cli-command.js";

/** The launcher is injected per Attempt. Shell startup can replace PATH, so a
 * bare executable name does not identify this Session's CLI. */
export function reviewerCommand(argumentsText: string, shell: CliShell = cliShell()): string {
  return `${formatCliLauncher("reviewer", shell)} ${argumentsText}`;
}
