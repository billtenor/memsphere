import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { MemsphereConfig } from "../src/config.js";
import {
  ConfigRevisionConflictError,
  editableGlobalConfigDraft,
  editableProjectConfigDraft,
  readGlobalConfigDocument,
  readProjectConfigDocument,
  validateGlobalConfigDraft,
  validateProjectConfigDraft,
  writeGlobalConfigDraft,
  writeGlobalOperatorToken,
  writeProjectConfigDraft
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
    view: { host: "127.0.0.1", port: 30002 },
    acp_providers: { codex: { idle_timeout_ms: 90000 } }
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
        },
        agent: {
          kind: "agent",
          name: "Codex reviewer",
          permissions: ["artifact.read"],
          agent: { provider: "codex" }
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
  const globalDocument = await readGlobalConfigDocument(globalConfigPath);
  const projectDocument = await readProjectConfigDocument(configPath, resolved);
  return { dir, home, configPath, globalConfigPath, resolved, globalDocument, projectDocument };
}

test("global and Project config documents have independent revisions and drafts", async () => {
  const fixture = await fixtureConfig();
  try {
    assert.equal(fixture.globalDocument.raw.language, "zh-CN");
    assert.equal(fixture.projectDocument.raw.store.type, "managed");
    assert.match(fixture.globalDocument.revision, /^sha256:[a-f0-9]{64}$/);
    assert.match(fixture.projectDocument.revision, /^sha256:[a-f0-9]{64}$/);
    assert.notEqual(fixture.globalDocument.revision, fixture.projectDocument.revision);
    assert.equal(editableGlobalConfigDraft(fixture.globalDocument).language, "zh-CN");
    assert.equal(editableProjectConfigDraft(fixture.projectDocument).control_plane?.actors.human?.name, "Architect");
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("fixed View operator token stays secret and survives ordinary Settings saves", async () => {
  const fixture = await fixtureConfig();
  try {
    const configuredToken = "1";
    const configured = await writeGlobalOperatorToken({
      document: fixture.globalDocument,
      expectedRevision: fixture.globalDocument.revision,
      token: configuredToken
    });
    assert.equal(configured.raw.view?.operator_token, configuredToken);
    assert.deepEqual(editableGlobalConfigDraft(configured).view, { host: "127.0.0.1", port: 30002 });

    const saved = await writeGlobalConfigDraft({
      document: configured,
      expectedRevision: configured.revision,
      draft: { ...editableGlobalConfigDraft(configured), language: "en" }
    });
    assert.equal(saved.raw.view?.operator_token, configuredToken);

    const cleared = await writeGlobalOperatorToken({
      document: saved,
      expectedRevision: saved.revision
    });
    assert.equal(cleared.raw.view?.operator_token, undefined);
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("global save preserves debug and never writes the Project file", async () => {
  const fixture = await fixtureConfig();
  try {
    const projectBefore = await readFile(fixture.configPath, "utf8");
    const draft = editableGlobalConfigDraft(fixture.globalDocument);
    draft.language = "en";
    const written = await writeGlobalConfigDraft({
      document: fixture.globalDocument,
      expectedRevision: fixture.globalDocument.revision,
      draft,
      projects: [{ name: "demo", config: fixture.projectDocument.raw }]
    });
    const global = JSON.parse(await readFile(fixture.globalConfigPath, "utf8"));
    assert.equal(global.language, "en");
    assert.equal(global.debug.agent_review, true);
    assert.equal(await readFile(fixture.configPath, "utf8"), projectBefore);
    assert.notEqual(written.revision, fixture.globalDocument.revision);
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("Project save preserves Store and never writes the global file", async () => {
  const fixture = await fixtureConfig();
  try {
    const globalBefore = await readFile(fixture.globalConfigPath, "utf8");
    const draft = editableProjectConfigDraft(fixture.projectDocument);
    draft.control_plane!.actors.human!.name = "Product owner";
    const written = await writeProjectConfigDraft({
      document: fixture.projectDocument,
      expectedRevision: fixture.projectDocument.revision,
      draft,
      globalConfigPath: fixture.globalConfigPath
    });
    const project = JSON.parse(await readFile(fixture.configPath, "utf8"));
    assert.equal(project.control_plane.actors.human.name, "Product owner");
    assert.equal(project.store.published_revision, "abc123");
    assert.equal(await readFile(fixture.globalConfigPath, "utf8"), globalBefore);
    assert.notEqual(written.revision, fixture.projectDocument.revision);
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("global Provider reset is rejected when any Project still references it", async () => {
  const fixture = await fixtureConfig();
  try {
    const draft = editableGlobalConfigDraft(fixture.globalDocument);
    delete draft.acp_providers?.codex;
    const validation = validateGlobalConfigDraft(
      fixture.globalDocument,
      draft,
      [{ name: "demo", config: fixture.projectDocument.raw }]
    );
    assert.equal(validation.valid, false);
    assert.equal(validation.errors[0]?.path, "acp_providers.codex");
    assert.match(validation.errors[0]?.message ?? "", /demo.*agent/);
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("Project Actor references are validated against global ACP Providers", async () => {
  const fixture = await fixtureConfig();
  try {
    const draft = editableProjectConfigDraft(fixture.projectDocument);
    draft.control_plane!.actors.agent!.agent = { provider: "private-provider" };
    const validation = validateProjectConfigDraft(fixture.projectDocument, draft, fixture.globalDocument.raw);
    assert.equal(validation.valid, false);
    assert.match(validation.errors[0]?.message ?? "", /Unknown ACP Provider/);
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("each config write rejects only its own stale revision", async () => {
  const fixture = await fixtureConfig();
  try {
    const globalDraft = editableGlobalConfigDraft(fixture.globalDocument);
    globalDraft.language = "en";
    await writeFile(fixture.globalConfigPath, JSON.stringify({ language: "en" }));
    await assert.rejects(
      writeGlobalConfigDraft({
        document: fixture.globalDocument,
        expectedRevision: fixture.globalDocument.revision,
        draft: globalDraft
      }),
      ConfigRevisionConflictError
    );

    const projectDraft = editableProjectConfigDraft(fixture.projectDocument);
    const projectSaved = await writeProjectConfigDraft({
      document: fixture.projectDocument,
      expectedRevision: fixture.projectDocument.revision,
      draft: projectDraft,
      globalConfigPath: fixture.globalConfigPath
    });
    assert.equal(projectSaved.raw.store.published_revision, "abc123");
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});
