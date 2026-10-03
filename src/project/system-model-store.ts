import { access, lstat } from "node:fs/promises";
import { dirname } from "node:path";
import { Config } from "../data/api/config.js";
import type { Context } from "../data/api/context.js";
import type { DataStore } from "../data/api/data-store.js";
import { FilesystemDataStoreFactory } from "../data/extensions/filesystem-datastore/index.js";
import { validateRelativeFilePath } from "../data/extensions/shared/filesystem.js";

/** Project-private adapter: preserve ModelRef while keeping JSON files readable. */
export function modelDefinitionStore(id: string, model: string, directory: string, system = false): DataStore {
  const factory = new FilesystemDataStoreFactory();
  const filename = (ref: string) => { validateRelativeFilePath(ref); return system ? `${ref}.json` : ref; };
  const open = async (context: Context, writing = false) => {
    context.signal?.throwIfAborted();
    if (system) {
      const parents: string[] = [];
      let current = directory;
      for (let index = 0; index < model.split("/").length + 2; index++) { parents.unshift(current); current = dirname(current); }
      for (const parent of parents) {
        try { if (!(await lstat(parent)).isDirectory()) throw new TypeError(`System model directory must not be a symbolic link: ${parent}`); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
    }
    if (!writing) {
      try { await access(directory); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    }
    return factory.createStore(context, id, model, new Config({ directory }));
  };
  return {
    id, model, kind: "DataStore",
    async get(context, ref) {
      const stored = await (await open(context))?.get(context, filename(ref));
      return stored && { ...stored, data: { ...stored.data, id: ref } };
    },
    async has(context, ref) { return await (await open(context))?.has(context, filename(ref)) ?? false; },
    async create(context, data) { await (await open(context, true))!.create(context, { ...data, id: filename(data.id) }); },
    async update(context, data, options) {
      const store = await open(context);
      if (!store) throw Object.assign(new Error(`Model not found: ${data.id}`), { code: "MODEL_NOT_FOUND" });
      await store.update(context, { ...data, id: filename(data.id) }, options);
    },
    async delete(context, ref, options) { return await (await open(context))?.delete(context, filename(ref), options) ?? false; },
    async list(context, options) {
      const result = await (await open(context))?.list(context, options) ?? { items: [] };
      return { ...result, items: result.items.filter(item => !system || item.id.endsWith(".json")).map(item => ({ id: system ? item.id.slice(0, -5) : item.id })) };
    }
  };
}
