import type { ValueStore, StoredValue } from "../data/api/value-store.js";
import type { Entity } from "./model-assets.js";
import { failure } from "./errors.js";

export class Records {
  constructor(readonly stores: Record<Entity, ValueStore>) {}
  key(entity: Entity, runId: string, id: string) { return entity === "run" ? id : `${runId}/${id}`; }
  async get<T extends { id: string }>(entity: Entity, runId: string, id: string): Promise<(StoredValue & { value: T }) | undefined> {
    const row = await this.stores[entity].get({}, this.key(entity, runId, id));
    if (row && (!row.value || (row.value as T).id !== id)) throw failure("INVALID_STATE", `Stored ${entity} identity mismatch: ${id}`);
    return row as (StoredValue & { value: T }) | undefined;
  }
  async require<T extends { id: string }>(entity: Entity, runId: string, id: string) {
    const row = await this.get<T>(entity, runId, id);
    if (!row) throw failure("NOT_FOUND", `${entity} not found: ${id}`);
    return row;
  }
  create<T extends { id: string }>(entity: Entity, runId: string, value: T) {
    return this.stores[entity].create({}, this.key(entity, runId, value.id), value);
  }
  update<T extends { id: string }>(entity: Entity, runId: string, row: StoredValue, value: T) {
    if (row.revision === undefined) throw failure("UNSUPPORTED_CAPABILITY", "Graph execution requires revision CAS");
    return this.stores[entity].update({}, this.key(entity, runId, value.id), value, { expectedRevision: row.revision });
  }
  async list<T extends { id: string; runId?: string }>(entity: Entity, runId: string): Promise<T[]> {
    const result: T[] = []; let cursor: string | undefined;
    do {
      const page = await this.stores[entity].list({}, { limit: 1000, cursor });
      for (const item of page.items) {
        if (entity !== "run" && !item.id.startsWith(`${runId}/`)) continue;
        const row = await this.stores[entity].get({}, item.id);
        if (!row) continue;
        const value = row.value as T;
        if (this.key(entity, runId, value.id) !== item.id || value.runId !== undefined && value.runId !== runId) throw failure("INVALID_STATE", `Stored ${entity} Run mismatch: ${item.id}`);
        result.push(value);
      }
      cursor = page.nextCursor;
    } while (cursor);
    return result;
  }
}
