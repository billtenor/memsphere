import type { DefinitionPart, MemoryEntity } from "./ast.js";
import type { MemoryKind } from "./kinds.js";

export type ProviderMemoryDescriptor = {
  id: string;
  kind: MemoryKind;
  names: string[];
  defines: DefinitionPart[];
};

export type MemoryProviderQuery = {
  kind?: MemoryKind;
};

export interface MemoryProvider {
  list(query?: MemoryProviderQuery): Promise<ProviderMemoryDescriptor[]>;
  read(id: string): Promise<MemoryEntity>;
}
