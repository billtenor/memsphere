import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { MemsphereConfig } from "../src/config.js";
import { createViewServer } from "../src/commands/view.js";
import { randomUUID } from "node:crypto";
import { importModelMarketPackage, listModelMarket } from "../src/project/model-market.js";
import { createModelRegistrationStore } from "../src/project/model-registration.js";
import { snapshotTree } from "./helpers/business-data.js";

/** Real reserved assets, selecting only models supported by the existing Runtime. */
async function supportedMarketSource(root: string) {
  const sourceRoot = join(root, "supported-market-fixture");
  await cp(new URL("../reserved-models", import.meta.url), sourceRoot, { recursive: true });
  const manifestPath = join(sourceRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const pack = manifest.market_packages[0];
  for (const model of pack.models.filter((model: { registration: { modelRef: string } }) => /examples\/0[45]-/.test(model.registration.modelRef))) await rm(join(sourceRoot, model.source));
  pack.models = pack.models.filter((model: { registration: { modelRef: string } }) => !/examples\/0[45]-/.test(model.registration.modelRef));
  await writeFile(manifestPath, JSON.stringify(manifest));
  return sourceRoot;
}

async function withSettingsServer(
  host: string,
  fn: (context: { origin: string; configPath: string; globalConfigPath: string; token?: string }) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-view-settings-"));
  const home = join(dir, "home");
  const projectRoot = join(home, "projects", "demo");
  const configPath = join(projectRoot, "config.json");
  const globalConfigPath = join(home, "config.json");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(projectRoot, "memory"), { recursive: true }));
  await writeFile(globalConfigPath, `${JSON.stringify({
    view: { host, port: 30002 }
  }, null, 2)}\n`);
  await writeFile(configPath, `${JSON.stringify({
    store: { type: "managed", branch: "master", published_revision: "abc123" },
    control_plane: {
      runner: { permissions: ["artifact.read"] },
      actors: {}
    }
  }, null, 2)}\n`);
  await writeFile(join(home, "registry.json"), `${JSON.stringify({
    format_version: 1,
    projects: { demo: { root: projectRoot } },
    workspaces: {}
  }, null, 2)}\n`);
  const config: MemsphereConfig = {
    configPath,
    scopeRoot: projectRoot,
    homeRoot: home,
    language: "zh-CN",
    memoryRoot: join(projectRoot, "memory"),
    reviewsRoot: join(projectRoot, "reviews"),
    runsRoot: join(projectRoot, "runs"),
    archiveRoot: join(projectRoot, "archives"),
    debug: { agentReview: false, root: join(home, ".runtime", "debug") },
    view: { host, port: 30002 },
    project: {
      name: "demo",
      revision: "abc123",
      store: { type: "managed", branch: "master", published_revision: "abc123" },
      mounted: []
    }
  };
  const token = host === "127.0.0.1" ? undefined : "a".repeat(43);
  const server = createViewServer(config, { settingsToken: token });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  try {
    await fn({ origin: `http://127.0.0.1:${port}`, configPath, globalConfigPath, token });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}

