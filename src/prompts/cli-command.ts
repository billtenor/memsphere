import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { z } from "zod";
import type { cliCommandSchema } from "./cli-output.js";

export type CliCommand = z.infer<typeof cliCommandSchema>;
export type CliShell = "bash" | "powershell" | "cmd";

let windowsShell: CliShell | undefined;
export function cliShell(): CliShell {
  if (process.platform !== "win32" || process.env.MSYSTEM) return "bash";
  const declared = process.env.MEMSPHERE_CLI_SHELL;
  if (declared === "cmd" || declared === "powershell") return declared;
  if (!windowsShell) {
    try {
      const tasklist = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tasklist.exe");
      const parent = execFileSync(tasklist, ["/fi", "PID eq " + process.ppid, "/fo", "csv", "/nh"],
        { encoding: "utf8", windowsHide: true, timeout: 2000 });
      windowsShell = /^"cmd\.exe"/im.test(parent) ? "cmd" : "powershell";
    } catch { windowsShell = "powershell"; }
  }
  return windowsShell;
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
  return '"' + value + '"';
}

// A .cmd shim reparses its arguments. Carry only ambiguous values as inert
// tokens, so command names, flags and ordinary values remain readable.
const argvTransport = "--windows-argv";
const encodedPrefix = "msarg_";

export function unpackCliArgv(argv: string[]): string[] {
  if (argv[2] !== argvTransport || !argv.slice(3).some(arg => arg.startsWith(encodedPrefix))) return argv;
  try {
    const args = argv.slice(3).map(arg => {
      if (!arg.startsWith(encodedPrefix)) return arg;
      const value: unknown = JSON.parse(Buffer.from(arg.slice(encodedPrefix.length), "base64url").toString("utf8"));
      if (typeof value !== "string") throw new Error("Invalid encoded argument");
      return value;
    });
    return [...argv.slice(0, 2), ...args];
  } catch { return argv; } // Invalid transport input goes through the regular CLI error handler.
}

export function formatCliCommand(command: CliCommand, shell: CliShell = command.launcher === "memsphere" &&
  process.platform === "win32" && !process.env.MSYSTEM ? "cmd" : cliShell()): string {
  const launcher = formatCliLauncher(command.launcher, shell);
  let encoded = false;
  const words = command.args.map(value => {
    if (shell !== "bash" && (!/^[\w ./:=+-]+$/.test(value) || value.startsWith(encodedPrefix))) {
      encoded = true;
      return encodedPrefix + Buffer.from(JSON.stringify(value)).toString("base64url");
    }
    return quoteArgument(value, shell);
  });
  return [launcher, ...(encoded ? [argvTransport] : []), ...words].join(" ");
}
