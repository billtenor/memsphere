import { z } from "zod";
import { validPublicCommand } from "./actions.js";
import type { CliCommand } from "../cli-command.js";
import { cliCommandSchema, nextAction } from "../cli-output.js";

export const publicCodes = new Set(`AGENT_SESSION_REQUIRED ALREADY_EXISTS ALREADY_SUBMITTED AMBIGUOUS_REFERENCE AMBIGUOUS_RUN
APP_CONFIG_CONFLICT APP_CONFIG_REVISION_REQUIRED APP_DISABLED APP_MODEL_READ_ONLY APP_NOT_FOUND APP_OPERATION_FAILED APP_PROJECT_NOT_FOUND APP_READ_ONLY_SOURCE APP_SETTINGS_ERROR APP_SETTINGS_READ_ONLY
ARTIFACT_CONTRACT_MISMATCH ARTIFACT_VALIDATION_FAILED BUSINESS_RECEIPT_SAVE_FAILED BUSINESS_WRITE_RECOVERY_REQUIRED BUSINESS_WRITE_UNCONFIRMED CHANGESET_WRITE_BUSY CHECKPOINT_CONFLICT MEMORY_CHECKPOINT_INVALID CONFLICT CONTENT_CHANGED CONTENT_INVALID CONTENT_TYPE_MISMATCH CONTENT_TYPE_UNSUPPORTED CONTROL_PLANE_REQUIRED DATA_DELETED DATA_VALIDATION_FAILED
DEPENDENCY_CYCLE EMBEDDED_CHANGE_AMBIGUOUS EMBEDDED_CLAIM_WRITE_FAILED EMBEDDED_CONTEXT_BUSY EXAMPLE_RELOCATION_CONFLICT EXAMPLE_RELOCATION_FAILED GRAPH_AUTOMATIC_LIMIT GRAPH_CONDITION_FAILED GRAPH_CONDITION_TYPE GRAPH_CONTEXT_CONFLICT GRAPH_INCOMPLETE GRAPH_SOURCE_UNAVAILABLE HUMAN_CONFIRMATION_REQUIRED INCOMPLETE_ARTIFACT INITIALIZATION_INCOMPLETE INPUT_INVALID
INTERNAL_ERROR INVALID_ARGUMENT INVALID_CURSOR INVALID_DATA INVALID_INPUT INVALID_REVIEWER INVALID_REVIEW_RULES INVALID_STATE LOCK_TIMEOUT MEMORY_CHANGED MEMORY_FROZEN MEMORY_PUBLISH_BUSY MEMORY_REPAIR_BUSY MEMORY_REPAIR_CONFLICT MODEL_ARTIFACT_TARGET_CHANGED MODEL_DEFINITION_HASH_MISMATCH MODEL_DEFINITION_INVALID MODEL_ID_INVALID
MODEL_IMPORT_CLEANUP_REQUIRED MODEL_INCOMPATIBLE MODEL_IN_USE MODEL_NOT_FOUND MODEL_NOT_REGISTERED MODEL_OPERATION_BUSY MODEL_OPERATION_CONFLICT MODEL_OPERATION_DAMAGED MODEL_OPERATION_PENDING MODEL_PACKAGE_CONFLICT MODEL_PACKAGE_NAME_CONFLICT MODEL_PACKAGE_NOT_FOUND MODEL_READ_CONFLICT MODEL_RECOVERY_REQUIRED MODEL_REFERENCE_INVALID MODEL_REFERENCE_UNSUPPORTED MODEL_REGISTRATION_INVALID MODEL_REGISTRATION_MIGRATION_REQUIRED MODEL_RUNTIME_UNSUPPORTED
NOTIFICATION_READ_RECEIPT_FAILED NOT_FOUND NO_TAG_MATCH OUTPUT_LIMIT_EXCEEDED OUTPUT_PIPE_CLOSED OUTPUT_RENDER_FAILED PERMISSION_DENIED PROCESS_IDENTITY_CHANGED PROCESS_IDENTITY_UNAVAILABLE PROCESS_TERMINATION_PENDING PROJECT_PREPARATION_PENDING RECOVERY_CONFLICT RECOVERY_REQUIRED REVIEWER_REQUIRED REVIEW_CONFIGURATION_REQUIRED REVIEW_CONFLICT REVIEW_CONTEXT_INVALID REVIEW_IDENTITY_CONFLICT REVIEW_NOT_READY REVIEW_PROTOCOL_UNSUPPORTED REVIEW_RESOURCE_DENIED REVIEW_RULES_REQUIRED REVIEW_SESSION_DENIED REVIEW_SESSION_INVALID
INVALID_PATCH INVALID_PATH INVALID_STORE_METADATA MODEL_REFLECTION_UNSUPPORTED PATCH_TEST_FAILED SCHEMA_OPTIONAL_INVALID TOS_CREDENTIALS_ERROR VALUE_TOO_LARGE
REVISION_CONFLICT REVISION_OVERFLOW REVISION_SUMMARY_REQUIRED RUN_FINISHED RUN_RUNNING SCHEMA_CONTRACT_VERSION_UNSUPPORTED SCHEMA_INCOMPLETE SCHEMA_POSITION_CHANGED SCHEMA_RECOVERY_REQUIRED SESSION_CONTEXT_CONFLICT SHARED_STORE_LOCK_REENTRY STEP_FINISHED STEP_NOT_RUNNING STEP_SUPERSEDED STORE_CHANGED STORE_CLEANUP_REQUIRED STORE_INCOMPATIBLE STORE_MODEL_MISMATCH STORE_NOT_FOUND STORE_PATH_CONFLICT SYSTEM_MODEL_READ_ONLY SYSTEM_STORE_FORBIDDEN TARGET_FINISHED UNAUTHORIZED UNSUPPORTED_CAPABILITY VIEW_UNAVAILABLE`.split(/\s+/));


