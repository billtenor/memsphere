import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { applyExampleRelocation, exampleRelocationBaseline, planExampleRelocation, restoreExampleRelocation, type ExampleRelocationPlan } from "../src/project/example-relocation.js";
import { createModelRegistrationStore, readModelRegistrations } from "../src/project/model-registration.js";
import { validateModelStoragePaths } from "../src/project/model-storage-paths.js";
import { checkModelDefinition } from "../src/project/model-validation.js";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
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
async function fixture(action: (f: { root: string; target: { name: string; root: string }; plan: ExampleRelocationPlan; backup: string; sources: Map<string, Buffer> }) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "example-relocation-test-")));
  try {
    const config = Buffer.from(JSON.stringify({ store: { type: "managed", branch: "master", published_revision: "test" } }));
    const manifest = Buffer.from(JSON.stringify({ format_version: 1, name: "memsphere", created_at: "2026-10-03T00:00:00.000Z" }));
    await writeFile(join(root, "config.json"), config);
    await writeFile(join(root, "project.json"), manifest);
    const paths = await validateModelStoragePaths({ root });
    const store = await createModelRegistrationStore({}, "fixture", join(paths.registrationDirectory, "project"));
    const sources = new Map<string, Buffer>();
    const targets: ExampleRelocationPlan["targets"] = [];
    for (const [index, entry] of exampleRelocationBaseline.entries()) {
      // The frozen historical source is evidence, never the corrected current bundled model.
      const source = await readFile(new URL(`../changes/archive/completed/20261001-project-models/assets/use-case-models/${basename(entry.modelRef)}`, import.meta.url));
      assert.equal(digest(source), entry.sourceDigest);
      sources.set(entry.modelRef, source);
      const path = join(paths.modelsDirectory, entry.modelRef);
      await mkdir(dirname(path), { recursive: true }); await writeFile(path, source);
      const recordId = `historical-${index}`;
      await store.create({}, recordId, entry.registration);
      targets.push({ modelRef: entry.modelRef, definitionDigest: entry.sourceDigest, recordId,
        recordDigest: digest(await readFile(join(paths.registrationDirectory, "project", `${recordId}.json`))) });
    }
    await writeFile(join(paths.modelsDirectory, "unrelated.json"), '\uFEFF {"type":"string","examples":[{"$ref":"examples/01-basic-types.json"}]}\r\n');
    await store.create({}, "unrelated", { modelRef: "unrelated.json", storage: "store", store_id: "models/json-schema/draft-07", name: "Keep" });
    const plan: ExampleRelocationPlan = { version: 1, operationId: randomUUID(), createdAt: new Date().toISOString(), project: { name: "memsphere", root },
      configDigest: digest(config), projectManifestDigest: digest(manifest), paths, targets, marketDigest: "0".repeat(64), preservedDigest: "0".repeat(64) };
    const backup = join(paths.backupDirectory, "20261003-model-catalogs", plan.operationId);
    await mkdir(backup, { recursive: true });
    await writeFile(join(backup, "manifest.json"), JSON.stringify(plan));
    for (const entry of targets) {
      const definition = join(backup, "definitions", entry.modelRef);
      await mkdir(dirname(definition), { recursive: true }); await writeFile(definition, sources.get(entry.modelRef)!);
      const registration = join(backup, "registrations", `${entry.recordId}.json`);
      await mkdir(dirname(registration), { recursive: true });
      await writeFile(registration, await readFile(join(paths.registrationDirectory, "project", `${entry.recordId}.json`)));
    }
    await action({ root, target: plan.project, plan, backup, sources });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("historical examples are rejected before planning or moving bytes, with no legacy reference exception", async () => fixture(async f => {
  const before = await snapshot(f.root);
  await assert.rejects(planExampleRelocation({}, f.target), { code: "MODEL_REFERENCE_UNSUPPORTED" });
  assert.deepEqual(await snapshot(f.root), before, "planning must remain completely read-only");
  await assert.rejects(applyExampleRelocation({}, f.plan), { code: "MODEL_REFERENCE_UNSUPPORTED" });
  assert.deepEqual(await snapshot(join(f.root, "models")), new Map([...before].filter(([key]) => key.startsWith("models/")).map(([key, value]) => [key.slice(7), value])));
}));

test("valid historical backup cannot reintroduce cross-model refs, even on repeated restore or with missing originals", async () => fixture(async f => {
  for (const entry of f.plan.targets) {
    await rm(join(f.plan.paths.modelsDirectory, entry.modelRef));
    await rm(join(f.plan.paths.registrationDirectory, "project", `${entry.recordId}.json`));
  }
  const before = await snapshot(join(f.root, "models"));
  for (let index = 0; index < 2; index++) {
    await assert.rejects(restoreExampleRelocation({}, f.backup), { code: "MODEL_REFERENCE_UNSUPPORTED" });
    assert.deepEqual(await snapshot(join(f.root, "models")), before);
    assert.equal((await readModelRegistrations({}, { root: f.root })).records.length, 1);
  }
  assert.match(await readFile(join(f.backup, "definitions/examples/06-references-and-recursion.json"), "utf8"), /examples\/07-scalar-enum-root.json/);
}));

test("historical Runtime-unsupported definitions fail the same complete check as current candidates without removing constraints", async () => fixture(async f => {
  for (const ref of ["examples/04-dictionaries-and-encodings.json", "examples/05-unions-and-conditions.json"]) {
    const source = f.sources.get(ref)!.toString("utf8");
    await checkModelDefinition({}, { modelRef: ref, definition: undefined, source }, "definition");
    await assert.rejects(checkModelDefinition({}, { modelRef: ref, definition: undefined, source }), { code: "MODEL_RUNTIME_UNSUPPORTED" });
    assert.equal(await readFile(join(f.backup, "definitions", ref), "utf8"), source);
  }
}));

test("historical backup integrity and ownership protections preserve conflicting or corrupted bytes", async () => {
  for (const kind of ["checksum", "moved", "target", "owner", "config"] as const) await fixture(async f => {
    const first = f.plan.targets[0]!;
    if (kind === "checksum") await writeFile(join(f.backup, "definitions", first.modelRef), "{}");
    if (kind === "moved") { await mkdir(join(f.backup, "removed")); await writeFile(join(f.backup, "removed/0"), "later edit"); }
    if (kind === "target") await writeFile(join(f.plan.paths.modelsDirectory, first.modelRef), '{"type":"boolean"}');
    if (kind === "owner") {
      await rm(join(f.plan.paths.registrationDirectory, "project", `${first.recordId}.json`));
      const store = await createModelRegistrationStore({}, "fixture", join(f.plan.paths.registrationDirectory, "project"));
      await store.create({}, "new-owner", exampleRelocationBaseline[0]!.registration);
    }
    if (kind === "config") await writeFile(join(f.root, "config.json"), JSON.stringify({ ...JSON.parse(await readFile(join(f.root, "config.json"), "utf8")), modelsDirectory: "elsewhere" }));
    const before = await snapshot(join(f.root, "models"));
    await assert.rejects(restoreExampleRelocation({}, f.backup), /Backup checksum|Moved original has changed|overwrite different content|registered elsewhere|configuration or storage mapping changed/);
    assert.deepEqual(await snapshot(join(f.root, "models")), before);
  });
});
