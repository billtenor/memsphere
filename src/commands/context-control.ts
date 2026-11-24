import { tryReviewerResource } from "../acp/reviewer-resources.js";
import { assertSessionTarget, currentCommandState, closeRunCommandStates, openCommandStates, createCommandState, findCommandStates, requireCommandState, updateCommandState, accountRead, releaseCommandTarget, type CommandStateRow } from "../home/command-state-store.js";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { Option } from "commander";
import { readConfig, type MemsphereConfig } from "../config.js";
import { readRun, listRuns } from "../run/store.js";
import { openContextControl } from "../project/context-control.js";
import { failure, type ContextControl } from "../context_control/service.js";
import { textContent, type Body, type ReportInput } from "../context_control/types.js";
import { downstream, scopedSnapshot } from "../context_control/graph.js";
import { emitCommandResult } from "./cli-errors.js";
import { graphCommand } from "./procedure-graph.js";
import { isGraphRun } from "../context_control/graph-runtime.js";
import { explorationReviewerOptions, explorationRules, freezeExplorationSchema } from "../context_control/exploration-contract.js";
import { ExplorationReviews, explorationReviewIdentity } from "../context_control/exploration-review.js";
import { explorationReviewView, readArtifactReviewForRunner } from "../context_control/review-repository.js";
import { dispatchArtifactReviewAgents } from "../acp/dispatcher.js";

export type Options = { checkpoint?: string; position?: string; count?: string; force?: boolean; authorization?: string; sessionStateId?: string; add?: string[]; remove?: string[]; run?: string; name?: string; target?: string; artifact?: string | string[]; artifactFile?: string; file?: string; content?: string; contentType?: string; revisedFrom?: string; tag?: string[]; dependsOn?: string[]; external?: string; review?: string; reviewer?: string; comment?: string[]; commentFile?: string; source?: string; reason?: string; reasonFile?: string; root?: string; for?: string; out?: string; output?: "text" | "json"; change?: string; reviewConfig?: string; step?: string; assignment?: string; writeOptions?: string; revisionSummary?: string; revisionSummaryFile?: string; actor?: string;
  schemaName?: string; asserts?: string[]; suggests?: string[]; clearAsserts?: boolean; clearSuggests?: boolean; clearReviewer?: boolean; progressive?: boolean; node?: string; all?: boolean; commentId?: string; sessionRow?: CommandStateRow };
const requireOption = (value: string | undefined, name: string) => { if (!value?.trim()) throw failure("INVALID_ARGUMENT", `${name} is required`); return value; };
function strictObject(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("INVALID_ARGUMENT", "Expected an object");
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw failure("INVALID_ARGUMENT", `Unknown/system field: ${key}`);
  return value as Record<string, unknown>;
}
async function reportInput(o: Options): Promise<ReportInput> {
  if (o.target !== undefined) throw failure("INVALID_ARGUMENT", "Free exploration report accepts complete content directly; --target is not supported");
  if ([o.file, o.artifact, o.artifactFile].filter(x => x !== undefined).length !== 1) throw failure("INVALID_ARGUMENT", "Choose exactly one of --artifact, --artifact-file, --file");
  if (o.writeOptions || o.revisionSummary || o.revisionSummaryFile) throw failure("INVALID_ARGUMENT", "Legacy report options cannot be used with free exploration");
  const input = o.file ? strictObject(JSON.parse(await readFile(o.file, "utf8")), ["name", "content", "contentRef", "dependencies", "tags", "revisedFrom", "revisedSummary"]) as ReportInput : { content: textContent(typeof o.artifact === "string" ? o.artifact : await readFile(o.artifactFile!, "utf8"), o.contentType) };
  if (o.file && o.contentType !== undefined) throw failure("INVALID_ARGUMENT", "Structured content already specifies contentType");
  for (const [key, value] of Object.entries({ name: o.name, revisedFrom: o.revisedFrom, tags: o.tag?.length ? o.tag : undefined })) {
    if (value === undefined) continue;
    if (Object.hasOwn(input, key)) throw failure("INVALID_ARGUMENT", `Duplicate field: ${key}`);
    Object.assign(input, { [key]: value });
  }
  if (o.dependsOn?.length && input.dependencies !== undefined) throw failure("INVALID_ARGUMENT", "Cannot combine dependencies with --depends-on");
  return { ...input, ...(o.target ? { target: o.target } : {}), ...(o.dependsOn?.length ? { dependsOn: o.dependsOn } : {}) };
}