test("loopback Settings validates same-origin JSON and rejects cross-origin requests", async () => {
  await withSettingsServer("127.0.0.1", async ({ origin }) => {
    const settings = await fetch(`${origin}/api/settings/global`);
    assert.equal(settings.status, 200);
    const payload = await settings.json() as {
      diskRevision: string;
      config: {
        acp_providers?: Record<string, unknown>;
      };
      acpProviderCatalog: Array<{ type: string; defaultInstance: { command: string } }>;
    };
    const projectPayload = await (await fetch(`${origin}/api/settings/project`)).json() as {
      permissionCatalog: Array<{ id: string }>;
    };
    assert.deepEqual(projectPayload.permissionCatalog.map((definition) => definition.id), [
      "artifact.read",
      "artifact.write",
      "artifact.submit",
      "decision.assess",
      "decision.decide"
    ]);
    assert.deepEqual(payload.acpProviderCatalog.map((definition) => definition.type), [
      "traex",
      "qwen",
      "kimi",
      "codex"
    ]);

    payload.config.acp_providers = { traex: {} };
    const detected = await fetch(`${origin}/api/settings/global/acp-providers/detect`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "sec-fetch-site": "same-origin"
      },
      body: JSON.stringify({ expectedRevision: payload.diskRevision, config: payload.config })
    });
    assert.equal(detected.status, 200);
    const detection = await detected.json() as {
      results: Array<{ id: string; status: string; path?: string; version?: string }>;
    };
    assert.deepEqual(detection.results.map((result) => result.id), [
      "traex",
      "qwen",
      "kimi",
      "codex"
    ]);
    assert(detection.results.every((result) =>
      ["installed", "version_unknown", "missing", "failed"].includes(result.status)
    ));

    const missingOrigin = await fetch(`${origin}/api/settings/global/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: payload.diskRevision, config: payload.config })
    });
    assert.equal(missingOrigin.status, 403);
    assert.equal((await missingOrigin.json() as { code: string }).code, "request_origin_rejected");

    const crossOrigin = await fetch(`${origin}/api/settings/global/validate`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://example.test" },
      body: JSON.stringify({ expectedRevision: payload.diskRevision, config: payload.config })
    });
    assert.equal(crossOrigin.status, 403);

    const valid = await fetch(`${origin}/api/settings/global/validate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "sec-fetch-site": "same-origin"
      },
      body: JSON.stringify({ expectedRevision: payload.diskRevision, config: payload.config })
    });
    assert.equal(valid.status, 200);
    assert.equal((await valid.json() as { valid: boolean }).valid, true);
  });
});

test("non-loopback Settings requires a token in addition to same-origin requests", async () => {
  await withSettingsServer("0.0.0.0", async ({ origin, token, globalConfigPath }) => {
    assert.equal((await fetch(`${origin}/api/settings/global`)).status, 401);

    const authorized = await fetch(`${origin}/api/settings/global`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(authorized.status, 200);
    const payload = await authorized.json() as {
      diskRevision: string;
      operatorTokenConfigured: boolean;
      runningView?: Record<string, unknown>;
      config: { language?: string; view?: Record<string, unknown> };
    };
    assert.equal(payload.operatorTokenConfigured, false);
    assert.equal(payload.config.view?.operator_token, undefined);

    const fixedToken = "1";
    const configured = await fetch(`${origin}/api/settings/global/operator-token`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin
      },
      body: JSON.stringify({ expectedRevision: payload.diskRevision, token: fixedToken })
    });
    assert.equal(configured.status, 200);
    const configuredPayload = await configured.json() as { diskRevision: string; operatorTokenConfigured: boolean };
    assert.equal(configuredPayload.operatorTokenConfigured, true);
    assert.match(await readFile(globalConfigPath, "utf8"), /"operator_token": "1"/);

    const reloaded = await fetch(`${origin}/api/settings/global`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const reloadedPayload = await reloaded.json() as typeof payload;
    assert.equal(reloadedPayload.operatorTokenConfigured, true);
    assert.equal(reloadedPayload.config.view?.operator_token, undefined);
    assert.equal(reloadedPayload.runningView?.operatorToken, undefined);
    payload.diskRevision = configuredPayload.diskRevision;
    payload.config.language = "en";

    const saved = await fetch(`${origin}/api/settings/global`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin
      },
      body: JSON.stringify({ expectedRevision: payload.diskRevision, config: payload.config })
    });
    assert.equal(saved.status, 200);
    await saved.json();
    assert.match(await readFile(globalConfigPath, "utf8"), /"language": "en"/);
  });
});

test("Settings save rejects stale revisions", async () => {
  await withSettingsServer("127.0.0.1", async ({ origin, globalConfigPath }) => {
    const payload = await (await fetch(`${origin}/api/settings/global`)).json() as {
      diskRevision: string;
      config: { language?: string };
    };
    payload.config.language = "en";
    await writeFile(globalConfigPath, JSON.stringify({ language: "en", view: { host: "127.0.0.1", port: 30002 } }));

    const saved = await fetch(`${origin}/api/settings/global`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ expectedRevision: payload.diskRevision, config: payload.config })
    });
    assert.equal(saved.status, 409);
    assert.match(await readFile(globalConfigPath, "utf8"), /"language":"en"/);
  });
});

