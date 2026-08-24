import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve } from "node:path";
import { z } from "zod";
import {
  artifactReviewDispositionValues,
  artifactReviewSeverityValues,
  artifactReviewVoteValues,
  authorizeArtifactReviewActor,
  createArtifactReviewAssignments,
  evaluateArtifactReviewRound,
  makeReviewEntityId,
  submittedAssignmentVote,
  type ArtifactReview,
  type ArtifactReviewAgentAttempt,
  type ArtifactReviewAgentFailure,
  type ArtifactReviewAnchor,
  type ArtifactReviewAgentAnchorInput,
  type ArtifactReviewAssignment,
  type ArtifactReviewComment,
  type ArtifactReviewDispositionValue,
  type ArtifactReviewRound,
  type ArtifactReviewSubmission,
  type ArtifactReviewVoteValue
} from "../artifact-review.js";
import {
  ArtifactValidationFailure,
  type ArtifactReportSource,
  type ArtifactValidationPlan,
  type ArtifactValidatorRegistration,
  type ArtifactValidationResult,
  type CompiledArtifactContract,
  type PreparedArtifactCandidate,
  compileArtifactContract,
  createBuiltInArtifactValidatorRegistry,
  prepareArtifactCandidate
} from "../artifact-validation.js";
import {
  authorizeArtifactOperation,
  controlPlaneSnapshotSchema,
  createControlPlaneSnapshot,
  permissionIds,
  renderPermissionGuidance,
  resolveArtifactControlPlane,
  type ArtifactControlPlane,
  type AuthorizationDecision,
  type ControlPlaneConfig,
  type ControlPlaneSnapshot,
  type RunReviewConfiguration,
  type SlotBindings
} from "../control-plane/index.js";
import { listMemoryFiles, readMemoryFile, type MemoryFile } from "../memory/store.js";
import { MemoryNotFoundError, type MemoryCatalog } from "../memory/catalog.js";
import { currentMemorySyntax, type MemorySyntaxVersion } from "../memory/syntax.js";
import { inheritSchemaFormat, resolveSchemaContract } from "../memory/schema.js";
import { resolvePromptLocale, type PromptLocale } from "../prompts/locale.js";
import { terminateProcessTree } from "../platform-process.js";
import {
  builtInArtifactFormats,
  stepActors,
  type ActionNode,
  type ArtifactFormatSpec,
  type DefinitionPart,
  type FlowNode,
  type IfNode,
  type MemoryRefNode,
  type ProcedureMemory,
  schemaNodeFromMemory,
  type RepeatNode,
  type SchemaMemory,
  type SchemaNode,
  type StaticSchemaField,
  type StatementNode,
  type StepActor,
  type WhileNode
} from "../memory/ast.js";

export { builtInArtifactFormats, stepActors };
export type { ArtifactFormatSpec, ArtifactReportSource, StepActor };

const artifactValidatorRegistry = createBuiltInArtifactValidatorRegistry();

export function registerArtifactValidator(registration: ArtifactValidatorRegistration): void {
  artifactValidatorRegistry.register(registration);
}

export class ArtifactAuthorizationFailure extends Error {
  constructor(
    readonly decision: AuthorizationDecision,
    readonly guidance: string[]
  ) {
    super([
      `Artifact authorization denied: ${decision.permission} for ${decision.artifactScope}`,
      ...guidance
    ].join("\n"));
    this.name = "ArtifactAuthorizationFailure";
  }
}

export type RunStatus = "running" | "done" | "abandoned";
export type FrameType = "procedure" | "schema";

export type RunAbandonment = {
  abandonedAt: string;
  reason?: string;
  initiator: {
    kind: "human";
    actorId?: string;
    name?: string;
    source: "cli" | "view";
  };
  current?: {
    frame: FrameType;
    memoryName: string;
    stepId: string;
  };
};

export type SchemaConstraintSource = {
  path: string;
  type: string;
  format: ArtifactFormatSpec;
  defines?: string[];
  asserts?: string[];
  suggests?: string[];
};

export type SchemaStepContext = {
  rootName: string;
  path: string;
  sources: SchemaConstraintSource[];
};

export type SchemaDraftState = {
  stepId: string;
  schemaName: string;
  status: "writing" | "awaiting_finalization" | "submitted" | "accepted";
  path: string;
  fileName: string;
  contentType: "text/markdown";
  completed: number;
  total: number;
  pendingRepeatControls?: number;
  assembledDigest?: string;
  submittedDigest?: string;
  validation?: ArtifactValidationResult;
  acceptedArtifactPath?: string;
  updatedAt: string;
};

export type RunFrame = {
  type: FrameType;
  memoryName: string;
  asserts?: string[];
  steps: RunStep[];
  index: number;
  returnTo?: string;
  sourceStepId?: string;
  eventStartIndex?: number;
};

export type RunStep = {
  id: string;
  kind?: "action" | "branch" | "loop" | "call" | "repeat";
  instruction: string;
  actor?: StepActor;
  artifact?: string;
  type?: string;
  format?: ArtifactFormatSpec;
  schema?: RunSchemaContract;
  validationPlan?: ArtifactValidationPlan;
  final?: boolean;
  reviewSlots?: string[];
  reviewPolicy?: string;
  optional?: boolean;
  asserts?: string[];
  suggests?: string[];
  details?: string[];
  schemaContext?: SchemaStepContext;
  controlPlane?: ArtifactControlPlane;
  target?: string;
  branches?: {
    truthy: RunStep[];
    falsy: RunStep[];
  };
  loop?: {
    body: RunStep[];
  };
  repeat?: {
    parentPath: string;
    fieldIndex: number;
    body: StaticSchemaField[];
    min: number;
    max?: number;
  };
};

export type RunSchemaContract =
  | { kind: "external"; name: string; node?: SchemaNode }
  | { kind: "inline"; id: string; node: SchemaNode };

export type RunEvent = {
  at: string;
  frame: FrameType;
  stepId: string;
  artifact: {
    name: string;
    type: string;
    format: ArtifactFormatSpec;
    fields?: Record<string, unknown>;
    schema?: RunSchemaContract;
    validation?: ArtifactValidationResult;
    final?: boolean;
    storage?: "inline" | "file";
    value?: unknown;
    path?: string;
    fileName?: string;
    contentType?: string;
    authorization?: AuthorizationDecision;
  };
};

export type RunProcedureTemplate = {
  memoryName: string;
  asserts?: string[];
  steps: RunStep[];
};

export type RunSlotBindingValue =
  | { actorIds: string[] }
  | { skip: true };

export type RunBindingChange = {
  id: string;
  changedAt: string;
  subject: "runner";
  slot: string;
  before: RunSlotBindingValue;
  after: RunSlotBindingValue;
  affectedReviewScopes: string[];
  preservedReviewIds: string[];
};

export type RunState = {
  contractVersion: 1 | 2 | 3;
  language?: PromptLocale;
  readOnly?: boolean;
  memorySyntax?: MemorySyntaxVersion;
  id: string;
  name?: string;
  status: RunStatus;
  procedureName: string;
  asserts?: string[];
  memoryRoot: string;
  memoryProjects?: {
    primary: { name: string; revision: string };
    mounted: Array<{ name: string; revision: string }>;
  };
  createdAt: string;
  updatedAt: string;
  abandonment?: RunAbandonment;
  plan?: RunStep[];
  stack: RunFrame[];
  events: RunEvent[];
  controlPlane?: ControlPlaneSnapshot;
  reviewConfiguration?: RunReviewConfiguration;
  procedureSnapshots?: Record<string, RunProcedureTemplate>;
  artifactReviews?: ArtifactReview<RunEvent["artifact"]>[];
  bindingChanges?: RunBindingChange[];
  schemaDrafts?: Record<string, SchemaDraftState>;
};

export type RunListSummary = {
  id: string;
  name?: string;
  status: RunStatus;
  procedureName: string;
  createdAt: string;
  updatedAt: string;
  readOnly: boolean;
  eventCount: number;
  reviewProgress?: {
    id: string;
    status: string;
    currentRoundId: string;
    updatedAt: string;
    submitted: number;
    total: number;
  };
};

export type RunBindingSnapshot = {
  runId: string;
  status: RunStatus;
  readOnly: boolean;
  actors: Array<{
    id: string;
    name: string;
    kind: "human" | "agent";
    permissions: string[];
  }>;
  slots: Array<{
    key: string;
    binding: RunSlotBindingValue;
    reviewScopes: string[];
    reviewIds: string[];
  }>;
  changes: RunBindingChange[];
};

export type RunReviewPreflight = {
  reviews: Array<{
    scope: string;
    artifact: string;
    slots: string[];
    policies: string[];
  }>;
  slots: Array<{
    key: string;
    procedure: string;
    name: string;
  }>;
  actors: Array<{
    id: string;
    name: string;
    kind: "human" | "agent";
    permissions: string[];
  }>;
  example: {
    reviews: Record<string, { policy: string }>;
    slots: Record<string, { actors: string[] } | { skip: true }>;
  };
};

export class RunReviewConfigurationRequired extends Error {
  constructor(readonly preflight: RunReviewPreflight) {
    super(`Review configuration is required:\n${JSON.stringify(preflight, null, 2)}`);
  }
}

const artifactFormatSpecSchema = z.object({
  name: z.string().min(1),
  options: z.record(z.unknown())
}).strict();

const runSchemaContractSchema: z.ZodType<RunSchemaContract> = z.union([
  z.object({ kind: z.literal("external"), name: z.string(), node: z.custom<SchemaNode>().optional() }).strict(),
  z.object({ kind: z.literal("inline"), id: z.string(), node: z.custom<SchemaNode>() }).strict()
]);

const validationPlanEntrySchema = z.object({
  id: z.string(),
  version: z.string(),
  stage: z.enum(["type", "format", "schema"]),
  target: z.string(),
  contractPath: z.string().optional()
}).strict();

const validationResultSchema: z.ZodType<ArtifactValidationResult> = z.object({
  status: z.enum(["passed", "failed", "unsupported"]),
  correctable: z.boolean(),
  issues: z.array(z.object({
    code: z.string(),
    stage: z.enum(["type", "format", "schema"]),
    validatorId: z.string(),
    artifactPath: z.string(),
    contractPath: z.string().optional(),
    fieldPath: z.string().optional(),
    actual: z.unknown().optional(),
    expected: z.unknown().optional(),
    message: z.string()
  }))
});

const schemaConstraintSourceSchema: z.ZodType<SchemaConstraintSource> = z.object({
  path: z.string(),
  type: z.string(),
  format: artifactFormatSpecSchema,
  defines: z.array(z.string()).optional(),
  asserts: z.array(z.string()).optional(),
  suggests: z.array(z.string()).optional()
}).strict();

const schemaStepContextSchema: z.ZodType<SchemaStepContext> = z.object({
  rootName: z.string(),
  path: z.string(),
  sources: z.array(schemaConstraintSourceSchema)
}).strict();

const schemaDraftStateSchema: z.ZodType<SchemaDraftState> = z.object({
  stepId: z.string(),
  schemaName: z.string(),
  status: z.enum(["writing", "awaiting_finalization", "submitted", "accepted"]),
  path: z.string(),
  fileName: z.string(),
  contentType: z.literal("text/markdown"),
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  pendingRepeatControls: z.number().int().nonnegative().optional(),
  assembledDigest: z.string().optional(),
  submittedDigest: z.string().optional(),
  validation: validationResultSchema.optional(),
  acceptedArtifactPath: z.string().optional(),
  updatedAt: z.string()
}).strict();

const slotBindingsSchema = z.record(z.object({
  actorIds: z.array(z.string()),
  source: z.string(),
  skipped: z.boolean().optional()
}).strict());
const resolvedRolePermissionsSchema = z.object({
  base: z.array(z.string()),
  grants: z.array(z.string()),
  effective: z.array(z.string()),
  authoritySource: z.string(),
  grantSource: z.string().optional()
}).strict();
const artifactControlPlaneSchema: z.ZodType<ArtifactControlPlane> = z.object({
  revision: z.string(),
  artifactScope: z.string(),
  policyId: z.string(),
  bindings: slotBindingsSchema,
  permissions: z.record(resolvedRolePermissionsSchema)
}).strict() as unknown as z.ZodType<ArtifactControlPlane>;
const authorizationSubjectSchema = z.union([
  z.object({ kind: z.literal("runner") }).strict(),
  z.object({ kind: z.literal("actor"), actorId: z.string() }).strict()
]);
const authorizationDecisionSchema: z.ZodType<AuthorizationDecision> = z.object({
  allowed: z.boolean(),
  permission: z.string(),
  subject: authorizationSubjectSchema,
  artifactScope: z.string(),
  revision: z.string(),
  actorId: z.string(),
  authoritySource: z.string(),
  grantSource: z.string().optional(),
  basePermissions: z.array(z.string()),
  grantedPermissions: z.array(z.string()),
  effectivePermissions: z.array(z.string()),
  reason: z.enum(["allowed", "actor_not_found", "actor_not_bound", "permission_missing"])
}).strict() as unknown as z.ZodType<AuthorizationDecision>;

const runStepSchema: z.ZodType<RunStep> = z.lazy(() =>
  z.object({
    id: z.string(),
    kind: z.enum(["action", "branch", "loop", "call", "repeat"]).optional(),
    instruction: z.string(),
    actor: z.enum(stepActors).optional(),
    artifact: z.string().optional(),
    type: z.string().optional(),
    format: artifactFormatSpecSchema.optional(),
    schema: runSchemaContractSchema.optional(),
    validationPlan: z.array(validationPlanEntrySchema).optional(),
    final: z.boolean().optional(),
    reviewSlots: z.array(z.string()).optional(),
    reviewPolicy: z.string().optional(),
    optional: z.boolean().optional(),
    asserts: z.array(z.string()).optional(),
    suggests: z.array(z.string()).optional(),
    details: z.array(z.string()).optional(),
    schemaContext: schemaStepContextSchema.optional(),
    controlPlane: artifactControlPlaneSchema.optional(),
    target: z.string().optional(),
    branches: z.object({
      truthy: z.array(runStepSchema),
      falsy: z.array(runStepSchema)
    }).optional(),
    loop: z.object({
      body: z.array(runStepSchema)
    }).optional(),
    repeat: z.object({
      parentPath: z.string(),
      fieldIndex: z.number().int().nonnegative(),
      body: z.custom<StaticSchemaField[]>(),
      min: z.number().int().nonnegative(),
      max: z.number().int().nonnegative().optional()
    }).optional()
  })
);

const runAbandonmentSchema = z.object({
  abandonedAt: z.string(),
  reason: z.string().optional(),
  initiator: z.object({
    kind: z.literal("human"),
    actorId: z.string().optional(),
    name: z.string().optional(),
    source: z.enum(["cli", "view"])
  }).strict(),
  current: z.object({
    frame: z.enum(["procedure", "schema"]),
    memoryName: z.string(),
    stepId: z.string()
  }).strict().optional()
}).strict();

const runStateSchema: z.ZodType<RunState> = z.object({
  contractVersion: z.literal(2),
  readOnly: z.boolean().optional(),
  memorySyntax: z.string().optional(),
  id: z.string(),
  name: z.string().optional(),
  status: z.enum(["running", "done", "abandoned"]),
  procedureName: z.string(),
  asserts: z.array(z.string()).optional(),
  memoryRoot: z.string(),
  memoryProjects: z.object({
    primary: z.object({ name: z.string(), revision: z.string() }).strict(),
    mounted: z.array(z.object({ name: z.string(), revision: z.string() }).strict())
  }).strict().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  abandonment: runAbandonmentSchema.optional(),
  plan: z.array(runStepSchema).optional(),
  stack: z.array(z.object({
    type: z.enum(["procedure", "schema"]),
    memoryName: z.string(),
    asserts: z.array(z.string()).optional(),
    steps: z.array(runStepSchema),
    index: z.number(),
    returnTo: z.string().optional(),
    sourceStepId: z.string().optional(),
    eventStartIndex: z.number().int().nonnegative().optional(),
  })),
  events: z.array(z.object({
    at: z.string(),
    frame: z.enum(["procedure", "schema"]),
    stepId: z.string(),
    artifact: z.object({
      name: z.string(),
      type: z.string(),
      format: artifactFormatSpecSchema,
      fields: z.record(z.unknown()).optional(),
      schema: runSchemaContractSchema.optional(),
      validation: validationResultSchema.optional(),
      final: z.boolean().optional(),
      storage: z.enum(["inline", "file"]).optional(),
      value: z.unknown().optional(),
      path: z.string().optional(),
      fileName: z.string().optional(),
      contentType: z.string().optional(),
      authorization: authorizationDecisionSchema.optional()
    })
  })),
  schemaDrafts: z.record(schemaDraftStateSchema).optional()
});

const runProcedureTemplateSchema: z.ZodType<RunProcedureTemplate> = z.object({
  memoryName: z.string(),
  asserts: z.array(z.string()).optional(),
  steps: z.array(runStepSchema)
}).strict();

const artifactReviewAnchorSchema = z.object({
  submissionId: z.string(),
  target: z.string(),
  location: z.string().optional(),
  sourceHash: z.string(),
  context: z.string().optional()
}).strict();

const artifactReviewCommentSchema = z.object({
  id: z.string(),
  body: z.string(),
  severity: z.enum(artifactReviewSeverityValues).optional(),
  anchor: artifactReviewAnchorSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string()
}).strict();

