import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Command } from "commander";
import { createCliProgram } from "../src/cli-program.js";
import { cliOutputRouter, requestedCliOutput } from "../src/commands/cli-errors.js";
import { createReviewerContinueRouter } from "../src/commands/review-nodes.js";

const contracts = JSON.parse(readFileSync(new URL("./fixtures/cli-output-routes.json", import.meta.url), "utf8"));
type NativeAction = Command & { _actionHandler?: unknown; _hidden?: boolean };
function actions(command: NativeAction, path: string[] = []): Array<{ command: NativeAction; path: string[] }> {
  const actionsHere = command._actionHandler ? [{ command, path }] : [];
  return [...actionsHere, ...command.commands.flatMap(child => actions(child, [...path, child.name()]))];
}

test("every native action is registered with an output or an explicit protocol", () => {
  const program = createCliProgram();
  const native = actions(program);
  assert.deepEqual(native.map(({ path }) => path.join(" ")).sort(), Object.keys(contracts).sort());
  for (const { command, path } of native) {
    const key = path.join(" ");
    const protocol = contracts[key];
    if (protocol === "result" || protocol === "content") {
      assert.equal(requestedCliOutput(program, [...path, "--output=json"]), "json", key);
      assert.equal(command._hidden, false, key);
    } else if (protocol === "internal") assert.equal(command._hidden, true, key);
    else assert.equal(requestedCliOutput(program, [...path, "--output=json"]), "text", key);
  }
});

test("Runner and Reviewer Continue use the native choices and keep distinct route trees", () => {
  const program = createCliProgram();
  const root = program.commands.find(command => command.name() === "continue")!;
  const nativeRun = program.commands.find(command => command.name() === "run")!;
  const runner = cliOutputRouter(root);
  const reviewer = createReviewerContinueRouter(nativeRun);
  const choices = (router: Command) => actions(router).filter(({ command }) =>
    command.options.some(option => option.long === "--output")).map(({ path }) => path.join(" "));
  assert.ok(choices(runner).includes("review wait"));
  assert.ok(choices(runner).includes("review vote"));
  assert.deepEqual(choices(reviewer).sort(), ["comment add", "comment delete", "comment update", "list", "report", "show", "submit", "update"]);
  for (const key of choices(runner)) {
    assert.equal(requestedCliOutput(program, ["continue", ...key.split(" "), "--output=json"]), "json", key);
  }
});

test("ordinary CLI handlers route output through the schema and template boundary", async () => {
  const { readdirSync } = await import("node:fs");
  const { default: ts } = await import("typescript");
  const root = new URL("../src/", import.meta.url);
  const permitted: Record<string, string[]> = {
    "commands/output.ts": ["emitCliResult", "emitCliError"],
    "commands/continue.ts": ["registerContinueCommand"],
    "commands/memory.ts": ["<module>"],
    "commands/memory-change-show.ts": ["memoryChangeShowCommand"],
    "commands/view.ts": ["viewServeCommand", "handleRequest"],
    // Legacy template utilities are exercised directly by module tests.
    "commands/run.ts": ["printRunOutput", "printSchemaWritingOverview", "printRunBindingOutput", "printStructured"]
  };
  const files = [
    ...readdirSync(new URL("commands/", root)).filter(file => file.endsWith(".ts")).map(file => "commands/" + file),
    "cli-program.ts", "daemon/commands.ts", "acp/reviewer-commands.ts", "acp/reviewer-resources.ts"
  ];
  const found: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(new URL(file, root), "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node: import("typescript").Node, owner = "<module>"): void {
      if (ts.isFunctionDeclaration(node) && node.name) owner = node.name.text;
      if (ts.isCallExpression(node) && /^(console\.(?:log|info|warn|error)|process\.(?:stdout|stderr)\.write)$/.test(node.expression.getText(source))) {
        if (!permitted[file]?.includes(owner)) found.push(`${file} ${owner}: ${node.expression.getText(source)}`);
      }
      ts.forEachChild(node, child => visit(child, owner));
    }
    visit(source);
  }
  assert.deepEqual(found, []);
});
