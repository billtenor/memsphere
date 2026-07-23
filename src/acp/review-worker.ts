import { dirname } from "node:path";
import { artifactReviewAssignmentId, type ArtifactReviewAgentFailure } from "../artifact-review.js";
import { readConfig } from "../config.js";
import {
  claimArtifactReviewAgentAssignment,
  failArtifactReviewAgentAssignment,
  readArtifactReviewForIdentity,
  recordArtifactReviewAgentSession,
  recordArtifactReviewAgentStop
} from "../run/store.js";
import { runAgentReviewAcpSession } from "./client.js";
import { AgentActivityRecorder } from "./activity.js";
import { createAgentReviewCliRuntime } from "./cli-runtime.js";
import { buildArtifactReviewerPrompt, buildArtifactReviewerReminder } from "./prompt.js";
import { getAgentReviewProvider, type AgentReviewProvider } from "./provider.js";

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
    identityId: assignmentId,
    workerPid: process.pid
  });
  if (!claimed) return;

  const { identityId } = claimed.assignment;
  const common = {
    runsRoot: config.runsRoot,
    reviewId,
    roundId,
    identityId,
    attemptId: claimed.attempt.id
  };
  const activity = new AgentActivityRecorder({
    ...common,
    runId: claimed.run.id,
    assignmentId: artifactReviewAssignmentId(claimed.assignment),
    workspaceRoot: dirname(config.scopeRoot),
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Agent Activity recording failed: ${message.slice(0, 2_000)}\n`);
    }
  });
  activity.recordLifecycle("running", "Agent worker started");
  let cliRuntime: Awaited<ReturnType<typeof createAgentReviewCliRuntime>> | undefined;
  try {
    const identity = claimed.run.controlPlane?.identities[identityId];
    if (!identity || identity.kind !== "agent") throw new Error(`agent_identity_missing: ${identityId}`);
    cliRuntime = await createAgentReviewCliRuntime({ nodeExecutable, cliEntrypoint });
    const workspaceRoot = dirname(config.scopeRoot);
    const provider = (options.providerResolver ?? getAgentReviewProvider)(identity.agent.provider);
    const launch = provider.buildLaunch({
      identity,
      workspaceRoot,
      sessionEnv: {
        MEMSPHERE_CLI: cliRuntime.launcherPath,
        MEMSPHERE_REVIEW_RUN_ID: claimed.run.id,
        MEMSPHERE_REVIEW_ASSIGNMENT_ID: artifactReviewAssignmentId(claimed.assignment),
        MEMSPHERE_CONFIG_PATH: config.configPath,
        MEMSPHERE_WORKSPACE_ROOT: workspaceRoot
      }
    });
    const prompt = await buildArtifactReviewerPrompt({
      context: claimed,
      promptVersion: launch.promptVersion
    });
    const result = await runAgentReviewAcpSession({
      launch,
      prompt,
      reminder: buildArtifactReviewerReminder(),
      workspaceRoot,
      isSubmitted: async () => {
        const current = await readArtifactReviewForIdentity({
          runsRoot: config.runsRoot,
          reviewId,
          roundId,
          identityId
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
  if (message.startsWith("agent_process") || message.includes("ENOENT")) {
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
