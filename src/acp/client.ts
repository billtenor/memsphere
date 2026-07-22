import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentReviewProviderLaunch } from "./provider.js";

export type AgentReviewAcpSession = {
  protocolVersion: number;
  sessionId: string;
  agentName?: string;
  agentVersion?: string;
  stopReason: string;
  stderr: string;
};

export async function runAgentReviewAcpSession(input: {
  launch: AgentReviewProviderLaunch;
  prompt: string;
  reminder: string;
  workspaceRoot: string;
  isSubmitted(): Promise<boolean>;
  waitForSubmission?(): Promise<void>;
  onSession(metadata: Omit<AgentReviewAcpSession, "stopReason" | "stderr">): Promise<void>;
}): Promise<AgentReviewAcpSession> {
  const process = spawnAgent(input.launch);
  let stderr = "";
  let idleTimeout: TimeoutWatchdog | undefined;
  const terminate = () => {
    if (process.exitCode === null && !process.killed) process.kill("SIGTERM");
  };
  const startupTimeout = createTimeoutWatchdog(
    input.launch.startupTimeoutMs,
    "agent_startup_timeout",
    `startup exceeded ${input.launch.startupTimeoutMs}ms`,
    terminate
  );
  const maxRuntimeTimeout = input.launch.maxRuntimeMs === null
    ? undefined
    : createTimeoutWatchdog(
        input.launch.maxRuntimeMs,
        "agent_max_runtime_timeout",
        `total runtime exceeded ${input.launch.maxRuntimeMs}ms`,
        terminate
      );
  const startupSignal = combineSignals(startupTimeout.signal, maxRuntimeTimeout?.signal);
  const markActivity = () => idleTimeout?.touch();
  process.stderr.setEncoding("utf8");
  process.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-64 * 1024);
  });
  try {
    await waitForSpawn(process, startupSignal);
    const stream = acp.ndJsonStream(
      Writable.toWeb(process.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(process.stdout) as ReadableStream<Uint8Array>
    );
    const result = await acp
      .client({ name: "memsphere" })
      .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
        markActivity();
        return rejectPermission(params.options);
      })
      .onNotification(acp.methods.client.session.update, () => markActivity())
      .onRequest(acp.methods.client.fs.readTextFile, ({ params }) => {
        markActivity();
        return readWorkspaceTextFile(input.workspaceRoot, params);
      })
      .connectWith(stream, async (context) => {
        const initialized = await context.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: false }, terminal: false },
          clientInfo: { name: "memsphere", title: "Memsphere", version: "0.1.1" }
        }, { cancellationSignal: startupSignal });
        if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
          throw new Error(`acp_protocol_mismatch: expected ${acp.PROTOCOL_VERSION}, received ${initialized.protocolVersion}`);
        }
        return context.buildSession(resolve(input.launch.cwd)).withSession(async (session) => {
          startupTimeout.dispose();
          idleTimeout = createTimeoutWatchdog(
            input.launch.idleTimeoutMs,
            "agent_idle_timeout",
            `no ACP activity for ${input.launch.idleTimeoutMs}ms`,
            terminate,
            true
          );
          const runtimeSignal = combineSignals(idleTimeout.signal, maxRuntimeTimeout?.signal);
          const metadata = {
            protocolVersion: initialized.protocolVersion,
            sessionId: session.sessionId,
            agentName: initialized.agentInfo?.name,
            agentVersion: initialized.agentInfo?.version
          };
          await input.onSession(metadata);
          idleTimeout.touch();
          let outcome = await promptUntilSubmission(session, input.prompt, runtimeSignal, input.waitForSubmission);
          if (outcome.submitted) return { ...metadata, stopReason: "submitted" };
          let response = outcome.response;
          if (!(await input.isSubmitted())) {
            idleTimeout.touch();
            outcome = await promptUntilSubmission(session, input.reminder, runtimeSignal, input.waitForSubmission);
            if (outcome.submitted) return { ...metadata, stopReason: "submitted" };
            response = outcome.response;
          }
          if (!(await input.isSubmitted())) {
            throw new Error(`agent_submission_missing: ACP Agent ended with ${response.stopReason} without run review submit`);
          }
          return { ...metadata, stopReason: response.stopReason };
        });
      });
    return { ...result, stderr };
  } catch (error) {
    const timeoutError = timeoutReason(startupTimeout, idleTimeout, maxRuntimeTimeout);
    if (timeoutError) {
      throw new Error(withAgentStderr(timeoutError.message, stderr), { cause: error });
    }
    if (error instanceof Error && error.message.startsWith("agent_process_spawn:")) throw error;
    if (process.exitCode !== null && process.exitCode !== 0) {
      throw new Error(withAgentStderr(`agent_process_exit: exited ${process.exitCode}`, stderr), { cause: error });
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(withAgentStderr(message, stderr), { cause: error });
  } finally {
    startupTimeout.dispose();
    idleTimeout?.dispose();
    maxRuntimeTimeout?.dispose();
    terminate();
  }
}

