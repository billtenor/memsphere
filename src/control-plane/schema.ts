import { z } from "zod";
import { isPermissionId, type PermissionId } from "./catalog.js";
import type { ControlPlaneActor, ControlPlaneConfig, ControlPlaneSnapshot, RunnerAuthority } from "./model.js";

const idPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const nonEmptyString = z.string().trim().min(1);

const actorIdSchema = nonEmptyString.regex(idPattern, "Actor id must contain only letters, numbers, dots, underscores, or hyphens");

const permissionSchema = z.string().superRefine((value, context) => {
  if (!isPermissionId(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown Permission id: ${value}` });
  }
}).transform((value) => value as PermissionId);

const permissionListSchema = z.array(permissionSchema).superRefine((values, context) => {
  const firstIndex = new Map<string, number>();
  for (const [index, value] of values.entries()) {
    const previous = firstIndex.get(value);
    if (previous !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: `Duplicate Permission id; first used at index ${previous}`
      });
    } else {
      firstIndex.set(value, index);
    }
  }
});

const systemPromptSchema = z.string().superRefine((value, context) => {
  if (!value.trim()) context.addIssue({ code: z.ZodIssueCode.custom, message: "system_prompt must not be blank" });
}).optional();

const agentRuntimeInputSchema = z.object({
  provider: z.literal("traex").optional(),
  command: nonEmptyString.optional(),
  args: z.array(z.string()).optional(),
  cwd: nonEmptyString.optional(),
  model: nonEmptyString.optional(),
  prompt_version: nonEmptyString.optional(),
  startup_timeout_ms: z.number().int().positive().optional(),
  idle_timeout_ms: z.number().int().positive().optional(),
  max_runtime_ms: z.number().int().positive().nullable().optional(),
  timeout_ms: z.number().int().positive().optional()
}).strict().superRefine((agent, context) => {
  if (agent.timeout_ms !== undefined && agent.max_runtime_ms !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["max_runtime_ms"],
      message: "max_runtime_ms cannot be combined with legacy timeout_ms"
    });
  }
}).transform((agent) => ({
  provider: agent.provider ?? "traex",
  command: agent.command ?? "traecli",
  args: [...(agent.args ?? [])],
  cwd: agent.cwd,
  model: agent.model,
  promptVersion: agent.prompt_version,
  startupTimeoutMs: agent.startup_timeout_ms,
  idleTimeoutMs: agent.idle_timeout_ms,
  maxRuntimeMs: agent.max_runtime_ms !== undefined ? agent.max_runtime_ms : agent.timeout_ms
}));

const actorInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("human"),
    name: nonEmptyString,
    permissions: permissionListSchema,
    system_prompt: systemPromptSchema
  }).strict(),
  z.object({
    kind: z.literal("agent"),
    name: nonEmptyString,
    permissions: permissionListSchema,
    system_prompt: systemPromptSchema,
    agent: agentRuntimeInputSchema
  }).strict()
]).transform((actor): ControlPlaneActor => {
  const authority = {
    name: actor.name,
    permissions: [...actor.permissions],
    systemPrompt: actor.system_prompt
  };
  return actor.kind === "agent"
    ? { kind: "agent", ...authority, agent: actor.agent }
    : { kind: "human", ...authority };
});

const runnerInputSchema = z.object({
  permissions: permissionListSchema
}).strict().transform((runner): RunnerAuthority => ({
  permissions: [...runner.permissions]
}));

function recordWithValidatedKeys<T>(
  keySchema: z.ZodTypeAny,
  valueSchema: z.ZodType<T, z.ZodTypeDef, unknown>
): z.ZodType<Record<string, T>, z.ZodTypeDef, unknown> {
  return z.record(valueSchema).superRefine((record, context) => {
    for (const key of Object.keys(record)) {
      const result = keySchema.safeParse(key);
      if (result.success) continue;
      for (const issue of result.error.issues) {
        context.addIssue({ ...issue, path: [key, ...issue.path] });
      }
    }
  });
}

export const controlPlaneConfigSchema: z.ZodType<ControlPlaneConfig, z.ZodTypeDef, unknown> = z.object({
  runner: runnerInputSchema,
  actors: recordWithValidatedKeys(actorIdSchema, actorInputSchema)
}).strict();

const snapshotAgentRuntimeSchema = z.object({
  provider: nonEmptyString.optional(),
  command: nonEmptyString,
  args: z.array(z.string()),
  cwd: nonEmptyString.optional(),
  model: nonEmptyString.optional(),
  promptVersion: nonEmptyString.optional(),
  startupTimeoutMs: z.number().int().positive().optional(),
  idleTimeoutMs: z.number().int().positive().optional(),
  maxRuntimeMs: z.number().int().positive().nullable().optional()
}).strict();

const snapshotActorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("human"),
    name: nonEmptyString,
    permissions: permissionListSchema,
    grantablePermissions: permissionListSchema.optional(),
    systemPrompt: z.string().optional()
  }).strict(),
  z.object({
    kind: z.literal("agent"),
    name: nonEmptyString,
    permissions: permissionListSchema,
    grantablePermissions: permissionListSchema.optional(),
    systemPrompt: z.string().optional(),
    agent: snapshotAgentRuntimeSchema
  }).strict()
]);

const snapshotRunnerSchema = z.object({
  name: nonEmptyString,
  permissions: permissionListSchema,
  grantablePermissions: permissionListSchema.optional()
}).omit({ name: true }).strict();

export const controlPlaneSnapshotSchema = z.object({
  contractVersion: z.literal(1),
  revision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  permissionCatalog: z.object({
    version: nonEmptyString,
    definitions: z.array(z.object({
      id: permissionSchema,
      version: nonEmptyString,
      descriptions: z.object({
        "zh-CN": nonEmptyString,
        en: nonEmptyString
      }).strict()
    }).strict())
  }).strict(),
  decisionPolicyCatalog: z.object({
    version: nonEmptyString,
    definitions: z.array(z.object({
      id: nonEmptyString,
      version: nonEmptyString,
      kind: z.literal("artifact_acceptance"),
      completion: z.literal("all_assigned"),
      resolution: z.literal("unanimous")
    }).strict())
  }).strict(),
  runner: snapshotRunnerSchema,
  actors: z.record(snapshotActorSchema)
}).strict() as unknown as z.ZodType<ControlPlaneSnapshot, z.ZodTypeDef, unknown>;

export function parseControlPlaneConfig(value: unknown): ControlPlaneConfig {
  return controlPlaneConfigSchema.parse(value);
}