export async function explorationStepConfiguration(service: ContextControl, config: MemsphereConfig, runId: string, stepId: string) {
  const step = await service.explorationStep(runId, stepId);
  const configuration = step.reviewConfiguration ?? {}, reviewers = explorationReviewerOptions(config);
  const missing: string[] = [];
  let rulesError: string | undefined;
  try {
    const rules = await explorationRules(config, configuration);
    if (!rules.asserts.count && !rules.suggests.count) missing.push("asserts/suggests");
  } catch (error) { rulesError = error instanceof Error ? error.message : String(error); missing.push("asserts/suggests"); }
  if (!reviewers.some(r => r.value === configuration.reviewer)) missing.push("reviewer");
  if (step.status !== "done") missing.push("submitted Artifact");
  return { runId, step, configuration, reviewers, missing, ...(rulesError ? { rulesError } : {}) };
}

export async function configureExplorationStep(service: ContextControl, config: MemsphereConfig, runId: string, stepId: string, options: Options) {
  if ((options.asserts && options.clearAsserts) || (options.suggests && options.clearSuggests) || (options.reviewer !== undefined && options.clearReviewer)) throw failure("INVALID_ARGUMENT", "Choose setting or clearing each field");
  if (options.reviewer !== undefined && !explorationReviewerOptions(config).some(r => r.value === options.reviewer)) throw failure("INVALID_REVIEWER", "Select an available reviewer from run step show");
  const rules = options.asserts || options.suggests ? await explorationRules(config, options) : undefined;
  await service.configureExplorationStep(runId, stepId, {
    ...(options.clearAsserts || options.asserts ? { asserts: rules?.asserts.references ?? [] } : {}),
    ...(options.clearSuggests || options.suggests ? { suggests: rules?.suggests.references ?? [] } : {}),
    ...(options.clearReviewer ? { reviewer: null } : options.reviewer !== undefined ? { reviewer: options.reviewer } : {})
  });
  return explorationStepConfiguration(service, config, runId, stepId);
}

const schemaOperations = new Set(["schema-enter", "schema-show", "schema-report", "schema-repeat", "schema-skip", "schema-export"]);

async function inputText(options: Options, required = false) {
  const count = Number(options.artifact !== undefined) + Number(options.artifactFile !== undefined);
  if (count > 1 || required && count !== 1) throw failure("INVALID_ARGUMENT", "Choose --artifact or --artifact-file");
  return options.artifactFile !== undefined ? readFile(options.artifactFile, "utf8") : options.artifact as string | undefined;
}

