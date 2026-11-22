import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { createConnection } from "node:net";
import { basename, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { safeDetectionEnvironment } from "../acp/detection.js";

export const claudeNotificationVersion = "2.1.330";
export const claudeInboxSchema = z.object({
  path: z.string().min(1),
  device: z.string().regex(/^\d+$/),
  inode: z.string().regex(/^\d+$/),
  pid: z.number().int().positive(),
  startedAt: z.number().int().positive(),
  configDir: z.string().min(1).optional()
}).strict();
export type ClaudeInbox = z.infer<typeof claudeInboxSchema>;

const execute = promisify(execFile);
const rosterSchema = z.array(z.object({
  sessionId: z.string().optional(),
  pid: z.number().int().positive().optional(),
  startedAt: z.number().int().positive()
}));

export function supportsClaudeNotifications(version?: string, platform = process.platform): boolean {
  return platform === "linux" && (version === claudeNotificationVersion || version === `${claudeNotificationVersion} (Claude Code)`);
}

export class ClaudeNotificationError extends Error {
  constructor(readonly code: "claude_send_not_written" | "claude_send_uncertain", message: string) {
    super(message);
  }
}

async function runClaudeCommand(command: string, args: string[], cwd: string, configDir?: string, signal?: AbortSignal) {
  const result = await execute(command, args, {
    cwd,
    env: { ...safeDetectionEnvironment(process.env), ...(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}) },
    timeout: 3000,
    killSignal: "SIGKILL",
    maxBuffer: 1_048_576,
    signal
  });
  return result.stdout;
}

async function readRoster(command: string, cwd: string, configDir?: string, signal?: AbortSignal) {
  return rosterSchema.parse(JSON.parse(await runClaudeCommand(command, ["agents", "--json"], cwd, configDir, signal)));
}

function selectSession(roster: z.infer<typeof rosterSchema>, sessionId: string) {
  const matches = roster.filter(row => row.sessionId === sessionId && row.pid !== undefined);
  if (matches.length !== 1) throw new Error("The original Claude Code session is not uniquely present in the local session list");
  return { pid: matches[0].pid!, startedAt: matches[0].startedAt };
}

async function socketIdentity(path: string, pid: number) {
  if (!isAbsolute(path) || basename(path) !== `${pid}.sock`) throw new Error("Claude Code inbox path does not match the running session");
  const stat = await lstat(path, { bigint: true });
  if (!stat.isSocket() || stat.uid !== BigInt(process.getuid!()) || await realpath(path) !== path) {
    throw new Error("Claude Code inbox is not a direct socket owned by the current user");
  }
  return { device: String(stat.dev), inode: String(stat.ino) };
}

export async function captureClaudeInbox(input: { command: string; version?: string; cwd: string; sessionId: string }, env = process.env): Promise<ClaudeInbox> {
  if (!supportsClaudeNotifications(input.version)) {
    throw new Error(`Claude Code asynchronous reviews require verified Linux CLI ${claudeNotificationVersion}; disable asynchronous execution to wait synchronously`);
  }
  const path = env.CLAUDE_CODE_MESSAGING_SOCKET;
  if (!path) throw new Error("The current Claude Code session has no inbox; disable asynchronous execution to wait synchronously");
  const configDir = env.CLAUDE_CONFIG_DIR ? resolve(input.cwd, env.CLAUDE_CONFIG_DIR) : undefined;
  try {
    const { pid, startedAt } = selectSession(await readRoster(input.command, input.cwd, configDir), input.sessionId);
    return { path, pid, startedAt, ...await socketIdentity(path, pid), ...(configDir ? { configDir } : {}) };
  } catch (error) {
    throw new Error("Could not verify the current Claude Code inbox; disable asynchronous execution to wait synchronously", { cause: error });
  }
}

export function encodeClaudeNotification(message: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: message } }) + "\n";
}

function writeInbox(path: string, message: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let writing = false;
    if (signal.aborted) {
      reject(new ClaudeNotificationError("claude_send_not_written", "Claude Code notification was cancelled before writing"));
      return;
    }
    const socket = createConnection(path);
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      socket.destroy();
      if (success) resolvePromise();
      else reject(new ClaudeNotificationError(
        writing ? "claude_send_uncertain" : "claude_send_not_written",
        writing ? "Claude Code inbox write did not finish; outcome may be unknown" : "Could not connect to the original Claude Code inbox"
      ));
    };
    const abort = () => finish(false);
    signal.addEventListener("abort", abort, { once: true });
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
    socket.once("connect", () => {
      writing = true;
      socket.end(encodeClaudeNotification(message), (error?: Error) => finish(!error));
    });
  });
}

export async function sendClaudeNotification(input: { command: string; sessionId: string; inbox: ClaudeInbox; cwd: string; message: string; signal: AbortSignal }): Promise<void> {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(5000)]);
  const { inbox } = input;
  try {
    const version = await runClaudeCommand(input.command, ["--version"], input.cwd, inbox.configDir, signal);
    if (!supportsClaudeNotifications(version.trim())) throw new Error("Unverified Claude Code notification version");
    const current = selectSession(await readRoster(input.command, input.cwd, inbox.configDir, signal), input.sessionId);
    const identity = await socketIdentity(inbox.path, current.pid);
    if (current.pid !== inbox.pid || current.startedAt !== inbox.startedAt || identity.device !== inbox.device || identity.inode !== inbox.inode) {
      throw new Error("The original Claude Code inbox has changed");
    }
  } catch {
    throw new ClaudeNotificationError("claude_send_not_written", "Could not verify the original Claude Code inbox before sending");
  }
  await writeInbox(inbox.path, input.message, signal);
}
