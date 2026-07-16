import type { MemoryEntity } from "./ast.js";
import type { MemoryProvider, MemoryProviderQuery, ProviderMemoryDescriptor } from "./provider.js";
import { readAllMemoryFiles } from "./store.js";

export class FileMemoryProvider implements MemoryProvider {
  readonly #memoryRoot: string;
  readonly #entities = new Map<string, MemoryEntity>();

  constructor(memoryRoot: string) {
    this.#memoryRoot = memoryRoot;
  }

  async list(query: MemoryProviderQuery = {}): Promise<ProviderMemoryDescriptor[]> {
    const files = await readAllMemoryFiles(this.#memoryRoot, query.kind);
    this.#entities.clear();

    return files.map((file) => {
      this.#entities.set(file.path, file.entity);
      return {
        id: file.path,
        kind: file.kind,
        names: [...file.entity.names],
        defines: structuredClone(file.entity.defines)
      };
    });
  }

  async read(id: string): Promise<MemoryEntity> {
    const entity = this.#entities.get(id);
    if (!entity) {
      throw new Error("memory provider id was not returned by the current list operation");
    }
    return entity;
  }
}