async function explorationSchema(operation: string, s: ContextControl, config: MemsphereConfig, runId: string, o: Options) {
  const project = config.project!.name;
  if (operation === "schema-enter") {
    if ([o.step, o.revisedFrom, o.schemaName].filter(x => x !== undefined).length !== 1 || !o.schemaName && (o.name !== undefined || o.contentType !== undefined)) {
      throw failure("INVALID_ARGUMENT", "Specify a Schema name with --name and --content-type, --step, or --revised-from");
    }
    const expected = { row: o.sessionRow ?? await currentCommandState() };
    const contract = o.schemaName ? await freezeExplorationSchema(config, requireOption(o.name, "--name"), o.schemaName, requireOption(o.contentType, "--content-type")) : undefined;
    const result = await s.enterExplorationSchema(runId, { stepId: o.step, revisedFrom: o.revisedFrom, name: o.name, contentType: o.contentType, contract });
    try {
      if (result.phase === "submitted") await releaseCommandTarget(expected.row, project, runId, { step: result.stepId });
      else await createCommandState(project, runId, result.stepId, undefined, expected);
    } catch {
      const recovery = result.phase === "submitted" ? `run enter --run ${runId}` : `run enter-schema --run ${runId} --step ${result.stepId}`;
      return { ...result, warnings: [`${result.phase === "submitted" ? "Artifact" : "Draft"} saved. Resume with: memsphere ${recovery}`] };
    }
    return result;
  }
  const step = requireOption(o.step, "--step");
  if (operation === "schema-show") return s.explorationSchemaShow(runId, step);
  if (operation === "schema-export") {
    const { draft } = await s.explorationSchemaShow(runId, step);
    const { bytes } = await s.body(draft);
    const { exportArtifactBytes } = await import("./run.js");
    await exportArtifactBytes(bytes, requireOption(o.file, "--file"), Boolean(o.force), [config.runsRoot, config.archiveRoot, join(config.scopeRoot, "data", "context_control")]);
    return { runId, stepId: step, artifactId: draft.id, exported: o.file };
  }
  await assertSessionTarget(project, runId);
  if (operation === "schema-repeat" && (!/^\d+$/.test(o.count ?? "") || !Number.isSafeInteger(Number(o.count)))) throw failure("INVALID_ARGUMENT", "Repeat count must be a non-negative safe integer");
  return s.writeExplorationSchema(runId, step, operation === "schema-report" ? "report" : operation === "schema-repeat" ? "repeat" : "skip", o.position,
    operation === "schema-report" ? await inputText(o, true) : operation === "schema-repeat" ? Number(o.count) : undefined);
}

