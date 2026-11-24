import { createHash } from "node:crypto";
import type { ContextControl } from "./service.js";
import type { Run, Snapshot, Step } from "./types.js";
import type { MemsphereConfig } from "../config.js";
import { isGraphRun } from "./graph-runtime.js";
import { parseMemoryEntity } from "../memory/store.js";
import { parseMemoryYaml } from "../memory/yaml.js";
import { graphReviewHandle } from "./review-repository.js";
import { resolveRuleParts, RuleResolutionError } from "../memory/rules.js";
import { toEffectiveRuleDisplayTree, type EffectiveRuleDisplayTree } from "../memory/serializer.js";
import type { RulePart, StatementMemory } from "../memory/ast.js";
import { createMemoryCatalogForConfig } from "../memory/factory.js";
import { projectGraphRound } from "./graph-review.js";
import { explorationReviewHandle } from "./exploration-review.js";
import { explorationReviewerOptions } from "./exploration-contract.js";
import { MEMSPHERE_SCHEMA_MODEL } from "../memory/schema-model.js";

/** Basic list metadata must not depend on any child records. */
export function contextRunSummary(run: Run & { unavailable?: boolean; error?: string }) {
  return { id:run.id,name:run.name,status:run.status,language:run.language,createdAt:run.createdAt,...(run.unavailable?{unavailable:true,error:run.error}:{}),representation: "context-control", procedureName: "", updatedAt: run.endedAt ?? run.createdAt,
    archived: Boolean(run.archived), readOnly: Boolean(run.archived || run.unavailable) };
}


export function contextRunPayload(snapshot: Snapshot, lightweight = false, actionId?: string) {
  const { run } = snapshot;
  const p = isGraphRun(run) ? parseMemoryEntity("procedures", parseMemoryYaml(run.memorySnapshot!.memories[run.memoryRef!].payload.content)) : undefined;
  const creationOrder = new Map(run.frames?.[0]?.graphFrame?.triggers.map((trigger, index) => [trigger.stepId, index]) ?? []);
  const graph = p?.tag === "!procedure" && p.mode === "graph" ? { procedure: p, work: [...snapshot.steps].sort((a, b) => creationOrder.get(a.id)! - creationOrder.get(b.id)!).map(s => ({ ...s, action: p.actions.find(a => a.id === s.source?.actionId), ...(s.reviewRounds?.length ? { reviewHandle: graphReviewHandle(run.id, s.id) } : {}) })) } : undefined;
  if (graph) for (const step of graph.work) {
    const draft = snapshot.artifacts.find(a => a.id === step.writing?.draftId);
    const writing = draft?.writing;
    if (draft && writing) Object.assign(step, { schemaWriting: { phase: writing.submission ? "submitting" : writing.index === writing.items.length ? "awaiting_finalization" : "writing", current: writing.items[writing.index]?.schemaContext?.path, completed: writing.index, total: writing.items.length, skipped: writing.skipped, requirements: run.schemaContracts?.[step.source!.actionId]?.sources } });
  }
  const artifactReviewSummaries = graph && !lightweight ? snapshot.steps.filter(s => s.reviewRounds?.length).map(step => {
    const round = step.reviewRounds!.at(-1)!; const projected = projectGraphRound(run, step, round, snapshot.reviews);
    return { id: graphReviewHandle(run.id, step.id), stepId: step.id, currentRoundId: round.id, status: projected.status === "changes_requested" ? "awaiting_revision" : projected.status, round: projected };
  }) : [];
  const explorationReviews = graph ? undefined : snapshot.reviews.flatMap(r => r.exploration ? [{ id: explorationReviewHandle(run.id, r.id), roundId: r.roundId!, artifactId: r.artifactId,
    status: run.status !== "running" && r.status !== "submitted" ? "cancelled" : r.attempts?.at(-1)?.completion?.kind === "failed" ? "failed" : r.status,
    reviewer: r.exploration.configuration.reviewer, vote: r.vote?.value, createdAt: r.createdAt }] : [])
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const workflow = graph ? undefined : explorationWorkflow(snapshot, actionId);
  return { ...run, artifactReviewSummaries, outputArtifactIds: snapshot.outputArtifactIds, representation: "context-control", procedureName: p?.names[0] ?? "", updatedAt: run.endedAt ?? snapshot.steps.map(s => s.endedAt ?? s.createdAt).sort().at(-1) ?? run.createdAt,
    contextRevision: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"), eventCount: snapshot.completeIds.length, archived: Boolean(run.archived), readOnly: Boolean(run.archived), context: { ...snapshot, reviews: snapshot.reviews.filter(r => !r.exploration), workflow, explorationReviews,
      artifacts: snapshot.artifacts.map(a => {
        if (!a.schemaContract) return { ...a, ...(a.writing ? { writingProgress: writingProgress(a, snapshot) } : {}) };
        const { content: _content, contentRef: _ref, writing: _writing, schemaContract, initialStepReviewConfiguration: _configuration, ...metadata } = a;
        return { ...metadata, schema: schemaContract.sources.source.memoryRef, ...(a.writing ? { writingProgress: writingProgress(a, snapshot) } : {}) };
      }), ...(graph ? { graph } : {}) } };
}

