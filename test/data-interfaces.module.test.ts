import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

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

  const fixtures = ["data-interfaces.ts", "data-reflection.ts", "data-management.ts"].map(name =>
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