/** Return false only for a proven legacy Run, never for a failed new Store. */
export async function tryContextCommand(operation: string, options: object): Promise<boolean> {
  const o = options as Options;
  if (["artifact-show", "external-show", "review-show", "review-list"].includes(operation) && await tryReviewerResource(operation, o)) return true;
  if (await graphCommand(operation, o)) return true;
  const newFlags = [o.target, o.for, o.out, o.root, o.revisedFrom, operation === "schema-export" ? undefined : o.file].some(v => v !== undefined) || !!o.dependsOn?.length || !!o.tag?.length || operation === "artifact-show" && o.artifact !== undefined;
  if (!o.run) { if (newFlags) throw failure("INVALID_ARGUMENT", "Free exploration options require --run"); return false; }
  const config = await readConfig();
  const service = await openContextControl(config.scopeRoot);
  const run = service && await service.findRun(o.run);
  let legacy = false;
  try { await readRun(config.runsRoot, o.run); legacy = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (run && legacy) throw failure("AMBIGUOUS_RUN", "Run ID exists in both storage sources");
  if (!run) {
    if (newFlags) throw failure("INVALID_ARGUMENT", "Free exploration options require a model-backed Run");
    return false;
  }
  const stepTarget = schemaOperations.has(operation) || ["step-show", "step-configure", "report"].includes(operation);
  if (o.step && !stepTarget || o.assignment || o.actor) throw failure("INVALID_ARGUMENT", "Unsupported identity or Step option");
  const s = service!; const runId = run.id; let result: unknown;
  if (["report", "external-add", "artifact-tag", "outputs-update", "finish", "abandon", "review-create"].includes(operation)) await assertSessionTarget(config.project!.name, runId);
  if (operation === "enter") {
    const expected = { row: await currentCommandState() };
    const identity = o.review ? explorationReviewIdentity(o.review) : undefined;
    if (o.review && identity?.runId !== runId) throw failure("INVALID_ARGUMENT", "Review does not belong to this Run");
    const review = identity ? await new ExplorationReviews(s).locate(runId, identity.recordId) : undefined;
    if (review && !review.permissions.runner.permissions.includes("artifact.read")) throw failure("PERMISSION_DENIED", "Runner requires artifact.read");
    const context = await createCommandState(config.project!.name, runId, undefined, o.review, expected);
    if (!context) throw failure("AGENT_SESSION_REQUIRED", "Enable Agent identity to bind this Run");
    emitCommandResult({ runId, sessionId: context.sessionId, ...(o.review ? { reviewId: o.review } : {}), nextCommand: o.review ? "memsphere continue review show" : "memsphere continue --help" }, o.output); return true;
  }
  if (schemaOperations.has(operation)) {
    result = await explorationSchema(operation, s, config, runId, o);
  } else if (operation === "step-show") {
    result = await explorationStepConfiguration(s, config, runId, requireOption(o.step, "--step"));
  } else if (operation === "step-configure") {
    await assertSessionTarget(config.project!.name, runId);
    result = await configureExplorationStep(s, config, runId, requireOption(o.step, "--step"), o);
  } else if (operation === "report" && o.step) {
    if ([o.name, o.revisedFrom, o.file, o.contentType, o.target, o.writeOptions, o.revisionSummary, o.revisionSummaryFile, o.tag].some(v => v !== undefined)) throw failure("INVALID_ARGUMENT", "Schema submission accepts complete content and --depends-on");
    const previous = o.sessionRow ?? await currentCommandState();
    const { step, artifact } = await s.submitExplorationSchema(runId, o.step, { text: await inputText(o), dependsOn: o.dependsOn });
    const warnings = [];
    try { await releaseCommandTarget(previous, config.project!.name, runId, { step: step.id }); }
    catch { warnings.push(`Artifact saved. Use run enter --run ${runId} to restore the Run context.`); }
    result = { runId, stepId: step.id, artifactId: artifact.id, artifactStatus: artifact.status, stepStatus: step.status, ...(warnings.length ? { warnings } : {}) };
  } else if (operation === "report") {
    let window: CommandStateRow | undefined;
    try {
      if (o.sessionStateId) window = await requireCommandState(o.sessionStateId);
      else window = await currentCommandState();
    } catch { /* Auxiliary window never blocks submission. */ }
    let r: Awaited<ReturnType<typeof s.report>>;
    try { r = await s.report(runId, await reportInput(o)); }
    catch (error) {
      const details = (error as { details?: { artifactId?: string; stepId?: string; recoveryCommand?: string } }).details;
      if (error instanceof Error && details?.artifactId) {
        details.recoveryCommand = `memsphere --project ${config.project!.name} run status --run ${runId}`;
        error.message += `. Artifact ${details.artifactId} (Step ${details.stepId}) was saved. Recover with: ${details.recoveryCommand}. Repeating report creates a new Artifact.`;
      }
      throw error;
    }
    const warnings: string[] = [];
    if (window) {
      r.candidates = [...new Set([...Object.keys(window.value.state.reads ?? {}), ...(window.value.state.lastArtifactId ? [`artifact:${window.value.state.lastArtifactId}`] : [])])].filter(key => !r.artifact.dependencies.some(ref => `${ref.kind}:${ref.id}` === key));
      try { if (Object.keys(window.value.state.reads ?? {}).length) await s.productionReads(runId, r.step.id, window.value.state.reads); }
      catch { warnings.push("Artifact saved; auxiliary Step reads were not recorded"); }
      try { await updateCommandState(window, { ...window.value, state: { lastArtifactId: r.artifact.id, reads: {} } }); }
      catch { warnings.push("Artifact saved; auxiliary reading window was not advanced"); }
    }
    if (r.candidates.length) warnings.push("Some previous/read materials are not declared dependencies; review candidates if relevant");
    result = { runId, artifactId: r.artifact.id, stepId: r.step.id, artifactStatus: r.artifact.status, stepStatus: r.step.status, tags: r.artifact.tags, candidates: r.candidates, ...(warnings.length ? { warnings } : {}) };
  } else if (operation === "status" || operation === "show") {
    const snapshot = await (operation === "show" ? s.inspect(runId) : s.snapshot(runId));
    snapshot.reviews = snapshot.reviews.map(review => {
      if (!review.exploration) return review;
      const { permissions: _permissions, ...exploration } = review.exploration;
      return { ...review, exploration } as typeof review;
    });
    const commandStates = await findCommandStates(config.project!.name, runId); result = o.root !== undefined ? scopedSnapshot(snapshot, [requireOption(o.root, "--root")]) : { ...snapshot, commandStates: commandStates.map(r => ({ sessionId: r.value.sessionId, status: r.value.status })) };
  } else if (operation === "artifact-show" || operation === "external-show") {
    const ref = operation === "artifact-show" ? { kind: "artifact" as const, id: requireOption(typeof o.artifact === "string" ? o.artifact : undefined, "--artifact") } : { kind: "external" as const, id: requireOption(o.external, "--external") };
    const body = ref.kind === "artifact" ? await s.readArtifact(runId, ref.id) : await s.readExternal(runId, ref.id);
    if (o.for !== undefined) throw failure("INVALID_ARGUMENT", "--for is not supported");
    const shellQuote = (v: string) => "'" + v.replaceAll("'", "'\\''") + "'";
    const exportCommand = `memsphere --project ${shellQuote(config.project!.name)} run ${ref.kind} show --run ${shellQuote(runId)} --${ref.kind} ${shellQuote(ref.id)} --out <file>`;
    const text = /^(text\/|application\/(?:json|yaml|x-yaml|xml|javascript))/.test(body.contentType);
    const chars = text ? Array.from(Buffer.from(body.bytes).toString("utf8")) : [];
    const truncated = chars.length > 200;
    const content = text ? chars.slice(0, 200).join("") + (truncated ? "..." : "") : undefined;
    if (o.out !== undefined) await writeFile(requireOption(o.out, "--out"), body.bytes, { flag: "wx" });
    if (o.output === "json") emitCommandResult({ runId, id: ref.id, contentType: body.contentType, ...(o.out ? { out: o.out } : { ...(content !== undefined ? { content } : {}), truncated, ...((truncated || !text) ? { exportCommand } : {}) }) }, "json");
    else if (!o.out) {
      if (content !== undefined) await new Promise<void>((resolve, reject) => process.stdout.write(content, error => error ? reject(error) : resolve()));
      if (truncated || !text) console.error(`\n${text ? "Content truncated at 200 chars." : `Content type: ${body.contentType}.`} Export full content: ${exportCommand}`);
    }
    await accountRead(config.project!.name, runId, `${ref.kind}:${ref.id}`);
    return true;
  } else if (operation === "artifact-create") {
    throw failure("INVALID_ARGUMENT", "Prepare the content and report it directly; artifact create is not supported");
  } else if (operation === "artifact-tag") result = await s.tag(runId, requireOption(typeof o.artifact === "string" ? o.artifact : undefined, "--artifact"), o.tag ?? []);
  else if (operation === "artifact-impact") result = { runId, artifactIds: downstream(await s.snapshot(runId), requireOption(typeof o.artifact === "string" ? o.artifact : undefined, "--artifact")) };
  else if (operation === "external-add") {
    if (o.change !== undefined || o.checkpoint !== undefined) {
      if (!o.change || !o.checkpoint || [o.file, o.source, o.content, o.contentType].some(v => v !== undefined)) throw failure("INVALID_ARGUMENT", "Use --change C --checkpoint D or source/content/file");
      const { captureMemoryChange } = await import("./memory-change-show.js");
      const captured = await captureMemoryChange(o.change, o.checkpoint);
      const external = await s.addExternal(runId, `memsphere:changeset:${o.change}@${o.checkpoint}`, { content: textContent(JSON.stringify(captured), "application/json") });
      emitCommandResult({ runId, externalId: external.id, source: external.source, checkpointDigest: o.checkpoint }, o.output);
      return true;
    }
    if (o.file && (o.source !== undefined || o.content !== undefined || o.contentType !== undefined)) throw failure("INVALID_ARGUMENT", "Use file or source/content");
    const input = o.file ? strictObject(JSON.parse(await readFile(o.file, "utf8")), ["source", "content", "contentRef"]) : { source: o.source, content: textContent(requireOption(o.content, "--content"), o.contentType) };
    const external = await s.addExternal(runId, requireOption(input.source as string, "--source"), input as Body); result = { runId, externalId: external.id };
  } else if (operation === "review-create") {
    if (o.commentFile && o.comment?.length) throw failure("INVALID_ARGUMENT", "Use --comment or --comment-file");
    const comments = o.commentFile ? [await readFile(o.commentFile, "utf8")] : o.comment ?? [];
    if (o.reviewer !== "human" && o.reviewer !== "agent") throw failure("INVALID_ARGUMENT", "Light feedback requires --reviewer human or agent");
    result = await s.review(runId, requireOption(typeof o.artifact === "string" ? o.artifact : undefined, "--artifact"), o.reviewer, comments);
  } else if (operation === "outputs-list" || operation === "outputs-update") {
    if (operation === "outputs-update") await s.updateOutputs(runId, o.add ?? [], o.remove ?? []);
    const snapshot = await s.snapshot(runId);
    result = { runId, items: snapshot.outputArtifactIds.map(id => { const a = snapshot.artifacts.find(a => a.id === id)!; return { id: a.id, name: a.name, status: a.status }; }) };
  } else if (operation === "review-start") {
    const expected = { row: o.sessionRow ?? await currentCommandState() };
    await assertSessionTarget(config.project!.name, runId);
    const repository = new ExplorationReviews(s);
    const review = await repository.start(config, runId, requireOption(typeof o.artifact === "string" ? o.artifact : undefined, "--artifact"));
    const view = await explorationReviewView(repository, runId, review);
    const warnings: string[] = [];
    try { await createCommandState(config.project!.name, runId, undefined, view.reviewId, expected); }
    catch { warnings.push(`Review saved. Re-enter with: memsphere run enter --run ${runId} --review ${view.reviewId}`); }
    if (review.attempts) {
      try {
        const { run } = await readArtifactReviewForRunner({ runsRoot: config.runsRoot, reviewId: view.reviewId });
        await dispatchArtifactReviewAgents({ config, run });
      } catch (error) { warnings.push(`Review saved. Resume dispatch with run review wait --review ${view.reviewId}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    result = { ...view, ...(warnings.length ? { warnings } : {}) };
  } else if (operation === "review-list" || operation === "review-show") {
    const repository = new ExplorationReviews(s);
    if (operation === "review-list") {
      const artifact = requireOption(typeof o.artifact === "string" ? o.artifact : undefined, "--artifact");
      result = o.progressive ? await Promise.all((await repository.list(runId, artifact)).map(r => explorationReviewView(repository, runId, r))) : (await s.inspect(runId)).reviews.filter(r => !r.exploration && r.artifactId === artifact);
    } else {
      const review = requireOption(o.review, "--review"), identity = explorationReviewIdentity(review);
      if (identity) {
        if (identity.runId !== runId) throw failure("INVALID_ARGUMENT", "Review does not belong to this Run");
        if (o.node && o.all) throw failure("INVALID_ARGUMENT", "Choose --node or --all");
        const { row, permissions } = await repository.locate(runId, identity.recordId);
        if (!permissions.runner.permissions.includes("artifact.read")) throw failure("PERMISSION_DENIED", "Runner requires artifact.read");
        result = await explorationReviewView(repository, runId, row.value, { nodeId: o.node, all: o.all });
      } else {
        if (o.node || o.all) throw failure("INVALID_ARGUMENT", "Node selection requires a progressive Review");
        result = (await s.inspect(runId)).reviews.find(r => !r.exploration && r.id === review);
        if (!result) throw failure("NOT_FOUND", "Review not found");
      }
    }
  } else if (operation === "finish") {
    if (!isGraphRun(run) && !o.authorization?.trim()) throw failure("HUMAN_CONFIRMATION_REQUIRED", "Finishing free exploration requires explicit Human confirmation of the current outputs. Keep the Run open for feedback and revision; after confirmation, provide --authorization recording the Human's decision. An Agent's own conclusion is not authorization.");
    result = await s.finish(runId, Array.isArray(o.artifact) ? o.artifact : o.artifact ? [o.artifact] : undefined);
  } else if (operation === "abandon") {
    if (o.reason !== undefined && o.reasonFile) throw failure("INVALID_ARGUMENT", "Use reason or reason-file");
    result = await s.abandon(runId, o.reasonFile ? await readFile(o.reasonFile, "utf8") : o.reason);
  } else throw failure("INVALID_ARGUMENT", `Unknown context control operation: ${operation}`);
  if (operation === "finish" || operation === "abandon") {
    const warnings = await closeRunCommandStates(config.project!.name, runId, config.homeRoot);
    if (warnings.length) result = { ...(result as object), warnings };
  }
  emitCommandResult(result, o.output); return true;
}

export async function contextOnlyCommand(operation: string, options: object) {
  if (!await tryContextCommand(operation, options)) throw failure("NOT_FOUND", "Free exploration Run not found");
}
export async function startExploration(options: object) {
  const o = options as Options;
  if (o.change || o.reviewConfig) throw failure("INVALID_ARGUMENT", "Free exploration does not use change/review-config");
  const config = await readConfig(); await openCommandStates(true);
  const s = (await openContextControl(config.scopeRoot, true))!;
  const run = await s.start(requireOption(o.name, "--name"), config.language);
  try {
    const context = await createCommandState(config.project!.name, run.id);
    emitCommandResult({ ...run, ...(context ? { sessionId: context.sessionId } : {}), nextCommand: context ? "memsphere continue --help" : `memsphere run show --run ${run.id}` }, o.output);
  } catch (error) {
    if (error instanceof Error) error.message += `. Run ${run.id} was created; query memsphere --project ${config.project!.name} run status --run ${run.id}. This failed receipt does not confirm a usable session binding.`;
    throw Object.assign(error as object, { details: { runId: run.id, message: "Run was created; CommandState creation failed. Query run status with this runId." } });
  }
}

export function registerExplorationCommands(run: import("commander").Command) {
  const find = (parent: import("commander").Command, name: string) => parent.commands.find(c => c.name() === name)!;
  const output = (c: import("commander").Command) => { if (!c.options.some(o => o.long === "--output")) c.addOption(new Option("--output <format>", "text or json").choices(["text", "json"]).default("text")); return c; };
  const repeated = (value: string, previous: string[] = []) => [...previous, value];
  const scoped = (c: import("commander").Command) => output(c.requiredOption("--run <id>"));
  scoped(find(run, "step").command("configure").description("Configure a free exploration Step's review rules and reviewer."))
    .requiredOption("--step <id>").option("--asserts <reference>", "Replace the required Statement references; repeat for multiple", repeated)
    .option("--suggests <reference>", "Replace the advisory Statement references; repeat for multiple", repeated).option("--reviewer <value>", "runner or project:ID")
    .option("--clear-asserts").option("--clear-suggests").option("--clear-reviewer").action(o => contextOnlyCommand("step-configure", o));
  output(find(run, "start"));
  scoped(run.command("enter").description("Bind this Agent session to an existing free exploration Run or Review.")).option("--review <id>").action(o => contextOnlyCommand("enter", o));
  output(find(run, "report"))
    .option("--name <name>", "free exploration Artifact name")
    .option("--file <path>", "structured Artifact report; graph accepts content/contentRef and supplemental dependencies; exclusive with --artifact/--artifact-file")
    .option("--content-type <mime>", "free exploration text content type")
    .option("--revised-from <id>", "free exploration Artifact ID being revised")
    .option("--depends-on <selector>", "artifact:ID, external:ID or tag:NAME", repeated)
    .option("--tag <tag>", "Run-scoped Artifact tag", repeated);
  output(find(run, "status")); output(find(run, "abandon")); find(run, "show").option("--root <id>");
  const artifact = find(run, "artifact");
  find(artifact, "show").option("--artifact <id>").option("--out <path>", "Exclusive body output file");
  scoped(artifact.command("tag").description("Add tags to a free exploration Artifact.").requiredOption("--artifact <id>").option("--tag <tag>", "Tag", repeated))
    .action(o => contextOnlyCommand("artifact-tag", o));
  scoped(artifact.command("impact").description("Show free exploration Artifact dependents and output impact.").requiredOption("--artifact <id>"))
    .action(o => contextOnlyCommand("artifact-impact", o));
  const outputs = run.command("outputs").description("Inspect or adjust free exploration output roots.");
  scoped(outputs.command("list").description("List current free exploration output roots.")).action(o => contextOnlyCommand("outputs-list", o));
  scoped(outputs.command("update").description("Add or remove free exploration output roots.").option("--add <id>", "Add an output", repeated).option("--remove <id>", "Remove an output", repeated)).action(o => contextOnlyCommand("outputs-update", o));
  const external = run.command("external").description("Record or read fixed Run source material.");
  scoped(external.command("add").description("Add source material; use --source/--content or structured --file.").option("--source <text>").option("--content <text>").option("--content-type <mime>").option("--file <path>").option("--change <id>", "Capture a validated ChangeSet as fixed External evidence").option("--checkpoint <digest>"))
    .action(o => contextOnlyCommand("external-add", o));
  scoped(external.command("show").description("Preview an External; --out writes its complete original content.").requiredOption("--external <id>").option("--out <path>", "Write original content to a new file"))
    .action(o => contextOnlyCommand("external-show", o));
  const review = find(run, "review");
  scoped(review.command("start").description("Start a progressive Review of a submitted free exploration Artifact.").requiredOption("--artifact <id>"))
    .action(o => contextOnlyCommand("review-start", o));
  scoped(review.command("create").description("Record light feedback on a free exploration Artifact; no formal gate.").requiredOption("--artifact <id>").requiredOption("--reviewer <source>", "human or agent")
    .option("--comment <text>", "Comment, repeatable", repeated).option("--comment-file <path>"))
    .action(o => contextOnlyCommand("review-create", o));
  scoped(review.command("list").description("List light feedback or progressive Review history for an Artifact.").requiredOption("--artifact <id>").option("--progressive"))
    .action(o => contextOnlyCommand("review-list", o));
  scoped(review.command("show").description("Show one free exploration Review.").requiredOption("--review <id>"))
    .action(o => contextOnlyCommand("review-show", o));
  scoped(run.command("finish").description("Finish a graph Procedure, or finish free exploration after Human confirmation.").option("--artifact <id>", "Final Artifact, repeatable", repeated)
    .option("--authorization <text>", "State the Human's explicit confirmation for free exploration"))
    .action(o => contextOnlyCommand("finish", o));
}

export async function contextRunList(options: object): Promise<boolean> {
  const o = options as Options; const config = await readConfig(); const service = await openContextControl(config.scopeRoot);
  if (!service) return false;
  const [legacy, archived, current] = await Promise.all([listRuns(config.runsRoot), listRuns(join(config.archiveRoot, "runs")), service.listRunEntries()]);
  if (current.some(entry => [...legacy, ...archived].some(old => old.id === entry.id))) throw failure("AMBIGUOUS_RUN", "Run ID exists in both storage sources");
  const runs = [...legacy.map(r => ({ id: r.id, name: r.name, status: r.status, createdAt: r.createdAt, source: "flow" })), ...current.filter(e => !e.run?.archived).map(e => ({ ...(e.run ?? { id: e.id, name: e.id, status: "unavailable", createdAt: "" }), ...(e.error ? { error: e.error } : {}), source: "context-control" }))].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (o.output === "json") emitCommandResult({ runs }, "json");
  else for (const run of runs) console.log(`${run.id} ${run.status} ${run.name ?? ""}`);
  return true;
}
