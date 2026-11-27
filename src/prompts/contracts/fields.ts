import { action, bool, command, content, either, integer, list, literal, map, nil, number, object, oneOf, text, yes } from "./types.js";
import { z } from "zod";

export const publicDaemonStartView: z.ZodTypeAny = object({
  running: bool,
  desiredState: oneOf("running", "stopped"),
  url: text.optional(),
  errorCode: literal("VIEW_UNAVAILABLE").optional(),
  settingsAccess: oneOf("local", "configured", "setup_required").optional()
});

export const publicDaemonStartTasks: z.ZodTypeAny = object({
  queued: integer.optional(),
  running: integer.optional(),
  completed: integer.optional(),
  failed: integer.optional(),
  cancelled: integer.optional()
});

export const publicRunnerDetectEntryItem: z.ZodTypeAny = object({
  type: text,
  status: oneOf("installed", "version_unknown", "missing", "failed"),
  version: text.optional()
});

export const publicModelListEntryItem: z.ZodTypeAny = object({
  id: text,
  title: text.optional(),
  name: text.optional(),
  origin: text.optional(),
  status: text,
  errorCode: text.optional()
});

export const publicModelReadRegistration: z.ZodTypeAny = object({
  modelRef: text,
  name: text.optional(),
  description: text.optional(),
  package: text.optional(),
  package_name: text.optional(),
  tags: list(text).optional()
});

export const publicModelValidateChecks: z.ZodTypeAny = object({
  definition: text,
  runtime: text
});

export const publicModelValidateDataItem: z.ZodTypeAny = object({
  storeId: text,
  checked: integer
});

export const publicDataStoreListEntryItem: z.ZodTypeAny = object({
  storeId: text,
  model: text,
  kind: oneOf("value", "data"),
  factory: text,
  status: text,
  errorCode: text.optional()
});

export const publicDataStoreReadCapabilities: z.ZodTypeAny = object({
  value: bool,
  payload: bool,
  conditionalWrite: bool,
  update: bool,
  upsert: bool,
  edit: bool
});

export const publicDataListEntryItem: z.ZodTypeAny = object({
  id: text
});

export const publicProjectModelsInitializeSystem: z.ZodTypeAny = object({
  status: oneOf("installed", "unchanged"),
  created: integer,
  retained: integer
});

export const publicProjectModelsInitializeContextcontrol: z.ZodTypeAny = object({
  changed: bool,
  records: integer
});

export const publicProjectListEntryItem: z.ZodTypeAny = object({
  name: text,
  root: text,
  missing: bool,
  relation: oneOf("primary", "mounted", "unbound")
});

export const publicProjectShowHealth: z.ZodTypeAny = object({
  status: oneOf("ok", "unhealthy"),
  reason: oneOf("memory_missing", "wrong_branch", "revision_mismatch", "dirty", "unavailable").optional()
});

export const publicSystem: z.ZodTypeAny = object({
  status: oneOf("installed", "upgraded", "unchanged"),
  created: integer,
  updated: integer,
  retained: integer
});

export const publicProjectUpgradeModels: z.ZodTypeAny = object({
  status: oneOf("upgraded", "unchanged", "failed", "not_run"),
  created: integer.optional(),
  updated: integer.optional(),
  retained: integer.optional(),
  system: publicSystem.optional()
});

export const publicChangeSet: z.ZodTypeAny = object({
  id: text,
  status: text,
  intent: literal("system_upgrade"),
  view: text,
  validation: oneOf("not_run", "passed"),
  checkpointDigest: text.optional()
});

export const publicProjectUpgradeMemory: z.ZodTypeAny = object({
  status: oneOf("upgraded", "unchanged", "failed", "not_run"),
  created: integer.optional(),
  updated: integer.optional(),
  deleted: integer.optional(),
  changeSet: publicChangeSet.optional(),
  integrationStatus: literal("pending").optional(),
  branch: text.optional(),
  worktree: text.optional(),
  revision: text.optional()
});

export const publicProjectUpgradeFailure: z.ZodTypeAny = object({
  stage: text,
  code: text
});

export const publicAppListAppsItem: z.ZodTypeAny = object({
  id: text,
  name: text,
  version: text,
  enabled: bool
});

export const publicAction = command;

export const publicAgentItem: z.ZodTypeAny = object({
  reference: text,
  action: publicAction
});

