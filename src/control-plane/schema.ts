import { z } from "zod";
import {
  acpProviderTypes,
  defaultAcpProviderInstance,
  defaultAcpProviderInstances,
  type AcpProviderInstance,
  type AcpProviderType
} from "../acp/catalog.js";
import {
  AcpProviderConfigurationError,
  validateAcpProviderConfiguration
} from "../acp/validation.js";
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

const providerIdSchema = nonEmptyString.regex(
  idPattern,
  "ACP Provider id must contain only letters, numbers, dots, underscores, or hyphens"
);
const providerTypeSchema = z.enum(acpProviderTypes);
const providerEnvironmentSchema = z.record(z.string()).superRefine((environment, context) => {
  for (const name of Object.keys(environment)) {
    const normalizedName = name.toUpperCase();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [name], message: "Invalid environment variable name" });
      continue;
    }
    if (
      name.startsWith("MEMSPHERE_")
      || /(?:TOKEN|SECRET|PASSWORD|COOKIE|AUTHORIZATION|API_?KEY|CREDENTIAL)/i.test(name)
      || [
        "PATH",
        "PATHEXT",
        "HOME",
        "USERPROFILE",
        "HOMEDRIVE",
        "HOMEPATH",
        "APPDATA",
        "LOCALAPPDATA",
        "COMSPEC",
        "SYSTEMROOT",
        "CODEX_HOME",
        "TRAE_HOME",
        "KIMI_HOME",
        "QWEN_HOME",
        "CODEX_CONFIG",
        "NO_BROWSER",
        "INITIAL_AGENT_MODE",
        "NODE_OPTIONS",
        "LD_PRELOAD",
        "LD_LIBRARY_PATH"
      ].includes(normalizedName)
      || normalizedName.startsWith("XDG_")
      || normalizedName.startsWith("DYLD_")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [name],
        message: `ACP Provider environment variable is reserved or sensitive: ${name}`
      });
    }
  }
});

function providerInstanceInputSchema(type: AcpProviderType) {
  return z.object({
  args: z.array(z.string()).optional(),
  env: providerEnvironmentSchema.optional(),
  startup_timeout_ms: z.number().int().positive().optional(),
  idle_timeout_ms: z.number().int().positive().optional(),
  max_runtime_ms: z.number().int().positive().nullable().optional()
}).strict().superRefine((input, context) => {
  const defaults = defaultAcpProviderInstance(type);
  try {
    validateAcpProviderConfiguration({
      type,
      command: defaults.command,
      args: input.args ?? defaults.args
    });
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [error instanceof AcpProviderConfigurationError ? error.field : "args"],
      message: error instanceof Error ? error.message : String(error)
    });
  }
}).transform((input): AcpProviderInstance => {
  const defaults = defaultAcpProviderInstance(type);
  return {
    type,
    command: defaults.command,
    args: [...(input.args ?? defaults.args)],
    env: { ...(input.env ?? defaults.env) },
    startupTimeoutMs: input.startup_timeout_ms ?? defaults.startupTimeoutMs,
    idleTimeoutMs: input.idle_timeout_ms ?? defaults.idleTimeoutMs,
    maxRuntimeMs: input.max_runtime_ms === undefined ? defaults.maxRuntimeMs : input.max_runtime_ms
  };
});
}

const providerInstancesInputSchema = z.object({
  traex: providerInstanceInputSchema("traex").optional(),
  qwen: providerInstanceInputSchema("qwen").optional(),
  kimi: providerInstanceInputSchema("kimi").optional(),
  codex: providerInstanceInputSchema("codex").optional()
}).strict();

const agentRuntimeInputSchema = z.object({
  provider: providerIdSchema.optional(),
  model: nonEmptyString.optional()
}).strict();

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
]);

type ActorInput = z.infer<typeof actorInputSchema>;

function resolveActor(
  actor: ActorInput,
  providers: Record<string, AcpProviderInstance>
): ControlPlaneActor {
  const authority = {
    name: actor.name,
    permissions: [...actor.permissions],
    systemPrompt: actor.system_prompt
  };
  if (actor.kind === "human") return { kind: "human", ...authority };
  const provider = actor.agent.provider ?? "traex";
  const instance = providers[provider];
  if (!instance) throw new Error(`Unknown ACP Provider id: ${provider}`);
  return {
    kind: "agent",
    ...authority,
    agent: {
      provider,
      providerType: instance.type,
      command: instance.command,
      args: [...instance.args],
      env: { ...instance.env },
      model: actor.agent.model,
      startupTimeoutMs: instance.startupTimeoutMs,
      idleTimeoutMs: instance.idleTimeoutMs,
      maxRuntimeMs: instance.maxRuntimeMs
    }
  };
}

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

const controlPlaneInputSchema = z.object({
  runner: runnerInputSchema,
  acp_providers: providerInstancesInputSchema.optional(),
  actors: recordWithValidatedKeys(actorIdSchema, actorInputSchema)
}).strict().superRefine((controlPlane, context) => {
  const providers = { ...defaultAcpProviderInstances(), ...(controlPlane.acp_providers ?? {}) };
  for (const [actorId, actor] of Object.entries(controlPlane.actors)) {
    if (actor.kind !== "agent") continue;
    const provider = actor.agent.provider ?? "traex";
    if (!Object.hasOwn(providers, provider)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actors", actorId, "agent", "provider"],
        message: `Unknown ACP Provider id: ${provider}`
      });
    }
  }
}).transform((controlPlane): ControlPlaneConfig => {
  const acpProviders = { ...defaultAcpProviderInstances(), ...(controlPlane.acp_providers ?? {}) };
  return {
    runner: controlPlane.runner,
    acpProviders,
    actors: Object.fromEntries(
      Object.entries(controlPlane.actors).map(([id, actor]) => [id, resolveActor(actor, acpProviders)])
    )
  };
});

export const controlPlaneConfigSchema: z.ZodType<ControlPlaneConfig, z.ZodTypeDef, unknown> =
  controlPlaneInputSchema;

const snapshotAgentRuntimeSchema = z.object({
  provider: nonEmptyString.optional(),
  providerType: providerTypeSchema.optional(),
  command: nonEmptyString,
  args: z.array(z.string()),
  env: z.record(z.string()).optional(),
  cwd: nonEmptyString.optional(),
  model: nonEmptyString.optional(),
  promptVersion: nonEmptyString.optional(),
  startupTimeoutMs: z.number().int().positive().optional(),
  idleTimeoutMs: z.number().int().positive().optional(),
  maxRuntimeMs: z.number().int().positive().nullable().optional()
}).strict().transform((agent) => ({
  provider: agent.provider ?? "traex",
  providerType: agent.providerType ?? (
    acpProviderTypes.includes(agent.provider as AcpProviderType)
      ? agent.provider as AcpProviderType
      : "traex"
  ),
  command: agent.command,
  args: [...agent.args],
  env: { ...(agent.env ?? {}) },
  model: agent.model,
  startupTimeoutMs: agent.startupTimeoutMs ?? 60_000,
  idleTimeoutMs: agent.idleTimeoutMs ?? 120_000,
  maxRuntimeMs: agent.maxRuntimeMs ?? null
}));

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
