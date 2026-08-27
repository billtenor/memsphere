import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitResult = { stdout: string; stderr: string };

export async function runGit(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; allowFailure?: boolean; preserveStdout?: boolean } = {}
): Promise<GitResult> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: options.cwd,
      env: options.env,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    });
    return { stdout: options.preserveStdout ? result.stdout : result.stdout.trimEnd(), stderr: result.stderr.trim() };
  } catch (error) {
    if (isExecError(error) && "code" in error && error.code === "ENOENT") throw missingGitError(error);
    if (options.allowFailure && isExecError(error)) {
      return { stdout: String(error.stdout ?? "").trimEnd(), stderr: String(error.stderr ?? "").trim() };
    }
    const detail = isExecError(error) ? String(error.stderr || error.message).trim() : String(error);
    throw new Error(`git ${args[0] ?? "command"} failed${detail ? `: ${detail}` : ""}`, { cause: error });
  }
}

export async function gitHashObject(source: Uint8Array, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("git", ["hash-object", "--stdin"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (!error) {
        resolve(stdout.trimEnd());
        return;
      }
      if (error.code === "ENOENT") {
        reject(missingGitError(error));
        return;
      }
      const detail = String(stderr || error.message).trim();
      reject(new Error(`git hash-object failed${detail ? `: ${detail}` : ""}`, { cause: error }));
    });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(Buffer.from(source));
  });
}

export function missingGitMessage(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32"
    ? "Git is required but was not found. Install Git for Windows, reopen PowerShell, CMD, or Git Bash, and ensure git is available on PATH."
    : "Git is required but was not found. Install Git and ensure it is available on PATH.";
}

export async function gitOutput(args: string[], cwd?: string): Promise<string> {
  return (await runGit(args, { cwd })).stdout;
}

export async function gitOutputRaw(args: string[], cwd?: string): Promise<string> {
  return (await runGit(args, { cwd, preserveStdout: true })).stdout;
}

function isExecError(error: unknown): error is Error & { code?: string; stdout?: string; stderr?: string } {
  return error instanceof Error;
}

function missingGitError(error: unknown): Error {
  return new Error(missingGitMessage(), { cause: error });
}
