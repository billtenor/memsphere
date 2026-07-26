import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ConfigRevisionConflictError,
  editableConfigDraft,
  readConfigDocument,
  validateConfigDraft,
  writeConfigDraft
} from "../src/config-management.js";

async function fixtureConfig(): Promise<{ dir: string; configPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-config-management-"));
  const configPath = join(dir, "config.json");
  await writeFile(configPath, `${JSON.stringify({
    memoryRoot: "memory",
    debug: { agent_review: true },
    view: { host: "127.0.0.1", port: 30002 },
    control_plane: {
      runner: {
        permissions: ["artifact.read", "decision.decide"]
      },
      actors: {
        human: {
          kind: "human",
          name: "Architect",
          permissions: ["artifact.read", "decision.assess"]
        }
      }
    }
  }, null, 2)}\n`);
  return { dir, configPath };
}

test("config document preserves explicit values and resolves defaults", async () => {
  const { dir, configPath } = await fixtureConfig();
  const document = await readConfigDocument(configPath);

  assert.equal(document.raw.memoryRoot, "memory");
  assert.equal(document.explicit.memoryRoot, true);
  assert.equal(document.explicit.reviewsRoot, false);
  assert.equal(document.explicit.view, true);
  assert.equal(document.resolved.memoryRoot, join(dir, "memory"));
  assert.equal(document.resolved.reviewsRoot, join(dir, "reviews"));
  assert.match(document.revision, /^sha256:[a-f0-9]{64}$/);
});

test("memory root can use the scoped default", async () => {
  const { dir, configPath } = await fixtureConfig();
  const document = await readConfigDocument(configPath);
  const draft = editableConfigDraft(document);
  delete draft.memoryRoot;

  const validation = validateConfigDraft(document, draft);
  assert.equal(validation.valid, true);
  assert.equal(validation.candidate?.memoryRoot, undefined);
  assert.equal(validation.resolvedPaths?.memoryRoot, join(dir, "memory"));

  const written = await writeConfigDraft({
    document,
    expectedRevision: document.revision,
    draft
  });
  assert.equal(written.raw.memoryRoot, undefined);
  assert.equal(written.resolved.memoryRoot, join(dir, "memory"));
});

test("config draft preserves hidden debug configuration", async () => {
  const { configPath } = await fixtureConfig();
  const document = await readConfigDocument(configPath);
  const draft = editableConfigDraft(document);
  draft.memoryRoot = "new-memory";

  const validation = validateConfigDraft(document, draft);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.candidate?.debug, { agent_review: true });
  assert.doesNotMatch(validation.normalizedJson ?? "", /"debug"/);
  assert.deepEqual(validation.changes.map((change) => change.path), ["memoryRoot"]);

  const written = await writeConfigDraft({
    document,
    expectedRevision: document.revision,
    draft
  });
  assert.equal(written.raw.memoryRoot, "new-memory");
  assert.deepEqual(written.raw.debug, { agent_review: true });
});

test("legacy Actor-owned ACP process configuration is rejected", async () => {
  const { configPath } = await fixtureConfig();
  const source = JSON.parse(await readFile(configPath, "utf8")) as {
    control_plane: { actors: Record<string, unknown> };
  };
  source.control_plane.actors.legacy_agent = {
    kind: "agent",
    name: "Legacy Agent",
    permissions: ["artifact.read"],
    agent: {
      provider: "traex",
      command: "/opt/traex",
      args: ["acp", "serve"],
      cwd: ".",
      model: "review-model",
      prompt_version: "artifact-review-v1",
      startup_timeout_ms: 60000,
      idle_timeout_ms: 120000,
      max_runtime_ms: null
    }
  };
  await writeFile(configPath, `${JSON.stringify(source, null, 2)}\n`);
  await assert.rejects(
    readConfigDocument(configPath),
    /Move args, env, and timeout settings into the matching fixed control_plane\.acp_providers entry/
  );
});

test("config draft rejects removed grantable permissions", async () => {
  const { configPath } = await fixtureConfig();
  const document = await readConfigDocument(configPath);
  const draft = editableConfigDraft(document);
  const controlPlane = draft.control_plane as { runner: Record<string, unknown> };
  controlPlane.runner.grantable_permissions = ["artifact.read"];

  const validation = validateConfigDraft(document, draft);
  assert.equal(validation.valid, false);
  assert.match(validation.errors[0]?.message ?? "", /Unrecognized key/);
});

test("config draft reports ACP Provider argument errors at the edited field", async () => {
  const { configPath } = await fixtureConfig();
  const document = await readConfigDocument(configPath);
  const draft = editableConfigDraft(document);
  const controlPlane = draft.control_plane as {
    acp_providers?: Record<string, unknown>;
  };
  controlPlane.acp_providers = {
    qwen: {
      args: ["--acp"]
    },
    codex: {
      command: "npx"
    }
  };

  const validation = validateConfigDraft(document, draft);
  assert.equal(validation.valid, false);
  assert(validation.errors.some((error) =>
    error.path === "control_plane.acp_providers.qwen.args"
    && /Qwen.*managed argument '--acp'/.test(error.message)
  ));
  assert(validation.errors.some((error) =>
    error.path === "control_plane.acp_providers.codex"
    && /Unrecognized key/.test(error.message)
  ));
});

test("config write rejects stale revisions without overwriting the newer file", async () => {
  const { configPath } = await fixtureConfig();
  const document = await readConfigDocument(configPath);
  const draft = editableConfigDraft(document);
  draft.memoryRoot = "candidate";
  await writeFile(configPath, `${JSON.stringify({ memoryRoot: "external" }, null, 2)}\n`);

  await assert.rejects(
    writeConfigDraft({ document, expectedRevision: document.revision, draft }),
    ConfigRevisionConflictError
  );
  assert.match(await readFile(configPath, "utf8"), /"external"/);
  assert.doesNotMatch(await readFile(configPath, "utf8"), /"candidate"/);
});
