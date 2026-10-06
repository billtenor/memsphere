import { relative, resolve, sep } from "node:path";
import type { MemoryProvider, MemoryProviderQuery, ProviderMemoryDescriptor } from "../memory/provider.js";
import type { MemoryEntity } from "../memory/ast.js";
import { FileMemoryProvider } from "../memory/file-provider.js";
import { GitRevisionMemoryProvider } from "../memory/git-provider.js";
import { projectConfigSchema } from "../project/model.js";
import { projectPaths } from "../project/paths.js";
import { AppError } from "./contracts.js";
import { readJson } from "./files.js";
import { readAppState } from "./state.js";

/** A read never repairs state or writes to a Mounted source. Each returned list/read pair is frozen. */
export class AppMemoryProvider implements MemoryProvider {
  readonly #entities = new Map<string, MemoryEntity>();
  constructor(readonly projectRoot: string, readonly memoryRoot: string, readonly publishedRevision?: string) {}
  async list(query: MemoryProviderQuery = {}): Promise<ProviderMemoryDescriptor[]> {
    const project = { paths: projectPaths(this.projectRoot), memoryRoot: this.memoryRoot };
    // Revalidate the generation after materialization so a read spanning a commit retries.
    for (let attempt = 0; attempt < 5; attempt++) {
      const state = await readAppState(project);
      const store = state.revision ? projectConfigSchema.parse(await readJson(project.paths.configPath)).store
        : this.publishedRevision ? { type: "managed" as const, published_revision: this.publishedRevision } : { type: "embedded" as const };
      const pending = new Set(Object.values(state.operations).flatMap(op => op.memories.map(m => m.path)));
      const include = (path: string) => !pending.has(path);
      const provider: MemoryProvider = store.type === "managed"
        ? new GitRevisionMemoryProvider(this.memoryRoot, store.published_revision, include)
        : new FileMemoryProvider(this.memoryRoot, path => include(relative(this.memoryRoot, path).split(sep).join("/")));
      const descriptors = await provider.list(query);
      const entities = new Map<string, MemoryEntity>();
      const ownership = new Map(Object.entries(state.installations).flatMap(([id, app]) => app.memories.map(memory => [memory.path,
        { id, version: app.manifest.version, assetKey: memory.key, enabled: app.enabled, packageDigest: app.packageDigest }] as const)));
      for (const descriptor of descriptors) {
        const key = store.type === "managed" ? descriptor.id : relative(this.memoryRoot, descriptor.id).split(sep).join("/");
        const owner = ownership.get(key);
        if (owner) descriptor.app = owner;
        if (store.type === "managed") descriptor.revision = store.published_revision;
        entities.set(descriptor.id, await provider.read(descriptor.id));
      }
      const after = await readAppState(project);
      const afterStore = after.revision ? projectConfigSchema.parse(await readJson(project.paths.configPath)).store : store;
      if (state.revision !== after.revision || JSON.stringify(store) !== JSON.stringify(afterStore)) continue;
      this.#entities.clear();
      for (const [id, entity] of entities) this.#entities.set(id, entity);
      return descriptors;
    }
    throw new AppError("APP_STATE_BUSY", "App installation changed during Memory discovery; retry");
  }
  async read(id: string): Promise<MemoryEntity> {
    const entity = this.#entities.get(id);
    if (!entity) throw new AppError("APP_MEMORY_UNAVAILABLE", "Memory was not visible in this discovery snapshot");
    return entity;
  }
}
