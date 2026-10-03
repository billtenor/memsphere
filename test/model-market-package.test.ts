import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import crossSpawn from "cross-spawn";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import test from "node:test";
const execute = promisify(execFile);

async function snapshot(root: string): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  async function visit(path: string, prefix: string) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) await visit(join(path, item.name), relative);
      else result.set(relative, await readFile(join(path, item.name)));
    }
  }
  await visit(root, "");
  return new Map([...result].sort(([a], [b]) => a.localeCompare(b)));
}

test("Packed distribution independently creates persistent system models, imports the eight-model example package and restores the approved examples", async () => {
  const repository = resolve(import.meta.dirname, "..");
  // npm pretest performs the clean build. Never recurse into npm test/build from a test.
  await readFile(join(repository, "dist/reserved/models.js"));
  const temporary = await mkdtemp(join(tmpdir(), "model-market-package-"));
  let server: ReturnType<(typeof import("../src/commands/view.js"))["createViewServer"]> | undefined;
  try {
    const packResult = crossSpawn.sync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary, "--cache", join(temporary, "npm-cache")], { cwd: repository, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    if (packResult.error) throw packResult.error;
    assert.equal(packResult.status, 0, packResult.stderr || `npm pack exited with status ${packResult.status}`);
    const packed = JSON.parse(packResult.stdout) as { filename: string; files: { path: string }[] }[];
    const shipped = new Set(packed[0]!.files.map(file => file.path));
    for (const required of ["reserved-models/manifest.json", "scripts/relocate-example-models.mjs", "dist/project/example-relocation.js", "dist/project/example-relocation-baseline.js"]) assert.ok(shipped.has(required), `missing published ${required}`);
    assert.equal([...shipped].some(path => /^(src|examples|changes)\//.test(path)), false);
    assert.equal([...shipped].filter(path => path.startsWith("reserved-models/system-models/") && path.endsWith(".json")).length, 5);
    assert.equal([...shipped].filter(path => path.startsWith("reserved-models/market-models/") && path.endsWith(".json")).length, 8);
    await execute("tar", ["-xzf", join(temporary, packed[0]!.filename), "-C", temporary]);
    const packageRoot = join(temporary, "package");
    // Offline dependency linkage; all application modules, scripts and assets come from this tarball.
    await symlink(join(repository, "node_modules"), join(packageRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    const catalogModule = await import(pathToFileURL(join(packageRoot, "dist/reserved/models.js")).href) as typeof import("../src/reserved/models.js");
    const catalog = catalogModule.readReservedModelCatalog();
    assert.equal(catalog.systemModels.length, 5);
    assert.deepEqual(catalog.marketPackages.map(pack => [pack.id, pack.models.length]), [["memsphere.examples", 8]]);
    for (const model of [...catalog.systemModels, ...catalog.marketPackages.flatMap(pack => pack.models)]) {
      assert.ok(model.sourcePath.startsWith(join(packageRoot, "reserved-models")));
      assert.deepEqual(Buffer.from(model.source), await readFile(model.sourcePath));
    }
    assert.equal(catalog.marketPackages[0]!.models[1]!.registration.modelRef, "examples/02-nested-order.json");
    assert.equal(catalog.marketPackages[0]!.models.some(model => model.registration.modelRef === "memsphere/examples/order.json"), false);

    const home = join(temporary, "home");
    const gitConfig = join(temporary, "gitconfig");
    await writeFile(gitConfig, "[user]\n\tname = Packed Model Test\n\temail = packed-model@example.test\n[commit]\n\tgpgsign = false\n");
    const env = { ...process.env, MEMSPHERE_HOME: home, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1" };
    delete env.MEMSPHERE_PROJECT;
    const command = (executable: string, args: string[], cwd = packageRoot) => {
      const result = crossSpawn.sync(executable, args, { cwd, env, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
      if (result.error) throw result.error;
      return result;
    };
    const successful = (executable: string, args: string[], cwd = packageRoot) => {
      const result = command(executable, args, cwd);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return result.stdout;
    };
    const cli = join(packageRoot, "dist/cli.js");
    successful(process.execPath, [cli, "project", "create", "memsphere"]);
    const workspace = join(temporary, "embedded-workspace");
    await mkdir(join(workspace, ".memsphere/memory"), { recursive: true });
    successful("git", ["init", "-b", "master"], workspace);
    successful("git", ["commit", "--allow-empty", "-m", "Initialize test workspace"], workspace);
    successful(process.execPath, [cli, "project", "create", "embedded", "--embedded", ".memsphere/memory"], workspace);
    const configModule = await import(pathToFileURL(join(packageRoot, "dist/config.js")).href) as typeof import("../src/config.js");
    for (const name of ["memsphere", "embedded"]) {
      const root = join(home, "projects", name);
      // This separate process proves persisted data can be read after the creating process exits.
      const reopened = JSON.parse(successful(process.execPath, ["--input-type=module", "-e", `
        import { readFile } from 'node:fs/promises';
        import { createProjectModelHost } from './dist/project/models.js';
        import { readModelRegistrations } from './dist/project/model-registration.js';
        const root = process.argv[1];
        const config = JSON.parse(await readFile(root + '/config.json', 'utf8'));
        const input = { root, modelsDirectory: config.modelsDirectory, modelRegistration: config.modelRegistration };
        const host = await createProjectModelHost({}, input);
        const records = await readModelRegistrations({}, input);
        const models = await Promise.all((await host.list()).map(model => host.definition(model.id)));
        console.log(JSON.stringify({ records: records.records, models }));
      `, root])) as { records: { origin: string; registration: { modelRef: string; storage: string; store_id: string } }[]; models: { id: string; source: string; origin: string; metaModel: string }[] };
      assert.equal(reopened.records.filter(record => record.origin === "system").length, 5);
      assert.equal(reopened.models.length, 5);
      for (const source of catalog.systemModels) {
        const model = reopened.models.find(model => model.id === source.registration.modelRef)!;
        assert.equal(model.source, source.source);
        assert.equal(model.origin, "system");
        assert.equal(model.metaModel, source.metaModel);
        const record = reopened.records.find(record => record.registration.modelRef === model.id)!;
        assert.equal(record.registration.storage, "store");
        assert.equal(record.registration.store_id, source.registration.store_id);
        const relative = `models/registrations/system/definitions/${source.metaModel}/${model.id}.json`;
        assert.deepEqual(await readFile(join(root, relative)), Buffer.from(source.source));
      }
    }

    const config = await configModule.readProjectConfig("embedded", home);
    const packedView = await import(pathToFileURL(join(packageRoot, "dist/commands/view.js")).href) as typeof import("../src/commands/view.js");
    server = packedView.createViewServer(config);
    await new Promise<void>(done => server!.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const market = await (await fetch(`${origin}/api/projects/embedded/models/market`)).json();
    assert.deepEqual(market.packages.map((pack: { id: string; models: unknown[] }) => [pack.id, pack.models.length]), [["memsphere.examples", 8]]);
    for (const pack of market.packages) {
      const before = await (await fetch(`${origin}/api/projects/embedded/models`)).json();
      const imported = await fetch(`${origin}/api/projects/embedded/models/market/import`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ packageId: pack.id, expectedRevision: before.configRevision }) });
      assert.equal(imported.status, 200, await imported.clone().text());
      assert.equal((await imported.json()).status, "imported");
      for (const model of pack.models) {
        const definition = await (await fetch(`${origin}/api/projects/embedded/models/definition?model=${encodeURIComponent(model.registration.modelRef)}`)).json();
        assert.equal(definition.source, model.source);
        assert.equal(definition.registration.store_id, "models/imported/json-schema/draft-07");
        assert.equal(definition.origin, "market");
      }
    }
    await new Promise<void>(done => server!.close(() => done())); server = undefined;

    // Construct the historical fixture only from published definitions and the published approved baseline.
    const relocation = await import(pathToFileURL(join(packageRoot, "dist/project/example-relocation.js")).href) as typeof import("../src/project/example-relocation.js");
    const registrationModule = await import(pathToFileURL(join(packageRoot, "dist/project/model-registration.js")).href) as typeof import("../src/project/model-registration.js");
    const root = join(home, "projects/memsphere");
    const models = join(root, "models/json-schema/draft-07");
    await mkdir(join(models, "examples"), { recursive: true });
    const store = await registrationModule.createModelRegistrationStore({}, "fixture", join(root, "models/registrations/project"));
    const examplePackage = catalog.marketPackages.find(pack => pack.id === "memsphere.examples")!;
    for (const baseline of relocation.exampleRelocationBaseline) {
      await writeFile(join(models, baseline.modelRef), examplePackage.models.find(model => model.registration.modelRef === baseline.modelRef)!.source);
      await store.create({}, randomUUID(), baseline.registration);
    }
    const original = await snapshot(join(root, "models"));
    const script = join(packageRoot, "scripts/relocate-example-models.mjs");
    const planPath = join(temporary, "relocation-plan.json");
    successful(process.execPath, [script, "plan", "--project", "memsphere", "--out", planPath]);
    assert.deepEqual(await snapshot(join(root, "models")), original);
    const applied = JSON.parse(successful(process.execPath, [script, "apply", "--plan", planPath])) as { status: string; backup: string; rehearsalPassed: boolean };
    assert.equal(applied.status, "applied");
    assert.equal(applied.rehearsalPassed, true);
    const afterApply = await snapshot(join(root, "models"));
    assert.equal((await registrationModule.readModelRegistrations({}, { root })).records.filter(record => record.origin === "project").length, 0);
    assert.equal(JSON.parse(successful(process.execPath, [script, "apply", "--plan", planPath])).status, "unchanged");
    assert.deepEqual(await snapshot(join(root, "models")), afterApply);

    const backupDefinition = join(applied.backup, "definitions", relocation.exampleRelocationBaseline[0]!.modelRef);
    const backupBytes = await readFile(backupDefinition);
    await writeFile(backupDefinition, "{}");
    const badBackup = command(process.execPath, [script, "restore", "--backup", applied.backup]);
    assert.notEqual(badBackup.status, 0);
    assert.match(badBackup.stderr, /Backup checksum/);
    assert.deepEqual(await snapshot(join(root, "models")), afterApply);
    await writeFile(backupDefinition, backupBytes);

    const conflictPath = join(models, relocation.exampleRelocationBaseline.at(-1)!.modelRef);
    await writeFile(conflictPath, '{"type":"boolean"}');
    const beforeConflict = await snapshot(join(root, "models"));
    const conflict = command(process.execPath, [script, "restore", "--backup", applied.backup]);
    assert.notEqual(conflict.status, 0);
    assert.match(conflict.stderr, /conflict|different|changed/i);
    assert.deepEqual(await snapshot(join(root, "models")), beforeConflict);
    await rm(conflictPath);
    assert.equal(JSON.parse(successful(process.execPath, [script, "restore", "--backup", applied.backup])).status, "restored");
    // Comparing the complete files includes registration IDs, revisions and timestamps.
    assert.deepEqual(await snapshot(join(root, "models")), original);
    assert.equal(JSON.parse(successful(process.execPath, [script, "restore", "--backup", applied.backup])).unchanged, true);
    assert.deepEqual(await snapshot(join(root, "models")), original);
  } finally {
    if (server) await new Promise<void>(done => server!.close(() => done()));
    await rm(temporary, { recursive: true, force: true });
  }
});
