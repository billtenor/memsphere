import { delimiter } from "node:path";
import { artifactReviewAssignmentId, type ArtifactReviewAgentFailure } from "../artifact-review.js";
import { readConfig } from "../config.js";
import { resolveWorkspaceIdentity } from "../project/workspace.js";
import {
  claimArtifactReviewAgentAssignment,
  failArtifactReviewAgentAssignment,
  readArtifactReviewForActor,
  recordArtifactReviewAgentSession,
  recordArtifactReviewAgentStop
} from "../run/store.js";
import { runAgentReviewAcpSession } from "./client.js";
import { AgentActivityRecorder } from "./activity.js";
import { createAgentReviewCliRuntime } from "./cli-runtime.js";
import { buildArtifactReviewerPrompt, buildArtifactReviewerReminder } from "./prompt.js";
import { getAgentReviewProvider, type AgentReviewProvider } from "./provider.js";
import { AcpProviderConfigurationError } from "./validation.js";
import { resolvePromptLocale } from "../prompts/index.js";
import { assertWindowsPrerequisites } from "../windows-prerequisites.js";

export type AgentReviewWorkerOptions = {
  config?: string;
  review?: string;
  round?: string;
  assignment?: string;
  nodeExecutable?: string;
  cliEntrypoint?: string;
  providerResolver?: (id: string | undefined) => AgentReviewProvider;
};

export async function runArtifactReviewAgentWorker(options: AgentReviewWorkerOptions): Promise<void> {
  const reviewId = requiredOption(options.review, "--review");
  const roundId = requiredOption(options.round, "--round");
  const assignmentId = requiredOption(options.assignment, "--assignment");
  const nodeExecutable = requiredOption(options.nodeExecutable, "--node-executable");
  const cliEntrypoint = requiredOption(options.cliEntrypoint, "--cli-entrypoint");
  const config = await readConfig(requiredOption(options.config, "--config"));
  const claimed = await claimArtifactReviewAgentAssignment({
    runsRoot: config.runsRoot,
    reviewId,
    roundId,
    actorId: assignmentId,
    workerPid: process.pid
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
  const workspaceRoot = (await resolveWorkspaceIdentity()).path;
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
    await assertWindowsPrerequisites();
    const actor = claimed.run.controlPlane?.actors[actorId];
    if (!actor || actor.kind !== "agent") throw new Error(`agent_actor_missing: ${actorId}`);
    cliRuntime = await createAgentReviewCliRuntime({ nodeExecutable, cliEntrypoint });
    const provider = (options.providerResolver ?? getAgentReviewProvider)(actor.agent.providerType);
    const launch = provider.buildLaunch({
      actor,
      workspaceRoot,
      sessionEnv: {
        MEMSPHERE_CLI: cliRuntime.launcherPath,
        MEMSPHERE_REVIEW_RUN_ID: claimed.run.id,
        MEMSPHERE_REVIEW_ASSIGNMENT_ID: artifactReviewAssignmentId(claimed.assignment),
        MEMSPHERE_CONFIG_PATH: config.configPath,
        MEMSPHERE_WORKSPACE_ROOT: workspaceRoot,
        PATH: [cliRuntime.directory, process.env.PATH].filter(Boolean).join(delimiter)
      }
    });
    const prompt = await buildArtifactReviewerPrompt({
      context: claimed,
      promptVersion: claimed.attempt.promptVersion ?? launch.promptVersion,
      locale: resolvePromptLocale(claimed.run.language)
    });
    const result = await runAgentReviewAcpSession({
      launch,
      prompt,
      reminder: buildArtifactReviewerReminder(
        resolvePromptLocale(claimed.run.language),
        claimed.attempt.promptVersion ?? launch.promptVersion
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
    await activity.close();
    await cliRuntime?.cleanup().catch(() => undefined);
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
