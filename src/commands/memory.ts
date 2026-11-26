import { readMemorySyntax } from "../memory/syntax.js";
import { writeCliChunk } from "../cli-transport.js";
import { z } from "zod";
import { cliCommand, cliPageBudget, publishResult, previewText, renderCommandResult, validateCommandResult } from "./output.js";
import { nextAction } from "../prompts/cli-output.js";
import { memoryDiagnostic, summarizeMemoryIssues } from "./validate.js";
import type { MemoryCatalog, MemoryDescriptor } from "../memory/catalog.js";
import type { RulePart, StatementNode } from "../memory/ast.js";
import { join } from "node:path";
import { createMemoryCatalog, createMemoryCatalogForConfig } from "../memory/factory.js";
import { isMemoryKind, memoryKinds, type MemoryKind } from "../memory/kinds.js";
import {
  serializeMemoryJson,
  serializeEffectiveMemoryReadJson,
  serializeEffectiveMemoryReadYaml,
  serializeMemoryNodeReadJson,
  serializeMemoryNodeReadYaml,
  serializeMemoryYaml,
  toEffectiveRuleDisplayTree
} from "../memory/serializer.js";
import { resolveRuleParts } from "../memory/rules.js";
import { MemoryNavigation, type MemoryIdentity, type MemoryNodeDescriptor } from "../memory/navigation.js";
import {
  claimMemoryChange,
  completeMemoryChange,
  editEmbeddedMemories,
  editMemories,
  finishMemoryChange,
  publishMemoryChange,
  pushMemory,
  recoverMemory,
  renameMemory,
  resumeMemoryChange,
  syncMemory,
  validateMemoryChange
} from "../memory/changeset.js";
import { resolveProjectContext } from "../project/resolver.js";
import { readConfig } from "../config.js";
import { RunMemoryProvider } from "../memory/run-provider.js";
import { readRun } from "../run/store.js";
import { getViewServiceStatus, viewServiceUrl } from "../view/service.js";
import { parseListLimit, type PaginationOptions } from "../pagination.js";

const memoryIdentity = z.object({ reference: z.string(), kind: z.enum(memoryKinds), names: z.array(z.string()).max(10) }).strict();
const memoryPage = z.object({
  items: z.array(memoryIdentity.extend({
    summary: z.string().optional(), project_name: z.string().optional(), revision: z.string().optional(),
    app: z.object({ id: z.string(), version: z.string(), assetKey: z.string(), enabled: z.boolean() }).strict().optional()
  }).strict()),
  nextCursor: z.string().optional()
}).strict();
const memoryNodePage = z.object({
  memory: memoryIdentity,
  parent_node_ref: z.string().optional(),
  items: z.array(z.object({
    node_ref: z.string(), type: z.string(), name: z.string().optional(), field: z.string().optional(),
    artifact: z.string().optional(), condition_artifact: z.string().optional(), target: z.string().optional(),
    summary: z.string().optional(), relation: z.string().optional(), has_children: z.boolean()
  }).strict()),
  nextCursor: z.string().optional()
}).strict();
const changeReceipt = z.object({
  status: z.enum(["ready", "applied", "published", "claimed", "completed", "restored", "pushed", "synchronized"]),
  changeId: z.string().optional(),
  storeType: z.enum(["managed", "embedded"]).optional(),
  candidateRoot: z.string().optional(),
  reference: z.string().optional(),
  revision: z.string().optional(),
  targets: z.array(z.object({
    reference: z.string(), path: z.string(), operation: z.enum(["create", "update"])
  }).strict()).optional(),
  commentCount: z.number().int().nonnegative().optional(),
  warningCount: z.number().int().nonnegative().optional(),
  nextAction
}).strict();
const changeValidation = z.object({
  valid: z.boolean(),
  changeId: z.string(),
  storeType: z.enum(["managed", "embedded"]),
  baseRevision: z.string(),
  checkpointDigest: z.string(),
  completedChangeIds: z.array(z.string()).max(20),
  completedChangeCount: z.number().int().nonnegative(),
  issueCount: z.number().int().nonnegative(),
  issues: z.array(memoryDiagnostic).max(10),
  empty: z.boolean(),
  previewPath: z.string(),
  previewUrl: z.string().optional(),
  nextAction
}).strict();

