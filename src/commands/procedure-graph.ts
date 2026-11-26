import { graphArtifactCollection, graphBindingResult, graphContractDetail, graphRewindResult, graphStepDetail, publicBindings } from "./graph-output.js";
import { emitSchemaExport, emitSchemaWriting } from "./schema-output.js";
import { reviewReceipt } from "./review-output.js";
import { exportArtifactBytes } from "./run.js";
import { currentIdentity } from "../runner/identity.js";
import { readFile } from "node:fs/promises";
import { readConfig } from "../config.js";
import type { MemoryCatalog } from "../memory/catalog.js";
import { collectMemoryReferenceTargets } from "../memory/references.js";
import { parseMemoryEntity } from "../memory/store.js";
import { parseMemoryYaml } from "../memory/yaml.js";
import { serializeMemoryYaml } from "../memory/serializer.js";
import { openContextControl } from "../project/context-control.js";
import { effectiveStep, supersedingRewind } from "../context_control/graph-rewind.js";
import { isGraphRun, type GraphRuntime } from "../context_control/graph-runtime.js";
import { failure } from "../context_control/errors.js";
import type { Run, Snapshot, Step } from "../context_control/types.js";
import type { ControlPlaneConfig, RunReviewConfiguration } from "../control-plane/index.js";
import { CliOutputError, cliCommand, publishResult, paginateCliItems, previewText } from "./output.js";
import { runEvidenceSchema, runOverviewSchema, runProgressSchema, type RunProgress } from "./run-result.js";
import { cliCommandSchema, nextAction } from "../prompts/cli-output.js";
import { z } from "zod";
import { assertSessionTarget, currentCommandState, createCommandState, findCommandStates, updateCommandState } from "../home/command-state-store.js";
import { assertReportExecutionCapability } from "../report-execution.js";
import { graphReviewHandle } from "../context_control/review-repository.js";
import type { ArtifactReview, ArtifactReviewRound } from "../artifact-review.js";
import type { Options } from "./context-control.js";
import { appProcedureFileSource } from "../app/run.js";
import { join } from "node:path";
import { readRun as readLegacyRun } from "../run/store.js";
import { flattenEffectiveRules } from "../memory/rules.js";

