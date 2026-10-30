import { currentIdentity, type AgentIdentity } from "../runner/identity.js";
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

export type CommandState = { id: string; agentType: AgentIdentity["agentType"]; sessionId: string; updatedAt: string; commandGroup: string; groupId: string; status: "active" | "closed"; parameters: Record<string, string>; state: { lastArtifactId?: string; reads?: Record<string, { readAt: string }> } };
export type CommandStateRow = StoredValue & { value: CommandState };
export async function openCommandStates(initialize = false, home = resolveMemsphereHome()): Promise<ValueStore | undefined> {
  const directory = join(home, "data", "runner-sessions");
  if (!initialize) {
    try { await stat(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  const model = readBundledHomeModels().find(m => m.id === "memsphere/command-state.json");
  if (!model) throw failure("MODEL_NOT_FOUND", "Missing bundled CommandState model");
  const runtime = await new JsonSchemaModelRuntimeFactory().createRuntime({}, { data: { id: model.id, model: model.metaModel, payload: { contentType: "application/json", content: bytesContent(Buffer.from(model.source)) } }, definition: model.definition }, { get() { return undefined; }, register() { throw Error("Unexpected registration"); } });
  const factory = new FilesystemJsonValueStoreFactory();
  return initialize ? factory.createStore({}, "memsphere/runner-sessions", runtime, new Config({ directory })) : factory.openExisting({}, "memsphere/runner-sessions", runtime, new Config({ directory }));
}
export async function requireCommandState(id: string, home?: string): Promise<CommandStateRow> {
  const store = await openCommandStates(false, home); const row = await store?.get({}, id) as CommandStateRow | undefined;
  if (!row) throw failure("NOT_FOUND", `CommandState not found: ${id}`);
  if (row.value.id !== id || id !== `${row.value.agentType}-${row.value.sessionId}`) throw failure("INVALID_STATE", "CommandState identity mismatch");
  if (row.value.commandGroup !== "run") throw failure("UNSUPPORTED_CAPABILITY", `Unsupported commandGroup: ${row.value.commandGroup}`);
  const state = row.value.state;
  if (!state || Object.keys(state).some(k => !["lastArtifactId", "reads"].includes(k)) || state.lastArtifactId !== undefined && typeof state.lastArtifactId !== "string" || state.reads !== undefined && (typeof state.reads !== "object" || state.reads === null || Array.isArray(state.reads) || Object.entries(state.reads).some(([key, value]) => !/^(artifact|external):.+/.test(key) || !value || typeof value.readAt !== "string"))) throw failure("INVALID_STATE", "Invalid run command state");
  return row;
}
export async function createCommandState(project: string, runId: string, stepId?: string) {
  const identity = await currentIdentity();
  if (!identity) return undefined;
  const store = (await openCommandStates(true))!;
  const matches = (row: CommandStateRow | undefined) => row?.value.status === "active" && row.value.groupId === runId && row.value.parameters.project === project && row.value.parameters.step === stepId;
  const previous = await store.get({}, identity.id) as CommandStateRow | undefined;
  if (matches(previous)) return previous!.value;
  const value: CommandState = { ...identity, updatedAt: new Date().toISOString(), commandGroup: "run", groupId: runId, status: "active", parameters: { project, ...(stepId ? { step: stepId } : {}) }, state: { reads: {} } };
  try {
    if (previous) await store.update({}, identity.id, value, { expectedRevision: previous.revision });
    else await store.create({}, identity.id, value);
    return value;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "ALREADY_EXISTS" && code !== "REVISION_CONFLICT") throw error;
    // A concurrent command may have established the same binding already.
    // Reuse it without overwriting reads; never retry a different binding.
    const current = await store.get({}, identity.id) as CommandStateRow | undefined;
    if (matches(current)) return current!.value;
    throw failure("REVISION_CONFLICT", "Session binding changed concurrently; explicitly enter the target again");
  }
}
export async function currentCommandState(required = false): Promise<CommandStateRow | undefined> {
  const identity = await currentIdentity(required);
  if (!identity) return undefined;
  const store = await openCommandStates();
  const row = await store?.get({}, identity.id) as CommandStateRow | undefined;
  if (!row && required) throw failure("NOT_FOUND", "No session context; use run enter or run step enter first");
  return row ? requireCommandState(identity.id) : undefined;
}
export async function assertSessionTarget(project: string, runId: string, stepId?: string) {
  const row = await currentCommandState();
  if (row?.value.status === "active" && (row.value.parameters.project !== project || row.value.groupId !== runId || stepId !== undefined && row.value.parameters.step !== stepId))
    throw failure("SESSION_CONTEXT_CONFLICT", "The current session is bound to another target; explicitly enter the target Run/Step first");
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
  if (value.id !== row.id || value.id !== `${value.agentType}-${value.sessionId}`) throw failure("INVALID_STATE", "CommandState identity mismatch");
  const store = (await openCommandStates())!;
  return store.update({}, row.value.id, { ...value, updatedAt: new Date().toISOString() }, { expectedRevision: row.revision });
}
export async function accountRead(project: string, runId: string, key: string) {
  try {
    const row = await currentCommandState();
    if (!row || row.value.status !== "active" || row.value.groupId !== runId || row.value.parameters.project !== project) return;
    await updateCommandState(row, { ...row.value, state: { ...row.value.state, reads: { ...row.value.state.reads, [key]: { readAt: new Date().toISOString() } } } });
  } catch { /* Reading succeeds independently of auxiliary accounting. */ }
}

/** Auxiliary closure cannot turn an already successful business transition into a failure. */
export async function closeRunCommandStates(project: string, runId: string, home?: string): Promise<string[]> {
  const warnings: string[] = [];
  try {
    const store = await openCommandStates(false, home);
    for (const row of await findCommandStates(project, runId, home)) if (row.value.status === "active") {
      try { await store!.update({}, row.value.id, { ...row.value, status: "closed", updatedAt: new Date().toISOString() }, { expectedRevision: row.revision }); }
      catch { warnings.push(`Run ended; CommandState ${row.value.id} could not be closed`); }
    }
  } catch { warnings.push("Run ended; command-state lookup failed"); }
  return warnings;
}