export const publicViewItem: z.ZodTypeAny = object({
  instanceId: text,
  path: text.optional()
});

export const publicAppShowUsage: z.ZodTypeAny = object({
  agent: list(publicAgentItem),
  view: list(publicViewItem)
});

export const publicAppShowProjectstoresItem: z.ZodTypeAny = object({
  key: text,
  model: text,
  kind: text,
  storeId: either(text, nil)
});

export const publicAppCheckEntryItem: z.ZodTypeAny = object({
  name: text,
  status: text
});

export const publicCliListEntryItem: z.ZodTypeAny = object({
  id: text,
  status: text,
  apps: list(text)
});

export const publicValidateIssuesItem: z.ZodTypeAny = object({
  code: oneOf("INVALID_MEMORY", "MIGRATION_REQUIRED", "INVALID_STORE", "SCHEMA_OPTIONAL_INVALID", "REFERENCE_INVALID", "REFERENCE_KIND_MISMATCH", "REFERENCE_NOT_FOUND", "REFERENCE_RULES_MISSING", "REFERENCE_CYCLE"),
  path: text.optional(),
  line: integer.optional(),
  column: integer.optional()
});

export const publicMemoryListMemory: z.ZodTypeAny = object({
  reference: text,
  kind: oneOf("procedures", "concepts", "statements", "schemas"),
  names: list(text, 10)
});

export const publicMemoryListEntryItem: z.ZodTypeAny = object({
  node_ref: text,
  type: text,
  name: text.optional(),
  field: text.optional(),
  artifact: text.optional(),
  condition_artifact: text.optional(),
  target: text.optional(),
  summary: text.optional(),
  relation: text.optional(),
  has_children: bool
});

export const publicApp: z.ZodTypeAny = object({
  id: text,
  version: text,
  assetKey: text,
  enabled: bool
});

export const publicMemoryListEntryItem2: z.ZodTypeAny = object({
  reference: text,
  kind: oneOf("procedures", "concepts", "statements", "schemas"),
  names: list(text, 10),
  summary: text.optional(),
  project_name: text.optional(),
  revision: text.optional(),
  app: publicApp.optional()
});

export const publicMemoryReadMemory: z.ZodTypeAny = object({
  reference: text,
  kind: text,
  names: list(text)
});

export const publicAncestorsItem: z.ZodTypeAny = object({
  node_ref: text.optional(),
  type: text,
  relation: text,
  value: content
});

export const publicMemoryReadContext: z.ZodTypeAny = object({
  root: content,
  ancestors: list(publicAncestorsItem)
});

export const publicMemoryEditTargetsItem: z.ZodTypeAny = object({
  reference: text,
  path: text,
  operation: oneOf("create", "update")
});

export const publicMemoryChangeShowFilesItem: z.ZodTypeAny = object({
  reference: text,
  path: text,
  operation: text
});

export const publicIssuesItem: z.ZodTypeAny = object({
  code: text,
  path: text.optional(),
  line: integer.optional(),
  column: integer.optional()
});

export const publicMemoryChangeShowValidation: z.ZodTypeAny = object({
  valid: bool,
  baseRevision: text,
  createdAt: text,
  issueCount: integer,
  issues: list(publicIssuesItem)
});

export const publicMemoryChangeShowFilesItem2: z.ZodTypeAny = object({
  reference: text,
  path: text,
  operation: text,
  diff: text
});

export const publicRunStartRulesItem: z.ZodTypeAny = object({
  scope: text,
  text: text
});

export const publicRunStartMaterialsItem: z.ZodTypeAny = object({
  kind: oneOf("artifact", "external"),
  id: text,
  read: publicAction.optional()
});

export const publicRunStartReviewsItem: z.ZodTypeAny = object({
  scope: text,
  artifact: text,
  slots: list(text),
  policies: list(text)
});

export const publicRunStartSlotsItem: z.ZodTypeAny = object({
  key: text,
  procedure: text,
  name: text
});

export const publicRunStartActorsItem: z.ZodTypeAny = object({
  id: text,
  name: text,
  kind: oneOf("human", "agent"),
  permissions: list(text)
});

export const publicReviewsValue: z.ZodTypeAny = object({
  policy: text
});

export const publicSlotsValue: z.ZodTypeAny = object({
  actors: list(text)
});

