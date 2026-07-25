import { resolve } from "node:path";
import {
  activeProcedureAsserts,
  buildSchemaWritingSnapshot,
  currentArtifactReview,
  currentFrame,
  currentSchemaFinalization,
  currentStep,
  finalArtifacts,
  type RunState,
  type SchemaWritingSnapshot
} from "../run/store.js";
import { buildPermissionGuidancePromptModel } from "../control-plane/guidance.js";
import type { PromptLocale } from "./locale.js";
import type {
  ReportAuthorizationPromptModel,
  RunStatePromptModel,
  SchemaOverviewPromptModel
} from "./models.js";
import {
  buildArtifactReviewNextActionPromptModel,
  buildArtifactReviewSummaryPromptModel
} from "./review.js";

export function buildRunStatePromptModel(
  run: RunState,
  locale: PromptLocale,
  runsRoot?: string
): RunStatePromptModel {
  const common = {
    runId: run.id,
    procedureAsserts: activeProcedureAsserts(run)
  };
  if (run.status === "done") {
    return {
      ...common,
      state: {
        kind: "done",
        finalArtifacts: finalArtifacts(run).map((artifact) => ({
          name: artifact.name,
          path: artifact.path
        }))
      }
    };
  }

  const schemaFinalization = currentSchemaFinalization(run);
  if (schemaFinalization) {
    return {
      ...common,
      state: {
        kind: "schema_finalization",
        artifactName: schemaFinalization.parentStep.artifact ?? "unknown",
        completed: schemaFinalization.draft.completed,
        total: schemaFinalization.draft.total,
        draftPath: runsRoot
          ? resolve(runsRoot, schemaFinalization.draft.path)
          : schemaFinalization.draft.path,
        draftPathArgument: shellQuote(runsRoot
          ? resolve(runsRoot, schemaFinalization.draft.path)
          : schemaFinalization.draft.path),
        validation: schemaFinalization.draft.validation ? {
          status: schemaFinalization.draft.validation.status,
          issues: schemaFinalization.draft.validation.issues.map((issue) => issue.message)
        } : undefined
      }
    };
  }

  const frame = currentFrame(run);
  const step = currentStep(run);
  if (frame && step?.kind === "repeat" && step.repeat) {
    return {
      ...common,
      state: {
        kind: "repeat",
        instruction: step.instruction,
        min: step.repeat.min,
        max: step.repeat.max,
        bodyFields: step.repeat.body.length
      }
    };
  }
  if (!frame || !step || !step.artifact || !step.format) {
    return { ...common, state: { kind: "done", finalArtifacts: [] } };
  }

  const review = currentArtifactReview(run);
  if (review?.status === "pending" || review?.status === "awaiting_runner_vote") {
    const round = review.rounds.find((candidate) => candidate.id === review.currentRoundId);
    if (!round) throw new Error(`Artifact Review Round not found: ${review.currentRoundId}`);
    return {
      ...common,
      state: {
        kind: "review",
        review: buildArtifactReviewSummaryPromptModel(review, round),
        next: buildArtifactReviewNextActionPromptModel(review, round, run.id)
      }
    };
  }

  const schemaSnapshot = frame.type === "schema"
    ? buildSchemaWritingSnapshot(runsRoot ?? ".", run)
    : undefined;
  const permissions = run.controlPlane && step.controlPlane
    ? step.controlPlane.permissions.runner
    : undefined;
  const controlPlane = run.controlPlane && step.controlPlane && permissions ? {
    revision: run.controlPlane.revision,
    permissionCatalogVersion: run.controlPlane.permissionCatalog.version,
    decisionPolicyCatalogVersion: run.controlPlane.decisionPolicyCatalog.version,
    bindings: Object.entries(step.controlPlane.bindings).map(([slotId, binding]) => ({
      slotId,
      actors: binding.skipped ? "skipped" : binding.actorIds.join(", "),
      source: binding.source
    })),
    runnerPermissions: permissions.effective,
    guidance: buildPermissionGuidancePromptModel({
      snapshot: run.controlPlane,
      actorId: "runner",
      permissions,
      artifactScope: step.controlPlane.artifactScope,
      locale
    })
  } : undefined;

  return {
    ...common,
    state: {
      kind: "action",
      actor: step.actor === "human" ? "human" : "agent",
      instruction: step.instruction,
      asserts: step.asserts ?? [],
      suggests: step.suggests ?? [],
      details: step.details ?? [],
      schemaProgress: schemaSnapshot ? {
        field: schemaSnapshot.progress.current ?? step.artifact,
        completed: schemaSnapshot.progress.completed,
        total: schemaSnapshot.progress.total,
        remaining: schemaSnapshot.progress.remaining,
        pendingRepeatControls: schemaSnapshot.progress.pendingRepeatControls,
        sources: (schemaSnapshot.currentField?.sources ?? []).map((source) => ({
          path: source.path,
          type: source.type,
          format: formatDisplay(source.format),
          defines: source.defines ?? [],
          asserts: source.asserts ?? []
        })),
        draftPath: schemaSnapshot.draft?.filePath
      } : undefined,
      artifact: {
        name: step.artifact,
        type: step.type ?? "unknown",
        format: formatDisplay(step.format)
      },
      controlPlane,
      next: review?.status === "awaiting_revision"
        ? { kind: "revision" }
        : step.format.name === "markdown" && step.schema
          ? step.schema.kind === "inline"
            ? { kind: "inline_schema" }
            : { kind: "external_schema", schemaName: step.schema.name }
          : { kind: "report", optional: step.optional === true }
    }
  };
}