const artifactReviewAgentAttemptSchema = z.object({
  id: z.string(),
  sequence: z.number().int().positive(),
  status: z.enum(["queued", "running", "submitted", "failed", "cancelled"]),
  provider: z.string(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  workerPid: z.number().int().positive().optional(),
  cliReadyAt: z.string().optional(),
  promptVersion: z.string().optional(),
  sessionId: z.string().optional(),
  protocolVersion: z.number().int().optional(),
  agentName: z.string().optional(),
  agentVersion: z.string().optional(),
  model: z.string().optional(),
  stopReason: z.string().optional(),
  failure: z.object({
    stage: z.enum(["spawn", "initialize", "auth", "session", "mode", "cli", "prompt", "permission", "timeout", "protocol", "process"]),
    code: z.string(),
    message: z.string(),
    category: z.enum(["environment", "provider", "reviewer", "unknown"]).optional()
  }).strict().optional()
}).strict();

const artifactReviewAssignmentSchema = z.object({
  id: z.string().optional(),
  actorId: z.string(),
  actorName: z.string(),
  actorKind: z.enum(["human", "agent"]).default("human"),
  slotIds: z.array(z.string()),
  permissions: z.array(z.enum(permissionIds)),
  binding: z.enum(["decision", "advisory"]),
  status: z.enum(["draft", "queued", "running", "submitted", "failed", "cancelled"]),
  draft: z.object({
    comments: z.array(artifactReviewCommentSchema),
    vote: z.enum(artifactReviewVoteValues).optional(),
    updatedAt: z.string().optional()
  }).strict(),
  submitted: z.object({
    comments: z.array(artifactReviewCommentSchema),
    vote: z.enum(artifactReviewVoteValues),
    summary: z.string().optional(),
    submittedAt: z.string(),
    authorization: authorizationDecisionSchema
  }).strict().optional(),
  attempts: z.array(artifactReviewAgentAttemptSchema).default([])
}).strict();

const artifactReviewVoteSchema = z.object({
  id: z.string(),
  subject: z.union([
    z.object({ kind: z.literal("runner") }).strict(),
    z.object({ kind: z.literal("actor"), actorId: z.string() }).strict()
  ]),
  binding: z.enum(["decision", "advisory"]),
  value: z.enum(artifactReviewVoteValues),
  automatic: z.boolean(),
  comment: z.string().optional(),
  authorization: authorizationDecisionSchema,
  submittedAt: z.string()
}).strict();

const currentArtifactReviewResultSchema = z.object({
  status: z.enum(["passed", "changes_requested"]),
  completedAt: z.string(),
  submitted: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  decisionApprove: z.number().int().nonnegative(),
  decisionTotal: z.number().int().nonnegative(),
  advisoryTotal: z.number().int().nonnegative()
}).strict();

const legacyArtifactReviewResultSchema = z.object({
  status: z.enum(["passed", "changes_requested"]),
  completedAt: z.string(),
  humanSubmitted: z.number().int().nonnegative(),
  humanTotal: z.number().int().nonnegative(),
  decisionApprove: z.number().int().nonnegative(),
  decisionTotal: z.number().int().nonnegative(),
  advisoryTotal: z.number().int().nonnegative()
}).strict().transform((result) => ({
  status: result.status,
  completedAt: result.completedAt,
  submitted: result.humanSubmitted,
  total: result.humanTotal,
  decisionApprove: result.decisionApprove,
  decisionTotal: result.decisionTotal,
  advisoryTotal: result.advisoryTotal
}));

const artifactReviewResultSchema = z.union([
  currentArtifactReviewResultSchema,
  legacyArtifactReviewResultSchema
]);

const artifactReviewRoundSchema = z.object({
  id: z.string(),
  sequence: z.number().int().positive(),
  submissionId: z.string(),
  status: z.enum(["pending", "awaiting_runner_vote", "passed", "changes_requested", "cancelled"]),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  assignments: z.array(artifactReviewAssignmentSchema),
  votes: z.array(artifactReviewVoteSchema),
  commentDispositions: z.array(z.object({
    commentId: z.string(),
    disposition: z.enum(artifactReviewDispositionValues),
    note: z.string().optional(),
    validationSummary: z.string().optional(),
    updatedAt: z.string()
  }).strict()).optional(),
  result: artifactReviewResultSchema.optional()
}).strict();

const runEventArtifactSchema = z.object({
  name: z.string(),
  type: z.string(),
  format: artifactFormatSpecSchema,
  fields: z.record(z.unknown()).optional(),
  schema: runSchemaContractSchema.optional(),
  validation: validationResultSchema.optional(),
  final: z.boolean().optional(),
  storage: z.enum(["inline", "file"]).optional(),
  value: z.unknown().optional(),
  path: z.string().optional(),
  fileName: z.string().optional(),
  contentType: z.string().optional(),
  authorization: authorizationDecisionSchema.optional()
}).strict();

const artifactReviewSubmissionSchema = z.object({
  id: z.string(),
  digest: z.string(),
  createdAt: z.string(),
  artifact: runEventArtifactSchema,
  contextArtifacts: z.array(z.object({
    stepId: z.string(),
    artifact: runEventArtifactSchema
  }).strict()),
  revisionSummary: z.object({
    body: z.string(),
    digest: z.string(),
    createdAt: z.string(),
    previousSubmissionId: z.string()
  }).strict().optional()
}).strict();

const artifactReviewSchema: z.ZodType<ArtifactReview<RunEvent["artifact"]>, z.ZodTypeDef, unknown> = z.object({
  id: z.string(),
  stepId: z.string(),
  artifactName: z.string(),
  policyId: z.string(),
  controlPlane: artifactControlPlaneSchema,
  status: z.enum(["pending", "awaiting_runner_vote", "awaiting_revision", "passed", "cancelled"]),
  currentRoundId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  submissions: z.array(artifactReviewSubmissionSchema),
  rounds: z.array(artifactReviewRoundSchema),
  outcome: z.object({
    status: z.literal("passed"),
    submissionId: z.string(),
    roundId: z.string(),
    completedAt: z.string()
  }).strict().optional()
}).strict();

const runStateV3Schema: z.ZodType<RunState, z.ZodTypeDef, unknown> = z.object({
  contractVersion: z.literal(3),
  language: z.enum(["zh-CN", "en"]).default("zh-CN"),
  readOnly: z.boolean().optional(),
  memorySyntax: z.string().optional(),
  id: z.string(),
  name: z.string().optional(),
  status: z.enum(["running", "done", "abandoned"]),
  procedureName: z.string(),
  asserts: z.array(z.string()).optional(),
  memoryRoot: z.string(),
  memoryProjects: z.object({
    primary: z.object({ name: z.string(), revision: z.string() }).strict(),
    mounted: z.array(z.object({ name: z.string(), revision: z.string() }).strict())
  }).strict().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  abandonment: runAbandonmentSchema.optional(),
  plan: z.array(runStepSchema).optional(),
  stack: z.array(z.object({
    type: z.enum(["procedure", "schema"]),
    memoryName: z.string(),
    asserts: z.array(z.string()).optional(),
    steps: z.array(runStepSchema),
    index: z.number(),
    returnTo: z.string().optional(),
    sourceStepId: z.string().optional(),
    eventStartIndex: z.number().int().nonnegative().optional()
  }).strict()),
  events: z.array(z.object({
    at: z.string(),
    frame: z.enum(["procedure", "schema"]),
    stepId: z.string(),
    artifact: runEventArtifactSchema
  }).strict()),
  controlPlane: controlPlaneSnapshotSchema.optional(),
  reviewConfiguration: z.object({
    reviews: z.record(z.object({
      policy: z.string(),
      permissionGrants: z.record(z.array(z.enum(permissionIds))).optional()
    }).strict().transform(({ permissionGrants: _legacy, ...review }) => review)),
    slots: z.record(z.union([
      z.object({ actorIds: z.array(z.string()).min(1) }).strict(),
      z.object({ skip: z.literal(true) }).strict()
    ]))
  }).strict().optional(),
  procedureSnapshots: z.record(runProcedureTemplateSchema),
  artifactReviews: z.array(artifactReviewSchema).optional(),
  bindingChanges: z.array(z.object({
    id: z.string(),
    changedAt: z.string(),
    subject: z.literal("runner"),
    slot: z.string(),
    before: z.union([
      z.object({ actorIds: z.array(z.string()).min(1) }).strict(),
      z.object({ skip: z.literal(true) }).strict()
    ]),
    after: z.union([
      z.object({ actorIds: z.array(z.string()).min(1) }).strict(),
      z.object({ skip: z.literal(true) }).strict()
    ]),
    affectedReviewScopes: z.array(z.string()),
    preservedReviewIds: z.array(z.string())
  }).strict()).optional(),
  schemaDrafts: z.record(schemaDraftStateSchema).optional()
}).strict();

export async function ensureRunDirectory(runsRoot: string): Promise<string> {
  await mkdir(runsRoot, { recursive: true });
  return runsRoot;
}

export async function startRun(input: {
  memoryRoot: string;
  runsRoot: string;
  name: string;
  language?: PromptLocale;
  procedureName?: string;
  procedureFile?: string;
  controlPlane?: ControlPlaneConfig;
  reviewConfiguration?: RunReviewConfiguration;
  memoryProjects?: RunState["memoryProjects"];
  memoryCatalog?: MemoryCatalog;
  projectMemoryCatalogs?: Record<string, MemoryCatalog>;
}): Promise<RunState> {
  const runName = normalizeRunName(input.name);
  const procedureName = input.procedureName?.trim();
  const procedureFile = input.procedureFile?.trim();
  if (!procedureName && !procedureFile) throw new Error("provide a procedure name or procedure file");
  if (procedureName && procedureFile) throw new Error("use either a procedure name or procedure file, not both");

  await ensureRunDirectory(input.runsRoot);
  let lookup: RunMemoryLookup | undefined;
  let procedure: MemoryFile | undefined;
  if (procedureFile) {
    procedure = await readMemoryFile("procedures", resolve(procedureFile));
  } else if (input.memoryCatalog) {
    const descriptor = await input.memoryCatalog.resolve(procedureName!, { kind: "procedures" });
    const catalog = descriptor.project_name
      ? input.projectMemoryCatalogs?.[descriptor.project_name]
      : input.memoryCatalog;
    if (!catalog) throw new Error(`Run Memory source is unavailable: ${descriptor.project_name}`);
    procedure = {
      kind: "procedures",
      path: descriptor.reference,
      entity: await catalog.read(descriptor.reference, { kind: "procedures" })
    };
    lookup = catalogLookup(catalog);
  } else {
    procedure = await findMemoryByName(input.memoryRoot, "procedures", procedureName!);
  }
  if (!procedure) {
    throw new Error(`procedure not found: ${procedureName}`);
  }

  const procedureMemory = procedure.entity as ProcedureMemory;
  const procedureSnapshots = await snapshotReachableProcedureTemplates(input.memoryRoot, procedureMemory, lookup);
  const rootTemplate = procedureSnapshots[procedureMemory.names[0]];
  if (!rootTemplate) throw new Error(`procedure snapshot missing: ${procedureMemory.names[0]}`);
  const controlPlane = input.controlPlane ? createControlPlaneSnapshot(input.controlPlane) : undefined;
  const preflight = buildRunReviewPreflight(procedureSnapshots, controlPlane);
  if (preflight.reviews.length && !input.reviewConfiguration) {
    throw new RunReviewConfigurationRequired(preflight);
  }
  const reviewConfiguration = validateRunReviewConfiguration(
    preflight,
    input.reviewConfiguration,
    controlPlane
  );
  const steps = instantiateProcedureTemplate(rootTemplate, controlPlane, reviewConfiguration);
  if (!steps.length) {
    throw new Error(`procedure has no flow steps: ${procedureMemory.names[0]}`);
  }

  const now = new Date().toISOString();
  const run: RunState = {
    contractVersion: 3,
    language: resolvePromptLocale(input.language),
    memorySyntax: procedure.entity.syntax,
    id: makeRunId(now),
    name: runName,
    status: "running",
    procedureName: procedure.entity.names[0],
    asserts: procedureMemory.asserts ? [...procedureMemory.asserts] : undefined,
    memoryRoot: input.memoryRoot,
    memoryProjects: input.memoryProjects,
    createdAt: now,
    updatedAt: now,
    plan: cloneSteps(steps),
    stack: [{
      type: "procedure",
      memoryName: procedure.entity.names[0],
      asserts: procedureMemory.asserts ? [...procedureMemory.asserts] : undefined,
      steps,
      index: 0
    }],
    events: [],
    controlPlane,
    reviewConfiguration,
    procedureSnapshots
  };

  await expandAutoCallSteps(run);
  await writeRun(input.runsRoot, run);
  return run;
}

export function normalizeRunName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("run name is required");
  }
  const name = value.trim();
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(name)) {
    throw new Error("run name must not contain control characters");
  }
  return name;
}

export function runDisplayName(run: Pick<RunState, "name" | "procedureName">): string {
  return run.name?.trim() || run.procedureName;
}

export type AbandonRunResult = {
  run: RunState;
  terminationWarnings: string[];
};

export async function abandonRun(input: {
  runsRoot: string;
  runId: string;
  source: "cli" | "view";
  actorId?: string;
  reason?: string;
  terminateWorker?: (pid: number) => Promise<void>;
}): Promise<AbandonRunResult> {
  const workerPids: number[] = [];
  const run = await withRunWriteLock(input.runsRoot, input.runId, async () => {
    const current = await readRun(input.runsRoot, input.runId);
    if (current.status === "abandoned") return current;
    if (current.contractVersion === 1 || current.readOnly) {
      throw new Error(`Run is read-only and cannot be abandoned: ${current.id}`);
    }
    if (current.status === "done") throw new Error(`Run is already done: ${current.id}`);

    const reason = input.reason?.trim() || undefined;
    if (reason && reason.length > 2_000) throw new Error("abandonment reason must not exceed 2000 characters");
    const actorId = input.actorId?.trim() || undefined;
    const actor = actorId ? current.controlPlane?.actors[actorId] : undefined;
    if (actorId && (!actor || actor.kind !== "human")) {
      throw new Error(`Run abandonment actor must be a Human Actor in the Run snapshot: ${actorId}`);
    }
    const frame = currentFrame(current);
    const step = currentStep(current);
    const now = new Date().toISOString();

    for (const review of current.artifactReviews ?? []) {
      if (review.status === "passed" || review.status === "cancelled") continue;
      review.status = "cancelled";
      review.updatedAt = now;
      const round = review.rounds.find((candidate) => candidate.id === review.currentRoundId);
      if (!round) continue;
      if (round.status !== "passed" && round.status !== "changes_requested" && round.status !== "cancelled") {
        round.status = "cancelled";
      }
      for (const assignment of round.assignments) {
        if (assignment.status !== "submitted" && assignment.status !== "cancelled") {
          assignment.status = "cancelled";
        }
        for (const attempt of assignment.attempts ?? []) {
          if (attempt.status !== "queued" && attempt.status !== "running") continue;
          if (attempt.status === "running" && attempt.workerPid) workerPids.push(attempt.workerPid);
          attempt.status = "cancelled";
          attempt.completedAt = now;
          attempt.stopReason = "run_abandoned";
        }
      }
      round.revision += 1;
    }

    current.status = "abandoned";
    current.abandonment = {
      abandonedAt: now,
      reason,
      initiator: {
        kind: "human",
        actorId,
        name: actor?.name,
        source: input.source
      },
      ...(frame && step ? {
        current: { frame: frame.type, memoryName: frame.memoryName, stepId: step.id }
      } : {})
    };
    current.updatedAt = now;
    await writeRun(input.runsRoot, current);
    return current;
  });

  const terminate = input.terminateWorker ?? ((pid: number) => terminateProcessTree(pid, "SIGTERM", process.platform, true));
  const terminationWarnings: string[] = [];
  await Promise.all([...new Set(workerPids)].map(async (pid) => {
    try {
      await terminate(pid);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      terminationWarnings.push(`failed to terminate Agent Review worker ${pid}: ${message}`);
    }
  }));
  return { run, terminationWarnings };
}

function assertRunRunning(run: RunState): void {
  if (run.status !== "running") throw new Error(`Run is not running: ${run.id} (${run.status})`);
}

export async function readRun(runsRoot: string, id: string): Promise<RunState> {
  const raw = await readFile(await existingRunPath(runsRoot, id), "utf8");
  return parseRunState(JSON.parse(raw));
}

export function parseRunState(parsed: unknown): RunState {
  if (parsed && typeof parsed === "object" && (parsed as { contractVersion?: unknown }).contractVersion === 3) {
    return runStateV3Schema.parse(parsed);
  }
  if (parsed && typeof parsed === "object" && (parsed as { contractVersion?: unknown }).contractVersion === 2) {
    return runStateSchema.parse(parsed);
  }
  return normalizeLegacyRun(parsed);
}

export async function listRuns(runsRoot: string): Promise<RunState[]> {
  await ensureRunDirectory(runsRoot);
  const entries = await readdir(runsRoot, { withFileTypes: true });
  const runsById = new Map<string, RunState>();
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const id = entry.name;
      try {
        const run = await readRun(runsRoot, id);
        runsById.set(run.id, run);
      } catch {
        // Ignore directories that are not run roots.
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      const id = entry.name.slice(0, -".json".length);
      if (!runsById.has(id)) runsById.set(id, await readRun(runsRoot, id));
    }
  }
  const runs = [...runsById.values()];
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listRunSummaries(runsRoot: string): Promise<RunListSummary[]> {
  await ensureRunDirectory(runsRoot);
  const entries = await readdir(runsRoot, { withFileTypes: true });
  const summariesById = new Map<string, RunListSummary>();
  for (const entry of entries) {
    if (entry.isDirectory()) {
      try {
        const summary = await readRunSummary(runsRoot, entry.name);
        summariesById.set(summary.id, summary);
      } catch {
        // Ignore directories that are not valid run roots.
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      const id = entry.name.slice(0, -".json".length);
      if (summariesById.has(id)) continue;
      try {
        const summary = await readRunSummary(runsRoot, id);
        summariesById.set(summary.id, summary);
      } catch {
        // Ignore files that are not valid runs.
      }
    }
  }
  return [...summariesById.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function readRunSummary(runsRoot: string, id: string): Promise<RunListSummary> {
  const raw = JSON.parse(await readFile(await existingRunPath(runsRoot, id), "utf8")) as unknown;
  if (!raw || typeof raw !== "object") throw new Error(`invalid Run summary: ${id}`);
  const source = raw as Record<string, unknown>;
  if (source.contractVersion !== 2 && source.contractVersion !== 3) {
    return summarizeRun(await readRun(runsRoot, id));
  }
  const runId = requiredSummaryString(source.id, "id");
  const status = source.status;
  if (status !== "running" && status !== "done" && status !== "abandoned") {
    throw new Error(`invalid Run summary status: ${runId}`);
  }
  const reviews = Array.isArray(source.artifactReviews)
    ? source.artifactReviews.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];
  const activeReview = [...reviews]
    .filter((review) => review.status !== "passed" && review.status !== "cancelled")
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))[0];
  return {
    id: runId,
    ...(typeof source.name === "string" && source.name.trim() ? { name: source.name } : {}),
    status,
    procedureName: requiredSummaryString(source.procedureName, "procedureName"),
    createdAt: requiredSummaryString(source.createdAt, "createdAt"),
    updatedAt: requiredSummaryString(source.updatedAt, "updatedAt"),
    readOnly: source.readOnly === true,
    eventCount: Array.isArray(source.events) ? source.events.length : 0,
    ...(activeReview ? { reviewProgress: summarizeReviewProgress(activeReview) } : {})
  };
}

function summarizeRun(run: RunState): RunListSummary {
  const activeReview = [...(run.artifactReviews ?? [])]
    .filter((review) => review.status !== "passed" && review.status !== "cancelled")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  return {
    id: run.id,
    ...(run.name?.trim() ? { name: run.name } : {}),
    status: run.status,
    procedureName: run.procedureName,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    readOnly: run.readOnly === true,
    eventCount: run.events.length,
    ...(activeReview ? { reviewProgress: summarizeReviewProgress(activeReview as unknown as Record<string, unknown>) } : {})
  };
}

function summarizeReviewProgress(review: Record<string, unknown>): NonNullable<RunListSummary["reviewProgress"]> {
  const rounds = Array.isArray(review.rounds)
    ? review.rounds.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];
  const currentRoundId = requiredSummaryString(review.currentRoundId, "artifactReview.currentRoundId");
  const round = rounds.find((candidate) => candidate.id === currentRoundId);
  const assignments = Array.isArray(round?.assignments) ? round.assignments : [];
  return {
    id: requiredSummaryString(review.id, "artifactReview.id"),
    status: requiredSummaryString(review.status, "artifactReview.status"),
    currentRoundId,
    updatedAt: requiredSummaryString(review.updatedAt, "artifactReview.updatedAt"),
    submitted: assignments.filter((assignment) => Boolean(
      assignment && typeof assignment === "object" && (assignment as Record<string, unknown>).status === "submitted"
    )).length,
    total: assignments.length
  };
}

function requiredSummaryString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`invalid Run summary ${name}`);
  return value;
}

export function buildRunBindingSnapshot(run: RunState): RunBindingSnapshot {
  const scopesBySlot = futureRunReviewScopesBySlot(run);
  const reviewsBySlot = new Map<string, string[]>();
  for (const review of run.artifactReviews ?? []) {
    for (const slot of Object.keys(review.controlPlane.bindings)) {
      const ids = reviewsBySlot.get(slot) ?? [];
      ids.push(review.id);
      reviewsBySlot.set(slot, ids);
    }
  }
  return {
    runId: run.id,
    status: run.status,
    readOnly: run.readOnly === true,
    actors: Object.entries(run.controlPlane?.actors ?? {}).map(([id, actor]) => ({
      id,
      name: actor.name,
      kind: actor.kind,
      permissions: [...actor.permissions]
    })),
    slots: Object.entries(run.reviewConfiguration?.slots ?? {}).map(([key, binding]) => ({
      key,
      binding: cloneRunSlotBinding(binding),
      reviewScopes: scopesBySlot.get(key) ?? [],
      reviewIds: [...new Set(reviewsBySlot.get(key) ?? [])]
    })).sort((left, right) => left.key.localeCompare(right.key)),
    changes: structuredClone(run.bindingChanges ?? [])
  };
}

export async function updateRunSlotBinding(input: {
  runsRoot: string;
  runId: string;
  slot: string;
  actorIds?: string[];
  skip?: boolean;
}): Promise<{ run: RunState; change: RunBindingChange; snapshot: RunBindingSnapshot }> {
  return withRunWriteLock(input.runsRoot, input.runId, async () => {
    const run = await readRun(input.runsRoot, input.runId);
    if (run.contractVersion !== 3) throw new Error("Run binding update requires Run v3");
    if (run.readOnly) throw new Error(`Run is read-only: ${run.id}`);
    assertRunRunning(run);
    if (!run.controlPlane || !run.reviewConfiguration || !run.procedureSnapshots) {
      throw new Error(`Run has no Review binding configuration: ${run.id}`);
    }

    const slot = input.slot.trim();
    if (!slot || !(slot in run.reviewConfiguration.slots)) {
      throw new Error(`Unknown Review Slot in Run: ${slot || "<empty>"}`);
    }
    if (input.skip === true && input.actorIds !== undefined) {
      throw new Error("use either actorIds or skip, not both");
    }
    if (input.skip !== true && input.actorIds === undefined) {
      throw new Error("provide actorIds or set skip");
    }
    const after: RunSlotBindingValue = input.skip === true
      ? { skip: true }
      : validateRunSlotActors(run, slot, input.actorIds ?? []);
    const before = cloneRunSlotBinding(run.reviewConfiguration.slots[slot]);
    if (sameRunSlotBinding(before, after)) throw new Error(`Review Slot binding is unchanged: ${slot}`);

    const candidate = structuredClone(run.reviewConfiguration);
    candidate.slots[slot] = cloneRunSlotBinding(after);
    const affectedReviewScopes = futureRunReviewScopesBySlot(run).get(slot) ?? [];
    const resolvedStepsByScope = resolvedReviewStepsByScope(run, candidate, new Set(affectedReviewScopes));
    const preservedReviewIds = (run.artifactReviews ?? [])
      .filter((review) => slot in review.controlPlane.bindings)
      .map((review) => review.id);

    run.reviewConfiguration = candidate;
    updateStoredRunReviewSteps(run, affectedReviewScopes, resolvedStepsByScope);
    const now = new Date().toISOString();
    const change: RunBindingChange = {
      id: makeBindingChangeId(now),
      changedAt: now,
      subject: "runner",
      slot,
      before,
      after: cloneRunSlotBinding(after),
      affectedReviewScopes,
      preservedReviewIds
    };
    (run.bindingChanges ??= []).push(change);
    run.updatedAt = now;
    await writeRun(input.runsRoot, run);
    return { run, change, snapshot: buildRunBindingSnapshot(run) };
  });
}

