import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

export type CliRuntimeDescriptor = {
  nodeExecutable: string;
  cliEntrypoint: string;
};

export type AgentReviewCliRuntime = {
  descriptor: CliRuntimeDescriptor;
  directory: string;
  launcherPath: string;
  source: "installed" | "development";
  cleanup(): Promise<void>;
};

export function currentCliRuntimeDescriptor(): CliRuntimeDescriptor {
  const cliEntrypoint = process.argv[1];
  if (!cliEntrypoint) throw new Error("cli_runtime_invalid: current CLI entrypoint is unavailable");
  return {
    nodeExecutable: resolve(process.execPath),
    cliEntrypoint: resolve(cliEntrypoint)
  };
}

export async function createAgentReviewCliRuntime(descriptor: CliRuntimeDescriptor): Promise<AgentReviewCliRuntime> {
  assertCliRuntimeDescriptor(descriptor);
  const directory = await mkdtemp(join(tmpdir(), "memsphere-agent-review-"));
  const launcherPath = join(directory, process.platform === "win32" ? "memsphere.cmd" : "memsphere");
  const guardPath = join(directory, "guard.mjs");
  const source = agentReviewCliSource(descriptor);
  await writeFile(guardPath, buildGuard(descriptor), "utf8");
  const launcher = process.platform === "win32"
    ? `@echo off\r\n"${escapeWindows(descriptor.nodeExecutable)}" "${escapeWindows(guardPath)}" %*\r\n`
    : `#!/bin/sh\nexec ${shellQuote(descriptor.nodeExecutable)} ${shellQuote(guardPath)} "$@"\n`;
  await writeFile(launcherPath, launcher, "utf8");
  if (process.platform !== "win32") await chmod(launcherPath, 0o700);
  try {
    await preflightLauncher(launcherPath);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    descriptor,
    directory,
    launcherPath,
    source,
    cleanup: () => rm(directory, { recursive: true, force: true })
  };
}

export function agentReviewCliSource(descriptor: CliRuntimeDescriptor): "installed" | "development" {
  return descriptor.cliEntrypoint.includes(`${join("node_modules", "memsphere")}`)
    ? "installed"
    : "development";
}

function buildGuard(descriptor: CliRuntimeDescriptor): string {
  return `import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const boundRun = option("--run") === process.env.MEMSPHERE_REVIEW_RUN_ID;
const boundAssignment = option("--assignment") === process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID;
const reviewWrite = args[0] === "run" && args[1] === "review" && ["comment", "submit"].includes(args[2]);
const assignmentShow = args[0] === "run" && args[1] === "review" && args[2] === "assignment" && args[3] === "show";
const artifactShow = args[0] === "run" && args[1] === "artifact" && args[2] === "show";
const artifactContractShow = args[0] === "run" && args[1] === "artifact" && args[2] === "contract" && args[3] === "show";
const stepShow = args[0] === "run" && args[1] === "step" && args[2] === "show";
const allowed = (args.length === 1 && args[0] === "--version")
  || (args[0] === "memory" && ["list", "read"].includes(args[1]))
  || (args[0] === "run" && args[1] === "show" && boundRun)
  || (stepShow && boundRun)
  || (artifactShow && (boundAssignment || boundRun))
  || (artifactContractShow && (boundAssignment || boundRun))
  || (assignmentShow && boundAssignment)
  || (reviewWrite && boundAssignment);
if (!allowed) {
  console.error("error: command is not allowed in this Agent Review Session");
  process.exit(2);
}
const result = spawnSync(${JSON.stringify(descriptor.nodeExecutable)}, [${JSON.stringify(descriptor.cliEntrypoint)}, ...args], {
  stdio: "inherit",
  env: process.env
});
if (result.error) {
  console.error("error: " + result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
`;
}

function assertCliRuntimeDescriptor(descriptor: CliRuntimeDescriptor): void {
  if (!descriptor.nodeExecutable || !resolve(descriptor.nodeExecutable)) {
    throw new Error("cli_runtime_invalid: Node executable is unavailable");
  }
  if (!descriptor.cliEntrypoint || !resolve(descriptor.cliEntrypoint)) {
    throw new Error("cli_runtime_invalid: CLI entrypoint is unavailable");
  }
}

async function preflightLauncher(launcherPath: string): Promise<void> {
  await new Promise<void>((resolveProcess, rejectProcess) => {
    const child = spawn(launcherPath, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => rejectProcess(new Error(`cli_launcher_failed: ${error.message}`)));
    child.once("exit", (code) => {
      if (code === 0) resolveProcess();
      else rejectProcess(new Error(`cli_launcher_failed: ${basename(launcherPath)} exited ${code}: ${stderr.trim()}`));
    });
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function escapeWindows(value: string): string {
  return value.replaceAll('"', '""');
}
