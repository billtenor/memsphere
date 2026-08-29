import type { MemoryCatalog } from "../memory/catalog.js";
import type { RulePart, StatementNode } from "../memory/ast.js";
import { join } from "node:path";
import { createMemoryCatalog, createMemoryCatalogForConfig } from "../memory/factory.js";
import { isMemoryKind, memoryKinds, type MemoryKind } from "../memory/kinds.js";
import {
  serializeMemoryJson,
  serializeEffectiveMemoryReadJson,
  serializeEffectiveMemoryReadYaml,
  serializeMemoryListJson,
  serializeMemoryListText,
  serializeMemoryListYaml,
  serializeMemoryNodeListJson,
  serializeMemoryNodeListText,
  serializeMemoryNodeListYaml,
  serializeMemoryNodeReadJson,
  serializeMemoryNodeReadYaml,
  serializeMemoryYaml,
  toEffectiveRuleDisplayTree
} from "../memory/serializer.js";
import { resolveRuleParts } from "../memory/rules.js";
import { MemoryNavigation, type MemoryIdentity } from "../memory/navigation.js";
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
import { readRun } from "../run/store.js";
import { getViewServiceStatus, viewServiceUrl } from "../view/service.js";

const listOutputs = ["yaml", "json", "text"] as const;
const readOutputs = ["yaml", "json"] as const;

type ListOutput = (typeof listOutputs)[number];
type ReadOutput = (typeof readOutputs)[number];

export type MemoryListCommandOptions = {
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
  writeStdout: (value) => process.stdout.write(value)
};

export async function memoryListCommand(
  reference: string | undefined,
  options: MemoryListCommandOptions,
  dependencies: MemoryCommandDependencies = defaultDependencies
): Promise<void> {
  const kind = parseKind(options.kind);
  const output = parseOutput(options.output ?? "yaml", listOutputs, "memory list");
  if (!reference && options.node !== undefined) {
    throw new Error("memory list --node requires a memory reference");
  }
  if (reference && options.query) {
    throw new Error("memory list --query cannot be used with a memory reference");
  }
  const catalog = await dependencies.createCatalog(options.run);
  if (reference) {
    const descriptor = await catalog.resolve(reference, { kind });
    const entity = await catalog.read(descriptor.reference, { kind: descriptor.kind });
    const navigation = new MemoryNavigation(toIdentity(descriptor), entity);
    const page = navigation.listChildren(options.node);
    const value = output === "json"
      ? serializeMemoryNodeListJson(page)
      : output === "text"
        ? serializeMemoryNodeListText(page)
        : serializeMemoryNodeListYaml(page);
    dependencies.writeStdout(value);
    return;
  }
  const page = await catalog.list({ kind, query: options.query });
  const value = output === "json"
    ? serializeMemoryListJson(page)
    : output === "text"
      ? serializeMemoryListText(page)
      : serializeMemoryListYaml(page);
  dependencies.writeStdout(value);
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
    const value = options.effective
      ? output === "json"
        ? serializeEffectiveMemoryReadJson({ declared: result, effective })
        : serializeEffectiveMemoryReadYaml({ declared: result, effective })
      : output === "json" ? serializeMemoryNodeReadJson(result) : serializeMemoryNodeReadYaml(result);
    dependencies.writeStdout(value);
    return;
  }
  const entity = await catalog.read(reference, { kind });
  const effective = options.effective ? await resolveEffectiveRules(entity, catalog) : undefined;
  const value = options.effective
    ? output === "json"
      ? serializeEffectiveMemoryReadJson({ declared: entity, effective })
      : serializeEffectiveMemoryReadYaml({ declared: entity, effective })
    : output === "json" ? serializeMemoryJson(entity) : serializeMemoryYaml(entity);
  dependencies.writeStdout(value);
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
  const run = await readRun(config.runsRoot, runId);
  if (!run.memorySource || !run.memorySnapshot) {
    throw new Error(`Run ${runId} does not have a frozen ChangeSet Memory snapshot`);
  }
  const memoryRoot = join(config.runsRoot, run.id, run.memorySnapshot.path);
  const revision = run.memoryProjects?.primary.revision
    ?? `changeset:${run.memorySource.changeId}@${run.memorySource.checkpointDigest}`;
  return createMemoryCatalogForConfig(config, { memoryRoot, revision });
}

export async function memoryEditCommand(references: string[], options: { change?: string } = {}): Promise<void> {
  const context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
  if (context.primary.config.store.type === "embedded") {
    if (options.change) throw new Error("--change is only available for a Managed Project");
    const result = await editEmbeddedMemories(references);
    console.log("Store: embedded");
    console.log(`Repository Root: ${result.repositoryRoot}`);
    console.log(`Workspace Root: ${result.workspaceRoot}`);
    console.log(`Memory Root: ${result.memoryRoot}`);
    for (const target of result.targets) {
      console.log(`Edit: ${target.reference}\t${target.operation}\t${join(result.memoryRoot, target.path)}`);
    }
    console.log("Next: memsphere memory change validate");
    console.log("Integrate these Memory changes through the repository's normal Git workflow.");
    return;
  }
  const result = await editMemories({ references, changeId: options.change });
  console.log(`ChangeSet: ${result.change.id}`);
  console.log(`Candidate Root: ${result.candidateRoot}`);
  logMemoryChangeValidateNext(result.change.id);
}

