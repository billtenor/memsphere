import { randomUUID } from "node:crypto";

export async function expenses(store, operation, input = {}) {
  if (store.kind !== "ValueStore") throw new Error("Expense ledger requires a ValueStore");
  if (operation === "list") {
    const page = await store.list({}, { limit: 100, ...(input.cursor ? { cursor: input.cursor } : {}) });
    return { records: await Promise.all(page.items.map(item => store.get({}, item.id))), nextCursor: page.nextCursor };
  }
  if (operation === "create") {
    if (typeof input.description !== "string" || !input.description.trim()) throw new Error("Description is required");
    if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Amount must be positive");
    return store.create({}, randomUUID(), { description: input.description.trim(), amount: input.amount, status: "draft" });
  }
  if (operation === "submit") {
    if (typeof input.id !== "string" || !Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error("ID and current revision are required");
    const record = await store.get({}, input.id);
    if (!record) throw new Error("Expense not found");
    if (record.value.status !== "draft") throw new Error("Only draft expenses can be submitted");
    return store.update({}, input.id, { ...record.value, status: "submitted" }, { expectedRevision: input.revision });
  }
  throw new Error(`Unknown operation: ${operation}`);
}