function explorationWorkflow(snapshot: Snapshot, actionId?: string) {
  const artifacts = new Map(snapshot.artifacts.map(artifact => [artifact.id, artifact]));
  const byStep = new Map(snapshot.artifacts.map(artifact => [artifact.stepId, artifact]));
  const entries = snapshot.steps.map(step => {
    const artifactId = step.writing?.draftId ?? (step.artifact?.mode === "produce" ? step.artifact.id : undefined);
    const artifact = (artifactId && artifacts.get(artifactId)) || byStep.get(step.id);
    const refs = artifact?.dependencies ?? [];
    return { step: { ...step, source: { actionId: step.id }, inputs: { dependencies: refs } }, artifact, refs };
  });
  const actions = entries.map(({ step, artifact, refs }) => {
    const dependencies = refs.flatMap(ref => {
      const upstream = ref.kind === "artifact" ? artifacts.get(ref.id) : undefined;
      return upstream ? [{ from: upstream.stepId }] : [];
    });
    const contentType = artifact?.content?.payload.contentType;
    const contract = artifact?.schemaContract;
    return { id: step.id, description: artifact?.name ?? step.id, dependencies, ...(artifact ? { artifact: {
      name: artifact.name,
      ...(contentType ? { payload: { contentType } } : {}),
      ...(contract ? { model: { definedBy: MEMSPHERE_SCHEMA_MODEL, ref: contract.sources.source.memoryRef,
        ...(step.id === actionId ? { frozenDefinition: contract.definition } : {}) } } : {})
    } } : {}) };
  });
  return { procedure: { names: [snapshot.run.name], actions }, work: entries.map(({ step }) => step) };
}
function writingProgress(a: Snapshot["artifacts"][number], snapshot: Snapshot) {
  const writing = a.writing!, validation = snapshot.steps.find(s => s.id === a.stepId)?.validation;
  return { index: writing.index, items: writing.items.map(item => ({ id: item.id, path: item.schemaContext?.path })), skipped: writing.skipped, submitting: Boolean(writing.submission),
    validation: validation?.artifactId === a.id && validation.draftRevision === snapshot.artifactRevisions?.[a.id] ? validation : undefined };
}
export async function contextRunDetailPayload(snapshot: Snapshot, lightweight = false, projection?: { surface: 'overview' | 'artifacts' | 'action'; actionId?: string }, config?: MemsphereConfig) {
  const actionId = projection?.surface === "action" ? projection.actionId : undefined;
  const payload = contextRunPayload(snapshot, lightweight, actionId);
  const procedure = payload.context.graph?.procedure;
  if (!procedure) {
    const step = snapshot.steps.find(candidate => candidate.id === actionId);
    const action = payload.context.workflow?.procedure.actions.find(candidate => candidate.id === actionId);
    if (config && step?.reviewConfiguration && action?.artifact) {
      const { review, ...rules } = await explorationStepDefinition(config, step);
      Object.assign(action, rules);
      Object.assign(action.artifact, { review });
    }
    return payload;
  }
  // Procedure rules come from the Run's frozen Memory.
  const statements = new Map<string, StatementMemory>();
  const lookup = async (reference: string): Promise<StatementMemory> => {
    if (statements.has(reference)) return statements.get(reference)!;
    const source = snapshot.run.memorySnapshot?.memories[reference];
    if (!source) throw new Error(`Frozen rule not found: ${reference}`);
    const entity = parseMemoryEntity('statements', parseMemoryYaml(source.payload.content));
    if (entity.tag !== '!statement') throw new Error(`Expected frozen Statement: ${reference}`);
    statements.set(reference, entity);
    return entity;
  };
  for (const action of procedure.actions) {
    const frozen = snapshot.run.schemaContracts?.[action.id];
    if (frozen && action.artifact) Object.assign(action.artifact.model, { frozenDefinition: frozen.definition });
  }
  const actions = projection?.surface === 'action' ? procedure.actions.filter(action => action.id === projection.actionId) : procedure.actions;
  const sources = !projection ? [procedure, ...actions.flatMap(action => [action, action.artifact])]
    : projection.surface === 'overview' ? [procedure]
    : projection.surface === 'action' ? actions.flatMap(action => [action, action.artifact]) : [];
  for (const source of sources) {
    if (!source) continue;
    const effectiveRules = await projectEffectiveRules(source, lookup);
    if (effectiveRules) Object.assign(source, { effectiveRules });
  }
  return payload;
}