const listOutputs = ["yaml", "json", "text"] as const;
const readOutputs = ["yaml", "json"] as const;

type ListOutput = (typeof listOutputs)[number];
type ReadOutput = (typeof readOutputs)[number];

export type MemoryListCommandOptions = PaginationOptions & {
  kind?: string;
  query?: string;
  node?: string;
  output?: string;
  run?: string;
};

export type MemoryReadCommandOptions = {
  kind?: string;
  node?: string;
  output?: string;
  run?: string;
  effective?: boolean;
};

export type MemoryCommandDependencies = {
  createCatalog: (runId?: string) => Promise<MemoryCatalog>;
  writeStdout: (value: string) => void;
};

const defaultDependencies: MemoryCommandDependencies = {
  createCatalog: createMemoryCommandCatalog,
  writeStdout: writeCliChunk
};

export async function memoryListCommand(
  reference: string | undefined,
  options: MemoryListCommandOptions,
  dependencies: MemoryCommandDependencies = defaultDependencies
): Promise<void> {
  const kind = parseKind(options.kind);
  const output = parseOutput(options.output ?? "text", listOutputs, "memory list");
  parseListLimit(options.limit);
  const limit = options.limit;
  if (!reference && options.node !== undefined) {
    throw new TypeError("memory list --node requires a memory reference");
  }
  if (reference && options.query !== undefined) {
    throw new TypeError("memory list --query cannot be used with a memory reference");
  }
  const catalog = await dependencies.createCatalog(options.run);
  if (reference) {
    const descriptor = await catalog.resolve(reference, { kind });
    const entity = await catalog.read(descriptor.reference, { kind: descriptor.kind });
    const navigation = new MemoryNavigation(toIdentity(descriptor), entity);
    const page = navigation.listChildren(options.node, { limit, cursor: options.cursor }, {
      catalog: catalog.paginationScope ?? null,
      project: descriptor.project_name,
      run: options.run,
      kind
    }, cliPageBudget("established", summarizeMemoryNode));
    await dependencies.writeStdout(renderCommandResult("memory list", memoryNodePage.parse({
      memory: summarizeMemoryIdentity(page.memory),
      parent_node_ref: page.parent_node_ref,
      items: page.items.map(summarizeMemoryNode),
      nextCursor: page.nextCursor
    }), { format: output }));
    return;
  }
  const page = await catalog.list({ kind, query: options.query, limit, cursor: options.cursor }, cliPageBudget("established", summarizeMemory));
  await dependencies.writeStdout(renderCommandResult("memory list", memoryPage.parse({
    items: page.items.map(summarizeMemory),
    nextCursor: page.nextCursor
  }), { format: output }));
}

function summarizeMemoryNode({ summary, name, field, artifact, condition_artifact, target, type, relation, node_ref, has_children }: MemoryNodeDescriptor) {
  const label = (value?: string) => value === undefined ? undefined : previewText(value, 160).text;
  return { node_ref, type, name: label(name), field: label(field), artifact: label(artifact),
    condition_artifact: label(condition_artifact), target, relation, has_children,
    summary: summary === undefined ? undefined : previewText(summary, 256).text };
}

function summarizeMemory(item: MemoryDescriptor) {
  return { ...summarizeMemoryIdentity(item),
    summary: item.defines.length > 0 ? previewText(item.defines[0], 256).text : undefined,
    project_name: item.project_name, revision: item.revision,
    app: item.app ? { id: item.app.id, version: item.app.version, assetKey: item.app.assetKey, enabled: item.app.enabled } : undefined
  };
}

function summarizeMemoryIdentity(memory: MemoryIdentity) {
  return {
    reference: memory.reference,
    kind: memory.kind,
    names: memory.names.slice(0, 10).map(name => previewText(name, 160).text)
  };
}

