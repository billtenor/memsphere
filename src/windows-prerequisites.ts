import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnCommand } from "./platform-process.js";

export type WindowsPrerequisites = {
  gitVersion: string;
  gitBashPath: string;
};

export async function assertWindowsPrerequisites(
  options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {}
): Promise<WindowsPrerequisites | undefined> {
  if ((options.platform ?? process.platform) !== "win32") return undefined;
  const env = options.env ?? process.env;
  let gitVersion: string;
  let execPath: string;
  try {
    gitVersion = firstLine(await capture("git", ["--version"], env));
    execPath = firstLine(await capture("git", ["--exec-path"], env));
  } catch (error) {
    throw new Error(
      "Git for Windows is required. Install it from https://git-scm.com/download/win and reopen the terminal. "
      + `Git check failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const candidates = gitBashCandidates(execPath, env);
  for (const candidate of candidates) {
    if (await exists(candidate)) return { gitVersion, gitBashPath: candidate };
  }
  throw new Error(
    "Git Bash from Git for Windows is required but bash.exe was not found. "
    + `Checked: ${candidates.join(", ")}. Reinstall Git for Windows with Git Bash enabled.`
  );
}

export function gitBashCandidates(gitExecPath: string, env: NodeJS.ProcessEnv): string[] {
  const gitRoot = resolve(gitExecPath, "..", "..", "..");
  const candidates = [
    join(gitRoot, "bin", "bash.exe"),
    join(gitRoot, "usr", "bin", "bash.exe")
  ];
  for (const base of [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA]) {
    if (!base) continue;
    const root = base === env.LOCALAPPDATA ? join(base, "Programs", "Git") : join(base, "Git");
    candidates.push(join(root, "bin", "bash.exe"), join(root, "usr", "bin", "bash.exe"));
  }
  return [...new Set(candidates.map((candidate) => resolve(candidate)))];
}

function capture(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawnCommand(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolveOutput(stdout)
      : reject(new Error(`${command} exited ${code}: ${firstLine(stderr) || "no output"}`)));
  });
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
