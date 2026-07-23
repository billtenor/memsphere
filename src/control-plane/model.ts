import type { PermissionId } from "./catalog.js";

export type PermissionLocale = "zh-CN" | "en";

export type LocalizedPermissionText = Readonly<Record<PermissionLocale, string>>;

export type HumanActorRuntime = {
  kind: "human";
};

export type AgentActorRuntime = {
  kind: "agent";
  agent: {
    provider?: string;
    command: string;
    args: string[];
    cwd?: string;
    model?: string;
    promptVersion?: string;
    startupTimeoutMs?: number;
    idleTimeoutMs?: number;
    maxRuntimeMs?: number | null;
  };
};

export type ControlPlaneActor = (HumanActorRuntime | AgentActorRuntime) & {
  name: string;
  permissions: PermissionId[];
  grantablePermissions: PermissionId[];
  systemPrompt?: string;
};

export type RunnerAuthority = {
  permissions: PermissionId[];
  grantablePermissions: PermissionId[];
};

export type ControlPlaneConfig = {
  runner: RunnerAuthority;
  actors: Record<string, ControlPlaneActor>;
};

export type SlotBindings = Record<string, { actorIds: string[]; source: string; skipped?: boolean }>;
export type PermissionGrants = Record<string, PermissionId[]>;

export type PermissionDefinitionSnapshot = {
  id: PermissionId;
  version: string;
  descriptions: LocalizedPermissionText;
};

export type DecisionPolicyDefinitionSnapshot = {
  id: string;
  version: string;
  kind: "artifact_acceptance";
  completion: "all_assigned";
  resolution: "unanimous";
};

export type ControlPlaneSnapshot = {
  contractVersion: 1;
  revision: string;
  permissionCatalog: {
    version: string;
    definitions: PermissionDefinitionSnapshot[];
  };
  decisionPolicyCatalog: {
    version: string;
    definitions: DecisionPolicyDefinitionSnapshot[];
  };
  runner: RunnerAuthority;
  actors: Record<string, ControlPlaneActor>;
};

export type ResolvedActorPermissions = {
  base: PermissionId[];
  grants: PermissionId[];
  effective: PermissionId[];
  authoritySource: string;
  grantSource?: string;
};

export type ArtifactControlPlane = {
  revision: string;
  artifactScope: string;
  policyId: string;
  bindings: SlotBindings;
  permissions: Record<string, ResolvedActorPermissions>;
};

export type AuthorizationSubject =
  | { kind: "runner" }
  | { kind: "actor"; actorId: string };

export type AuthorizationDecision = {
  allowed: boolean;
  permission: PermissionId;
  subject: AuthorizationSubject;
  artifactScope: string;
  revision: string;
  actorId: string;
  authoritySource: string;
  grantSource?: string;
  basePermissions: PermissionId[];
  grantedPermissions: PermissionId[];
  effectivePermissions: PermissionId[];
  reason: "allowed" | "actor_not_found" | "actor_not_bound" | "permission_missing";
};

export type PermissionGuidance = {
  allowed: boolean;
  locale: PermissionLocale;
  lines: string[];
  permissionIds: PermissionId[];
};

export type RunReviewConfiguration = {
  reviews: Record<string, {
    policy: string;
    permissionGrants: PermissionGrants;
  }>;
  slots: Record<string, { actorIds: string[] } | { skip: true }>;
};
