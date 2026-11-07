import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnCommand } from "../platform-process.js";

export type CliRuntimeDescriptor = {
  nodeExecutable: string;
  cliEntrypoint: string;
};

export type AgentReviewCliRuntime = {
  descriptor: CliRuntimeDescriptor;
  directory: string;
  launcherPath: string;
  commandName: string;
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
  const commandName = "memsphere";
  const launcherPath = join(directory, process.platform === "win32" ? `${commandName}.cmd` : commandName);
  const guardPath = join(directory, "guard.mjs");
  const source = agentReviewCliSource(descriptor);
  await writeFile(guardPath, buildGuard(descriptor), "utf8");
  const launcher = process.platform === "win32"
    ? `@echo off\r\n"${escapeWindows(descriptor.nodeExecutable)}" "${escapeWindows(guardPath)}" %*\r\n`
    : `#!/bin/sh\nexec ${shellQuote(descriptor.nodeExecutable)} ${shellQuote(guardPath)} "$@"\n`;
  await writeFile(launcherPath, launcher, "utf8");
  if (process.platform === "win32") {
    const bashLauncherPath = join(directory, commandName);
    await writeFile(
      bashLauncherPath,
      `#!/bin/sh\nexec ${shellQuote(descriptor.nodeExecutable)} ${shellQuote(guardPath)} "$@"\n`,
      "utf8"
    );
    await chmod(bashLauncherPath, 0o700).catch(() => undefined);
  } else {
    await chmod(launcherPath, 0o700);
  }
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
    commandName,
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
const fail = (message) => { console.error("error: " + message); process.exit(1); };
const result = spawnSync(${JSON.stringify(descriptor.nodeExecutable)}, [${JSON.stringify(descriptor.cliEntrypoint)}, ...args], {
  stdio: "inherit",
  env: process.env
});
if (result.error) {
  fail(result.error.message, "CLI_LAUNCH_FAILED", 1);
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
    const child = spawnCommand(launcherPath, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
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
