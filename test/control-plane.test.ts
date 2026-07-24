import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeArtifactOperation,
  createControlPlaneSnapshot,
  listDecisionPolicyDefinitions,
  listPermissionDefinitions,
  parseControlPlaneConfig,
  renderPermissionGuidance,
  requireDecisionPolicyDefinition,
  requirePermissionDefinition,
  resolveArtifactControlPlane
} from "../src/control-plane/index.js";

const rawConfig = {
  runner: {
    permissions: ["artifact.read", "artifact.submit", "decision.decide"]
  },
  actors: {
    human: {
      kind: "human",
      name: "Human",
      permissions: ["artifact.read", "decision.decide"]
    },
    agent: {
      kind: "agent",
      name: "Agent",
      permissions: ["artifact.read", "decision.assess"],
      system_prompt: "Review independently.",
      agent: {
        provider: "traex",
        command: "traecli",
        args: [],
        cwd: ".",
        model: "review-model",
        prompt_version: "artifact-review-v1",
        startup_timeout_ms: 10000,
        idle_timeout_ms: 30000,
        max_runtime_ms: null
      }
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

test("control plane config parses Runner and Actors strictly", () => {
  const parsed = parseControlPlaneConfig(rawConfig);
  assert.deepEqual(parsed.runner.permissions, ["artifact.read", "artifact.submit", "decision.decide"]);
  assert.equal(parsed.actors.agent.systemPrompt, "Review independently.");
  assert.deepEqual(parsed.actors.agent.kind === "agent" ? parsed.actors.agent.agent : undefined, {
    provider: "traex",
    command: "traecli",
    args: [],
    cwd: ".",
    model: "review-model",
    promptVersion: "artifact-review-v1",
    startupTimeoutMs: 10000,
    idleTimeoutMs: 30000,
    maxRuntimeMs: null
  });

  assert.throws(() => parseControlPlaneConfig({
    ...rawConfig,
    identities: {}
  }), /Unrecognized key.*identities/);
  assert.throws(() => parseControlPlaneConfig({
    ...rawConfig,
    actors: {
      agent: {
        ...rawConfig.actors.agent,
        agent: { command: "traecli", args: [], env: { API_KEY: "secret" } }
      }
    }
  }), /Unrecognized key.*env/);
  assert.throws(() => parseControlPlaneConfig({
    ...rawConfig,
    runner: { permissions: ["artifact.delete"] }
  }), /Unknown Permission/);
  assert.throws(() => parseControlPlaneConfig({
    ...rawConfig,
    runner: { permissions: ["artifact.read", "artifact.read"] }
  }), /Duplicate Permission/);
});

test("Agent configuration defaults Provider-owned runtime details", () => {
  const parsed = parseControlPlaneConfig({
    runner: { permissions: [] },
    actors: {
      reviewer: {
        kind: "agent",
        name: "Reviewer",
        permissions: ["artifact.read"],
        agent: { provider: "traex", model: "review-model" }
      }
    }
  });
  assert.deepEqual(parsed.actors.reviewer.kind === "agent" ? parsed.actors.reviewer.agent : undefined, {
    provider: "traex",
    command: "traecli",
    args: [],
    cwd: undefined,
    model: "review-model",
    promptVersion: undefined,
    startupTimeoutMs: undefined,
    idleTimeoutMs: undefined,
    maxRuntimeMs: undefined
  });
});

test("control plane snapshots and revisions are deterministic", () => {
  const first = createControlPlaneSnapshot(parseControlPlaneConfig(rawConfig));
  const second = createControlPlaneSnapshot(parseControlPlaneConfig({
    actors: { agent: rawConfig.actors.agent, human: rawConfig.actors.human },
    runner: rawConfig.runner
  }));
  assert.equal(first.revision, second.revision);
  assert.match(first.revision, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.actors.agent.systemPrompt, "Review independently.");
  assert.equal(JSON.stringify(first).includes("API_KEY"), false);
});

test("Slot bindings and Actor permissions produce default-deny authorization and guidance", () => {
  const snapshot = createControlPlaneSnapshot(parseControlPlaneConfig(rawConfig));
  const controlPlane = resolveArtifactControlPlane({
    snapshot,
    slotBindings: {
      "fixture::reviewer": { actorIds: ["human", "agent"], source: "run:fixture::reviewer" }
    },
    artifactScope: "fixture#flow[1]",
    policyId: "artifact_acceptance.unanimous"
  });

  assert.deepEqual(controlPlane.bindings["fixture::reviewer"].actorIds, ["human", "agent"]);
  assert.deepEqual(controlPlane.permissions.human.effective, ["artifact.read", "decision.decide"]);

  const allowed = authorizeArtifactOperation({
    controlPlane,
    subject: { kind: "actor", actorId: "human" },
    permission: "decision.decide"
  });
  assert.equal(allowed.allowed, true);
  const unbound = authorizeArtifactOperation({
    controlPlane,
    subject: { kind: "actor", actorId: "missing" },
    permission: "artifact.read"
  });
  assert.equal(unbound.reason, "actor_not_found");
  const denied = authorizeArtifactOperation({
    controlPlane,
    subject: { kind: "actor", actorId: "agent" },
    permission: "decision.decide"
  });
  assert.equal(denied.reason, "permission_missing");

  const guidance = renderPermissionGuidance({
    snapshot,
    actorId: "agent",
    permissions: controlPlane.permissions.agent,
    artifactScope: controlPlane.artifactScope,
    locale: "zh-CN",
    decision: denied
  });
  assert.equal(guidance.allowed, false);
  assert.match(guidance.lines.join("\n"), /缺少|需要 decision\.decide/);
});
