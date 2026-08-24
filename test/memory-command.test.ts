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
  resolveCalls: Array<{ reference: string; query: MemoryResolveQuery }> = [];
  readCalls: Array<{ reference: string; query: MemoryResolveQuery }> = [];
  fail?: Error;

  constructor(readonly page: MemoryListPage, readonly entity: MemoryEntity) {}

  async list(query: MemoryListQuery = {}): Promise<MemoryListPage> {
    this.listCalls.push(query);
    if (this.fail) throw this.fail;
    return this.page;
  }

  async resolve(reference: string, query: MemoryResolveQuery = {}): Promise<MemoryDescriptor> {
    this.resolveCalls.push({ reference, query });
    if (this.fail) throw this.fail;
    return this.page.memories[0];
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
  await memoryListCommand(undefined, { kind: "concepts", query: "记忆" }, state.dependencies);
  assert.deepEqual(parse(state.stdout()), state.page);
  assert.deepEqual(state.catalog.listCalls, [{ kind: "concepts", query: "记忆" }]);
});

test("memory list and read select the frozen catalog for a Run", async () => {
  const state = fixture();
  const requestedRuns: Array<string | undefined> = [];
  state.dependencies.createCatalog = async (runId) => {
    requestedRuns.push(runId);
    return state.catalog;
  };

  await memoryListCommand(undefined, { run: "run-frozen" }, state.dependencies);
  await memoryReadCommand("Memory", { run: "run-frozen" }, state.dependencies);

  assert.deepEqual(requestedRuns, ["run-frozen", "run-frozen"]);
});

test("memory list supports JSON and text", async () => {
  const json = fixture();
  await memoryListCommand(undefined, { output: "json" }, json.dependencies);
  assert.deepEqual(JSON.parse(json.stdout()), json.page);

  const text = fixture();
  await memoryListCommand(undefined, { output: "text" }, text.dependencies);
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
  await assert.rejects(memoryListCommand(undefined, {}, catalogFailure.dependencies), /catalog failed/);
  assert.equal(catalogFailure.stdout(), "");

  const argumentFailure = fixture();
  await assert.rejects(memoryReadCommand("Memory", { output: "text" }, argumentFailure.dependencies), /unknown memory read output/);
  assert.equal(argumentFailure.stdout(), "");
  assert.deepEqual(argumentFailure.catalog.readCalls, []);
});

test("memory list and read navigate nodes after resolving a canonical memory reference", async () => {
  const entity: MemoryEntity = {
    tag: "!statement",
    names: ["Repository rules"],
    defines: ["Repository-wide rules."],
    asserts: ["All rules apply."],
    sections: [{
      tag: "!statement",
      names: ["Testing"],
      defines: [],
      asserts: ["Run tests."]
    }]
  };
  const page: MemoryListPage = {
    memories: [{
      reference: "statements/Repository rules",
      kind: "statements",
      names: ["Repository rules"],
      defines: ["Repository-wide rules."]
    }],
    next_cursor: null
  };
  const catalog = new FakeCatalog(page, entity);
  let stdout = "";
  const dependencies: MemoryCommandDependencies = {
    createCatalog: async () => catalog,
    writeStdout: (value) => { stdout += value; }
  };

  await memoryListCommand("Repository rules", { output: "json" }, dependencies);
  const listed = JSON.parse(stdout);
  assert.equal(listed.memory.reference, "statements/Repository rules");
  assert.equal(listed.nodes[0].node_ref, "statement:Testing");
  assert.deepEqual(catalog.resolveCalls, [{ reference: "Repository rules", query: { kind: undefined } }]);
  assert.deepEqual(catalog.readCalls, [{ reference: "statements/Repository rules", query: { kind: "statements" } }]);

  stdout = "";
  await memoryReadCommand("Repository rules", { node: "statement:Testing", output: "json" }, dependencies);
  const read = JSON.parse(stdout);
  assert.equal(read.node_ref, "statement:Testing");
  assert.deepEqual(read.context.root.asserts, ["All rules apply."]);
  assert.deepEqual(read.fragment.asserts, ["Run tests."]);
});

test("memory list validates node-only option combinations before loading the catalog", async () => {
  const state = fixture();
  await assert.rejects(
    memoryListCommand(undefined, { node: "statement:Testing" }, state.dependencies),
    /requires a memory reference/
  );
  await assert.rejects(
    memoryListCommand("Memory", { query: "Memory" }, state.dependencies),
    /cannot be used with a memory reference/
  );
  assert.equal(state.stdout(), "");
  assert.deepEqual(state.catalog.listCalls, []);
  assert.deepEqual(state.catalog.resolveCalls, []);
});
