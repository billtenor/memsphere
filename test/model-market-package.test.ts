import assert from "node:assert/strict";
import crossSpawn from "cross-spawn";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { MemsphereConfig } from "../src/config.js";
const execute = promisify(execFile);
test("Packed distribution contains model market assets and its HTTP host imports without workspace source files", async () => {
  const repository = resolve(import.meta.dirname, "..");
  // npm pretest performs the clean build. Never recurse into npm test/build from a test.
  await readFile(join(repository, "dist/project/model-market-assets.js"));
  const temporary = await mkdtemp(join(tmpdir(), "model-market-package-"));
  let server: ReturnType<(typeof import("../src/commands/view.js"))["createViewServer"]> | undefined;
  try {
    const packResult = crossSpawn.sync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary, "--cache", join(temporary, "npm-cache")], { cwd: repository, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    if (packResult.error) throw packResult.error;
    assert.equal(packResult.status, 0, packResult.stderr || `npm pack exited with status ${packResult.status}`);
    const packed = JSON.parse(packResult.stdout) as {
      filename: string;
      files: {
        path: string;
      }[];
    }[];
    assert.ok(packed[0]!.files.some(file => file.path === "dist/project/model-market-assets.js"));
    assert.equal(packed[0]!.files.some(file => file.path.startsWith("src/") || file.path.startsWith("examples/")), false);
    await execute("tar", ["-xzf", join(temporary, packed[0]!.filename), "-C", temporary]);
    const packageRoot = join(temporary, "package");
    // Offline dependency linkage; the application and all assets must come from the tarball.
    await symlink(join(repository, "node_modules"), join(packageRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    const packedView = await import(pathToFileURL(join(packageRoot, "dist/commands/view.js")).href) as typeof import("../src/commands/view.js");
    const home = join(temporary, "home");
    const root = join(home, "projects", "demo");
    await mkdir(join(root, "memory"), { recursive: true });
    const configPath = join(root, "config.json");
    await writeFile(configPath, JSON.stringify({ store: { type: "managed", branch: "master", published_revision: "abc" } }));
    await writeFile(join(root, "project.json"), JSON.stringify({ format_version: 1, name: "demo", created_at: new Date().toISOString() }));
    await writeFile(join(home, "config.json"), JSON.stringify({ language: "en" }));
    await writeFile(join(home, "registry.json"), JSON.stringify({ format_version: 1, projects: { demo: { root } }, workspaces: {} }));
    const config: MemsphereConfig = { configPath, scopeRoot: root, homeRoot: home, language: "en", memoryRoot: join(root, "memory"), runsRoot: join(root, "runs"), archiveRoot: join(root, "archives"), debug: { agentReview: false, root: join(home, ".runtime") }, view: { host: "127.0.0.1", port: 0 }, project: { name: "demo", mounted: [] } };
    server = packedView.createViewServer(config);
    await new Promise<void>(done => server!.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const market = await (await fetch(`${origin}/api/projects/demo/models/market`)).json();
    assert.equal(market.packages[0].id, "memsphere.examples.orders");
    assert.equal(market.packages[0].models.length, 1);
    const before = await (await fetch(`${origin}/api/projects/demo/models`)).json();
    const imported = await fetch(`${origin}/api/projects/demo/models/market/import`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ packageId: "memsphere.examples.orders", expectedRevision: before.configRevision }) });
    assert.equal(imported.status, 200, await imported.clone().text());
    assert.equal((await imported.json()).status, "imported");
    const definition = await (await fetch(`${origin}/api/projects/demo/models/definition?model=memsphere%2Fexamples%2Forder.json`)).json();
    assert.equal(definition.source, market.packages[0].models[0].source);
    assert.equal(definition.registration.store_id, "models/imported/json-schema/draft-07");
    assert.equal(definition.origin, "market");
  }
  finally {
    if (server)
      await new Promise<void>(done => server!.close(() => done()));
    await rm(temporary, { recursive: true, force: true });
  }
});
