import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { openHomeModelStore } from "../home/model-store.js";
import { resolveMemsphereHome } from "../home.js";
import { withNativeFileLock } from "../file-lock.js";
import type { StoredValue } from "../data/api/value-store.js";
import { validateFilename } from "../data/extensions/shared/filesystem.js";

export const taskSchema = z.object({
  id: z.string().min(1), type: z.literal("review-wait"),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  input: z.object({ project: z.string(), runId: z.string(), stepId: z.string().optional(), reviewId: z.string(), roundId: z.string(), configPath: z.string(), cwd: z.string() }).strict(),
  recipient: z.object({ agentType: z.enum(["codex", "traex"]), sessionId: z.string().min(1), agentCommand: z.string().min(1) }).strict(),
  error: z.object({ code: z.string(), message: z.string(), stage: z.enum(["wait", "render", "send", "cancel", "recovery"]) }).strict().optional(),
  daemonInstanceId: z.string().optional(), createdAt: z.string().datetime(), updatedAt: z.string().datetime()
}).strict().superRefine((task, ctx) => {
  if (task.input.reviewId.startsWith("graph-review-") && !task.input.stepId) ctx.addIssue({ code: "custom", message: "Graph Review task requires stepId" });
  if (["failed", "cancelled"].includes(task.status) && !task.error) ctx.addIssue({ code: "custom", message: "Failed/cancelled task requires error" });
  if (task.status === "cancelled" && (task.error?.stage !== "cancel" || !["round_changed", "runner_disabled"].includes(task.error.code))) ctx.addIssue({ code: "custom", message: "Invalid cancellation reason" });
  if (task.error?.code === "execution_interrupted" && task.error.stage !== "recovery") ctx.addIssue({ code: "custom", message: "Interrupted execution must have recovery stage" });
});
export type DaemonTask = z.infer<typeof taskSchema>;
export type TaskRow = StoredValue & { value: DaemonTask };
const recordErrors = new Map<string, Array<{ id: string; error: string }>>();
export const taskDiagnostics = (home = resolveMemsphereHome()) => recordErrors.get(home) ?? [];
export async function listTasks(home?: string): Promise<TaskRow[]> {
  const store = await openHomeModelStore("daemon-tasks", false, home);
  if (!store) return [];
  const rows: TaskRow[] = []; let cursor: string | undefined;
  const errors: Array<{ id: string; error: string }> = [];
  recordErrors.set(home ?? resolveMemsphereHome(), errors);
  do {
    const page = await store.list({}, { cursor, limit: 1000 });
    for (const item of page.items) {
      try {
        const row = await store.get({}, item.id);
        if (row) { const value = taskSchema.parse(row.value); if (value.id !== item.id) throw new Error("Task identity mismatch"); rows.push({ ...row, value }); }
      } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError || /validation|Task identity mismatch/i.test((error as Error).message)) errors.push({ id: item.id, error: "TASK_RECORD_INVALID: record was not modified or scheduled" });
        else throw error;
      }
    }
    cursor = page.nextCursor;
  } while (cursor);
  return rows;
}
export async function updateTask(row: TaskRow, changes: Partial<DaemonTask>, home?: string) {
  const value = taskSchema.parse({ ...row.value, ...changes, updatedAt: new Date().toISOString() });
  // ValueStore accepts JSON values; cleared optional properties must be absent.
  if (value.error === undefined) delete value.error;
  if (value.daemonInstanceId === undefined) delete value.daemonInstanceId;
  if (value.id !== row.id) throw new Error("Task identity mismatch");
  return (await openHomeModelStore("daemon-tasks", false, home))!.update({}, value.id, value, { expectedRevision: row.revision });
}
const taskKey = (t: Pick<DaemonTask, "type" | "input" | "recipient">) => JSON.stringify([t.type, t.input.project, t.input.runId, t.input.stepId ?? null, t.input.reviewId, t.input.roundId, t.recipient.agentType, t.recipient.sessionId]);
export async function retryFailedTask(id: string, home = resolveMemsphereHome()) {
  return withNativeFileLock(join(home, ".runtime", "daemon-tasks.lock"), async () => {
    const rows = await listTasks(home);
    if (taskDiagnostics(home).length) throw new Error("Invalid task records prevent safe deduplication; inspect daemon status");
    const row = rows.find(r => r.id === id);
    if (!row || row.value.status !== "failed") throw new Error("Only a failed task can be retried");
    const active = rows.find(r => taskKey(r.value) === taskKey(row.value) && ["queued", "running"].includes(r.value.status));
    if (active) return active.value;
    const updated = await updateTask(row, { status: "queued", error: undefined, daemonInstanceId: undefined }, home);
    return taskSchema.parse(updated.value);
  });
}
export async function registerTask(input: Pick<DaemonTask, "input" | "recipient">, home = resolveMemsphereHome()) {
  validateFilename(`${input.recipient.agentType}-${input.recipient.sessionId}.json`);
  await mkdir(join(home, ".runtime"), { recursive: true });
  return withNativeFileLock(join(home, ".runtime", "daemon-tasks.lock"), async () => {
    const rows = await listTasks(home);
    if (taskDiagnostics(home).length) throw new Error("Invalid task records prevent safe deduplication; inspect daemon status");
    const existing = rows.find(row => taskKey(row.value) === taskKey({ type: "review-wait", ...input }) && ["queued", "running"].includes(row.value.status));
    if (existing) return existing.value;
    const now = new Date().toISOString();
    const value = taskSchema.parse({ id: `task-${randomUUID()}`, type: "review-wait", status: "queued", ...input, createdAt: now, updatedAt: now });
    await (await openHomeModelStore("daemon-tasks", true, home))!.create({}, value.id, value);
    return value;
  });
}
