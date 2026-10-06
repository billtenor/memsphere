import { dirname, relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { appProjectFromRoot } from "./composition.js";
import { readAppState } from "./state.js";
import { AppError } from "./contracts.js";

export async function appProcedureFileSource(runsRoot: string, memoryRoot: string, file: string) {
  const project = await appProjectFromRoot(dirname(runsRoot), memoryRoot);
  if (!project) return undefined;
  const path = relative(await realpath(memoryRoot), await realpath(file)).split(sep).join("/");
  const state = await readAppState(project);
  for (const pending of Object.values(state.operations)) if (pending.memories.some(m => m.path === path))
    throw new AppError("APP_INSTALL_PENDING", "Procedure belongs to an incomplete App installation");
  for (const app of Object.values(state.installations)) {
    const memory = app.memories.find(m => m.path === path);
    if (!memory) continue;
    if (!app.enabled) throw new AppError("APP_DISABLED", `App is disabled: ${app.manifest.id}`);
    return { reference: memory.reference, id: app.manifest.id, version: app.manifest.version,
      assetKey: memory.key, packageDigest: app.packageDigest };
  }
  return undefined;
}
