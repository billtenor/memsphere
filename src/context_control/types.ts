import type { GraphArtifactSpec, GraphProcedureMemory } from "../memory/ast.js";
import type { ControlPlaneActor, DecisionPolicyDefinitionSnapshot, PermissionId, RunReviewConfiguration } from "../control-plane/index.js";
import type { EffectiveRuleTree } from "../memory/rules.js";
import type { AppOwnership } from "../app/ownership.js";

export type Ref = { kind: "artifact" | "external"; id: string };
export type Content = { model: { definedBy: string; definition: string }; payload: { contentType: string; content: string } };
export type ContentRef = { storeId: string; dataId: string; sha256: string };
export type Body = { content?: Content; contentRef?: ContentRef };
export type Run = {
  id: string; name: string; status: "running" | "done" | "abandoned"; createdAt: string; language: "zh-CN" | "en";
  outputOverrides?: { addedArtifactIds: string[]; removedArtifactIds: string[] }; endedAt?: string; archived?: boolean;
  abandonment?: { source: "cli" | "view"; reason?: string };
  memoryRef?: string;
  memorySnapshot?: { memories: Record<string, { memoryRef: string; payload: { contentType: string; content: string }; app?: AppOwnership[string] }> };
  memorySource?: { kind: "changeset"; project: string; changeId: string; checkpointDigest: string; baseRevision: string };
  permissionConfig?: {
    revision: string; permissionDescriptions: Record<string, { id: string; description: string }>;
    decisionPolicies: Record<string, Omit<DecisionPolicyDefinitionSnapshot, "version">>;
    runner: { permissions: PermissionId[] }; actors: Record<string, ControlPlaneActor>;
  };
  reviewConfig?: { reviewPolicies: RunReviewConfiguration["reviews"]; reviewBindings: RunReviewConfiguration["slots"] };
  frames?: Array<{ id: string; type: "graph"; graphFrame: GraphFrame }>;
};
export type StepResult = { mode: "produce"; id: string } | { mode: "collect"; items: Record<string, string[]> };
export type Step = {
  id: string; runId: string; createdAt: string; status: "pending" | "running" | "awaiting_review" | "done" | "failed" | "cancelled";
  startedAt?: string; endedAt?: string; completionSequence?: number;
  source?: { memoryRef: string; actionId: string };
  inputs?: Record<string, Ref[]>; artifact?: StepResult;
  reviewRounds?: ReviewRound[];
  validation?: { sha256: string; artifactId?: string; checkedAt: string; status: "passed" | "failed"; issues: Array<{ message: string; path?: string }> };
  frames?: Array<{ id: string; type: "submission"; submissionFrame: SubmissionFrame }>;
  reads?: Record<string, { readAt: string }>;
};
export type Artifact = Body & { id: string; stepId: string; name: string; status: "draft" | "submitted"; tags: string[]; dependencies: Ref[]; revisedFrom?: string; revisedSummary?: string };
export type External = Body & { id: string; runId: string; source: string; capturedAt: string };
export type ReviewComment = { id: string; body: string; createdAt: string; severity?: "blocking" | "risk" | "suggestion"; anchor?: { targetRef?: Ref; location: string; context?: string } };
export type Review = {
  id: string; roundId?: string; artifactId: string;
  reviewer: { role: "reviewer" | "runner"; source?: "human" | "agent"; actorId?: string };
  status: "pending" | "running" | "submitted" | "cancelled";
  comments: ReviewComment[]; vote?: { value: "approve" | "request_changes" | "abstain"; summary?: string; delegationNote?: string };
  attempts?: ReviewAttempt[]; createdAt: string; startedAt?: string; endedAt?: string;
};
export type ReviewAttempt = {
  id: string; createdAt: string; startedAt?: string; workerPid?: number; cliReadyAt?: string; promptVersion?: string;
  session?: { provider?: string; id?: string; protocolVersion?: number; agentName?: string; agentVersion?: string; model?: string };
  completion?: { at: string; kind: "completed" | "failed" | "cancelled"; stopReason?: string; failure?: { stage: string; code: string; message: string; category?: string } };
};
export type ReviewRound = {
  id: string; artifactId: string; createdAt: string;
  reviewConfig: {
    policy: Omit<DecisionPolicyDefinitionSnapshot, "version">;
    bindings: Record<string, { actorIds: string[]; skipped?: boolean }>;
    reviewers: Record<string, { id: string; kind: "human" | "agent"; name: string; permissions: PermissionId[] }>;
    runner: { permissions: PermissionId[] };
  };
  resolutionSummary?: string;
  resolutions?: Array<{ reviewId: string; commentId: string; value: import("../artifact-review.js").ArtifactReviewDispositionValue; note: string; validationSummary?: string; updatedAt: string }>;
};
export type Arrival = { kind: "artifact"; id: string } | { kind: "collect"; items: Record<string, string[]> } | { kind: "start" };
export type GraphTrigger = { id: string; actionId: string; dependencyIndex: number; stepId?: string; inputs?: Record<string, Ref[]> };
export type GraphJoin = { actionId: string; dependencyIndex: number; arrivals: Record<string, Arrival> };
export type GraphFrame = {
  memoryRef: string; triggers: GraphTrigger[]; pendingSteps: Step[]; joins: GraphJoin[];
  processedStepIds: string[]; nextCompletionSequence: number;
};
export type SubmissionFrame = { artifact: Artifact; nextStatus: "awaiting_review" | "done"; round?: ReviewRound; completionSequence?: number; endedAt?: string };
export type GraphContract = { procedure: GraphProcedureMemory; artifactSpecs: Record<string, GraphArtifactSpec>; rules: Record<string, { asserts: EffectiveRuleTree; suggests: EffectiveRuleTree }> };
export type Snapshot = { run: Run; steps: Step[]; artifacts: Artifact[]; externals: External[]; reviews: Review[]; completeIds: string[]; outputArtifactIds: string[] };
export type ReportInput = Body & { target?: string; name?: string; revisedFrom?: string; revisedSummary?: string; tags?: string[]; dependencies?: Ref[]; dependsOn?: string[] };
export const textContent = (content: string, contentType = "text/plain"): Content => ({ model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType, content } });
