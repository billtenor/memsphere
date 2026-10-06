import { relative, sep } from "node:path";
import { z } from "zod";
import { FileMemoryProvider } from "../memory/file-provider.js";
import { readAppState, type AppProject } from "./state.js";
import { AppError } from "./contracts.js";

export const appOwnershipSchema = z.record(z.object({
  id: z.string(), version: z.string(), assetKey: z.string(), enabled: z.boolean(), packageDigest: z.string()
}).strict());
export type AppOwnership = z.infer<typeof appOwnershipSchema>;

export async function captureAppOwnership(project: AppProject, operationId?: string): Promise<AppOwnership | undefined> {
  const state = await readAppState(project);
  if (Object.values(state.operations).some(operation => operation.id !== operationId))
    throw new AppError("APP_INSTALL_PENDING", "Finish the pending App installation before capturing a Memory checkpoint");
  const owners = Object.fromEntries(Object.values(state.installations).flatMap(app => app.memories.map(memory => [memory.path,
    { id: app.manifest.id, version: app.manifest.version, assetKey: memory.key, enabled: app.enabled, packageDigest: app.packageDigest }])));
  return Object.keys(owners).length ? owners : undefined;
}

/** Immutable ownership metadata accompanies a validated ChangeSet, never live App state. */
export class AppSnapshotMemoryProvider extends FileMemoryProvider {
  constructor(readonly root: string, readonly ownership: AppOwnership = {}) { super(root); }
  override async list(query = {}) {
    const descriptors = await super.list(query);
    for (const descriptor of descriptors) {
      const owner = this.ownership[relative(this.root, descriptor.id).split(sep).join("/")];
      if (owner) descriptor.app = owner;
    }
    return descriptors;
  }
}
