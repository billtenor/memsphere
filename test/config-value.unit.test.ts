import assert from "node:assert/strict";
import test from "node:test";
import { Config } from "../src/data/api/config.js";

test("Config wraps JSON without adding defaults or changing values", () => {
  const json = {
    enabled: false,
    retries: 0,
    name: "",
    owner: null,
    nested: { tags: ["draft", "review"] }
  };
  const config = new Config(json);

  assert.strictEqual(config.json, json);
  assert.equal(config.json.enabled, false);
  assert.equal(config.json.retries, 0);
  assert.equal(config.json.name, "");
  assert.equal(config.json.owner, null);
  assert.equal(Object.hasOwn(config.json, "missing"), false);
  assert.deepEqual(config.json.nested, { tags: ["draft", "review"] });
});
