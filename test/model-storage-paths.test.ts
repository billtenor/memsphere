import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createProjectModelHost } from "../src/project/models.js";
import { validateModelStoragePaths } from "../src/project/model-storage-paths.js";
async function fixture(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "model-paths-"));
  try {
    await fn(root);
  }
  finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("Project-root scanning prunes every configured registry, backups and retained directories before model reads", async () => fixture(async (root) => {
  for (const directory of ["models/registrations/project", "custom-registry/project", "backups/model-registration/copy", "retained/project"]) {
    await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, directory, "private.json"), '{"not":"a schema"}');
  }
  await writeFile(join(root, "visible.json"), '{"type":"string"}');
  const config = { storeId: "main", stores: { main: { factory: "memsphere/filesystem-json" as const, directory: "models/registrations" }, other: { factory: "memsphere/filesystem-json" as const, directory: "custom-registry" } }, excludedDirectories: ["retained"] };
  // Registry envelope deliberately invalid: diagnostic, never interpreted as a model definition.
  const host = await createProjectModelHost({}, { root, modelsDirectory: ".", modelRegistration: config });
  assert.deepEqual((await host.list()).filter(m => !m.builtin).map(m => m.id), ["visible.json"]);
  for (const id of ["models/registrations/project/private.json", "custom-registry/project/private.json", "backups/model-registration/copy/private.json", "retained/project/private.json"])
    await assert.rejects(host.definition(id), /not found/);
}));
test("Conflicting scan roots and canonical symlink aliases fail before any write", async () => fixture(async (root) => {
  await mkdir(join(root, "registry"));
  await symlink(join(root, "registry"), join(root, "alias"));
  const config = { storeId: "main", stores: { main: { factory: "memsphere/filesystem-json" as const, directory: "registry" } } };
  for (const modelsDirectory of ["registry", "registry/nested", "alias", "alias/nested"])
    await assert.rejects(validateModelStoragePaths({ root, modelsDirectory, modelRegistration: config }), /conflict/);
  await assert.rejects(validateModelStoragePaths({ root, modelsDirectory: "models", modelRegistration: { storeId: "main", stores: { main: { factory: "memsphere/filesystem-json", directory: "." } } } }), /conflict/);
  await assert.rejects(validateModelStoragePaths({ root, modelRegistration: { storeId: "main", stores: { main: { factory: "memsphere/filesystem-json", directory: "backups" } } } }), /conflict/);
}));
