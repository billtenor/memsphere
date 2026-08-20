import type { PromptLocale } from "./locale.js";

export type PromptInputMap = {
  "acp.artifact-review.initial": AcpArtifactReviewPromptModel;
  "acp.artifact-review.reminder": Record<string, never>;
  "acp.artifact-review.initial-v2": AcpArtifactReviewPromptModel;
  "acp.artifact-review.reminder-v2": Record<string, never>;
  "control-plane.permission-guidance": PermissionGuidancePromptModel;
  "control-plane.permission-description": PermissionDescriptionPromptModel;
  "run.current-step": RunCurrentStepPromptModel;
  "run.completed": RunCompletedPromptModel;
  "run.report-receipt": RunReportReceiptPromptModel;
  "run.review-vote-receipt": RunReviewVoteReceiptPromptModel;
  "run.review-summary": ArtifactReviewSummaryPromptModel;
  "run.schema-overview": SchemaOverviewPromptModel;
  "run.review-next-action": ReviewNextActionPromptModel;
  "run.review-configuration-required": ReviewConfigurationRequiredPromptModel;
};

export type PromptTemplateId = keyof PromptInputMap;

export type AcpArtifactReviewPromptModel = {
  rolePrompts: string[];
  contract: {
    actionInstruction: string;
    procedureAsserts: string[];
    actionAsserts: string[];
    suggestions: string[];
    details: string[];
    artifact: {
      name: string;
      type: string;
      format: string;
      schema: string;
      final: boolean;
      reviewPolicy: string;
    };
  };
  earlierArtifacts: Array<{
    stepId: string;
    artifactName: string;
  }>;
  permissions: Array<{
    id: string;
    description: string;
  }>;
};

export type PermissionGuidancePromptModel = {
  locale: PromptLocale;
  artifactScope: string;
  actorId: string;
  decision?: {
    allowed: boolean;
    permission: string;
  };
  permissions: Array<{
    id: string;
    description: string;
  }>;
};

export type PermissionDescriptionPromptModel = {
  id: string;
};

export type RunReviewVoteReceiptPromptModel = {
  vote: string;
  requiresRevision: boolean;
};

export type ArtifactReviewSummaryPromptModel = {
  reviewId: string;
  roundId: string;
  round: number;
  status: string;
  submitted: number;
  total: number;
  decisionReady: boolean;
  advisory: {
    blocking: number;
    risk: number;
    suggestion: number;
    unresolvedBlocking: number;
  };
  earlierArtifacts: number;
  repeatedAdvisories: Array<{
    severity: string;
    count: number;
    rounds: string;
    body: string;
  }>;
  participants: Array<{
    actorName: string;
    binding: string;
    vote: string;
    decisionIntent?: string;
    implementationEvidenceReferenced?: boolean;
    comments: Array<{
      severity: string;
      body: string;
    }>;
  }>;
  decision:
    | {
        kind: "awaiting_runner";
        approved: number;
        decisionTotal: number;
        advisoryTotal: number;
        advisoryRequestChanges: number;
      }
    | {
        kind: "result";
        passed: boolean;
        approved: number;
        decisionTotal: number;
        advisoryTotal: number;
      }
    | {
        kind: "failed";
        failedAssignments: number;
      }
    | {
        kind: "pending";
        remaining: number;
      };
};

export type RunCurrentStepPromptModel = {
  runId: string;
  runName: string;
  procedureName: string;
  procedureAsserts: string[];
  step:
    | {
        kind: "schema_finalization";
        artifactName: string;
        completed: number;
        total: number;
        draftPath: string;
        draftPathArgument: string;
        validation?: {
          status: string;
          issues: string[];
        };
      }
    | {
        kind: "repeat";
        instruction: string;
        min: number;
        max?: number;
        bodyFields: number;
      }
    | {
        kind: "action";
        actor: "human" | "agent";
        instruction: string;
        asserts: string[];
        suggests: string[];
        details: string[];
        artifact: {
          name: string;
          type: string;
          format: string;
        };
        next:
          | { kind: "revision" }
          | { kind: "inline_schema" }
          | { kind: "external_schema"; schemaName: string }
          | { kind: "report"; optional: boolean };
      }
    | {
        kind: "schema_current_field";
        actor: "human" | "agent";
        instruction: string;
        asserts: string[];
        suggests: string[];
        details: string[];
        schemaWriting: {
          procedureName: string;
          actionInstruction: string;
          actionAsserts: string[];
          actionSuggests: string[];
          artifactName: string;
        };
        progress: {
          field: string;
          completed: number;
          total: number;
          remaining: number;
          pendingRepeatControls: number;
          contract: {
            type: string;
            format: string;
          };
          defines: string[];
          asserts: string[];
          suggests: string[];
          draftPath?: string;
        };
        artifact: {
          name: string;
          type: string;
          format: string;
        };
        next:
          | { kind: "revision" }
          | { kind: "inline_schema" }
          | { kind: "external_schema"; schemaName: string }
          | { kind: "report"; optional: boolean };
      };
};

export type RunCompletedPromptModel = {
  runId: string;
  runName: string;
  procedureName: string;
  procedureAsserts: string[];
  finalArtifacts: Array<{ name: string; path?: string }>;
};

export type RunReportReceiptPromptModel = {
  runId: string;
  artifactName: string;
  review?: {
    reviewId: string;
    roundId: string;
    round: number;
  };
};

export type SchemaOverviewPromptModel = {
  procedureName: string;
  action: {
    instruction: string;
    asserts: string[];
    suggests: string[];
  };
  artifact: {
    name: string;
    type?: string;
    format?: string;
    schema?: string;
    final: boolean;
  };
  progress: {
    completed: number;
    total: number;
    pendingRepeatControls: number;
    fields: Array<{ path: string; status: string }>;
  };
  draft?: {
    status: string;
    filePath: string;
    validationStatus?: string;
  };
};

export type ReviewNextActionPromptModel =
  | { kind: "wait"; reviewId: string }
  | { kind: "runner_vote"; reviewId: string; roundId: string }
  | { kind: "revision"; runId: string }
  | { kind: "none" };

export type ReviewConfigurationRequiredPromptModel = {
  preflightJson: string;
};
