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
  acp_providers: {
    traex: {
      args: [],
      startup_timeout_ms: 10000,
      idle_timeout_ms: 30000,
      max_runtime_ms: null
    }
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
        model: "review-model"
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
    providerType: "traex",
    command: "traex",
    args: [],
    env: {},
    model: "review-model",
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
        agent: { provider: "traex", command: "traex" }
      }
    }
  }), /Unrecognized key.*command/);
  assert.throws(() => parseControlPlaneConfig({
    ...rawConfig,
    acp_providers: {
      traex: {
        env: { API_KEY: "secret" }
      }
    }
  }), /reserved or sensitive/);
  for (const name of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "COMSPEC",
    "SystemRoot",
    "PATHEXT",
    "XDG_CONFIG_HOME",
    "CODEX_HOME",
    "INITIAL_AGENT_MODE",
    "NODE_OPTIONS",
    "LD_PRELOAD"
  ]) {
    assert.throws(() => parseControlPlaneConfig({
      ...rawConfig,
      acp_providers: {
        traex: {
          env: { [name]: "override" }
        }
      }
    }), new RegExp(`reserved or sensitive: ${name}`));
  }
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
    providerType: "traex",
    command: "traex",
    args: [],
    env: {},
    model: "review-model",
    startupTimeoutMs: 60000,
    idleTimeoutMs: null,
    maxRuntimeMs: null
  });
});

test("ACP Provider configuration has fixed ids and immutable launch ownership", () => {
  assert.throws(() => parseControlPlaneConfig({
    runner: { permissions: [] },
    acp_providers: {
      qwen: {
        args: ["--acp"]
      }
    },
    actors: {}
  }), /Qwen.*managed argument '--acp'/);

  assert.throws(() => parseControlPlaneConfig({
    runner: { permissions: [] },
    acp_providers: {
      kimi: {
        args: ["login"]
      }
    },
    actors: {}
  }), /Kimi.*cannot launch the 'login' subcommand/);

  assert.throws(() => parseControlPlaneConfig({
    runner: { permissions: [] },
    acp_providers: {
      review: {}
    },
    actors: {}
  }), /Unrecognized key.*review/);

  assert.throws(() => parseControlPlaneConfig({
    runner: { permissions: [] },
    acp_providers: {
      codex: { command: "npx" }
    },
    actors: {}
  }), /Unrecognized key.*command/);

  assert.throws(() => parseControlPlaneConfig({
    runner: { permissions: [] },
    acp_providers: {
      traex: { type: "qwen" }
    },
    actors: {}
  }), /Unrecognized key.*type/);
});

