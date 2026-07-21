import type { PermissionId } from "./catalog.js";
import type {
  AuthorizationDecision,
  ControlPlaneSnapshot,
  PermissionGuidance,
  PermissionLocale,
  ResolvedRolePermissions
} from "./model.js";

export function renderPermissionGuidance(input: {
  snapshot: ControlPlaneSnapshot;
  roleId: string;
  permissions: ResolvedRolePermissions;
  artifactScope: string;
  locale?: PermissionLocale;
  decision?: AuthorizationDecision;
}): PermissionGuidance {
  const locale = input.locale ?? "en";
  const definitions = new Map(input.snapshot.permissionCatalog.definitions.map((definition) => [definition.id, definition]));
  const lines = input.permissions.effective.map((permission) => {
    const definition = definitions.get(permission);
    const description = definition?.descriptions[locale] ?? definition?.descriptions.en ?? permission;
    const granted = input.permissions.grants.includes(permission);
    return `- ${permission}${granted ? " (grant)" : ""}: ${description}`;
  });

  if (!lines.length) {
    lines.push(locale === "zh-CN"
      ? "- 当前 Role 在此 Artifact 下没有可执行的受控操作。"
      : "- This role has no permitted controlled operations for the current Artifact.");
  }

  if (input.decision && !input.decision.allowed) {
    lines.unshift(locale === "zh-CN"
      ? `拒绝：当前操作需要 ${input.decision.permission}，但 Role ${input.roleId} 不具备该权限。`
      : `Denied: this operation requires ${input.decision.permission}, which Role ${input.roleId} does not have.`);
  } else if (input.decision?.allowed) {
    lines.unshift(locale === "zh-CN"
      ? `允许：当前操作使用 ${input.decision.permission} 权限。`
      : `Allowed: this operation uses the ${input.decision.permission} permission.`);
  }

  lines.unshift(locale === "zh-CN"
    ? `当前 Artifact：${input.artifactScope}；Role：${input.roleId}；权限依据：${input.permissions.roleSource}${input.permissions.grantSource ? `，Grant：${input.permissions.grantSource}` : ""}。`
    : `Current Artifact: ${input.artifactScope}; Role: ${input.roleId}; authority: ${input.permissions.roleSource}${input.permissions.grantSource ? `; grant: ${input.permissions.grantSource}` : ""}.`);

  return {
    allowed: input.decision?.allowed ?? true,
    locale,
    lines,
    permissionIds: [...input.permissions.effective] as PermissionId[]
  };
}
