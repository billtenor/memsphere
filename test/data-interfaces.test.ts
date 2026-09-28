import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { Config } from "../src/data/index.js";

test("data and reflection interfaces typecheck for consumers, including rejected protocol shapes", () => {
  const configPath = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(configFile.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    fileURLToPath(new URL("../", import.meta.url))
  );
  assert.deepEqual(parsed.errors, []);

  const fixtures = ["data-interfaces.ts", "data-reflection.ts"].map(name =>
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
  );
  const program = ts.createProgram(fixtures, {
    ...parsed.options,
    rootDir: undefined,
    noEmit: true
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getCanonicalFileName: file => file,
    getNewLine: () => "\n"
  }));
});

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
