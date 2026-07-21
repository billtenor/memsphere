import { createHash } from "node:crypto";
import {
  decisionPolicyCatalogVersion,
  listDecisionPolicyDefinitions,
  listPermissionDefinitions,
  permissionCatalogVersion
} from "./catalog.js";
import type { ControlPlaneConfig, ControlPlaneIdentity, ControlPlaneRole, ControlPlaneSnapshot } from "./model.js";

export function createControlPlaneSnapshot(config: ControlPlaneConfig): ControlPlaneSnapshot {
  const payload = {
    permissionCatalog: {
      version: permissionCatalogVersion,
      definitions: listPermissionDefinitions().sort((left, right) => left.id.localeCompare(right.id))
    },
    decisionPolicyCatalog: {
      version: decisionPolicyCatalogVersion,
      definitions: listDecisionPolicyDefinitions().sort((left, right) => left.id.localeCompare(right.id))
    },
    identities: sortRecord(config.identities, normalizeIdentity),
    roles: sortRecord(config.roles, normalizeRole)
  };
  const canonical = JSON.stringify(canonicalize(payload));
  return {
    contractVersion: 1,
    revision: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
    ...structuredClone(payload)
  };
}

function normalizeIdentity(identity: ControlPlaneIdentity): ControlPlaneIdentity {
  return identity.kind === "human"
    ? { kind: "human", name: identity.name }
    : {
        kind: "agent",
        name: identity.name,
        agent: { command: identity.agent.command, args: [...identity.agent.args] }
      };
}

function normalizeRole(role: ControlPlaneRole): ControlPlaneRole {
  return {
    name: role.name,
    permissions: [...new Set(role.permissions)].sort(),
    grantablePermissions: [...new Set(role.grantablePermissions)].sort(),
    systemPrompt: role.systemPrompt
  };
}

function sortRecord<T, U>(record: Record<string, T>, normalize: (value: T) => U): Record<string, U> {
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, normalize(record[key])]));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}
