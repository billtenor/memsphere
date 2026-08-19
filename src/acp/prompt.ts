import type { ArtifactReviewAgentContext } from "../run/store.js";
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
  if (!["artifact-review-v1", "artifact-review-v2"].includes(input.promptVersion)) {
    throw new Error(`agent_prompt_version_unsupported: ${input.promptVersion}`);
  }
  const { run, review, round, assignment } = input.context;
  const submission = review.submissions.find((candidate) => candidate.id === round.submissionId);
  if (!submission) throw new Error(`Artifact Review Submission not found: ${round.submissionId}`);
  const contract = buildAgentReviewContract(input.context);
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
  const promptId = input.promptVersion === "artifact-review-v1"
    ? "acp.artifact-review.initial"
    : "acp.artifact-review.initial-v2";
  return renderPrompt(promptId, locale, {
    rolePrompts,
    contract: {
      actionInstruction: contract.action.instruction,
      procedureAsserts: contract.procedure.asserts,
      actionAsserts: contract.action.asserts,
      suggestions: contract.action.suggests,
      details: contract.action.details,
      artifact: {
        name: contract.artifact.name,
        type: contract.artifact.type ?? (locale === "zh-CN" ? "未指定" : "unspecified"),
        format: formatArtifactFormat(contract.artifact.format),
        schema: summarizeAgentReviewSchema(contract.artifact.schema),
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
  return renderPrompt(
    promptVersion === "artifact-review-v1"
      ? "acp.artifact-review.reminder"
      : "acp.artifact-review.reminder-v2",
    locale,
    {}
  );
}