export const publicSlotsValue2: z.ZodTypeAny = object({
  skip: yes
});

export const publicRunStartExample: z.ZodTypeAny = object({
  reviews: map(publicReviewsValue),
  slots: map(either(publicSlotsValue, publicSlotsValue2))
});

export const publicRunReportDependenciesItem: z.ZodTypeAny = object({
  kind: oneOf("artifact", "external"),
  id: text
});

export const publicRunReportReceipt: z.ZodTypeAny = object({
  artifactName: text,
  dataId: text.optional()
});

export const publicRunShowRun: z.ZodTypeAny = object({
  id: text,
  name: text,
  status: text
});

export const publicRunShowStepsItem: z.ZodTypeAny = object({
  id: text,
  status: text,
  actionId: text.optional(),
  artifactId: text.optional(),
  effective: bool.optional()
});

export const publicRunShowStepsItem2: z.ZodTypeAny = object({
  id: text,
  actionId: text.optional(),
  status: text,
  artifactIds: list(text)
});

export const publicRunBindingShowNextroundValue: z.ZodTypeAny = object({
  actorIds: list(text),
  skipped: bool
});

export const publicRunBindingShowRoundsItem: z.ZodTypeAny = object({
  stepId: text,
  roundId: text,
  bindings: map(publicRunBindingShowNextroundValue)
});

export const publicBinding: z.ZodTypeAny = object({
  actorIds: list(text)
});

export const publicActiveReviewsItem: z.ZodTypeAny = object({
  reviewId: text,
  artifactScope: text,
  currentRoundId: text,
  currentRoundSequence: integer,
  currentBinding: either(publicBinding, publicSlotsValue2),
  nextBinding: either(publicBinding, publicSlotsValue2),
  effectiveFromRoundSequence: integer
});

export const publicRunBindingShowSlotsItem: z.ZodTypeAny = object({
  key: text,
  binding: either(publicBinding, publicSlotsValue2),
  reviewScopes: list(text),
  reviewIds: list(text),
  activeReviews: list(publicActiveReviewsItem).optional()
});

export const publicRunBindingUpdateBindings: z.ZodTypeAny = object({
  runId: text,
  status: text,
  readOnly: bool,
  actors: list(publicRunStartActorsItem),
  slots: list(publicRunBindingShowSlotsItem)
});

export const publicRunTryRunEntryItem: z.ZodTypeAny = object({
  assignmentId: text,
  promptPath: text,
  launchPath: text
});

export const publicInputGroupsValueItem: z.ZodTypeAny = object({
  id: text,
  kind: oneOf("artifact", "external")
});

export const publicRunStepShowStep: z.ZodTypeAny = object({
  id: text,
  actionId: text.optional(),
  status: text,
  effective: bool,
  supersedingRewindId: text.optional(),
  inputGroups: map(list(publicInputGroupsValueItem)).optional(),
  artifactId: text.optional()
});

export const publicFormat: z.ZodTypeAny = object({
  name: text,
  options: map(content).optional()
});

export const publicArtifact: z.ZodTypeAny = object({
  name: text,
  type: text.optional(),
  format: publicFormat.optional(),
  schema: content.optional(),
  final: bool,
  review: text.optional()
});

export const publicRunStepShowStep2: z.ZodTypeAny = object({
  id: text,
  kind: text,
  actor: oneOf("agent", "human"),
  instruction: text,
  asserts: list(content),
  suggests: list(content),
  details: list(text),
  artifact: publicArtifact.optional()
});

export const publicInheritedFrom: z.ZodTypeAny = object({
  stepId: text,
  artifactId: text
});

export const publicRunStepShowConfiguration: z.ZodTypeAny = object({
  reviewer: text.optional(),
  asserts: list(text).optional(),
  suggests: list(text).optional(),
  inheritedFrom: publicInheritedFrom.optional()
});

export const publicRunStepShowReviewersItem: z.ZodTypeAny = object({
  value: text,
  label: text
});

export const publicRunArtifactShowEntryItem: z.ZodTypeAny = object({
  artifactId: text,
  name: text,
  status: text,
  contentType: text.optional(),
  dependencies: list(publicInputGroupsValueItem)
});

export const publicRunArtifactShowArtifact: z.ZodTypeAny = object({
  name: text,
  type: text.optional(),
  format: publicFormat.optional(),
  final: bool.optional(),
  contentType: text.optional(),
  fileName: text.optional(),
  storage: oneOf("inline", "file").optional(),
  value: content.optional()
});

