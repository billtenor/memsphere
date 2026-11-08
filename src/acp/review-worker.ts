import { delimiter, join, resolve } from "node:path";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { artifactReviewAssignmentId, type ArtifactReviewAgentFailure } from "../artifact-review.js";
import { readConfig } from "../config.js";
import { resolveMemsphereHome } from "../home.js";
import { resolveWorkspaceIdentity } from "../project/workspace.js";
import {
  assertArtifactReviewAgentAttemptRunning,
  claimArtifactReviewAgentAssignment,
  failArtifactReviewAgentAssignment,
  readArtifactReviewForActor,
  recordArtifactReviewAgentSession,
  recordArtifactReviewAgentProcesses,
  recordArtifactReviewAgentStop
} from "../context_control/review-repository.js";
import { runAgentReviewAcpSession } from "./client.js";
import { AgentActivityRecorder } from "./activity.js";
import { createAgentReviewCliRuntime } from "./cli-runtime.js";
import { buildArtifactReviewerPrompt, buildArtifactReviewerReminder } from "./prompt.js";
import { getAgentReviewProvider, type AgentReviewProvider } from "./provider.js";
import { AcpProviderConfigurationError } from "./validation.js";
import { resolvePromptLocale } from "../prompts/index.js";
import { assertWindowsPrerequisites } from "../windows-prerequisites.js";
import { captureProcessIdentity } from "../context_control/review-process.js";
import { startWindowsReviewJob } from "../context_control/windows-review-job.js";

export type AgentReviewWorkerOptions = {
  signal?: AbortSignal;
  config?: string;
  review?: string;
  round?: string;
  assignment?: string;
  nodeExecutable?: string;
  cliEntrypoint?: string;
  workspaceRoot?: string;
  providerResolver?: (id: string | undefined) => AgentReviewProvider;
  runSession?: typeof runAgentReviewAcpSession;
};

