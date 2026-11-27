import { actionRouter as cliOutputRouter } from "../prompts/contracts/actions.js";
import { Command, CommanderError } from "commander";
import { CliOutputError, cliCommand, emitCliError, flushCliOutput, withCliOutput, type CliFormat, type PublicCliError } from "./output.js";

import { publicCodes } from "../prompts/contracts/errors.js";

export function invalidCliOptions(code: "use_artifact" | "mutually_exclusive" | "not_allowed" | "exactly_one_required" | "required" | "invalid_value", ...path: string[]) {
  return Object.assign(new Error(`${code.replaceAll("_", " ")}: ${path.join(", ")}`), { code: "INVALID_ARGUMENT", issues: [{ code, path }] });
}

export function errorCode(error: unknown): string {
  if (error instanceof CommanderError) return "INVALID_ARGUMENT";
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    const codes: Record<string, string> = {
      changeset_integrity_error: "MEMORY_CHECKPOINT_INVALID", AccessDenied: "PERMISSION_DENIED", EPIPE: "OUTPUT_PIPE_CLOSED", ENOENT: "NOT_FOUND", EEXIST: "ALREADY_EXISTS", EACCES: "PERMISSION_DENIED", EPERM: "PERMISSION_DENIED"
    };
    return Object.hasOwn(codes, error.code) ? codes[error.code] : publicCodes.has(error.code) ? error.code : "INTERNAL_ERROR";
  }
  if (error instanceof Error && /review_attempt_not_current|review_assignment_not_bound|review_attempt_binding_required|cli_workspace_mismatch|Session environment is missing/.test(error.message)) return "REVIEW_SESSION_INVALID";
  if (error instanceof Error && /review_session_identity_conflict|review_assignment_conflict/.test(error.message)) return "REVIEW_IDENTITY_CONFLICT";
  if (error instanceof SyntaxError) return "INVALID_INPUT";
  if (error instanceof TypeError || error instanceof RangeError) return "INVALID_ARGUMENT";
  const names: Record<string, string> = {
    MemoryNotFoundError: "NOT_FOUND", MemoryNodeNotFoundError: "NOT_FOUND",
    MemoryAmbiguityError: "AMBIGUOUS_REFERENCE", MemoryReferenceKindError: "INVALID_ARGUMENT",
    InvalidMemoryReferenceError: "INVALID_ARGUMENT", MemoryCatalogDataError: "INVALID_DATA",
    MemoryFrozenError: "MEMORY_FROZEN", ZodError: "INVALID_ARGUMENT"
  };
  return error instanceof Error && Object.hasOwn(names, error.name) ? names[error.name] : "INTERNAL_ERROR";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[\w.:-]{1,160}$/u.test(value) ? value : undefined;
}

function diagnostics(issues: unknown[]): { code: string; path: string[] }[] {
  return issues.slice(0, 10).flatMap(issue => {
    const value = record(issue);
    const code = identifier(value.code);
    return code ? [{ code, path: Array.isArray(value.path)
      ? value.path.slice(0, 12).flatMap(segment => typeof segment === "number" ? [String(segment)] : identifier(segment) ?? [])
      : [] }] : [];
  });
}

function revision(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9._:="\/-]{1,160}$/.test(value) ? value : undefined;
}

