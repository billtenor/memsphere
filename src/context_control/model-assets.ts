import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export const ENTITIES = ["run", "step", "artifact", "external", "review"] as const;
export type Entity = typeof ENTITIES[number];
export const modelId = (entity: Entity) => `memsphere/context_control/${entity}.json`;
export const storeId = (entity: Entity) => `context_control/${entity === "external" ? "externals" : entity === "review" ? "reviews" : `${entity}s`}`;

export function definitionHash(value: unknown): string {
  const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, normalize((v as Record<string, unknown>)[k])])) : v;
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

/** Fixed package paths work from both src and dist; never fall back to a Project. */
export function readContextControlModels() {
  const root = new URL("../../reserved-models/context-control/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8")) as {
    package: string; name: string; models: Array<{ entity: Entity; id: string; name: string; source: string; baselineSha256: string }>;
  };
  if (manifest.package !== "memsphere.context_control" || manifest.models.length !== ENTITIES.length) throw new Error("Invalid context control model manifest");
  return ENTITIES.map(entity => {
    const entries = manifest.models.filter(item => item.entity === entity);
    if (entries.length !== 1 || entries[0].id !== modelId(entity) || entries[0].source !== `${entity}.json`) throw new Error(`Invalid model asset: ${entity}`);
    const entry = entries[0];
    const source = readFileSync(new URL(entry.source, root), "utf8");
    return { ...entry, source, definition: JSON.parse(source) as unknown, package: manifest.package, packageName: manifest.name };
  });
}
