import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { MemsphereConfig } from "../src/config.js";
import {
  ConfigRevisionConflictError,
  editableConfigDraft,
  readConfigDocument,
  validateConfigDraft,
  writeConfigDraft
} from "../src/config-management.js";

async function fixtureConfig() {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-config-management-"));
  const home = join(dir, "home");
  const projectRoot = join(home, "projects", "demo");
  const globalConfigPath = join(home, "config.json");
  const configPath = join(projectRoot, "config.json");
  const memoryRoot = join(projectRoot, "memory");
  await mkdir(memoryRoot, { recursive: true });
  await writeFile(globalConfigPath, `${JSON.stringify({
    language: "zh-CN",
    debug: { agent_review: true },
    view: { host: "127.0.0.1", port: 30002 }
  }, null, 2)}\n`);
  await writeFile(configPath, `${JSON.stringify({
    store: { type: "managed", branch: "master", published_revision: "abc123" },
    control_plane: {
      runner: { permissions: ["artifact.read", "decision.decide"] },
      actors: {
        human: {
          kind: "human",
          name: "Architect",
          permissions: ["artifact.read", "decision.assess"]
        }
      }
    }
  }, null, 2)}\n`);
  const resolved: MemsphereConfig = {
    configPath,
    scopeRoot: projectRoot,
    homeRoot: home,
    language: "zh-CN",
    memoryRoot,
    reviewsRoot: join(projectRoot, "reviews"),
    runsRoot: join(projectRoot, "runs"),
    archiveRoot: join(projectRoot, "archives"),
    debug: { agentReview: true, root: join(home, ".runtime", "debug") },
    view: { host: "127.0.0.1", port: 30002 },
    project: {
      name: "demo",
      revision: "abc123",
      store: { type: "managed", branch: "master", published_revision: "abc123" },
      mounted: []
    }
  };
  const document = await readConfigDocument(configPath, { globalConfigPath, resolved });
  return { dir, home, configPath, globalConfigPath, resolved, document };
}

test("config document separates global machine settings from Project control plane", async () => {
  const fixture = await fixtureConfig();
  try {
    assert.equal(fixture.document.globalRaw.language, "zh-CN");
    assert.equal(fixture.document.projectRaw.store.type, "managed");
    assert.equal(fixture.document.explicit.acpProviders, false);
    assert.equal(fixture.document.explicit.controlPlane, true);
    assert.match(fixture.document.revision, /^sha256:[a-f0-9]{64}$/);
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("config draft writes providers globally and actors inside the Project", async () => {
  const fixture = await fixtureConfig();
  try {
    const draft = editableConfigDraft(fixture.document);
    draft.acp_providers = { codex: { idle_timeout_ms: 90000 } };
    const validation = validateConfigDraft(fixture.document, draft);
    assert.equal(validation.valid, true);
    assert.equal(validation.resolvedPaths?.memoryRoot, fixture.resolved.memoryRoot);
    const written = await writeConfigDraft({
      document: fixture.document,
      expectedRevision: fixture.document.revision,
      draft
    });
    const global = JSON.parse(await readFile(fixture.globalConfigPath, "utf8"));
    const project = JSON.parse(await readFile(fixture.configPath, "utf8"));
    assert.equal(global.acp_providers.codex.idle_timeout_ms, 90000);
    assert.equal(global.debug.agent_review, true);
    assert.equal(project.control_plane.actors.human.name, "Architect");
    assert.equal(project.acp_providers, undefined);
    assert.notEqual(written.revision, fixture.document.revision);
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("Project Actor references are validated against global ACP Providers", async () => {
  const fixture = await fixtureConfig();
  try {
    const draft = editableConfigDraft(fixture.document);
    draft.control_plane!.actors.agent = {
      kind: "agent",
      name: "Agent",
      permissions: ["artifact.read"],
      agent: { provider: "private-provider" }
    };
    const validation = validateConfigDraft(fixture.document, draft);
    assert.equal(validation.valid, false);
    assert.match(validation.errors[0]?.message ?? "", /Unknown ACP Provider/);
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("config write rejects stale global or Project revisions", async () => {
  const fixture = await fixtureConfig();
  try {
    const draft = editableConfigDraft(fixture.document);
    draft.language = "en";
    await writeFile(fixture.globalConfigPath, JSON.stringify({ language: "en" }));
    await assert.rejects(
      writeConfigDraft({ document: fixture.document, expectedRevision: fixture.document.revision, draft }),
      ConfigRevisionConflictError
    );
    assert.equal(JSON.parse(await readFile(fixture.configPath, "utf8")).store.published_revision, "abc123");
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});
