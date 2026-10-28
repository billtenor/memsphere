import { readFile } from "node:fs/promises";
import { readConfig } from "../config.js";
import type { MemoryCatalog } from "../memory/catalog.js";
import { collectMemoryReferenceTargets } from "../memory/references.js";
import { parseMemoryEntity } from "../memory/store.js";
import { parseMemoryYaml } from "../memory/yaml.js";
import { serializeMemoryYaml } from "../memory/serializer.js";
import { openContextControl } from "../project/context-control.js";
import { isGraphRun, type GraphRuntime } from "../context_control/graph-runtime.js";
import { failure } from "../context_control/errors.js";
import type { Run, Snapshot, Step } from "../context_control/types.js";
import type { ControlPlaneConfig, RunReviewConfiguration } from "../control-plane/index.js";
import { renderPrompt } from "../prompts/renderer.js";
import { emitCommandResult } from "./cli-errors.js";
import { createCommandState, findCommandStates, updateCommandState } from "../home/command-state-store.js";
import { assertReportExecutionCapability } from "../report-execution.js";
import { graphReviewHandle } from "../context_control/review-repository.js";
import { buildArtifactReviewSummaryPromptModel, buildArtifactReviewNextActionPromptModel, buildRunReviewVoteReceiptPromptModel } from "../prompts/index.js";
import type { ArtifactReview, ArtifactReviewRound } from "../artifact-review.js";
import type { Options } from "./context-control.js";
import { appProcedureFileSource } from "../app/run.js";
import { join } from "node:path";
import { readRun as readLegacyRun } from "../run/store.js";
import { flattenEffectiveRules } from "../memory/rules.js";

