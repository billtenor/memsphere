import type { ArtifactReview, ArtifactReviewRound } from "../artifact-review.js";
import {
  currentArtifactReview,
  type RunState,
  type SchemaWritingSnapshot
} from "../run/store.js";
import type { PromptLocale } from "./locale.js";
import type { PromptInputMap, PromptTemplateId } from "./models.js";
import { promptDefinition, type PromptPurpose } from "./registry.js";
import { renderPrompt } from "./renderer.js";
import {
  buildArtifactReviewNextActionPromptModel,
  buildArtifactReviewSummaryPromptModel,
  buildRunReviewVoteReceiptPromptModel
} from "./review.js";
import {
  buildRunCompletedPromptModel,
  buildRunCurrentStepPromptModel,
  buildRunReportReceiptPromptModel,
  buildSchemaOverviewPromptModel
} from "./run.js";

type PromptInvocation<K extends PromptTemplateId = PromptTemplateId> = {
  [P in K]: { id: P; input: PromptInputMap[P] }
}[K];

export type RunOutputScene =
  | { kind: "start"; run: RunState; runsRoot?: string }
  | { kind: "status"; run: RunState; runsRoot?: string }
  | { kind: "report"; run: RunState; runsRoot?: string }
  | {
      kind: "review";
      run: RunState;
      review: ArtifactReview<RunState["events"][number]["artifact"]>;
      round: ArtifactReviewRound;
      runsRoot?: string;
    }
  | {
      kind: "review_vote";
      run: RunState;
      review: ArtifactReview<RunState["events"][number]["artifact"]>;
      round: ArtifactReviewRound;
      vote: "approve" | "request_changes";
      runsRoot?: string;
    }
  | {
      kind: "enter_schema";
      run: RunState;
      snapshot: SchemaWritingSnapshot;
      runsRoot?: string;
    }
  | { kind: "repeat"; run: RunState; runsRoot?: string }
  | { kind: "skip"; run: RunState; runsRoot?: string };

const allowedPurposeSequences: Record<RunOutputScene["kind"], readonly (readonly PromptPurpose[])[]> = {
  start: [["instruction"], ["summary"]],
  status: [["instruction"], ["summary"]],
  report: [
    ["receipt", "instruction"],
    ["receipt", "summary"],
    ["receipt", "next_action"]
  ],
  review: [
    ["summary", "instruction"],
    ["summary", "summary"],
    ["summary", "next_action"]
  ],
  review_vote: [
    ["receipt", "instruction"],
    ["receipt", "summary"],
    ["receipt", "next_action"]
  ],
  enter_schema: [
    ["instruction"],
    ["summary", "instruction"],
    ["summary", "summary"]
  ],
  repeat: [["instruction"], ["summary"]],
  skip: [["instruction"], ["summary"]]
};

export function renderRunOutput(scene: RunOutputScene, locale: PromptLocale): string {
  const invocations = buildInvocations(scene, locale);
  assertValidSequence(scene.kind, invocations);
  return invocations
    .map((item) => renderPrompt(item.id, locale, item.input as never))
    .join("\n\n");
}

export function runOutputPromptIds(scene: RunOutputScene, locale: PromptLocale): PromptTemplateId[] {
  const invocations = buildInvocations(scene, locale);
  assertValidSequence(scene.kind, invocations);
  return invocations.map((item) => item.id);
}

function buildInvocations(scene: RunOutputScene, locale: PromptLocale): PromptInvocation[] {
  if (scene.kind === "report") {
    const receipt = invocation("run.report-receipt", buildRunReportReceiptPromptModel(scene.run));
    const review = currentArtifactReview(scene.run);
    if (review?.status === "pending" || review?.status === "awaiting_runner_vote") {
      const round = requireCurrentRound(review);
      return [
        receipt,
        invocation(
          "run.review-next-action",
          buildArtifactReviewNextActionPromptModel(review, round, scene.run.id)
        )
      ];
    }
    return [receipt, currentStateInvocation(scene.run, locale, scene.runsRoot)];
  }

  if (scene.kind === "review") {
    const summary = invocation(
      "run.review-summary",
      buildArtifactReviewSummaryPromptModel(scene.review, scene.round, locale)
    );
    if (scene.review.status === "passed") {
      return [summary, currentStateInvocation(scene.run, locale, scene.runsRoot)];
    }
    return [
      summary,
      invocation(
        "run.review-next-action",
        buildArtifactReviewNextActionPromptModel(scene.review, scene.round, scene.run.id)
      )
    ];
  }

  if (scene.kind === "review_vote") {
    const receipt = invocation(
      "run.review-vote-receipt",
      buildRunReviewVoteReceiptPromptModel(scene.vote, locale)
    );
    if (scene.review.status === "passed") {
      return [receipt, currentStateInvocation(scene.run, locale, scene.runsRoot)];
    }
    return [
      receipt,
      invocation(
        "run.review-next-action",
        buildArtifactReviewNextActionPromptModel(scene.review, scene.round, scene.run.id)
      )
    ];
  }

  if (scene.kind === "enter_schema") {
    return [
      invocation("run.schema-overview", buildSchemaOverviewPromptModel(scene.snapshot)),
      currentStateInvocation(scene.run, locale, scene.runsRoot)
    ];
  }

  return [currentStateInvocation(scene.run, locale, scene.runsRoot)];
}

function currentStateInvocation(
  run: RunState,
  locale: PromptLocale,
  runsRoot?: string
): PromptInvocation<"run.current-step" | "run.completed" | "run.review-summary"> {
  const completed = buildRunCompletedPromptModel(run);
  if (completed) return invocation("run.completed", completed);

  const review = currentArtifactReview(run);
  if (review?.status === "pending" || review?.status === "awaiting_runner_vote") {
    return invocation(
      "run.review-summary",
      buildArtifactReviewSummaryPromptModel(review, requireCurrentRound(review), locale)
    );
  }

  const currentStep = buildRunCurrentStepPromptModel(run, locale, runsRoot);
  if (!currentStep) throw new Error(`Run has no renderable current state: ${run.id}`);
  return invocation("run.current-step", currentStep);
}

function invocation<K extends PromptTemplateId>(id: K, input: PromptInputMap[K]): PromptInvocation<K> {
  return { id, input } as PromptInvocation<K>;
}

function assertValidSequence(kind: RunOutputScene["kind"], invocations: PromptInvocation[]): void {
  const definitions = invocations.map((item) => promptDefinition(item.id));
  const invalidAudience = definitions.find((definition) => definition.audience !== "runner");
  if (invalidAudience) throw new Error(`Run output ${kind} contains a non-runner Prompt`);
  const actual = definitions.map((definition) => definition.purpose);
  const valid = allowedPurposeSequences[kind].some(
    (allowed) => allowed.length === actual.length && allowed.every((purpose, index) => purpose === actual[index])
  );
  if (!valid) throw new Error(`Invalid Run Prompt sequence for ${kind}: ${actual.join(" -> ")}`);
}

function requireCurrentRound(
  review: ArtifactReview<RunState["events"][number]["artifact"]>
): ArtifactReviewRound {
  const round = review.rounds.find((candidate) => candidate.id === review.currentRoundId);
  if (!round) throw new Error(`Artifact Review Round not found: ${review.currentRoundId}`);
  return round;
}