const needed = (v: string | undefined, key: string) => { if (!v?.trim()) throw failure("INVALID_ARGUMENT", `${key} is required`); return v; };
export async function startGraphIfApplicable(input: { catalog: MemoryCatalog; projectCatalogs?: Record<string, MemoryCatalog>; memoryRoot: string; procedure?: string; file?: string; root: string; name: string; language: Run["language"]; controlPlane?: ControlPlaneConfig; reviewConfiguration?: RunReviewConfiguration; memorySource?: Run["memorySource"] }): Promise<Snapshot | undefined> {
  let p = input.file ? parseMemoryEntity("procedures", parseMemoryYaml(await readFile(input.file, "utf8"))) : await input.catalog.read(input.procedure!, { kind: "procedures" });
  if (p.tag !== "!procedure" || p.mode !== "graph") return undefined;
  const selected = input.file ? undefined : await input.catalog.resolve(input.procedure!, { kind: "procedures" });
  if (selected?.app && !selected.app.enabled) throw failure("APP_DISABLED", `App is disabled: ${selected.app.id}`);
  const fileSource = input.file ? await appProcedureFileSource(join(input.root, "runs"), input.memoryRoot, input.file) : undefined;
  const sourceCatalog = selected?.project_name ? input.projectCatalogs?.[selected.project_name] : input.catalog;
  if (!sourceCatalog) throw failure("NOT_FOUND", "Selected Project Memory source is unavailable");
  const catalog = sourceCatalog.snapshot ? await sourceCatalog.snapshot() : sourceCatalog;
  if (!input.file) p = await catalog.read(input.procedure!, { kind: "procedures" });
  if (p.tag !== "!procedure" || p.mode !== "graph") throw failure("MEMORY_CHANGED", "Graph Procedure changed while freezing its snapshot");
  const memories: NonNullable<Run["memorySnapshot"]>["memories"] = {};
  const freeze = async (reference: string, root = false): Promise<void> => {
    if (memories[reference]) return;
    const entity = root ? p : await catalog.read(reference);
    const descriptor = root && input.file ? undefined : await catalog.resolve(reference);
    const app = descriptor?.app ?? (root && fileSource ? { id: fileSource.id, version: fileSource.version, assetKey: fileSource.assetKey, packageDigest: fileSource.packageDigest, enabled: true } : undefined);
    memories[reference] = { memoryRef: reference, payload: { contentType: "application/yaml", content: serializeMemoryYaml(entity) }, ...(app ? { app } : {}) };
    for (const ref of collectMemoryReferenceTargets(entity)) await freeze(ref);
  };
  await freeze(`procedures/${p.names[0]}`, true);
  const service = (await openContextControl(input.root, true))!;
  return service.withGraph(g => g.start({ name: input.name, language: input.language, procedure: p, memorySnapshot: { memories }, controlPlane: input.controlPlane, reviewConfiguration: input.reviewConfiguration, ...(input.memorySource ? { memorySource: input.memorySource } : {}) }));
}
async function context(project: string, run: string, step: string) {
  let row; try { row = await currentCommandState(); } catch { return undefined; }
  return row?.value.status === "active" && row.value.parameters.project === project && row.value.groupId === run && row.value.parameters.step === step ? row.value : undefined;
}
async function closeStep(project: string, run: string, step: string) {
  try {
    const row = await currentCommandState();
    if (row?.value.status === "active" && row.value.parameters.project === project && row.value.groupId === run && row.value.parameters.step === step)
      await updateCommandState(row, { ...row.value, status: "closed" });
  } catch { /* Auxiliary state cannot fail a completed Step. */ }
}
function progress(run: Run): RunProgress {
  return { runId: run.id, name: previewText(run.name ?? run.id, 160).text, status: run.status };
}

function forRun(project: string, ...args: string[]) {
  return cliCommand(["--project", project, "run", ...args]);
}

function printProgress(command: string, result: RunProgress, run: Run, format?: "text" | "json", savedId?: string, publicProject?: string) {
  publishResult(command, () => runProgressSchema.parse(result), {
    format, locale: run.language, maximumBytes: 8192, itemsField: "materials",
    ...(savedId && publicProject ? { saved: { id: savedId, inspect: forRun(publicProject, "show", "--run", run.id) } } : {})
  });
}

async function stepResult(g: GraphRuntime, snapshot: Snapshot, step: Step, project: string, statusOnly = false): Promise<RunProgress> {
  const run = snapshot.run;
  const action = g.action(run, step);
  const bound = await context(project, run.id, step.id);
  const target = ["--run", run.id, "--step", step.id];
  const base = { ...progress(run), stepId: step.id, stepStatus: step.status };
  if (step.status === "awaiting_review") {
    const round = step.reviewRounds!.at(-1)!;
    const reviewId = graphReviewHandle(run.id, step.id);
    return { ...base, reviewId, roundId: round.id, nextAction: { kind: "wait", resume: bound
      ? cliCommand(["continue", "review", "wait"])
      : forRun(project, "review", "wait", "--review", reviewId) } };
  }

  const artifact = action.artifact;
  if (!artifact) return base;
  const details = forRun(project, "step", "show", ...target);
  const rules = await g.rules(run, action);
  const rulePreview = Object.entries(rules).flatMap(([scope, tree]) =>
    flattenEffectiveRules(tree).map(entry => ({ scope, text: previewText(entry.text, 128).text }))).slice(0, 5);
  const materials = Object.values(step.inputs ?? {}).flat().slice(0, 4).map(ref => ({
    kind: ref.kind, id: ref.id, read: forRun(project, ref.kind, "show", "--run", run.id, "--" + ref.kind, ref.id)
  }));
  const instruction = previewText(action.description, 256).text;
  const current = {
    ...base, actor: action.actor ?? "agent" as const, instruction,
    artifactName: previewText(artifact.name, 160).text, contentType: artifact.payload.contentType,
    model: artifact.model.definedBy, details,
    ...(rulePreview.length ? { rules: rulePreview } : {}),
    ...(materials.length ? { materials } : {})
  };

  if (artifact.model.definedBy === "memsphere/schema.json" && step.status === "running") {
    const writing = await g.schemaShow(run.id, step.id);
    const cmd = writing.phase === "not_started" ? ["enter-schema"] : ["schema", "show"];
    const resume = bound ? cliCommand(["continue", ...cmd]) : forRun(project, ...cmd, ...target);
    const nextAction = action.actor === "human" ? { kind: "human_confirmation" as const, resume } : resume;
    if (writing.phase === "not_started" && !statusOnly) return { ...current, nextAction };
    return { ...base, instruction, artifactName: current.artifactName, details, schemaPhase: writing.phase, nextAction };
  }

  const report = bound ? cliCommand(["continue", "report", "--artifact-file", "<file>"])
    : forRun(project, "report", ...target, "--artifact-file", "<file>");
  return { ...current, nextAction: action.actor === "human" ? { kind: "human_confirmation", resume: report } : report };
}

