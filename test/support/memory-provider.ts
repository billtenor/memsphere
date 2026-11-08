import type { MemoryEntity } from "../../src/memory/ast.js";
import type { MemoryProvider, MemoryProviderQuery, ProviderMemoryDescriptor } from "../../src/memory/provider.js";

export class FakeMemoryProvider implements MemoryProvider {
  readonly listCalls: MemoryProviderQuery[] = [];
  readonly readCalls: string[] = [];
  constructor(readonly descriptors: ProviderMemoryDescriptor[], readonly entities: Record<string, MemoryEntity>) {}
  async list(query: MemoryProviderQuery = {}) {
    this.listCalls.push(structuredClone(query));
    return structuredClone(this.descriptors.filter(item => !query.kind || item.kind === query.kind)).reverse();
  }
  async read(id: string) {
    this.readCalls.push(id);
    const entity = this.entities[id];
    if (!entity) throw new Error(`unknown fake id ${id}`);
    return structuredClone(entity);
  }
}
