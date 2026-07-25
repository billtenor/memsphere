import type { PermissionId } from "./catalog.js";
import type {
  AuthorizationDecision,
  ControlPlaneSnapshot,
  PermissionGuidance,
  PermissionLocale,
  ResolvedActorPermissions
} from "./model.js";
import type { PermissionGuidancePromptModel } from "../prompts/models.js";
import { renderPrompt } from "../prompts/renderer.js";

type PermissionGuidanceInput = {
  snapshot: ControlPlaneSnapshot;
  actorId: string;
  permissions: ResolvedActorPermissions;
  artifactScope: string;
  locale?: PermissionLocale;
  decision?: AuthorizationDecision;
};

export function buildPermissionGuidancePromptModel(
  input: PermissionGuidanceInput
): PermissionGuidancePromptModel {
  const locale = input.locale ?? "en";
  const definitions = new Map(input.snapshot.permissionCatalog.definitions.map((definition) => [definition.id, definition]));
  const permissions = input.permissions.effective.map((permission) => {
    const definition = definitions.get(permission);
    const description = definition?.descriptions[locale] ?? definition?.descriptions.en ?? permission;
    return { id: permission, description };
  });
  return {
    locale,
    artifactScope: input.artifactScope,
    actorId: input.actorId,
    authoritySource: input.permissions.authoritySource,
    decision: input.decision ? {
      allowed: input.decision.allowed,
      permission: input.decision.permission
    } : undefined,
    permissions
  };
}

export function renderPermissionGuidance(input: PermissionGuidanceInput): PermissionGuidance {
  const locale = input.locale ?? "en";
  const lines = renderPrompt(
    "control-plane.permission-guidance",
    locale,
    buildPermissionGuidancePromptModel(input)
  ).split("\n");

  return {
    allowed: input.decision?.allowed ?? true,
    locale,
    lines,
    permissionIds: [...input.permissions.effective] as PermissionId[]
  };
}
