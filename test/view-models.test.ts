import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createViewServer } from "../src/commands/view.js";
import type { MemsphereConfig } from "../src/config.js";

test("Model APIs isolate Projects and immediately follow saved model directory configuration", async () => {
  const home = await mkdtemp(join(tmpdir(), "memsphere-model-api-"));
  const root = join(home, "projects", "alpha");
  const other = join(home, "projects", "beta");
  const store = { type: "managed", branch: "master", published_revision: "abc" };
  const configPath = join(root, "config.json");
  for (const [name, directory] of [["alpha", root], ["beta", other]]) {
    await mkdir(join(directory, "memory"), { recursive: true });
    await mkdir(join(directory, "models/json-schema/draft-07/sales"), { recursive: true });
    await writeFile(join(directory, "project.json"), JSON.stringify({ format_version: 1, name, created_at: new Date().toISOString() }));
    await writeFile(join(directory, "config.json"), JSON.stringify({ store }));
    await writeFile(join(directory, "models/json-schema/draft-07/sales/order.json"), ` {"type":"string","title":"${name}"}\n`);
  }
  await writeFile(join(home, "config.json"), '{"language":"en"}');
  await writeFile(join(home, "registry.json"), JSON.stringify({ format_version: 1, projects: { alpha: { root }, beta: { root: other } }, workspaces: {} }));
  const config: MemsphereConfig = { configPath, scopeRoot: root, homeRoot: home, language: "en", memoryRoot: join(root, "memory"),
    runsRoot: join(root, "runs"), archiveRoot: join(root, "archives"), debug: { agentReview: false, root: join(home, ".runtime") },
    view: { host: "127.0.0.1", port: 0 }, project: { name: "alpha", mounted: [] } };
  const server = createViewServer(config);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const definition = async (project: string, id: string) => fetch(`${origin}/api/projects/${project}/models/definition?model=${encodeURIComponent(id)}`);
    assert.equal((await (await definition("alpha", "sales/order.json")).json()).title, "alpha");
    assert.equal((await (await definition("beta", "sales/order.json")).json()).title, "beta");
    const payload = await (await fetch(`${origin}/api/projects/alpha/models`)).json();
    assert.equal(payload.models.filter((item: { builtin: boolean }) => !item.builtin).length, 1);
    assert.equal((await definition("alpha", "unknown.json")).status, 404);
    assert.equal((await definition("alpha", "../outside.json")).status, 422);
    assert.equal((await fetch(`${origin}/api/projects/unknown/models`)).status, 404);
    await writeFile(join(root, "models/json-schema/draft-07/bad.json"), "broken");
    const mixed = await (await fetch(`${origin}/api/projects/alpha/models`)).json();
    assert.equal(mixed.models.find((item: { id: string }) => item.id === "bad.json").status, "unavailable");
    assert.equal((await definition("alpha", "sales/order.json")).status, 200);
    await mkdir(join(root, "custom"));
    const newSource = '  {"type":"number","title":"New"}\n';
    await writeFile(join(root, "custom/new.json"), newSource);
    const settingsResponse = await fetch(`${origin}/api/projects/alpha/settings/project`);
    const settings = await settingsResponse.json();
    const saved = await fetch(`${origin}/api/projects/alpha/settings/project`, { method: "PUT", headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ expectedRevision: settings.diskRevision, config: { ...settings.config, modelsDirectory: "custom" } }) });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).resolvedPaths.modelsDirectory, join(root, "custom"));
    assert.equal((await (await definition("alpha", "new.json")).json()).source, newSource);
    assert.equal((await definition("alpha", "sales/order.json")).status, 404);
    assert.equal((await definition("beta", "sales/order.json")).status, 200);
    assert.equal(JSON.parse(await readFile(configPath, "utf8")).modelsDirectory, "custom");
    assert.match(await readFile(join(root, "models/json-schema/draft-07/sales/order.json"), "utf8"), /alpha/);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
});