export function publicCommandError(error: unknown, project?: string): PublicCliError {
  const code = errorCode(error);
  const source = record(error);
  const details = record(source.details);
  const scope = project ? ["--project", project] : [];
  if (["REVISION_CONFLICT", "ALREADY_EXISTS", "STEP_SUPERSEDED", "STEP_FINISHED"].includes(code)) {
    const runId = identifier(details.runId);
    if (runId) return { code, details: {
      runId, stepId: identifier(details.stepId), artifactId: identifier(details.artifactId)
    }, nextAction: cliCommand([...scope, "run", "status", "--run", runId]) };
  }
  if (code === "DATA_DELETED") {
    const value = revision(details.revision);
    return { code, details: value ? { revision: value } : undefined };
  }
  if (code === "REVISION_CONFLICT") {
    const id = identifier(details.id);
    const expectedRevision = revision(details.expectedRevision);
    const actualRevision = revision(details.actualRevision);
    return { code, details: id || expectedRevision || actualRevision ? { id, expectedRevision, actualRevision } : undefined };
  }
  if (code === "MODEL_DEFINITION_INVALID" || code === "MODEL_RUNTIME_UNSUPPORTED") {
    const modelRef = identifier(details.modelRef) ?? revision(details.modelRef);
    const path = typeof details.path === "string" && /^#[a-zA-Z0-9/~._-]{0,192}$/.test(details.path) ? details.path : undefined;
    return { code, details: modelRef || path ? { modelRef, path } : undefined };
  }
  if (code === "MODEL_IN_USE" && Array.isArray(details.storeIds)) {
    const storeIds = details.storeIds.slice(0, 10).map(identifier).filter((id): id is string => id !== undefined);
    return { code, details: { storeIds } };
  }
  if (code === "DATA_VALIDATION_FAILED" && Array.isArray(details.data)) {
    const data = details.data.slice(0, 10).flatMap(item => {
      const store = record(item);
      const storeId = identifier(store.storeId);
      const checked = typeof store.checked === "number" && Number.isSafeInteger(store.checked) ? store.checked : 0;
      if (!storeId || !Array.isArray(store.failures)) return [];
      const failures = store.failures.slice(0, 10).flatMap(entry => {
        const id = identifier(record(entry).id);
        return id ? [{ id }] : [];
      });
      return [{ storeId, checked, failureCount: store.failures.length, failures }];
    });
    return { code, details: { data } };
  }
  if (code === "INVALID_ARGUMENT") {
    if (details.protocol === "flow" || details.protocol === "graph") return { code, details: { protocol: details.protocol } };
    const issues = Array.isArray(source.issues) ? source.issues : Array.isArray(source.details) ? source.details : [];
    if (issues.length) return { code, details: { diagnostics: diagnostics(issues) } };
  }
  if (code === "ARTIFACT_VALIDATION_FAILED") {
    const result = record(source.result);
    const issues = Array.isArray(result.issues) ? result.issues : [];
    const publicIssues = issues.slice(0, 10).flatMap(issue => {
      const value = record(issue);
      const code = identifier(value.code);
      const field = typeof value.fieldPath === "string" && /^[A-Za-z0-9_.\[\]-]{1,160}$/.test(value.fieldPath)
        ? value.fieldPath : undefined;
      return code ? [{ code, field }] : [];
    });
    return { code, details: { correctable: result.correctable === true, issueCount: issues.length, diagnostics: publicIssues } };
  }
  if (code === "HUMAN_CONFIRMATION_REQUIRED") {
    const runId = identifier(details.runId);
    if (!runId) return { code };
    const artifacts = Array.isArray(details.artifactIds) ? details.artifactIds.map(identifier).filter(
      (id): id is string => id !== undefined
    ) : [];
    return { code, details: { runId }, nextAction: {
      kind: "human_confirmation",
      resume: cliCommand([...scope, "run", "finish", "--run", runId,
        ...artifacts.flatMap(id => ["--artifact", id]), "--authorization", "<human-confirmation>"])
    } };
  }
  if (code === "AMBIGUOUS_REFERENCE" && Array.isArray(source.candidates)) {
    const candidateReferences = source.candidates.slice(0, 10).filter((value): value is string => typeof value === "string"
      && /^[^\x00-\x1f\x7f-\x9f]{1,160}$/u.test(value));
    return { code, details: { candidateReferences } };
  }
  if (code === "CHECKPOINT_CONFLICT" || code === "MEMORY_CHECKPOINT_INVALID") {
    const changeId = identifier(details.changeId ?? source.changeId);
    return { code, details: changeId ? { changeId } : undefined };
  }
  if (code === "EMBEDDED_CHANGE_AMBIGUOUS" && Array.isArray(source.candidates)) {
    const candidateIds = source.candidates.slice(0, 10).map(candidate => identifier(record(candidate).id))
      .filter((id): id is string => id !== undefined);
    return { code, details: { candidateIds } };
  }
  if (["BUSINESS_RECEIPT_SAVE_FAILED", "BUSINESS_WRITE_RECOVERY_REQUIRED", "BUSINESS_WRITE_UNCONFIRMED",
    "SCHEMA_RECOVERY_REQUIRED"].includes(code)) {
    const runId = identifier(details.runId);
    const stepId = identifier(details.stepId);
    const artifactId = identifier(details.artifactId);
    if (!runId) return { code };
    const readRun = cliCommand([...scope, "run", "status", "--run", runId]);
    const recover = stepId && code === "BUSINESS_RECEIPT_SAVE_FAILED"
      ? cliCommand([...scope, "run", "step", "store", "retry", "--run", runId, "--step", stepId]) : readRun;
    return { code, details: { runId, stepId, artifactId }, nextAction: recover };
  }
  if (code === "EMBEDDED_CLAIM_WRITE_FAILED") {
    const changeId = identifier(details.changeId);
    const checkpointDigest = identifier(details.checkpointDigest);
    return { code, details: { changeId, checkpointDigest }, nextAction: changeId
      ? cliCommand([...scope, "memory", "change", "validate", "--change", changeId]) : undefined };
  }
  return { code };
}

export { actionRouter as cliOutputRouter, setActionRouter as registerCliOutputRouter } from "../prompts/contracts/actions.js";

/** Find the declared output format even if parsing stops before a later option. */
export function requestedCliOutput(program: Command, args: readonly string[]): CliFormat {
  let current = program;
  let format: CliFormat = "text";
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === "--") break;
    if (token.startsWith("-")) {
      const equals = token.indexOf("=");
      const flag = equals < 0 ? token : token.slice(0, equals);
      const option = inheritedOptions(current).find((candidate) => candidate.long === flag || candidate.short === flag);
      if (option && (flag === "--output" || flag === "--format")) {
        const value = equals < 0 ? args[++index] : token.slice(equals + 1);
        if ((value === "json" || value === "text" || value === "yaml") &&
            (!option.argChoices || option.argChoices.includes(value))) format = value;
      } else if (option?.required && equals < 0) {
        index++;
      } else if (option?.optional && equals < 0 && args[index + 1] && !args[index + 1].startsWith("-")) {
        index++;
      }
      continue;
    }
    const router = cliOutputRouter(current);
    const child = router.commands.find(command => command.name() === token || command.aliases().includes(token));
    if (child) current = child;
  }
  return format;
}

export async function parseCli(program: Command, argv = process.argv, options: { rethrow?: boolean } = {}): Promise<void> {
  const output = requestedCliOutput(program, argv.slice(2));
  const configure = (command: Command) => {
    command.exitOverride();
    command.configureOutput({ outputError: () => undefined });
    for (const child of command.commands) configure(child);
  };
  configure(program);
  return withCliOutput(output, async () => {
    try {
      await program.parseAsync(argv);
      await flushCliOutput();
    } catch (error) {
      if (error instanceof CommanderError && error.exitCode === 0) return;
      if (options.rethrow) throw error;
      if (error instanceof CliOutputError) await emitCliError(error);
      else await emitCliError(publicCommandError(error, program.opts<{ project?: string }>().project));
    }
  });
}

function inheritedOptions(command: Command): Command["options"] {
  return [...command.options, ...(command.parent ? inheritedOptions(command.parent) : [])];
}