test("Settings save returns field errors for an invalid draft", async () => {
  await withSettingsServer("127.0.0.1", async ({ origin }) => {
    const payload = await (await fetch(`${origin}/api/settings/global`)).json() as {
      diskRevision: string;
      config: { view?: { host: string; port: number } };
    };
    payload.config.view = { host: "127.0.0.1", port: 99999 };

    const saved = await fetch(`${origin}/api/settings/global`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ expectedRevision: payload.diskRevision, config: payload.config })
    });
    assert.equal(saved.status, 422);
    const failure = await saved.json() as { code: string; errors: Array<{ path: string }> };
    assert.equal(failure.code, "config_invalid");
    assert.equal(failure.errors[0]?.path, "view.port");
  });
});

test("Settings validation never exposes hidden debug or internal candidate data", async () => {
  await withSettingsServer("127.0.0.1", async ({ origin, globalConfigPath }) => {
    const raw = JSON.parse(await readFile(globalConfigPath, "utf8")) as Record<string, unknown>;
    raw.debug = { agent_review: true };
    await writeFile(globalConfigPath, `${JSON.stringify(raw, null, 2)}\n`);
    const payload = await (await fetch(`${origin}/api/settings/global`)).json() as {
      diskRevision: string;
      config: Record<string, unknown>;
    };
    assert.equal(payload.config.debug, undefined);

    const validated = await fetch(`${origin}/api/settings/global/validate`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ expectedRevision: payload.diskRevision, config: payload.config })
    });
    assert.equal(validated.status, 200);
    const result = await validated.json() as Record<string, unknown>;
    assert.equal(result.candidate, undefined);
    assert.doesNotMatch(String(result.normalizedJson), /"debug"/);
  });
});

test("global and Project Settings save independently and protect referenced Providers", async () => {
  await withSettingsServer("127.0.0.1", async ({ origin, configPath, globalConfigPath }) => {
    const globalBefore = await readFile(globalConfigPath, "utf8");
    const projectPayload = await (await fetch(`${origin}/api/settings/project`)).json() as {
      diskRevision: string;
      config: Record<string, any>;
    };
    projectPayload.config.control_plane.actors.reviewer = {
      kind: "agent",
      name: "Reviewer",
      permissions: ["artifact.read"],
      agent: { provider: "codex" }
    };
    const projectSaved = await fetch(`${origin}/api/projects/demo/settings/project`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ expectedRevision: projectPayload.diskRevision, config: projectPayload.config })
    });
    assert.equal(projectSaved.status, 200);
    assert.equal(await readFile(globalConfigPath, "utf8"), globalBefore);
    assert.match(await readFile(configPath, "utf8"), /"reviewer"/);

    let globalPayload = await (await fetch(`${origin}/api/settings/global`)).json() as {
      diskRevision: string;
      config: { acp_providers?: Record<string, unknown> };
      providerReferences: Record<string, Array<{ projectName: string; actorId: string }>>;
    };
    assert.deepEqual(globalPayload.providerReferences.codex, [{
      projectName: "demo",
      actorId: "reviewer",
      actorName: "Reviewer"
    }]);
    globalPayload.config.acp_providers = { codex: { idle_timeout_ms: 90000 } };
    const globalSaved = await fetch(`${origin}/api/settings/global`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ expectedRevision: globalPayload.diskRevision, config: globalPayload.config })
    });
    assert.equal(globalSaved.status, 200);
    const projectAfterGlobalSave = await readFile(configPath, "utf8");

    globalPayload = await (await fetch(`${origin}/api/settings/global`)).json() as typeof globalPayload;
    delete globalPayload.config.acp_providers?.codex;
    const rejected = await fetch(`${origin}/api/settings/global/validate`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ expectedRevision: globalPayload.diskRevision, config: globalPayload.config })
    });
    assert.equal(rejected.status, 422);
    const failure = await rejected.json() as { errors: Array<{ path: string; message: string }> };
    assert.equal(failure.errors[0]?.path, "acp_providers.codex");
    assert.match(failure.errors[0]?.message ?? "", /demo.*reviewer/);
    assert.equal(await readFile(configPath, "utf8"), projectAfterGlobalSave);
  });
});