export const publicRunArtifactShowRevisionsummary: z.ZodTypeAny = object({
  body: text,
  digest: text,
  createdAt: text,
  previousSubmissionId: text.optional()
});

export const publicRunArtifactShowContextartifactsItem: z.ZodTypeAny = object({
  stepId: text,
  artifactId: text.optional(),
  artifact: publicRunArtifactShowArtifact
});

export const publicDestination: z.ZodTypeAny = object({
  storeId: text,
  modelRef: text,
  dataId: text,
  operation: oneOf("upsert", "create")
});

export const publicBusiness: z.ZodTypeAny = object({
  destination: publicDestination,
  value: content.optional()
});

export const publicRunArtifactShowArtifact2: z.ZodTypeAny = object({
  name: text,
  type: text.optional(),
  format: publicFormat.optional(),
  final: bool.optional(),
  contentType: text.optional(),
  fileName: text.optional(),
  storage: oneOf("inline", "file").optional(),
  value: content.optional(),
  dependencies: list(publicRunReportDependenciesItem),
  business: publicBusiness.optional()
});

export const publicRunArtifactShowContextartifactsItem2: z.ZodTypeAny = object({
  artifactId: text,
  stepId: text,
  artifact: publicRunArtifactShowArtifact2
});

export const publicRunArtifactShowContextexternalsItem: z.ZodTypeAny = object({
  externalId: text,
  source: text,
  viaArtifactIds: list(text)
});

export const publicVote: z.ZodTypeAny = object({
  value: text,
  summary: text.optional()
});

export const publicAnchor: z.ZodTypeAny = object({
  submissionId: text.optional(),
  target: text.optional(),
  location: text.optional(),
  sourceHash: text.optional(),
  context: text.optional(),
  targetRef: publicRunReportDependenciesItem.optional()
});

export const publicCommentsItem: z.ZodTypeAny = object({
  commentId: text.optional(),
  id: text.optional(),
  body: text,
  severity: text.optional(),
  createdAt: text.optional(),
  updatedAt: text.optional(),
  anchor: publicAnchor.optional()
});

export const publicRunArtifactShowConfirmationsItem: z.ZodTypeAny = object({
  id: text,
  roundId: text.optional(),
  artifactId: text,
  status: text,
  actorId: text.optional(),
  kind: text.optional(),
  vote: publicVote.optional(),
  comments: list(publicCommentsItem)
});

export const publicRunArtifactShowBusiness: z.ZodTypeAny = object({
  destination: publicDestination,
  valuePreview: text.optional(),
  valueTruncated: bool.optional()
});

export const publicSource: z.ZodTypeAny = object({
  kind: oneOf("procedure", "step", "schema", "statement"),
  path: text,
  memoryRef: text.optional()
});

export const publicRunArtifactContractShowSchema: z.ZodTypeAny = object({
  definition: text,
  source: publicSource
});

export const publicRunArtifactContractShowProcedure: z.ZodTypeAny = object({
  name: text,
  asserts: list(content)
});

export const publicRunArtifactContractShowAction: z.ZodTypeAny = object({
  instruction: text,
  asserts: list(content),
  suggests: list(content),
  details: list(text)
});

export const publicFormat2: z.ZodTypeAny = object({
  name: text,
  options: map(content)
});

export const publicModelTarget: z.ZodTypeAny = object({
  storeId: text,
  modelRef: text,
  dataId: text.optional()
});

export const publicRunArtifactContractShowArtifact: z.ZodTypeAny = object({
  name: text,
  type: text.optional(),
  format: publicFormat2.optional(),
  schema: content.optional(),
  final: bool,
  review: text.optional(),
  modelTarget: publicModelTarget.optional()
});

export const publicRunSchemaShowCurrent: z.ZodTypeAny = object({
  id: text,
  kind: text,
  path: text.optional(),
  instruction: text,
  type: text.optional(),
  format: text.optional(),
  optional: bool.optional(),
  min: number.optional(),
  max: number.optional()
});

export const publicRunSchemaShowProgress: z.ZodTypeAny = object({
  completed: integer,
  total: integer,
  remaining: integer
});

export const publicRunSchemaShowValidation: z.ZodTypeAny = object({
  status: text,
  issueCount: integer
});

