import { writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { createHash } from "node:crypto";
import { createModelRegistrationStore, modelDefinitionHash } from "../../src/project/model-registration.js";

const stores = new Map<string, ReturnType<typeof createModelRegistrationStore>>();

/** Fixture publication keeps definitions and registrations consistent; invalid
 * schema bodies are intentional fixtures for runtime diagnostic tests. */
export async function writeRegisteredFixtureFile(path: string, source: string) {
  await writeFile(path, source);
  const marker = `${sep}${join("models", "json-schema", "draft-07")}${sep}`, index = path.indexOf(marker);
  if (index < 0 || !path.endsWith(".json")) return;
  await registerFixtureDefinition(path.slice(0, index), path.slice(index + marker.length), source);
}

export async function registerFixtureDefinition(root: string, modelRef: string, source: string) {
  if (!stores.has(root)) stores.set(root, createModelRegistrationStore({}, "fixture-registrations", join(root, "models/registrations/project")));
  const store = await stores.get(root)!;
  const id = createHash("sha256").update(modelRef).digest("hex"), row = await store.get({}, id);
  let definition: { title?: unknown; description?: unknown } = {};
  try { definition = JSON.parse(source.replace(/^\uFEFF/, "")); } catch { /* Keep invalid-source fixtures registered. */ }
  const value = { modelRef, storage: "store", store_id: "models/json-schema/draft-07", definition_sha256: modelDefinitionHash(source),
    ...(typeof definition?.title === "string" ? { name: definition.title } : {}),
    ...(typeof definition?.description === "string" ? { description: definition.description } : {}) };
  if (row) await store.update({}, id, value, { expectedRevision: row.revision });
  else await store.create({}, id, value);
}
