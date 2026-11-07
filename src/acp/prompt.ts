import { reviewerCommand } from "./reviewer-invocation.js";
import { reviewerCapabilities } from "./reviewer-commands.js";
import { reviewNodeView } from "../review-nodes.js";
import { reviewNodePromptModel } from "../prompts/review-nodes.js";
import type { ArtifactReviewAgentContext } from "../run/store.js";
import { activeProcedureAssertTrees, currentStep, renderEffectiveRuleTree } from "../run/store.js";
import { renderPrompt, type PromptLocale } from "../prompts/index.js";
import {
  buildAgentReviewContract,
  formatArtifactFormat,
  summarizeAgentReviewSchema
} from "./review-contract.js";

export async function buildArtifactReviewerPrompt(input: {
  context: ArtifactReviewAgentContext;
  promptVersion: string;
  locale?: PromptLocale;
}): Promise<string> {
  if (!["artifact-review-v1", "artifact-review-v2", "artifact-review-v3"].includes(input.promptVersion)) {
    throw new Error(`agent_prompt_version_unsupported: ${input.promptVersion}`);
  }
  const { run, review, round, assignment } = input.context;
  const submission = review.submissions.find((candidate) => candidate.id === round.submissionId);
  if (!submission) throw new Error(`Artifact Review Submission not found: ${round.submissionId}`);
  const contract = buildAgentReviewContract(input.context);
  const step = currentStep(run);
  if (!step || step.id !== review.stepId) {
    throw new Error(`Artifact Review current Step is unavailable: ${review.stepId}`);
  }
  const systemPrompt = run.controlPlane?.actors[assignment.actorId]?.systemPrompt;
  const rolePrompts = systemPrompt ? [systemPrompt] : [];
  const locale = input.locale ?? "zh-CN";
  const permissions = assignment.permissions.map((permission) => {
    const definition = run.controlPlane?.permissionCatalog.definitions.find((candidate) => candidate.id === permission);
    return {
      id: permission,
      description: definition?.descriptions[locale]
        ?? definition?.descriptions.en
        ?? (locale === "zh-CN" ? "本次产物评审已授予此权限。" : "Permission granted for this Artifact Review.")
    };
  });
  if (assignment.nodeTree) {
    const capabilities = reviewerCapabilities(review.id.startsWith("graph-review-") ? "graph" : "flow");
    const materials = {
      allowedOperations: capabilities.commands,
      capabilities,
      artifact: { ...contract.artifact, schema: summarizeAgentReviewSchema(currentStep(run)?.schema) },
      inputs: submission.contextArtifacts.map(a => ({ stepId: a.stepId, artifactId: a.artifactId, name: a.artifact.name, readCommand: capabilities.protocol === "graph" && a.artifactId ? reviewerCommand(`run artifact show --run ${run.id} --artifact ${a.artifactId} --out ${a.artifactId}.txt`) : reviewerCommand(`run artifact show --step ${JSON.stringify(a.stepId)} --out context-${submission.contextArtifacts.indexOf(a)}.txt`) })),
      externals: submission.contextExternals?.map(e => ({ ...e, readCommand: reviewerCommand(`run external show --run ${run.id} --external ${e.externalId} --out ${e.externalId}.txt`) })),
      memorySource: run.memorySource,
      memoryReads: {
        project: reviewerCommand("memory list --output json"),
        frozen: (run.memorySnapshot || run.frozenMemoryRunId) ? reviewerCommand(`memory list --run ${run.id} --output json`) : undefined
      },
      commands: {
        assignment: reviewerCommand("run review assignment show --assignment ") + assignment.id,
        artifact: reviewerCommand("run artifact show --assignment ") + assignment.id,
        contract: reviewerCommand("run artifact contract show --assignment ") + assignment.id
      }
    };
    return renderPrompt("acp.review-v3.initial", locale, reviewNodePromptModel(
      reviewNodeView(assignment, assignment.draft.comments, { status: assignment.status }),
      rolePrompts, JSON.stringify(materials, null, 2), permissions
    ));
  }
  const promptId = input.promptVersion === "artifact-review-v1"
    ? "acp.artifact-review.initial"
    : "acp.artifact-review.initial-v2";
  return renderPrompt(promptId, locale, {
    rolePrompts,
    contract: {
      actionInstruction: contract.action.instruction,
      procedureAsserts: activeProcedureAssertTrees(run).flatMap((tree) => renderEffectiveRuleTree(tree, locale)),
      actionAsserts: renderEffectiveRuleTree(step.assertTree, locale),
      suggestions: renderEffectiveRuleTree(step.suggestTree, locale),
      details: contract.action.details,
      artifact: {
        name: contract.artifact.name,
        type: contract.artifact.type ?? (locale === "zh-CN" ? "未指定" : "unspecified"),
        format: formatArtifactFormat(contract.artifact.format),
        schema: summarizeAgentReviewSchema(step.schema),
        modelTarget: contract.artifact.modelTarget,
        final: contract.artifact.final,
        reviewPolicy: contract.artifact.review ?? (locale === "zh-CN" ? "无" : "none")
      }
    },
    earlierArtifacts: submission.contextArtifacts.map((item) => ({
      stepId: item.stepId,
      artifactName: item.artifact.name
    })),
    permissions
  });
}

export function buildArtifactReviewerReminder(
  locale: PromptLocale = "zh-CN",
  promptVersion = "artifact-review-v2"
): string {
  if (promptVersion === "artifact-review-v3") return renderPrompt("acp.review-v3.reminder", locale, reviewNodePromptModel({}));
  return renderPrompt(
    promptVersion === "artifact-review-v1"
      ? "acp.artifact-review.reminder"
      : "acp.artifact-review.reminder-v2",
    locale,
    {}
  );
}
