import { z } from "zod";
import { nextAction } from "../prompts/cli-output.js";

const optionalCount = z.number().int().nonnegative().optional();
export const daemonStatusSchema = z.object({
  running: z.boolean(),
  view: z.object({
    running: z.boolean(), desiredState: z.enum(["running", "stopped"]),
    url: z.string().optional(), errorCode: z.literal("VIEW_UNAVAILABLE").optional(),
    settingsAccess: z.enum(["local", "configured", "setup_required"]).optional()
  }).strict(),
  tasks: z.object({
    queued: optionalCount, running: optionalCount, completed: optionalCount,
    failed: optionalCount, cancelled: optionalCount
  }).strict().optional(),
  taskErrorCount: optionalCount,
  settingsConfigKey: z.literal("view.operator_token").optional(),
  nextAction
}).strict();

type ServiceStatus = {
  running: boolean;
  view: { running?: boolean; desiredState: "running" | "stopped"; host?: string; port?: number; error?: string; settingsAccess?: "local" | "configured" | "setup_required" };
  tasks?: Record<string, number>;
  taskErrors?: unknown[];
};

export function publicDaemonStatus(status: ServiceStatus): z.infer<typeof daemonStatusSchema> {
  const view = status.view;
  const counts = status.tasks;
  return {
    running: status.running,
    view: {
      running: Boolean(view.running),
      desiredState: view.desiredState,
      ...(view.running && view.host && view.port !== undefined
        ? { url: `http://${view.host.includes(":") && !view.host.startsWith("[") ? "[" + view.host + "]" : view.host}:${view.port}` } : {}),
      ...(view.error ? { errorCode: "VIEW_UNAVAILABLE" } : {}),
      ...(view.settingsAccess ? { settingsAccess: view.settingsAccess } : {})
    },
    ...(counts ? { tasks: {
      queued: counts.queued, running: counts.running, completed: counts.completed,
      failed: counts.failed, cancelled: counts.cancelled
    } } : {}),
    ...(status.taskErrors?.length ? { taskErrorCount: status.taskErrors.length } : {}),
    ...(view.settingsAccess === "setup_required" ? {
      settingsConfigKey: "view.operator_token" as const,
      nextAction: { kind: "human_confirmation" as const,
        resume: { kind: "command" as const, launcher: "memsphere" as const, args: ["view", "restart"] }
      }
    } : {})
  };
}