test("control plane snapshots and revisions are deterministic", () => {
  const first = createControlPlaneSnapshot(parseControlPlaneConfig(rawConfig));
  const second = createControlPlaneSnapshot(parseControlPlaneConfig({
    actors: { agent: rawConfig.actors.agent, human: rawConfig.actors.human },
    runner: rawConfig.runner,
    acp_providers: rawConfig.acp_providers
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

for (const name of [undefined, "", " \t\n"]) {
  test(`Actors without a display name use their ID in snapshots and Review assignments (${JSON.stringify(name)})`, async () => {
    const config = parseControlPlaneConfig({
      runner: { permissions: ["decision.decide"] },
      actors: {
        person: { kind: "human", name, permissions: ["artifact.read", "decision.assess"] },
        reviewer: { kind: "agent", name, permissions: ["artifact.read", "decision.assess"], agent: {} }
      }
    });
    const snapshot = createControlPlaneSnapshot(config);
    const controlPlane = resolveArtifactControlPlane({
      snapshot,
      slotBindings: { "fixture::reviewer": { actorIds: ["person", "reviewer"], source: "run:fixture" } },
      artifactScope: "fixture#flow[1]",
      policyId: "artifact_acceptance.unanimous"
    });
    const { createArtifactReviewAssignments } = await import("../src/artifact-review.js");
    const result = createArtifactReviewAssignments({ snapshot, controlPlane, now: "2026-10-19T00:00:00.000Z" });
    assert.deepEqual(result.assignments.map(actor => [actor.actorId, actor.actorName]), [["person", "person"], ["reviewer", "reviewer"]]);
    assert.equal(snapshot.actors.person.name, "person");
    assert.equal(snapshot.actors.reviewer.name, "reviewer");
  });
}

test("Actors retain existing name trimming and reject non-string names", () => {
  for (const kind of ["human", "agent"]) {
    const actor = { kind, permissions: [], ...(kind === "agent" ? { agent: {} } : {}) };
    const parse = (name: unknown) => parseControlPlaneConfig({ runner: { permissions: [] }, actors: { actor: { ...actor, name } } });
    assert.equal(parse("  My name  ").actors.actor.name, "My name");
    for (const name of [null, 123, {}, []]) assert.throws(() => parse(name), /Expected string/);
  }
});

for (const prompt of ["Do something", "", "   "]) {
  test(`Human Actor config prohibits the system_prompt field (${JSON.stringify(prompt)})`, async () => {
    const { projectControlPlaneConfigSchema } = await import("../src/control-plane/schema.js");
    const raw = { runner: { permissions: [] }, actors: { person: { kind: "human", permissions: [], system_prompt: prompt } } };
    assert.throws(() => parseControlPlaneConfig(raw), /Unrecognized key.*system_prompt/);
    assert.equal(projectControlPlaneConfigSchema.safeParse(raw).success, false);
  });
}

test("Human Actors need no system prompt while Agent prompts retain their existing rules", () => {
  const raw = { runner: { permissions: [] }, actors: { person: { kind: "human", permissions: [] } } };
  assert.equal(Object.hasOwn(parseControlPlaneConfig(raw).actors.person, "systemPrompt"), false);
  const parseAgent = (prompt: Record<string, string>) => parseControlPlaneConfig({
    runner: { permissions: [] },
    actors: { bot: { kind: "agent", permissions: [], agent: {}, ...prompt } }
  });
  assert.equal(parseAgent({}).actors.bot.systemPrompt, undefined);
  assert.equal(parseAgent({ system_prompt: "Review carefully" }).actors.bot.systemPrompt, "Review carefully");
  for (const prompt of ["", "  "]) assert.throws(() => parseAgent({ system_prompt: prompt }), /must not be blank/);
});

test("Frozen historical snapshots retain their Human prompt without rewriting history", async () => {
  const { controlPlaneSnapshotSchema } = await import("../src/control-plane/schema.js");
  const snapshot = createControlPlaneSnapshot(parseControlPlaneConfig(rawConfig));
  snapshot.actors.human.systemPrompt = "Historical prompt";
  const before = JSON.stringify(snapshot);
  assert.equal(controlPlaneSnapshotSchema.parse(snapshot).actors.human.systemPrompt, "Historical prompt");
  assert.equal(JSON.stringify(snapshot), before);
});


test("Provider idle and total timeouts accept null and reject zero", () => {
  for (const timeouts of [{}, { idle_timeout_ms: null, max_runtime_ms: null }]) {
    const parsed = parseControlPlaneConfig({ ...rawConfig, acp_providers: { traex: timeouts } });
    const snapshot = createControlPlaneSnapshot(parsed);
    assert.equal(snapshot.actors.agent.kind, "agent");
    if (snapshot.actors.agent.kind !== "agent") throw new Error("expected agent");
    assert.equal(snapshot.actors.agent.agent.idleTimeoutMs, null);
    assert.equal(snapshot.actors.agent.agent.maxRuntimeMs, null);
  }
  for (const field of ["idle_timeout_ms", "max_runtime_ms"]) {
    assert.throws(() => parseControlPlaneConfig({ ...rawConfig, acp_providers: { traex: { [field]: 0 } } }));
  }
});
