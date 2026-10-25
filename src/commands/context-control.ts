import { readFile, writeFile } from "node:fs/promises";
import { Option } from "commander";
import { readConfig } from "../config.js";
import { readRun, listRuns } from "../run/store.js";
import { openContextControl } from "../project/context-control.js";
import { failure } from "../context_control/service.js";
import { textContent, type Body, type ReportInput } from "../context_control/types.js";
import { downstream, scopedSnapshot } from "../context_control/graph.js";
import { emitCommandResult } from "./cli-errors.js";

type Options = { run?: string; name?: string; target?: string; artifact?: string | string[]; artifactFile?: string; file?: string; content?: string; contentType?: string; revisedFrom?: string; tag?: string[]; dependsOn?: string[]; external?: string; review?: string; reviewer?: "human" | "agent"; comment?: string[]; commentFile?: string; source?: string; reason?: string; reasonFile?: string; root?: string; for?: string; out?: string; output?: "text" | "json"; change?: string; reviewConfig?: string; step?: string; assignment?: string; writeOptions?: string; revisionSummary?: string; revisionSummaryFile?: string; actor?: string };
const requireOption = (value: string | undefined, name: string) => { if (!value?.trim()) throw failure("INVALID_ARGUMENT", `${name} is required`); return value; };
function strictObject(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("INVALID_ARGUMENT", "Expected an object");
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw failure("INVALID_ARGUMENT", `Unknown/system field: ${key}`);
  return value as Record<string, unknown>;
}
async function reportInput(o: Options): Promise<ReportInput> {
  if (o.target !== undefined) requireOption(o.target, "--target");
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
    const r = await s.report(runId, await reportInput(o));
    result = { runId, artifactId: r.artifact.id, stepId: r.step.id, artifactStatus: r.artifact.status, stepStatus: r.step.status, tags: r.artifact.tags, candidates: r.candidates };
  } else if (operation === "status" || operation === "show") {
    const snapshot = await s.snapshot(runId); result = o.root !== undefined ? scopedSnapshot(snapshot, [requireOption(o.root, "--root")]) : snapshot;
  } else if (operation === "artifact-show" || operation === "external-show") {
    const ref = operation === "artifact-show" ? { kind: "artifact" as const, id: requireOption(typeof o.artifact === "string" ? o.artifact : undefined, "--artifact") } : { kind: "external" as const, id: requireOption(o.external, "--external") };
    const body = ref.kind === "artifact" ? await s.readArtifact(runId, ref.id) : await s.readExternal(runId, ref.id);
    if (o.out !== undefined) await writeFile(requireOption(o.out, "--out"), body.bytes, { flag: "wx" });
    else if (o.output !== "json") await new Promise<void>((resolve, reject) => process.stdout.write(body.bytes, error => error ? reject(error) : resolve()));
    const warnings = o.for !== undefined ? await s.recordRead(runId, o.for, ref) : [];
    if (o.output === "json") emitCommandResult({ runId, id: ref.id, contentType: body.contentType, ...(o.out ? { out: o.out } : { content: Buffer.from(body.bytes).toString("utf8") }), ...(warnings.length ? { warnings } : {}) }, "json");
    else warnings.forEach(w => console.error(w));
    return true;
  } else if (operation === "artifact-create") {
    const a = await s.createArtifact(runId, { name: o.name, revisedFrom: o.revisedFrom, tags: o.tag }); result = { runId, artifactId: a.id, stepId: a.stepId, status: a.status, name: a.name, tags: a.tags };
  } else if (operation === "artifact-tag") result = await s.tag(runId, requireOption(typeof o.artifact === "string" ? o.artifact : undefined, "--artifact"), o.tag ?? []);
  else if (operation === "artifact-impact") result = { runId, artifactIds: downstream(await s.snapshot(runId), requireOption(typeof o.artifact === "string" ? o.artifact : undefined, "--artifact")) };
  else if (operation === "external-add") {
    if (o.file && (o.source !== undefined || o.content !== undefined || o.contentType !== undefined)) throw failure("INVALID_ARGUMENT", "Use file or source/content");
    const input = o.file ? strictObject(JSON.parse(await readFile(o.file, "utf8")), ["source", "content", "contentRef"]) : { source: o.source, content: textContent(requireOption(o.content, "--content"), o.contentType) };
    result = await s.addExternal(runId, requireOption(input.source as string, "--source"), input as Body);
  } else if (operation === "review-create") {
    if (o.commentFile && o.comment?.length) throw failure("INVALID_ARGUMENT", "Use --comment or --comment-file");
    const comments = o.commentFile ? [await readFile(o.commentFile, "utf8")] : o.comment ?? [];
    result = await s.review(runId, requireOption(typeof o.artifact === "string" ? o.artifact : undefined, "--artifact"), o.reviewer!, comments);
  } else if (operation === "review-list" || operation === "review-show") {
    const snap = await s.snapshot(runId);
    if (operation === "review-list") result = snap.reviews.filter(r => r.artifactId === requireOption(typeof o.artifact === "string" ? o.artifact : undefined, "--artifact"));
    else { result = snap.reviews.find(r => r.id === requireOption(o.review, "--review")); if (!result) throw failure("NOT_FOUND", "Review not found"); }
  } else if (operation === "finish") result = await s.finish(runId, Array.isArray(o.artifact) ? o.artifact : o.artifact ? [o.artifact] : []);
  else if (operation === "abandon") {
    if (o.reason !== undefined && o.reasonFile) throw failure("INVALID_ARGUMENT", "Use reason or reason-file");
    result = await s.abandon(runId, o.reasonFile ? await readFile(o.reasonFile, "utf8") : o.reason);
  } else throw failure("INVALID_ARGUMENT", `Unknown context control operation: ${operation}`);
  emitCommandResult(result, o.output); return true;
}

