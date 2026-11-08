import { MemoryValueStore } from "./support/memory-value-store.js";
import { valueStoreContract } from "./support/value-store-contract.js";
valueStoreContract("memory ValueStore", async () => {
  const store = new MemoryValueStore("records", "record.json");
  return { store, reopen: async () => store.fork() };
});
