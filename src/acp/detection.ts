import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, extname, isAbsolute, join, resolve } from "node:path";
import { spawnCommand } from "../platform-process.js";
import {
  listAcpProviderDefinitions,
  type AcpProviderDefinition,
  type AcpProviderInstance
} from "./catalog.js";

export type AcpProviderDetectionStatus =
  | "installed"
  | "version_unknown"
  | "missing"
  | "failed";

export type AcpProviderDetectionResult = {
  id: string;
  type: AcpProviderInstance["type"];
  command: string;
  path?: string;
  version?: string;
  status: AcpProviderDetectionStatus;
  reason?: string;
  installHelp: string;
  detectedAt: string;
};

export async function detectAcpProviderInstances(
  instances: Record<string, AcpProviderInstance>,
  options: { path?: string; timeoutMs?: number } = {}
): Promise<AcpProviderDetectionResult[]> {
  const definitions = new Map(listAcpProviderDefinitions().map((definition) => [definition.type, definition]));
  return Promise.all(Object.entries(instances).map(async ([id, instance]) =>
    detectAcpProviderInstance(id, instance, definitions.get(instance.type)!, options)
  ));
}

export async function detectAcpProviderInstance(
  id: string,
  instance: AcpProviderInstance,
  definition: AcpProviderDefinition,
  options: { path?: string; timeoutMs?: number } = {}
): Promise<AcpProviderDetectionResult> {
  const detectedAt = new Date().toISOString();
  const path = await resolveExecutable(instance.command, options.path ?? process.env.PATH);
  if (!path) {
    return {
      id,
      type: instance.type,
      command: instance.command,
      status: "missing",
      reason: `Executable not found: ${instance.command}`,
      installHelp: definition.installHelp,
      detectedAt
    };
  }
  try {
    const output = await runVersionCommand(path, definition.versionArgs, options.timeoutMs ?? 3_000);
    const version = firstNonEmptyLine(output);
    return {
      id,
      type: instance.type,
      command: instance.command,
      path,
      ...(version ? { version, status: "installed" as const } : { status: "version_unknown" as const }),
      ...(!version ? { reason: "The executable did not return a version string." } : {}),
      installHelp: definition.installHelp,
      detectedAt
    };
  } catch (error) {
    return {
      id,
      type: instance.type,
      command: instance.command,
      path,
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
      installHelp: definition.installHelp,
      detectedAt
    };
  }
}

async function resolveExecutable(command: string, pathValue: string | undefined): Promise<string | undefined> {
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    const candidate = resolve(command);
    return await isExecutable(candidate) ? candidate : undefined;
  }
  const extensions = process.platform === "win32" && !extname(command)
    ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)]
    : [""];
  for (const directory of (pathValue ?? "").split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function runVersionCommand(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawnCommand(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: safeDetectionEnvironment(process.env)
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Version detection timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout = `${stdout}${String(chunk)}`.slice(0, 8_192); });
    child.stderr?.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(0, 8_192); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Version detection exited with code ${code}: ${firstNonEmptyLine(stderr) || "no output"}`));
        return;
      }
      resolvePromise(`${stdout}\n${stderr}`);
    });
  });
}

function firstNonEmptyLine(value: string): string | undefined {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 500);
}

export function safeDetectionEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = new Set([
    "HOME", "PATH", "LANG", "LANGUAGE", "TMPDIR", "TEMP", "TMP", "SHELL",
    "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "COMSPEC", "ComSpec",
    "SystemRoot", "SYSTEMROOT", "PATHEXT"
  ]);
  return Object.fromEntries(Object.entries(source).filter(([name, value]) =>
    value !== undefined && (allowed.has(name) || name.startsWith("LC_"))
  ));
}
