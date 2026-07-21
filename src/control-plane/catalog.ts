import type {
  DecisionPolicyDefinitionSnapshot,
  LocalizedPermissionText,
  PermissionDefinitionSnapshot
} from "./model.js";

export const permissionIds = [
  "artifact.read",
  "artifact.write",
  "artifact.submit",
  "decision.assess",
  "decision.challenge",
  "decision.decide",
  "decision.override"
] as const;

export type PermissionId = (typeof permissionIds)[number];

export const permissionCatalogVersion = "memsphere-permissions-20260721";
export const decisionPolicyCatalogVersion = "memsphere-decision-policies-20260721";

const descriptions: Readonly<Record<PermissionId, LocalizedPermissionText>> = {
  "artifact.read": {
    "zh-CN": "你可以通过 Memsphere 读取当前 Artifact 及其 Review 上下文。",
    en: "You may read the current Artifact and its review context through Memsphere."
  },
  "artifact.write": {
    "zh-CN": "你可以通过 Memsphere 写入当前 Artifact 的候选内容；这不代表任意操作系统文件写权限。",
    en: "You may write candidate content for the current Artifact through Memsphere; this does not grant arbitrary operating-system file access."
  },
  "artifact.submit": {
    "zh-CN": "你可以通过 run report 提交当前 Artifact。",
    en: "You may submit the current Artifact through run report."
  },
  "decision.assess": {
    "zh-CN": "你可以对当前 Artifact 提交评估意见。",
    en: "You may submit an assessment of the current Artifact."
  },
  "decision.challenge": {
    "zh-CN": "你可以要求当前 Artifact 进入下一轮修改。",
    en: "You may require the current Artifact to enter another revision round."
  },
  "decision.decide": {
    "zh-CN": "你可以按当前 Review Policy 对 Artifact 作出正式决定。",
    en: "You may make a formal decision on the Artifact under the active review policy."
  },
  "decision.override": {
    "zh-CN": "你可以在 Review Policy 允许的入口覆盖既有决定。",
    en: "You may override an existing decision through an entry point allowed by the review policy."
  }
};

const permissionDefinitions = permissionIds.map((id): PermissionDefinitionSnapshot => deepFreeze({
  id,
  version: "1",
  descriptions: { ...descriptions[id] }
}));

const permissionDefinitionsById = new Map(permissionDefinitions.map((definition) => [definition.id, definition]));

const decisionPolicyDefinitions: DecisionPolicyDefinitionSnapshot[] = [deepFreeze({
  id: "artifact_acceptance.unanimous",
  version: "1",
  kind: "artifact_acceptance",
  completion: "all_assigned",
  resolution: "unanimous"
})];

const decisionPolicyDefinitionsById = new Map(decisionPolicyDefinitions.map((definition) => [definition.id, definition]));

export function isPermissionId(value: string): value is PermissionId {
  return permissionDefinitionsById.has(value as PermissionId);
}

export function listPermissionDefinitions(): PermissionDefinitionSnapshot[] {
  return permissionDefinitions.map((definition) => structuredClone(definition));
}

export function requirePermissionDefinition(id: string): PermissionDefinitionSnapshot {
  const definition = permissionDefinitionsById.get(id as PermissionId);
  if (!definition) throw new Error(`Unknown Permission id: ${id}`);
  return structuredClone(definition);
}

export function listDecisionPolicyDefinitions(): DecisionPolicyDefinitionSnapshot[] {
  return decisionPolicyDefinitions.map((definition) => structuredClone(definition));
}

export function requireDecisionPolicyDefinition(id: string): DecisionPolicyDefinitionSnapshot {
  const definition = decisionPolicyDefinitionsById.get(id);
  if (!definition) throw new Error(`Unknown Decision Policy id: ${id}`);
  return structuredClone(definition);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
