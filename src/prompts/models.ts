import type { PromptLocale } from "./locale.js";

export type PromptInputMap = {
  "acp.artifact-review.initial": AcpArtifactReviewPromptModel;
  "acp.artifact-review.reminder": Record<string, never>;
  "control-plane.permission-guidance": PermissionGuidancePromptModel;
  "control-plane.permission-description": PermissionDescriptionPromptModel;
  "run.review-summary": ArtifactReviewSummaryPromptModel;
  "run.state": RunStatePromptModel;
  "run.schema-overview": SchemaOverviewPromptModel;
  "run.report-authorization": ReportAuthorizationPromptModel;
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
  authoritySource: string;
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
  failures: {
    environment: number;
    provider: number;
    reviewer: number;
    unknown: number;
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
    agent: boolean;
    vote: string;
    status?: string;
    attempt?: number;
    provider?: string;
    failure?: string;
    decisionIntent?: string;
    implementationEvidenceReferenced?: boolean;
    comments: Array<{
      severity: string;
      body: string;
    }>;
  }>;
  runner?: {
    automatic: boolean;
    vote: string;
    comment?: string;
  };
  decision:
    | {
        kind: "awaiting_runner";
        approved: number;
        decisionTotal: number;
        advisoryTotal: number;
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

export type RunStatePromptModel = {
  runId: string;
  procedureAsserts: string[];
  state:
    | {
        kind: "done";
        finalArtifacts: Array<{ name: string; path?: string }>;
      }
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
        kind: "review";
        review: ArtifactReviewSummaryPromptModel;
        next: ReviewNextActionPromptModel;
      }
    | {
        kind: "action";
        actor: "human" | "agent";
        instruction: string;
        asserts: string[];
        suggests: string[];
        details: string[];
        schemaProgress?: {
          field: string;
          completed: number;
          total: number;
          remaining: number;
          pendingRepeatControls: number;
          sources: Array<{
            path: string;
            type: string;
            format: string;
            defines: string[];
            asserts: string[];
          }>;
          draftPath?: string;
        };
        artifact: {
          name: string;
          type: string;
          format: string;
        };
        controlPlane?: {
          revision: string;
          permissionCatalogVersion: string;
          decisionPolicyCatalogVersion: string;
          bindings: Array<{
            slotId: string;
            actors: string;
            source: string;
          }>;
          runnerPermissions: string[];
          guidance: PermissionGuidancePromptModel;
        };
        next:
          | { kind: "revision" }
          | { kind: "inline_schema" }
          | { kind: "external_schema"; schemaName: string }
          | { kind: "report"; optional: boolean };
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

export type ReportAuthorizationPromptModel = {
  permission: string;
  actorId: string;
  artifactScope: string;
  revision: string;
  guidance?: PermissionGuidancePromptModel;
};

export type ReviewNextActionPromptModel =
  | { kind: "wait"; reviewId: string }
  | { kind: "runner_vote"; reviewId: string; roundId: string }
  | { kind: "revision"; runId: string }
  | { kind: "retry"; reviewId: string; assignmentId: string }
  | { kind: "none" };

export type ReviewConfigurationRequiredPromptModel = {
  preflightJson: string;
};