export async function graphNext(g: GraphRuntime, snapshot: Snapshot, project: string, enter = true, statusOnly = false): Promise<RunProgress> {
  const run = snapshot.run;
  const base = progress(run);
  if (run.status !== "running") return base;
  const ready = g.ready(snapshot);
  const explicitReplacement = ready.length === 1 && ready[0].status === "pending" &&
    run.frames?.[0].graphFrame.rewinds?.some(r => r.replacementStepId === ready[0].id);
  const show = forRun(project, "show", "--run", run.id);
  const status = forRun(project, "status", "--run", run.id);
  const enterStep = (step: Step) => forRun(project, "step", "enter", "--run", run.id, "--step", step.id);
  if (ready.length === 1 && enter && !explicitReplacement) {
    let entered: Awaited<ReturnType<GraphRuntime["enter"]>>;
    try { entered = await g.enter(run.id, ready[0].id); }
    catch (error) {
      if ((error as { code?: string }).code !== "STEP_FINISHED") throw error;
      return { ...base, reason: "step_completed_concurrently", nextAction: status };
    }
    await createCommandState(project, run.id, entered.step.id).catch(() => undefined);
    return stepResult(g, entered.snapshot, entered.step, project, statusOnly);
  }
  if (ready.length === 1) return { ...base, eligibleSteps: 1, nextAction: enterStep(ready[0]) };
  if (ready.length > 1) return { ...base, eligibleSteps: ready.length, nextAction: {
    kind: "choose", choices: ready.slice(0, 10).map(enterStep), ...(ready.length > 10 ? { more: show } : {})
  } };
  const reviewing = snapshot.steps.filter(s => effectiveStep(run, s.id) && s.status === "awaiting_review");
  if (reviewing.length === 1) return stepResult(g, snapshot, reviewing[0], project);
  const joins = run.frames![0].graphFrame.joins.some(j => Object.keys(j.arrivals).length);
  const deferred = run.frames![0].graphFrame.deferredCollects?.length ?? 0;
  if (reviewing.length || joins || deferred) return { ...base, waitingReviews: reviewing.length,
    nextAction: { kind: "wait", resume: status } };
  return { ...base, nextAction: forRun(project, "finish", "--run", run.id) };
}

