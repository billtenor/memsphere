import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyExampleRelocation, exampleRelocationBaseline, planExampleRelocation, restoreExampleRelocation } from "../src/project/example-relocation.js";
import { createModelRegistrationStore, readModelRegistrations } from "../src/project/model-registration.js";
import { createProjectModelHost } from "../src/project/models.js";
import { readBundledMarketModelPackages } from "../src/reserved/models.js";

type Fixture = { root: string; models: string; registrations: string; target: { name: string; root: string }; original: Map<string, Buffer> };
/** Same construction can be run using the installed package's dist modules. */
async function fixture(action: (fixture: Fixture) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "example-relocation-test-")));
  const models = join(root, "models/json-schema/draft-07");
  const registrations = join(root, "models/registrations/project");
  try {
    await writeFile(join(root, "config.json"), JSON.stringify({ store: { type: "managed", branch: "master", published_revision: "test" } }));
    await writeFile(join(root, "project.json"), JSON.stringify({ format_version: 1, name: "memsphere", created_at: "2026-10-03T00:00:00.000Z" }));
    await mkdir(join(models, "examples"), { recursive: true });
    const pack = readBundledMarketModelPackages().find(pack => pack.id === "memsphere.examples")!;
    const store = await createModelRegistrationStore({}, "fixture", registrations);
    for (const item of exampleRelocationBaseline) {
      await writeFile(join(models, item.modelRef), pack.models.find(model => model.registration.modelRef === item.modelRef)!.source);
      await store.create({}, randomUUID(), item.registration);
    }
    await writeFile(join(models, "unrelated.json"), '\uFEFF {"type":"string", "examples":[{"$ref":"examples/01-basic-types.json"}]}\r\n');
    await store.create({}, "unrelated", { modelRef: "unrelated.json", storage: "store", store_id: "models/json-schema/draft-07", name: "Keep" });
    // An unrelated imported definition, including publication metadata, must remain byte-identical.
    const imported = await createModelRegistrationStore({}, "imported", join(root, "models/registrations/imported"));
    await imported.create({}, "retained-import", { modelRef: "retained.json", storage: "store", store_id: "models/imported/json-schema/draft-07", package: "retained" });
    await mkdir(join(root, "models/registrations/imported-definitions"), { recursive: true });
    await writeFile(join(root, "models/registrations/imported-definitions/retained.json"), '{"type":"number"}\n');
    await writeFile(join(root, "models/registrations/published-imports.json"), '{"recordIds":["retained-import"]}\n');
    const original = await snapshot(join(root, "models"));
    await action({ root, models, registrations, target: { name: "memsphere", root }, original });
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function snapshot(root: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  async function visit(path: string, prefix: string) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) await visit(join(path, item.name), relative);
      else files.set(relative, await readFile(join(path, item.name)));
    }
  }
  await visit(root, "");
  return new Map([...files].sort(([a], [b]) => a.localeCompare(b)));
}
async function assertOriginal(f: Fixture) { assert.deepEqual(await snapshot(join(f.root, "models")), f.original); }

test("example relocation plans without writes, moves only eight exact models, and restores complete original records", async () => fixture(async f => {
  const before = await snapshot(f.root);
  const plan = await planExampleRelocation({}, f.target);
  assert.deepEqual(await snapshot(f.root), before);
  const result = await applyExampleRelocation({}, plan);
  assert.equal(result.status, "applied");
  assert.equal(result.rehearsalPassed, true);
  assert.equal(result.backup, join(f.root, "backups/model-registration/20261003-model-catalogs", plan.operationId));
  const host = await createProjectModelHost({}, { root: f.root });
  const listed = await host.list();
  assert.equal(listed.filter(model => model.id.startsWith("examples/")).length, 0);
  assert.equal(listed.find(model => model.id === "retained.json")!.origin, "market");
  assert.equal((await readModelRegistrations({}, { root: f.root })).records.filter(record => record.origin === "project").length, 1);
  const log = await readFile(join(result.backup, "operation-log.json"));
  assert.equal((await applyExampleRelocation({}, plan)).status, "unchanged");
  assert.deepEqual(await readFile(join(result.backup, "operation-log.json")), log);
  const restored = await restoreExampleRelocation({}, result.backup);
  assert.equal(restored.status, "restored");
  await assertOriginal(f);
  assert.equal((await restoreExampleRelocation({}, result.backup)).unchanged, true);
  await assertOriginal(f);
  const originalRecords = plan.targets.map(target => target.recordId);
  assert.ok((await readModelRegistrations({}, { root: f.root })).records.filter(record => originalRecords.includes(record.id)).length === 8);
}));

