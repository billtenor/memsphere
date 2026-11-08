import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("project models initialize CLI resolves the explicit Project, persists defaults and retains repeat metadata", async () => {
  const home = await mkdtemp(join(tmpdir(), "memsphere-model-cli-"));
  const root = join(home, "projects/demo");
  try {
    await mkdir(join(root, "models/json-schema/draft-07"), { recursive: true });
    await mkdir(join(root, "memory"));
    await writeFile(join(root, "project.json"), JSON.stringify({ format_version: 1, name: "demo", created_at: new Date().toISOString() }));
    await writeFile(join(root, "config.json"), JSON.stringify({ store: { type: "managed", branch: "master", published_revision: "test" } }));
    await writeFile(join(home, "registry.json"), JSON.stringify({ format_version: 1, projects: { demo: { root } }, workspaces: {} }));
    const source = ' {"type":"string","title":"Keep identity"}\n';
    await writeFile(join(root, "models/json-schema/draft-07/test.json"), source);
    const run = (name: string) => spawnSync(process.execPath, [resolve("dist/cli.js"), "project", "models", "initialize", name, "--output", "json"], { encoding: "utf8", env: { ...process.env, MEMSPHERE_HOME: home } });
    const first = run("demo");
    assert.equal(first.status, 0, first.stderr);
    assert.ok(first.stdout.trim(), JSON.stringify(first));
    assert.equal(JSON.parse(first.stdout).created, 1);
    assert.equal(JSON.parse(first.stdout).system.created, 5);
    assert.equal(JSON.parse(await readFile(join(root, "config.json"), "utf8")).modelRegistration.storeId, "memsphere/model-registrations");
    const configBytes = await readFile(join(root, "config.json"));
    const configMtime = (await stat(join(root, "config.json"))).mtimeMs;
    const repeat = run("demo");
    assert.equal(repeat.status, 0, repeat.stderr);
    assert.equal(JSON.parse(repeat.stdout).created, 0);
    assert.equal(JSON.parse(repeat.stdout).retained, 1);
    assert.equal(JSON.parse(repeat.stdout).system.status, "unchanged");
    assert.deepEqual(await readFile(join(root, "config.json")), configBytes);
    assert.equal((await stat(join(root, "config.json"))).mtimeMs, configMtime);
    assert.equal(await readFile(join(root, "models/json-schema/draft-07/test.json"), "utf8"), source);
    assert.notEqual(run("missing").status, 0);
  } finally { await rm(home, { recursive: true, force: true }); }
});