export async function contextOnlyCommand(operation: string, options: object) {
  if (!await tryContextCommand(operation, options)) throw failure("NOT_FOUND", "Free exploration Run not found");
}
export async function startExploration(options: object) {
  const o = options as Options;
  if (o.change || o.reviewConfig) throw failure("INVALID_ARGUMENT", "Free exploration does not use change/review-config");
  const config = await readConfig(); const s = (await openContextControl(config.scopeRoot, true))!;
  emitCommandResult(await s.start(requireOption(o.name, "--name"), config.language), o.output);
}

export function registerExplorationCommands(run: import("commander").Command) {
  const find = (parent: import("commander").Command, name: string) => parent.commands.find(c => c.name() === name)!;
  const output = (c: import("commander").Command) => { if (!c.options.some(o => o.long === "--output")) c.addOption(new Option("--output <format>", "text or json").choices(["text", "json"]).default("text")); return c; };
  const repeated = (value: string, previous: string[] = []) => [...previous, value];
  const scoped = (c: import("commander").Command) => output(c.requiredOption("--run <id>"));
  output(find(run, "start"));
  output(find(run, "report")).option("--target <id>", "Draft Artifact to submit")
    .option("--name <name>").option("--file <path>", "Structured report input")
    .option("--content-type <mime>").option("--revised-from <id>")
    .option("--depends-on <selector>", "artifact:ID, external:ID or tag:NAME", repeated)
    .option("--tag <tag>", "Run-scoped Artifact tag", repeated);
  output(find(run, "status")); output(find(run, "abandon")); find(run, "show").option("--root <id>");
  const artifact = find(run, "artifact");
  find(artifact, "show").option("--artifact <id>").option("--for <id>", "Producing target Artifact").option("--out <path>", "Exclusive body output file");
  scoped(artifact.command("create").option("--name <name>").option("--revised-from <id>").option("--tag <tag>", "Tag", repeated))
    .action(o => contextOnlyCommand("artifact-create", o));
  scoped(artifact.command("tag").requiredOption("--artifact <id>").option("--tag <tag>", "Tag", repeated))
    .action(o => contextOnlyCommand("artifact-tag", o));
  scoped(artifact.command("impact").requiredOption("--artifact <id>"))
    .action(o => contextOnlyCommand("artifact-impact", o));
  const external = run.command("external");
  scoped(external.command("add").option("--source <text>").option("--content <text>").option("--content-type <mime>").option("--file <path>"))
    .action(o => contextOnlyCommand("external-add", o));
  scoped(external.command("show").requiredOption("--external <id>").option("--for <id>").option("--out <path>", "Write original content to a new file"))
    .action(o => contextOnlyCommand("external-show", o));
  const review = find(run, "review");
  scoped(review.command("create").requiredOption("--artifact <id>").requiredOption("--reviewer <source>", "human or agent")
    .option("--comment <text>", "Comment, repeatable", repeated).option("--comment-file <path>"))
    .action(o => contextOnlyCommand("review-create", o));
  scoped(review.command("list").requiredOption("--artifact <id>"))
    .action(o => contextOnlyCommand("review-list", o));
  scoped(review.command("show").requiredOption("--review <id>"))
    .action(o => contextOnlyCommand("review-show", o));
  scoped(run.command("finish").option("--artifact <id>", "Final Artifact, repeatable", repeated))
    .action(o => contextOnlyCommand("finish", o));
}

export async function contextRunList(options: object): Promise<boolean> {
  const o = options as Options; const config = await readConfig(); const service = await openContextControl(config.scopeRoot);
  if (!service) return false;
  const [legacy, current] = await Promise.all([listRuns(config.runsRoot), service.listRuns()]);
  if (current.some(run => legacy.some(old => old.id === run.id))) throw failure("AMBIGUOUS_RUN", "Run ID exists in both storage sources");
  const runs = [...legacy.map(r => ({ id: r.id, name: r.name, status: r.status, createdAt: r.createdAt, source: "flow" })), ...current.map(r => ({ ...r, source: "context-control" }))].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (o.output === "json") emitCommandResult({ runs }, "json");
  else for (const run of runs) console.log(`${run.id} ${run.status} ${run.name ?? ""}`);
  return true;
}
