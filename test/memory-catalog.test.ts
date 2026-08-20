import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeMemoryDescriptors,
  DefaultMemoryCatalog,
  InvalidMemoryReferenceError,
  MemoryAmbiguityError,
  MemoryCatalogDataError,
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
      { id: "/private/z.yaml", kind: "statements", names: ["zed", "Z"], defines: ["Z summary"] },
      { id: "/private/a.yaml", kind: "concepts", names: ["alpha", "A"], defines: ["Alpha summary"] }
    ],
    {}
  );
  const catalog = new DefaultMemoryCatalog(provider);

  assert.deepEqual(await catalog.list(), {
    memories: [
      { reference: "concepts/alpha", kind: "concepts", names: ["alpha", "A"], defines: ["Alpha summary"] },
      { reference: "statements/zed", kind: "statements", names: ["zed", "Z"], defines: ["Z summary"] }
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
      names: ["memory"],
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
      reference: "concepts/memory",
      kind: "concepts",
      names: ["memory"],
      defines: ["A managed memory."],
      structured_defines: { statement: 1, schema: 1 }
    }],
    next_cursor: null
  });
});

test("catalog filters exact normalized names and passes kind to provider", async () => {
  const provider = new FakeProvider(
    [
      { id: "one", kind: "concepts", names: ["memory", "记忆"], defines: [] },
      { id: "two", kind: "concepts", names: ["memory-bank", "store"], defines: [] }
    ],
    {}
  );
  const catalog = new DefaultMemoryCatalog(provider);

  assert.deepEqual((await catalog.list({ kind: "concepts", query: " 记忆 " })).memories.map((item) => item.reference), [
    "concepts/memory"
  ]);
  assert.deepEqual((await catalog.list({ query: "memory" })).memories.map((item) => item.reference), ["concepts/memory"]);
  assert.deepEqual(provider.listCalls[0], { kind: "concepts" });
});

test("catalog resolve never reads and catalog read fetches only the unique candidate", async () => {
  const entity = concept("memory", "记忆");
  const provider = new FakeProvider(
    [{ id: "opaque-1", kind: "concepts", names: entity.names, defines: entity.defines }],
    { "opaque-1": entity }
  );
  const catalog = new DefaultMemoryCatalog(provider);

  assert.equal((await catalog.resolve("记忆")).reference, "concepts/memory");
  await assert.rejects(catalog.resolve("concepts/记忆"), InvalidMemoryReferenceError);
  assert.deepEqual(provider.readCalls, []);
  assert.deepEqual(await catalog.read("concepts/memory"), entity);
  assert.deepEqual(provider.readCalls, ["opaque-1"]);
});

test("catalog reports cross-kind ambiguity without reading and kind disambiguates", async () => {
  const conceptEntity = concept("shared");
  const statementEntity: MemoryEntity = {
    tag: "!statement",
    names: ["shared"],
    defines: [],
    asserts: ["Shared is a statement."]
  };
  const provider = new FakeProvider(
    [
      { id: "concept", kind: "concepts", names: ["shared"], defines: conceptEntity.defines },
      { id: "statement", kind: "statements", names: ["shared"], defines: statementEntity.defines }
    ],
    { concept: conceptEntity, statement: statementEntity }
  );
  const catalog = new DefaultMemoryCatalog(provider);

  await assert.rejects(
    catalog.read("shared"),
    (error: unknown) => error instanceof MemoryAmbiguityError && assert.deepEqual(error.candidates, ["concepts/shared", "statements/shared"]) === undefined
  );
  assert.deepEqual(provider.readCalls, []);
  assert.deepEqual(await catalog.read("shared", { kind: "concepts" }), conceptEntity);
  assert.deepEqual(provider.readCalls, ["concept"]);
});

test("catalog rejects missing memories and conflicting explicit kinds without reading", async () => {
  const provider = new FakeProvider(
    [{ id: "one", kind: "concepts", names: ["memory", "记忆"], defines: [] }],
    { one: concept("memory", "记忆") }
  );
  const catalog = new DefaultMemoryCatalog(provider);

  await assert.rejects(catalog.read("missing"), MemoryNotFoundError);
  await assert.rejects(catalog.read("concepts/memory", { kind: "schemas" }), MemoryReferenceKindError);
  await assert.rejects(catalog.read("concepts/记忆"), InvalidMemoryReferenceError);
  await assert.rejects(catalog.read(" concepts/memory "), InvalidMemoryReferenceError);
  await assert.rejects(catalog.read("concepts/unknown"), MemoryNotFoundError);
  assert.deepEqual(provider.readCalls, []);
});

test("catalog conflict analysis is kind-scoped and preserves duplicate references", () => {
  const issues = analyzeMemoryDescriptors([
    { id: "a", kind: "concepts", names: ["memory", "shared"], defines: [] },
    { id: "b", kind: "concepts", names: ["other", "shared"], defines: [] },
    { id: "c", kind: "statements", names: ["memory", "memory"], defines: [] },
    { id: "d", kind: "concepts", names: ["memory"], defines: [] }
  ]);

  assert(issues.some((issue) => issue.name === "shared" && issue.references.join("|") === "concepts/memory|concepts/other"));
  assert(issues.some((issue) => issue.name === "memory" && issue.references.join("|") === "concepts/memory|concepts/memory"));
  assert(issues.some((issue) => issue.message.includes("statements/memory repeats")));
  assert(!issues.some((issue) => issue.message.includes("conflicts within statements")));
});

test("catalog rejects invalid canonical names and aliases from providers", async () => {
  const invalidCanonical = new DefaultMemoryCatalog(new FakeProvider(
    [{ id: "one", kind: "concepts", names: ["Memory Name"], defines: [] }],
    {}
  ));
  await assert.rejects(invalidCanonical.list(), MemoryCatalogDataError);

  const invalidAlias = new DefaultMemoryCatalog(new FakeProvider(
    [{ id: "one", kind: "concepts", names: ["memory", " schemas/memory"], defines: [] }],
    {}
  ));
  await assert.rejects(invalidAlias.list(), MemoryCatalogDataError);
});