test("relocation rejects changed approved definition and registration values before preparing a plan", async () => fixture(async f => {
  const first = exampleRelocationBaseline[0]!;
  const filename = join(f.models, first.modelRef);
  const original = await readFile(filename);
  await writeFile(filename, Buffer.concat([original, Buffer.from(" ")]));
  await assert.rejects(planExampleRelocation({}, f.target), /approved bytes/);
  await writeFile(filename, original);
  const state = await readModelRegistrations({}, { root: f.root });
  const record = state.records.find(record => record.registration.modelRef === first.modelRef)!;
  const store = await createModelRegistrationStore({}, "fixture", f.registrations);
  await store.update({}, record.id, { ...record.registration, name: "Human edit" });
  await assert.rejects(planExampleRelocation({}, f.target), /approved baseline/);
  assert.equal((await hostDefinition(f, first.modelRef)).registration.name, "Human edit");
}));
async function hostDefinition(f: Fixture, id: string) { return (await createProjectModelHost({}, { root: f.root })).definition(id); }

test("apply rejects definition, record-envelope and config drift after the plan", async () => {
  for (const kind of ["definition", "record", "config"] as const) await fixture(async f => {
    const plan = await planExampleRelocation({}, f.target);
    const filename = kind === "definition" ? join(f.models, plan.targets[0]!.modelRef)
      : kind === "record" ? join(f.registrations, `${plan.targets[0]!.recordId}.json`) : join(f.root, "config.json");
    const content = await readFile(filename);
    await writeFile(filename, Buffer.concat([content, Buffer.from("\n")]));
    const edited = await readFile(filename);
    await assert.rejects(applyExampleRelocation({}, plan), /changed|approved bytes/);
    assert.deepEqual(await readFile(filename), edited);
    assert.equal((await readModelRegistrations({}, { root: f.root })).records.length, 10);
  });
});

test("retained project and imported schemas cannot depend on examples through advanced schema positions", async () => {
  for (const imported of [false, true]) await fixture(async f => {
    const filename = imported ? join(f.root, "models/registrations/imported-definitions/retained.json") : join(f.models, "unrelated.json");
    await writeFile(filename, JSON.stringify({ type: "object", dependencies: { enabled: { allOf: [{ if: { properties: { value: { $ref: "examples/07-scalar-enum-root.json" } } } }] } } }));
    await assert.rejects(planExampleRelocation({}, f.target), /depends on examples/);
    assert.equal((await readModelRegistrations({}, { root: f.root })).records.length, 10);
  });
});

test("bad backups and failed isolated recovery cannot move any original file", async () => fixture(async f => {
  const plan = await planExampleRelocation({}, f.target);
  await assert.rejects(applyExampleRelocation({}, plan, { afterBackup: async root => {
    await writeFile(join(root, "definitions", plan.targets[0]!.modelRef), "{}");
  } }), /Backup checksum/);
  await assertOriginal(f);
  const backup = join(plan.paths.backupDirectory, "20261003-model-catalogs", plan.operationId);
  const failed = JSON.parse(await readFile(join(backup, "receipt.json"), "utf8"));
  assert.equal(failed.originalFilesMoved, false);
  await assert.rejects(restoreExampleRelocation({}, backup), /Backup checksum/);
  await assertOriginal(f);
}));

test("failure after definition, registration and final moves restores the complete original byte snapshot", async () => {
  for (const stop of [0, 1, 7, 15]) await fixture(async f => {
    const plan = await planExampleRelocation({}, f.target);
    await assert.rejects(applyExampleRelocation({}, plan, { afterMove: async index => { if (index === stop) throw new Error(`Injected move ${stop}`); } }), /Injected move/);
    await assertOriginal(f);
    const backup = join(plan.paths.backupDirectory, "20261003-model-catalogs", plan.operationId);
    const failed = JSON.parse(await readFile(join(backup, "receipt.json"), "utf8"));
    assert.equal(failed.rollbackComplete, true);
    assert.equal((await restoreExampleRelocation({}, backup)).unchanged, true);
  });
});

test("interrupted rollback recovers from manifest and files even without the final journal or receipt", async () => fixture(async f => {
  const plan = await planExampleRelocation({}, f.target);
  let backup = "";
  await assert.rejects(applyExampleRelocation({}, plan, {
    afterBackup: async path => { backup = path; },
    afterMove: async index => { if (index === 5) throw new Error("simulated interruption"); },
    beforeRestore: async () => { throw new Error("rollback unavailable"); }
  }), /recovery required/);
  await rm(join(backup, "receipt.json"));
  await rm(join(backup, "operation-log.json"));
  assert.equal((await restoreExampleRelocation({}, backup)).status, "restored");
  await assertOriginal(f);
}));

test("restore checks all target conflicts before writing any missing target and never overwrites newer content", async () => fixture(async f => {
  const plan = await planExampleRelocation({}, f.target);
  const result = await applyExampleRelocation({}, plan);
  const conflict = join(f.models, plan.targets[7]!.modelRef);
  await writeFile(conflict, '{"type":"string","title":"User new content"}');
  const before = await snapshot(join(f.root, "models"));
  await assert.rejects(restoreExampleRelocation({}, result.backup), /overwrite different content/);
  assert.deepEqual(await snapshot(join(f.root, "models")), before);
}));