test("global Settings remains available when no Project is selected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-view-global-only-"));
  const home = join(dir, "home");
  const globalConfigPath = join(home, "config.json");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(home, { recursive: true }));
  await writeFile(globalConfigPath, "{}\n");
  const config: MemsphereConfig = {
    configPath: globalConfigPath,
    scopeRoot: home,
    homeRoot: home,
    language: "zh-CN",
    memoryRoot: join(home, "projects"),
    reviewsRoot: join(home, "projects"),
    runsRoot: join(home, "projects"),
    archiveRoot: join(home, "projects"),
    debug: { agentReview: false, root: join(home, ".runtime", "debug") },
    view: { host: "127.0.0.1", port: 0 }
  };
  const server = createViewServer(config);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${origin}/api/settings/global`)).status, 200);
    const project = await fetch(`${origin}/api/settings/project`);
    assert.equal(project.status, 404);
    assert.equal((await project.json() as { code: string }).code, "project_unavailable");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true }));
  }
});

test("saving language updates the next View page in the same process without requiring restart", async () => {
  await withSettingsServer("127.0.0.1", async ({ origin }) => {
    const initialPage = await (await fetch(origin)).text();
    assert.match(initialPage, /<html lang="zh-CN"(?: [^>]*)?>/);

    const payload = await (await fetch(`${origin}/api/settings/global`)).json() as {
      diskRevision: string;
      config: { language?: string; view?: { host: string; port: number } };
    };
    payload.config.language = "en";
    const saved = await fetch(`${origin}/api/settings/global`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ expectedRevision: payload.diskRevision, config: payload.config })
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json() as { restartRequired: boolean }).restartRequired, false);

    const englishPage = await (await fetch(origin)).text();
    assert.match(englishPage, /<html lang="en"(?: [^>]*)?>/);
    assert.match(englishPage, /"common\.refresh":"Refresh"/);

    const current = await (await fetch(`${origin}/api/settings/global`)).json() as {
      diskRevision: string;
      config: { language?: string; view?: { host: string; port: number } };
    };
    const invalid = await fetch(`${origin}/api/settings/global`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        expectedRevision: current.diskRevision,
        config: { ...current.config, language: "unsupported" }
      })
    });
    assert.equal(invalid.status, 422);
    assert.match(await (await fetch(origin)).text(), /<html lang="en"(?: [^>]*)?>/);

    const validateHostChange = await fetch(`${origin}/api/settings/global/validate`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        expectedRevision: current.diskRevision,
        config: { ...current.config, view: { host: "127.0.0.1", port: 30003 } }
      })
    });
    assert.equal(validateHostChange.status, 200);
    assert.equal((await validateHostChange.json() as { restartRequired: boolean }).restartRequired, true);
  });
});

test("model registration initialization and market imports protect permission and config revision", async () => {
  await withSettingsServer("0.0.0.0", async ({ origin, configPath, token }) => {
    const headers = { "content-type": "application/json", origin, authorization: `Bearer ${token}` };
    const root = (await import("node:path")).dirname(configPath);
    const { mkdir, readdir } = await import("node:fs/promises");
    await mkdir(join(root, "models/json-schema/draft-07"), { recursive: true });
    const source = '  {"type":"string","title":"Test model"}\n';
    await writeFile(join(root, "models/json-schema/draft-07/test.json"), source);
    const originalConfig = await readFile(configPath, "utf8");
    const before = await (await fetch(`${origin}/api/projects/demo/models`)).json();
    assert.equal(before.registrationInitialized, false);
    assert.equal(await readFile(configPath, "utf8"), originalConfig);
    await assert.rejects(readdir(join(root, "models/registrations")), /ENOENT/);
    const initialize = (revision: string, authorized: boolean) => fetch(`${origin}/api/projects/demo/models/initialize`, { method: "POST", headers: authorized ? headers : { "content-type": "application/json", origin }, body: JSON.stringify({ expectedRevision: revision }) });
    assert.equal((await initialize(before.configRevision, false)).status, 401);
    assert.equal((await initialize("stale", true)).status, 409);
    assert.equal(await readFile(configPath, "utf8"), originalConfig);
    const initialized = await initialize(before.configRevision, true);
    assert.equal(initialized.status, 200, await initialized.clone().text());
    assert.equal((await initialized.json()).created, 1);
    const after = await (await fetch(`${origin}/api/projects/demo/models`)).json();
    assert.equal(after.registrationInitialized, true);
    assert.equal(after.models.find((item: { id: string }) => item.id === "test.json").registration.name, "Test model");
    assert.equal((await (await fetch(`${origin}/api/projects/demo/models/definition?model=test.json`)).json()).source, source);
    const packages = (await (await fetch(`${origin}/api/projects/demo/models/market`)).json()).packages;
    assert.equal(packages.length >= 1, true);
    const install = (authorized: boolean) => fetch(`${origin}/api/projects/demo/models/market/import`, { method: "POST", headers: authorized ? headers : { "content-type": "application/json", origin }, body: JSON.stringify({ packageId: packages[0].id, expectedRevision: after.configRevision }) });
    assert.equal((await install(false)).status, 401);
    const beforeImport = await snapshotTree(join(root, "models"));
    for (let attempt = 0; attempt < 2; attempt++) {
      const installed = await install(true);
      assert.equal(installed.status, 422, await installed.clone().text());
      assert.equal((await installed.json()).code, "MODEL_RUNTIME_UNSUPPORTED");
      assert.deepEqual(await snapshotTree(join(root, "models")), beforeImport);
      const rejected = await (await fetch(`${origin}/api/projects/demo/models`)).json();
      assert.equal(rejected.models.some((item: { origin: string }) => item.origin === "market"), false);
    }
    const sourceRoot = await supportedMarketSource(root);
    const supported = listModelMarket(sourceRoot)[0]!;
    assert.equal((await importModelMarketPackage({}, { root }, supported.id, { sourceRoot })).status, "imported");
    assert.equal((await importModelMarketPackage({}, { root }, supported.id, { sourceRoot })).status, "unchanged");
    const imported = await (await fetch(`${origin}/api/projects/demo/models`)).json();
    assert.deepEqual(imported.models.filter((item: { origin: string }) => item.origin === "market").map((item: { id: string }) => item.id).sort(), supported.models.map(model => model.registration.modelRef).sort());
    const definition = await (await fetch(`${origin}/api/projects/demo/models/definition?model=${encodeURIComponent(supported.models[0]!.registration.modelRef)}`)).json();
    assert.equal(definition.source, supported.models[0]!.source);
  });
});

test("model registration settings validate migration and never publish an unauthorized directory switch", async () => {
  await withSettingsServer("127.0.0.1", async ({ origin, configPath }) => {
    const headers = { "content-type": "application/json", origin };
    const initial = await (await fetch(`${origin}/api/projects/demo/settings/project`)).json();
    assert.equal((await fetch(`${origin}/api/projects/demo/models/initialize`, { method: "POST", headers, body: JSON.stringify({ expectedRevision: initial.diskRevision }) })).status, 200);
    const settings = await (await fetch(`${origin}/api/projects/demo/settings/project`)).json();
    const config = { ...settings.config, modelRegistration: { storeId: "other", stores: { other: { factory: "memsphere/filesystem-json", directory: "other-registrations" } } } };
    const body = { expectedRevision: settings.diskRevision, config };
    const validation = await fetch(`${origin}/api/projects/demo/settings/project/validate`, { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal(validation.status, 200, await validation.clone().text());
    assert.equal((await validation.json()).migrationRequired, true);
    const original = await readFile(configPath, "utf8");
    const blocked = await fetch(`${origin}/api/projects/demo/settings/project`, { method: "PUT", headers, body: JSON.stringify(body) });
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).code, "MODEL_REGISTRATION_MIGRATION_REQUIRED");
    assert.equal(await readFile(configPath, "utf8"), original);
    const migrated = await fetch(`${origin}/api/projects/demo/settings/project`, { method: "PUT", headers, body: JSON.stringify({ ...body, migrateModelRegistrations: true }) });
    assert.equal(migrated.status, 200, await migrated.clone().text());
    assert.equal((await migrated.json()).config.modelRegistration.storeId, "other");
  });
});

test("model market cleanup protects authorization and revision before removing unpublished historical candidates", async () => {
  await withSettingsServer("0.0.0.0", async ({ origin, configPath, token }) => {
    const root = (await import("node:path")).dirname(configPath);
    const sourceRoot = await supportedMarketSource(root);
    const supported = listModelMarket(sourceRoot)[0]!;
    const pack = listModelMarket()[0]!;
    // The current journal rolls failed imports back. Construct an authentic old unpublished
    // candidate receipt to retain coverage of the still-supported explicit cleanup endpoint.
    const registrationRoot = join(root, "models/registrations");
    const store = await createModelRegistrationStore({}, "historical-candidates", join(registrationRoot, "imported"));
    const recordIds: string[] = [];
    for (const model of pack.models) {
      const path = join(registrationRoot, "imported-definitions", model.registration.modelRef);
      await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, model.source);
      const id = randomUUID(); recordIds.push(id);
      await store.create({}, id, model.registration);
    }
    await writeFile(join(registrationRoot, "published-imports.json"), JSON.stringify({ recordIds: [] }));
    const stage = join(registrationRoot, "staging", randomUUID()); await mkdir(stage, { recursive: true });
    const receiptPath = join(stage, "candidate.json");
    await writeFile(receiptPath, JSON.stringify({ packageId: pack.id, recordIds, modelRefs: pack.models.map(model => model.registration.modelRef) }));
    const before = await (await fetch(`${origin}/api/projects/demo/models`)).json();
    assert.equal(before.models.some((item: { origin: string }) => item.origin === "market"), false);
    const bytes = await snapshotTree(join(root, "models"));
    const cleanup = (revision: string, authorized: boolean) => fetch(`${origin}/api/projects/demo/models/market/cleanup`, {
      method: "POST", headers: { "content-type": "application/json", origin, ...(authorized ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ expectedRevision: revision })
    });
    assert.equal((await cleanup(before.configRevision, false)).status, 401);
    assert.equal((await cleanup("stale", true)).status, 409);
    assert.deepEqual(await snapshotTree(join(root, "models")), bytes);
    await assert.rejects(importModelMarketPackage({}, { root }, supported.id, { sourceRoot }), { code: "MODEL_IMPORT_CLEANUP_REQUIRED" });
    const cleaned = await cleanup(before.configRevision, true);
    assert.equal(cleaned.status, 200, await cleaned.clone().text());
    assert.deepEqual((await cleaned.json()).cleanedModelRefs, pack.models.map(model => model.registration.modelRef));
    for (const [index, model] of pack.models.entries()) {
      await assert.rejects(readFile(join(registrationRoot, "imported-definitions", model.registration.modelRef)), { code: "ENOENT" });
      await assert.rejects(readFile(join(registrationRoot, "imported", `${recordIds[index]}.json`)), { code: "ENOENT" });
    }
    await assert.rejects(readFile(receiptPath), { code: "ENOENT" });
    const afterCleanup = await snapshotTree(join(root, "models"));
    const rejected = await fetch(`${origin}/api/projects/demo/models/market/import`, {
      method: "POST", headers: { "content-type": "application/json", origin, authorization: `Bearer ${token}` },
      body: JSON.stringify({ expectedRevision: before.configRevision, packageId: pack.id })
    });
    assert.equal(rejected.status, 422, await rejected.clone().text());
    assert.equal((await rejected.json()).code, "MODEL_RUNTIME_UNSUPPORTED");
    assert.deepEqual(await snapshotTree(join(root, "models")), afterCleanup);
    assert.equal((await importModelMarketPackage({}, { root }, supported.id, { sourceRoot })).status, "imported");
    assert.deepEqual((await (await cleanup(before.configRevision, true)).json()).cleanedModelRefs, []);
    const modelRef = supported.models[0]!.registration.modelRef;
    const definition = await fetch(`${origin}/api/projects/demo/models/definition?model=${encodeURIComponent(modelRef)}`);
    assert.equal(definition.status, 200);
    assert.equal((await definition.json()).source, supported.models[0]!.source);
  });
});
