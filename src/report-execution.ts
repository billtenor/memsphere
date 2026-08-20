import { execFile } from "node:child_process";
import { lstat, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const reportExecutionProbeRelativePath = join("memsphere", "report-execution.probe");

type ReportExecutionProbeOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  uid?: number;
  resolveDarwinCacheDirectory?: () => Promise<string>;
  resolveHomeDirectory?: () => string;
  mkdir?: typeof mkdir;
  lstat?: typeof lstat;
  open?: typeof open;
};

export async function resolveReportExecutionProbePath(
  options: ReportExecutionProbeOptions = {}
): Promise<string> {
  const platform = options.platform ?? process.platform;
  let root: string;

  if (platform === "linux") {
    const env = options.env ?? process.env;
    root = env.XDG_RUNTIME_DIR?.trim()
      || resolveLinuxRuntimeDirectory(options.uid);
  } else if (platform === "darwin") {
    root = await (options.resolveDarwinCacheDirectory ?? resolveDarwinCacheDirectory)();
  } else if (platform === "win32") {
    const env = options.env ?? process.env;
    root = env.LOCALAPPDATA?.trim()
      || join((options.resolveHomeDirectory ?? homedir)(), "AppData", "Local");
  } else {
    throw new Error(`unsupported operating system: ${platform}`);
  }

  if (!root || !isAbsolute(root)) {
    throw new Error(`platform runtime directory is not an absolute path: ${root || "<empty>"}`);
  }
  return join(root, reportExecutionProbeRelativePath);
}

export async function assertReportExecutionCapability(
  options: ReportExecutionProbeOptions = {}
): Promise<string> {
  const probePath = await resolveReportExecutionProbePath(options);
  const mkdirImpl = options.mkdir ?? mkdir;
  const lstatImpl = options.lstat ?? lstat;
  const openImpl = options.open ?? open;
  const parent = dirname(probePath);

  await mkdirImpl(parent, { recursive: true, mode: 0o700 });
  const existing = await lstatImpl(probePath).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  });
  if (existing && !existing.isFile()) {
    throw new Error("probe path exists but is not a regular file");
  }

  const handle = await openImpl(probePath, "a", 0o600);
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw new Error("opened probe is not a regular file");
  } finally {
    await handle.close();
  }
  return probePath;
}

function resolveLinuxRuntimeDirectory(uid?: number): string {
  const currentUid = uid ?? process.getuid?.();
  if (currentUid === undefined) {
    throw new Error("cannot resolve the current Linux user id");
  }
  return `/run/user/${currentUid}`;
}

async function resolveDarwinCacheDirectory(): Promise<string> {
  const { stdout } = await execFileAsync("/usr/bin/getconf", ["DARWIN_USER_CACHE_DIR"]);
  return stdout.trim();
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}