test("an edit during rehearsal is rejected with no relocation and remains untouched", async () => fixture(async f => {
  const plan = await planExampleRelocation({}, f.target);
  const filename = join(f.models, plan.targets[0]!.modelRef);
  await assert.rejects(applyExampleRelocation({}, plan, { afterRehearsal: async () => { await writeFile(filename, '{"type":"string"}'); } }), /approved bytes/);
  assert.equal(await readFile(filename, "utf8"), '{"type":"string"}');
  assert.equal((await readModelRegistrations({}, { root: f.root })).records.length, 10);
}));

test("restore refuses a new registration for an original identity before restoring files", async () => fixture(async f => {
  const plan = await planExampleRelocation({}, f.target);
  const result = await applyExampleRelocation({}, plan);
  const store = await createModelRegistrationStore({}, "fixture", f.registrations);
  await store.create({}, "new-owner", exampleRelocationBaseline[0]!.registration);
  const before = await snapshot(join(f.root, "models"));
  await assert.rejects(restoreExampleRelocation({}, result.backup), /identity is already registered elsewhere/);
  assert.deepEqual(await snapshot(join(f.root, "models")), before);
}));

test("changed moved originals are retained and never silently replaced by the older backup", async () => fixture(async f => {
  const plan = await planExampleRelocation({}, f.target);
  let backup = "";
  await assert.rejects(applyExampleRelocation({}, plan, {
    afterBackup: async root => { backup = root; },
    afterMove: async index => {
      if (index === 0) {
        await writeFile(join(backup, "removed/0"), "new bytes written through an external file handle");
        throw new Error("external writer detected");
      }
    }
  }), /recovery required/);
  assert.equal(await readFile(join(backup, "removed/0"), "utf8"), "new bytes written through an external file handle");
  await assert.rejects(readFile(join(f.models, plan.targets[0]!.modelRef)), { code: "ENOENT" });
  await assert.rejects(restoreExampleRelocation({}, backup), /Moved original has changed/);
}));

test("success preflight catches an earlier moved original changed without an injected exception", async () => fixture(async f => {
  const plan = await planExampleRelocation({}, f.target);
  let backup = "";
  let moves = 0;
  await assert.rejects(applyExampleRelocation({}, plan, {
    afterBackup: async root => { backup = root; },
    afterMove: async index => {
      moves++;
      if (index === 0) await writeFile(join(backup, "removed/0"), "external edit without a thrown exception");
    }
  }), /Moved original has changed.*recovery required/);
  assert.equal(moves, 16, "the error must be detected by the final full-set verification");
  assert.equal(await readFile(join(backup, "removed/0"), "utf8"), "external edit without a thrown exception");
  await assert.rejects(readFile(join(f.models, plan.targets[0]!.modelRef)), { code: "ENOENT" });
  const failed = JSON.parse(await readFile(join(backup, "receipt.json"), "utf8"));
  assert.equal(failed.status, "failed");
  assert.equal(failed.rollbackComplete, false);
  assert.equal(failed.rollbackErrors.length, 1);
  const journal = JSON.parse(await readFile(join(backup, "operation-log.json"), "utf8"));
  assert.equal(journal.some((entry: { phase: string }) => entry.phase === "complete"), false);
  const expected = new Map(f.original);
  expected.delete(`json-schema/draft-07/${plan.targets[0]!.modelRef}`);
  assert.deepEqual(await snapshot(join(f.root, "models")), expected, "all other records and definitions must be restored unchanged");
}));

test("automatic rollback preserves a new registration owner and reports incomplete recovery instead of creating duplicate identities", async () => fixture(async f => {
  const plan = await planExampleRelocation({}, f.target);
  let backup = "";
  const store = await createModelRegistrationStore({}, "concurrent-writer", f.registrations);
  await assert.rejects(applyExampleRelocation({}, plan, {
    afterBackup: async root => { backup = root; },
    afterMove: async index => {
      if (index === 1) await store.create({}, "concurrent-owner", exampleRelocationBaseline[0]!.registration);
    }
  }), /Retained model content changed.*recovery required/);
  const state = await readModelRegistrations({}, { root: f.root });
  assert.deepEqual(state.diagnostics, [], "rollback must not publish the old registration alongside its new owner");
  const matching = state.records.filter(record => record.registration.modelRef === plan.targets[0]!.modelRef);
  assert.deepEqual(matching.map(record => record.id), ["concurrent-owner"]);
  await assert.rejects(readFile(join(f.models, plan.targets[0]!.modelRef)), { code: "ENOENT" });
  await assert.rejects(readFile(join(f.registrations, `${plan.targets[0]!.recordId}.json`)), { code: "ENOENT" });
  const failed = JSON.parse(await readFile(join(backup, "receipt.json"), "utf8"));
  assert.equal(failed.status, "failed");
  assert.equal(failed.rollbackComplete, false);
  assert.equal(failed.rollbackErrors.length, 2);
  assert.ok(failed.rollbackErrors.every((message: string) => message.includes("identity is already registered elsewhere")));
  assert.deepEqual(await readFile(join(backup, "registrations", `${plan.targets[0]!.recordId}.json`)), f.original.get(`registrations/project/${plan.targets[0]!.recordId}.json`));
}));
