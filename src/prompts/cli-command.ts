import type { z } from "zod";
import type { cliCommandSchema } from "./cli-output.js";

export type CliCommand = z.infer<typeof cliCommandSchema>;
export type CliShell = "bash" | "powershell" | "cmd";

export function cliShell(): CliShell {
  return process.platform === "win32" && !process.env.MSYSTEM ? "powershell" : "bash";
}

export function formatCliLauncher(launcher: CliCommand["launcher"], shell: CliShell): string {
  if (launcher === "memsphere") return "memsphere";
  if (shell === "powershell") return "& $env:MEMSPHERE_CLI";
  if (shell === "cmd") return '"%MEMSPHERE_CLI%"';
  return '"$MEMSPHERE_CLI"';
}

function quoteArgument(value: string, shell: CliShell): string {
  if (/^[\w./:@=+-]+$/.test(value)) return value;
  if (shell === "powershell") return "'" + value.replaceAll("'", "''") + "'";
  if (shell === "bash") return "'" + value.replaceAll("'", "'\\''") + "'";
  // The launcher is a .cmd shim on Windows. Keep shell metacharacters
  // within the argument quotes and preserve backslashes at quote boundaries.
  const escaped = value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1");
  return '"' + escaped + '"';
}

export function formatCliCommand(command: CliCommand, shell: CliShell = cliShell()): string {
  return [formatCliLauncher(command.launcher, shell), ...command.args.map(value => quoteArgument(value, shell))].join(" ");
}
