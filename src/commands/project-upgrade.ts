import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { assertProjectName, projectConfigSchema } from "../project/model.js";
import { resolveProjectContext } from "../project/resolver.js";
import { validateMemoryRoot } from "../validation.js";
import { readBundledSystemMemories, readReservedMemoryManifest, bundledReservedMemoryRoot, reservedSystemMemoryRemovalTombstones } from "../reserved/store.js";
import { assertSystemUpgradeWorkspace, createSystemUpgradeMemoryChange, validateSystemUpgradeRetry, publishSystemUpgradeMemoryChange, readMemoryChange, type SystemUpgradeMemoryTarget } from "../memory/changeset.js";
import { upgradeProjectModelRegistrations, withModelRegistrationLock } from "../project/model-registration.js";
import { readSystemMemoryUpgradeTargets, prepareEmbeddedSystemMemoryRepair, applyEmbeddedSystemMemoryRepair } from "./project.js";
import { emitCommandResult, errorCode } from "./cli-errors.js";

const require = createRequire(import.meta.url);
const version: string = (require("../../package.json") as { version: string }).version;
type PhaseResult = { status: "upgraded" | "unchanged" | "failed" | "not_run"; [key: string]: unknown };

/** One selected Project, two separately recoverable resource upgrades. */
export async function projectUpgradeCommand(name?: string, options: { output?: "text" | "json"; change?: string } = {}): Promise<void> {
  const previous = process.env.MEMSPHERE_PROJECT;
  const result: { project?: string; storeType?: string; cliVersion: string; overall: string; models: PhaseResult; memory: PhaseResult; validation: string; [key: string]: unknown } = {
    cliVersion: version, overall: "failed", models: { status: "not_run" }, memory: { status: "not_run" }, validation: "not_run"
  };
  let stage = "target";
  try {
    if (name !== undefined) process.env.MEMSPHERE_PROJECT = assertProjectName(name.trim());
    let context = await resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
    result.project = context.primary.name;
    result.storeType = context.primary.config.store.type;
    stage = "preflight";
    await assertSystemUpgradeWorkspace(context, options.change);
    const bundled = await readBundledSystemMemories(bundledReservedMemoryRoot());
    const catalog = await Promise.all(bundled.map(async item => ({ reference: item.reference, path: item.path, content: await readFile(item.sourcePath, "utf8") })));
    const removals = reservedSystemMemoryRemovalTombstones(await readReservedMemoryManifest(bundledReservedMemoryRoot()));
    const sourceDigest = createHash("sha256").update(JSON.stringify({ catalog, removals })).digest("hex");
    let plan: { targets: SystemUpgradeMemoryTarget[]; created: number; updated: number; deleted: number };
    if (options.change) {
      const change = await readMemoryChange({ project: context.primary.name, home: context.home, changeId: options.change });
      if (!change.system_upgrade) throw new Error("Expected a dedicated system upgrade ChangeSet");
      const targets: SystemUpgradeMemoryTarget[] = change.system_upgrade.targets.map(target => {
        if (target.operation === "delete") {
          if (!removals.some(item => item.path === target.path && item.matches.some(match =>
            match.reference === target.reference && match.sha256 === target.approvedContentDigest))) {
            throw new Error(`Upgrade removal target is no longer bundled: ${target.reference}`);
          }
          return { reference: target.reference, path: target.path, operation: "delete", approvedContentDigest: target.approvedContentDigest };
        }
        const source = catalog.find(item => item.reference === target.reference);
        if (!source) throw new Error(`Upgrade target is no longer bundled: ${target.reference}`);
        return { reference: target.reference, path: target.path, operation: target.operation, content: source.content };
      });
      await validateSystemUpgradeRetry({ context, changeId: options.change, targets, sourceDigest });
      plan = { targets, created: targets.filter(t => t.operation === "create").length, updated: targets.filter(t => t.operation === "update").length, deleted: targets.filter(t => t.operation === "delete").length };
    } else plan = await readSystemMemoryUpgradeTargets(context.primary.name);
    stage = "models";
    const models = await withModelRegistrationLock(context.primary.paths.root, async () => {
      const config = projectConfigSchema.parse(JSON.parse(await readFile(context.primary.paths.configPath, "utf8")));
      return upgradeProjectModelRegistrations({}, { root: context.primary.paths.root, memoryRoot: context.primary.memoryRoot, modelsDirectory: config.modelsDirectory, modelRegistration: config.modelRegistration }, { config: { path: context.primary.paths.configPath, value: config } });
    });
    result.models = { status: models.changed ? "upgraded" : "unchanged", ...models };
    // Settings writes invalidate the prior config; resolve again before publication.
    context = await resolveProjectContext({ project: context.primary.name });
    stage = "memory";
    result.memory = { status: "not_run", created: plan.created, updated: plan.updated, deleted: plan.deleted };
    if (plan.targets.length) {
      let changeId = options.change;
      if (!changeId) {
        if (context.primary.config.store.type === "embedded") {
          const prepared = await prepareEmbeddedSystemMemoryRepair(context.primary.name);
          if (!prepared) throw new Error("System Memory plan changed before applying; retry from a clean worktree");
          await applyEmbeddedSystemMemoryRepair(prepared, { afterApply: async () => {
            const recorded = await createSystemUpgradeMemoryChange({ context, targets: plan.targets, sourceDigest });
            changeId = recorded.change.id;
          } });
        } else {
          const prepared = await createSystemUpgradeMemoryChange({ context, targets: plan.targets, sourceDigest });
          changeId = prepared.change.id;
        }
      }
      if (!changeId) throw new Error("System upgrade did not persist its dedicated ChangeSet");
      result.memory.changeSet = { id: changeId, status: "active", intent: "system_upgrade", view: `/projects/${encodeURIComponent(context.primary.name)}/changes/${encodeURIComponent(changeId)}`, validation: "not_run", evidenceScope: "system_upgrade" };
      let validated = await validateSystemUpgradeRetry({ context, changeId, targets: plan.targets, sourceDigest });
      if (!validated.checkpoint?.valid) throw new Error("System Memory upgrade validation failed");
      if (context.primary.config.store.type === "managed") validated = await publishSystemUpgradeMemoryChange(changeId, { context, message: "Upgrade Memsphere system Memory" });
      result.memory.changeSet = { ...result.memory.changeSet as object, status: validated.status, validation: "passed", checkpointDigest: validated.checkpoint?.digest };
      result.memory.status = "upgraded";
      if (context.primary.config.store.type === "embedded") {
        result.memory.integrationStatus = "pending";
        result.memory.branch = validated.system_upgrade?.branch;
        result.memory.worktree = context.workspace.path;
        result.memory.next = "Review the dedicated ChangeSet, commit only its System Memory targets, then merge into master.";
      } else result.memory.revision = validated.published_revision;
    } else result.memory.status = "unchanged";
    stage = "validation";
    context = await resolveProjectContext({ project: context.primary.name });
    const validation = await validateMemoryRoot(context.primary.memoryRoot);
    if (validation.issues.length) throw new Error(`System Memory validation failed: ${validation.issues[0]!.message}`);
    if ((await readSystemMemoryUpgradeTargets(context.primary.name)).targets.length) throw new Error("System Memory does not match current bundled targets");
    result.validation = "passed";
    result.overall = result.models.status === "upgraded" || result.memory.status === "upgraded" ? "upgraded" : "unchanged";
  } catch (error) {
    result.failure = { stage, code: errorCode(error), message: error instanceof Error ? error.message : String(error) };
    if (stage === "models") result.models.status = "failed";
    if (stage === "memory" || stage === "validation") result.memory.status = "failed";
    if (stage === "validation") result.validation = "failed";
    process.exitCode = 1;
  } finally {
    if (previous === undefined) delete process.env.MEMSPHERE_PROJECT;
    else process.env.MEMSPHERE_PROJECT = previous;
  }
  emitCommandResult(result, options.output ?? "text");
}
