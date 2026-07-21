import { isPermissionId, type PermissionId } from "./catalog.js";
import type {
  ArtifactControlPlane,
  AuthorizationDecision,
  AuthorizationSubject,
  ControlPlaneSnapshot,
  PermissionGrants,
  ResolvedRoleBinding,
  ResolvedRoleBindings,
  ResolvedRolePermissions,
  RoleBindings
} from "./model.js";

export function mergeRoleBindings(
  parent: ResolvedRoleBindings,
  declarations: RoleBindings | undefined,
  source: string
): ResolvedRoleBindings {
  const result = structuredClone(parent);
  for (const [roleId, identityIds] of Object.entries(declarations ?? {})) {
    result[roleId] = { identityIds: [...identityIds], source };
  }
  return result;
}

export function resolveArtifactControlPlane(input: {
  snapshot: ControlPlaneSnapshot;
  procedureBindings: ResolvedRoleBindings;
  artifactBindings?: RoleBindings;
  permissionGrants?: PermissionGrants;
  artifactScope: string;
  artifactBindingSource: string;
  artifactGrantSource: string;
}): ArtifactControlPlane {
  const bindings = mergeRoleBindings(input.procedureBindings, input.artifactBindings, input.artifactBindingSource);
  const permissions: Record<string, ResolvedRolePermissions> = {};
  for (const [roleId, role] of Object.entries(input.snapshot.roles)) {
    const grants = [...(input.permissionGrants?.[roleId] ?? [])];
    permissions[roleId] = {
      base: [...role.permissions],
      grants,
      effective: [...new Set([...role.permissions, ...grants])].sort(),
      roleSource: `config:control_plane.roles.${roleId}`,
      grantSource: grants.length ? input.artifactGrantSource : undefined
    };
  }
  return {
    revision: input.snapshot.revision,
    artifactScope: input.artifactScope,
    bindings,
    permissions
  };
}

export function authorizeArtifactOperation(input: {
  controlPlane: ArtifactControlPlane;
  subject: AuthorizationSubject;
  permission: PermissionId;
}): AuthorizationDecision {
  const roleId = input.subject.kind === "runner" ? "runner" : input.subject.roleId;
  const rolePermissions = input.controlPlane.permissions[roleId];
  if (!rolePermissions) {
    return decision(input, roleId, undefined, "role_not_found", false);
  }
  if (input.subject.kind === "identity") {
    const binding = input.controlPlane.bindings[roleId];
    if (!binding?.identityIds.includes(input.subject.identityId)) {
      return decision(input, roleId, rolePermissions, "identity_not_bound", false, binding);
    }
  }
  const allowed = rolePermissions.effective.includes(input.permission);
  return decision(
    input,
    roleId,
    rolePermissions,
    allowed ? "allowed" : "permission_missing",
    allowed,
    input.controlPlane.bindings[roleId]
  );
}

export function validateControlPlaneReferences(input: {
  snapshot: ControlPlaneSnapshot;
  roleBindings?: RoleBindings;
  permissionGrants?: Record<string, string[]>;
  path: string;
}): { path: string; message: string }[] {
  const errors: { path: string; message: string }[] = [];
  for (const [roleId, identityIds] of Object.entries(input.roleBindings ?? {})) {
    if (roleId === "runner") errors.push({
      path: `${input.path}.role_bindings.runner`,
      message: "runner must not be explicitly bound"
    });
    if (!input.snapshot.roles[roleId]) errors.push({
      path: `${input.path}.role_bindings.${roleId}`,
      message: "unknown Role id"
    });
    for (const [index, identityId] of identityIds.entries()) {
      if (!input.snapshot.identities[identityId]) {
        errors.push({
          path: `${input.path}.role_bindings.${roleId}[${index}]`,
          message: `unknown Identity id ${identityId}`
        });
      }
    }
  }
  for (const [roleId, permissionIds] of Object.entries(input.permissionGrants ?? {})) {
    const role = input.snapshot.roles[roleId];
    if (!role) {
      errors.push({ path: `${input.path}.permission_grants.${roleId}`, message: "unknown Role id" });
      continue;
    }
    for (const [index, permissionId] of permissionIds.entries()) {
      if (!isPermissionId(permissionId)) {
        errors.push({
          path: `${input.path}.permission_grants.${roleId}[${index}]`,
          message: `unknown Permission id ${permissionId}`
        });
      } else if (!role.grantablePermissions.includes(permissionId)) {
        errors.push({
          path: `${input.path}.permission_grants.${roleId}[${index}]`,
          message: `Permission ${permissionId} exceeds grantable_permissions`
        });
      }
    }
  }
  return errors;
}

function decision(
  input: { controlPlane: ArtifactControlPlane; subject: AuthorizationSubject; permission: PermissionId },
  roleId: string,
  permissions: ResolvedRolePermissions | undefined,
  reason: AuthorizationDecision["reason"],
  allowed: boolean,
  binding?: ResolvedRoleBinding
): AuthorizationDecision {
  return {
    allowed,
    permission: input.permission,
    subject: input.subject,
    artifactScope: input.controlPlane.artifactScope,
    revision: input.controlPlane.revision,
    roleId,
    roleSource: binding?.source ?? permissions?.roleSource ?? `config:control_plane.roles.${roleId}`,
    grantSource: permissions?.grantSource,
    basePermissions: [...(permissions?.base ?? [])],
    grantedPermissions: [...(permissions?.grants ?? [])],
    effectivePermissions: [...(permissions?.effective ?? [])],
    reason
  };
}
