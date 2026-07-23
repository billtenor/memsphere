import { createHash } from "node:crypto";
import {
  decisionPolicyCatalogVersion,
  listDecisionPolicyDefinitions,
  listPermissionDefinitions,
  permissionCatalogVersion
} from "./catalog.js";
import type { ControlPlaneActor, ControlPlaneConfig, ControlPlaneSnapshot } from "./model.js";

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
    runner: {
      permissions: [...new Set(config.runner.permissions)].sort(),
      grantablePermissions: [...new Set(config.runner.grantablePermissions)].sort()
    },
    actors: sortRecord(config.actors, normalizeActor)
  };
  const canonical = JSON.stringify(canonicalize(payload));
  return {
    contractVersion: 1,
    revision: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
    ...structuredClone(payload)
  };
}

function normalizeActor(actor: ControlPlaneActor): ControlPlaneActor {
  const authority = {
    name: actor.name,
    permissions: [...new Set(actor.permissions)].sort(),
    grantablePermissions: [...new Set(actor.grantablePermissions)].sort(),
    systemPrompt: actor.systemPrompt
  };
  return actor.kind === "human"
    ? { kind: "human", ...authority }
    : {
        kind: "agent",
        ...authority,
        agent: {
          provider: actor.agent.provider,
          command: actor.agent.command,
          args: [...actor.agent.args],
          cwd: actor.agent.cwd,
          model: actor.agent.model,
          promptVersion: actor.agent.promptVersion,
          startupTimeoutMs: actor.agent.startupTimeoutMs,
          idleTimeoutMs: actor.agent.idleTimeoutMs,
          maxRuntimeMs: actor.agent.maxRuntimeMs
        }
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