const id = z.string().min(1);
const optional = id.optional();
const count = z.number().int().nonnegative();
const run = z.object({ runId: id, stepId: optional, artifactId: optional }).strict();
const dataConflict = z.object({ id: optional, expectedRevision: optional, actualRevision: optional }).strict();
const model = z.object({ modelRef: optional, path: optional }).strict();
const change = z.object({ changeId: id }).strict();
const idList = z.array(id).max(10);
const diagnostics = z.array(z.object({ code: id, path: z.array(id).optional() }).strict()).max(10);
const detailsByCode: Record<string, z.ZodTypeAny> = {
  ALREADY_EXISTS: run, STEP_SUPERSEDED: run, STEP_FINISHED: run,
  REVISION_CONFLICT: z.union([run, dataConflict]),
  DATA_DELETED: z.object({ revision: id }).strict(),
  MODEL_DEFINITION_INVALID: model, MODEL_RUNTIME_UNSUPPORTED: model,
  MODEL_IN_USE: z.object({ storeIds: idList }).strict(),
  DATA_VALIDATION_FAILED: z.object({ data: z.array(z.object({
    storeId: id, checked: count, failureCount: count, failures: z.array(z.object({ id }).strict()).max(10)
  }).strict()).max(10) }).strict(),
  INVALID_ARGUMENT: z.union([z.object({ protocol: z.enum(["graph", "flow"]) }).strict(), z.object({ diagnostics }).strict()]),
  ARTIFACT_VALIDATION_FAILED: z.object({ correctable: z.boolean(), issueCount: count,
    diagnostics: z.array(z.object({ code: id, field: optional }).strict()).max(10) }).strict(),
  HUMAN_CONFIRMATION_REQUIRED: z.object({ runId: id }).strict(),
  AMBIGUOUS_REFERENCE: z.object({ candidateReferences: idList }).strict(),
  EMBEDDED_CHANGE_AMBIGUOUS: z.object({ candidateIds: idList }).strict(),
  CHECKPOINT_CONFLICT: change, MEMORY_CHECKPOINT_INVALID: change,
  BUSINESS_RECEIPT_SAVE_FAILED: run, BUSINESS_WRITE_RECOVERY_REQUIRED: run, BUSINESS_WRITE_UNCONFIRMED: run,
  SCHEMA_RECOVERY_REQUIRED: run, EMBEDDED_CLAIM_WRITE_FAILED: change.extend({ checkpointDigest: optional }),
  OUTPUT_RENDER_FAILED: z.object({ savedId: id }).strict()
};
const recoveryCodes = new Set(["OUTPUT_RENDER_FAILED", "ALREADY_EXISTS", "STEP_SUPERSEDED", "STEP_FINISHED", "REVISION_CONFLICT",
  "BUSINESS_RECEIPT_SAVE_FAILED", "BUSINESS_WRITE_RECOVERY_REQUIRED", "BUSINESS_WRITE_UNCONFIRMED", "SCHEMA_RECOVERY_REQUIRED", "EMBEDDED_CLAIM_WRITE_FAILED"]);