export async function memoryDeleteCommand(references: string[], options: { change?: string } = {}): Promise<void> {
  const result = await editMemories({ references, changeId: options.change, operation: "delete" });
  console.log(`ChangeSet: ${result.change.id}`);
  console.log(`Candidate Root: ${result.candidateRoot}`);
  logMemoryChangeValidateNext(result.change.id);
}

export async function memoryRenameCommand(reference: string, newName: string, options: { change?: string } = {}): Promise<void> {
  const result = await renameMemory({ reference, newName, changeId: options.change });
  console.log(`ChangeSet: ${result.change.id}`);
  console.log(`Candidate Root: ${result.candidateRoot}`);
  logMemoryChangeValidateNext(result.change.id);
}

function logMemoryChangeValidateNext(changeId: string): void {
  console.log(`Next: memsphere memory change validate ${changeId}`);
}

export async function memoryPublishCommand(options: { change?: string; message?: string }): Promise<void> {
  if (!options.change) throw new Error("--change <id> is required");
  const change = await publishMemoryChange(options.change, options.message, { expectedKind: "regular" });
  if (change.store_type === "embedded" && change.intent === "market_import") {
    console.log(`Applied ChangeSet to worktree: ${change.id}`);
    console.log("Review and commit the Memory changes with Git; the ChangeSet remains active until integration.");
    return;
  }
  console.log(`Completed ChangeSet: ${change.id}`);
  console.log(`Revision: ${change.published_revision}`);
}

export async function memoryChangeResumeCommand(changeId: string): Promise<void> {
  console.log(`Candidate Root: ${await resumeMemoryChange(changeId)}`);
}

export async function memoryChangeClaimCommand(changeId: string, options: { force?: boolean } = {}): Promise<void> {
  const result = await claimMemoryChange({ changeId, force: options.force });
  console.log(`Claimed ChangeSet: ${result.change.id}`);
  console.log(`Candidate Root: ${result.candidateRoot}`);
  console.log(`Processing Comments: ${result.change.comments.filter((comment) => comment.status === "processing").length}`);
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
}

export async function memoryChangeFinishCommand(
  changeId: string,
  options: { comment?: string[]; reason?: "fixed" | "rejected" } = {}
): Promise<void> {
  const change = await finishMemoryChange({
    changeId,
    commentIds: options.comment,
    reason: options.reason
  });
  console.log(`Finished ChangeSet processing: ${change.id}`);
  console.log(`Completed Comments: ${(options.comment ?? []).length}`);
}

export async function memoryChangeCompleteCommand(changeId: string): Promise<void> {
  const change = await completeMemoryChange(changeId);
  console.log(`Completed ChangeSet: ${change.id}`);
}

export async function memoryChangeValidateCommand(
  changeId: string | undefined,
  options: { format?: string } = {}
): Promise<void> {
  const format = parseOutput(options.format ?? "text", ["text", "json"] as const, "memory change validate");
  const result = await validateMemoryChange(changeId);
  const preview = await memoryChangePreview(result.changeId);
  if (format === "json") {
    process.stdout.write(`${JSON.stringify({ valid: result.issues.length === 0, ...result, previewUrl: preview.url }, null, 2)}\n`);
    if (result.issues.length > 0) process.exitCode = 1;
    return;
  }
  if (result.issues.length === 0) {
    console.log("ChangeSet validation passed");
  } else {
    console.error("ChangeSet validation failed");
    for (const issue of result.issues) {
      console.error(`- ${issue.path}${issue.line ? `:${issue.line}:${issue.column ?? 1}` : ""}: ${issue.message}`);
    }
    process.exitCode = 1;
  }
  console.log(`ChangeSet: ${result.changeId}`);
  console.log(`Store: ${result.storeType}`);
  console.log(`Base Revision: ${result.baseRevision}`);
  console.log(`Content Digest: ${result.checkpointDigest}`);
  console.log(`memoryRoot: ${result.memoryRoot}`);
  if (preview.url) console.log(`Preview: ${preview.url}`);
  else console.log(`Preview: start memsphere View, then open ${preview.path}`);
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
    console.log(`ChangeSet: ${result.change.id}`);
    console.log(`Candidate Root: ${result.candidateRoot}`);
  } else {
    console.log(`Restored Memory: ${reference}`);
  }
}

export async function memoryPushCommand(): Promise<void> {
  await pushMemory();
  console.log("Pushed Managed Memory branch.");
}

export async function memorySyncCommand(): Promise<void> {
  const result = await syncMemory();
  if (result.change) {
    console.log(`Sync ChangeSet: ${result.change.id}`);
    console.log(`Candidate Root: ${result.candidateRoot}`);
  } else {
    console.log(`Synchronized Revision: ${result.revision}`);
  }
}

export async function memorySyncPublishCommand(options: { change?: string; message?: string }): Promise<void> {
  if (!options.change) throw new Error("--change <id> is required");
  const change = await publishMemoryChange(options.change, options.message, { expectedKind: "sync" });
  console.log(`Published Sync ChangeSet: ${change.id}`);
  console.log(`Revision: ${change.published_revision}`);
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