export async function runArtifactReviewAgentWorker(options: AgentReviewWorkerOptions): Promise<void> {
  options.signal?.throwIfAborted();
  const reviewId = requiredOption(options.review, "--review");
  const roundId = requiredOption(options.round, "--round");
  const assignmentId = requiredOption(options.assignment, "--assignment");
  const nodeExecutable = requiredOption(options.nodeExecutable, "--node-executable");
  const cliEntrypoint = requiredOption(options.cliEntrypoint, "--cli-entrypoint");
  const config = await readConfig(requiredOption(options.config, "--config"));
  options.signal?.throwIfAborted();
  let workerJob: string | undefined;
  let enrollmentFailure: unknown;
  if (process.platform === "win32" && reviewId.startsWith("graph-review-")) {
    try {
      const identity = await captureProcessIdentity(process.pid);
      if (!identity) throw new Error("Worker creation identity unavailable");
      workerJob = await startWindowsReviewJob(identity);
    } catch (error) { enrollmentFailure = error; }
  }
  const claimed = await claimArtifactReviewAgentAssignment({
    runsRoot: config.runsRoot,
    reviewId,
    roundId,
    actorId: assignmentId,
    // Failed enrollment has not run provider preparation or spawned a Provider.
    // No uncontained Reviewer is allowed to continue after this failure.
    workerPid: enrollmentFailure ? undefined : process.pid,
    ...(workerJob ? { workerJob } : {})
  });
  if (!claimed) return;

  const { actorId } = claimed.assignment;
  const common = {
    runsRoot: config.runsRoot,
    reviewId,
    roundId,
    actorId,
    attemptId: claimed.attempt.id
  };
  const callerDirectory = resolve(options.workspaceRoot ?? process.cwd());
  let sourceWorkspace = callerDirectory;

  let workspaceRoot = callerDirectory;
  let attemptDirectory: string | undefined;
  const activity = new AgentActivityRecorder({
    ...common,
    runId: claimed.run.id,
    assignmentId: artifactReviewAssignmentId(claimed.assignment),
    workspaceRoot,
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Agent Activity recording failed: ${message.slice(0, 2_000)}\n`);
    }
  });
  activity.recordLifecycle("running", "Agent worker started");
  let cliRuntime: Awaited<ReturnType<typeof createAgentReviewCliRuntime>> | undefined;
  try {
    options.signal?.throwIfAborted();
    if (enrollmentFailure) throw enrollmentFailure;
    if (config.project?.store?.type === "embedded") {
      const canonical = await resolveWorkspaceIdentity(config.memoryRoot);
      const caller = await resolveWorkspaceIdentity(callerDirectory);
      // View/server launches can have a cwd in a different repository. Keep an
      // actual source worktree when present; otherwise use this verified Project.
      if (caller.kind !== "git" || caller.key !== canonical.key) sourceWorkspace = canonical.path;
    }
    const temporaryRoot = join(callerDirectory, "tmp");
    await mkdir(temporaryRoot, { recursive: true });
    attemptDirectory = await mkdtemp(join(temporaryRoot, "memsphere-review-"));
    workspaceRoot = await realpath(attemptDirectory);
    activity.recordLifecycle("workspace", `Attempt working directory: ${workspaceRoot}`);
    await assertWindowsPrerequisites();
    const actor = claimed.run.controlPlane?.actors[actorId];
    if (!actor || actor.kind !== "agent") throw new Error(`agent_actor_missing: ${actorId}`);
    cliRuntime = await createAgentReviewCliRuntime({ nodeExecutable, cliEntrypoint });
    const provider = (options.providerResolver ?? getAgentReviewProvider)(actor.agent.providerType);
    const launch = provider.buildLaunch({
      actor,
      workspaceRoot,
      sessionEnv: {
        TMPDIR: workspaceRoot,
        TMP: workspaceRoot,
        TEMP: workspaceRoot,
        MEMSPHERE_CLI: cliRuntime.launcherPath,
        MEMSPHERE_HOME: resolveMemsphereHome(),
        MEMSPHERE_REVIEW_SOURCE_WORKSPACE: sourceWorkspace,
        MEMSPHERE_REVIEW_HANDLE: reviewId,
        MEMSPHERE_REVIEW_ROUND_ID: roundId,
        MEMSPHERE_REVIEW_RUN_ID: claimed.run.id,
        ...((claimed.run.memorySnapshot || claimed.run.frozenMemoryRunId) ? { MEMSPHERE_REVIEW_MEMORY_RUN_ID: claimed.run.id } : {}),
        MEMSPHERE_REVIEW_ASSIGNMENT_ID: artifactReviewAssignmentId(claimed.assignment),
        MEMSPHERE_REVIEW_ATTEMPT_ID: claimed.attempt.id,
        MEMSPHERE_CONFIG_PATH: config.configPath,
        MEMSPHERE_WORKSPACE_ROOT: workspaceRoot,
        PATH: [cliRuntime.directory, process.env.PATH].filter(Boolean).join(delimiter)
      }
    });
    const prompt = await buildArtifactReviewerPrompt({
      context: claimed,
      promptVersion: claimed.assignment.nodeTree ? "artifact-review-v3" : claimed.attempt.promptVersion ?? launch.promptVersion,
      locale: resolvePromptLocale(claimed.run.language)
    });
    const result = await (options.runSession ?? runAgentReviewAcpSession)({
      launch,
      signal: options.signal,
      assertLaunchValid: () => assertArtifactReviewAgentAttemptRunning(common),
      onBeforeStop: providerPid => recordArtifactReviewAgentProcesses({ ...common, workerPid: process.pid, providerPid }),
      prompt: `${prompt}\n\n${claimed.run.language === "en"
        ? "Use the current directory for this Attempt. Read or download Artifacts only when needed and keep local material and temporary files here. No source code is copied into this directory."
        : "当前目录是本次 Attempt 的独立工作目录。按需读取或下载 Artifact，本地材料和临时文件自行在当前目录组织。此目录未复制代码。"}`,
      reminder: buildArtifactReviewerReminder(
        resolvePromptLocale(claimed.run.language),
        claimed.assignment.nodeTree ? "artifact-review-v3" : claimed.attempt.promptVersion ?? launch.promptVersion
      ),
      workspaceRoot,
      isSubmitted: async () => {
        const current = await readArtifactReviewForActor({
          runsRoot: config.runsRoot,
          reviewId,
          roundId,
          actorId
        });
        return current.assignment.status === "submitted";
      },
      onSession: async (metadata) => {
        await recordArtifactReviewAgentSession({ ...common, ...metadata });
        activity.recordLifecycle("connected", "ACP session connected");
      },
      onUpdate: (update) => activity.recordSessionUpdate(update),
      onPrompt: (kind, text) => activity.recordPrompt(kind, text)
    });
    activity.recordLifecycle(result.stopReason === "submitted" ? "submitted" : "stopped", "Agent review stopped");
    await recordArtifactReviewAgentStop({ ...common, stopReason: result.stopReason });
  } catch (error) {
    const failure = classifyAgentFailure(error);
    activity.recordLifecycle("failed", `Agent review failed: ${failure.code}`);
    await failArtifactReviewAgentAssignment({
      ...common,
      failure,
      stopReason: "worker_error"
    });
  } finally {
    await cliRuntime?.cleanup().catch(() => undefined);
    if (attemptDirectory) {
      try { await rm(attemptDirectory,{recursive:true,force:true}); }
      catch (error) {
        // A surviving process can own its cwd on Windows. Keep the original
        // Review outcome and retain the directory for later recovery/cleanup.
        activity.recordLifecycle("cleanup_failed",`Attempt directory retained: ${attemptDirectory}; ${(error as NodeJS.ErrnoException).code ?? String(error)}`);
      }
    }
    await activity.close();
  }
}

function classifyAgentFailure(error: unknown): ArtifactReviewAgentFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof AcpProviderConfigurationError) {
    return {
      stage: "spawn",
      code: error.field === "args"
        ? "agent_provider_arguments_invalid"
        : "agent_provider_command_invalid",
      message,
      category: "provider"
    };
  }
  if (/listen EPERM|EACCES/i.test(message)) {
    return { stage: "session", code: "agent_environment_failed", message, category: "environment" };
  }
  const timeoutCode = message.match(/^(agent_(?:startup|idle|max_runtime)_timeout):/)?.[1];
  if (timeoutCode) return { stage: "timeout", code: timeoutCode, message, category: "environment" };
  if (message.startsWith("acp_protocol") || message.includes("JSON-RPC")) return { stage: "protocol", code: "acp_protocol_error", message, category: "provider" };
  if (message.startsWith("agent_connection_closed:")) return { stage: "protocol", code: "agent_connection_closed", message, category: "provider" };
  if (message.startsWith("cli_") || message.startsWith("review_") || message.includes("CLI handshake")) {
    return { stage: "cli", code: message.split(":", 1)[0], message, category: "reviewer" };
  }
  if (message.startsWith("agent_provider") || message.startsWith("agent_identity")) {
    return { stage: "spawn", code: message.split(":", 1)[0], message, category: "provider" };
  }
  if ((message.startsWith("agent_process_spawn") || message.includes("ENOENT")) && /ENOENT|not found/i.test(message)) {
    return { stage: "spawn", code: "agent_provider_not_installed", message, category: "provider" };
  }
  if (/not authenticated|authentication required|unauthorized|please log[ -]?in|login required/i.test(message)) {
    return { stage: "session", code: "agent_provider_auth_required", message, category: "provider" };
  }
  if (/unknown model|model .*not found|invalid model|unsupported model/i.test(message)) {
    return { stage: "session", code: "agent_provider_model_invalid", message, category: "provider" };
  }
  if (message.startsWith("agent_process")) {
    return { stage: "process", code: "agent_process_failed", message, category: "environment" };
  }
  if (message.startsWith("agent_submission_missing")) return { stage: "prompt", code: "agent_submission_missing", message, category: "reviewer" };
  return { stage: "session", code: "agent_session_failed", message, category: "unknown" };
}

function requiredOption(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}