export async function memoryReadCommand(
  reference: string,
  options: MemoryReadCommandOptions,
  dependencies: MemoryCommandDependencies = defaultDependencies
): Promise<void> {
  const kind = parseKind(options.kind);
  const output = parseOutput(options.output ?? "yaml", readOutputs, "memory read");
  const catalog = await dependencies.createCatalog(options.run);
  if (options.node !== undefined) {
    const descriptor = await catalog.resolve(reference, { kind });
    const entity = await catalog.read(descriptor.reference, { kind: descriptor.kind });
    const result = new MemoryNavigation(toIdentity(descriptor), entity).readNode(options.node);
    const effective = options.effective ? await resolveEffectiveRules(result.fragment, catalog) : undefined;
    validateCommandResult("memory read", options.effective ? { declared: result, effective } : result);
    const value = options.effective
      ? output === "json"
        ? serializeEffectiveMemoryReadJson({ declared: result, effective })
        : serializeEffectiveMemoryReadYaml({ declared: result, effective })
      : output === "json" ? serializeMemoryNodeReadJson(result) : serializeMemoryNodeReadYaml(result);
    await dependencies.writeStdout(value);
    return;
  }
  const declared = await catalog.read(reference, { kind });
  const entity = { ...declared, syntax: readMemorySyntax(declared) };
  const effective = options.effective ? await resolveEffectiveRules(entity, catalog) : undefined;
  validateCommandResult("memory read", options.effective ? { declared: entity, effective } : entity);
  const value = options.effective
    ? output === "json"
      ? serializeEffectiveMemoryReadJson({ declared: entity, effective })
      : serializeEffectiveMemoryReadYaml({ declared: entity, effective })
    : output === "json" ? serializeMemoryJson(entity) : serializeMemoryYaml(entity);
  await dependencies.writeStdout(value);
}

async function resolveEffectiveRules(value: unknown, catalog: MemoryCatalog): Promise<Record<string, unknown>> {
  const lookup = async (target: string): Promise<StatementNode> => {
    const statement = await catalog.read(target, { kind: "statements" });
    if (statement.tag !== "!statement") throw new Error(`Memory ${target} is not a Statement`);
    return statement;
  };
  return (await resolveEffectiveRuleLocations(value, lookup)) ?? {};
}

async function resolveEffectiveRuleLocations(
  value: unknown,
  lookup: (target: string) => Promise<StatementNode>
): Promise<Record<string, unknown> | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown> & { asserts?: RulePart[]; suggests?: RulePart[] };
  const effectiveRules = {
    ...(source.asserts
      ? toEffectiveRuleDisplayTree(await resolveRuleParts("asserts", source.asserts, lookup))
      : {}),
    ...(source.suggests
      ? toEffectiveRuleDisplayTree(await resolveRuleParts("suggests", source.suggests, lookup))
      : {})
  };
  const children: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (["tag", "syntax", "name", "names", "defines", "asserts", "suggests"].includes(key)) continue;
    if (Array.isArray(child)) {
      const resolved = (await Promise.all(child.map((item) => resolveEffectiveRuleLocations(item, lookup))))
        .filter((item): item is Record<string, unknown> => item !== undefined);
      if (resolved.length > 0) children[key] = resolved;
      continue;
    }
    const resolved = await resolveEffectiveRuleLocations(child, lookup);
    if (resolved) children[key] = resolved;
  }
  const identity = {
    ...(typeof source.tag === "string" ? { tag: source.tag } : {}),
    ...(Array.isArray(source.names) && typeof source.names[0] === "string" ? { name: source.names[0] } : {}),
    ...(typeof source.name === "string" ? { name: source.name } : {}),
    ...(typeof source.action === "string" ? { action: source.action } : {})
  };
  if (Object.keys(effectiveRules).length === 0 && Object.keys(children).length === 0) return undefined;
  return {
    ...identity,
    ...(Object.keys(effectiveRules).length > 0 ? { effectiveRules } : {}),
    ...children
  };
}

