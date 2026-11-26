import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const permitted: Record<string, string[]> = {
  "commands/output.ts": ["standaloneResult", "emitCliError", "flushCliOutput"],
  "commands/continue.ts": ["registerContinueCommand"],
  "commands/memory.ts": ["<module>"],
  "commands/memory-change-show.ts": ["memoryChangeShowCommand"],
  "commands/view.ts": ["viewServeCommand", "handleRequest"],
  "commands/data.ts": ["writeDataRead"],
  "cli-transport.ts": ["writeCliChunk"],
  "project/data-service.ts": ["nativeExportBytes", "nativeExportContent"],
  "acp/client.ts": ["runAgentReviewAcpSession"],
  "acp/review-worker.ts": ["runArtifactReviewAgentWorker"],
  "view/view-runtime.ts": ["renderShellNavigationError"]
};

const transportUsers = new Set([
  "commands/output.ts", "commands/memory.ts", "commands/memory-change-show.ts",
  "commands/continue.ts", "commands/data.ts", "project/data-service.ts"
]);

// These adapters own the transport or preflight its size. Business handlers return facts.
const outputOwners: Record<string, string[]> = {
  flushCliOutput: ["commands/cli-errors.ts"],
  withCliOutput: ["commands/cli-errors.ts"],
  renderCommandResult: ["commands/memory.ts"],
  renderCliResult: ["commands/business-output.ts"],
  standaloneResult: ["commands/legacy-run-output.ts"]
};

function outputViolations(file: string, code: string): string[] {
  const found: string[] = [];
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const writers = new Set(["writeCliChunk"]);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    const outputModule = ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.endsWith("/output.js");
    if (outputModule && bindings && !ts.isNamedImports(bindings)) found.push(file + " output namespace import");
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      const name = (binding.propertyName ?? binding.name).text;
      if (outputModule && Object.hasOwn(outputOwners, name) && !outputOwners[name].includes(file)) found.push(file + " imports " + name);
      if ((binding.propertyName ?? binding.name).text === "writeCliChunk") writers.add(binding.name.text);
    }
  }
  function channelObject(node: import("typescript").Expression): string | undefined {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "globalThis") return node.name.text;
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "globalThis" && ts.isStringLiteral(node.argumentExpression)) return node.argumentExpression.text;
    return undefined;
  }
  function visit(node: import("typescript").Node, owner = "<module>"): void {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) owner = node.name.getText(source);
    // Check references as well as calls so aliases and bound methods are covered.
    const access = ts.isPropertyAccessExpression(node) ? node.name.text
      : ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : undefined;
    const target = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? channelObject(node.expression) : undefined;
    const rawChannel = target === "process" && (access === "stdout" || access === "stderr")
      || target === "console" && access && ["log", "info", "warn", "error", "debug", "dir", "table"].includes(access);
    const rawWriter = ts.isIdentifier(node) && writers.has(node.text) && !ts.isImportSpecifier(node.parent);
    const inheritedOutput = ts.isPropertyAssignment(node) && node.name.getText(source).replace(/["']/g, "") === "stdio"
      && (ts.isStringLiteral(node.initializer) && node.initializer.text === "inherit" ||
        ts.isArrayLiteralExpression(node.initializer) && node.initializer.elements.slice(1, 3).some(element =>
          ts.isStringLiteral(element) && element.text === "inherit" || ts.isNumericLiteral(element) && ["1", "2"].includes(element.text)));
    const transportImport = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
      ? node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.endsWith("/cli-transport.js")
      : false;
    if (transportImport && (!transportUsers.has(file) || !ts.isImportDeclaration(node)
        || !node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings))) found.push(file + " transport import");
    const rawImport = ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && ["node:console", "console", "node:process", "process", "node:tty"].includes(node.moduleSpecifier.text);
    const channelAlias = ts.isVariableDeclaration(node) && node.initializer
      && ["console", "process", "globalThis"].includes(channelObject(node.initializer) ?? "");
    const descriptorWrite = ts.isCallExpression(node) && /(?:^|\.)(?:write|writeSync|writeFile|writeFileSync)$/.test(node.expression.getText(source))
      && node.arguments.length > 0 && ["1", "2"].includes(node.arguments[0].getText(source));
    if (inheritedOutput || (rawChannel || rawWriter || rawImport || channelAlias || descriptorWrite) && !permitted[file]?.includes(owner)) found.push(file + " " + owner + ": " + node.getText(source));
    ts.forEachChild(node, child => visit(child, owner));
  }
  visit(source);
  return found;
}

test("only declared CLI transports own output channels", () => {
  const root = new URL("../src/", import.meta.url);
  const files = readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter(file => file.endsWith(".ts")).map(file => file.replaceAll("\\", "/"));
  assert.deepEqual(files.flatMap(file => outputViolations(file, readFileSync(new URL(file, root), "utf8"))), []);
});

test("the output check rejects an undeclared transport import and inherited output", () => {
  assert.ok(outputViolations("fixture.ts", 'import { writeCliChunk as output } from "./cli-transport.js";').length);
  assert.ok(outputViolations("fixture.ts", 'const options = { stdio: ["ignore", "ignore", "inherit"] };').length);
  for (const code of [
    'import { flushCliOutput as send } from "./output.js";', 'import * as output from "./output.js";',
    'globalThis.process.stdout.write("value")', 'globalThis.process.stderr.write("value")',
    'globalThis.console.log("value")', 'const output = globalThis.console', 'const runtime = globalThis.process', 'const runtime = globalThis; runtime.process.stdout.write(1)', 'globalThis["process"].stdout.write("value")', 'const output = globalThis["console"]'
  ]) assert.ok(outputViolations("fixture.ts", code).length, code);
  assert.deepEqual(outputViolations("fixture.ts", 'const options = { stdio: "pipe" };'), []);
});
