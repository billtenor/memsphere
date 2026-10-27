import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseMemoryYaml } from "../src/memory/yaml.js";
import { parseMemoryEntity } from "../src/memory/store.js";
import { graphMemorySyntax, controlPlaneMemorySyntax } from "../src/memory/syntax.js";
import { serializeMemoryYaml } from "../src/memory/serializer.js";
import { MemoryNavigation } from "../src/memory/navigation.js";
import { collectMemoryReferenceTargets } from "../src/memory/references.js";
import type { GraphProcedureMemory } from "../src/memory/ast.js";

const spec = { name: "Result", model: { definedBy: "json-schema/draft-07.json", definition: '{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"]}' }, payload: { contentType: "application/json" } };
const action = (id = "produce", from: string | string[] = "START") => ({ tag: "!action", id, description: "Produce a result", dependencies: [{ tag: "!dependency", from }], artifact: structuredClone(spec) });
function procedure(actions: unknown[] = [action()]) { return { tag: "!procedure", syntax: graphMemorySyntax, mode: "graph", names: ["test-graph"], defines: ["A production graph"], actions }; }
const parse = (value: unknown) => parseMemoryEntity("procedures", value) as GraphProcedureMemory;

test("graph definitions round-trip tagged dependencies and keep artifact model/payload mappings", () => {
  const p = parse(procedure([action(), { tag: "!action", id: "gather", description: "Collect results", dependencies: [{ tag: "!dependency", from: "produce", when: "artifacts.produce.ok = true" }], collect: ["produce"] }]));
  const yaml = serializeMemoryYaml(p);
  assert.match(yaml, /!dependency/);
  assert.doesNotMatch(yaml, /!artifact/);
  assert.deepEqual(parse(parseMemoryYaml(yaml)), p);
});

test("existing syntax rejects graph fields while new implicit and explicit flow retain old actions", () => {
  assert.throws(() => parse({ ...procedure(), syntax: controlPlaneMemorySyntax }));
  const flow = { tag: "!procedure", syntax: graphMemorySyntax, names: ["old-flow"], defines: ["Flow"], flow: [{ tag: "!action", action: "Work", artifact: { tag: "!artifact", name: "Result" } }] };
  const implicit = parseMemoryEntity("procedures", flow);
  const explicit = parseMemoryEntity("procedures", { ...flow, mode: "flow" });
  assert.deepEqual({ ...implicit, mode: "flow" }, explicit);
  assert.throws(() => parseMemoryEntity("procedures", { ...flow, actions: [action()] }));
});

for (const [name, invalid] of [
  ["mixed flow", { ...procedure(), flow: [] }],
  ["reserved START action", procedure([action("START")])],
  ["duplicate action IDs", procedure([action(), action()])],
  ["unknown dependency", procedure([action("produce", "missing")])],
  ["duplicate join source", procedure([action("produce", ["START", "START"])])],
  ["no entry signal", procedure([action("produce", "produce")])],
  ["artifact and collect", procedure([{ ...action(), collect: ["produce"] }])],
  ["nested collect", procedure([action(), { tag: "!action", id: "gather", description: "Collect", dependencies: [{ tag: "!dependency", from: "produce" }], collect: ["gather"] }])],
  ["object model definition", procedure([{ ...action(), artifact: { ...spec, model: { definedBy: "json-schema/draft-07.json", definition: { type: "object" } } } }])],
  ["payload body in a requirement", procedure([{ ...action(), artifact: { ...spec, payload: { contentType: "application/json", content: "{}" } } }])],
  ["invalid JSONata", procedure([{ ...action(), dependencies: [{ tag: "!dependency", from: "START", when: "artifacts.A &&" }] }])]
] as const) test(`graph validation rejects ${name}`, () => assert.throws(() => parse(invalid)));

test("graph node navigation exposes action, dependency, and artifact with root context", () => {
  const p = parse(procedure());
  const nav = new MemoryNavigation({ reference: "procedures/test-graph", kind: "procedures", names: p.names }, p);
  const top = nav.listChildren().items[0];
  assert.equal(top.name, "produce"); assert.equal(top.artifact, "Result");
  const children = nav.listChildren(top.node_ref).items;
  assert.deepEqual(children.map(c => c.type), ["Dependency", "Artifact"]);
  const read = nav.readNode(children[0].node_ref);
  assert.equal((read.fragment as { from: string }).from, "START");
  assert.equal((read.context.root as { mode: string }).mode, "graph");
  assert.equal("actions" in (read.context.root as object), false);
  assert.equal(read.context.ancestors.length, 1);
});

test("graph reference discovery includes Action and artifact Statement requirements", () => {
  const p = parse(procedure([{ ...action(), asserts: [{ tag: "!ref", target: "statements/process-rules" }], artifact: { ...spec, suggests: [{ tag: "!ref", target: "statements/result-rules" }] } }]));
  assert.deepEqual(collectMemoryReferenceTargets(p).sort(), ["statements/process-rules", "statements/result-rules"]);
});

for (const newline of ["\n", "\r\n"]) test(`the materials example parses with a preparation Action using ${newline === "\n" ? "LF" : "CRLF"} line endings`, async () => {
  const document = (await readFile(new URL("../docs/procedure-graph-syntax.md", import.meta.url), "utf8")).replace(/\r?\n/g, newline);
  const normalized = document.replaceAll("\r\n", "\n");
  const yaml = [...normalized.matchAll(/```yaml\n([\s\S]*?)```/g)].map(m => m[1]).find(s => s.startsWith("!procedure\n") && s.includes("mode: graph\n"))!;
  assert.ok(yaml, "published graph YAML example must be present");
  const p = parse(parseMemoryYaml(yaml));
  assert.equal(p.actions.length, 5);
  assert.equal(p.actions[0].id, "prepare");
  assert.deepEqual(p.actions[1].dependencies.map(d => d.from), ["prepare", "analyze"]);
});