export async function createMemoryCommandCatalog(runId?: string): Promise<MemoryCatalog> {
  if (!runId) return createMemoryCatalog();
  const config = await readConfig();
  const service = await (await import("../project/context-control.js")).openContextControl(config.scopeRoot);
  const graph = service && await service.findRun(runId);
  if (graph && (await import("../context_control/graph-runtime.js")).isGraphRun(graph)) return (await import("../context_control/memory-provider.js")).graphMemoryCatalog(graph);
  const run = await readRun(config.runsRoot, runId);
  if (!run.memorySource || !run.memorySnapshot) {
    throw new Error(`Run ${runId} does not have a frozen ChangeSet Memory snapshot`);
  }
  const memoryRoot = join(config.runsRoot, run.id, run.memorySnapshot.path);
  const revision = run.memoryProjects?.primary.revision
    ?? `changeset:${run.memorySource.changeId}@${run.memorySource.checkpointDigest}`;
  return createMemoryCatalogForConfig(config, { memoryRoot, revision, runId: run.id, provider: new RunMemoryProvider(config.runsRoot, run) });
}

export async function memoryEditCommand(references: string[], options: { change?: string } = {}): Promise<void> {
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  if (context.primary.config.store.type === "embedded") {
    if (options.change) throw new Error("--change is only available for a Managed Project");
    const result = await editEmbeddedMemories(references);
    publishResult("memory edit", () => changeReceipt.parse({
      status: "ready", storeType: "embedded", targets: result.targets.map(({ reference, operation, path }) => ({
        reference, operation, path: join(result.memoryRoot, path)
      })),
      nextAction: cliCommand(["memory", "change", "validate"])
    }));
    return;
  }
  const result = await editMemories({ references, changeId: options.change });
  emitCandidate("memory edit", result.change.id, result.candidateRoot);
}

export async function memoryDeleteCommand(references: string[], options: { change?: string } = {}): Promise<void> {
  const result = await editMemories({ references, changeId: options.change, operation: "delete" });
  emitCandidate("memory delete", result.change.id, result.candidateRoot);
}

export async function memoryRenameCommand(reference: string, newName: string, options: { change?: string } = {}): Promise<void> {
  const result = await renameMemory({ reference, newName, changeId: options.change });
  emitCandidate("memory rename", result.change.id, result.candidateRoot);
}

function emitCandidate(command: string, changeId: string, candidateRoot: string | undefined, extra: {
  status?: "ready" | "claimed";
  commentCount?: number;
  warningCount?: number;
} = {}): void {
  const inspect = candidateRoot ? cliCommand(["validate", "--memory-root", candidateRoot]) : undefined;
  publishResult(command, () => changeReceipt.parse({
    changeId, candidateRoot, status: extra.status ?? "ready",
    commentCount: extra.commentCount, warningCount: extra.warningCount,
    nextAction: cliCommand(["memory", "change", "validate", "--change", changeId])
  }), { saved: { id: changeId, inspect } });
}

export async function memoryPublishCommand(options: { change?: string; message?: string }): Promise<void> {
  if (!options.change) throw new TypeError("--change <id> is required");
  const change = await publishMemoryChange(options.change, options.message, { expectedKind: "regular" });
  const applied = change.store_type === "embedded" && change.intent === "market_import";
  publishResult("memory publish", () => changeReceipt.parse({
    changeId: change.id, status: applied ? "applied" : "published",
    storeType: change.store_type, revision: change.published_revision ?? undefined,
    nextAction: applied ? { kind: "human_confirmation" } : undefined
  }));
}

export async function memoryChangeResumeCommand(changeId: string): Promise<void> {
  emitCandidate("memory change resume", changeId, await resumeMemoryChange(changeId));
}

export async function memoryChangeClaimCommand(changeId: string, options: { force?: boolean } = {}): Promise<void> {
  const result = await claimMemoryChange({ changeId, force: options.force });
  emitCandidate("memory change claim", result.change.id, result.candidateRoot, {
    status: "claimed",
    commentCount: result.change.comments.filter(comment => comment.status === "processing").length,
    warningCount: result.warnings.length
  });
}

export async function memoryChangeFinishCommand(
  changeId: string,
  options: { comment?: string[]; reason?: "fixed" | "rejected" } = {}
): Promise<void> {
  const change = await finishMemoryChange({ changeId, commentIds: options.comment, reason: options.reason });
  publishResult("memory change finish", () => changeReceipt.parse({
    changeId: change.id, status: "completed", commentCount: (options.comment ?? []).length
  }));
}

