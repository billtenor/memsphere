import { randomUUID } from "node:crypto";
import { createModelRegistrationStore, modelDefinitionHash } from "../../src/project/model-registration.js";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBusinessStore } from "../../src/project/business-stores.js";
import { ownedSetup } from "../support/owned-setup.js";

export const objectSchema = { type: "object", properties: { name: { type: "string" }, count: { type: "integer", minimum: 0 }, items: { type: "array", items: { type: "integer" } } }, required: ["name", "count"], additionalProperties: false };
type FixturePreparation = (location: { directory: string; root: string; home: string; cwd: string }, acquire: <T>(operation: () => Promise<T>) => Promise<T>) => Promise<void>;
export type FixtureContext = { signal: AbortSignal; after(cleanup: () => Promise<void>): void };
export function businessFixture(t: FixtureContext, schemas: Record<string, unknown> = { "record.json": objectSchema }, prepare?: FixturePreparation) {
  let directory: string | undefined, initializing: Promise<unknown> | undefined;
  const cleanups: Array<() => Promise<void>> = [];
  const context = { signal: t.signal };
  const owner = ownedSetup(t.signal, async () => { await Promise.allSettled([initializing]); });
  // Register before mkdtemp, including ownership of a directory returned late.
  t.after(async () => {
    const settled = owner.stop();
    void settled.catch(() => undefined);
    // Stop consumers first, so they can release resources needed by in-flight I/O.
    const errors: unknown[] = [];
    for (const cleanup of cleanups) {
      try { await cleanup(); } catch (error) { errors.push(error); }
    }
    try { await settled; } catch (error) { errors.push(error); }
    // A failed consumer close may still use the directory. Preserve it, while
    // reporting every failure after attempting all independent consumers.
    if (errors.length) throw new AggregateError(errors, `Fixture cleanup failed; directory retained: ${directory}`);
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });
  const beforeCleanup = (cleanup: () => Promise<void>) => { owner.check(); cleanups.push(cleanup); };
  const ready = Promise.resolve().then(async () => {
    const acquired = await owner.acquire(() => fs.mkdtemp(join(tmpdir(), "memsphere-business-data-")), value => { directory = value; });
    const resolved = await owner.acquire(() => fs.realpath(acquired), value => { directory = value; });
    const root = join(resolved, "project"), home = join(resolved, "home"), cwd = join(resolved, "workspace");
    await owner.acquire(() => fs.mkdir(join(root, "models", "json-schema", "draft-07"), { recursive: true }));
    await owner.acquire(() => fs.mkdir(home)); await owner.acquire(() => fs.mkdir(cwd)); await owner.acquire(() => fs.mkdir(join(root, "memory")));
    await owner.acquire(() => fs.writeFile(join(root, "config.json"), JSON.stringify({ store: { type: "managed", branch: "master", published_revision: "fixture" } }), context));
    await owner.acquire(() => fs.writeFile(join(root, "project.json"), JSON.stringify({ format_version: 1, name: "test-project", created_at: "2026-10-05T00:00:00.000Z" }), context));
    await owner.acquire(() => fs.writeFile(join(home, "registry.json"), JSON.stringify({ format_version: 1, projects: { "test-project": { root } }, workspaces: {} }), context));
    for (const [name, schema] of Object.entries(schemas)) await owner.acquire(() => fs.writeFile(join(root, "models", "json-schema", "draft-07", name), JSON.stringify(schema), context));
    const registerModels = async (refs = Object.keys(schemas)) => {
      for (const ref of refs) {
        const registry = await owner.acquire(() => createModelRegistrationStore(context, "fixture-registrations", join(root, "models/registrations/project")));
        const page = await owner.acquire(() => registry.list(context, { limit: 1000 }));
        let exists = false;
        for (const item of page.items) if (((await owner.acquire(() => registry.get(context, item.id)))?.value as { modelRef?: string } | undefined)?.modelRef === ref) exists = true;
        if (!exists) {
          const definition = await owner.acquire(() => fs.readFile(join(root, "models/json-schema/draft-07", ref), context));
          await owner.acquire(() => registry.create(context, randomUUID(), { modelRef: ref, storage: "store", store_id: "models/json-schema/draft-07", definition_sha256: modelDefinitionHash(definition) }));
        }
      }
    };
    const createStore = async (id = "records", model = "record.json", kind: "value" | "data" = "value", config: Record<string, unknown> = { directory: `data/${id}` }, dryRun = false) => {
      return owner.acquire(() => createBusinessStore(context, root, id, { model, kind, factory: kind === "value" ? "memsphere/filesystem-json" : "memsphere/filesystem", config }, dryRun));
    };
    await registerModels();
    if (prepare) await prepare({ directory: resolved, root, home, cwd }, owner.acquire);
    owner.check();
    return { directory: resolved, root, home, cwd, createStore, beforeCleanup, registerModels };
  });
  initializing = ready;
  return ready;
}

export async function snapshotTree(root: string, emptyLockedFiles: string[] = []): Promise<unknown[]> {
  const result: unknown[] = [];
  async function visit(directory: string, prefix: string) {
    for (const name of (await fs.readdir(directory)).sort()) {
      const path = join(directory, name); const relative = `${prefix}${name}`; const stat = await fs.lstat(path);
      if (stat.isSymbolicLink()) result.push([relative, "link", await fs.readlink(path)]);
      else if (stat.isDirectory()) { result.push([relative, "directory", stat.mtimeMs]); await visit(path, `${relative}/`); }
      else {
        // Windows exclusive claims cannot be read, but carry no payload. Still
        // compare their presence, size and mtime together with all journal bytes.
        const bytes = emptyLockedFiles.includes(relative) && stat.size === 0 ? "" : (await fs.readFile(path)).toString("hex");
        result.push([relative, "file", stat.mtimeMs, bytes]);
      }
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