export async function reportRun(input: {
  runsRoot: string;
  runId: string;
  artifact: ArtifactReportSource;
  revisionSummary?: string;
  beforeArtifactReview?: () => Promise<unknown>;
}): Promise<RunState> {
  return withRunWriteLock(input.runsRoot, input.runId, () => reportRunUnlocked(input));
}

async function reportRunUnlocked(input: {
  runsRoot: string;
  runId: string;
  artifact: ArtifactReportSource;
  revisionSummary?: string;
  beforeArtifactReview?: () => Promise<unknown>;
}): Promise<RunState> {
  const run = await readRun(input.runsRoot, input.runId);
  if (run.contractVersion === 1 || run.readOnly) {
    throw new Error(`v1 run is read-only and cannot report after the Artifact Contract v2 upgrade: ${input.runId}`);
  }
  assertRunRunning(run);

  const schemaFinalization = currentSchemaFinalization(run);
  if (schemaFinalization) {
    return reportSchemaFinalArtifact(input, run, schemaFinalization);
  }

  const frame = currentFrame(run);
  const step = currentStep(run);
  if (step?.kind === "repeat") {
    throw new Error(`current step is Repeat control; use memsphere run repeat <count> --run ${input.runId}`);
  }
  if (!frame || !step || !step.artifact || !step.format) {
    run.status = "done";
    run.updatedAt = new Date().toISOString();
    await writeRun(input.runsRoot, run);
    throw new Error(`run has no current step: ${input.runId}`);
  }

  const authorization = authorizeRunnerForReport(run, step, resolvePromptLocale(run.language));
  const contract = await contractForStep(run, step);
  const context = {
    runId: run.id,
    stepId: step.id,
    artifactPath: step.id,
    attemptId: randomUUID()
  };
  const candidate = await prepareArtifactCandidate(contract, input.artifact, context);
  const plan = step.validationPlan ?? artifactValidatorRegistry.resolvePlan(contract);
  const validation = await artifactValidatorRegistry.execute(plan, { contract, candidate, context });
  if (validation.status !== "passed") throw new ArtifactValidationFailure(validation);

  return acceptPreparedArtifact(input, run, step, candidate, validation, authorization);
}

async function acceptPreparedArtifact(
  input: {
    runsRoot: string;
    runId: string;
    artifact: ArtifactReportSource;
    revisionSummary?: string;
    beforeArtifactReview?: () => Promise<unknown>;
  },
  run: RunState,
  step: RunStep,
  candidate: PreparedArtifactCandidate,
  validation: ArtifactValidationResult,
  authorization?: AuthorizationDecision
): Promise<RunState> {
  if (step.reviewPolicy || activeReviewForStep(run, step)) {
    return reportReviewedArtifact(input, run, step, candidate, validation, authorization);
  }

  const frame = currentFrame(run);
  if (!frame || currentStep(run)?.id !== step.id) {
    throw new Error(`Artifact current Step changed before acceptance: ${step.id}`);
  }

  const createdArtifactFiles: string[] = [];
  try {
    const artifact = await buildRunEventArtifact(
      input.runsRoot,
      run,
      step,
      candidate,
      validation,
      createdArtifactFiles,
      authorization
    );
    const controlValue = step.kind === "branch" || step.kind === "loop" ? candidate.representation.value : undefined;

    run.events.push({
      at: new Date().toISOString(),
      frame: frame.type,
      stepId: step.id,
      artifact
    });

    frame.index += 1;
    applyControlStep(frame, step, controlValue);
    markSchemaDraftAccepted(run, step.id, artifact.path);
    await collapseCompletedFrames(input.runsRoot, run, createdArtifactFiles);
    await expandAutoCallSteps(run);
    run.updatedAt = new Date().toISOString();
    await writeRun(input.runsRoot, run);
    return run;
  } catch (error) {
    await removeArtifactFiles(createdArtifactFiles);
    throw error;
  }
}

async function reportReviewedArtifact(
  input: {
    runsRoot: string;
    runId: string;
    artifact: ArtifactReportSource;
    revisionSummary?: string;
    locale?: "zh-CN" | "en";
    beforeArtifactReview?: () => Promise<unknown>;
  },
  run: RunState,
  step: RunStep,
  candidate: PreparedArtifactCandidate,
  validation: ArtifactValidationResult,
  authorization?: AuthorizationDecision
): Promise<RunState> {
  const existing = activeReviewForStep(run, step);
  const reviewControlPlane = existing?.controlPlane ?? step.controlPlane;
  const reviewPolicyId = existing?.policyId ?? step.reviewPolicy;
  if (run.contractVersion !== 3 || !run.controlPlane || !reviewControlPlane || !reviewPolicyId || !step.artifact) {
    throw new Error(`Artifact Review requires a Run v3 control-plane snapshot: ${step.id}`);
  }
  const policy = run.controlPlane.decisionPolicyCatalog.definitions.find((item) => item.id === reviewPolicyId);
  if (!policy) throw new Error(`Unknown Decision Policy id in Run snapshot: ${reviewPolicyId}`);
  if (policy.completion !== "all_assigned" || policy.resolution !== "unanimous") {
    throw new Error(`Unsupported Decision Policy contract: ${reviewPolicyId}`);
  }
  const runnerRead = authorizeArtifactOperation({
    controlPlane: reviewControlPlane,
    subject: { kind: "runner" },
    permission: "artifact.read"
  });
  if (!runnerRead.allowed) {
    throw new ArtifactAuthorizationFailure(runnerRead, [
      "Artifact Review requires runner artifact.read so run review wait can return the result."
    ]);
  }

  const digest = digestBytes(candidate.raw);
  if (existing?.status === "pending" || existing?.status === "awaiting_runner_vote") {
    const submission = reviewSubmission(existing, currentReviewRound(existing).submissionId);
    if (submission.digest === digest) return run;
    throw new Error(
      `Artifact Review ${existing.id} is in progress; wait for ${existing.currentRoundId} before reporting a different candidate`
    );
  }
  if (existing?.status === "passed") {
    throw new Error(`Artifact Review is already passed: ${existing.id}`);
  }
  if (existing?.status === "awaiting_revision" && !input.revisionSummary?.trim()) {
    throw new Error(`Artifact Review ${existing.id} requires a revision summary before the next report`);
  }
  if (!existing && input.revisionSummary !== undefined) {
    throw new Error("--revision-summary-file is only allowed after an Artifact Review requests changes");
  }

  await input.beforeArtifactReview?.();
  const now = new Date().toISOString();
  const reviewId = existing?.id ?? makeReviewEntityId("review", now);
  const submissionId = makeReviewEntityId("submission", now);
  const roundId = makeReviewEntityId("round", now);
  const assignmentSet = createArtifactReviewAssignments({
    snapshot: run.controlPlane,
    controlPlane: reviewControlPlane,
    now
  });
  const createdArtifactFiles: string[] = [];
  try {
    const artifact = await buildRunEventArtifact(
      input.runsRoot,
      run,
      step,
      candidate,
      validation,
      createdArtifactFiles,
      authorization,
      {
        relativeDirectory: join("reviews", reviewId, submissionId),
        fileName: `${slugify(step.artifact) || "artifact"}${extensionForFormat(step.format ?? { name: "plain", options: {} })}`
      }
    );
    const contextArtifacts = await buildArtifactReviewContextArtifacts(
      input.runsRoot,
      run,
      reviewId,
      submissionId,
      createdArtifactFiles
    );
    const previousSubmission = existing?.submissions.at(-1);
    const submission = {
      id: submissionId,
      digest,
      createdAt: now,
      artifact,
      contextArtifacts,
      revisionSummary: existing && previousSubmission
        ? {
            body: input.revisionSummary!.trim(),
            digest: digestText(input.revisionSummary!.trim()),
            createdAt: now,
            previousSubmissionId: previousSubmission.id
          }
        : undefined
    };
    const round: ArtifactReviewRound = {
      id: roundId,
      sequence: (existing?.rounds.length ?? 0) + 1,
      submissionId,
      status: "pending",
      revision: 1,
      createdAt: now,
      assignments: assignmentSet.assignments,
      votes: []
    };

    if (existing) {
      existing.status = "pending";
      existing.currentRoundId = roundId;
      existing.updatedAt = now;
      existing.submissions.push(submission);
      existing.rounds.push(round);
    } else {
      (run.artifactReviews ??= []).push({
        id: reviewId,
        stepId: step.id,
        artifactName: step.artifact,
        policyId: reviewPolicyId,
        controlPlane: structuredClone(reviewControlPlane),
        status: "pending",
        currentRoundId: roundId,
        createdAt: now,
        updatedAt: now,
        submissions: [submission],
        rounds: [round]
      });
    }
    const schemaDraft = run.schemaDrafts?.[step.id];
    if (schemaDraft) {
      schemaDraft.status = "submitted";
      schemaDraft.submittedDigest = digest;
      schemaDraft.validation = validation;
      schemaDraft.updatedAt = now;
    }
    run.updatedAt = now;
    await writeRun(input.runsRoot, run);
    return run;
  } catch (error) {
    await removeArtifactFiles(createdArtifactFiles);
    throw error;
  }
}

export type ArtifactReviewDraftInput = {
  vote?: ArtifactReviewVoteValue;
  comments: Array<{
    id?: string;
    body: string;
    severity?: (typeof artifactReviewSeverityValues)[number];
    anchor?: ArtifactReviewAnchor;
  }>;
};

export type ArtifactReviewContext = {
  run: RunState;
  review: ArtifactReview<RunEvent["artifact"]>;
  round: ArtifactReviewRound;
  assignment: ArtifactReviewAssignment;
};

export type ArtifactReviewAgentContext = ArtifactReviewContext & {
  attempt: ArtifactReviewAgentAttempt;
};

export function currentArtifactReview(run: RunState): ArtifactReview<RunEvent["artifact"]> | undefined {
  return run.artifactReviews?.find((review) => (
    review.status !== "passed" && review.status !== "cancelled" && currentStep(run)?.id === review.stepId
  ));
}

export async function findArtifactReview(input: {
  runsRoot: string;
  reviewId: string;
}): Promise<{ run: RunState; review: ArtifactReview<RunEvent["artifact"]> }> {
  for (const run of await listRuns(input.runsRoot)) {
    const review = run.artifactReviews?.find((candidate) => candidate.id === input.reviewId);
    if (review) return { run, review };
  }
  throw new Error(`Artifact Review not found: ${input.reviewId}`);
}

export async function readArtifactReviewForActor(input: {
  runsRoot: string;
  reviewId: string;
  roundId: string;
  actorId: string;
}): Promise<ArtifactReviewContext> {
  const { run, review } = await findArtifactReview(input);
  return artifactReviewForActor({ run, review, roundId: input.roundId, actorId: input.actorId });
}

export function artifactReviewForActor(input: {
  run: RunState;
  review: ArtifactReview<RunEvent["artifact"]>;
  roundId: string;
  actorId: string;
}): ArtifactReviewContext {
  const { run, review } = input;
  const round = review.rounds.find((candidate) => candidate.id === input.roundId);
  if (!round) throw new Error(`Artifact Review Round not found: ${input.roundId}`);
  const assignment = round.assignments.find((candidate) => candidate.actorId === input.actorId);
  if (!assignment) throw new Error(`Actor is not assigned to Artifact Review Round: ${input.actorId}`);
  const authorization = authorizeArtifactReviewActor({
    controlPlane: review.controlPlane,
    assignment,
    permission: "artifact.read"
  });
  if (!authorization.allowed) throw new ArtifactAuthorizationFailure(authorization, []);
  return { run, review, round, assignment };
}

export async function readArtifactReviewForRunner(input: {
  runsRoot: string;
  reviewId: string;
}): Promise<{ run: RunState; review: ArtifactReview<RunEvent["artifact"]>; round: ArtifactReviewRound }> {
  const { run, review } = await findArtifactReview(input);
  const authorization = authorizeArtifactOperation({
    controlPlane: review.controlPlane,
    subject: { kind: "runner" },
    permission: "artifact.read"
  });
  if (!authorization.allowed) throw new ArtifactAuthorizationFailure(authorization, []);
  return { run, review, round: currentReviewRound(review) };
}

export async function waitForArtifactReview(input: {
  runsRoot: string;
  reviewId: string;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}): Promise<{ run: RunState; review: ArtifactReview<RunEvent["artifact"]>; round: ArtifactReviewRound }> {
  const interval = input.pollIntervalMs ?? 1_000;
  if (!Number.isFinite(interval) || interval < 0) throw new Error("pollIntervalMs must be a non-negative number");
  while (true) {
    if (input.signal?.aborted) throw input.signal.reason ?? new Error("Artifact Review wait aborted");
    const context = await readArtifactReviewForRunner(input);
    if (context.round.assignments.some((assignment) => assignment.status === "failed")) return context;
    if (context.review.status !== "pending") return context;
    await sleep(interval, input.signal);
  }
}

export async function updateArtifactReviewDraft(input: {
  runsRoot: string;
  reviewId: string;
  roundId: string;
  actorId: string;
  expectedRevision: number;
  draft: ArtifactReviewDraftInput;
}): Promise<ArtifactReviewContext> {
  const located = await findArtifactReview({ runsRoot: input.runsRoot, reviewId: input.reviewId });
  return withRunWriteLock(input.runsRoot, located.run.id, async () => {
    const run = await readRun(input.runsRoot, located.run.id);
    assertRunRunning(run);
    const review = requireArtifactReview(run, input.reviewId);
    const round = requireArtifactReviewRound(review, input.roundId);
    if (review.status !== "pending" || round.status !== "pending") {
      throw new Error(`Artifact Review Round is read-only: ${round.id}`);
    }
    if (round.revision !== input.expectedRevision) {
      throw new ArtifactReviewConflictError(round.id, round.revision);
    }
    const assignment = requireArtifactReviewAssignment(round, input.actorId);
    if (assignment.status === "submitted") return { run, review, round, assignment };
    if ((assignment.actorKind ?? "human") === "agent") {
      throw new Error(`Agent Artifact Review assignment cannot use the Human draft API: ${assignment.actorId}`);
    }
    const permission = assignment.binding === "decision" ? "decision.decide" : "decision.assess";
    const authorization = authorizeArtifactReviewActor({
      controlPlane: review.controlPlane,
      assignment,
      permission
    });
    if (!authorization.allowed) throw new ArtifactAuthorizationFailure(authorization, []);
    const submission = reviewSubmission(review, round.submissionId);
    const now = new Date().toISOString();
    if (assignment.binding === "advisory" && input.draft.comments.some((comment) => !comment.severity)) {
      throw new Error("Advisory Artifact Review Comment severity is required");
    }
    const comments = normalizeArtifactReviewComments(
      input.draft.comments,
      submission,
      now,
      assignment.draft.comments
    );
    assignment.draft = {
      comments,
      vote: input.draft.vote,
      updatedAt: now
    };
    round.revision += 1;
    review.updatedAt = now;
    run.updatedAt = now;
    await writeRun(input.runsRoot, run);
    return { run, review, round, assignment };
  });
}

export async function submitArtifactReviewAssignment(input: {
  runsRoot: string;
  reviewId: string;
  roundId: string;
  actorId: string;
  expectedRevision: number;
}): Promise<ArtifactReviewContext> {
  const located = await findArtifactReview({ runsRoot: input.runsRoot, reviewId: input.reviewId });
  return withRunWriteLock(input.runsRoot, located.run.id, async () => {
    const run = await readRun(input.runsRoot, located.run.id);
    assertRunRunning(run);
    const review = requireArtifactReview(run, input.reviewId);
    const round = requireArtifactReviewRound(review, input.roundId);
    const assignment = requireArtifactReviewAssignment(round, input.actorId);
    if (assignment.status === "submitted") return { run, review, round, assignment };
    if ((assignment.actorKind ?? "human") === "agent") {
      throw new Error(`Agent Artifact Review assignment cannot use the Human submit API: ${assignment.actorId}`);
    }
    if (review.status !== "pending" || round.status !== "pending") {
      throw new Error(`Artifact Review Round is read-only: ${round.id}`);
    }
    if (round.revision !== input.expectedRevision) {
      throw new ArtifactReviewConflictError(round.id, round.revision);
    }
    const vote = assignment.draft.vote;
    if (!vote) throw new Error("Artifact Review vote is required before Submit Review");
    if ((vote === "request_changes" || vote === "abstain") && assignment.draft.comments.length === 0) {
      throw new Error(`${vote} requires at least one Comment`);
    }
    const permission = assignment.binding === "decision" ? "decision.decide" : "decision.assess";
    const authorization = authorizeArtifactReviewActor({
      controlPlane: review.controlPlane,
      assignment,
      permission
    });
    if (!authorization.allowed) throw new ArtifactAuthorizationFailure(authorization, []);

    const now = new Date().toISOString();
    assignment.status = "submitted";
    assignment.submitted = {
      comments: structuredClone(assignment.draft.comments),
      vote,
      submittedAt: now,
      authorization
    };
    round.votes.push(submittedAssignmentVote(assignment, authorization));
    round.revision += 1;
    review.updatedAt = now;
    const createdArtifactFiles: string[] = [];
    try {
      await settleArtifactReviewRound(input.runsRoot, run, review, round, createdArtifactFiles, now);
      run.updatedAt = now;
      await writeRun(input.runsRoot, run);
      return { run, review, round, assignment };
    } catch (error) {
      await removeArtifactFiles(createdArtifactFiles);
      throw error;
    }
  });
}

export async function claimArtifactReviewAgentAssignment(input: {
  runsRoot: string;
  reviewId: string;
  roundId: string;
  actorId: string;
  workerPid: number;
}): Promise<ArtifactReviewAgentContext | undefined> {
  const located = await findArtifactReview({ runsRoot: input.runsRoot, reviewId: input.reviewId });
  return withRunWriteLock(input.runsRoot, located.run.id, async () => {
    const run = await readRun(input.runsRoot, located.run.id);
    if (run.status !== "running") return undefined;
    const review = requireArtifactReview(run, input.reviewId);
    if (review.currentRoundId !== input.roundId || review.status !== "pending") return undefined;
    const round = requireArtifactReviewRound(review, input.roundId);
    const assignment = requireArtifactReviewAssignment(round, input.actorId);
    requireAgentReviewAssignment(assignment);
    if (assignment.status !== "queued") return undefined;
    const attempt = requireQueuedAgentAttempt(assignment);
    const now = new Date().toISOString();
    assignment.status = "running";
    attempt.status = "running";
    attempt.startedAt = now;
    attempt.workerPid = input.workerPid;
    round.revision += 1;
    review.updatedAt = now;
    run.updatedAt = now;
    await writeRun(input.runsRoot, run);
    return { run, review, round, assignment, attempt };
  });
}

export async function markArtifactReviewAgentCliReady(input: {
  runsRoot: string;
  reviewId: string;
  roundId: string;
  actorId: string;
  attemptId: string;
  protocolVersion?: number;
  sessionId?: string;
  agentName?: string;
  agentVersion?: string;
}): Promise<ArtifactReviewAgentContext> {
  return mutateArtifactReviewAgentAttempt(input, async (context) => {
    const now = new Date().toISOString();
    context.attempt.cliReadyAt ??= now;
    if (input.protocolVersion !== undefined) context.attempt.protocolVersion = input.protocolVersion;
    if (input.sessionId !== undefined) context.attempt.sessionId = input.sessionId;
    if (input.agentName !== undefined) context.attempt.agentName = input.agentName;
    if (input.agentVersion !== undefined) context.attempt.agentVersion = input.agentVersion;
  });
}