export async function memoryChangeCompleteCommand(changeId: string): Promise<void> {
  const change = await completeMemoryChange(changeId);
  publishResult("memory change complete", () => changeReceipt.parse({ changeId: change.id, status: "completed" }));
}

export async function memoryChangeValidateCommand(
  changeId: string | undefined,
  options: { format?: string; output?: string } = {}
): Promise<void> {
  const format = parseOutput(options.output ?? options.format ?? "text", ["text", "json"] as const, "memory change validate");
  const result = await validateMemoryChange(changeId);
  const preview = await memoryChangePreview(result.changeId);
  const inspect = cliCommand(["memory", "change", "show", result.changeId, "--checkpoint", result.checkpointDigest,
    "--part", result.issues.length ? "validation" : "summary"]);
  publishResult("memory change validate", () => changeValidation.parse({
    valid: result.issues.length === 0, changeId: result.changeId, storeType: result.storeType,
    baseRevision: result.baseRevision, checkpointDigest: result.checkpointDigest,
    completedChangeIds: result.completedChangeIds.slice(0, 20), completedChangeCount: result.completedChangeIds.length,
    issueCount: result.issues.length, issues: summarizeMemoryIssues(result.issues, result.memoryRoot, result.candidateRoot),
    empty: result.empty ?? false, previewPath: preview.path, previewUrl: preview.url, nextAction: inspect
  }), { format, itemsField: "issues", saved: { id: result.changeId, inspect } });
  if (result.issues.length > 0) process.exitCode = 1;
}

async function memoryChangePreview(changeId: string): Promise<{ path: string; url?: string }> {
  const config = await readConfig();
  if (!config.project?.name) throw new Error("No Project is currently selected");
  const path = memoryChangePreviewPath(config.project.name, changeId);
  const status = await getViewServiceStatus(config);
  if (!status.running || !status.state) return { path };
  return { path, url: `${viewServiceUrl(status.state)}${path}` };
}

export function memoryChangePreviewPath(project: string, changeId: string): string {
  return `/projects/${encodeURIComponent(project)}/changes/${encodeURIComponent(changeId)}`;
}

export async function memoryRecoverCommand(reference: string, options: { restore?: boolean; createChange?: boolean }): Promise<void> {
  if (options.restore === options.createChange) throw new Error("choose exactly one of --restore or --create-change");
  const result = await recoverMemory(reference, options.restore ? "restore" : "create-change");
  if (result.change) {
    emitCandidate("memory recover", result.change.id, result.candidateRoot);
  } else {
    publishResult("memory recover", () => changeReceipt.parse({ status: "restored", reference }));
  }
}

export async function memoryPushCommand(): Promise<void> {
  await pushMemory();
  publishResult("memory push", () => changeReceipt.parse({ status: "pushed", storeType: "managed" }));
}

export async function memorySyncCommand(): Promise<void> {
  const result = await syncMemory();
  if (result.change) emitCandidate("memory sync", result.change.id, result.candidateRoot);
  else publishResult("memory sync", () => changeReceipt.parse({ status: "synchronized", revision: result.revision }));
}

export async function memorySyncPublishCommand(options: { change?: string; message?: string }): Promise<void> {
  if (!options.change) throw new TypeError("--change <id> is required");
  const change = await publishMemoryChange(options.change, options.message, { expectedKind: "sync" });
  publishResult("memory sync publish", () => changeReceipt.parse({
    changeId: change.id, status: "published", revision: change.published_revision ?? undefined
  }));
}

function toIdentity(descriptor: { reference: string; kind: MemoryKind; names: string[] }): MemoryIdentity {
  return {
    reference: descriptor.reference,
    kind: descriptor.kind,
    names: [...descriptor.names]
  };
}

function parseKind(value: string | undefined): MemoryKind | undefined {
  if (value === undefined) return undefined;
  if (!isMemoryKind(value)) {
    throw new Error(`unknown memory kind "${value}". Expected one of: ${memoryKinds.join(", ")}`);
  }
  return value;
}

function parseOutput<T extends string>(value: string, allowed: readonly T[], command: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`unknown ${command} output "${value}". Expected one of: ${allowed.join(", ")}`);
  }
  return value as T;
}
