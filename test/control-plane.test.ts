import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeArtifactOperation,
  createControlPlaneSnapshot,
  listDecisionPolicyDefinitions,
  listPermissionDefinitions,
  mergeRoleBindings,
  parseControlPlaneConfig,
  renderPermissionGuidance,
  requireDecisionPolicyDefinition,
  requirePermissionDefinition,
  resolveArtifactControlPlane
} from "../src/control-plane/index.js";

const rawConfig = {
  identities: {
    human: { kind: "human", name: "Human" },
    agent: { kind: "agent", name: "Agent", agent: { command: "codex", args: ["acp"] } }
  },
  roles: {
    runner: {
      name: "Runner",
      permissions: ["artifact.read", "artifact.submit"],
      grantable_permissions: ["decision.decide"]
    },
    reviewer: {
      name: "Reviewer",
      permissions: ["artifact.read", "decision.assess"],
      system_prompt: "Review independently."
    }
  }
};

test("built-in control plane catalogs are complete and reject unknown ids", () => {
  const permissions = listPermissionDefinitions();
  assert.equal(permissions.length, 7);
  assert(permissions.every((definition) => definition.descriptions.en && definition.descriptions["zh-CN"]));
  assert.equal(requirePermissionDefinition("artifact.submit").id, "artifact.submit");
  assert.throws(() => requirePermissionDefinition("artifact.delete"), /Unknown Permission/);

  assert.equal(listDecisionPolicyDefinitions().length, 1);
  assert.equal(requireDecisionPolicyDefinition("artifact_acceptance.unanimous").resolution, "unanimous");
  assert.throws(() => requireDecisionPolicyDefinition("artifact_acceptance.majority"), /Unknown Decision Policy/);
});

test("control plane config is strict and rejects credentials and invalid permissions", () => {
  const parsed = parseControlPlaneConfig(rawConfig);
  assert.deepEqual(parsed.roles.runner.grantablePermissions, ["decision.decide"]);
  assert.equal(parsed.roles.reviewer.systemPrompt, "Review independently.");

  assert.throws(() => parseControlPlaneConfig({ ...rawConfig, roles: { reviewer: rawConfig.roles.reviewer } }), /reserved runner/);
  assert.throws(() => parseControlPlaneConfig({
    ...rawConfig,
    identities: {
      agent: {
        kind: "agent",
        name: "Agent",
        agent: { command: "codex", args: [], env: { API_KEY: "secret" } }
      }
    }
  }), /Unrecognized key.*env/);
  assert.throws(() => parseControlPlaneConfig({
    ...rawConfig,
    roles: { runner: { name: "Runner", permissions: ["artifact.delete"] } }
  }), /Unknown Permission/);
  assert.throws(() => parseControlPlaneConfig({
    ...rawConfig,
    roles: { runner: { name: "Runner", permissions: ["artifact.read", "artifact.read"] } }
  }), /Duplicate Permission/);
  assert.throws(() => parseControlPlaneConfig({
    ...rawConfig,
    roles: {
      runner: {
        name: "Runner",
        permissions: ["artifact.read"],
        grantable_permissions: ["artifact.read"]
      }
    }
  }), /already granted/);
});

test("control plane snapshots and revisions are deterministic", () => {
  const first = createControlPlaneSnapshot(parseControlPlaneConfig(rawConfig));
  const second = createControlPlaneSnapshot(parseControlPlaneConfig({
    roles: { reviewer: rawConfig.roles.reviewer, runner: rawConfig.roles.runner },
    identities: { agent: rawConfig.identities.agent, human: rawConfig.identities.human }
  }));
  assert.equal(first.revision, second.revision);
  assert.match(first.revision, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.roles.reviewer.systemPrompt, "Review independently.");
  assert.equal(JSON.stringify(first).includes("API_KEY"), false);
});

test("Artifact binding overrides and grants produce default-deny authorization and guidance", () => {
  const snapshot = createControlPlaneSnapshot(parseControlPlaneConfig(rawConfig));
  const caller = mergeRoleBindings({}, { reviewer: ["human"] }, "procedure:caller");
  const callee = mergeRoleBindings(caller, { reviewer: ["agent"] }, "procedure:callee");
  const controlPlane = resolveArtifactControlPlane({
    snapshot,
    procedureBindings: callee,
    artifactBindings: { reviewer: ["human", "agent"] },
    permissionGrants: { runner: ["decision.decide"] },
    artifactScope: "flow[1].artifact",
    artifactBindingSource: "artifact:flow[1]",
    artifactGrantSource: "artifact:flow[1]"
  });

  assert.deepEqual(controlPlane.bindings.reviewer, {
    identityIds: ["human", "agent"],
    source: "artifact:flow[1]"
  });
  assert.deepEqual(controlPlane.permissions.runner.effective, ["artifact.read", "artifact.submit", "decision.decide"]);

  const allowed = authorizeArtifactOperation({ controlPlane, subject: { kind: "runner" }, permission: "artifact.submit" });
  assert.equal(allowed.allowed, true);
  assert.deepEqual(allowed.basePermissions, ["artifact.read", "artifact.submit"]);
  assert.deepEqual(allowed.grantedPermissions, ["decision.decide"]);
  const denied = authorizeArtifactOperation({ controlPlane, subject: { kind: "runner" }, permission: "decision.override" });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "permission_missing");
  const unbound = authorizeArtifactOperation({
    controlPlane,
    subject: { kind: "identity", identityId: "human", roleId: "missing-role" },
    permission: "artifact.read"
  });
  assert.equal(unbound.reason, "role_not_found");

  const guidance = renderPermissionGuidance({
    snapshot,
    roleId: "runner",
    permissions: controlPlane.permissions.runner,
    artifactScope: controlPlane.artifactScope,
    locale: "zh-CN",
    decision: denied
  });
  assert.equal(guidance.allowed, false);
  assert.match(guidance.lines.join("\n"), /缺少|需要 decision\.override/);
  assert.match(guidance.lines.join("\n"), /artifact\.submit/);
  assert.match(guidance.lines.join("\n"), /decision\.decide \(grant\)/);

  const allowedGuidance = renderPermissionGuidance({
    snapshot,
    roleId: "runner",
    permissions: controlPlane.permissions.runner,
    artifactScope: controlPlane.artifactScope,
    locale: "zh-CN",
    decision: allowed
  });
  assert.match(allowedGuidance.lines.join("\n"), /允许：当前操作使用 artifact\.submit 权限/);
});
