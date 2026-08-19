import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeMemoryDescriptors,
  DefaultMemoryCatalog,
  MemoryAmbiguityError,
  MemoryNotFoundError,
  MemoryReferenceKindError
} from "../src/memory/catalog.js";
import type { MemoryEntity } from "../src/memory/ast.js";
import type { MemoryProvider, MemoryProviderQuery, ProviderMemoryDescriptor } from "../src/memory/provider.js";

class FakeProvider implements MemoryProvider {
  listCalls: MemoryProviderQuery[] = [];
  readCalls: string[] = [];

  constructor(
    readonly descriptors: ProviderMemoryDescriptor[],
    readonly entities: Record<string, MemoryEntity>
  ) {}

  async list(query: MemoryProviderQuery = {}): Promise<ProviderMemoryDescriptor[]> {
    this.listCalls.push(query);
    const filtered = query.kind ? this.descriptors.filter((item) => item.kind === query.kind) : this.descriptors;
    return [...filtered].reverse();
  }

  async read(id: string): Promise<MemoryEntity> {
    this.readCalls.push(id);
    const entity = this.entities[id];
    if (!entity) throw new Error(`unknown fake id ${id}`);
    return entity;
  }
}

const concept = (name: string, ...aliases: string[]): MemoryEntity => ({
  tag: "!concept",
  names: [name, ...aliases],
  defines: [`${name} definition`]
});

test("catalog lists stable public descriptors without reading bodies", async () => {
  const provider = new FakeProvider(
    [
      { id: "/private/z.yaml", kind: "statements", names: ["Zed", " Z "], defines: ["Z summary"] },
      { id: "/private/a.yaml", kind: "concepts", names: [" Alpha ", "A"], defines: ["Alpha summary"] }
    ],
    {}
  );
  const catalog = new DefaultMemoryCatalog(provider);

  assert.deepEqual(await catalog.list(), {
    memories: [
      { reference: "concepts/Alpha", kind: "concepts", names: ["Alpha", "A"], defines: ["Alpha summary"] },
      { reference: "statements/Zed", kind: "statements", names: ["Zed", "Z"], defines: ["Z summary"] }
    ],
    next_cursor: null
  });
  assert.deepEqual(provider.readCalls, []);
  assert(!JSON.stringify(await catalog.list()).includes("/private/"));
});

test("catalog folds structured definitions into counts while preserving prose", async () => {
  const provider = new FakeProvider(
    [{
      id: "one",
      kind: "concepts",
      names: ["Memory"],
      defines: [
        "A managed memory.",
        { tag: "!statement", names: [], defines: [], asserts: ["Required."] },
        { tag: "!schema", names: [], defines: [], fields: ["value"] }
      ]
    }],
    {}
  );

  assert.deepEqual(await new DefaultMemoryCatalog(provider).list(), {
    memories: [{
      reference: "concepts/Memory",
      kind: "concepts",
      names: ["Memory"],
      defines: ["A managed memory."],
      structured_defines: { statement: 1, schema: 1 }
    }],
    next_cursor: null
  });
});

test("catalog filters exact normalized names and passes kind to provider", async () => {
  const provider = new FakeProvider(
    [
      { id: "one", kind: "concepts", names: ["Memory", "记忆"], defines: [] },
      { id: "two", kind: "concepts", names: ["Memory Bank", "store"], defines: [] }
    ],
    {}
  );
  const catalog = new DefaultMemoryCatalog(provider);

  assert.deepEqual((await catalog.list({ kind: "concepts", query: " 记忆 " })).memories.map((item) => item.reference), [
    "concepts/Memory"
  ]);
  assert.deepEqual((await catalog.list({ query: "Memory" })).memories.map((item) => item.reference), ["concepts/Memory"]);
  assert.deepEqual(provider.listCalls[0], { kind: "concepts" });
});

test("catalog resolve never reads and catalog read fetches only the unique candidate", async () => {
  const entity = concept("Memory", "记忆");
  const provider = new FakeProvider(
    [{ id: "opaque-1", kind: "concepts", names: entity.names, defines: entity.defines }],
    { "opaque-1": entity }
  );
  const catalog = new DefaultMemoryCatalog(provider);

  assert.equal((await catalog.resolve("记忆")).reference, "concepts/Memory");
  assert.equal((await catalog.resolve("concepts/记忆")).reference, "concepts/Memory");
  assert.deepEqual(provider.readCalls, []);
  assert.deepEqual(await catalog.read("concepts/Memory"), entity);
  assert.deepEqual(provider.readCalls, ["opaque-1"]);
});

test("catalog reports cross-kind ambiguity without reading and kind disambiguates", async () => {
  const conceptEntity = concept("Shared");
  const statementEntity: MemoryEntity = {
    tag: "!statement",
    names: ["Shared"],
    defines: [],
    asserts: ["Shared is a statement."]
  };
  const provider = new FakeProvider(
    [
      { id: "concept", kind: "concepts", names: ["Shared"], defines: conceptEntity.defines },
      { id: "statement", kind: "statements", names: ["Shared"], defines: statementEntity.defines }
    ],
    { concept: conceptEntity, statement: statementEntity }
  );
  const catalog = new DefaultMemoryCatalog(provider);

  await assert.rejects(
    catalog.read("Shared"),
    (error: unknown) => error instanceof MemoryAmbiguityError && assert.deepEqual(error.candidates, ["concepts/Shared", "statements/Shared"]) === undefined
  );
  assert.deepEqual(provider.readCalls, []);
  assert.deepEqual(await catalog.read("Shared", { kind: "concepts" }), conceptEntity);
  assert.deepEqual(provider.readCalls, ["concept"]);
});

test("catalog rejects missing memories and conflicting explicit kinds without reading", async () => {
  const provider = new FakeProvider(
    [{ id: "one", kind: "concepts", names: ["Memory", "记忆"], defines: [] }],
    { one: concept("Memory", "记忆") }
  );
  const catalog = new DefaultMemoryCatalog(provider);

  await assert.rejects(catalog.read("missing"), MemoryNotFoundError);
  await assert.rejects(catalog.read("concepts/Memory", { kind: "schemas" }), MemoryReferenceKindError);
  await assert.rejects(catalog.read("concepts/unknown"), MemoryNotFoundError);
  assert.deepEqual(provider.readCalls, []);
});

test("catalog conflict analysis is kind-scoped and preserves duplicate references", () => {
  const issues = analyzeMemoryDescriptors([
    { id: "a", kind: "concepts", names: ["Memory", "shared"], defines: [] },
    { id: "b", kind: "concepts", names: ["Other", "shared"], defines: [] },
    { id: "c", kind: "statements", names: ["Memory", "Memory"], defines: [] },
    { id: "d", kind: "concepts", names: ["Memory"], defines: [] }
  ]);

  assert(issues.some((issue) => issue.name === "shared" && issue.references.join("|") === "concepts/Memory|concepts/Other"));
  assert(issues.some((issue) => issue.name === "Memory" && issue.references.join("|") === "concepts/Memory|concepts/Memory"));
  assert(issues.some((issue) => issue.message.includes("statements/Memory repeats")));
  assert(!issues.some((issue) => issue.message.includes("conflicts within statements")));
});