export async function recordArtifactReviewAgentSession(input: {
  runsRoot: string;
  reviewId: string;
  roundId: string;
  actorId: string;
  attemptId: string;
  protocolVersion: number;
  sessionId: string;
  agentName?: string;
  agentVersion?: string;
}): Promise<ArtifactReviewAgentContext> {
  return mutateArtifactReviewAgentAttempt(input, async (context) => {
    context.attempt.protocolVersion = input.protocolVersion;
    context.attempt.sessionId = input.sessionId;
    context.attempt.agentName = input.agentName;
    context.attempt.agentVersion = input.agentVersion;
  });
}

export async function recordArtifactReviewAgentStop(input: {
  runsRoot: string;
  reviewId: string;
  roundId: string;
  actorId: string;
  attemptId: string;
  stopReason: string;
}): Promise<ArtifactReviewAgentContext> {
  return mutateArtifactReviewAgentAttempt(input, async (context) => {
    context.attempt.stopReason = input.stopReason;
  });
}

export async function failArtifactReviewAgentAssignment(input: {
  runsRoot: string;
  reviewId: string;
  roundId: string;
  actorId: string;
  attemptId: string;
  failure: ArtifactReviewAgentFailure;
  stopReason?: string;
}): Promise<ArtifactReviewAgentContext> {
  return mutateArtifactReviewAgentAttempt(input, async (context) => {
    if (context.assignment.status === "submitted") return;
    const now = new Date().toISOString();
    context.assignment.status = "failed";
    context.attempt.status = "failed";
    context.attempt.failure = structuredClone(input.failure);
    context.attempt.stopReason = input.stopReason;
    context.attempt.completedAt = now;
  });
}

export async function retryArtifactReviewAgentAssignment(input: {
  runsRoot: string;
  reviewId: string;
  roundId: string;
  actorId: string;
}): Promise<ArtifactReviewAgentContext> {
  const located = await findArtifactReview({ runsRoot: input.runsRoot, reviewId: input.reviewId });
  return withRunWriteLock(input.runsRoot, located.run.id, async () => {
    const run = await readRun(input.runsRoot, located.run.id);
    assertRunRunning(run);
    const review = requireArtifactReview(run, input.reviewId);
    if (review.currentRoundId !== input.roundId || review.status !== "pending") {
      throw new Error(`Artifact Review Round is read-only: ${input.roundId}`);
    }
    const round = requireArtifactReviewRound(review, input.roundId);
    const assignment = requireArtifactReviewAssignment(round, input.actorId);
    requireAgentReviewAssignment(assignment);
    if (assignment.status !== "failed") {
      throw new Error(`Agent Artifact Review assignment is not failed: ${assignment.actorId}`);
    }
    const attempts = (assignment.attempts ??= []);
    const now = new Date().toISOString();
    const previous = attempts.at(-1);
    const attempt: ArtifactReviewAgentAttempt = {
      id: makeReviewEntityId("attempt", now),
      sequence: (previous?.sequence ?? 0) + 1,
      status: "queued",
      provider: previous?.provider ?? "unconfigured",
      createdAt: now,
      promptVersion: previous?.promptVersion,
      model: previous?.model
    };
    attempts.push(attempt);
    assignment.status = "queued";
    assignment.draft = { comments: [] };
    round.revision += 1;
    review.updatedAt = now;
    run.updatedAt = now;
    await writeRun(input.runsRoot, run);
    return { run, review, round, assignment, attempt };
  });
}

export async function appendArtifactReviewAgentComment(input: {
  runsRoot: string;
  reviewId: string;
  roundId: string;
  actorId: string;
  attemptId: string;
  body: string;
  severity: (typeof artifactReviewSeverityValues)[number];
  anchor?: ArtifactReviewAgentAnchorInput;
}): Promise<ArtifactReviewAgentContext> {
  const located = await findArtifactReview({ runsRoot: input.runsRoot, reviewId: input.reviewId });
  return withRunWriteLock(input.runsRoot, located.run.id, async () => {
    const context = requireRunningAgentContext(await readRun(input.runsRoot, located.run.id), input);
    const authorization = authorizeArtifactReviewActor({
      controlPlane: context.review.controlPlane,
      assignment: context.assignment,
      permission: context.assignment.binding === "decision" ? "decision.decide" : "decision.assess"
    });
    if (!authorization.allowed) throw new ArtifactAuthorizationFailure(authorization, []);
    const submission = reviewSubmission(context.review, context.round.submissionId);
    const now = new Date().toISOString();
    const anchor = input.anchor
      ? { ...input.anchor, submissionId: input.anchor.submissionId ?? submission.id }
      : undefined;
    context.assignment.draft = {
      ...context.assignment.draft,
      comments: normalizeArtifactReviewComments(
        [...context.assignment.draft.comments, { body: input.body, severity: input.severity, anchor }],
        submission,
        now,
        context.assignment.draft.comments
      ),
      updatedAt: now
    };
    context.round.revision += 1;
    context.review.updatedAt = now;
    context.run.updatedAt = now;
    await writeRun(input.runsRoot, context.run);
    return context;
  });
}

export async function submitArtifactReviewAgentAssignment(input: {
  runsRoot: string;
  reviewId: string;
  roundId: string;
  actorId: string;
  attemptId: string;
  vote: ArtifactReviewVoteValue;
  summary?: string;
}): Promise<ArtifactReviewAgentContext> {
  const located = await findArtifactReview({ runsRoot: input.runsRoot, reviewId: input.reviewId });
  return withRunWriteLock(input.runsRoot, located.run.id, async () => {
    const run = await readRun(input.runsRoot, located.run.id);
    assertRunRunning(run);
    const review = requireArtifactReview(run, input.reviewId);
    const round = requireArtifactReviewRound(review, input.roundId);
    const assignment = requireArtifactReviewAssignment(round, input.actorId);
    requireAgentReviewAssignment(assignment);
    const attempt = requireArtifactReviewAgentAttempt(assignment, input.attemptId);
    const summary = input.summary?.trim() || undefined;
    if (assignment.status === "submitted" && assignment.submitted) {
      if (assignment.submitted.vote === input.vote && assignment.submitted.summary === summary) {
        return { run, review, round, assignment, attempt };
      }
      throw new Error(`Agent Artifact Review assignment is already submitted: ${assignment.actorId}`);
    }
    const context = requireRunningAgentContext(run, input);
    if (!context.attempt.cliReadyAt) throw new Error("Agent Review CLI handshake is required before submit");
    if (
      (input.vote === "request_changes" || input.vote === "abstain")
      && context.assignment.draft.comments.length === 0
      && !summary
    ) {
      throw new Error(`${input.vote} requires at least one Comment or Summary`);
    }
    const permission = context.assignment.binding === "decision" ? "decision.decide" : "decision.assess";
    const authorization = authorizeArtifactReviewActor({
      controlPlane: context.review.controlPlane,
      assignment: context.assignment,
      permission
    });
    if (!authorization.allowed) throw new ArtifactAuthorizationFailure(authorization, []);
    const now = new Date().toISOString();
    context.assignment.draft.vote = input.vote;
    context.assignment.draft.updatedAt = now;
    context.assignment.status = "submitted";
    context.assignment.submitted = {
      comments: structuredClone(context.assignment.draft.comments),
      vote: input.vote,
      summary,
      submittedAt: now,
      authorization
    };
    context.attempt.status = "submitted";
    context.attempt.completedAt = now;
    context.round.votes.push(submittedAssignmentVote(context.assignment, authorization));
    context.round.revision += 1;
    context.review.updatedAt = now;
    const createdArtifactFiles: string[] = [];
    try {
      await settleArtifactReviewRound(input.runsRoot, context.run, context.review, context.round, createdArtifactFiles, now);
      context.run.updatedAt = now;
      await writeRun(input.runsRoot, context.run);
      return context;
    } catch (error) {
      await removeArtifactFiles(createdArtifactFiles);
      throw error;
    }
  });
}

export type ArtifactReviewRunnerVoteContext = {
  run: RunState;
  review: ArtifactReview<RunEvent["artifact"]>;
  round: ArtifactReviewRound;
};

export async function resolveArtifactReviewComment(input: {
  runsRoot: string;
  reviewId: string;
  roundId: string;
  commentId: string;
  disposition: ArtifactReviewDispositionValue;
  note?: string;
  validationSummary?: string;
}): Promise<ArtifactReviewRunnerVoteContext> {
  const located = await findArtifactReview({ runsRoot: input.runsRoot, reviewId: input.reviewId });
  return withRunWriteLock(input.runsRoot, located.run.id, async () => {
    const run = await readRun(input.runsRoot, located.run.id);
    assertRunRunning(run);
    const review = requireArtifactReview(run, input.reviewId);
    if (review.currentRoundId !== input.roundId || !["pending", "awaiting_runner_vote"].includes(review.status)) {
      throw new Error(`Artifact Review Round is read-only: ${input.roundId}`);
    }
    const round = requireArtifactReviewRound(review, input.roundId);
    const advisoryComment = round.assignments
      .filter((assignment) => assignment.binding === "advisory")
      .flatMap((assignment) => assignment.submitted?.comments ?? assignment.draft.comments)
      .find((comment) => comment.id === input.commentId);
    if (!advisoryComment) throw new Error(`Advisory Artifact Review Comment not found: ${input.commentId}`);
    const note = input.note?.trim() || undefined;
    const validationSummary = input.validationSummary?.trim() || undefined;
    if (!note) throw new Error("Artifact Review Comment disposition requires a note");
    if (input.disposition === "accepted-fixed" && !validationSummary) {
      throw new Error("accepted-fixed requires a validation summary");
    }
    const authorization = authorizeArtifactOperation({
      controlPlane: review.controlPlane,
      subject: { kind: "runner" },
      permission: "decision.decide"
    });
    if (!authorization.allowed) throw new ArtifactAuthorizationFailure(authorization, []);
    const now = new Date().toISOString();
    const dispositions = (round.commentDispositions ??= []);
    const existing = dispositions.find((item) => item.commentId === input.commentId);
    const value = {
      commentId: input.commentId,
      disposition: input.disposition,
      note,
      validationSummary,
      updatedAt: now
    };
    if (existing) Object.assign(existing, value);
    else dispositions.push(value);
    round.revision += 1;
    review.updatedAt = now;
    run.updatedAt = now;
    await writeRun(input.runsRoot, run);
    return { run, review, round };
  });
}

export async function submitArtifactReviewRunnerVote(input: {
  runsRoot: string;
  reviewId: string;
  roundId: string;
  vote: "approve" | "request_changes";
  comment?: string;
}): Promise<ArtifactReviewRunnerVoteContext> {
  const located = await findArtifactReview({ runsRoot: input.runsRoot, reviewId: input.reviewId });
  return withRunWriteLock(input.runsRoot, located.run.id, async () => {
    const run = await readRun(input.runsRoot, located.run.id);
    assertRunRunning(run);
    const review = requireArtifactReview(run, input.reviewId);
    if (review.currentRoundId !== input.roundId) {
      throw new Error(`Artifact Review Runner vote targets a stale Round: ${input.roundId}`);
    }
    const round = requireArtifactReviewRound(review, input.roundId);
    const comment = input.comment?.trim() || undefined;
    const existingVote = round.votes.find((candidate) => candidate.subject.kind === "runner");
    if (existingVote) {
      if (!existingVote.automatic && existingVote.value === input.vote && existingVote.comment === comment) {
        return { run, review, round };
      }
      throw new Error(`Runner has already voted in Artifact Review Round: ${round.id}`);
    }
    if (review.status !== "awaiting_runner_vote" || round.status !== "awaiting_runner_vote") {
      throw new Error(`Artifact Review Round is not awaiting a Runner vote: ${round.id}`);
    }
    if (input.vote === "request_changes" && !comment) {
      throw new Error("Runner request_changes requires --comment or --comment-file");
    }
    const authorization = authorizeArtifactOperation({
      controlPlane: review.controlPlane,
      subject: { kind: "runner" },
      permission: "decision.decide"
    });
    if (!authorization.allowed) throw new ArtifactAuthorizationFailure(authorization, []);

    const now = new Date().toISOString();
    round.votes.push({
      id: makeReviewEntityId("vote", now),
      subject: { kind: "runner" },
      binding: "decision",
      value: input.vote,
      automatic: false,
      comment,
      authorization,
      submittedAt: now
    });
    round.revision += 1;
    review.updatedAt = now;
    const createdArtifactFiles: string[] = [];
    try {
      await settleArtifactReviewRound(input.runsRoot, run, review, round, createdArtifactFiles, now);
      run.updatedAt = now;
      await writeRun(input.runsRoot, run);
      return { run, review, round };
    } catch (error) {
      await removeArtifactFiles(createdArtifactFiles);
      throw error;
    }
  });
}

export class ArtifactReviewConflictError extends Error {
  constructor(readonly roundId: string, readonly actualRevision: number) {
    super(`Artifact Review Round revision conflict: ${roundId}; current revision is ${actualRevision}`);
    this.name = "ArtifactReviewConflictError";
  }
}

async function settleArtifactReviewRound(
  runsRoot: string,
  run: RunState,
  review: ArtifactReview<RunEvent["artifact"]>,
  round: ArtifactReviewRound,
  createdArtifactFiles: string[],
  now: string
): Promise<void> {
  if (round.assignments.some((assignment) => assignment.status !== "submitted")) return;

  const identityDecisionVotes = round.votes.filter(
    (vote) => vote.subject.kind === "actor" && vote.binding === "decision"
  );
  const identityDecisionRejected = identityDecisionVotes.some((vote) => vote.value !== "approve");
  const runnerAuthorization = authorizeArtifactOperation({
    controlPlane: review.controlPlane,
    subject: { kind: "runner" },
    permission: "decision.decide"
  });
  const runnerVote = round.votes.find(
    (vote) => vote.subject.kind === "runner" && vote.binding === "decision"
  );

  if (!identityDecisionRejected && runnerAuthorization.allowed && !runnerVote) {
    round.status = "awaiting_runner_vote";
    review.status = "awaiting_runner_vote";
    return;
  }

  const result = evaluateArtifactReviewRound(round, now);
  if (!result) return;
  round.result = result;
  round.status = result.status;
  if (result.status === "passed") {
    await acceptArtifactReviewSubmission(runsRoot, run, review, round, createdArtifactFiles, now);
  } else {
    review.status = "awaiting_revision";
  }
}

async function acceptArtifactReviewSubmission(
  runsRoot: string,
  run: RunState,
  review: ArtifactReview<RunEvent["artifact"]>,
  round: ArtifactReviewRound,
  createdArtifactFiles: string[],
  now: string
): Promise<void> {
  const frame = currentFrame(run);
  const step = currentStep(run);
  if (!frame || !step || step.id !== review.stepId) {
    throw new Error(`Artifact Review current Step changed before acceptance: ${review.stepId}`);
  }
  const submission = reviewSubmission(review, round.submissionId);
  run.events.push({
    at: now,
    frame: frame.type,
    stepId: step.id,
    artifact: structuredClone(submission.artifact)
  });
  const controlValue = step.kind === "branch" || step.kind === "loop"
    ? submission.artifact.value
    : undefined;
  frame.index += 1;
  applyControlStep(frame, step, controlValue);
  markSchemaDraftAccepted(run, step.id, submission.artifact.path);
  await collapseCompletedFrames(runsRoot, run, createdArtifactFiles);
  await expandAutoCallSteps(run);
  review.status = "passed";
  review.currentRoundId = round.id;
  review.updatedAt = now;
  review.outcome = {
    status: "passed",
    submissionId: submission.id,
    roundId: round.id,
    completedAt: now
  };
}

