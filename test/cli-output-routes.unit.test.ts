import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Command } from "commander";
import { cliProtocol, commandCases } from "../src/prompts/contracts/dispatch.js";
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
    assert.equal(cliProtocol(key), protocol, key);
    assert.ok(commandCases("native", key)?.length || commandCases("reviewer", key)?.length, key);
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
    "commands/output.ts": ["publishResult", "emitCliError"],
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
  const files = readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter(file => file.endsWith(".ts")).map(file => file.replaceAll("\\", "/"));
  const found: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(new URL(file, root), "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node: import("typescript").Node, owner = "<module>"): void {
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) owner = node.name.getText(source);
      // Check references as well as calls so aliases and bound methods are covered.
      const access = ts.isPropertyAccessExpression(node) ? node.name.text
        : ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : undefined;
      const target = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? node.expression.getText(source) : undefined;
      const rawChannel = target === "process" && (access === "stdout" || access === "stderr")
        || target === "console" && access && ["log", "info", "warn", "error", "debug", "dir", "table"].includes(access);
      const rawWriter = ts.isIdentifier(node) && node.text === "writeCliChunk" && !ts.isImportSpecifier(node.parent);
      const rawImport = ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
        && ["node:console", "console", "node:process", "process", "node:tty"].includes(node.moduleSpecifier.text);
      const channelAlias = ts.isVariableDeclaration(node) && node.initializer
        && ["console", "process", "globalThis.console", "globalThis.process"].includes(node.initializer.getText(source));
      const descriptorWrite = ts.isCallExpression(node) && /(?:^|\.)(?:write|writeSync|writeFile|writeFileSync)$/.test(node.expression.getText(source))
        && node.arguments.length > 0 && ["1", "2"].includes(node.arguments[0].getText(source));
      if ((rawChannel || rawWriter || rawImport || channelAlias || descriptorWrite) && !permitted[file]?.includes(owner)) found.push(file + " " + owner + ": " + node.getText(source));
      ts.forEachChild(node, child => visit(child, owner));
    }
    visit(source);
  }
  assert.deepEqual(found, []);
});

test("a record-read contract can only register its declared route", async () => {
  const { Command } = await import("commander");
  const { dataReadContract } = await import("../src/prompts/data-read.js");
  const { commandFromContract } = await import("../src/commands/output.js");
  const root = new Command("memsphere");
  assert.throws(() => commandFromContract(root.command("model"), dataReadContract), /data read/);
  const data = root.command("data");
  assert.equal(commandFromContract(data, dataReadContract).name(), "read");
});

