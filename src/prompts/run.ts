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
import type { PromptLocale } from "./locale.js";
import type {
  RunCompletedPromptModel,
  RunCurrentStepPromptModel,
  RunReportReceiptPromptModel,
  SchemaOverviewPromptModel
} from "./models.js";

export function buildRunCurrentStepPromptModel(
  run: RunState,
  locale: PromptLocale,
  runsRoot?: string
): RunCurrentStepPromptModel | undefined {
  const common = {
    runId: run.id,
    procedureAsserts: activeProcedureAsserts(run)
  };
  if (run.status === "done") return undefined;

  const schemaFinalization = currentSchemaFinalization(run);
  if (schemaFinalization) {
    return {
      ...common,
      step: {
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
      step: {
        kind: "repeat",
        instruction: step.instruction,
        min: step.repeat.min,
        max: step.repeat.max,
        bodyFields: step.repeat.body.length
      }
    };
  }
  if (!frame || !step || !step.artifact || !step.format) return undefined;

  const review = currentArtifactReview(run);
  if (review?.status === "pending" || review?.status === "awaiting_runner_vote") return undefined;

  const schemaSnapshot = frame.type === "schema"
    ? buildSchemaWritingSnapshot(runsRoot ?? ".", run)
    : undefined;
  const schemaSources = schemaSnapshot?.currentField?.sources ?? [];
  const currentSchemaSource = schemaSources.at(-1);
  const content = {
    actor: step.actor === "human" ? "human" as const : "agent" as const,
    instruction: step.instruction,
    asserts: step.asserts ?? [],
    suggests: step.suggests ?? [],
    details: step.details ?? [],
    artifact: {
      name: step.artifact,
      type: step.type ?? "unknown",
      format: formatDisplay(step.format)
    },
    next: review?.status === "awaiting_revision"
      ? { kind: "revision" as const }
      : step.format.name === "markdown" && step.schema
        ? step.schema.kind === "inline"
          ? { kind: "inline_schema" as const }
          : { kind: "external_schema" as const, schemaName: step.schema.name }
        : { kind: "report" as const, optional: step.optional === true }
  };

  return {
    ...common,
    step: schemaSnapshot ? {
      ...content,
      kind: "schema_current_field",
      schemaWriting: {
        procedureName: schemaSnapshot.procedureName,
        actionInstruction: schemaSnapshot.action.instruction,
        actionAsserts: schemaSnapshot.action.asserts,
        actionSuggests: schemaSnapshot.action.suggests,
        artifactName: schemaSnapshot.artifact.name
      },
      progress: {
        field: schemaFieldLabel(schemaSnapshot, locale),
        completed: schemaSnapshot.progress.completed,
        total: schemaSnapshot.progress.total,
        remaining: schemaSnapshot.progress.remaining,
        pendingRepeatControls: schemaSnapshot.progress.pendingRepeatControls,
        contract: {
          type: currentSchemaSource?.type ?? step.type ?? "unknown",
          format: currentSchemaSource ? formatDisplay(currentSchemaSource.format) : formatDisplay(step.format)
        },
        defines: uniqueSchemaGuidance(schemaSources.flatMap((source) => source.defines ?? [])),
        asserts: uniqueSchemaGuidance(schemaSources.flatMap((source) => source.asserts ?? [])),
        suggests: uniqueSchemaGuidance(schemaSources.flatMap((source) => source.suggests ?? [])),
        draftPath: schemaSnapshot.draft?.filePath
      }
    } : {
      ...content,
      kind: "action"
    }
  };
}

function uniqueSchemaGuidance(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildRunCompletedPromptModel(run: RunState): RunCompletedPromptModel | undefined {
  if (run.status !== "done") return undefined;
  return {
    runId: run.id,
    procedureAsserts: activeProcedureAsserts(run),
    finalArtifacts: finalArtifacts(run).map((artifact) => ({
      name: artifact.name,
      path: artifact.path
    }))
  };
}

export function buildRunReportReceiptPromptModel(run: RunState): RunReportReceiptPromptModel {
  const review = currentArtifactReview(run);
  const event = run.events.at(-1);
  const artifactName = review?.artifactName ?? event?.artifact.name;
  if (!artifactName) throw new Error(`Run has no reported Artifact: ${run.id}`);
  const round = review?.rounds.find((candidate) => candidate.id === review.currentRoundId);
  return {
    runId: run.id,
    artifactName,
    review: review && round ? {
      reviewId: review.id,
      roundId: round.id,
      round: round.sequence
    } : undefined
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

function formatDisplay(format: { name: string; options: Record<string, unknown> }): string {
  const options = Object.entries(format.options).map(([name, value]) => `${name}: ${String(value)}`);
  return options.length ? `${format.name} (${options.join(", ")})` : format.name;
}

function shellQuote(value: string): string {
  if (process.platform === "win32") return `"${value.replace(/"/g, '""')}"`;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function schemaFieldLabel(snapshot: SchemaWritingSnapshot, locale: PromptLocale): string {
  const current = snapshot.currentField?.path ?? snapshot.progress.current;
  if (!current) return snapshot.artifact.name;
  const root = snapshot.currentField?.sources[0]?.path;
  if (root && current === root) {
    return locale === "zh-CN" ? "文档标题与概述" : "document title and overview";
  }
  if (root && current.startsWith(`${root}.`)) return current.slice(root.length + 1);
  return current.split(".").at(-1) ?? current;
}
