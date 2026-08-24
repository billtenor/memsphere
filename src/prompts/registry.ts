import { z } from "zod";
import type { PromptInputMap, PromptTemplateId } from "./models.js";

export type PromptAudience = "runner" | "acp_reviewer" | "human" | "shared";
export type PromptPurpose =
  | "instruction"
  | "receipt"
  | "summary"
  | "next_action"
  | "remediation"
  | "localized_content";

export type PromptDefinition<K extends PromptTemplateId> = {
  path: string;
  schema: z.ZodType<PromptInputMap[K]>;
  audience: PromptAudience;
  purpose: PromptPurpose;
};

const permissionSchema = z.object({
  id: z.string(),
  description: z.string()
}).strict();

const acpArtifactReviewPromptSchema = z.object({
  rolePrompts: z.array(z.string()),
  contract: z.object({
    actionInstruction: z.string(),
    procedureAsserts: z.array(z.string()),
    actionAsserts: z.array(z.string()),
    suggestions: z.array(z.string()),
    details: z.array(z.string()),
    artifact: z.object({
      name: z.string(),
      type: z.string(),
      format: z.string(),
      schema: z.string(),
      final: z.boolean(),
      reviewPolicy: z.string()
    }).strict()
  }).strict(),
  earlierArtifacts: z.array(z.object({
    stepId: z.string(),
    artifactName: z.string()
  }).strict()),
  permissions: z.array(permissionSchema)
}).strict();

const permissionGuidanceSchema = z.object({
  locale: z.enum(["zh-CN", "en"]),
  artifactScope: z.string(),
  actorId: z.string(),
  decision: z.object({
    allowed: z.boolean(),
    permission: z.string()
  }).strict().optional(),
  permissions: z.array(permissionSchema)
}).strict();

const reviewParticipantSchema = z.object({
  actorName: z.string(),
  binding: z.string(),
  vote: z.string(),
  decisionIntent: z.string().optional(),
  implementationEvidenceReferenced: z.boolean().optional(),
  comments: z.array(z.object({
    severity: z.string(),
    body: z.string()
  }).strict())
}).strict();

const reviewDecisionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("awaiting_runner"),
    approved: z.number().int().nonnegative(),
    decisionTotal: z.number().int().nonnegative(),
    advisoryTotal: z.number().int().nonnegative(),
    advisoryRequestChanges: z.number().int().nonnegative()
  }).strict(),
  z.object({
    kind: z.literal("result"),
    passed: z.boolean(),
    approved: z.number().int().nonnegative(),
    decisionTotal: z.number().int().nonnegative(),
    advisoryTotal: z.number().int().nonnegative()
  }).strict(),
  z.object({
    kind: z.literal("failed"),
    failedAssignments: z.number().int().nonnegative()
  }).strict(),
  z.object({
    kind: z.literal("pending"),
    remaining: z.number().int().nonnegative()
  }).strict()
]);

const reviewSummarySchema = z.object({
  reviewId: z.string(),
  roundId: z.string(),
  round: z.number().int().positive(),
  status: z.string(),
  submitted: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  decisionReady: z.boolean(),
  advisory: z.object({
    blocking: z.number().int().nonnegative(),
    risk: z.number().int().nonnegative(),
    suggestion: z.number().int().nonnegative(),
    unresolvedBlocking: z.number().int().nonnegative()
  }).strict(),
  earlierArtifacts: z.number().int().nonnegative(),
  repeatedAdvisories: z.array(z.object({
    severity: z.string(),
    count: z.number().int().positive(),
    rounds: z.string(),
    body: z.string()
  }).strict()),
  participants: z.array(reviewParticipantSchema),
  decision: reviewDecisionSchema
}).strict();

const reviewNextActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("wait"),
    reviewId: z.string()
  }).strict(),
  z.object({
    kind: z.literal("runner_vote"),
    reviewId: z.string(),
    roundId: z.string()
  }).strict(),
  z.object({
    kind: z.literal("revision"),
    runId: z.string()
  }).strict(),
  z.object({
    kind: z.literal("none")
  }).strict()
]);

const schemaProgressSchema = z.object({
  field: z.string(),
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  pendingRepeatControls: z.number().int().nonnegative(),
  contract: z.object({
    type: z.string(),
    format: z.string()
  }).strict(),
  defines: z.array(z.string()),
  asserts: z.array(z.string()),
  suggests: z.array(z.string()),
  draftPath: z.string().optional()
}).strict();

const currentStepContentSchema = z.object({
  actor: z.enum(["human", "agent"]),
  instruction: z.string(),
  asserts: z.array(z.string()),
  suggests: z.array(z.string()),
  details: z.array(z.string()),
  artifact: z.object({
    name: z.string(),
    type: z.string(),
    format: z.string()
  }).strict(),
  next: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("revision") }).strict(),
    z.object({ kind: z.literal("inline_schema") }).strict(),
    z.object({
      kind: z.literal("external_schema"),
      schemaName: z.string()
    }).strict(),
    z.object({
      kind: z.literal("report"),
      optional: z.boolean()
    }).strict()
  ])
});