const needed = (v: string | undefined, key: string) => { if (!v?.trim()) throw failure("INVALID_ARGUMENT", `${key} is required`); return v; };
const quote = (v: string) => "'" + v.replaceAll("'", "'\\''") + "'";
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
  try {
    const rows = (await findCommandStates(project, run)).filter(r => r.value.parameters.step === step && r.value.status === "active");
    return rows[0]?.value ?? await createCommandState(project, run, step);
  } catch { return undefined; }
}
async function closeStep(project: string, run: string, step: string) {
  try { for (const row of await findCommandStates(project, run)) if (row.value.parameters.step === step && row.value.status === "active") await updateCommandState(row, { ...row.value, status: "closed" }); } catch { /* Auxiliary state cannot fail a completed Step. */ }
}
async function stepPrompt(g: GraphRuntime, snapshot: Snapshot, step: Step, project: string) {
  const run = snapshot.run, a = g.action(run, step), c = await context(project, run.id, step.id);
  if (step.status === "awaiting_review") {
    const round = step.reviewRounds!.at(-1)!;
    return renderPrompt("run.graph-waiting", run.language, { runId: run.id, message: run.language === "en" ? `Step ${step.id} is awaiting review (${round.id}). Execute review wait and wait for the result; do not invent additional work while waiting.` : `Step ${step.id} 正在等待评审（${round.id}）。执行 review wait 并等待结果，不要在等待期间自行增加工作。`, command: c ? `memsphere continue ${c.id} review wait` : `memsphere --project ${quote(project)} run review wait --review ${graphReviewHandle(run.id, step.id)}` });
  }
  const rules = await g.rules(run, a);
  const labels = run.language === "en" ? { procedure: "Procedure rules", asserts: "Step rules", suggests: "Step suggestions", artifactAsserts: "Artifact rules", artifactSuggests: "Artifact suggestions" } : { procedure: "流程规则", asserts: "Step 规则", suggests: "Step 建议", artifactAsserts: "产物规则", artifactSuggests: "产物建议" };
  const ruleText = (Object.keys(rules) as Array<keyof typeof rules>).flatMap(key => {
    const entries = flattenEffectiveRules(rules[key]);
    return entries.length ? [`${labels[key]}：`, ...entries.map(entry => `- ${entry.text}`)] : [];
  }).join("\n");
  const materials = Object.entries(step.inputs ?? {}).map(([key, refs]) => refs.length
    ? `${key}:\n${refs.map(r => `- ${r.kind}:${r.id}\n  memsphere --project ${quote(project)} run artifact show --run ${quote(run.id)} --artifact ${quote(r.id)}`).join("\n")}`
    : `${key}: []`).join("\n");
  return renderPrompt("run.graph-step", run.language, { runId: run.id, stepId: step.id, instruction: a.description, human: a.actor === "human", rules: ruleText || (run.language === "en" ? "None" : "无"), materials: materials || "[]", artifact: JSON.stringify({ name: a.artifact!.name, model: a.artifact!.model, payload: a.artifact!.payload }, null, 2), command: c ? `memsphere continue ${c.id} report --artifact-file <file>` : `memsphere --project ${quote(project)} run report --run ${run.id} --step ${step.id} --artifact-file <file>` });
}
export async function graphNext(g: GraphRuntime, snapshot: Snapshot, project: string): Promise<string> {
  const run = snapshot.run;
  if (run.status !== "running") return renderPrompt("run.graph-waiting", run.language, { runId: run.id, message: run.status, command: `memsphere run show --run ${run.id}` });
  const ready = g.ready(snapshot);
  if (ready.length === 1) { const entered = await g.enter(run.id, ready[0].id); return stepPrompt(g, entered.snapshot, entered.step, project); }
  if (ready.length > 1) return renderPrompt("run.graph-selection", run.language, { runId: run.id, steps: ready.map(s => { const a = g.action(run, s); return { id: s.id, description: a.description, actor: a.actor ?? "agent", artifact: a.artifact!.name }; }), command: `memsphere --project ${quote(project)} run step enter --run ${run.id} --step <step-id>` });
  const reviewing = snapshot.steps.filter(s => s.status === "awaiting_review");
  const partial = run.frames![0].graphFrame.joins.filter(j => Object.keys(j.arrivals).length);
  const complete = !reviewing.length && !partial.length;
  return renderPrompt("run.graph-waiting", run.language, { runId: run.id, message: complete ? (run.language === "en" ? "All Steps completed; finish the Run." : "全部 Step 已完成，可以结束 Run。") : (run.language === "en" ? `${reviewing.length} Steps awaiting review; ${partial.length} incomplete joins.` : `${reviewing.length} 个 Step 等待评审；${partial.length} 个 Join 尚未凑齐。`), command: complete ? `memsphere --project ${quote(project)} run finish --run ${run.id}` : `memsphere --project ${quote(project)} run status --run ${run.id}` });
}
export async function printGraphStart(snapshot: Snapshot, output?: "text" | "json") {
  const config = await readConfig(); const service = (await openContextControl(config.scopeRoot))!;
  const prompt = await service.withGraph(g => graphNext(g, snapshot, config.project!.name));
  if (output === "json") emitCommandResult({ runId: snapshot.run.id, prompt }, "json"); else console.log(prompt);
}
export async function printGraphReviewOutput(review: ArtifactReview<import("../run/store.js").RunEvent["artifact"]>, round: ArtifactReviewRound, runId: string, vote?: "approve" | "request_changes") {
  if (!review.id.startsWith("graph-review-")) return false;
  const config = await readConfig(); const service = (await openContextControl(config.scopeRoot))!;
  await service.withGraph(async g => {
    const snapshot = await g.advance(runId);
    console.log(vote ? renderPrompt("run.review-vote-receipt", snapshot.run.language, buildRunReviewVoteReceiptPromptModel(vote, snapshot.run.language)) : renderPrompt("run.review-summary", snapshot.run.language, buildArtifactReviewSummaryPromptModel(review, round, snapshot.run.language)));
    const step = snapshot.steps.find(s => s.id === review.stepId)!;
    if (step.status === "done") { await closeStep(config.project!.name, runId, step.id); console.log(await graphNext(g, snapshot, config.project!.name)); }
    else if (step.status === "running") console.log(await stepPrompt(g, snapshot, step, config.project!.name));
    else console.log(renderPrompt("run.review-next-action", snapshot.run.language, buildArtifactReviewNextActionPromptModel(review, round, runId)));
  });
  return true;
}
export async function graphCommand(operation: string, input: object): Promise<boolean> {
  const options = input as Options & { slot?: string; skip?: boolean };
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
    if (operation === "binding-show" || operation === "binding-update") {
      const actors = Array.isArray(options.actor) ? options.actor as string[] : options.actor ? [options.actor] : [];
      if (operation === "binding-update" && options.skip && actors.length) throw failure("INVALID_ARGUMENT", "Choose Actors or skip");
      const result = operation === "binding-show" ? await g.bindingSnapshot(run.id) : await g.updateBinding(run.id, needed(options.slot, "--slot"), options.skip ? { skip: true } : { actorIds: actors });
      emitCommandResult(result, options.output ?? "text"); return true;
    }
    if (operation === "show" || operation === "step-show") {
      const snapshot = await g.snapshot(run.id);
      const step = options.step && snapshot.steps.find(s => s.id === options.step);
      if (options.step && !step) throw failure("NOT_FOUND", `Step not found: ${options.step}`);
      emitCommandResult(step ? { runId: run.id, step, action: g.action(run, step) } : snapshot, options.output ?? "text"); return true;
    }
    if (operation === "enter") { const entered = await g.enter(run.id, needed(options.step, "--step")); console.log(await stepPrompt(g, entered.snapshot, entered.step, project)); return true; }
    if (operation === "status") { const snapshot = await g.advance(run.id); const prompt = await graphNext(g, snapshot, project); if (options.output === "json") emitCommandResult({ snapshot: await g.snapshot(run.id), prompt }, "json"); else console.log(prompt); return true; }
    if (operation !== "report") return false;
    const stepId = needed(options.step, "--step");
    if ([options.artifact, options.artifactFile, options.file].filter(v => v !== undefined).length !== 1) throw failure("INVALID_ARGUMENT", "Choose one of --artifact, --artifact-file, --file");
    if (options.writeOptions || options.dependsOn?.length || options.revisedFrom || options.tag?.length || options.name) throw failure("INVALID_ARGUMENT", "Graph contract and input dependencies are fixed by the Step");
    if (options.revisionSummary !== undefined && options.revisionSummaryFile !== undefined) throw failure("INVALID_ARGUMENT", "Choose one revision summary source");
    await assertReportExecutionCapability();
    const value = options.file ? JSON.parse(await readFile(options.file, "utf8")) : undefined;
    if (value && (typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !["content", "contentRef"].includes(k)))) throw failure("INVALID_ARGUMENT", "Graph report file accepts content or contentRef only");
    const result = await g.report(run.id, stepId, { ...(value ?? { text: typeof options.artifact === "string" ? options.artifact : await readFile(options.artifactFile!, "utf8") }), ...((options.revisionSummary !== undefined || options.revisionSummaryFile) ? { revisionSummary: options.revisionSummary ?? await readFile(options.revisionSummaryFile!, "utf8") } : {}) });
    let prompt: string;
    if (result.step.status === "done") { await closeStep(project, run.id, stepId); prompt = await graphNext(g, result.snapshot, project); }
    else prompt = await stepPrompt(g, result.snapshot, result.step, project);
    emitCommandResult({ runId: run.id, stepId, artifactId: result.artifact.id, status: result.step.status, prompt }, options.output ?? "text");
    return true;
  });
}
