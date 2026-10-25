import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readReservedModelCatalog } from "../dist/reserved/models.js";

const catalog = readReservedModelCatalog();
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
for (const path of ["reserved-models", "scripts/relocate-example-models.mjs"]) {
  assert.ok(manifest.files.includes(path), `Missing npm files entry: ${path}`);
}
await readFile(new URL("./relocate-example-models.mjs", import.meta.url));
await readFile(new URL("../dist/project/example-relocation.js", import.meta.url));
await readFile(new URL("../dist/project/example-relocation-baseline.js", import.meta.url));
console.log(`Reserved models validated: ${catalog.systemModels.length} system models, ${catalog.marketPackages.length} market packages.`);

const { readContextControlModels } = await import("../dist/context_control/model-assets.js");
const { JsonSchemaModelRuntimeFactory, JSON_SCHEMA_DRAFT_07 } = await import("../dist/data/extensions/json-schema/index.js");
const { bytesContent } = await import("../dist/data/extensions/shared/payload.js");
for (const asset of readContextControlModels()) {
  await new JsonSchemaModelRuntimeFactory().createRuntime({}, { data: { id: asset.id, model: JSON_SCHEMA_DRAFT_07, payload: { contentType: "application/json", content: bytesContent(Buffer.from(asset.source)) } }, definition: asset.definition }, { get: () => undefined, register() { throw new Error("unexpected runtime registration"); } });
}
console.log("Context control models validated: 5 project model assets.");

for (const model of catalog.homeModels) {
  const runtime = await new JsonSchemaModelRuntimeFactory().createRuntime({}, { data: { id: model.id, model: model.metaModel, payload: { contentType: "application/json", content: bytesContent(Buffer.from(model.source)) } }, definition: model.definition }, { get() {}, register() { throw Error("unexpected registration"); } });
  for (const sample of model.definition.examples ?? []) runtime.reflect(sample);
}
console.log(`Home models validated: ${catalog.homeModels.length}.`);