const runCurrentStepSchema = z.object({
  runId: z.string(),
  runName: z.string(),
  procedureName: z.string(),
  memorySource: z.object({
    changeId: z.string(),
    checkpointDigest: z.string(),
    snapshot: z.boolean()
  }).strict().optional(),
  procedureAsserts: z.array(z.string()),
  step: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("schema_finalization"),
      artifactName: z.string(),
      completed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      draftPath: z.string(),
      draftPathArgument: z.string(),
      validation: z.object({
        status: z.string(),
        issues: z.array(z.string())
      }).strict().optional()
    }).strict(),
    z.object({
      kind: z.literal("repeat"),
      instruction: z.string(),
      min: z.number().int().nonnegative(),
      max: z.number().int().nonnegative().optional(),
      bodyFields: z.number().int().nonnegative()
    }).strict(),
    currentStepContentSchema.extend({
      kind: z.literal("action")
    }).strict(),
    currentStepContentSchema.extend({
      kind: z.literal("schema_current_field"),
      schemaWriting: z.object({
        procedureName: z.string(),
        actionInstruction: z.string(),
        actionAsserts: z.array(z.string()),
        actionSuggests: z.array(z.string()),
        artifactName: z.string()
      }).strict(),
      progress: schemaProgressSchema
    }).strict()
  ])
}).strict();

const runCompletedSchema = z.object({
  runId: z.string(),
  runName: z.string(),
  procedureName: z.string(),
  memorySource: z.object({
    changeId: z.string(),
    checkpointDigest: z.string()
  }).strict().optional(),
  procedureAsserts: z.array(z.string()),
  finalArtifacts: z.array(z.object({
    name: z.string(),
    path: z.string().optional()
  }).strict())
}).strict();

const runReportReceiptSchema = z.object({
  runId: z.string(),
  artifactName: z.string(),
  review: z.object({
    reviewId: z.string(),
    roundId: z.string(),
    round: z.number().int().positive()
  }).strict().optional()
}).strict();

const schemaOverviewSchema = z.object({
  procedureName: z.string(),
  action: z.object({
    instruction: z.string(),
    asserts: z.array(z.string()),
    suggests: z.array(z.string())
  }).strict(),
  artifact: z.object({
    name: z.string(),
    type: z.string().optional(),
    format: z.string().optional(),
    schema: z.string().optional(),
    final: z.boolean()
  }).strict(),
  progress: z.object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    pendingRepeatControls: z.number().int().nonnegative(),
    fields: z.array(z.object({
      path: z.string(),
      status: z.string()
    }).strict())
  }).strict(),
  draft: z.object({
    status: z.string(),
    filePath: z.string(),
    validationStatus: z.string().optional()
  }).strict().optional()
}).strict();

const definitions = {
  "acp.artifact-review.initial": {
    path: "acp-review/initial.hbs",
    audience: "acp_reviewer",
    purpose: "instruction",
    schema: acpArtifactReviewPromptSchema
  },
  "acp.artifact-review.reminder": {
    path: "acp-review/reminder.hbs",
    audience: "acp_reviewer",
    purpose: "next_action",
    schema: z.object({}).strict()
  },
  "acp.artifact-review.initial-v2": {
    path: "acp-review-v2/initial.hbs",
    audience: "acp_reviewer",
    purpose: "instruction",
    schema: acpArtifactReviewPromptSchema
  },
  "acp.artifact-review.reminder-v2": {
    path: "acp-review-v2/reminder.hbs",
    audience: "acp_reviewer",
    purpose: "next_action",
    schema: z.object({}).strict()
  },
  "control-plane.permission-guidance": {
    path: "control-plane/partials/permission-guidance.hbs",
    audience: "shared",
    purpose: "instruction",
    schema: permissionGuidanceSchema
  },
  "control-plane.permission-description": {
    path: "control-plane/permission-description.hbs",
    audience: "shared",
    purpose: "localized_content",
    schema: z.object({
      id: z.string()
    }).strict()
  },
  "run.current-step": {
    path: "run/current-step.hbs",
    audience: "runner",
    purpose: "instruction",
    schema: runCurrentStepSchema
  },
  "run.completed": {
    path: "run/completed.hbs",
    audience: "runner",
    purpose: "summary",
    schema: runCompletedSchema
  },
  "run.report-receipt": {
    path: "run/report-receipt.hbs",
    audience: "runner",
    purpose: "receipt",
    schema: runReportReceiptSchema
  },
  "run.review-vote-receipt": {
    path: "run/review-vote-receipt.hbs",
    audience: "runner",
    purpose: "receipt",
    schema: z.object({
      vote: z.string(),
      requiresRevision: z.boolean()
    }).strict()
  },
  "run.review-summary": {
    path: "run/review-summary.hbs",
    audience: "runner",
    purpose: "summary",
    schema: reviewSummarySchema
  },
  "run.schema-overview": {
    path: "run/schema-overview.hbs",
    audience: "runner",
    purpose: "summary",
    schema: schemaOverviewSchema
  },
  "run.review-next-action": {
    path: "run/review-next-action.hbs",
    audience: "runner",
    purpose: "next_action",
    schema: reviewNextActionSchema
  },
  "run.review-configuration-required": {
    path: "run/review-configuration-required.hbs",
    audience: "human",
    purpose: "remediation",
    schema: z.object({
      preflightJson: z.string()
    }).strict()
  }
} satisfies { [K in PromptTemplateId]: PromptDefinition<K> };

export function promptDefinition<K extends PromptTemplateId>(id: K): PromptDefinition<K> {
  return definitions[id] as unknown as PromptDefinition<K>;
}

export function listPromptTemplateIds(): PromptTemplateId[] {
  return Object.keys(definitions) as PromptTemplateId[];
}