function normalizeArtifactReviewComments(
  comments: ArtifactReviewDraftInput["comments"],
  submission: Pick<ArtifactReviewSubmission, "id" | "digest">,
  now: string,
  existingComments: readonly ArtifactReviewComment[] = []
): ArtifactReviewComment[] {
  const existingById = new Map(existingComments.map((comment) => [comment.id, comment]));
  const ids = new Set<string>();
  return comments.map((comment) => {
    const body = comment.body.trim();
    if (!body) throw new Error("Artifact Review Comment body must not be empty");
    let anchor: ArtifactReviewAnchor | undefined;
    if (comment.anchor) {
      if (comment.anchor.submissionId !== submission.id || comment.anchor.sourceHash !== submission.digest) {
        throw new Error("Artifact Review Comment anchor does not match the current Submission");
      }
      const target = comment.anchor.target.trim();
      if (!target) throw new Error("Artifact Review Comment anchor target must not be empty");
      const context = comment.anchor.context?.trim();
      if (context && context.length > 500) {
        throw new Error("Artifact Review Comment anchor context must not exceed 500 characters");
      }
      anchor = {
        submissionId: submission.id,
        sourceHash: submission.digest,
        target,
        location: comment.anchor.location?.trim() || undefined,
        context: context || undefined
      };
    }
    const id = comment.id?.trim() || makeReviewEntityId("comment", now);
    if (ids.has(id)) throw new Error(`Duplicate Artifact Review Comment id: ${id}`);
    ids.add(id);
    const existing = existingById.get(id);
    return {
      id,
      body,
      severity: comment.severity ?? existing?.severity,
      anchor,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
  });
}

function requireArtifactReview(run: RunState, reviewId: string): ArtifactReview<RunEvent["artifact"]> {
  const review = run.artifactReviews?.find((candidate) => candidate.id === reviewId);
  if (!review) throw new Error(`Artifact Review not found: ${reviewId}`);
  return review;
}

function requireArtifactReviewRound(
  review: ArtifactReview<RunEvent["artifact"]>,
  roundId: string
): ArtifactReviewRound {
  const round = review.rounds.find((candidate) => candidate.id === roundId);
  if (!round) throw new Error(`Artifact Review Round not found: ${roundId}`);
  return round;
}

function requireArtifactReviewAssignment(round: ArtifactReviewRound, assignmentId: string): ArtifactReviewAssignment {
  const assignment = round.assignments.find((candidate) =>
    candidate.id === assignmentId || candidate.actorId === assignmentId
  );
  if (!assignment) throw new Error(`Artifact Review Assignment not found: ${assignmentId}`);
  return assignment;
}

function requireAgentReviewAssignment(assignment: ArtifactReviewAssignment): void {
  if ((assignment.actorKind ?? "human") !== "agent") {
    throw new Error(`Artifact Review assignment is not an Agent assignment: ${assignment.actorId}`);
  }
}

function requireArtifactReviewAgentAttempt(
  assignment: ArtifactReviewAssignment,
  attemptId: string
): ArtifactReviewAgentAttempt {
  const attempt = assignment.attempts?.find((candidate) => candidate.id === attemptId);
  if (!attempt) throw new Error(`Artifact Review Agent Attempt not found: ${attemptId}`);
  return attempt;
}

function requireQueuedAgentAttempt(assignment: ArtifactReviewAssignment): ArtifactReviewAgentAttempt {
  const attempt = assignment.attempts?.at(-1);
  if (!attempt || attempt.status !== "queued") {
    throw new Error(`Agent Artifact Review assignment has no queued Attempt: ${assignment.actorId}`);
  }
  return attempt;
}

function requireRunningAgentContext(
  run: RunState,
  input: { reviewId: string; roundId: string; actorId: string; attemptId: string }
): ArtifactReviewAgentContext {
  const review = requireArtifactReview(run, input.reviewId);
  if (review.currentRoundId !== input.roundId || review.status !== "pending") {
    throw new Error(`Artifact Review Round is read-only: ${input.roundId}`);
  }
  const round = requireArtifactReviewRound(review, input.roundId);
  if (round.status !== "pending") throw new Error(`Artifact Review Round is read-only: ${round.id}`);
  const assignment = requireArtifactReviewAssignment(round, input.actorId);
  requireAgentReviewAssignment(assignment);
  if (assignment.status !== "running") {
    throw new Error(`Agent Artifact Review assignment is not running: ${assignment.actorId}`);
  }
  const attempt = requireArtifactReviewAgentAttempt(assignment, input.attemptId);
  if (attempt.status !== "running") {
    throw new Error(`Artifact Review Agent Attempt is not running: ${attempt.id}`);
  }
  return { run, review, round, assignment, attempt };
}

async function mutateArtifactReviewAgentAttempt(
  input: {
    runsRoot: string;
    reviewId: string;
    roundId: string;
    actorId: string;
    attemptId: string;
  },
  mutate: (context: ArtifactReviewAgentContext) => Promise<void>
): Promise<ArtifactReviewAgentContext> {
  const located = await findArtifactReview({ runsRoot: input.runsRoot, reviewId: input.reviewId });
  return withRunWriteLock(input.runsRoot, located.run.id, async () => {
    const run = await readRun(input.runsRoot, located.run.id);
    assertRunRunning(run);
    const review = requireArtifactReview(run, input.reviewId);
    const round = requireArtifactReviewRound(review, input.roundId);
    const assignment = requireArtifactReviewAssignment(round, input.actorId);
    requireAgentReviewAssignment(assignment);
    const attempt = requireArtifactReviewAgentAttempt(assignment, input.attemptId);
    const context = { run, review, round, assignment, attempt };
    await mutate(context);
    const now = new Date().toISOString();
    round.revision += 1;
    review.updatedAt = now;
    run.updatedAt = now;
    await writeRun(input.runsRoot, run);
    return context;
  });
}

function activeReviewForStep(
  run: RunState,
  step: RunStep
): ArtifactReview<RunEvent["artifact"]> | undefined {
  return run.artifactReviews?.find((review) => (
    review.stepId === step.id
    && review.status !== "passed"
    && review.status !== "cancelled"
    && (!step.controlPlane || review.controlPlane.artifactScope === step.controlPlane.artifactScope)
  ));
}

function currentReviewRound(review: ArtifactReview<RunEvent["artifact"]>): ArtifactReviewRound {
  return requireArtifactReviewRound(review, review.currentRoundId);
}

function reviewSubmission(
  review: ArtifactReview<RunEvent["artifact"]>,
  submissionId: string
): ArtifactReview<RunEvent["artifact"]>["submissions"][number] {
  const submission = review.submissions.find((candidate) => candidate.id === submissionId);
  if (!submission) throw new Error(`Artifact Review Submission not found: ${submissionId}`);
  return submission;
}

function digestBytes(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digestText(value: string): string {
  return digestBytes(new TextEncoder().encode(value));
}

async function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolveDelay, rejectDelay) => {
    const abort = () => {
      clearTimeout(timeout);
      rejectDelay(signal?.reason ?? new Error("Artifact Review wait aborted"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolveDelay();
    }, milliseconds);
    if (!signal) return;
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function authorizeRunnerForReport(
  run: RunState,
  step: RunStep,
  locale: "zh-CN" | "en"
): AuthorizationDecision | undefined {
  if (!step.controlPlane) return undefined;
  if (!run.controlPlane) throw new Error(`control plane snapshot missing for governed Artifact ${step.id}`);
  const decision = authorizeArtifactOperation({
    controlPlane: step.controlPlane,
    subject: { kind: "runner" },
    permission: "artifact.submit"
  });
  if (decision.allowed) return decision;
  const runnerPermissions = step.controlPlane.permissions.runner ?? {
    base: [],
    grants: [],
    effective: [],
    authoritySource: "config:control_plane.runner"
  };
  const guidance = renderPermissionGuidance({
    snapshot: run.controlPlane,
    actorId: "runner",
    permissions: runnerPermissions,
    artifactScope: step.controlPlane.artifactScope,
    locale,
    decision
  });
  throw new ArtifactAuthorizationFailure(decision, guidance.lines);
}

export async function repeatRun(input: { runsRoot: string; runId: string; count: number }): Promise<RunState> {
  return withRunWriteLock(input.runsRoot, input.runId, () => repeatRunUnlocked(input));
}

export async function skipRun(input: { runsRoot: string; runId: string }): Promise<RunState> {
  return withRunWriteLock(input.runsRoot, input.runId, () => skipRunUnlocked(input));
}

async function skipRunUnlocked(input: { runsRoot: string; runId: string }): Promise<RunState> {
  const run = await readRun(input.runsRoot, input.runId);
  if (run.contractVersion === 1 || run.readOnly) {
    throw new Error(`v1 run is read-only and cannot skip after the Artifact Contract v2 upgrade: ${input.runId}`);
  }
  assertRunRunning(run);

  const frame = currentFrame(run);
  const step = currentStep(run);
  if (step?.kind === "repeat") {
    throw new Error(`current step is Repeat control; use memsphere run repeat <count> --run ${input.runId}`);
  }
  if (!frame || !step || !step.artifact || !step.type || !step.format) {
    throw new Error(`run has no skippable current step: ${input.runId}`);
  }
  if (step.optional !== true) {
    throw new Error(`current step is required and cannot be skipped: ${step.id}`);
  }

  run.events.push({
    at: new Date().toISOString(),
    frame: frame.type,
    stepId: step.id,
    artifact: {
      name: step.artifact,
      type: step.type,
      format: step.format,
      fields: { skipped: true },
      schema: step.schema,
      storage: "inline",
      value: ""
    }
  });

  frame.index += 1;
  await collapseCompletedFrames(input.runsRoot, run);
  await expandAutoCallSteps(run);
  run.updatedAt = new Date().toISOString();
  await writeRun(input.runsRoot, run);
  return run;
}

async function repeatRunUnlocked(input: { runsRoot: string; runId: string; count: number }): Promise<RunState> {
  const run = await readRun(input.runsRoot, input.runId);
  if (run.contractVersion === 1 || run.readOnly) {
    throw new Error(`v1 run is read-only and cannot continue after the Artifact Contract v2 upgrade: ${input.runId}`);
  }
  assertRunRunning(run);

  const frame = currentFrame(run);
  const step = currentStep(run);
  if (!frame || step?.kind !== "repeat" || !step.repeat) {
    throw new Error(`current step is not Repeat control: ${input.runId}`);
  }
  if (!Number.isSafeInteger(input.count) || input.count < 0) {
    throw new Error("repeat count must be a non-negative integer");
  }
  if (input.count < step.repeat.min) {
    throw new Error(`repeat count must be at least ${step.repeat.min}`);
  }
  if (step.repeat.max !== undefined && input.count > step.repeat.max) {
    throw new Error(`repeat count must be at most ${step.repeat.max}`);
  }

  const createdArtifactFiles: string[] = [];
  try {
    const expanded = compileRepeatBody(step.repeat, input.count, step.controlPlane, step.schemaContext);
    frame.steps.splice(frame.index, 1, ...expanded);
    await collapseCompletedFrames(input.runsRoot, run, createdArtifactFiles);
    await expandAutoCallSteps(run);
    run.updatedAt = new Date().toISOString();
    await writeRun(input.runsRoot, run);
    return run;
  } catch (error) {
    await removeArtifactFiles(createdArtifactFiles);
    throw error;
  }
}

export function artifactInlineValue(artifact: RunEvent["artifact"]): unknown {
  if (artifact.storage === "file") {
    throw new Error(`artifact is stored as file and has no inline value: ${artifact.name}`);
  }
  return artifact.value ?? "";
}

export function artifactSchemaName(artifact: RunEvent["artifact"]): string | undefined {
  return artifact.schema?.kind === "external" ? artifact.schema.name : undefined;
}

export async function enterSchema(input: { memoryRoot: string; runsRoot: string; runId: string; schemaName?: string }): Promise<RunState> {
  return withRunWriteLock(input.runsRoot, input.runId, () => enterSchemaUnlocked(input));
}

async function enterSchemaUnlocked(input: { memoryRoot: string; runsRoot: string; runId: string; schemaName?: string }): Promise<RunState> {
  const run = await readRun(input.runsRoot, input.runId);
  if (run.contractVersion === 1 || run.readOnly) {
    throw new Error(`v1 run is read-only and cannot enter schema after the Artifact Contract v2 upgrade: ${input.runId}`);
  }
  assertRunRunning(run);

  const activeStep = currentStep(run);
  if (!input.schemaName) {
    if (activeStep?.schema?.kind !== "inline") {
      throw new Error("current Artifact does not use an inline schema; provide an external schema name");
    }
    const steps = compileSchemaSteps(activeStep.schema.node, activeStep.schema.id, stepContract(activeStep), activeStep.controlPlane);
    if (!steps.length) throw new Error(`inline schema has no executable fields: ${activeStep.artifact}`);
    run.stack.push({
      type: "schema",
      memoryName: activeStep.schema.id,
      sourceStepId: activeStep.id,
      eventStartIndex: run.events.length,
      steps,
      index: 0
    });
  } else {
    if (activeStep?.schema?.kind !== "external") {
      throw new Error("current Artifact does not use an external schema; omit the name for an inline schema");
    }
    if (activeStep.schema.name !== input.schemaName) {
      throw new Error(`current Artifact requires schema ${activeStep.schema.name}, not ${input.schemaName}`);
    }
    if (!activeStep.schema.node) throw new Error(`schema snapshot missing from Run contract: ${input.schemaName}`);
    const schemaName = activeStep.schema.name;
    const steps = compileSchemaSteps(activeStep.schema.node, schemaName, stepContract(activeStep), activeStep.controlPlane);
    if (!steps.length) throw new Error(`schema has no executable fields: ${input.schemaName}`);
    run.stack.push({
      type: "schema",
      memoryName: schemaName,
      sourceStepId: activeStep?.id,
      eventStartIndex: run.events.length,
      steps,
      index: 0
    });
  }
  run.updatedAt = new Date().toISOString();
  await writeRun(input.runsRoot, run);
  return run;
}

export function currentStep(run: RunState): RunStep | undefined {
  if (run.status !== "running") return undefined;
  const frame = currentFrame(run);
  return frame ? frame.steps[frame.index] : undefined;
}

export function currentFrame(run: RunState): RunFrame | undefined {
  return run.stack.at(-1);
}

export function activeProcedureAsserts(run: RunState): string[] {
  return [...new Set([
    ...(run.asserts ?? []),
    ...run.stack
      .filter((frame) => frame.type === "procedure")
      .flatMap((frame) => frame.asserts ?? [])
  ])];
}

export function finalArtifacts(run: RunState): RunEvent["artifact"][] {
  return run.events.filter((event) => event.artifact.final).map((event) => event.artifact);
}

type SchemaParentContext = {
  schemaFrame: RunFrame;
  parentFrame: RunFrame;
  parentStep: RunStep;
};

export type SchemaFinalizationContext = SchemaParentContext & {
  draft: SchemaDraftState;
};

export type SchemaWritingSnapshot = {
  runId: string;
  procedureName: string;
  parentStepId: string;
  action: {
    instruction: string;
    asserts: string[];
    suggests: string[];
  };
  artifact: {
    name: string;
    type?: string;
    format?: ArtifactFormatSpec;
    schema?: RunSchemaContract;
    final: boolean;
  };
  progress: {
    completed: number;
    total: number;
    remaining: number;
    pendingRepeatControls: number;
    current?: string;
    fields: Array<{
      id: string;
      path: string;
      status: "completed" | "current" | "remaining";
    }>;
  };
  currentField?: {
    id: string;
    path: string;
    type?: string;
    format?: ArtifactFormatSpec;
    sources: SchemaConstraintSource[];
  };
  draft?: SchemaDraftState & { filePath: string };
};

export function currentSchemaFinalization(run: RunState): SchemaFinalizationContext | undefined {
  const context = currentSchemaParentContext(run);
  if (!context || context.schemaFrame.index < context.schemaFrame.steps.length) return undefined;
  const draft = run.schemaDrafts?.[context.parentStep.id];
  if (!draft || draft.status !== "awaiting_finalization") return undefined;
  return { ...context, draft };
}

export function buildSchemaWritingSnapshot(runsRoot: string, run: RunState): SchemaWritingSnapshot | undefined {
  const context = currentSchemaParentContext(run);
  if (!context) return undefined;
  const events = run.events.slice(context.schemaFrame.eventStartIndex ?? 0);
  const completedIds = new Set(events.map((event) => event.stepId));
  const fieldSteps = context.schemaFrame.steps.filter((step) => step.artifact && step.kind !== "repeat");
  const current = currentStep(run);
  const draft = run.schemaDrafts?.[context.parentStep.id];
  return {
    runId: run.id,
    procedureName: context.parentFrame.memoryName,
    parentStepId: context.parentStep.id,
    action: {
      instruction: context.parentStep.instruction,
      asserts: [...(context.parentStep.asserts ?? [])],
      suggests: [...(context.parentStep.suggests ?? [])]
    },
    artifact: {
      name: context.parentStep.artifact!,
      type: context.parentStep.type,
      format: context.parentStep.format ? structuredClone(context.parentStep.format) : undefined,
      schema: context.parentStep.schema ? structuredClone(context.parentStep.schema) : undefined,
      final: context.parentStep.final === true
    },
    progress: {
      completed: fieldSteps.filter((step) => completedIds.has(step.id)).length,
      total: fieldSteps.length,
      remaining: fieldSteps.filter((step) => !completedIds.has(step.id)).length,
      pendingRepeatControls: context.schemaFrame.steps.filter((step) => step.kind === "repeat").length,
      current: current?.schemaContext?.path ?? current?.artifact,
      fields: fieldSteps.map((step) => ({
        id: step.id,
        path: step.schemaContext?.path ?? step.artifact!,
        status: completedIds.has(step.id)
          ? "completed" as const
          : current?.id === step.id
            ? "current" as const
            : "remaining" as const
      }))
    },
    currentField: current?.artifact && current.kind !== "repeat"
      ? {
          id: current.id,
          path: current.schemaContext?.path ?? current.artifact,
          type: current.type,
          format: current.format ? structuredClone(current.format) : undefined,
          sources: structuredClone(current.schemaContext?.sources ?? [])
        }
      : undefined,
    draft: draft ? { ...structuredClone(draft), filePath: resolve(runsRoot, draft.path) } : undefined
  };
}

export async function ensureCurrentSchemaDraft(runsRoot: string, run: RunState): Promise<RunState> {
  if (run.status !== "running") return run;
  const context = currentSchemaParentContext(run);
  if (!context) return run;
  const progress = schemaFrameProgress(run, context.schemaFrame);
  if (progress.completed === 0) return run;
  const draft = run.schemaDrafts?.[context.parentStep.id];
  const path = draft ? resolve(runsRoot, draft.path) : undefined;
  const missing = !path || !(await fileExists(path));
  if (!missing) return run;

  await refreshSchemaDraft(
    runsRoot,
    run,
    context,
    progress,
    context.schemaFrame.index >= context.schemaFrame.steps.length
  );
  run.updatedAt = new Date().toISOString();
  await writeRun(runsRoot, run);
  return run;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function currentSchemaParentContext(run: RunState): SchemaParentContext | undefined {
  const schemaFrame = currentFrame(run);
  if (!schemaFrame || schemaFrame.type !== "schema") return undefined;
  const parentFrame = run.stack.at(-2);
  const parentStep = parentFrame?.steps[parentFrame.index];
  if (
    !parentFrame ||
    !parentStep ||
    !parentStep.artifact ||
    !parentStep.schema ||
    schemaFrame.sourceStepId !== parentStep.id
  ) return undefined;
  return { schemaFrame, parentFrame, parentStep };
}

async function reportSchemaFinalArtifact(
  input: {
    runsRoot: string;
    runId: string;
    artifact: ArtifactReportSource;
    revisionSummary?: string;
    locale?: "zh-CN" | "en";
    beforeArtifactReview?: () => Promise<unknown>;
  },
  run: RunState,
  finalization: SchemaFinalizationContext
): Promise<RunState> {
  if (input.revisionSummary !== undefined) {
    throw new Error("--revision-summary-file is only allowed after an Artifact Review requests changes");
  }
  await assertManagedSchemaDraftSource(input.runsRoot, run.id, finalization.draft, input.artifact);

  const step = finalization.parentStep;
  const authorization = authorizeRunnerForReport(run, step, input.locale ?? "en");
  const contract = await contractForStep(run, step);
  const context = {
    runId: run.id,
    stepId: step.id,
    artifactPath: step.id,
    attemptId: randomUUID()
  };

  let candidate: PreparedArtifactCandidate;
  let validation: ArtifactValidationResult;
  try {
    candidate = await prepareArtifactCandidate(contract, input.artifact, context);
    const plan = step.validationPlan ?? artifactValidatorRegistry.resolvePlan(contract);
    validation = await artifactValidatorRegistry.execute(plan, { contract, candidate, context });
  } catch (error) {
    if (error instanceof ArtifactValidationFailure) {
      await persistSchemaDraftValidation(input.runsRoot, run, finalization.draft, error.result);
    }
    throw error;
  }
  if (validation.status !== "passed") {
    await persistSchemaDraftValidation(input.runsRoot, run, finalization.draft, validation);
    throw new ArtifactValidationFailure(validation);
  }

  const popped = run.stack.pop();
  if (popped !== finalization.schemaFrame || currentFrame(run) !== finalization.parentFrame) {
    throw new Error(`Schema frame changed before final submission: ${step.id}`);
  }
  finalization.draft.status = "submitted";
  finalization.draft.submittedDigest = digestBytes(candidate.raw);
  finalization.draft.validation = validation;
  finalization.draft.updatedAt = new Date().toISOString();
  return acceptPreparedArtifact(input, run, step, candidate, validation, authorization);
}

async function assertManagedSchemaDraftSource(
  runsRoot: string,
  runId: string,
  draft: SchemaDraftState,
  source: ArtifactReportSource
): Promise<void> {
  if (source.kind !== "file") {
    throw new Error("Schema finalization requires --artifact-file with the managed draft path");
  }
  const expected = resolve(runsRoot, draft.path);
  if (resolve(source.path) !== expected) {
    throw new Error(`Schema finalization requires the managed draft file: ${expected}`);
  }
  const artifactRoot = resolve(runArtifactDirectory(runsRoot, runId));
  const sourceStat = await lstat(source.path);
  if (sourceStat.isSymbolicLink()) {
    throw new Error(`managed Schema draft must not be a symbolic link: ${expected}`);
  }
  if (!sourceStat.isFile()) {
    throw new Error(`managed Schema draft must be a regular file: ${expected}`);
  }
  const actual = await realpath(source.path);
  const root = await realpath(artifactRoot);
  assertInsideRunArtifactDirectory(actual, root);
}

async function persistSchemaDraftValidation(
  runsRoot: string,
  run: RunState,
  draft: SchemaDraftState,
  validation: ArtifactValidationResult
): Promise<void> {
  draft.validation = validation;
  draft.updatedAt = new Date().toISOString();
  run.updatedAt = draft.updatedAt;
  await writeRun(runsRoot, run);
}

function markSchemaDraftAccepted(run: RunState, stepId: string, acceptedArtifactPath?: string): void {
  const draft = run.schemaDrafts?.[stepId];
  if (!draft) return;
  draft.status = "accepted";
  draft.acceptedArtifactPath = acceptedArtifactPath;
  draft.updatedAt = new Date().toISOString();
}

async function collapseCompletedFrames(
  runsRoot: string,
  run: RunState,
  createdArtifactFiles: string[] = []
): Promise<void> {
  while (run.stack.length > 0) {
    const frame = currentFrame(run);
    if (!frame) break;

    if (frame.type === "schema") {
      const context = currentSchemaParentContext(run);
      if (!context) throw new Error(`Schema frame has no parent Artifact: ${frame.memoryName}`);
      const progress = schemaFrameProgress(run, frame);
      if (progress.completed > 0) {
        const existing = run.schemaDrafts?.[context.parentStep.id];
        if (frame.index < frame.steps.length || existing?.status !== "awaiting_finalization") {
          await refreshSchemaDraft(runsRoot, run, context, progress, frame.index >= frame.steps.length);
        }
      }
      if (frame.index < frame.steps.length) break;
      break;
    }

    if (frame.index < frame.steps.length) break;
    run.stack.pop();
  }
  if (run.stack.length === 0) {
    run.status = "done";
  }
}

async function snapshotReachableProcedureTemplates(
  memoryRoot: string,
  root: ProcedureMemory,
  lookup?: RunMemoryLookup
): Promise<Record<string, RunProcedureTemplate>> {
  const snapshots: Record<string, RunProcedureTemplate> = {};
  const visited = new Set<string>();

  const visit = async (procedure: ProcedureMemory): Promise<void> => {
    const canonicalName = procedure.names[0];
    if (visited.has(canonicalName)) return;
    visited.add(canonicalName);

    const steps = compileProcedureSteps(procedure);
    await snapshotExternalSchemas(memoryRoot, steps, lookup);
    const template: RunProcedureTemplate = {
      memoryName: canonicalName,
      asserts: procedure.asserts ? [...procedure.asserts] : undefined,
      steps
    };
    snapshots[canonicalName] = template;

    for (const target of collectCallTargets(steps)) {
      const called = lookup
        ? await lookup("procedures", `procedures/${target}`)
        : await findMemoryByName(memoryRoot, "procedures", target, true);
      if (!called) throw new Error(`procedure not found: ${target}`);
      await visit(called.entity as ProcedureMemory);
    }
  };

  await visit(root);
  return snapshots;
}

function collectCallTargets(steps: readonly RunStep[]): string[] {
  const targets: string[] = [];
  for (const step of steps) {
    if (step.kind === "call" && step.target) targets.push(step.target);
    if (step.branches) {
      targets.push(...collectCallTargets(step.branches.truthy));
      targets.push(...collectCallTargets(step.branches.falsy));
    }
    if (step.loop) targets.push(...collectCallTargets(step.loop.body));
  }
  return [...new Set(targets)];
}

function buildRunReviewPreflight(
  procedureSnapshots: Record<string, RunProcedureTemplate>,
  snapshot: ControlPlaneSnapshot | undefined
): RunReviewPreflight {
  const templates = [...new Map(
    Object.values(procedureSnapshots).map((template) => [template.memoryName, template])
  ).values()];
  const reviews: RunReviewPreflight["reviews"] = [];
  const slots = new Map<string, RunReviewPreflight["slots"][number]>();
  const policies = snapshot?.decisionPolicyCatalog.definitions.map((policy) => policy.id) ?? [];
  for (const template of templates) {
    for (const step of flattenRunSteps(template.steps)) {
      if (!step.artifact || !step.reviewSlots?.length) continue;
      const scope = `${template.memoryName}#${step.id}`;
      reviews.push({ scope, artifact: step.artifact, slots: [...step.reviewSlots], policies });
      for (const name of step.reviewSlots) {
        const key = `${template.memoryName}::${name}`;
        slots.set(key, { key, procedure: template.memoryName, name });
      }
    }
  }
  const actors = Object.entries(snapshot?.actors ?? {}).map(([id, actor]) => ({
    id,
    name: actor.name,
    kind: actor.kind,
    permissions: [...actor.permissions]
  }));
  const defaultPolicy = policies[0] ?? "artifact_acceptance.unanimous";
  const defaultActor = actors[0]?.id;
  return {
    reviews: reviews.sort((left, right) => left.scope.localeCompare(right.scope)),
    slots: [...slots.values()].sort((left, right) => left.key.localeCompare(right.key)),
    actors,
    example: {
      reviews: Object.fromEntries(reviews.map((review) => [
        review.scope,
        { policy: defaultPolicy }
      ])),
      slots: Object.fromEntries([...slots.keys()].map((key) => [
        key,
        defaultActor ? { actors: [defaultActor] } : { skip: true }
      ]))
    }
  };
}

function validateRunReviewConfiguration(
  preflight: RunReviewPreflight,
  configuration: RunReviewConfiguration | undefined,
  snapshot: ControlPlaneSnapshot | undefined
): RunReviewConfiguration | undefined {
  if (!preflight.reviews.length) return undefined;
  if (!configuration || !snapshot) throw new RunReviewConfigurationRequired(preflight);
  const issues: string[] = [];
  const requiredReviews = new Set(preflight.reviews.map((review) => review.scope));
  const requiredSlots = new Set(preflight.slots.map((slot) => slot.key));
  for (const scope of requiredReviews) {
    const review = configuration.reviews[scope];
    if (!review) {
      issues.push(`reviews.${scope}: required`);
      continue;
    }
    if (!snapshot.decisionPolicyCatalog.definitions.some((policy) => policy.id === review.policy)) {
      issues.push(`reviews.${scope}.policy: unknown Decision Policy id ${review.policy}`);
    }
  }
  for (const scope of Object.keys(configuration.reviews)) {
    if (!requiredReviews.has(scope)) issues.push(`reviews.${scope}: unknown Review scope`);
  }
  for (const key of requiredSlots) {
    const binding = configuration.slots[key];
    if (!binding) {
      issues.push(`slots.${key}: bind actors or set skip`);
      continue;
    }
    if ("actorIds" in binding) {
      if (!binding.actorIds.length) issues.push(`slots.${key}.actors: at least one Actor is required`);
      const seenActorIds = new Set<string>();
      for (const [index, actorId] of binding.actorIds.entries()) {
        if (seenActorIds.has(actorId)) {
          issues.push(`slots.${key}.actors[${index}]: duplicate Actor id ${actorId}`);
          continue;
        }
        seenActorIds.add(actorId);
        if (!snapshot.actors[actorId]) issues.push(`slots.${key}.actors: unknown Actor id ${actorId}`);
      }
    }
  }
  for (const key of Object.keys(configuration.slots)) {
    if (!requiredSlots.has(key)) issues.push(`slots.${key}: unknown Review Slot`);
  }
  if (issues.length) throw new Error(`Invalid Review configuration:\n- ${issues.join("\n- ")}`);
  return structuredClone(configuration);
}

function futureRunReviewScopesBySlot(run: RunState): Map<string, string[]> {
  const scopesBySlot = new Map<string, Set<string>>();

  const addOwnScope = (step: RunStep, procedureName: string): void => {
    if (!step.artifact || !step.reviewSlots?.length) return;
    const scope = `${procedureName}#${step.id}`;
    for (const slotName of step.reviewSlots) {
      const slot = `${procedureName}::${slotName}`;
      const scopes = scopesBySlot.get(slot) ?? new Set<string>();
      scopes.add(scope);
      scopesBySlot.set(slot, scopes);
    }
  };

  const visitSteps = (
    steps: readonly RunStep[],
    procedureName: string,
    callStack: ReadonlySet<string>
  ): void => {
    for (const step of steps) visitStep(step, procedureName, true, callStack);
  };

  const visitStep = (
    step: RunStep,
    procedureName: string,
    includeOwnScope: boolean,
    callStack: ReadonlySet<string>
  ): void => {
    if (includeOwnScope || step.kind === "loop") addOwnScope(step, procedureName);
    if (step.branches) {
      visitSteps(step.branches.truthy, procedureName, callStack);
      visitSteps(step.branches.falsy, procedureName, callStack);
    }
    if (step.loop) visitSteps(step.loop.body, procedureName, callStack);
    if (step.kind === "call" && step.target) {
      const template = run.procedureSnapshots?.[step.target];
      if (!template || callStack.has(template.memoryName)) return;
      const nestedStack = new Set(callStack);
      nestedStack.add(template.memoryName);
      visitSteps(template.steps, template.memoryName, nestedStack);
    }
  };

  for (const frame of run.stack) {
    if (frame.type !== "procedure") continue;
    for (let index = frame.index; index < frame.steps.length; index += 1) {
      const step = frame.steps[index];
      const isCurrentFrozenReview = index === frame.index && activeReviewForStep(run, step) !== undefined;
      visitStep(step, frame.memoryName, !isCurrentFrozenReview, new Set([frame.memoryName]));
    }
  }

  return new Map([...scopesBySlot.entries()].map(([slot, scopes]) => [slot, [...scopes].sort()]));
}

function validateRunSlotActors(run: RunState, slot: string, actorIds: string[]): { actorIds: string[] } {
  if (!actorIds.length) throw new Error(`Review Slot ${slot} requires at least one Actor`);
  const seen = new Set<string>();
  for (const [index, actorId] of actorIds.entries()) {
    if (!actorId.trim()) throw new Error(`Review Slot ${slot} Actor ${index + 1} is empty`);
    if (seen.has(actorId)) throw new Error(`Review Slot ${slot} has duplicate Actor id ${actorId}`);
    seen.add(actorId);
    if (!run.controlPlane?.actors[actorId]) throw new Error(`Review Slot ${slot} has unknown frozen Actor id ${actorId}`);
  }
  return { actorIds: [...actorIds] };
}

function cloneRunSlotBinding(binding: RunSlotBindingValue): RunSlotBindingValue {
  return "skip" in binding ? { skip: true } : { actorIds: [...binding.actorIds] };
}

function sameRunSlotBinding(left: RunSlotBindingValue, right: RunSlotBindingValue): boolean {
  if ("skip" in left || "skip" in right) return "skip" in left && "skip" in right;
  return left.actorIds.length === right.actorIds.length
    && left.actorIds.every((actorId, index) => actorId === right.actorIds[index]);
}

function resolvedReviewStepsByScope(
  run: RunState,
  configuration: RunReviewConfiguration,
  validationScopes: ReadonlySet<string>
): Map<string, RunStep> {
  if (!run.controlPlane) throw new Error(`Run control-plane snapshot missing: ${run.id}`);
  const resolved = new Map<string, RunStep>();
  const templates = [...new Map(
    Object.values(run.procedureSnapshots ?? {}).map((template) => [template.memoryName, template])
  ).values()];
  for (const template of templates) {
    const steps = instantiateProcedureTemplate(template, run.controlPlane, configuration, validationScopes);
    for (const step of flattenRunSteps(steps)) {
      if (step.artifact && step.reviewSlots?.length) {
        resolved.set(`${template.memoryName}#${step.id}`, step);
      }
    }
  }
  return resolved;
}

function updateStoredRunReviewSteps(
  run: RunState,
  scopes: string[],
  resolved: Map<string, RunStep>
): void {
  const scopeSet = new Set(scopes);
  const update = (steps: RunStep[], procedureName: string): void => {
    for (const step of flattenRunSteps(steps)) {
      const scope = `${procedureName}#${step.id}`;
      if (!scopeSet.has(scope)) continue;
      const replacement = resolved.get(scope);
      if (!replacement) throw new Error(`Resolved Review step missing: ${scope}`);
      step.controlPlane = replacement.controlPlane ? structuredClone(replacement.controlPlane) : undefined;
      step.reviewPolicy = replacement.reviewPolicy;
    }
  };
  if (run.plan) update(run.plan, run.procedureName);
  for (const frame of run.stack) {
    if (frame.type === "procedure") update(frame.steps, frame.memoryName);
  }
}

function flattenRunSteps(steps: readonly RunStep[]): RunStep[] {
  const flattened: RunStep[] = [];
  for (const step of steps) {
    flattened.push(step);
    if (step.branches) {
      flattened.push(...flattenRunSteps(step.branches.truthy));
      flattened.push(...flattenRunSteps(step.branches.falsy));
    }
    if (step.loop) flattened.push(...flattenRunSteps(step.loop.body));
  }
  return flattened;
}

function containsArtifactReview(steps: readonly RunStep[]): boolean {
  return steps.some((step) =>
    Boolean(
      step.reviewSlots?.length ||
        (step.branches &&
          (containsArtifactReview(step.branches.truthy) || containsArtifactReview(step.branches.falsy))) ||
        (step.loop && containsArtifactReview(step.loop.body))
    )
  );
}

function instantiateProcedureTemplate(
  template: RunProcedureTemplate,
  snapshot: ControlPlaneSnapshot | undefined,
  reviewConfiguration: RunReviewConfiguration | undefined,
  validationScopes?: ReadonlySet<string>
): RunStep[] {
  if (!snapshot && containsArtifactReview(template.steps)) {
    throw new Error(`control_plane config is required for Artifact Review: procedure:${template.memoryName}`);
  }
  const steps = cloneSteps(template.steps);
  applyControlPlaneToSteps(steps, snapshot, reviewConfiguration, template.memoryName, validationScopes);
  return steps;
}

function applyControlPlaneToSteps(
  steps: RunStep[],
  snapshot: ControlPlaneSnapshot | undefined,
  reviewConfiguration: RunReviewConfiguration | undefined,
  procedureName: string,
  validationScopes?: ReadonlySet<string>
): void {
  for (const step of steps) {
    if (step.artifact) {
      const artifactScope = `${procedureName}#${step.id}`;
      if (step.reviewSlots?.length && !snapshot) {
        throw new Error(`control_plane config is required for Artifact Review: ${artifactScope}`);
      }
      if (snapshot && step.reviewSlots?.length) {
        const review = reviewConfiguration?.reviews[artifactScope];
        if (!review) throw new Error(`Missing Review configuration: ${artifactScope}`);
        const slotBindings: SlotBindings = Object.fromEntries(step.reviewSlots.map((slot) => {
          const key = `${procedureName}::${slot}`;
          const binding = reviewConfiguration?.slots[key];
          if (!binding) throw new Error(`Missing Review Slot configuration: ${key}`);
          return [key, "skip" in binding
            ? { actorIds: [], source: `run:${key}`, skipped: true }
            : { actorIds: [...binding.actorIds], source: `run:${key}` }];
        }));
        step.controlPlane = resolveArtifactControlPlane({
          snapshot,
          slotBindings,
          artifactScope,
          policyId: review.policy
        });
        if (Object.values(slotBindings).some((binding) => !binding.skipped)) {
          step.reviewPolicy = review.policy;
          if (validationScopes === undefined || validationScopes.has(artifactScope)) {
            assertArtifactReviewCanStart(snapshot, step.controlPlane, step.reviewPolicy);
          }
        } else {
          step.reviewPolicy = undefined;
        }
      } else if (snapshot) {
        step.controlPlane = resolveArtifactControlPlane({
          snapshot,
          slotBindings: {},
          artifactScope,
          policyId: ""
        });
      }
    }
    if (step.branches) {
      applyControlPlaneToSteps(step.branches.truthy, snapshot, reviewConfiguration, procedureName, validationScopes);
      applyControlPlaneToSteps(step.branches.falsy, snapshot, reviewConfiguration, procedureName, validationScopes);
    }
    if (step.loop) applyControlPlaneToSteps(step.loop.body, snapshot, reviewConfiguration, procedureName, validationScopes);
  }
}

function assertArtifactReviewCanStart(
  snapshot: ControlPlaneSnapshot,
  controlPlane: ArtifactControlPlane,
  policyId: string
): void {
  const policy = snapshot.decisionPolicyCatalog.definitions.find((candidate) => candidate.id === policyId);
  if (!policy) throw new Error(`Unknown Decision Policy id in Run snapshot: ${policyId}`);
  const runnerRead = authorizeArtifactOperation({
    controlPlane,
    subject: { kind: "runner" },
    permission: "artifact.read"
  });
  if (!runnerRead.allowed) throw new Error("Artifact Review requires runner artifact.read for run review wait");
  createArtifactReviewAssignments({
    snapshot,
    controlPlane,
    now: "1970-01-01T00:00:00.000Z"
  });
}

function compileProcedureSteps(procedure: ProcedureMemory): RunStep[] {
  return compileFlowSteps(procedure.flow, "flow");
}

function compileFlowSteps(flow: FlowNode[], prefix: string): RunStep[] {
  return flow.map((node, index) => compileFlowStep(node, `${prefix}[${index + 1}]`));
}

function compileFlowStep(node: FlowNode, id: string): RunStep {
  switch (node.tag) {
    case "!action":
      return compileActionStep(node, id);
    case "!if":
      return compileIfStep(node, id);
    case "!while":
      return compileWhileStep(node, id);
    case "!call":
      return {
        id,
        kind: "call",
        instruction: `Call ${node.target}`,
        target: node.target
      };
  }
}

function compileActionStep(node: ActionNode, id: string): RunStep {
  return {
    id,
    kind: "action",
    instruction: node.action,
    actor: node.actor ?? "agent",
    artifact: node.artifact.name,
    ...compileArtifactStep(node.artifact, id),
    asserts: node.asserts ? [...node.asserts] : undefined,
    suggests: node.suggests ? [...node.suggests] : undefined
  };
}

function compileArtifactStep(
  artifact: ActionNode["artifact"],
  id: string
): Pick<RunStep, "artifact" | "type" | "format" | "schema" | "validationPlan" | "final" | "reviewSlots"> {
  const contract = compileArtifactContract(artifact);
  const schema = typeof artifact.schema === "string"
    ? { kind: "external" as const, name: artifact.schema }
    : artifact.schema?.tag === "!schema"
      ? { kind: "inline" as const, id: `inline:${id}:${slugify(artifact.name) || "artifact"}`, node: cloneSchema(artifact.schema) }
      : artifact.schema?.tag === "!ref"
        ? { kind: "external" as const, name: artifact.schema.target }
      : undefined;
  const validationPlan = artifactSchemaNeedsResolution(artifact.schema)
    ? undefined
    : artifactValidatorRegistry.resolvePlan(contract);
  return {
    artifact: artifact.name,
    type: contract.type,
    format: contract.format,
    schema,
    validationPlan,
    final: artifact.final || undefined,
    reviewSlots: artifact.review ? [...artifact.review] : undefined
  };
}

function assertSchemaNode(value: SchemaNode | MemoryRefNode, path: string): SchemaNode {
  if (value.tag === "!schema") return value;
  throw new Error(`unresolved Memory reference at ${path}: ${value.target}`);
}

function compileIfStep(node: IfNode, id: string): RunStep {
  const fallback = compileFlowSteps(node.else ?? [], `${id}.else`);
  return compileIfChain(node, id, fallback);
}

function compileIfChain(node: IfNode, id: string, fallback: RunStep[]): RunStep {
  const thenSteps = compileFlowSteps(node.then, `${id}.then`);
  const elseSteps = node.elseif
    ? [compileIfChain(node.elseif, `${id}.elseif`, fallback)]
    : fallback;
  return {
    id,
    kind: "branch",
    instruction: node.condition.action,
    actor: node.condition.actor ?? "agent",
    ...compileArtifactStep(node.condition.artifact, id),
    asserts: node.condition.asserts ? [...node.condition.asserts] : undefined,
    suggests: node.condition.suggests ? [...node.condition.suggests] : undefined,
    details: describeControlTargets("true", thenSteps).concat(describeControlTargets("false", elseSteps)),
    branches: { truthy: thenSteps, falsy: elseSteps }
  };
}

function compileWhileStep(node: WhileNode, id: string): RunStep {
  const body = compileFlowSteps(node.do, `${id}.do`);
  return {
    id,
    kind: "loop",
    instruction: node.condition.action,
    actor: node.condition.actor ?? "agent",
    ...compileArtifactStep(node.condition.artifact, id),
    asserts: node.condition.asserts ? [...node.condition.asserts] : undefined,
    suggests: node.condition.suggests ? [...node.condition.suggests] : undefined,
    details: describeControlTargets("while true", body).concat(["false: continue after loop"]),
    loop: { body }
  };
}

function describeControlTargets(label: string, steps: RunStep[]): string[] {
  if (!steps.length) return [`${label}: no steps`];
  return [`${label}: ${steps.map((step) => step.artifact ?? step.target ?? step.id).join(", ")}`];
}

function applyControlStep(frame: RunFrame, step: RunStep, artifactValue: unknown): void {
  if (step.kind === "branch" && step.branches) {
    const selected = parseBooleanArtifact(artifactValue) ? step.branches.truthy : step.branches.falsy;
    frame.steps.splice(frame.index, 0, ...cloneSteps(selected));
    return;
  }

  if (step.kind === "loop" && step.loop && parseBooleanArtifact(artifactValue)) {
    frame.steps.splice(frame.index, 0, ...cloneSteps(step.loop.body), cloneStep(step));
  }
}

function parseBooleanArtifact(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return typeof value === "string" && ["true", "yes", "y", "1", "继续", "是"].includes(value.trim().toLowerCase());
}

function cloneSteps(steps: RunStep[]): RunStep[] {
  return steps.map(cloneStep);
}

function cloneStep(step: RunStep): RunStep {
  return {
    ...step,
    format: step.format ? { name: step.format.name, options: structuredClone(step.format.options) } : undefined,
    schema: step.schema ? structuredClone(step.schema) : undefined,
    validationPlan: step.validationPlan ? structuredClone(step.validationPlan) : undefined,
    reviewSlots: step.reviewSlots ? [...step.reviewSlots] : undefined,
    reviewPolicy: step.reviewPolicy,
    asserts: step.asserts ? [...step.asserts] : undefined,
    suggests: step.suggests ? [...step.suggests] : undefined,
    details: step.details ? [...step.details] : undefined,
    schemaContext: step.schemaContext ? structuredClone(step.schemaContext) : undefined,
    controlPlane: step.controlPlane ? structuredClone(step.controlPlane) : undefined,
    branches: step.branches
      ? {
          truthy: cloneSteps(step.branches.truthy),
          falsy: cloneSteps(step.branches.falsy)
        }
      : undefined,
    loop: step.loop ? { body: cloneSteps(step.loop.body) } : undefined,
    repeat: step.repeat
      ? {
          ...step.repeat,
          body: JSON.parse(JSON.stringify(step.repeat.body)) as StaticSchemaField[]
        }
      : undefined
  };
}

async function expandAutoCallSteps(run: RunState): Promise<void> {
  let guard = 0;
  while (run.status === "running") {
    if (guard++ > 20) throw new Error("too many nested !call steps");
    const frame = currentFrame(run);
    const step = currentStep(run);
    if (!frame || !step || step.kind !== "call") return;
    if (!step.target) throw new Error(`${step.id}.target is required`);
    frame.index += 1;
    if (run.contractVersion === 3) {
      const template = run.procedureSnapshots?.[step.target];
      if (!template) throw new Error(`procedure snapshot not found: ${step.target}`);
      const steps = instantiateProcedureTemplate(template, run.controlPlane, run.reviewConfiguration);
      run.stack.push({
        type: "procedure",
        memoryName: template.memoryName,
        asserts: template.asserts ? [...template.asserts] : undefined,
        steps,
        index: 0,
        returnTo: step.id
      });
      continue;
    }
    const procedure = await findMemoryByName(run.memoryRoot, "procedures", step.target, true);
    if (!procedure) throw new Error(`procedure not found: ${step.target}`);
    const procedureMemory = procedure.entity as ProcedureMemory;
    const steps = compileProcedureSteps(procedureMemory);
    await snapshotExternalSchemas(run.memoryRoot, steps);
    run.stack.push({
      type: "procedure",
      memoryName: procedure.entity.names[0],
      asserts: procedureMemory.asserts ? [...procedureMemory.asserts] : undefined,
      steps,
      index: 0,
      returnTo: step.id
    });
  }
}

async function buildRunEventArtifact(
  runsRoot: string,
  run: RunState,
  step: RunStep,
  candidate: PreparedArtifactCandidate,
  validation: ArtifactValidationResult,
  createdArtifactFiles: string[] = [],
  authorization?: AuthorizationDecision,
  storage?: { relativeDirectory: string; fileName: string }
): Promise<RunEvent["artifact"]> {
  if (!step.artifact || !step.type || !step.format) {
    throw new Error(`step ${step.id} has no artifact`);
  }

  const base = {
    name: step.artifact,
    type: step.type,
    format: step.format,
    fields: artifactFieldsForStep(step),
    schema: step.schema,
    validation,
    final: step.final,
    authorization
  };

  if (!shouldStoreArtifactAsFile(step.format)) {
    return compactArtifact({
      ...base,
      storage: "inline",
      value: candidate.representation.value
    });
  }

  const artifactRoot = await ensureRunArtifactDirectory(runsRoot, run.id);
  const artifactDir = storage ? resolve(artifactRoot, storage.relativeDirectory) : artifactRoot;
  assertInsideRunArtifactDirectory(artifactDir, artifactRoot, true);
  await mkdir(artifactDir, { recursive: true });
  const fileName = storage?.fileName ?? nextArtifactFileName(run, step);
  const absolutePath = resolve(artifactDir, fileName);
  assertInsideRunArtifactDirectory(absolutePath, artifactRoot);

  await writeFile(absolutePath, candidate.raw);
  createdArtifactFiles.push(absolutePath);

  return compactArtifact({
    ...base,
    storage: "file",
    path: posix.join(run.id, "artifacts", storage?.relativeDirectory ?? "", fileName),
    fileName,
    contentType: contentTypeForFormat(step.format)
  });
}

async function buildArtifactReviewContextArtifacts(
  runsRoot: string,
  run: RunState,
  reviewId: string,
  submissionId: string,
  createdArtifactFiles: string[]
): Promise<ArtifactReview<RunEvent["artifact"]>["submissions"][number]["contextArtifacts"]> {
  const contextArtifacts: ArtifactReview<RunEvent["artifact"]>["submissions"][number]["contextArtifacts"] = [];
  const artifactRoot = await ensureRunArtifactDirectory(runsRoot, run.id);
  const contextDirectory = resolve(artifactRoot, "reviews", reviewId, submissionId, "context");

  for (const [index, event] of run.events.entries()) {
    const snapshot = structuredClone(event.artifact);
    if (snapshot.storage === "file" && snapshot.path) {
      await mkdir(contextDirectory, { recursive: true });
      const sourcePath = resolve(runsRoot, snapshot.path);
      const extension = snapshot.fileName?.match(/(\.[^.]+)$/)?.[1] ?? extensionForFormat(snapshot.format);
      const fileName = `${String(index + 1).padStart(3, "0")}-${slugify(snapshot.name) || "artifact"}${extension}`;
      const targetPath = resolve(contextDirectory, fileName);
      assertInsideRunArtifactDirectory(targetPath, artifactRoot);
      await writeFile(targetPath, await readFile(sourcePath));
      createdArtifactFiles.push(targetPath);
      snapshot.path = posix.join(run.id, "artifacts", "reviews", reviewId, submissionId, "context", fileName);
      snapshot.fileName = fileName;
    }
    contextArtifacts.push({ stepId: event.stepId, artifact: snapshot });
  }
  return contextArtifacts;
}

async function removeArtifactFiles(paths: readonly string[]): Promise<void> {
  for (const path of [...paths].reverse()) await rm(path, { force: true });
}

async function contractForStep(run: RunState, step: RunStep): Promise<CompiledArtifactContract> {
  if (!step.artifact || !step.type || !step.format) throw new Error(`step ${step.id} has no Artifact contract`);
  let schema: string | SchemaNode | undefined;
  if (step.schema?.kind === "inline") {
    schema = cloneSchema(step.schema.node);
  } else if (step.schema?.kind === "external") {
    if (!step.schema.node) throw new Error(`schema snapshot missing from Run contract: ${step.schema.name}`);
    schema = cloneSchema(step.schema.node);
  }
  return {
    name: step.artifact,
    type: step.type,
    format: { name: step.format.name, options: structuredClone(step.format.options) },
    schema,
    final: step.final === true
  };
}

function stepContract(step: RunStep): CompiledArtifactContract {
  if (!step.artifact || !step.type || !step.format) throw new Error(`step ${step.id} has no Artifact contract`);
  return {
    name: step.artifact,
    type: step.type,
    format: structuredClone(step.format),
    schema: step.schema?.node ? cloneSchema(step.schema.node) : undefined,
    final: step.final === true
  };
}

function compactArtifact(artifact: RunEvent["artifact"]): RunEvent["artifact"] {
  if (artifact.fields && Object.keys(artifact.fields).length === 0) {
    delete artifact.fields;
  }
  return artifact;
}

function artifactFieldsForStep(step: RunStep): Record<string, unknown> | undefined {
  if (step.schema?.kind === "external") return { schema_name: step.schema.name };
  if (step.schema?.kind === "inline") return { inline_schema_id: step.schema.id };
  return undefined;
}

function shouldStoreArtifactAsFile(format: ArtifactFormatSpec): boolean {
  return ["markdown", "yaml", "json"].includes(format.name);
}

function runArtifactDirectory(runsRoot: string, runId: string): string {
  return join(runsRoot, runId, "artifacts");
}

async function ensureRunArtifactDirectory(runsRoot: string, runId: string): Promise<string> {
  const artifactDir = runArtifactDirectory(runsRoot, runId);
  await mkdir(artifactDir, { recursive: true });
  return artifactDir;
}

function assertInsideRunArtifactDirectory(path: string, artifactDir: string, allowRoot = false): void {
  const rel = relative(resolve(artifactDir), resolve(path));
  if (rel.startsWith("..") || (!allowRoot && rel === "") || rel.includes("..")) {
    throw new Error(`artifact path escapes run artifacts directory: ${path}`);
  }
}

function nextArtifactFileName(run: RunState, step: RunStep): string {
  const index = String(run.events.length + 1).padStart(3, "0");
  const slug = slugify(step.artifact ?? step.id) || slugify(step.id) || "artifact";
  return `${index}-${slug}${extensionForFormat(step.format ?? { name: "plain", options: {} })}`;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function extensionForFormat(format: ArtifactFormatSpec): string {
  switch (format.name) {
    case "markdown":
      return ".md";
    case "yaml":
      return ".yaml";
    case "json":
      return ".json";
    default:
      return ".txt";
  }
}

function contentTypeForFormat(format: ArtifactFormatSpec): string | undefined {
  switch (format.name) {
    case "markdown":
      return "text/markdown";
    case "yaml":
      return "application/yaml";
    case "json":
      return "application/json";
    default:
      return undefined;
  }
}

function compileSchemaSteps(
  schema: SchemaNode,
  rootName: string,
  parentContract: CompiledArtifactContract,
  controlPlane?: ArtifactControlPlane
): RunStep[] {
  const steps: RunStep[] = [];
  walkSchema(schema, rootName, steps, parentContract, controlPlane, rootName, []);
  return steps;
}

function schemaStepContract(
  schema: SchemaNode,
  parent: CompiledArtifactContract,
  name: string
): CompiledArtifactContract {
  const resolved = resolveSchemaContract(schema, parent.format);
  return {
    name,
    type: resolved.type,
    format: structuredClone(resolved.format),
    final: false
  };
}

function walkSchema(
  node: SchemaNode,
  path: string,
  steps: RunStep[],
  parentContract: CompiledArtifactContract,
  controlPlane: ArtifactControlPlane | undefined,
  rootName: string,
  ancestors: SchemaConstraintSource[]
): void {
  const contract = schemaStepContract(node, parentContract, path);
  const sources = [...ancestors, schemaConstraintSource(node, path, contract)];
  steps.push(compileSchemaValueStep({
    id: `schema:${path}`,
    instruction: `Write ${path}`,
    artifact: path,
    contract,
    controlPlane,
    details: definitionDetails(node.defines)
      .concat((node.asserts ?? []).map((value) => `asserts: ${value}`))
      .concat((node.suggests ?? []).map((value) => `suggests: ${value}`)),
    schemaContext: { rootName, path, sources },
    optional: node.optional === true
  }));

  if (!(contract.type === "object" && contract.format.name === "markdown" && contract.format.options.layout === "outline")) {
    return;
  }

  for (const [fieldIndex, child] of (node.fields ?? []).entries()) {
    if (typeof child === "string") {
      const childPath = `${path}.${child}`;
      steps.push(compileStringSchemaStep(
        childPath,
        contract,
        controlPlane,
        stringSchemaStepContext(rootName, childPath, contract, sources)
      ));
      continue;
    }
    if (child.tag === "!repeat") {
      steps.push(compileRepeatStep(child, path, fieldIndex, controlPlane, {
        rootName,
        path: `${path}.fields[${fieldIndex + 1}].repeat`,
        sources
      }));
      continue;
    }
    const childSchema = assertSchemaNode(child, `${path}.fields[${fieldIndex}]`);
    walkSchema(childSchema, `${path}.${childSchema.names[0]}`, steps, contract, controlPlane, rootName, sources);
  }
}

function compileStringSchemaStep(
  path: string,
  parent: CompiledArtifactContract,
  controlPlane?: ArtifactControlPlane,
  schemaContext?: SchemaStepContext
): RunStep {
  return compileSchemaValueStep({
    id: `schema:${path}`,
    instruction: `Write ${path}`,
    artifact: path,
    controlPlane,
    contract: {
      name: path,
      type: "string",
      format: inheritSchemaFormat(parent.format, "string"),
      final: false
    },
    schemaContext
  });
}

function compileSchemaValueStep(input: {
  id: string;
  instruction: string;
  artifact: string;
  contract: CompiledArtifactContract;
  details?: string[];
  schemaContext?: SchemaStepContext;
  controlPlane?: ArtifactControlPlane;
  optional?: boolean;
}): RunStep {
  const contract = input.contract;
  return {
    id: input.id,
    instruction: input.instruction,
    actor: "agent",
    artifact: input.artifact,
    type: contract.type,
    format: contract.format,
    validationPlan: artifactValidatorRegistry.resolvePlan(contract),
    details: input.details,
    schemaContext: input.schemaContext ? structuredClone(input.schemaContext) : undefined,
    controlPlane: input.controlPlane ? structuredClone(input.controlPlane) : undefined,
    optional: input.optional || undefined
  };
}

function compileRepeatStep(
  node: RepeatNode,
  parentPath: string,
  fieldIndex: number,
  controlPlane?: ArtifactControlPlane,
  schemaContext?: SchemaStepContext
): RunStep {
  const min = node.limit?.min ?? 0;
  const max = node.limit?.max;
  return {
    id: `schema:${parentPath}.fields[${fieldIndex + 1}].repeat`,
    kind: "repeat",
    instruction: `Choose how many times to repeat the field group in ${parentPath}`,
    actor: "agent",
    details: [
      `min: ${min}`,
      `max: ${max === undefined ? "unbounded" : max}`,
      `body fields: ${node.body.length}`
    ],
    schemaContext: schemaContext ? structuredClone(schemaContext) : undefined,
    controlPlane: controlPlane ? structuredClone(controlPlane) : undefined,
    repeat: {
      parentPath,
      fieldIndex,
      body: JSON.parse(JSON.stringify(node.body)) as StaticSchemaField[],
      min,
      max
    }
  };
}

function compileRepeatBody(
  repeat: NonNullable<RunStep["repeat"]>,
  count: number,
  controlPlane?: ArtifactControlPlane,
  schemaContext?: SchemaStepContext
): RunStep[] {
  const steps: RunStep[] = [];
  for (let iteration = 1; iteration <= count; iteration += 1) {
    for (const child of repeat.body) {
      if (typeof child === "string") {
        const childPath = `${repeat.parentPath}.${child}[${iteration}]`;
        const parentContract = {
          name: repeat.parentPath,
          type: "object",
          format: { name: "markdown", options: { layout: "outline" } },
          final: false
        } satisfies CompiledArtifactContract;
        steps.push(compileStringSchemaStep(
          childPath,
          parentContract,
          controlPlane,
          stringSchemaStepContext(
            schemaContext?.rootName ?? repeat.parentPath,
            childPath,
            parentContract,
            schemaContext?.sources ?? []
          )
        ));
      } else {
        const childSchema = assertSchemaNode(child, `${repeat.parentPath}.repeat[${iteration}]`);
        walkSchema(childSchema, `${repeat.parentPath}.${childSchema.names[0]}[${iteration}]`, steps, {
          name: repeat.parentPath,
          type: "object",
          format: { name: "markdown", options: { layout: "outline" } },
          final: false
        }, controlPlane, schemaContext?.rootName ?? repeat.parentPath, schemaContext?.sources ?? []);
      }
    }
  }
  return steps;
}

function schemaConstraintSource(
  node: SchemaNode,
  path: string,
  contract: CompiledArtifactContract
): SchemaConstraintSource {
  const defines = definitionDetails(node.defines);
  return {
    path,
    type: contract.type,
    format: structuredClone(contract.format),
    defines: defines.length ? defines : undefined,
    asserts: node.asserts?.length ? [...node.asserts] : undefined,
    suggests: node.suggests?.length ? [...node.suggests] : undefined
  };
}

function stringSchemaStepContext(
  rootName: string,
  path: string,
  parent: CompiledArtifactContract,
  ancestors: SchemaConstraintSource[]
): SchemaStepContext {
  return {
    rootName,
    path,
    sources: [...ancestors, {
      path,
      type: "string",
      format: inheritSchemaFormat(parent.format, "string")
    }]
  };
}

function cloneSchema(schema: SchemaNode): SchemaNode {
  return JSON.parse(JSON.stringify(schema)) as SchemaNode;
}

function definitionDetails(defines: DefinitionPart[]): string[] {
  const details: string[] = [];
  for (const definition of defines) {
    if (typeof definition === "string") {
      details.push(`defines: ${definition}`);
      continue;
    }
    if (definition.tag === "!statement") {
      details.push(...statementDefinitionDetails(definition));
      continue;
    }
    if (definition.tag === "!ref") {
      details.push(`ref: ${definition.target}`);
      continue;
    }
    details.push(...definitionDetails(definition.defines));
    details.push(...(definition.asserts ?? []).map((value) => `asserts: ${value}`));
  }
  return details;
}

function statementDefinitionDetails(statement: StatementNode, path: string[] = []): string[] {
  const details = definitionDetails(statement.defines);
  const qualifier = path.length > 0 ? ` [${path.join(" > ")}]` : "";
  details.push(...(statement.asserts ?? []).map((value) => `asserts${qualifier}: ${value}`));
  details.push(...(statement.suggests ?? []).map((value) => `suggests${qualifier}: ${value}`));

  for (const section of statement.sections ?? []) {
    details.push(...statementDefinitionDetails(section, [...path, section.names[0].trim()]));
  }
  return details;
}

type RunMemoryLookup = (
  kind: "procedures" | "schemas",
  referenceOrName: string
) => Promise<MemoryFile | undefined>;

function catalogLookup(catalog: MemoryCatalog): RunMemoryLookup {
  return async (kind, referenceOrName) => {
    try {
      const descriptor = await catalog.resolve(referenceOrName, { kind });
      return {
        kind,
        path: descriptor.reference,
        entity: await catalog.read(descriptor.reference, { kind })
      };
    } catch (error) {
      if (error instanceof MemoryNotFoundError) return undefined;
      throw error;
    }
  };
}

async function snapshotExternalSchemas(
  memoryRoot: string,
  steps: RunStep[],
  lookup?: RunMemoryLookup
): Promise<void> {
  for (const step of steps) {
    if (step.schema?.kind === "external" && !step.schema.node) {
      const memory = lookup
        ? await lookup("schemas", `schemas/${step.schema.name}`)
        : await findSchemaMemory(memoryRoot, step.schema.name);
      if (!memory) throw new Error(`schema not found: ${step.schema.name}`);
      step.schema.node = await resolveSchemaReferences(
        memoryRoot,
        schemaNodeFromMemory(memory.entity as SchemaMemory),
        [memoryReference(memory)],
        lookup
      );
    }
    if (step.schema?.kind === "inline") {
      step.schema.node = await resolveSchemaReferences(memoryRoot, step.schema.node, [`inline:${step.schema.id}`], lookup);
    }
    if (step.schema?.node && step.artifact && step.type && step.format) {
      step.validationPlan = artifactValidatorRegistry.resolvePlan(stepContract(step));
    }
    if (
      step.schema?.node &&
      schemaHasRepeat(step.schema.node) &&
      !(step.type === "object" && step.format?.name === "markdown" && step.format.options.layout === "outline")
    ) {
      throw new Error(`Schema Repeat is only supported by object markdown Artifacts with layout: outline: ${step.id}`);
    }
    if (step.branches) {
      await snapshotExternalSchemas(memoryRoot, step.branches.truthy, lookup);
      await snapshotExternalSchemas(memoryRoot, step.branches.falsy, lookup);
    }
    if (step.loop) await snapshotExternalSchemas(memoryRoot, step.loop.body, lookup);
  }
}

function artifactSchemaNeedsResolution(schema: ActionNode["artifact"]["schema"]): boolean {
  if (!schema || typeof schema === "string") return false;
  if (schema.tag === "!ref") return true;
  return schemaHasRef(schema);
}

async function resolveSchemaReferences(
  memoryRoot: string,
  schema: SchemaNode,
  stack: string[],
  lookup?: RunMemoryLookup
): Promise<SchemaNode> {
  const resolved = cloneSchema(schema);
  if (resolved.fields) {
    resolved.fields = await Promise.all(resolved.fields.map((field, index) =>
      resolveSchemaField(memoryRoot, field, `${stack.at(-1) ?? "schema"}.fields[${index}]`, stack, lookup)
    ));
  }
  if (resolved.item) {
    resolved.item = await resolveSchemaItem(memoryRoot, resolved.item, `${stack.at(-1) ?? "schema"}.item`, stack, lookup);
  }
  if (resolved.items) {
    resolved.items = await Promise.all(resolved.items.map((item, index) =>
      resolveSchemaItem(memoryRoot, item, `${stack.at(-1) ?? "schema"}.items[${index}]`, stack, lookup)
    ));
  }
  return resolved;
}

async function resolveSchemaField(
  memoryRoot: string,
  field: StaticSchemaField | RepeatNode,
  path: string,
  stack: string[],
  lookup?: RunMemoryLookup
): Promise<StaticSchemaField | RepeatNode> {
  if (typeof field === "object" && field.tag === "!repeat") {
    return {
      ...field,
      body: await Promise.all(field.body.map((bodyField, index) =>
        resolveStaticSchemaField(memoryRoot, bodyField, `${path}.body[${index}]`, stack, lookup)
      ))
    };
  }
  return resolveStaticSchemaField(memoryRoot, field, path, stack, lookup);
}

async function resolveStaticSchemaField(
  memoryRoot: string,
  field: StaticSchemaField,
  path: string,
  stack: string[],
  lookup?: RunMemoryLookup
): Promise<StaticSchemaField> {
  if (typeof field === "string") return field;
  if (field.tag === "!ref") return resolveSchemaRef(memoryRoot, field, path, stack, lookup);
  return resolveSchemaReferences(memoryRoot, field, [...stack, `inline:${path}`], lookup);
}

async function resolveSchemaItem(
  memoryRoot: string,
  item: SchemaNode | MemoryRefNode,
  path: string,
  stack: string[],
  lookup?: RunMemoryLookup
): Promise<SchemaNode> {
  if (item.tag === "!ref") return resolveSchemaRef(memoryRoot, item, path, stack, lookup);
  return resolveSchemaReferences(memoryRoot, item, [...stack, `inline:${path}`], lookup);
}

async function resolveSchemaRef(
  memoryRoot: string,
  ref: MemoryRefNode,
  path: string,
  stack: string[],
  lookup?: RunMemoryLookup
): Promise<SchemaNode> {
  if (!ref.target.startsWith("schemas/")) {
    throw new Error(`schema reference at ${path} must target schemas/*, got ${ref.target}`);
  }
  if (stack.includes(ref.target)) {
    throw new Error(`Schema reference cycle detected: ${[...stack, ref.target].join(" -> ")}`);
  }
  const memory = lookup
    ? await lookup("schemas", ref.target)
    : await findSchemaMemory(memoryRoot, ref.target);
  if (!memory) throw new Error(`schema not found: ${ref.target}`);
  return resolveSchemaReferences(
    memoryRoot,
    schemaNodeFromMemory(memory.entity as SchemaMemory),
    [...stack, ref.target],
    lookup
  );
}

function schemaHasRef(schema: SchemaNode): boolean {
  return (schema.fields ?? []).some((field) => schemaFieldHasRef(field)) ||
    (schema.item ? staticSchemaFieldHasRef(schema.item) : false) ||
    (schema.items ?? []).some((item) => staticSchemaFieldHasRef(item));
}

function schemaFieldHasRef(field: StaticSchemaField | RepeatNode): boolean {
  if (typeof field !== "object") return false;
  if (field.tag === "!repeat") return field.body.some((bodyField) => staticSchemaFieldHasRef(bodyField));
  return staticSchemaFieldHasRef(field);
}

function staticSchemaFieldHasRef(field: StaticSchemaField): boolean {
  if (typeof field !== "object") return false;
  if (field.tag === "!ref") return true;
  return schemaHasRef(field);
}

function schemaHasRepeat(schema: SchemaNode): boolean {
  return (schema.fields ?? []).some((field) =>
    typeof field === "object" && (field.tag === "!repeat" || (field.tag === "!schema" && schemaHasRepeat(field)))
  ) || (schema.item?.tag === "!schema" && schemaHasRepeat(schema.item)) ||
    (schema.items ?? []).some((item) => item.tag === "!schema" && schemaHasRepeat(item));
}

type SchemaFrameProgress = {
  completed: number;
  total: number;
  pendingRepeatControls: number;
};

function schemaFrameProgress(run: RunState, frame: RunFrame): SchemaFrameProgress {
  const events = run.events.slice(frame.eventStartIndex ?? 0);
  const artifactSteps = frame.steps.filter((step) => step.artifact && step.kind !== "repeat");
  return {
    completed: artifactSteps.filter((step) => events.some((event) => event.stepId === step.id)).length,
    total: artifactSteps.length,
    pendingRepeatControls: frame.steps.filter((step) => step.kind === "repeat").length
  };
}

async function refreshSchemaDraft(
  runsRoot: string,
  run: RunState,
  context: SchemaParentContext,
  progress: SchemaFrameProgress,
  completed: boolean
): Promise<SchemaDraftState> {
  const existing = run.schemaDrafts?.[context.parentStep.id];
  const fileName = existing?.fileName ?? schemaDraftFileName(context.parentStep);
  const relativePath = existing?.path ?? posix.join(run.id, "artifacts", "drafts", fileName);
  const assembled = await assembleSchemaArtifact(runsRoot, run, context.schemaFrame, !completed);
  await writeManagedSchemaDraft(runsRoot, run.id, relativePath, assembled);

  let validation: ArtifactValidationResult | undefined;
  if (completed) {
    const contract = await contractForStep(run, context.parentStep);
    const validationContext = {
      runId: run.id,
      stepId: context.parentStep.id,
      artifactPath: context.parentStep.id,
      attemptId: randomUUID()
    };
    try {
      const candidate = await prepareArtifactCandidate(contract, { kind: "inline", value: assembled }, validationContext);
      const plan = context.parentStep.validationPlan ?? artifactValidatorRegistry.resolvePlan(contract);
      validation = await artifactValidatorRegistry.execute(plan, {
        contract,
        candidate,
        context: validationContext
      });
    } catch (error) {
      if (error instanceof ArtifactValidationFailure) validation = error.result;
      else throw error;
    }
  }

  const now = new Date().toISOString();
  const draft: SchemaDraftState = {
    stepId: context.parentStep.id,
    schemaName: context.schemaFrame.memoryName,
    status: completed ? "awaiting_finalization" : "writing",
    path: relativePath,
    fileName,
    contentType: "text/markdown",
    completed: progress.completed,
    total: progress.total,
    pendingRepeatControls: progress.pendingRepeatControls || undefined,
    assembledDigest: digestText(assembled),
    validation,
    updatedAt: now
  };
  (run.schemaDrafts ??= {})[context.parentStep.id] = draft;
  return draft;
}

function schemaDraftFileName(step: RunStep): string {
  const slug = slugify(step.artifact ?? step.id) || "artifact";
  const identity = createHash("sha256").update(step.id).digest("hex").slice(0, 8);
  return `${slug}-${identity}.draft.md`;
}

async function writeManagedSchemaDraft(
  runsRoot: string,
  runId: string,
  relativePath: string,
  content: string
): Promise<void> {
  const artifactRoot = await ensureRunArtifactDirectory(runsRoot, runId);
  const target = resolve(runsRoot, relativePath);
  assertInsideRunArtifactDirectory(target, artifactRoot);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function assembleSchemaArtifact(
  runsRoot: string,
  run: RunState,
  frame: RunFrame,
  includePending = false
): Promise<string> {
  const events = run.events.slice(frame.eventStartIndex ?? 0);
  const chunks: string[] = [];
  for (const step of frame.steps) {
    if (!step.artifact || step.kind === "repeat") continue;
    const event = events.find((candidate) => candidate.stepId === step.id);
    if (!event && !includePending) continue;
    if (event?.artifact.fields?.skipped === true) continue;
    const value = event?.artifact.storage === "file" && event.artifact.path
      ? await readFile(join(runsRoot, event.artifact.path), "utf8")
      : String(event?.artifact.value ?? "");
    const pending = event ? undefined : `<!-- memsphere:pending field=${step.artifact} -->`;
    if (step.artifact === frame.memoryName) {
      if (value.trim()) chunks.push(value.trim());
      else if (pending) chunks.push(pending);
      continue;
    }
    const relativePath = step.artifact.startsWith(`${frame.memoryName}.`)
      ? step.artifact.slice(frame.memoryName.length + 1)
      : step.artifact;
    const segments = relativePath.split(".");
    const title = segments.at(-1)?.replace(/\[(\d+)\]/g, " $1") ?? relativePath;
    const headingLevel = Math.min(6, segments.length + 1);
    chunks.push(`${"#".repeat(headingLevel)} ${title}`);
    if (value.trim()) chunks.push(value.trim());
    else if (pending) chunks.push(pending);
  }
  return `${chunks.join("\n\n")}\n`;
}

async function findSchemaMemory(memoryRoot: string, referenceOrName: string): Promise<MemoryFile | undefined> {
  if (referenceOrName.startsWith("schemas/")) {
    return findMemoryByReference(memoryRoot, "schemas", referenceOrName);
  }
  return findMemoryByName(memoryRoot, "schemas", referenceOrName, true);
}

async function findMemoryByReference(memoryRoot: string, kind: "schemas", reference: string): Promise<MemoryFile | undefined> {
  const paths = await listMemoryFiles(memoryRoot, kind);
  let hasInvalidMemory = false;

  for (const path of paths) {
    let file: MemoryFile;
    try {
      file = await readMemoryFile(kind, path);
    } catch {
      hasInvalidMemory = true;
      continue;
    }
    if (memoryReference(file) === reference) {
      return file;
    }
  }

  if (hasInvalidMemory) {
    throw new Error(
      `schema ${reference} could not be resolved because the Memory store ` +
      "contains invalid Memory YAML; run memsphere validate"
    );
  }
  return undefined;
}

function memoryReference(file: MemoryFile): string {
  return `${file.kind}/${file.entity.names[0] ?? ""}`;
}

async function findMemoryByName(
  memoryRoot: string,
  kind: "procedures" | "schemas",
  name: string,
  canonicalOnly = false
): Promise<MemoryFile | undefined> {
  const paths = await listMemoryFiles(memoryRoot, kind);
  let hasInvalidMemory = false;

  for (const path of paths) {
    let file: MemoryFile;
    try {
      file = await readMemoryFile(kind, path);
    } catch {
      // Run lookup should not be blocked by unrelated invalid memories.
      hasInvalidMemory = true;
      continue;
    }
    if (canonicalOnly ? file.entity.names[0] === name : file.entity.names.includes(name)) {
      return file;
    }
  }

  if (hasInvalidMemory) {
    throw new Error(
      `${kind === "procedures" ? "procedure" : "schema"} ${name} could not be resolved because the Memory store ` +
      "contains invalid Memory YAML; run memsphere validate"
    );
  }
  return undefined;
}

function runPath(runsRoot: string, id: string): string {
  return join(runsRoot, id, `${id}.json`);
}

function legacyRunPath(runsRoot: string, id: string): string {
  return join(runsRoot, `${id}.json`);
}

async function existingRunPath(runsRoot: string, id: string): Promise<string> {
  const current = runPath(runsRoot, id);
  try {
    await readFile(current, "utf8");
    return current;
  } catch {
    return legacyRunPath(runsRoot, id);
  }
}

async function writeRun(runsRoot: string, run: RunState): Promise<void> {
  const directory = join(runsRoot, run.id);
  const targetPath = runPath(runsRoot, run.id);
  const tempPath = join(directory, `.${run.id}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(tempPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
    await replaceRunFile(tempPath, targetPath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function replaceRunFile(tempPath: string, targetPath: string): Promise<void> {
  const retryableCodes = new Set(["EACCES", "EBUSY", "EPERM"]);
  const attempts = process.platform === "win32" ? 20 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rename(tempPath, targetPath);
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (!retryableCodes.has(String(code)) || attempt === attempts - 1) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10 * (attempt + 1)));
    }
  }
}

async function withRunWriteLock<T>(runsRoot: string, runId: string, work: () => Promise<T>): Promise<T> {
  const lockRoot = join(runsRoot, ".locks");
  const lockName = createHash("sha256").update(runId).digest("hex");
  const lockPath = join(lockRoot, `${lockName}.lock`);
  await mkdir(lockRoot, { recursive: true });
  const deadline = Date.now() + 30_000;
  const owner = { pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() };
  while (true) {
    try {
      await writeFile(lockPath, `${JSON.stringify(owner)}\n`, { flag: "wx" });
      break;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
      await removeStaleRunLock(lockPath);
      if (Date.now() >= deadline) throw new Error(`run is busy: ${runId}`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    }
  }

  try {
    return await work();
  } finally {
    await removeOwnedRunLock(lockPath, owner.token);
  }
}

async function removeStaleRunLock(lockPath: string): Promise<void> {
  const owner = await readRunLockOwner(lockPath);
  if (!owner) {
    try {
      if (Date.now() - (await stat(lockPath)).mtimeMs < 1_000) return;
      if (!await readRunLockOwner(lockPath)) await rm(lockPath, { force: true });
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    return;
  }
  if (processExists(owner.pid)) return;
  const current = await readRunLockOwner(lockPath);
  if (current?.token === owner.token && !processExists(current.pid)) await rm(lockPath, { force: true });
}

async function removeOwnedRunLock(lockPath: string, token: string): Promise<void> {
  const owner = await readRunLockOwner(lockPath);
  if (owner?.token === token) await rm(lockPath, { force: true });
}

async function readRunLockOwner(lockPath: string): Promise<{ pid: number; token: string } | undefined> {
  try {
    const value = JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>;
    return Number.isSafeInteger(value.pid) && typeof value.token === "string"
      ? { pid: value.pid as number, token: value.token }
      : undefined;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    return undefined;
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code !== "ESRCH");
  }
}

function makeRunId(iso: string): string {
  const stamp = iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-").toLowerCase();
  return `run-${stamp}-${randomUUID().slice(0, 8)}`;
}

function makeBindingChangeId(iso: string): string {
  const stamp = iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-").toLowerCase();
  return `binding-change-${stamp}-${randomUUID().slice(0, 8)}`;
}

function normalizeLegacyRun(value: unknown): RunState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid v1 run state");
  const legacy = value as Record<string, unknown>;
  const plan = Array.isArray(legacy.plan) ? legacy.plan.map(normalizeLegacyStep) : undefined;
  const stack = Array.isArray(legacy.stack) ? legacy.stack.map((frameValue) => {
    const frame = frameValue as Record<string, unknown>;
    return {
      type: frame.type === "schema" ? "schema" as const : "procedure" as const,
      memoryName: String(frame.memoryName ?? ""),
      asserts: stringList(frame.asserts),
      steps: Array.isArray(frame.steps) ? frame.steps.map(normalizeLegacyStep) : [],
      index: Number(frame.index ?? 0),
      returnTo: typeof frame.returnTo === "string" ? frame.returnTo : undefined,
      sourceStepId: typeof frame.sourceStepId === "string" ? frame.sourceStepId : undefined,
      eventStartIndex: typeof frame.eventStartIndex === "number" ? frame.eventStartIndex : undefined
    };
  }) : [];
  const stepsById = new Map<string, RunStep>();
  for (const step of [...(plan ?? []), ...stack.flatMap((frame) => frame.steps)]) collectSteps(step, stepsById);
  const events = Array.isArray(legacy.events) ? legacy.events.map((eventValue) => normalizeLegacyEvent(eventValue, stepsById)) : [];

  return {
    contractVersion: 1,
    readOnly: true,
    id: String(legacy.id ?? ""),
    name: typeof legacy.name === "string" ? legacy.name : undefined,
    status: legacy.status === "done" ? "done" : "running",
    procedureName: String(legacy.procedureName ?? ""),
    asserts: stringList(legacy.asserts),
    memoryRoot: String(legacy.memoryRoot ?? ""),
    createdAt: String(legacy.createdAt ?? ""),
    updatedAt: String(legacy.updatedAt ?? legacy.createdAt ?? ""),
    plan,
    stack,
    events
  };
}

function normalizeLegacyStep(value: unknown): RunStep {
  const legacy = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const normalized = legacyContract(String(legacy.artifact ?? ""), legacy.format, legacy.inlineSchema);
  const schema = legacySchemaContract(legacy);
  return {
    id: String(legacy.id ?? ""),
    kind: isRunStepKind(legacy.kind) ? legacy.kind : undefined,
    instruction: String(legacy.instruction ?? ""),
    actor: legacy.actor === "human" ? "human" : legacy.actor === "agent" ? "agent" : undefined,
    artifact: typeof legacy.artifact === "string" ? legacy.artifact : undefined,
    type: normalized?.type,
    format: normalized?.format,
    schema,
    final: legacy.final === true || undefined,
    asserts: stringList(legacy.asserts),
    suggests: stringList(legacy.suggests),
    details: stringList(legacy.details),
    target: typeof legacy.target === "string" ? legacy.target : undefined,
    branches: legacy.branches && typeof legacy.branches === "object"
      ? {
          truthy: Array.isArray((legacy.branches as Record<string, unknown>).truthy)
            ? ((legacy.branches as Record<string, unknown>).truthy as unknown[]).map(normalizeLegacyStep)
            : [],
          falsy: Array.isArray((legacy.branches as Record<string, unknown>).falsy)
            ? ((legacy.branches as Record<string, unknown>).falsy as unknown[]).map(normalizeLegacyStep)
            : []
        }
      : undefined,
    loop: legacy.loop && typeof legacy.loop === "object" && Array.isArray((legacy.loop as Record<string, unknown>).body)
      ? { body: ((legacy.loop as Record<string, unknown>).body as unknown[]).map(normalizeLegacyStep) }
      : undefined,
    repeat: legacy.repeat as RunStep["repeat"]
  };
}

function normalizeLegacyEvent(value: unknown, stepsById: Map<string, RunStep>): RunEvent {
  const legacy = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const artifact = legacy.artifact && typeof legacy.artifact === "object" && !Array.isArray(legacy.artifact)
    ? legacy.artifact as Record<string, unknown>
    : {};
  const stepId = String(legacy.stepId ?? "");
  const step = stepsById.get(stepId);
  const normalized = step?.type && step.format
    ? { type: step.type, format: step.format }
    : legacyContract(String(artifact.name ?? ""), artifact.format, undefined) ?? {
        type: "string",
        format: { name: "plain", options: {} }
      };
  const schema = step?.schema ?? legacyEventSchema(artifact);
  return {
    at: String(legacy.at ?? ""),
    frame: legacy.frame === "schema" ? "schema" : "procedure",
    stepId,
    artifact: {
      name: String(artifact.name ?? step?.artifact ?? ""),
      type: normalized.type,
      format: normalized.format,
      fields: artifact.fields && typeof artifact.fields === "object" && !Array.isArray(artifact.fields)
        ? artifact.fields as Record<string, unknown>
        : undefined,
      schema,
      final: artifact.final === true || undefined,
      storage: artifact.storage === "file" ? "file" : artifact.storage === "inline" ? "inline" : undefined,
      value: artifact.value,
      path: typeof artifact.path === "string" ? artifact.path : undefined,
      fileName: typeof artifact.fileName === "string" ? artifact.fileName : undefined,
      contentType: typeof artifact.contentType === "string" ? artifact.contentType : undefined
    }
  };
}

function legacyContract(name: string, formatValue: unknown, schemaValue: unknown): Pick<CompiledArtifactContract, "type" | "format"> | undefined {
  if (typeof formatValue !== "string") return undefined;
  switch (formatValue) {
    case "boolean": return { type: "boolean", format: { name: "plain", options: {} } };
    case "number": return { type: "number", format: { name: "plain", options: {} } };
    case "string": return { type: "string", format: { name: "plain", options: {} } };
    case "markdown": return { type: "string", format: { name: "markdown", options: {} } };
    case "json": return { type: "object", format: { name: "json", options: {} } };
    case "yaml": return { type: "object", format: { name: "yaml", options: {} } };
    case "schema": {
      const layout = legacySchemaLayout(schemaValue);
      return {
        type: layout === "table" ? "array" : "object",
        format: { name: "markdown", options: { layout } }
      };
    }
    default:
      throw new Error(`unsupported v1 Artifact format ${formatValue} for ${name}`);
  }
}

function legacySchemaContract(legacy: Record<string, unknown>): RunSchemaContract | undefined {
  if (typeof legacy.schemaName === "string") return { kind: "external", name: legacy.schemaName };
  if (legacy.inlineSchema && typeof legacy.inlineSchema === "object" && !Array.isArray(legacy.inlineSchema)) {
    return {
      kind: "inline",
      id: typeof legacy.inlineSchemaId === "string" ? legacy.inlineSchemaId : "inline:v1",
      node: normalizeLegacySchema(legacy.inlineSchema)
    };
  }
  return undefined;
}

function legacyEventSchema(artifact: Record<string, unknown>): RunSchemaContract | undefined {
  const fields = artifact.fields && typeof artifact.fields === "object" && !Array.isArray(artifact.fields)
    ? artifact.fields as Record<string, unknown>
    : {};
  const name = typeof fields.schema_name === "string" ? fields.schema_name : artifact.schemaName;
  if (typeof name === "string") return { kind: "external", name };
  const id = typeof fields.inline_schema_id === "string" ? fields.inline_schema_id : artifact.inlineSchemaId;
  return typeof id === "string" ? { kind: "inline", id, node: emptyLegacySchema(id) } : undefined;
}

function normalizeLegacySchema(value: unknown): SchemaNode {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const fields = Array.isArray(source.fields) ? source.fields.map((field) => {
    if (typeof field === "string") return field;
    if (field && typeof field === "object" && (field as { tag?: unknown }).tag === "!repeat") {
      const repeat = structuredClone(field) as Record<string, unknown>;
      if (Array.isArray(repeat.body)) repeat.body = repeat.body.map((bodyField) => typeof bodyField === "string" ? bodyField : normalizeLegacySchema(bodyField));
      return repeat as unknown as StaticSchemaField;
    }
    return normalizeLegacySchema(field);
  }) : undefined;
  return {
    tag: "!schema",
    names: stringList(source.names) ?? [],
    defines: Array.isArray(source.defines) ? source.defines as DefinitionPart[] : [],
    asserts: stringList(source.asserts),
    fields: fields as SchemaNode["fields"],
    item: source.item ? normalizeLegacySchema(source.item) : undefined,
    items: Array.isArray(source.items) ? source.items.map(normalizeLegacySchema) : undefined
  };
}

function emptyLegacySchema(id: string): SchemaNode {
  return { tag: "!schema", names: [id], defines: [] };
}

function legacySchemaLayout(value: unknown): "outline" | "table" {
  return value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).format === "table"
    ? "table"
    : "outline";
}

function collectSteps(step: RunStep, steps: Map<string, RunStep>): void {
  steps.set(step.id, step);
  for (const child of step.branches?.truthy ?? []) collectSteps(child, steps);
  for (const child of step.branches?.falsy ?? []) collectSteps(child, steps);
  for (const child of step.loop?.body ?? []) collectSteps(child, steps);
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function isRunStepKind(value: unknown): value is NonNullable<RunStep["kind"]> {
  return ["action", "branch", "loop", "call", "repeat"].includes(String(value));
}
