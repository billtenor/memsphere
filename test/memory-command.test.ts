import assert from "node:assert/strict";
import test from "node:test";
import type { MemoryEntity } from "../src/memory/ast.js";
import type {
  MemoryCatalog,
  MemoryDescriptor,
  MemoryListPage,
  MemoryListQuery,
  MemoryResolveQuery
} from "../src/memory/catalog.js";
import {
  memoryListCommand,
  memoryReadCommand,
  type MemoryCommandDependencies
} from "../src/commands/memory.js";
import { parseMemoryYaml } from "../src/memory/yaml.js";
import { parse } from "yaml";

class FakeCatalog implements MemoryCatalog {
  listCalls: MemoryListQuery[] = [];
  readCalls: Array<{ reference: string; query: MemoryResolveQuery }> = [];
  fail?: Error;

  constructor(readonly page: MemoryListPage, readonly entity: MemoryEntity) {}

  async list(query: MemoryListQuery = {}): Promise<MemoryListPage> {
    this.listCalls.push(query);
    if (this.fail) throw this.fail;
    return this.page;
  }

  async resolve(): Promise<MemoryDescriptor> {
    throw new Error("not used by command handler");
  }

  async read(reference: string, query: MemoryResolveQuery = {}): Promise<MemoryEntity> {
    this.readCalls.push({ reference, query });
    if (this.fail) throw this.fail;
    return this.entity;
  }
}

function fixture() {
  const entity: MemoryEntity = {
    tag: "!concept",
    names: ["Memory", "记忆"],
    defines: ["A memory."]
  };
  const page: MemoryListPage = {
    memories: [{ reference: "concepts/Memory", kind: "concepts", names: ["Memory", "记忆"], defines: ["A memory."] }],
    next_cursor: null
  };
  const catalog = new FakeCatalog(page, entity);
  let stdout = "";
  const dependencies: MemoryCommandDependencies = {
    createCatalog: async () => catalog,
    writeStdout: (value) => { stdout += value; }
  };
  return { catalog, dependencies, entity, page, stdout: () => stdout };
}

test("memory list defaults to YAML and forwards filters", async () => {
  const state = fixture();
  await memoryListCommand({ kind: "concepts", query: "记忆" }, state.dependencies);
  assert.deepEqual(parse(state.stdout()), state.page);
  assert.deepEqual(state.catalog.listCalls, [{ kind: "concepts", query: "记忆" }]);
});

test("memory list supports JSON and text", async () => {
  const json = fixture();
  await memoryListCommand({ output: "json" }, json.dependencies);
  assert.deepEqual(JSON.parse(json.stdout()), json.page);

  const text = fixture();
  await memoryListCommand({ output: "text" }, text.dependencies);
  assert.equal(text.stdout(), "concepts/Memory (记忆)\n");
});

test("memory read defaults to tagged YAML and supports JSON", async () => {
  const yaml = fixture();
  await memoryReadCommand("记忆", { kind: "concepts" }, yaml.dependencies);
  assert.deepEqual(parseMemoryYaml(yaml.stdout()), yaml.entity);
  assert.deepEqual(yaml.catalog.readCalls, [{ reference: "记忆", query: { kind: "concepts" } }]);

  const json = fixture();
  await memoryReadCommand("concepts/Memory", { output: "json" }, json.dependencies);
  assert.deepEqual(JSON.parse(json.stdout()), json.entity);
});

test("memory handlers do not write partial stdout on catalog or argument errors", async () => {
  const catalogFailure = fixture();
  catalogFailure.catalog.fail = new Error("catalog failed");
  await assert.rejects(memoryListCommand({}, catalogFailure.dependencies), /catalog failed/);
  assert.equal(catalogFailure.stdout(), "");

  const argumentFailure = fixture();
  await assert.rejects(memoryReadCommand("Memory", { output: "text" }, argumentFailure.dependencies), /unknown memory read output/);
  assert.equal(argumentFailure.stdout(), "");
  assert.deepEqual(argumentFailure.catalog.readCalls, []);
});
