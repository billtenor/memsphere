import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveMemsphereHome } from "../home.js";
import { readBundledHomeModels } from "../reserved/models.js";
import { JsonSchemaModelRuntimeFactory } from "../data/extensions/json-schema/index.js";
import { FilesystemJsonValueStoreFactory } from "../data/extensions/filesystem-json-valuestore/index.js";
import { Config } from "../data/api/config.js";
import { bytesContent } from "../data/extensions/shared/payload.js";
import type { ValueStore, StoredValue } from "../data/api/value-store.js";
import { failure } from "../context_control/service.js";

export type CommandState = { id: string; commandGroup: string; groupId: string; status: "active" | "closed"; parameters: Record<string, string>; state: { lastArtifactId?: string; reads?: Record<string, { readAt: string }> } };
export type CommandStateRow = StoredValue & { value: CommandState };
export async function openCommandStates(initialize = false, home = resolveMemsphereHome()): Promise<ValueStore | undefined> {
  const directory = join(home, "data", "command-states");
  if (!initialize) {
    try { await stat(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  const model = readBundledHomeModels().find(m => m.id === "memsphere/command-state.json");
  if (!model) throw failure("MODEL_NOT_FOUND", "Missing bundled CommandState model");
  const runtime = await new JsonSchemaModelRuntimeFactory().createRuntime({}, { data: { id: model.id, model: model.metaModel, payload: { contentType: "application/json", content: bytesContent(Buffer.from(model.source)) } }, definition: model.definition }, { get() { return undefined; }, register() { throw Error("Unexpected registration"); } });
  const factory = new FilesystemJsonValueStoreFactory();
  return initialize ? factory.createStore({}, "memsphere/command-states", runtime, new Config({ directory })) : factory.openExisting({}, "memsphere/command-states", runtime, new Config({ directory }));
}
export async function requireCommandState(id: string, home?: string): Promise<CommandStateRow> {
  const store = await openCommandStates(false, home); const row = await store?.get({}, id) as CommandStateRow | undefined;
  if (!row) throw failure("NOT_FOUND", `CommandState not found: ${id}`);
  if (row.value.id !== id) throw failure("INVALID_STATE", "CommandState identity mismatch");
  if (row.value.commandGroup !== "run") throw failure("UNSUPPORTED_CAPABILITY", `Unsupported commandGroup: ${row.value.commandGroup}`);
  const state = row.value.state;
  if (!state || Object.keys(state).some(k => !["lastArtifactId", "reads"].includes(k)) || state.lastArtifactId !== undefined && typeof state.lastArtifactId !== "string" || state.reads !== undefined && (typeof state.reads !== "object" || state.reads === null || Array.isArray(state.reads) || Object.entries(state.reads).some(([key, value]) => !/^(artifact|external):.+/.test(key) || !value || typeof value.readAt !== "string"))) throw failure("INVALID_STATE", "Invalid run command state");
  return row;
}
export async function createCommandState(project: string, runId: string, stepId?: string) {
  const store = (await openCommandStates(true))!;
  const value: CommandState = { id: `context-${randomUUID()}`, commandGroup: "run", groupId: runId, status: "active", parameters: { project, ...(stepId ? { step: stepId } : {}) }, state: { reads: {} } };
  await store.create({}, value.id, value); return value;
}
export async function findCommandStates(project: string, runId: string, home?: string): Promise<CommandStateRow[]> {
  const store = await openCommandStates(false, home); if (!store) return [];
  const found: CommandStateRow[] = []; let cursor: string | undefined;
  do {
    const page = await store.list({}, { limit: 1000, cursor });
    for (const item of page.items) {
      const row = await store.get({}, item.id) as CommandStateRow | undefined;
      if (row?.value.commandGroup === "run" && row.value.groupId === runId && row.value.parameters.project === project) { await requireCommandState(item.id, home); found.push(row); }
    }
    cursor = page.nextCursor;
  } while (cursor);
  return found;
}
export async function updateCommandState(row: CommandStateRow, value: CommandState) {
  const store = (await openCommandStates())!;
  return store.update({}, row.value.id, value, { expectedRevision: row.revision });
}
export async function accountRead(project: string, runId: string, key: string) {
  try {
    const rows = (await findCommandStates(project, runId)).filter(row => row.value.status === "active");
    if (rows.length !== 1) return;
    const row = rows[0];
    await updateCommandState(row, { ...row.value, state: { ...row.value.state, reads: { ...row.value.state.reads, [key]: { readAt: new Date().toISOString() } } } });
  } catch { /* Reading succeeds independently of auxiliary accounting. */ }
}

/** Auxiliary closure cannot turn an already successful business transition into a failure. */
export async function closeRunCommandStates(project: string, runId: string, home?: string): Promise<string[]> {
  const warnings: string[] = [];
  try {
    const store = await openCommandStates(false, home);
    for (const row of await findCommandStates(project, runId, home)) if (row.value.status === "active") {
      try { await store!.update({}, row.value.id, { ...row.value, status: "closed" }, { expectedRevision: row.revision }); }
      catch { warnings.push(`Run ended; CommandState ${row.value.id} could not be closed`); }
    }
  } catch { warnings.push("Run ended; command-state lookup failed"); }
  return warnings;
}