// Saved operations may only point to a known inspection. Options that publish a
// file, change state or select a private implementation never belong here.
function readOnlyRecovery(command: CliCommand): boolean {
  const words: string[] = [];
  const flags = new Set<string>();
  const valued = new Set(["--project", "--store", "--output", "--run", "--step", "--review",
    "--round", "--artifact", "--assignment", "--checkpoint", "--part", "--memory-root", "--query", "--app", "--external", "--comment"]);
  for (let i = 0; i < command.args.length; i++) {
    const arg = command.args[i];
    if (!arg.startsWith("-")) { words.push(arg); continue; }
    if (flags.has(arg)) return false;
    flags.add(arg);
    if (arg === "--all" || arg === "--metadata-only") continue;
    if (!valued.has(arg) || !command.args[i + 1] || command.args[++i].startsWith("-")) return false;
  }
  if (!validPublicCommand(command)) return false;
  const route = words.join(" ");
  if (["run show", "run step show", "run review show", "run artifact show", "run schema show", "run review wait status",
    "run external show", "run binding show", "run review assignment show", "continue show", "continue schema show", "continue review show", "continue step show"].includes(route)) return true;
  if (["daemon status", "view status", "archive list", "data store list", "model list", "project list"].includes(route)) return true;
  if (words.length === 4 && words.slice(0, 3).join(" ") === "data store read") return true;
  if (words.length === 3 && ["cli show", "model read"].includes(words.slice(0, 2).join(" "))) return true;
  if (route === "validate") return flags.has("--memory-root");
  if (words.length === 3 && ["project show", "app show", "data has"].includes(words.slice(0, 2).join(" "))) return true;
  if (words.length === 3 && words[0] === "data" && words[1] === "read") return flags.has("--metadata-only");
  return words.length === 4 && words.slice(0, 3).join(" ") === "memory change show" && flags.has("--checkpoint");
}

export function acceptsPublicError(input: { code: string; details?: unknown; nextAction?: unknown }): boolean {
  if (!publicCodes.has(input.code) || Object.keys(input).some(key => !["code", "details", "nextAction"].includes(key))) return false;
  if (input.details !== undefined && !detailsByCode[input.code]?.safeParse(input.details).success) return false;
  if (input.nextAction === undefined) return true;
  if (!input.details) return false;
  if (input.code === "HUMAN_CONFIRMATION_REQUIRED") {
    const checked = nextAction.safeParse(input.nextAction);
    return checked.success && checked.data?.kind === "human_confirmation" && (!checked.data.resume || validPublicCommand(checked.data.resume));
  }
  const command = cliCommandSchema.safeParse(input.nextAction);
  if (!recoveryCodes.has(input.code) || !command.success || !validPublicCommand(command.data)) return false;
  return input.code !== "OUTPUT_RENDER_FAILED" || readOnlyRecovery(command.data);
}
