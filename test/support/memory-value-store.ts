import { randomUUID } from "node:crypto";
import type { ValueStore, StoredValue } from "../../src/data/api/value-store.js";
import type { Context } from "../../src/data/api/context.js";
import type { UpdateOptions, DeleteOptions, ListOptions } from "../../src/data/api/store.js";
import { paginate } from "../../src/data/extensions/shared/filesystem.js";

type State = { scope: string; rows: Map<string, StoredValue>; revisions: Map<string, number> };
const failure = (code: string, id: string) => Object.assign(new Error(`${code}: ${id}`), { code });

/** Independent handles share records, never method overrides. No filesystem or native locks. */
export class MemoryValueStore implements ValueStore {
  readonly kind = "ValueStore" as const;
  constructor(readonly id: string, readonly model: string,
    private readonly validate: (value: unknown) => void = () => {},
    private readonly now: () => number = () => 0,
    private readonly state: State = { scope: randomUUID(), rows: new Map(), revisions: new Map() }) {}
  fork() { return new MemoryValueStore(this.id, this.model, this.validate, this.now, this.state); }
  async get(context: Context, id: string) { context.signal?.throwIfAborted(); const row = this.state.rows.get(id); return row && structuredClone(row); }
  async has(context: Context, id: string) { context.signal?.throwIfAborted(); return this.state.rows.has(id); }
  async list(context: Context, options?: ListOptions) {
    context.signal?.throwIfAborted();
    return paginate([...this.state.rows.keys()].sort(), options, JSON.stringify([this.state.scope, this.id, this.model]));
  }
  private checkRevision(id: string, options?: UpdateOptions) {
    const expected = options?.expectedRevision;
    if (expected !== undefined && (typeof expected !== "string" || !/^[1-9][0-9]*$/.test(expected) || !Number.isSafeInteger(Number(expected)))) throw new RangeError("expectedRevision must be a revision string");
    if (expected !== undefined && this.state.rows.get(id)?.revision !== expected) throw failure("REVISION_CONFLICT", id);
  }
  private save(context: Context, id: string, value: unknown) {
    context.signal?.throwIfAborted(); this.validate(value);
    const snapshot = structuredClone(value), previous = this.state.rows.get(id);
    const revision = (this.state.revisions.get(id) ?? 0) + 1;
    if (!Number.isSafeInteger(revision)) throw new RangeError("revision overflow");
    const now = this.now();
    const row = { id, value: snapshot, revision: String(revision), createdAt: previous?.createdAt ?? now, updatedAt: now };
    this.state.rows.set(id, row); this.state.revisions.set(id, revision);
    return structuredClone(row);
  }
  async create(context: Context, id: string, value: unknown) {
    context.signal?.throwIfAborted();
    if (this.state.rows.has(id)) throw failure("ALREADY_EXISTS", id);
    return this.save(context, id, value);
  }
  async update(context: Context, id: string, value: unknown, options?: UpdateOptions) {
    context.signal?.throwIfAborted(); this.checkRevision(id, options);
    if (!this.state.rows.has(id)) throw failure("NOT_FOUND", id);
    return this.save(context, id, value);
  }
  async upsert(context: Context, id: string, value: unknown) { return this.save(context, id, value); }
  async delete(context: Context, id: string, options?: DeleteOptions) {
    context.signal?.throwIfAborted(); this.checkRevision(id, options);
    return this.state.rows.delete(id);
  }
}
