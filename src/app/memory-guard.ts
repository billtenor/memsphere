import { readAppState, type AppProject } from "./state.js";
import { AppError } from "./contracts.js";

export async function guardAppMemoryTargets(project: AppProject,
  targets: ReadonlyArray<{ path: string; operation: string; destination_path?: string }>, operationId?: string) {
  const state = await readAppState(project);
  const owners = new Map(Object.values(state.installations).flatMap(app => app.memories.map(m => [m.path, app.manifest.id] as const)));
  for (const target of targets) {
    for (const pending of Object.values(state.operations)) if (pending.id !== operationId && pending.memories.some(m => m.path === target.path || m.path === target.destination_path))
      throw new AppError("APP_INSTALL_PENDING", `Memory is reserved by an incomplete App installation: ${target.path}`);
    if (owners.has(target.path) && (target.operation === "delete" || target.destination_path && target.destination_path !== target.path))
      throw new AppError("APP_ASSET_REQUIRED", `Cannot remove an installed App asset: ${target.path}`, { app: owners.get(target.path) });
  }
}
