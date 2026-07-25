import { z } from "zod";
import type { PromptInputMap, PromptTemplateId } from "./models.js";

type PromptDefinition<K extends PromptTemplateId> = {
  path: string;
  schema: z.ZodType<PromptInputMap[K]>;
};

const permissionSchema = z.object({
  id: z.string(),
  description: z.string()
}).strict();

const permissionGuidanceSchema = z.object({
  locale: z.enum(["zh-CN", "en"]),
  artifactScope: z.string(),
  actorId: z.string(),
  authoritySource: z.string(),
  decision: z.object({
    allowed: z.boolean(),
    permission: z.string()
  }).strict().optional(),
  permissions: z.array(permissionSchema)
}).strict();

const reviewParticipantSchema = z.object({
  actorName: z.string(),
  binding: z.string(),
  agent: z.boolean(),
  vote: z.string(),
  status: z.string().optional(),
  attempt: z.number().int().nonnegative().optional(),
  provider: z.string().optional(),
  failure: z.string().optional(),
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
    advisoryTotal: z.number().int().nonnegative()
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
  failures: z.object({
    environment: z.number().int().nonnegative(),
    provider: z.number().int().nonnegative(),
    reviewer: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative()
  }).strict(),
  earlierArtifacts: z.number().int().nonnegative(),
  repeatedAdvisories: z.array(z.object({
    severity: z.string(),
    count: z.number().int().positive(),
    rounds: z.string(),
    body: z.string()
  }).strict()),
  participants: z.array(reviewParticipantSchema),
  runner: z.object({
    automatic: z.boolean(),
    vote: z.string(),
    comment: z.string().optional()
  }).strict().optional(),
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
    kind: z.literal("retry"),
    reviewId: z.string(),
    assignmentId: z.string()
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
  sources: z.array(z.object({
    path: z.string(),
    type: z.string(),
    format: z.string(),
    defines: z.array(z.string()),
    asserts: z.array(z.string())
  }).strict()),
  draftPath: z.string().optional()
}).strict();

const runStateSchema = z.object({
  runId: z.string(),
  procedureAsserts: z.array(z.string()),
  state: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("done"),
      finalArtifacts: z.array(z.object({
        name: z.string(),
        path: z.string().optional()
      }).strict())
    }).strict(),
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
    z.object({
      kind: z.literal("review"),
      review: reviewSummarySchema,
      next: reviewNextActionSchema
    }).strict(),
    z.object({
      kind: z.literal("action"),
      actor: z.enum(["human", "agent"]),
      instruction: z.string(),
      asserts: z.array(z.string()),
      suggests: z.array(z.string()),
      details: z.array(z.string()),
      schemaProgress: schemaProgressSchema.optional(),
      artifact: z.object({
        name: z.string(),
        type: z.string(),
        format: z.string()
      }).strict(),
      controlPlane: z.object({
        revision: z.string(),
        permissionCatalogVersion: z.string(),
        decisionPolicyCatalogVersion: z.string(),
        bindings: z.array(z.object({
          slotId: z.string(),
          actors: z.string(),
          source: z.string()
        }).strict()),
        runnerPermissions: z.array(z.string()),
        guidance: permissionGuidanceSchema
      }).strict().optional(),
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
    }).strict()
  ])
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

const reportAuthorizationSchema = z.object({
  permission: z.string(),
  actorId: z.string(),
  artifactScope: z.string(),
  revision: z.string(),
  guidance: permissionGuidanceSchema.optional()
}).strict();

const definitions = {
  "acp.artifact-review.initial": {
    path: "acp-review/initial.hbs",
    schema: z.object({
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
    }).strict()
  },
  "acp.artifact-review.reminder": {
    path: "acp-review/reminder.hbs",
    schema: z.object({}).strict()
  },
  "control-plane.permission-guidance": {
    path: "control-plane/partials/permission-guidance.hbs",
    schema: permissionGuidanceSchema
  },
  "control-plane.permission-description": {
    path: "control-plane/permission-description.hbs",
    schema: z.object({
      id: z.string()
    }).strict()
  },
  "run.review-summary": {
    path: "run/partials/review-summary.hbs",
    schema: reviewSummarySchema
  },
  "run.state": {
    path: "run/state.hbs",
    schema: runStateSchema
  },
  "run.schema-overview": {
    path: "run/schema-overview.hbs",
    schema: schemaOverviewSchema
  },
  "run.report-authorization": {
    path: "run/report-authorization.hbs",
    schema: reportAuthorizationSchema
  },
  "run.review-next-action": {
    path: "run/partials/review-next-action.hbs",
    schema: reviewNextActionSchema
  },
  "run.review-configuration-required": {
    path: "run/review-configuration-required.hbs",
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
