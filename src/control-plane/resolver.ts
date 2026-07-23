import { isPermissionId, type PermissionId } from "./catalog.js";
import type {
  ArtifactControlPlane,
  AuthorizationDecision,
  AuthorizationSubject,
  ControlPlaneSnapshot,
  PermissionGrants,
  ResolvedActorPermissions,
  SlotBindings
} from "./model.js";

export function resolveArtifactControlPlane(input: {
  snapshot: ControlPlaneSnapshot;
  slotBindings: SlotBindings;
  permissionGrants?: PermissionGrants;
  artifactScope: string;
  policyId: string;
  grantSource: string;
}): ArtifactControlPlane {
  const runnerGrants = [...(input.permissionGrants?.runner ?? [])];
  const permissions: Record<string, ResolvedActorPermissions> = {
    runner: {
      base: [...input.snapshot.runner.permissions],
      grants: runnerGrants,
      effective: [...new Set([...input.snapshot.runner.permissions, ...runnerGrants])].sort(),
      authoritySource: "config:control_plane.runner",
      grantSource: runnerGrants.length ? input.grantSource : undefined
    }
  };
  for (const [actorId, actor] of Object.entries(input.snapshot.actors)) {
    const grants = [...(input.permissionGrants?.[actorId] ?? [])];
    permissions[actorId] = {
      base: [...actor.permissions],
      grants,
      effective: [...new Set([...actor.permissions, ...grants])].sort(),
      authoritySource: `config:control_plane.actors.${actorId}`,
      grantSource: grants.length ? input.grantSource : undefined
    };
  }
  return {
    revision: input.snapshot.revision,
    artifactScope: input.artifactScope,
    policyId: input.policyId,
    bindings: structuredClone(input.slotBindings),
    permissions
  };
}

export function authorizeArtifactOperation(input: {
  controlPlane: ArtifactControlPlane;
  subject: AuthorizationSubject;
  permission: PermissionId;
}): AuthorizationDecision {
  const actorId = input.subject.kind === "runner" ? "runner" : input.subject.actorId;
  const actorPermissions = input.controlPlane.permissions[actorId];
  if (!actorPermissions) {
    return decision(input, actorId, undefined, "actor_not_found", false);
  }
  if (input.subject.kind === "actor") {
    const actorId = input.subject.actorId;
    const bound = Object.values(input.controlPlane.bindings)
      .some((binding) => !binding.skipped && binding.actorIds.includes(actorId));
    if (!bound) return decision(input, actorId, actorPermissions, "actor_not_bound", false);
  }
  const allowed = actorPermissions.effective.includes(input.permission);
  return decision(input, actorId, actorPermissions, allowed ? "allowed" : "permission_missing", allowed);
}

export function validateActorGrants(input: {
  snapshot: ControlPlaneSnapshot;
  permissionGrants?: Record<string, string[]>;
  path: string;
}): { path: string; message: string }[] {
  const errors: { path: string; message: string }[] = [];
  for (const [actorId, permissionIds] of Object.entries(input.permissionGrants ?? {})) {
    const actor = actorId === "runner" ? input.snapshot.runner : input.snapshot.actors[actorId];
    if (!actor) {
      errors.push({ path: `${input.path}.permission_grants.${actorId}`, message: "unknown Actor id" });
      continue;
    }
    for (const [index, permissionId] of permissionIds.entries()) {
      if (!isPermissionId(permissionId)) {
        errors.push({
          path: `${input.path}.permission_grants.${actorId}[${index}]`,
          message: `unknown Permission id ${permissionId}`
        });
      } else if (!actor.grantablePermissions.includes(permissionId)) {
        errors.push({
          path: `${input.path}.permission_grants.${actorId}[${index}]`,
          message: `Permission ${permissionId} exceeds grantable_permissions`
        });
      }
    }
  }
  return errors;
}

function decision(
  input: { controlPlane: ArtifactControlPlane; subject: AuthorizationSubject; permission: PermissionId },
  actorId: string,
  permissions: ResolvedActorPermissions | undefined,
  reason: AuthorizationDecision["reason"],
  allowed: boolean
): AuthorizationDecision {
  return {
    allowed,
    permission: input.permission,
    subject: input.subject,
    artifactScope: input.controlPlane.artifactScope,
    revision: input.controlPlane.revision,
    actorId,
    authoritySource: permissions?.authoritySource ?? `config:control_plane.actors.${actorId}`,
    grantSource: permissions?.grantSource,
    basePermissions: [...(permissions?.base ?? [])],
    grantedPermissions: [...(permissions?.grants ?? [])],
    effectivePermissions: [...(permissions?.effective ?? [])],
    reason
  };
}
