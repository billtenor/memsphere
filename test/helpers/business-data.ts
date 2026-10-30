import { randomUUID } from "node:crypto";
import { createModelRegistrationStore, modelDefinitionHash } from "../../src/project/model-registration.js";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { createBusinessStore } from "../../src/project/business-stores.js";

export const objectSchema = { type: "object", properties: { name: { type: "string" }, count: { type: "integer", minimum: 0 }, items: { type: "array", items: { type: "integer" } } }, required: ["name", "count"], additionalProperties: false };
export async function businessFixture(t: TestContext, schemas: Record<string, unknown> = { "record.json": objectSchema }) {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "memsphere-business-data-")));
  const cleanups: Array<() => Promise<void>> = [];
  const beforeCleanup = (cleanup: () => Promise<void>) => { cleanups.push(cleanup); };
  t.after(async () => {
    for (const cleanup of cleanups) await cleanup();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const root = join(directory, "project"); const home = join(directory, "home"); const cwd = join(directory, "workspace");
  await fs.mkdir(join(root, "models", "json-schema", "draft-07"), { recursive: true });
  await fs.mkdir(home); await fs.mkdir(cwd); await fs.mkdir(join(root, "memory"));
  await fs.writeFile(join(root, "config.json"), JSON.stringify({ store: { type: "managed", branch: "master", published_revision: "fixture" } }));
  await fs.writeFile(join(root, "project.json"), JSON.stringify({ format_version: 1, name: "test-project", created_at: "2026-10-05T00:00:00.000Z" }));
  await fs.writeFile(join(home, "registry.json"), JSON.stringify({ format_version: 1, projects: { "test-project": { root } }, workspaces: {} }));
  for (const [name, schema] of Object.entries(schemas)) await fs.writeFile(join(root, "models", "json-schema", "draft-07", name), JSON.stringify(schema));
  const registerModels = async (refs = Object.keys(schemas)) => {
    for (const ref of refs) {
      const directory = join(root, "models/registrations/project");
      const registry = await createModelRegistrationStore({}, "fixture-registrations", directory);
      const page = await registry.list({}, { limit: 1000 });
      let exists = false;
      for (const item of page.items) if (((await registry.get({}, item.id))?.value as { modelRef?: string } | undefined)?.modelRef === ref) exists = true;
      if (!exists) await registry.create({}, randomUUID(), { modelRef: ref, storage: "store", store_id: "models/json-schema/draft-07", definition_sha256: modelDefinitionHash(await fs.readFile(join(root, "models/json-schema/draft-07", ref))) });
    }
  };
  const createStore = async (id = "records", model = "record.json", kind: "value" | "data" = "value", config: Record<string, unknown> = { directory: `data/${id}` }, dryRun = false) => {
    return createBusinessStore({}, root, id, { model, kind, factory: kind === "value" ? "memsphere/filesystem-json" : "memsphere/filesystem", config }, dryRun);
  };
  await registerModels();
  return { directory, root, home, cwd, createStore, beforeCleanup, registerModels };
}

export async function snapshotTree(root: string): Promise<unknown[]> {
  const result: unknown[] = [];
  async function visit(directory: string, prefix: string) {
    for (const name of (await fs.readdir(directory)).sort()) {
      const path = join(directory, name); const relative = `${prefix}${name}`; const stat = await fs.lstat(path);
      if (stat.isSymbolicLink()) result.push([relative, "link", await fs.readlink(path)]);
      else if (stat.isDirectory()) { result.push([relative, "directory", stat.mtimeMs]); await visit(path, `${relative}/`); }
      else result.push([relative, "file", stat.mtimeMs, (await fs.readFile(path)).toString("hex")]);
    }
  }
  await visit(root, ""); return result;
}

/** Fixture publication preserves the exact source while updating its registration. */
export async function publishFixtureDefinition(root: string, ref: string, source: string) {
  await fs.writeFile(join(root, "models/json-schema/draft-07", ref), source);
  const registry = await createModelRegistrationStore({}, "fixture-registrations", join(root, "models/registrations/project"));
  const page = await registry.list({}, { limit: 1000 });
  for (const item of page.items) {
    const row = (await registry.get({}, item.id))!;
    const value = row.value as { modelRef: string };
    if (value.modelRef === ref) {
      await registry.update({}, item.id, { ...value, definition_sha256: modelDefinitionHash(source) }, { expectedRevision: row.revision });
      return;
    }
  }
  await registry.create({}, randomUUID(), { modelRef: ref, storage: "store", store_id: "models/json-schema/draft-07", definition_sha256: modelDefinitionHash(source) });
}
