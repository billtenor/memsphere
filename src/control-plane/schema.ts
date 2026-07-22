import { z } from "zod";
import { isPermissionId, type PermissionId } from "./catalog.js";
import type { ControlPlaneConfig, ControlPlaneRole, ControlPlaneSnapshot } from "./model.js";

const idPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const nonEmptyString = z.string().trim().min(1);

const identityIdSchema = nonEmptyString.regex(idPattern, "Identity id must contain only letters, numbers, dots, underscores, or hyphens");
const roleIdSchema = nonEmptyString.regex(idPattern, "Role id must contain only letters, numbers, dots, underscores, or hyphens");

const humanIdentitySchema = z.object({
  kind: z.literal("human"),
  name: nonEmptyString
}).strict();

const agentIdentitySchema = z.object({
  kind: z.literal("agent"),
  name: nonEmptyString,
  agent: z.object({
    provider: z.literal("traex").optional(),
    command: nonEmptyString,
    args: z.array(z.string()),
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
    provider: agent.provider,
    command: agent.command,
    args: [...agent.args],
    cwd: agent.cwd,
    model: agent.model,
    promptVersion: agent.prompt_version,
    startupTimeoutMs: agent.startup_timeout_ms,
    idleTimeoutMs: agent.idle_timeout_ms,
    maxRuntimeMs: agent.max_runtime_ms !== undefined ? agent.max_runtime_ms : agent.timeout_ms
  }))
}).strict();

const snapshotAgentIdentitySchema = z.object({
  kind: z.literal("agent"),
  name: nonEmptyString,
  agent: z.object({
    provider: nonEmptyString.optional(),
    command: nonEmptyString,
    args: z.array(z.string()),
    cwd: nonEmptyString.optional(),
    model: nonEmptyString.optional(),
    promptVersion: nonEmptyString.optional(),
    startupTimeoutMs: z.number().int().positive().optional(),
    idleTimeoutMs: z.number().int().positive().optional(),
    maxRuntimeMs: z.number().int().positive().nullable().optional(),
    timeoutMs: z.number().int().positive().optional()
  }).strict().superRefine((agent, context) => {
    if (agent.timeoutMs !== undefined && agent.maxRuntimeMs !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxRuntimeMs"],
        message: "maxRuntimeMs cannot be combined with legacy timeoutMs"
      });
    }
  }).transform((agent) => ({
    provider: agent.provider,
    command: agent.command,
    args: [...agent.args],
    cwd: agent.cwd,
    model: agent.model,
    promptVersion: agent.promptVersion,
    startupTimeoutMs: agent.startupTimeoutMs,
    idleTimeoutMs: agent.idleTimeoutMs,
    maxRuntimeMs: agent.maxRuntimeMs !== undefined ? agent.maxRuntimeMs : agent.timeoutMs
  }))
}).strict();

const controlPlaneIdentitySchema = z.discriminatedUnion("kind", [humanIdentitySchema, agentIdentitySchema]);

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

const roleInputSchema = z.object({
  name: nonEmptyString,
  permissions: permissionListSchema,
  grantable_permissions: permissionListSchema.optional(),
  system_prompt: z.string().superRefine((value, context) => {
    if (!value.trim()) context.addIssue({ code: z.ZodIssueCode.custom, message: "system_prompt must not be blank" });
  }).optional()
}).strict().superRefine((role, context) => {
  const base = new Set(role.permissions);
  for (const [index, permission] of (role.grantable_permissions ?? []).entries()) {
    if (!base.has(permission)) continue;
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["grantable_permissions", index],
      message: `Permission ${permission} is already granted by permissions`
    });
  }
}).transform((role): ControlPlaneRole => ({
  name: role.name,
  permissions: [...role.permissions],
  grantablePermissions: [...(role.grantable_permissions ?? [])],
  systemPrompt: role.system_prompt
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
  identities: recordWithValidatedKeys(identityIdSchema, controlPlaneIdentitySchema),
  roles: recordWithValidatedKeys(roleIdSchema, roleInputSchema)
}).strict().superRefine((controlPlane, context) => {
  if (!("runner" in controlPlane.roles)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["roles", "runner"],
      message: "control_plane must define the reserved runner Role"
    });
  }
});

const snapshotRoleSchema = z.object({
  name: nonEmptyString,
  permissions: permissionListSchema,
  grantablePermissions: permissionListSchema,
  systemPrompt: z.string().optional()
}).strict();

export const controlPlaneSnapshotSchema: z.ZodType<ControlPlaneSnapshot, z.ZodTypeDef, unknown> = z.object({
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
  identities: z.record(z.discriminatedUnion("kind", [humanIdentitySchema, snapshotAgentIdentitySchema])),
  roles: z.record(snapshotRoleSchema)
}).strict();

export function parseControlPlaneConfig(value: unknown): ControlPlaneConfig {
  return controlPlaneConfigSchema.parse(value);
}
