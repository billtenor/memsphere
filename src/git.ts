import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitResult = { stdout: string; stderr: string };

export async function runGit(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; allowFailure?: boolean } = {}
): Promise<GitResult> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: options.cwd,
      env: options.env,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    });
    return { stdout: result.stdout.trimEnd(), stderr: result.stderr.trim() };
  } catch (error) {
    if (isExecError(error) && "code" in error && error.code === "ENOENT") {
      throw new Error(missingGitMessage(), { cause: error });
    }
    if (options.allowFailure && isExecError(error)) {
      return { stdout: String(error.stdout ?? "").trimEnd(), stderr: String(error.stderr ?? "").trim() };
    }
    const detail = isExecError(error) ? String(error.stderr || error.message).trim() : String(error);
    throw new Error(`git ${args[0] ?? "command"} failed${detail ? `: ${detail}` : ""}`, { cause: error });
  }
}

export function missingGitMessage(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32"
    ? "Git is required but was not found. Install Git for Windows, reopen PowerShell, CMD, or Git Bash, and ensure git is available on PATH."
    : "Git is required but was not found. Install Git and ensure it is available on PATH.";
}

export async function gitOutput(args: string[], cwd?: string): Promise<string> {
  return (await runGit(args, { cwd })).stdout;
}

function isExecError(error: unknown): error is Error & { code?: string; stdout?: string; stderr?: string } {
  return error instanceof Error;
}
