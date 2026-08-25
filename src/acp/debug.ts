import { mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { artifactReviewAssignmentId, type ArtifactReview, type ArtifactReviewRound } from "../artifact-review.js";
import type { MemsphereConfig } from "../config.js";
import { resolveWorkspaceIdentity } from "../project/workspace.js";
import type { ArtifactReviewAgentContext, RunState } from "../run/store.js";
import { agentReviewCliSource, currentCliRuntimeDescriptor } from "./cli-runtime.js";
import { buildArtifactReviewerPrompt } from "./prompt.js";
import { getAgentReviewProvider } from "./provider.js";
import { resolvePromptLocale } from "../prompts/index.js";

export type AgentReviewTryRunArtifact = {
  assignmentId: string;
  directory: string;
  promptPath: string;
  launchPath: string;
};

export async function tryRunArtifactReviewAgents(input: {
  config: MemsphereConfig;
  run: RunState;
}): Promise<AgentReviewTryRunArtifact[]> {
  if (!input.config.debug.agentReview) {
    throw new Error("run try-run requires debug.agent_review=true so background Agent dispatch remains disabled");
  }
  const generated: AgentReviewTryRunArtifact[] = [];
  for (const review of input.run.artifactReviews ?? []) {
    if (review.status !== "pending") continue;
    const round = review.rounds.find((candidate) => candidate.id === review.currentRoundId);
    if (!round || round.status !== "pending") continue;
    generated.push(...await writeAgentReviewDebugArtifacts({ config: input.config, run: input.run, review, round }));
  }
  return generated;
}

export async function writeAgentReviewDebugArtifacts(input: {
  config: MemsphereConfig;
  run: RunState;
  review: ArtifactReview<RunState["events"][number]["artifact"]>;
  round: ArtifactReviewRound;
}): Promise<AgentReviewTryRunArtifact[]> {
  const runtime = currentCliRuntimeDescriptor();
  const cliSource = agentReviewCliSource(runtime);
  const workspaceRoot = (await resolveWorkspaceIdentity()).path;
  const generated: AgentReviewTryRunArtifact[] = [];
  for (const assignment of input.round.assignments) {
    if ((assignment.actorKind ?? "human") !== "agent" || assignment.status !== "queued") continue;
    const actor = input.run.controlPlane?.actors[assignment.actorId];
    if (!actor || actor.kind !== "agent") throw new Error(`agent_actor_missing: ${assignment.actorId}`);
    const attempt = assignment.attempts?.at(-1);
    if (!attempt) throw new Error(`agent_attempt_missing: ${assignment.actorId}`);
    const assignmentId = artifactReviewAssignmentId(assignment);
    const sessionEnv = {
      MEMSPHERE_REVIEW_RUN_ID: input.run.id,
      ...(input.run.memorySnapshot ? { MEMSPHERE_REVIEW_MEMORY_RUN_ID: input.run.id } : {}),
      MEMSPHERE_REVIEW_ASSIGNMENT_ID: assignmentId,
      MEMSPHERE_CONFIG_PATH: input.config.configPath,
      MEMSPHERE_WORKSPACE_ROOT: workspaceRoot,
      MEMSPHERE_CLI: "<runtime-generated-session-cli>",
      PATH: ["<runtime-generated-session-directory>", process.env.PATH].filter(Boolean).join(delimiter)
    };
    const provider = getAgentReviewProvider(actor.agent.providerType);
    const launch = provider.buildLaunch({ actor, workspaceRoot, sessionEnv });
    const context: ArtifactReviewAgentContext = {
      run: input.run,
      review: input.review,
      round: input.round,
      assignment,
      attempt
    };
    const prompt = await buildArtifactReviewerPrompt({
      context,
      promptVersion: attempt.promptVersion ?? launch.promptVersion,
      locale: resolvePromptLocale(input.run.language)
    });
    const directory = join(
      input.config.debug.root,
      "agent-review",
      input.review.id,
      input.round.id,
      assignmentId
    );
    await mkdir(directory, { recursive: true });
    const launchPath = join(directory, "launch.json");
    const promptPath = join(directory, "prompt.md");
    await writeFile(launchPath, `${JSON.stringify({
      debug: true,
      processStarted: false,
      runId: input.run.id,
      reviewId: input.review.id,
      roundId: input.round.id,
      assignmentId,
      actorId: assignment.actorId,
      actorName: assignment.actorName,
      slots: assignment.slotIds,
      binding: assignment.binding,
      provider: launch.provider,
      command: launch.command,
      args: launch.args,
      cwd: launch.cwd,
      env: redactEnvironment(launch.env),
      startupTimeoutMs: launch.startupTimeoutMs,
      idleTimeoutMs: launch.idleTimeoutMs,
      maxRuntimeMs: launch.maxRuntimeMs,
      promptVersion: attempt.promptVersion ?? launch.promptVersion,
      model: launch.model,
      cliSource,
      promptFile: "prompt.md"
    }, null, 2)}\n`, "utf8");
    await writeFile(promptPath, `${prompt}\n`, "utf8");
    generated.push({ assignmentId, directory, promptPath, launchPath });
  }
  return generated;
}

function redactEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).flatMap(([name, value]) => {
    if (value === undefined) return [];
    if (/capability|token|secret|password|cookie|authorization|api[_-]?key/i.test(name)) {
      return [[name, "<redacted>"]];
    }
    if (/proxy/i.test(name)) return [[name, redactUrlCredentials(value)]];
    return [[name, value]];
  }));
}

function redactUrlCredentials(value: string): string {
  try {
    const url = new URL(value);
    if (url.username) url.username = "<redacted>";
    if (url.password) url.password = "<redacted>";
    return url.toString();
  } catch {
    return value;
  }
}
