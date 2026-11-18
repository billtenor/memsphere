import assert from "node:assert/strict";
import test from "node:test";
import { Config } from "../src/data/api/config.js";
import { parseTosConfig, parseTosConnectionConfig } from "../src/data/extensions/tos-datastore/config.js";
const base = { region: "cn-beijing", endpoint: "tos-cn-beijing.volces.com", bucket: "test-bucket", prefix: "values/", credentials: { source: "settings", id: "test" } };
test("TOS timeout fields are optional positive milliseconds for both Factory configurations", () => {
  assert.equal(parseTosConnectionConfig(new Config(base)).dataTimeoutMs, undefined);
  assert.equal(parseTosConfig(new Config({ ...base, mode: 'raw' })).controlTimeoutMs, undefined);
  for (const dataTimeoutMs of [1, 120000, 180000, 2147483647]) {
    const config = { ...base, dataTimeoutMs, controlTimeoutMs: dataTimeoutMs };
    assert.equal(parseTosConnectionConfig(new Config(config)).dataTimeoutMs, dataTimeoutMs);
    assert.equal(parseTosConfig(new Config({ ...config, mode: 'revision' })).controlTimeoutMs, dataTimeoutMs);
  }
});
test("TOS timeout validation rejects coercion, unbounded settings and timer overflow", () => {
  for (const value of [0, -1, 1.5, '120000', null, NaN, Infinity, 2147483648]) for (const field of ['dataTimeoutMs', 'controlTimeoutMs']) {
    assert.throws(() => parseTosConnectionConfig(new Config({ ...base, [field]: value })));
    assert.throws(() => parseTosConfig(new Config({ ...base, mode: 'raw', [field]: value })));
  }
  assert.throws(() => parseTosConnectionConfig(new Config({ ...base, mode: 'revision' })));
  assert.throws(() => parseTosConfig(new Config(base)));
});