function withAgentStderr(message: string, stderr: string): string {
  const diagnostic = stderr.trim();
  return diagnostic ? `${message}\nAgent stderr:\n${diagnostic}` : message;
}

function spawnAgent(launch: AgentReviewProviderLaunch): ChildProcessWithoutNullStreams {
  return spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
}

async function waitForSpawn(process: ChildProcessWithoutNullStreams, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolveSpawn, rejectSpawn) => {
    const cleanup = () => {
      process.off("spawn", onSpawn);
      process.off("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onSpawn = () => {
      cleanup();
      resolveSpawn();
    };
    const onError = (error: Error) => {
      cleanup();
      rejectSpawn(new Error(`agent_process_spawn: ${error.message}`, { cause: error }));
    };
    const onAbort = () => {
      cleanup();
      rejectSpawn(signal.reason ?? new Error("Agent process start aborted"));
    };
    process.once("spawn", onSpawn);
    process.once("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function promptTurn(
  session: acp.ActiveSession,
  prompt: string,
  signal: AbortSignal
): Promise<acp.PromptResponse> {
  return session.prompt(prompt, { cancellationSignal: signal });
}

async function promptUntilSubmission(
  session: acp.ActiveSession,
  prompt: string,
  timeoutSignal: AbortSignal,
  waitForSubmission: (() => Promise<void>) | undefined
): Promise<{ submitted: true } | { submitted: false; response: acp.PromptResponse }> {
  if (!waitForSubmission) {
    return { submitted: false, response: await promptTurn(session, prompt, timeoutSignal) };
  }
  const turn = new AbortController();
  const signal = AbortSignal.any([timeoutSignal, turn.signal]);
  const response = promptTurn(session, prompt, signal).then((value) => ({ kind: "response" as const, value }));
  const submitted = waitForSubmission().then(() => ({ kind: "submitted" as const }));
  const outcome = await Promise.race([response, submitted]);
  if (outcome.kind === "response") return { submitted: false, response: outcome.value };
  turn.abort();
  void response.catch(() => undefined);
  return { submitted: true };
}

type AgentTimeoutCode = "agent_startup_timeout" | "agent_idle_timeout" | "agent_max_runtime_timeout";

class AgentTimeoutError extends Error {
  constructor(readonly code: AgentTimeoutCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "AgentTimeoutError";
  }
}

type TimeoutWatchdog = {
  signal: AbortSignal;
  touch(): void;
  dispose(): void;
};

function createTimeoutWatchdog(
  timeoutMs: number,
  code: AgentTimeoutCode,
  detail: string,
  onTimeout: () => void,
  resetOnActivity = false
): TimeoutWatchdog {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (controller.signal.aborted) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort(new AgentTimeoutError(code, detail));
      onTimeout();
    }, timeoutMs);
  };
  schedule();
  return {
    signal: controller.signal,
    touch: () => {
      if (resetOnActivity) schedule();
    },
    dispose: () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    }
  };
}

function combineSignals(required: AbortSignal, optional: AbortSignal | undefined): AbortSignal {
  return optional ? AbortSignal.any([required, optional]) : required;
}

function timeoutReason(...watchdogs: Array<TimeoutWatchdog | undefined>): AgentTimeoutError | undefined {
  for (const watchdog of watchdogs) {
    const reason = watchdog?.signal.reason;
    if (reason instanceof AgentTimeoutError) return reason;
  }
  return undefined;
}

function rejectPermission(options: acp.PermissionOption[]): acp.RequestPermissionResponse {
  const reject = options.find((option) => option.kind === "reject_always")
    ?? options.find((option) => option.kind === "reject_once");
  return reject
    ? { outcome: { outcome: "selected", optionId: reject.optionId } }
    : { outcome: { outcome: "cancelled" } };
}

async function readWorkspaceTextFile(
  workspaceRoot: string,
  request: acp.ReadTextFileRequest
): Promise<acp.ReadTextFileResponse> {
  const path = resolve(request.path);
  if (!isAbsolute(request.path) || !isWithin(workspaceRoot, path)) {
    throw new Error(`agent_fs_denied: path is outside the workspace: ${request.path}`);
  }
  const content = await readFile(path, "utf8");
  const lines = content.split("\n");
  const start = Math.max(0, (request.line ?? 1) - 1);
  const end = request.limit === undefined || request.limit === null ? undefined : start + Math.max(0, request.limit);
  return { content: lines.slice(start, end).join("\n") };
}

function isWithin(root: string, path: string): boolean {
  const child = relative(resolve(root), path);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}
