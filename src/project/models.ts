import { resolve } from "node:path";
import { Config } from "../data/api/config.js";
import type { Context } from "../data/api/context.js";
import type { Data } from "../data/api/data.js";
import type { DataStore } from "../data/api/data-store.js";
import {
  filesystemDataStoreExtension, jsonSchemaExtension, jsonSchemaMetaModelExtension,
  jsonSerializerExtension, rawExtension, JSON_SCHEMA_DRAFT_07
} from "../data/extensions/index.js";
import { validateRelativeFilePath } from "../data/extensions/shared/filesystem.js";
import { bytesContent, readAll } from "../data/extensions/shared/payload.js";
import { DefaultDataManager, type ModelBinding } from "../data/management/data-manager.js";
import { DefaultDataExtensionRegistry } from "../data/management/extension-registry.js";
import { runModelBindings } from "./run-data.js";

export const DEFAULT_MODELS_DIRECTORY = "models/json-schema/draft-07";
export const MODEL_DEFINITIONS_STORE = "models/json-schema/draft-07";

export type ProjectModelSummary = {
  id: string;
  metaModel: string;
  builtin: boolean;
  title?: string;
  description?: string;
  status: "available" | "unavailable";
  error?: string;
};

const extensions = new DefaultDataExtensionRegistry([
  filesystemDataStoreExtension, jsonSerializerExtension, jsonSchemaExtension, jsonSchemaMetaModelExtension, rawExtension
]);

/** A fresh host per explicit operation; no stale directory or model cache crosses refreshes. */
export async function createProjectModelHost(context: Context, input: { root: string; modelsDirectory?: string }) {
  const directory = resolve(input.root, input.modelsDirectory ?? DEFAULT_MODELS_DIRECTORY);
  const stores = [{ id: MODEL_DEFINITIONS_STORE, model: JSON_SCHEMA_DRAFT_07, kind: "DataStore" as const,
    factory: "memsphere/filesystem", config: new Config({ directory }) }];
  const bootstrap = new DefaultDataManager({ extensions, stores });
  const store = await bootstrap.getStore(context, MODEL_DEFINITIONS_STORE) as DataStore;
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list(context, { limit: 1000, ...(cursor ? { cursor } : {}) });
    ids.push(...page.items.map(item => item.id).filter(id => id.endsWith(".json")));
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  const known = new Set(ids);
  const builtin = runModelBindings();
  const meta: ModelBinding = { model: {
    data: { id: JSON_SCHEMA_DRAFT_07, model: JSON_SCHEMA_DRAFT_07,
      payload: { contentType: "application/json", content: bytesContent(Buffer.from('{"type":"object"}')) } },
    definition: { type: "object" }
  } };
  const snapshots = new Map<string, Promise<{ data: Data; source: string }>>();
  const snapshot = (id: string) => {
    let pending = snapshots.get(id);
    if (!pending) {
      pending = (async () => {
        const stored = await store.get(context, id);
        if (!stored) throw Object.assign(new Error(`Model not found: ${id}`), { code: "MODEL_NOT_FOUND" });
        const bytes = await readAll(context, stored.data.payload.content);
        const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        return { source, data: { ...stored.data, payload: { contentType: "application/json", content: bytesContent(bytes) } } };
      })();
      snapshots.set(id, pending);
    }
    return pending;
  };
  const bindings: ModelBinding[] = [meta, ...builtin, ...ids.map(ref => ({ ref, loadData: async () => (await snapshot(ref)).data }))];
  const manager = new DefaultDataManager({ extensions, stores, models: bindings });

  function assertId(id: string) {
    validateRelativeFilePath(id);
    if (!known.has(id) && !builtin.some(binding => binding.model.data.id === id)) {
      throw Object.assign(new Error(`Model not found: ${id}`), { code: "MODEL_NOT_FOUND" });
    }
  }

  const definition = async (id: string) => {
    assertId(id);
    const model = await manager.getModel(context, id);
    const isBuiltin = !known.has(id);
    const source = isBuiltin ? JSON.stringify(model.definition, null, 2) : (await snapshot(id)).source;
    const value = model.definition as Record<string, unknown>;
    return { id, metaModel: model.data.model, builtin: isBuiltin, definition: model.definition, source,
      ...(typeof value.title === "string" ? { title: value.title } : {}),
      ...(typeof value.description === "string" ? { description: value.description } : {}) };
  };

  return {
    directory, store, manager, definition,
    async list(): Promise<ProjectModelSummary[]> {
      const result: ProjectModelSummary[] = [];
      for (const id of [...ids, ...builtin.map(binding => binding.model.data.id)].sort()) {
        try {
          const { source: _source, definition: _definition, ...summary } = await definition(id);
          result.push({ ...summary, status: "available" });
        } catch (error) {
          context.signal?.throwIfAborted();
          // Invalid content is isolated; storage I/O failures are not reclassified as corrupt models.
          if (!(error instanceof SyntaxError) && !(error instanceof TypeError)
            && !(error && typeof error === "object" && "code" in error && error.code === "MODEL_NOT_FOUND")) throw error;
          result.push({ id, metaModel: JSON_SCHEMA_DRAFT_07, builtin: false, status: "unavailable",
            error: error instanceof Error ? error.message : String(error) });
        }
      }
      return result;
    },
    async runtime(id: string) {
      assertId(id);
      const dependencies = new Map<string, string[]>();
      const visit = async (ref: string): Promise<void> => {
        if (dependencies.has(ref)) return;
        const model = await manager.getModel(context, ref);
        const refs = model.data.model === JSON_SCHEMA_DRAFT_07 ? schemaDependencies(model.definition) : [];
        dependencies.set(ref, refs);
        for (const dependency of refs) await visit(dependency);
      };
      await visit(id);
      const prepared = new DefaultDataManager({ extensions, stores,
        models: bindings.map(binding => ({ ...binding, dependencies: dependencies.get(binding.model?.data.id ?? binding.ref!) ?? [] })) });
      return prepared.getRuntime(context, id);
    }
  };
}

/** Match the existing compiler's external ModelRef semantics, without network loads or aliases. */
function schemaDependencies(definition: unknown): string[] {
  const root = definition as Record<string, unknown>;
  // Only absolute IDs establish the compiler's supported reference base.
  // Leave unsupported relative IDs to the existing compiler's explicit diagnostic.
  const base = typeof root.$id === "string" && URL.canParse(root.$id) ? new URL(root.$id) : undefined;
  if (base) base.hash = "";
  const refs = new Set<string>();
  function visit(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const schema = value as Record<string, unknown>;
    if (typeof schema.$ref === "string" && schema.$ref !== "" && !schema.$ref.startsWith("#")) {
      const target = base ? new URL(schema.$ref, base) : undefined;
      if (target) {
        target.hash = "";
        if (target.href !== base!.href) refs.add(target.href);
      } else refs.add(schema.$ref.split("#", 1)[0]!);
    }
    for (const key of ["properties", "definitions"]) {
      const children = schema[key];
      if (children && typeof children === "object" && !Array.isArray(children)) Object.values(children).forEach(visit);
    }
    visit(schema.items);
    visit(schema.additionalProperties);
  }
  visit(root);
  return [...refs];
}