export const publicRunReviewWaitStatusEntryItem: z.ZodTypeAny = object({
  id: text,
  roundId: text,
  currentRound: bool,
  status: oneOf("queued", "running", "completed", "failed", "cancelled"),
  stage: oneOf("wait", "render", "send", "cancel", "recovery").optional()
});

export const publicRunReviewAssignmentShowMemoryreads: z.ZodTypeAny = object({
  project: text,
  frozen: text.optional()
});

export const publicRunReviewAssignmentShowReferencesItem: z.ZodTypeAny = object({
  kind: oneOf("artifact", "external", "review"),
  id: text,
  stepId: text.optional(),
  confirmation: text.optional(),
  source: text.optional(),
  viaArtifactIds: list(text).optional(),
  artifactId: text.optional(),
  roundId: text.optional(),
  readCommand: text.optional()
});

export const publicRunReviewAssignmentShowReviewprogress: z.ZodTypeAny = object({
  phase: text,
  processed: integer,
  total: integer
});

export const publicRunReviewCreateCommentsItem: z.ZodTypeAny = object({
  commentId: text,
  body: text
});

export const publicRunReviewListEntryItem: z.ZodTypeAny = object({
  reviewId: text,
  artifactId: text,
  status: text,
  source: oneOf("human", "agent").optional(),
  commentCount: integer,
  details: command
});

export const publicRunReviewListEntryItem2: z.ZodTypeAny = object({
  reviewId: text,
  roundId: text,
  artifactId: text,
  stepId: text,
  createdAt: text,
  reviewer: text.optional(),
  status: text,
  progress: publicRunReviewAssignmentShowReviewprogress.optional()
});

export const publicAssertsItem: z.ZodTypeAny = object({
  rulePath: text,
  text: text
});

export const publicRuleResultsItem: z.ZodTypeAny = object({
  rulePath: text,
  result: oneOf("not_satisfied", "undetermined"),
  commentIds: list(text)
});

export const publicRunReviewShowNode: z.ZodTypeAny = object({
  nodeId: text,
  name: text,
  kind: literal("open_review").optional(),
  reported: bool,
  applicable: bool.optional(),
  requiresReport: bool,
  complete: bool,
  hasContent: bool,
  isCurrent: bool,
  source: publicSource.optional(),
  defines: list(text).optional(),
  path: list(text).optional(),
  asserts: list(publicAssertsItem).optional(),
  suggests: list(publicAssertsItem).optional(),
  ruleResults: list(publicRuleResultsItem).optional(),
  reasonCommentId: text.optional(),
  commentIds: list(text),
  comments: list(publicCommentsItem).optional(),
  assertCount: integer.optional(),
  suggestCount: integer.optional()
});

export const publicRunReviewShowAssignmentsItem: z.ZodTypeAny = object({
  assignmentId: text,
  actorId: text,
  name: text,
  kind: oneOf("agent", "human"),
  binding: oneOf("advisory", "decision"),
  status: text,
  vote: text.optional(),
  summary: text.optional(),
  progress: publicRunReviewAssignmentShowReviewprogress.optional(),
  failureCode: text.optional()
});

export const publicRunReviewShowCommentsItem: z.ZodTypeAny = object({
  commentId: text,
  actorId: text,
  severity: text.optional(),
  body: text,
  disposition: text.optional(),
  truncated: bool.optional()
});

export const publicRunStatusRunsItem: z.ZodTypeAny = object({
  runId: text,
  name: text,
  status: text
});

export const publicMigrateSyntaxIssuesItem: z.ZodTypeAny = object({
  code: text,
  file: text,
  path: text
});

export const publicArchiveListEntryItem: z.ZodTypeAny = object({
  kind: oneOf("runs", "changes"),
  id: text,
  archivedAt: text.optional()
});

export const publicRunReviewListTree: z.ZodTypeAny = z.lazy(() => object({
  nodeId: text,
  name: text,
  kind: literal("open_review").optional(),
  reported: bool,
  applicable: bool.optional(),
  requiresReport: bool,
  complete: bool,
  hasContent: bool,
  isCurrent: bool,
  reasonCommentId: text.optional(),
  commentIds: list(text),
  assertCount: integer,
  suggestCount: integer,
  children: list(publicRunReviewListTree)
}));