export async function printGraphStart(snapshot: Snapshot, output?: "text" | "json") {
  const config = await readConfig();
  const project = config.project!.name;
  const service = (await openContextControl(config.scopeRoot))!;
  const result = await service.withGraph(g => graphNext(g, snapshot, project));
  printProgress("run start", result, snapshot.run, output, snapshot.run.id, project);
}
export async function printGraphReviewOutput(
  command: "run review wait" | "run review vote" | "run review submit-for-human",
  review: ArtifactReview<import("../run/store.js").RunEvent["artifact"]>,
  round: ArtifactReviewRound,
  runId: string,
  options: { vote?: string; assignmentId?: string; output?: "text" | "json"; enter?: boolean } = {}
) {
  if (!review.id.startsWith("graph-review-")) return false;
  const config = await readConfig();
  const project = config.project!.name;
  const service = (await openContextControl(config.scopeRoot))!;
  await service.withGraph(async g => {
    const snapshot = await g.advance(runId);
    const step = snapshot.steps.find(s => s.id === review.stepId)!;
    let progress: RunProgress | undefined;
    if (step.status === "done") {
      if (options.enter !== false) await closeStep(project, runId, step.id);
      progress = await graphNext(g, snapshot, project, options.enter);
    } else if (step.status === "running") {
      progress = await stepResult(g, snapshot, step, project);
    }
    reviewReceipt(command, { project, run: snapshot.run, review, round, progress,
      vote: options.vote, assignmentId: options.assignmentId, format: options.output });
  });
  return true;
}
export async function graphCommand(operation: string, input: object): Promise<boolean> {
  const options = input as Options & { position?: string; count?: string; schemaName?: string; force?: boolean; slot?: string; skip?: boolean; dryRun?: boolean; reason?: string; reasonFile?: string };
  if (!options.run) return false;
  const config = await readConfig(); const service = await openContextControl(config.scopeRoot);
  const run = service && await service.findRun(options.run);
  if (!run || !isGraphRun(run)) return false;
  for (const root of [config.runsRoot, join(config.archiveRoot, "runs")]) {
    let legacy = false;
    try { await readLegacyRun(root, run.id); legacy = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (legacy) throw failure("AMBIGUOUS_RUN", "Run ID exists in both legacy and model Stores");
  }
  const project = config.project!.name;
  return service!.withGraph(async g => {
    const display = { format: options.output, locale: run.language };
    if (operation === "binding-show" || operation === "binding-update") {
      const actors = Array.isArray(options.actor) ? options.actor as string[] : options.actor ? [options.actor] : [];
      if (operation === "binding-update" && options.skip && actors.length) throw failure("INVALID_ARGUMENT", "Choose Actors or skip");
      const result = operation === "binding-show" ? await g.bindingSnapshot(run.id) : await g.updateBinding(run.id, needed(options.slot, "--slot"), options.skip ? { skip: true } : { actorIds: actors });
      publishResult(operation.replace("binding-", "run binding "), () => graphBindingResult.parse({
        runId: run.id, nextRound: publicBindings(result.bindings),
        rounds: result.rounds.map(({ stepId, roundId, bindings }) => ({ stepId, roundId, bindings: publicBindings(bindings) }))
      }), display);
      return true;
    }
    if (operation === "show") {
      const snapshot = await g.snapshot(run.id);
      const page = paginateCliItems(snapshot.steps.map(step => ({
        id: step.id, actionId: step.source?.actionId, status: step.status,
        artifactId: step.artifact?.mode === "produce" ? step.artifact.id : undefined,
        effective: effectiveStep(run, step.id)
      })), { limit: options.limit, cursor: options.cursor }, { command: "run.show", scope: { project, runId: run.id } }, "summary");
      publishResult("run show", () => runOverviewSchema.parse({
        run: { id: run.id, name: previewText(run.name ?? run.id, 160).text, status: run.status },
        steps: page.items, stepCount: snapshot.steps.length,
        outputArtifactIds: snapshot.outputArtifactIds.slice(0, 20),
        outputArtifactCount: snapshot.outputArtifactIds.length, nextCursor: page.nextCursor
      }), { format: options.output, locale: run.language, itemsField: "steps", maximumBytes: options.limit === undefined ? 32768 : 131072 });
      return true;
    }
    if (operation === "step-show") {
      const snapshot = await g.snapshot(run.id);
      const step = options.step && snapshot.steps.find(s => s.id === options.step);
      if (options.step && !step) throw failure("NOT_FOUND", `Step not found: ${options.step}`);
      if (!step) throw failure("INVALID_ARGUMENT", "--step is required");
      const action = g.action(run, step);
      const rules = Object.entries(await g.rules(run, action)).flatMap(([scope, tree]) =>
        flattenEffectiveRules(tree).map(entry => ({ scope, text: entry.text })));
      publishResult("run step show", () => graphStepDetail.parse({
        runId: run.id, step: {
          id: step.id, actionId: step.source?.actionId, status: step.status, effective: effectiveStep(snapshot.run, step.id),
          supersedingRewindId: supersedingRewind(snapshot.run, step.id)?.id, inputGroups: step.inputs,
          artifactId: step.artifact?.mode === "produce" ? step.artifact.id : undefined
        },
        instruction: action.description, actor: action.actor ?? "agent",
        artifactName: action.artifact?.name, model: action.artifact?.model.definedBy,
        contentType: action.artifact?.payload.contentType, rules
      }), display);
      return true;
    }
    if (operation === "contract-show" || operation === "artifact-show" && options.step) {
      const stepId = needed(options.step, "--step"), snapshot = await g.snapshot(run.id);
      const step = snapshot.steps.find(s => s.id === stepId);
      if (!step) throw failure("NOT_FOUND", "Step not found");
      if (operation === "contract-show") {
        const action = g.action(run, step);
        const schema = snapshot.run.schemaContracts?.[step.source!.actionId];
        const rules = Object.entries(await g.rules(run, action)).flatMap(([scope, tree]) =>
          flattenEffectiveRules(tree).map(entry => ({ scope, text: entry.text })));
        publishResult("run artifact contract show", () => graphContractDetail.parse({
          runId: run.id, stepId, name: action.artifact?.name, contentType: action.artifact?.payload.contentType,
          model: action.artifact?.model.definedBy, definition: action.artifact?.model.definition,
          memoryReference: action.artifact?.model.ref,
          schema: schema && { definition: schema.definition, source: schema.sources.source }, rules
        }), display);
      } else {
        publishResult("run artifact show", () => graphArtifactCollection.parse({ runId: run.id, stepId,
          items: snapshot.artifacts.filter(a => a.stepId === stepId).map(a => ({
            artifactId: a.id, name: previewText(a.name, 160).text, status: a.status,
            contentType: a.content?.payload.contentType, dependencies: a.dependencies
          }))
        }), display);
      }
      return true;
    }
    if (operation === "store-retry") {
      const stepId = needed(options.step, "--step");
      await assertSessionTarget(project, run.id, stepId);
      await assertReportExecutionCapability();
      const snapshot = await g.retryBusinessStore(run.id, stepId);
      await closeStep(project, run.id, stepId);
      const progress = await graphNext(g, snapshot, project);
      const target = snapshot.steps.find(step => step.id === stepId);
      const submitted = target?.artifact?.mode === "produce" ? snapshot.artifacts.find(a => a.id === (target.artifact as { id: string }).id) : undefined;
      publishResult("run step store retry", () => graphReceiptSchema.parse({
        runId: run.id, stepId, status: target?.status ?? "done", artifactId: submitted?.id,
        ...graphStoreReceipt(submitted), nextAction: progress.nextAction
      }), { format: options.output, locale: run.language, saved: { id: stepId, inspect: forRun(project, "step", "show", "--run", run.id, "--step", stepId) } });
      return true;
    }
    if (operation === "rewind") {
      const stepId = needed(options.step, "--step");
      if (options.reason !== undefined && options.reasonFile !== undefined) throw failure("INVALID_ARGUMENT", "Choose --reason or --reason-file");
      const reason = options.reasonFile ? await readFile(options.reasonFile, "utf8") : options.reason;
      if (!options.dryRun && !reason?.trim()) throw failure("INVALID_ARGUMENT", "Rewind reason is required");
      const result = options.dryRun ? await g.rewindPreview(run.id, stepId) : await g.rewind(run.id, stepId, reason!);
      const replacementStepId = "replacementStepId" in result ? String(result.replacementStepId) : undefined;
      const rewindId = "rewindId" in result ? String(result.rewindId) : undefined;
      const inspect = forRun(project, "show", "--run", run.id);
      publishResult("run step rewind", () => graphRewindResult.parse({
        runId: run.id, dryRun: Boolean(options.dryRun), targetStepId: result.targetStepId, actionId: result.actionId,
        affectedStepIds: result.affectedStepIds, affectedArtifactIds: result.affectedArtifactIds, retainedStepIds: result.retainedStepIds,
        rewindId, replacementStepId,
        nextAction: replacementStepId ? forRun(project, "step", "enter", "--run", run.id, "--step", replacementStepId) : undefined
      }), { ...display, saved: rewindId ? { id: rewindId, inspect } : undefined });
      return true;
    }
    if (operation === "enter") {
      if (options.review) throw failure("INVALID_ARGUMENT", "--review requires a free exploration Run");
      const entered = await g.enter(run.id, needed(options.step, "--step"));
      await createCommandState(project, run.id, entered.step.id);
      printProgress("run step enter", await stepResult(g, entered.snapshot, entered.step, project), run,
        options.output, entered.step.id, project);
      return true;
    }
    if (operation === "status") {
      const snapshot = await g.advance(run.id);
      const result = await graphNext(g, snapshot, project, !await currentIdentity(), true);
      printProgress("run status", result, run, options.output);
      return true;
    }
    if (["schema-enter", "schema-show", "schema-report", "schema-skip", "schema-repeat", "schema-export"].includes(operation)) {
      const stepId = needed(options.step, "--step");
      if (operation !== "schema-show" && operation !== "schema-export") { await assertSessionTarget(project, run.id, stepId); await assertReportExecutionCapability(); }
      if (options.schemaName) throw failure("INVALID_ARGUMENT", "graph uses its frozen model Schema; do not pass a Schema name");
      if (operation === "schema-export") {
        const state = await g.schemaShow(run.id, stepId);
        const snapshot = !state.draft ? await g.snapshot(run.id) : undefined;
        const current = snapshot?.steps.find(s => s.id === stepId)?.artifact;
        const id = state.draft?.id ?? (current?.mode === "produce" ? current.id : undefined);
        if (!id) throw failure("NOT_FOUND", "No Artifact to export");
        const content = await g.readArtifact(run.id, id);
        await exportArtifactBytes(content.bytes, needed(options.file, "--file"), Boolean(options.force), [config.runsRoot, join(config.archiveRoot, "runs"), join(config.scopeRoot, "data", "context_control")]);
        emitSchemaExport({ runId: run.id, stepId, exported: options.file!, artifactId: id }, {
          project, phase: state.phase, format: options.output, locale: run.language
        });
        return true;
      }
      let result;
      if (operation === "schema-enter") { result = await g.enterSchema(run.id, stepId); await createCommandState(project, run.id, stepId); }
      else if (operation === "schema-show") result = await g.schemaShow(run.id, stepId);
      else {
        let value: string | number | undefined;
        if (operation === "schema-report") {
          if ([options.artifact, options.artifactFile].filter(v => v !== undefined).length !== 1) throw failure("INVALID_ARGUMENT", "Choose --artifact or --artifact-file");
          value = typeof options.artifact === "string" ? options.artifact : await readFile(options.artifactFile!, "utf8");
        } else if (operation === "schema-repeat") {
          if (!/^\d+$/.test(options.count ?? "")) throw failure("INVALID_ARGUMENT", "Repeat count must be a non-negative integer");
          value = Number(options.count);
        }
        result = await g.schemaWrite(run.id, stepId, operation === "schema-report" ? "report" : operation === "schema-repeat" ? "repeat" : "skip", options.position, value);
      }
      const command = operation.replace("schema-enter", "enter-schema").replace("schema-skip", "skip")
        .replace("schema-repeat", "repeat").replace("schema-", "schema ");
      emitSchemaWriting(`run ${command}`, result, { project, format: options.output, locale: run.language });
      return true;
    }
    if (operation !== "report") return false;
    const stepId = needed(options.step, "--step");
    await assertSessionTarget(project, run.id, stepId);
    if ([options.artifact, options.artifactFile, options.file].filter(v => v !== undefined).length !== 1) throw failure("INVALID_ARGUMENT", "Choose one of --artifact, --artifact-file, --file");
    if (options.revisedFrom || options.tag?.length || options.name) throw failure("INVALID_ARGUMENT", "Graph contract and mandatory inputs are fixed by the Step");
    if (options.revisionSummary !== undefined && options.revisionSummaryFile !== undefined) throw failure("INVALID_ARGUMENT", "Choose one revision summary source");
    await assertReportExecutionCapability();
    const value = options.file ? JSON.parse(await readFile(options.file, "utf8")) : undefined;
    if (options.file && (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !["content", "contentRef", "dependencies"].includes(k)))) throw failure("INVALID_ARGUMENT", "Graph report file accepts content/contentRef and dependencies");
    if (value?.dependencies !== undefined && options.dependsOn?.length) throw failure("INVALID_ARGUMENT", "Use dependencies or --depends-on, not both");
    const dependencies = options.dependsOn?.map(selector => {
      const match = /^(artifact|external):(.+)$/.exec(selector);
      if (!match) throw failure("INVALID_ARGUMENT", "Graph dependencies require fixed artifact:ID or external:ID");
      return { kind: match[1] as "artifact" | "external", id: match[2]! };
    });
    let writeOptions;
    if (options.writeOptions !== undefined) {
      try { writeOptions = JSON.parse(options.writeOptions); }
      catch { throw failure("INVALID_ARGUMENT", "--write-options must be inline JSON"); }
    }
    const result = await g.report(run.id, stepId, { writeOptions, ...(value ?? { text: typeof options.artifact === "string" ? options.artifact : await readFile(options.artifactFile!, "utf8") }), ...(dependencies ? { dependencies } : {}), ...((options.revisionSummary !== undefined || options.revisionSummaryFile) ? { revisionSummary: options.revisionSummary ?? await readFile(options.revisionSummaryFile!, "utf8") } : {}) });
    if (result.step.status === "done") await closeStep(project, run.id, stepId);
    const saved = { id: result.artifact.id, inspect: forRun(project, "artifact", "show", "--run", run.id, "--artifact", result.artifact.id) };
    const next = await (result.step.status === "done" ? graphNext(g, result.snapshot, project)
      : stepResult(g, result.snapshot, result.step, project)).catch(error => { throw new CliOutputError(saved, error); });
    const reviewing = result.step.status === "awaiting_review";
    publishResult("run report", () => graphReceiptSchema.parse({
      runId: run.id, stepId, artifactId: result.artifact.id, status: result.step.status,
      reviewId: reviewing ? next.reviewId : undefined, roundId: reviewing ? next.roundId : undefined,
      ...graphStoreReceipt(result.artifact), nextAction: next.nextAction,
      dependencies: result.artifact.dependencies.slice(0, 20), dependencyCount: result.artifact.dependencies.length,
      nextStep: next.stepId, nextInstruction: next.instruction, nextActor: next.actor, nextDetails: next.details,
      nextMaterials: next.materials, nextRules: next.rules
    }), { format: options.output, locale: run.language, saved, maximumBytes: 8192, itemsField: "nextMaterials" });
    return true;
  });
}

const graphReceiptSchema = z.object({
  runId: z.string(), stepId: z.string(), artifactId: z.string().optional(), status: z.string(),
  reviewId: z.string().optional(), roundId: z.string().optional(),
  storeId: z.string().optional(), modelRef: z.string().optional(), dataId: z.string().optional(),
  dependencies: z.array(runEvidenceSchema.omit({ read: true })).max(20).optional(),
  dependencyCount: z.number().int().nonnegative().optional(),
  nextMaterials: z.array(runEvidenceSchema).max(4).optional(),
  nextRules: z.array(z.object({ scope: z.string(), text: z.string() }).strict()).max(5).optional(),
  nextStep: z.string().optional(), nextInstruction: z.string().optional(),
  nextActor: z.enum(["agent", "human"]).optional(), nextDetails: cliCommandSchema.optional(), nextAction
}).strict();

function graphStoreReceipt(artifact?: Snapshot["artifacts"][number]) {
  const address = artifact?.business?.destination;
  return address ? { storeId: address.storeId, modelRef: address.modelRef, dataId: address.dataId } : {};
}
