import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createProjectModelHost, DEFAULT_MODELS_DIRECTORY } from "../src/project/models.js";
import { bytesContent } from "../src/data/extensions/shared/payload.js";
import { JsonSchemaModelRuntimeFactory } from "../src/data/extensions/json-schema/index.js";

async function fixture(fn: (root: string, directory: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "memsphere-models-"));
  const directory = join(root, DEFAULT_MODELS_DIRECTORY);
  await mkdir(join(directory, "sales"), { recursive: true });
  try { await fn(root, directory); } finally { await rm(root, { recursive: true, force: true }); }
}
const schema = { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { quantity: { type: "number" } }, required: ["quantity"] } } }, required: ["items"] };

test("Project model definitions remain readable files and load through the metamodel into business reflection", async () => fixture(async (root, directory) => {
  const source = `  ${JSON.stringify(schema, null, 2)}\n`;
  const host = await createProjectModelHost({}, { root });
  await host.store.create({}, { id: "sales/order.json", model: host.store.model,
    payload: { contentType: "application/json", content: bytesContent(Buffer.from(source)) } });
  assert.equal(await readFile(join(directory, "sales/order.json"), "utf8"), source);
  const fresh = await createProjectModelHost({}, { root });
  assert.equal((await fresh.definition("sales/order.json")).source, source);
  assert.deepEqual((await fresh.definition("sales/order.json")).definition, schema);
  const runtime = await fresh.runtime("sales/order.json");
  assert.equal(runtime.descriptor.id, "sales/order.json");
  const value = runtime.reflect({ items: [{ quantity: 2 }] });
  assert.equal(value.kind, "object");
  if (value.kind !== "object") throw new Error("not object");
  const array = value.get(value.descriptor.field("items")!);
  assert.equal(array?.kind, "array");
  if (array?.kind !== "array") throw new Error("not array");
  const item = array.get(0);
  if (item?.kind !== "object") throw new Error("not object");
  const quantity = item.get(item.descriptor.field("quantity")!);
  if (quantity?.kind !== "scalar") throw new Error("not scalar");
  quantity.set(3);
  assert.deepEqual(value.value, { items: [{ quantity: 3 }] });
}));

test("Project model catalog traverses all pages and keeps corrupt definitions visible without hiding good models", async () => fixture(async (root, directory) => {
  await Promise.all(Array.from({ length: 1001 }, (_, index) => writeFile(join(directory, `model-${index}.json`), '{"type":"string"}')));
  await writeFile(join(directory, "bad.json"), "not-json");
  await writeFile(join(directory, "invalid.json"), '{"type":"object","required":42}');
  await writeFile(join(directory, "ignored.md"), "not a model");
  const models = await (await createProjectModelHost({}, { root })).list();
  assert.equal(models.filter(item => !item.builtin && item.status === "available").length, 1001);
  assert.equal(models.filter(item => item.builtin).length, 5);
  assert.equal(models.find(item => item.id === "bad.json")?.status, "unavailable");
  assert.equal(models.find(item => item.id === "invalid.json")?.status, "unavailable");
  assert.equal(models.some(item => item.id === "ignored.md"), false);
}));

test("Project model refresh reads changed files while each definition and source share one snapshot", async () => fixture(async (root, directory) => {
  await writeFile(join(directory, "one.json"), '{"type":"string","title":"One"}');
  const host = await createProjectModelHost({}, { root });
  const first = await host.definition("one.json");
  await writeFile(join(directory, "one.json"), '{"type":"number","title":"Two"}');
  const cached = await host.definition("one.json");
  assert.equal(cached.source, first.source);
  assert.equal(cached.title, "One");
  const fresh = await createProjectModelHost({}, { root });
  assert.equal((await fresh.definition("one.json")).title, "Two");
}));

