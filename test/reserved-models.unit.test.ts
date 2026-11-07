import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readReservedModelCatalog } from "../src/reserved/models.js";


test("Reserved model assets use canonical identities and retain eight examples with a self-contained recursive model", () => {
  const catalog = readReservedModelCatalog();
  assert.equal(catalog.systemModels.length, 5);
  assert.deepEqual(catalog.marketPackages.map(pack => [pack.id, pack.models.length]), [["memsphere.examples", 8]]);
  const registration = catalog.systemModels.find(model => model.registration.modelRef === "memsphere/model-registration.json")!;
  assert.equal(registration.metaModel, "json-schema/draft-07.json");
  assert.equal(registration.registration.store_id, "models/system/json-schema/draft-07");
  for (const model of catalog.systemModels.filter(model => model !== registration)) {
    assert.equal(model.metaModel, "raw.json");
    assert.equal(model.registration.storage, "store");
    assert.equal(model.registration.store_id, "models/system/raw");
    assert.deepEqual(model.definition, {});
    assert.equal(model.registration.modelRef.endsWith(".json"), true);
  }
  const [examples] = catalog.marketPackages;
  assert.equal(examples!.models[1]!.registration.modelRef, "examples/02-nested-order.json");
  assert.equal(examples!.models.some(model => model.registration.modelRef === "memsphere/examples/order.json"), false);
  for (const model of examples!.models) {
    assert.ok(model.registration.tags!.includes("example"));
    const approved = readFileSync(new URL(`../changes/archive/completed/20261001-project-models/assets/use-case-models/${model.registration.modelRef.split("/").at(-1)}`, import.meta.url));
    if (model.registration.modelRef === "examples/06-references-and-recursion.json") {
      const current = model.definition as { properties: { externalStatus: unknown }; required: string[] };
      const historical = JSON.parse(approved.toString());
      const scalar = examples!.models.find(entry => entry.registration.modelRef === "examples/07-scalar-enum-root.json")!.definition as { type: string; enum: string[] };
      assert.deepEqual(current.properties.externalStatus, { type: scalar.type, enum: scalar.enum, description: "订单状态；枚举约束直接保存在本模型中。" });
      assert.deepEqual(current.required, historical.required);
      assert.equal(historical.properties.externalStatus.$ref, "examples/07-scalar-enum-root.json", "frozen historical evidence is preserved");
    } else assert.deepEqual(Buffer.from(model.source), approved);
  }
});
