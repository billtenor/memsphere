import { readConfig } from "../config.js";
import { DefaultMemoryCatalog, type MemoryCatalog } from "./catalog.js";
import { FileMemoryProvider } from "./file-provider.js";

export async function createMemoryCatalog(): Promise<MemoryCatalog> {
  const config = await readConfig();
  return new DefaultMemoryCatalog(new FileMemoryProvider(config.memoryRoot));
}
