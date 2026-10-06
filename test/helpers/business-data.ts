import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { createBusinessStore } from "../../src/project/business-stores.js";

export const objectSchema = { type: "object", properties: { name: { type: "string" }, count: { type: "integer", minimum: 0 }, items: { type: "array", items: { type: "integer" } } }, required: ["name", "count"], additionalProperties: false };
export async function businessFixture(t: TestContext, schemas: Record<string, unknown> = { "record.json": objectSchema }) {
  const directory = await fs.mkdtemp(join(tmpdir(), "memsphere-business-data-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = join(directory, "project"); const home = join(directory, "home"); const cwd = join(directory, "workspace");
  await fs.mkdir(join(root, "models", "json-schema", "draft-07"), { recursive: true });
  await fs.mkdir(home); await fs.mkdir(cwd); await fs.mkdir(join(root, "memory"));
  await fs.writeFile(join(root, "config.json"), JSON.stringify({ store: { type: "managed", branch: "master", published_revision: "fixture" } }));
  await fs.writeFile(join(root, "project.json"), JSON.stringify({ format_version: 1, name: "test-project", created_at: "2026-10-05T00:00:00.000Z" }));
  await fs.writeFile(join(home, "registry.json"), JSON.stringify({ format_version: 1, projects: { "test-project": { root } }, workspaces: {} }));
  for (const [name, schema] of Object.entries(schemas)) await fs.writeFile(join(root, "models", "json-schema", "draft-07", name), JSON.stringify(schema));
  const createStore = async (id = "records", model = "record.json", kind: "value" | "data" = "value", config: Record<string, unknown> = { directory: `data/${id}` }, dryRun = false) =>
    createBusinessStore({}, root, id, { model, kind, factory: kind === "value" ? "memsphere/filesystem-json" : "memsphere/filesystem", config }, dryRun);
  return { directory, root, home, cwd, createStore };
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
