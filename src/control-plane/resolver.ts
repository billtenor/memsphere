import type { PermissionId } from "./catalog.js";
import type {
  ArtifactControlPlane,
  AuthorizationDecision,
  AuthorizationSubject,
  ControlPlaneSnapshot,
  ResolvedActorPermissions,
  SlotBindings
} from "./model.js";

export function resolveArtifactControlPlane(input: {
  snapshot: ControlPlaneSnapshot;
  slotBindings: SlotBindings;
  artifactScope: string;
  policyId: string;
}): ArtifactControlPlane {
  const permissions: Record<string, ResolvedActorPermissions> = {
    runner: {
      base: [...input.snapshot.runner.permissions],
      grants: [],
      effective: [...new Set(input.snapshot.runner.permissions)].sort(),
      authoritySource: "config:control_plane.runner"
    }
  };
  for (const [actorId, actor] of Object.entries(input.snapshot.actors)) {
    permissions[actorId] = {
      base: [...actor.permissions],
      grants: [],
      effective: [...new Set(actor.permissions)].sort(),
      authoritySource: `config:control_plane.actors.${actorId}`
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
