import type { PermissionId } from "./catalog.js";

export type PermissionLocale = "zh-CN" | "en";

export type LocalizedPermissionText = Readonly<Record<PermissionLocale, string>>;

export type HumanIdentity = {
  kind: "human";
  name: string;
};

export type AgentIdentity = {
  kind: "agent";
  name: string;
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

export type ControlPlaneIdentity = HumanIdentity | AgentIdentity;

export type ControlPlaneRole = {
  name: string;
  permissions: PermissionId[];
  grantablePermissions: PermissionId[];
  systemPrompt?: string;
};

export type ControlPlaneConfig = {
  identities: Record<string, ControlPlaneIdentity>;
  roles: Record<string, ControlPlaneRole>;
};

export type RoleBindings = Record<string, string[]>;
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
  identities: Record<string, ControlPlaneIdentity>;
  roles: Record<string, ControlPlaneRole>;
};

export type ResolvedRoleBinding = {
  identityIds: string[];
  source: string;
};

export type ResolvedRoleBindings = Record<string, ResolvedRoleBinding>;

export type ResolvedRolePermissions = {
  base: PermissionId[];
  grants: PermissionId[];
  effective: PermissionId[];
  roleSource: string;
  grantSource?: string;
};

export type ArtifactControlPlane = {
  revision: string;
  artifactScope: string;
  bindings: ResolvedRoleBindings;
  permissions: Record<string, ResolvedRolePermissions>;
};

export type AuthorizationSubject =
  | { kind: "runner" }
  | { kind: "identity"; identityId: string; roleId: string };

export type AuthorizationDecision = {
  allowed: boolean;
  permission: PermissionId;
  subject: AuthorizationSubject;
  artifactScope: string;
  revision: string;
  roleId: string;
  roleSource: string;
  grantSource?: string;
  basePermissions: PermissionId[];
  grantedPermissions: PermissionId[];
  effectivePermissions: PermissionId[];
  reason: "allowed" | "role_not_found" | "identity_not_bound" | "permission_missing";
};

export type PermissionGuidance = {
  allowed: boolean;
  locale: PermissionLocale;
  lines: string[];
  permissionIds: PermissionId[];
};
