import type {
  DecisionPolicyDefinitionSnapshot,
  PermissionDefinitionSnapshot
} from "./model.js";
import { renderPrompt } from "../prompts/renderer.js";

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

const permissionDefinitions = permissionIds.map((id): PermissionDefinitionSnapshot => deepFreeze({
  id,
  version: "1",
  descriptions: {
    "zh-CN": renderPrompt("control-plane.permission-description", "zh-CN", { id }),
    en: renderPrompt("control-plane.permission-description", "en", { id })
  }
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