export function buildSchemaOverviewPromptModel(
  snapshot: SchemaWritingSnapshot
): SchemaOverviewPromptModel {
  return {
    procedureName: snapshot.procedureName,
    action: {
      instruction: snapshot.action.instruction,
      asserts: snapshot.action.asserts,
      suggests: snapshot.action.suggests
    },
    artifact: {
      name: snapshot.artifact.name,
      type: snapshot.artifact.type,
      format: snapshot.artifact.format ? formatDisplay(snapshot.artifact.format) : undefined,
      schema: snapshot.artifact.schema
        ? snapshot.artifact.schema.kind === "external"
          ? snapshot.artifact.schema.name
          : snapshot.artifact.schema.id
        : undefined,
      final: snapshot.artifact.final
    },
    progress: {
      completed: snapshot.progress.completed,
      total: snapshot.progress.total,
      pendingRepeatControls: snapshot.progress.pendingRepeatControls,
      fields: snapshot.progress.fields.map((field) => ({
        path: field.path,
        status: field.status
      }))
    },
    draft: snapshot.draft ? {
      status: snapshot.draft.status,
      filePath: snapshot.draft.filePath,
      validationStatus: snapshot.draft.validation?.status
    } : undefined
  };
}

export function buildReportAuthorizationPromptModel(
  run: RunState,
  locale: PromptLocale
): ReportAuthorizationPromptModel | undefined {
  const authorization = [...run.events].reverse()
    .find((event) => event.artifact.authorization)?.artifact.authorization;
  if (!authorization) return undefined;
  return {
    permission: authorization.permission,
    actorId: authorization.actorId,
    artifactScope: authorization.artifactScope,
    revision: authorization.revision,
    guidance: run.controlPlane ? buildPermissionGuidancePromptModel({
      snapshot: run.controlPlane,
      actorId: authorization.actorId,
      permissions: {
        base: authorization.basePermissions,
        grants: authorization.grantedPermissions,
        effective: authorization.effectivePermissions,
        authoritySource: authorization.authoritySource,
        grantSource: authorization.grantSource
      },
      artifactScope: authorization.artifactScope,
      locale,
      decision: authorization
    }) : undefined
  };
}

function formatDisplay(format: { name: string; options: Record<string, unknown> }): string {
  const options = Object.entries(format.options).map(([name, value]) => `${name}: ${String(value)}`);
  return options.length ? `${format.name} (${options.join(", ")})` : format.name;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