test("Relative and absolute model directories use the Project root rather than cwd", async () => fixture(async (root) => {
  const canonicalRoot = await realpath(root);
  const relative = await createProjectModelHost({}, { root, modelsDirectory: "custom" });
  assert.equal(relative.directory, resolve(canonicalRoot, "custom"));
  const absolute = await createProjectModelHost({}, { root, modelsDirectory: resolve(root, "absolute") });
  assert.equal(absolute.directory, resolve(canonicalRoot, "absolute"));
  const fresh = await createProjectModelHost({}, { root, modelsDirectory: "new/missing" });
  assert.equal((await fresh.list()).filter(model => !model.builtin).length, 0);
}));

test("Readable advanced schemas do not claim business reflection support or silently lose keywords", async () => fixture(async (root, directory) => {
  const source = '{"anyOf":[{"type":"string"},{"type":"number"}]}';
  await writeFile(join(directory, "advanced.json"), source);
  const host = await createProjectModelHost({}, { root });
  assert.equal((await host.definition("advanced.json")).source, source);
  await assert.rejects(host.runtime("advanced.json"), /not supported/);
}));

test("Project model dependencies reuse exact existing ModelRefs without downloading remote schemas", async () => fixture(async (root, directory) => {
  await writeFile(join(directory, "value.json"), '{"type":"string"}');
  await writeFile(join(directory, "entry.json"), '{"type":"object","properties":{"value":{"$ref":"value.json"}}}');
  const host = await createProjectModelHost({}, { root });
  const runtime = await host.runtime("entry.json");
  assert.equal(runtime.reflect({ value: "ok" }).kind, "object");
  assert.throws(() => runtime.reflect({ value: 4 }));
  await writeFile(join(directory, "missing.json"), '{"$ref":"https://example.test/unknown"}');
  await assert.rejects((await createProjectModelHost({}, { root })).runtime("missing.json"), /No model binding/);
}));

test("Project model ID lookup rejects traversal and reports unknown IDs", async () => fixture(async (root) => {
  const host = await createProjectModelHost({}, { root });
  await assert.rejects(host.definition("../outside.json"));
  await assert.rejects(host.definition("unknown.json"), /not found/);
}));

test("Project model source preserves UTF-8 BOM while the existing serializer parses the definition", async () => fixture(async (root, directory) => {
  const source = '\uFEFF  {"type":"string","title":"BOM"}\r\n';
  await writeFile(join(directory, "bom.json"), source);
  const host = await createProjectModelHost({}, { root });
  const model = await host.definition("bom.json");
  assert.equal(model.source, source);
  assert.deepEqual(model.definition, { type: "string", title: "BOM" });
  assert.equal((await host.runtime("bom.json")).reflect("value").value, "value");
}));

test("Project model runtime preserves the existing compiler's relative-ID support boundary and diagnostic", async () => fixture(async (root, directory) => {
  const definition = { $id: "relative-id", type: "string" };
  await writeFile(join(directory, "relative-id.json"), JSON.stringify(definition));
  const host = await createProjectModelHost({}, { root });
  assert.deepEqual((await host.definition("relative-id.json")).definition, definition);
  const model = await host.manager.getModel({}, "relative-id.json");
  const factory = new JsonSchemaModelRuntimeFactory();
  const error = /Unsupported JSON Schema at #\/\$id: relative \$id values are not supported/;
  await assert.rejects(factory.createRuntime({}, model, { get() { return undefined; }, register() {} }), error);
  await assert.rejects(host.runtime("relative-id.json"), error);
}));

test("Project model runtime does not invent URI aliases for file-backed ModelRefs", async () => fixture(async (root, directory) => {
  await writeFile(join(directory, "entry.json"), JSON.stringify({ $id: "https://example.test/entry.json",
    type: "object", properties: { value: { $ref: "value.json" } } }));
  await writeFile(join(directory, "value.json"), JSON.stringify({ $id: "https://example.test/value.json", type: "string" }));
  const host = await createProjectModelHost({}, { root });
  const models = await host.list();
  assert.equal(models.find(model => model.id === "entry.json")?.status, "available");
  assert.equal(models.find(model => model.id === "value.json")?.status, "available");
  assert.equal((await host.runtime("value.json")).reflect("ok").value, "ok");
  await assert.rejects(host.runtime("entry.json"), /No model binding: https:\/\/example\.test\/value\.json/);
}));
