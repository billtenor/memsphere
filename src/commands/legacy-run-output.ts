import { z } from "zod";
import { nextAction } from "../prompts/cli-output.js";
import { buildRunCurrentStepPromptModel, buildRunReportReceiptPromptModel } from "../prompts/run.js";
import { currentArtifactReview, currentFrame, currentSchemaFinalization, currentStep, runDisplayName, type RunReviewPreflight, type RunState } from "../run/store.js";
import { cliCommand, publishResult, previewText } from "./output.js";
import { runProgressSchema, type RunProgress } from "./run-result.js";
import type { MemsphereConfig } from "../config.js";
import { resolvePromptLocale } from "../prompts/locale.js";

export function emitLegacyRun(
  command: string,
  run: RunState,
  context: Pick<MemsphereConfig, "project" | "runsRoot">,
  format?: "text" | "json",
  report = false,
  warningCount?: number
) {
  const makeCommand = (...args: string[]) => cliCommand([...(context.project ? ["--project", context.project.name] : []), "run", ...args]);
  const target = ["--run", run.id];
  const inspect = makeCommand("show", ...target);
  const result: RunProgress = {
    runId: run.id, name: previewText(runDisplayName(run), 160).text, status: run.status, warningCount
  };
  const overview = command === "run status" || command === "run start";
  const receipt = report ? buildRunReportReceiptPromptModel(run) : undefined;
  if (receipt) result.receipt = { artifactName: previewText(receipt.artifactName, 160).text, dataId: receipt.dataId };
  if (run.memorySource && run.memorySnapshot && ["run report", "run enter-schema", "run repeat", "run skip"].includes(command)) {
    result.memoryRun = run.id;
  }
  const review = currentArtifactReview(run);
  if (run.status === "running" && review && ["pending", "awaiting_runner_vote"].includes(review.status)) {
    result.stepId = review.stepId;
    result.reviewId = review.id;
    result.roundId = review.currentRoundId;
    result.nextAction = { kind: "wait", resume: makeCommand("review", "wait", "--review", review.id) };
  } else {
    const model = buildRunCurrentStepPromptModel(run, resolvePromptLocale(run.language), context.runsRoot);
    if (model) {
      const step = model.step;
      const frame = currentFrame(run);
      const active = currentStep(run);
      const reference = frame && active ? `${frame.memoryName}#${active.id}` : undefined;
      if (active) result.stepId = active.id;
      const details = reference ? makeCommand("step", "show", ...target, "--step", reference) : inspect;
      result.details = details;
      const rules = model.procedureAsserts.map(text => ({ scope: "procedure", text }));
      if (step.kind === "repeat") {
        result.instruction = previewText(step.instruction, 256).text;
        result.minimumCount = step.min;
        result.maximumCount = step.max;
        result.nextAction = makeCommand("repeat", "<count>", ...target);
      } else if (step.kind === "schema_finalization") {
        const final = currentSchemaFinalization(run)!;
        result.stepId = final.parentStep.id;
        result.artifactName = previewText(step.artifactName, 160).text;
        result.schemaPhase = "awaiting_finalization";
        result.completedFields = step.completed;
        result.totalFields = step.total;
        result.nextAction = makeCommand("artifact", "export", ...target, "--step",
          `${final.parentFrame.memoryName}#${final.parentStep.id}`, "--file", "<local-file>");
      } else {
        const schemaOverview = overview && step.kind === "schema_current_field";
        if (!schemaOverview) result.actor = step.actor;
        result.instruction = previewText(step.instruction, 256).text;
        result.artifactName = previewText(step.artifact.name, 160).text;
        if (!schemaOverview) result.artifactFormat = previewText(step.artifact.format, 160).text;
        if (!schemaOverview && "modelTarget" in step.artifact) {
          result.model = step.artifact.modelTarget?.modelRef;
          if (!overview) result.dataId = step.artifact.modelTarget?.dataId;
        }
        rules.push(...step.asserts.map(text => ({ scope: "step", text })),
          ...step.suggests.map(text => ({ scope: "suggestion", text })));
        if (step.kind === "schema_current_field") {
          result.schemaPhase = "writing";
          result.schemaField = previewText(step.progress.field, 160).text;
          result.completedFields = step.progress.completed;
          result.totalFields = step.progress.total;
          result.details = makeCommand("schema", "show", ...target);
          rules.push(...step.progress.asserts.map(text => ({ scope: "field", text })),
            ...step.progress.suggests.map(text => ({ scope: "field_suggestion", text })));
        }
        const submit = makeCommand("report", ...target, "--artifact-file", "<file>");
        const next = step.next;
        if (next.kind === "revision") result.nextAction = makeCommand("report", ...target, "--artifact-file", "<file>", "--revision-summary-file", "<summary>");
        else if (next.kind === "inline_schema") result.nextAction = makeCommand("enter-schema", ...target);
        else if (next.kind === "external_schema") result.nextAction = makeCommand("enter-schema", next.schemaName, ...target);
        else if (step.actor === "human") result.nextAction = { kind: "human_confirmation", resume: submit };
        else if (next.optional) result.nextAction = { kind: "choose", choices: [submit, makeCommand("skip", ...target)] };
        else result.nextAction = submit;
      }
      if (rules.length && (!overview || result.actor !== undefined)) {
        result.rules = rules.slice(0, 5).map(rule => ({ scope: rule.scope, text: previewText(rule.text, 128).text }));
        result.ruleCount = rules.length;
      }
    }
  }
  publishResult(command, () => runProgressSchema.parse(result), {
    locale: run.language, format, maximumBytes: 8192,
    ...(command !== "run status" ? { saved: { id: run.id, inspect } } : {})
  });
}

const preflightSchema = z.object({
  status: z.literal("review_configuration_required"),
  reviews: z.array(z.object({ scope: z.string(), artifact: z.string(), slots: z.array(z.string()), policies: z.array(z.string()) }).strict()),
  slots: z.array(z.object({ key: z.string(), procedure: z.string(), name: z.string() }).strict()),
  actors: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(["human", "agent"]), permissions: z.array(z.string()) }).strict()),
  example: z.object({
    reviews: z.record(z.object({ policy: z.string() }).strict()),
    slots: z.record(z.union([z.object({ actors: z.array(z.string()) }).strict(), z.object({ skip: z.literal(true) }).strict()]))
  }).strict(),
  nextAction
}).strict();

export function emitReviewPreflight(preflight: RunReviewPreflight, result: { project?: string; selector: string[]; name: string; format?: "text" | "json"; locale: RunState["language"] }) {
  const { reviews, slots, actors, example } = preflight;
  publishResult("run start", () => preflightSchema.parse({
    status: "review_configuration_required", reviews, slots, actors, example,
    nextAction: cliCommand([...(result.project ? ["--project", result.project] : []), "run", "start",
      ...result.selector, "--name", result.name, "--review-config", "<path>"])
  }), { format: result.format, locale: result.locale, contentField: "example" });
}
