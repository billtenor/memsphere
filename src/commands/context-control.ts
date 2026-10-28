import { closeRunCommandStates, openCommandStates, createCommandState, findCommandStates, requireCommandState, updateCommandState, accountRead, type CommandStateRow } from "../home/command-state-store.js";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { Option } from "commander";
import { readConfig } from "../config.js";
import { readRun, listRuns } from "../run/store.js";
import { openContextControl } from "../project/context-control.js";
import { failure } from "../context_control/service.js";
import { textContent, type Body, type ReportInput } from "../context_control/types.js";
import { downstream, scopedSnapshot } from "../context_control/graph.js";
import { emitCommandResult } from "./cli-errors.js";
import { graphCommand } from "./procedure-graph.js";
import { isGraphRun } from "../context_control/graph-runtime.js";

export type Options = { authorization?: string; contextId?: string; add?: string[]; remove?: string[]; run?: string; name?: string; target?: string; artifact?: string | string[]; artifactFile?: string; file?: string; content?: string; contentType?: string; revisedFrom?: string; tag?: string[]; dependsOn?: string[]; external?: string; review?: string; reviewer?: "human" | "agent"; comment?: string[]; commentFile?: string; source?: string; reason?: string; reasonFile?: string; root?: string; for?: string; out?: string; output?: "text" | "json"; change?: string; reviewConfig?: string; step?: string; assignment?: string; writeOptions?: string; revisionSummary?: string; revisionSummaryFile?: string; actor?: string };
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

/** Return false only for a proven legacy Run, never for a failed new Store. */
export async function tryContextCommand(operation: string, options: object): Promise<boolean> {
  const o = options as Options;
  if (await graphCommand(operation, o)) return true;
  const newFlags = [o.target, o.for, o.out, o.root, o.revisedFrom, o.file].some(v => v !== undefined) || !!o.dependsOn?.length || !!o.tag?.length || operation === "artifact-show" && o.artifact !== undefined;
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
  if (o.step || o.assignment || o.actor) throw failure("INVALID_ARGUMENT", "Legacy identity/step options are not supported here");
  const s = service!; const runId = run.id; let result: unknown;
  if (operation === "report") {
    let window: CommandStateRow | undefined;
    try {
      if (o.contextId) window = await requireCommandState(o.contextId);
      else { const rows = (await findCommandStates(config.project!.name, runId)).filter(r => r.value.status === "active"); if (rows.length === 1) window = rows[0]; }
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
    const snapshot = await s.snapshot(runId); const commandStates = await findCommandStates(config.project!.name, runId); result = o.root !== undefined ? scopedSnapshot(snapshot, [requireOption(o.root, "--root")]) : { ...snapshot, commandStates: commandStates.map(r => ({ contextId: r.value.id, status: r.value.status })) };
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
    if (o.file && (o.source !== undefined || o.content !== undefined || o.contentType !== undefined)) throw failure("INVALID_ARGUMENT", "Use file or source/content");
    const input = o.file ? strictObject(JSON.parse(await readFile(o.file, "utf8")), ["source", "content", "contentRef"]) : { source: o.source, content: textContent(requireOption(o.content, "--content"), o.contentType) };
    const external = await s.addExternal(runId, requireOption(input.source as string, "--source"), input as Body); result = { runId, externalId: external.id };
  } else if (operation === "review-create") {
    if (o.commentFile && o.comment?.length) throw failure("INVALID_ARGUMENT", "Use --comment or --comment-file");
    const comments = o.commentFile ? [await readFile(o.commentFile, "utf8")] : o.comment ?? [];
    result = await s.review(runId, requireOption(typeof o.artifact === "string" ? o.artifact : undefined, "--artifact"), o.reviewer!, comments);
  } else if (operation === "outputs-list" || operation === "outputs-update") {
    if (operation === "outputs-update") await s.updateOutputs(runId, o.add ?? [], o.remove ?? []);
    const snapshot = await s.snapshot(runId);
    result = { runId, items: snapshot.outputArtifactIds.map(id => { const a = snapshot.artifacts.find(a => a.id === id)!; return { id: a.id, name: a.name, status: a.status }; }) };
  } else if (operation === "review-list" || operation === "review-show") {
    const snap = await s.snapshot(runId);
    if (operation === "review-list") result = snap.reviews.filter(r => r.artifactId === requireOption(typeof o.artifact === "string" ? o.artifact : undefined, "--artifact"));
    else { result = snap.reviews.find(r => r.id === requireOption(o.review, "--review")); if (!result) throw failure("NOT_FOUND", "Review not found"); }
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
    emitCommandResult({ ...run, contextId: context.id, nextCommand: `memsphere continue ${context.id} --help` }, o.output);
  } catch (error) {
    if (error instanceof Error) error.message += `. Run ${run.id} was created; query memsphere --project ${config.project!.name} run status --run ${run.id}. No usable contextId is confirmed by this failed receipt.`;
    throw Object.assign(error as object, { details: { runId: run.id, message: "Run was created; CommandState creation failed. Query run status with this runId." } });
  }
}

export function registerExplorationCommands(run: import("commander").Command) {
  const find = (parent: import("commander").Command, name: string) => parent.commands.find(c => c.name() === name)!;
  const output = (c: import("commander").Command) => { if (!c.options.some(o => o.long === "--output")) c.addOption(new Option("--output <format>", "text or json").choices(["text", "json"]).default("text")); return c; };
  const repeated = (value: string, previous: string[] = []) => [...previous, value];
  const scoped = (c: import("commander").Command) => output(c.requiredOption("--run <id>"));
  output(find(run, "start"));
  output(find(run, "report"))
    .option("--name <name>", "free exploration Artifact name")
    .option("--file <path>", "free exploration structured report; exclusive with --artifact/--artifact-file")
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
  const external = run.command("external").description("Record or read free exploration source material.");
  scoped(external.command("add").description("Add source material; use --source/--content or structured --file.").option("--source <text>").option("--content <text>").option("--content-type <mime>").option("--file <path>"))
    .action(o => contextOnlyCommand("external-add", o));
  scoped(external.command("show").description("Preview an External; --out writes its complete original content.").requiredOption("--external <id>").option("--out <path>", "Write original content to a new file"))
    .action(o => contextOnlyCommand("external-show", o));
  const review = find(run, "review");
  scoped(review.command("create").description("Record light feedback on a free exploration Artifact; no formal gate.").requiredOption("--artifact <id>").requiredOption("--reviewer <source>", "human or agent")
    .option("--comment <text>", "Comment, repeatable", repeated).option("--comment-file <path>"))
    .action(o => contextOnlyCommand("review-create", o));
  scoped(review.command("list").description("List light feedback for a free exploration Artifact.").requiredOption("--artifact <id>"))
    .action(o => contextOnlyCommand("review-list", o));
  scoped(review.command("show").description("Show one light free exploration Review.").requiredOption("--review <id>"))
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