test("every reviewed scenario preserves its public field types and visibility", async () => {
  const { commandContracts } = await import("../src/prompts/contracts/registry.js");
  const t = await import("../src/prompts/contracts/types.js");
  const { z } = await import("zod");
  const approved = JSON.parse(readFileSync(new URL("./fixtures/cli-output-signatures.json", import.meta.url), "utf8"));
  function signature(schema: import("zod").ZodTypeAny, ancestors = new Set<import("zod").ZodTypeAny>()): string {
    if (ancestors.has(schema)) return "self";
    if (schema === t.action) return "Action";
    if (schema === t.command) return "Command";
    if (schema === t.content) return "content";
    if (schema instanceof z.ZodLazy) return signature(schema.schema, new Set([...ancestors, schema]));
    if (schema instanceof z.ZodEffects) return signature(schema.innerType(), ancestors);
    if (schema instanceof z.ZodOptional) return signature(schema.unwrap(), ancestors);
    if (schema instanceof z.ZodString) return "string";
    if (schema instanceof z.ZodBoolean) return "boolean";
    if (schema instanceof z.ZodNumber) return schema.isInt ? "int" : "number";
    if (schema instanceof z.ZodNull) return "null";
    if (schema instanceof z.ZodLiteral) return JSON.stringify(schema.value);
    if (schema instanceof z.ZodEnum) return schema.options.map((v: string) => JSON.stringify(v)).sort().join("|");
    if (schema instanceof z.ZodUnion) return schema.options.map((v: import("zod").ZodTypeAny) => signature(v, ancestors)).sort().join("|");
    if (schema instanceof z.ZodArray) return "[" + signature(schema.element, ancestors) + "]"
      + (schema._def.maxLength ? "≤" + schema._def.maxLength.value : "");
    if (schema instanceof z.ZodRecord) return "map<" + signature(schema.valueSchema, ancestors) + ">";
    if (schema instanceof z.ZodObject) {
      assert.equal(schema._def.unknownKeys, "strict");
      return "{" + Object.keys(schema.shape).sort().map(k => k + (schema.shape[k].isOptional() ? "?" : "")
        + ":" + signature(schema.shape[k], ancestors)).join(",") + "}";
    }
    throw new Error("Missing contract assertion for " + schema.constructor.name);
  }
  const seen = new Set<string>();
  for (const [role, routes] of Object.entries(commandContracts)) {
    for (const [route, cases] of Object.entries(routes)) for (const entry of cases) {
      const [expectedRole, expectedRoute, id] = approved.cases[entry.id];
      assert.deepEqual([role, route], [expectedRole, expectedRoute], entry.id);
      const actual = Object.fromEntries(Object.entries(entry.fields).map(([key, field]) =>
        [key + (field.isOptional() ? "?" : ""), signature(field)]));
      assert.deepEqual(actual, approved.fields[id], entry.id);
      assert.ok(!seen.has(entry.id), entry.id);
      seen.add(entry.id);
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(approved.cases).sort());
});

test("all reviewed schemas require their declared facts and reject extra facts at publication", async () => {
  const { commandContracts } = await import("../src/prompts/contracts/registry.js");
  const t = await import("../src/prompts/contracts/types.js");
  const { renderCliResult } = await import("../src/commands/output.js");
  const { z } = await import("zod");
  function sample(type: import("zod").ZodTypeAny): unknown {
    if (type === t.command || type === t.action) return { kind: "command", launcher: "memsphere", args: ["run", "status"] };
    if (type === t.content) return { businessValue: null };
    if (type instanceof z.ZodOptional) return undefined;
    if (type instanceof z.ZodEffects) return sample(type.innerType());
    if (type instanceof z.ZodLazy) return sample(type.schema);
    if (type instanceof z.ZodObject) return Object.fromEntries(Object.entries(type.shape)
      .filter(([, field]) => !(field as import("zod").ZodTypeAny).isOptional())
      .map(([key, field]) => [key, sample(field as import("zod").ZodTypeAny)]));
    if (type instanceof z.ZodUnion) return sample(type.options[0]);
    if (type instanceof z.ZodEnum) return type.options[0];
    if (type instanceof z.ZodLiteral) return type.value;
    if (type instanceof z.ZodArray) return [];
    if (type instanceof z.ZodRecord) return {};
    if (type instanceof z.ZodBoolean) return false;
    if (type instanceof z.ZodNull) return null;
    if (type instanceof z.ZodNumber) return 0;
    if (type instanceof z.ZodString) return "public";
    throw new Error("No independent fixture for " + type.constructor.name);
  }
  for (const routes of Object.values(commandContracts)) {
    for (const [route, entries] of Object.entries(routes)) for (const entry of entries) {
      const value = sample(entry.schema) as Record<string, unknown>;
      assert.deepEqual(entry.schema.parse(value), value, entry.id);
      assert.equal(entry.schema.safeParse({ ...value, privateState: "private-sentinel" }).success, false, entry.id);
      for (const key of Object.keys(value)) {
        const incomplete = { ...value };
        delete incomplete[key];
        assert.equal(entry.schema.safeParse(incomplete).success, false, entry.id + "." + key);
      }
      if (cliProtocol(route) === "result" && route !== "data read") {
        assert.deepEqual(JSON.parse(renderCliResult(route, entry.schema, value, { format: "json" })), value, entry.id);
        for (const locale of ["en", "zh-CN"] as const) {
          assert.ok(renderCliResult(route, entry.schema, value, { format: "text", locale }).includes(route), entry.id);
        }
      }
    }
  }
});
