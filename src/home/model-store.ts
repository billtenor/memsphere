import { join } from "node:path";
import { stat } from "node:fs/promises";
import { resolveMemsphereHome } from "../home.js";
import { readBundledHomeModels } from "../reserved/models.js";
import { JsonSchemaModelRuntimeFactory } from "../data/extensions/json-schema/index.js";
import { FilesystemJsonValueStoreFactory } from "../data/extensions/filesystem-json-valuestore/index.js";
import { Config } from "../data/api/config.js";
import { bytesContent } from "../data/extensions/shared/payload.js";

export async function openHomeModelStore(name: string, initialize = false, home = resolveMemsphereHome()) {
  const directory = join(home, "data", name);
  if (!initialize) {
    try { await stat(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  const model = readBundledHomeModels().find(m => m.id === "memsphere/daemon-task.json");
  if (!model) throw new Error("Missing DaemonTask Home model");
  const runtime = await new JsonSchemaModelRuntimeFactory().createRuntime({}, { data: { id: model.id, model: model.metaModel, payload: { contentType: "application/json", content: bytesContent(Buffer.from(model.source)) } }, definition: model.definition }, { get() { return undefined; }, register() { throw new Error("Unexpected registration"); } });
  const factory = new FilesystemJsonValueStoreFactory();
  return initialize ? factory.createStore({}, `memsphere/${name}`, runtime, new Config({ directory })) : factory.openExisting({}, `memsphere/${name}`, runtime, new Config({ directory }));
}