async function projectEffectiveRules(
  declarations: { asserts?: readonly RulePart[]; suggests?: readonly RulePart[] },
  lookup: (reference: string) => Promise<StatementMemory>
): Promise<EffectiveRuleDisplayTree | undefined> {
  const effectiveRules: EffectiveRuleDisplayTree = {};
  for (const channel of ["asserts", "suggests"] as const) {
    const projected = [];
    for (const part of declarations[channel] ?? []) {
      if (typeof part === "string") continue;
      try {
        const resolved = toEffectiveRuleDisplayTree(await resolveRuleParts(channel, [part], lookup));
        projected.push(...resolved[channel] ?? []);
      } catch (error) {
        // A display-only rule source must not hide the rest of the Run definition.
        if (!(error instanceof RuleResolutionError)) throw error;
      }
    }
    if (projected.length) effectiveRules[channel] = projected;
  }
  return Object.keys(effectiveRules).length ? effectiveRules : undefined;
}

/** The Step definition shows current configuration; each Review separately freezes its own rules. */
async function explorationStepDefinition(config: MemsphereConfig, step: Step) {
  const setting = step.reviewConfiguration ?? {};
  const declares = (references: string[] = []) => references.map(target => ({ tag: "!ref" as const, target }));
  const declarations = { asserts: declares(setting.asserts), suggests: declares(setting.suggests) };
  const reviewer = explorationReviewerOptions(config).find(option => option.value === setting.reviewer)?.name ?? setting.reviewer;
  let effectiveRules: EffectiveRuleDisplayTree | undefined;
  if (declarations.asserts.length || declarations.suggests.length) {
    const live = createMemoryCatalogForConfig(config);
    const catalog = await live.snapshot?.() ?? live;
    effectiveRules = await projectEffectiveRules(declarations, async reference => {
      const source = await catalog.read(reference, { kind: "statements" });
      if (source.tag !== "!statement") throw new Error(`Expected Statement: ${reference}`);
      return source;
    });
  }
  return { ...declarations, effectiveRules, review: reviewer ? [reviewer] : [] };
}
export async function contextRunSummaries(service: ContextControl | undefined) {
  if (!service) return [];
  return Promise.all((await service.listRunEntries()).map(async entry => {
    if (entry.run) {
      try { const { context: _, ...summary } = contextRunPayload(await service.inspect(entry.id)); return summary; }
      catch (error) { return { ...entry.run, updatedAt: entry.run.createdAt, unavailable: true, error: error instanceof Error ? error.message : String(error) }; }
    }
    return { id: entry.id, name: entry.id, status: "running" as const, createdAt: "", updatedAt: "", archived: false, unavailable: true, error: entry.error };
  }));
}
export function assertUniqueRunSources(legacy: Array<{ id: string }>, current: Array<{ id: string }>) {
  const ids = new Set(legacy.map(r => r.id));
  if (current.some(r => ids.has(r.id))) throw new Error("Run ID exists in both legacy and model Stores");
}
