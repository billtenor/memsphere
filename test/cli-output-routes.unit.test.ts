import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Command } from "commander";
import { cliProtocol, commandCases } from "../src/prompts/contracts/dispatch.js";
import { createCliProgram } from "../src/cli-program.js";
import { cliOutputRouter, requestedCliOutput } from "../src/commands/cli-errors.js";
import { createReviewerContinueRouter } from "../src/commands/review-nodes.js";

const inheritedAssignment = process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID;
test.beforeEach(() => { delete process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID; });
test.afterEach(() => {
  if (inheritedAssignment !== undefined) process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID = inheritedAssignment;
});

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

test("public next actions exclude the private Claude delivery reference", async () => {
  const { command } = await import("../src/prompts/contracts/types.js");
  const base = { kind: "command", launcher: "memsphere", args: ["run", "review", "wait", "--review", "review"] };
  assert.ok(command.safeParse(base).success);
  for (const tail of [["--callback", "ref"], ["--callback=ref"]]) {
    assert.equal(command.safeParse({ ...base, args: [...base.args, ...tail] }).success, false);
  }
});

test("next actions must select an executable leaf and supply its required input", async () => {
  const { Command } = await import("commander");
  const { validPublicCommand, withActionScope } = await import("../src/prompts/contracts/actions.js");
  const program = new Command();
  program.command("data").command("read <id>").requiredOption("--store <id>").action(() => {});
  const valid = (...args: string[]) => withActionScope({ program, reviewer: false },
    () => validPublicCommand({ kind: "command", launcher: "memsphere", args }));
  assert.ok(valid("data", "read", "one", "--store", "notes"));
  for (const args of [["data"], ["data", "read", "--store", "notes"], ["data", "read", "one"]]) assert.equal(valid(...args), false);
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
    if (schema instanceof z.ZodEffects) {
      assert.equal(schema._def.effect.type, "preprocess", "unreviewed public refinement");
      assert.ok(schema.innerType() instanceof z.ZodObject, "only the public object projection uses preprocessing");
      return signature(schema.innerType(), ancestors);
    }
    if (schema instanceof z.ZodOptional) return signature(schema.unwrap(), ancestors);
    if (schema instanceof z.ZodString) {
      assert.deepEqual(schema._def.checks, [], "declare the public string constraints before changing the signature");
      return "string";
    }
    if (schema instanceof z.ZodBoolean) return "boolean";
    if (schema instanceof z.ZodNumber) {
      const expected = schema.isInt ? [{ kind: "finite" }, { kind: "int" }, { kind: "min", value: 0, inclusive: true }]
        : [{ kind: "finite" }];
      assert.deepEqual(JSON.parse(JSON.stringify(schema._def.checks)), expected, "public numeric bounds");
      return schema.isInt ? "int" : "number";
    }
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

test("terminal Run receipts and Runner identity select exactly their own public state", async () => {
  const { selectReceipt } = await import("../src/prompts/contracts/dispatch.js");
  const read = (route: string, value: unknown) => selectReceipt({ route, role: "native", options: {}, args: [] }, value);
  for (const route of ["run start", "run status"]) {
    for (const status of ["done", "abandoned"]) {
      const terminal = { runId: "run-1", name: "Finished", status };
      assert.equal(read(route, terminal).id, "cli-" + route.replace(" ", "-") + "-6");
      const nextAction = { kind: "command", launcher: "memsphere", args: ["run", "report", "--run", "run-1", "--artifact", "again"] };
      assert.throws(() => read(route, { ...terminal, nextAction }), /contract mismatch/);
      assert.throws(() => read(route, { ...terminal, details: nextAction }), /contract mismatch/);
    }
  }
  assert.equal(read("runner identity", { identified: false }).id, "cli-runner-identity-2");
  assert.equal(read("runner identity", { identified: true, agentType: "codex" }).id, "cli-runner-identity-1");
  assert.throws(() => read("runner identity", { identified: true }), /contract mismatch/);
  assert.throws(() => read("runner identity", { identified: false, agentType: "codex" }), /contract mismatch/);
});


test("historical wait links can only inspect the pinned round", async () => {
  const { selectReceipt } = await import("../src/prompts/contracts/dispatch.js");
  const scope = { role: "native" as const, route: "run review wait", args: [], options: {} };
  const receipt = { runId: "r", stepId: "s", reviewId: "review", roundId: "old", candidateId: "a",
    scope: "decision", status: "passed", roundStatus: "passed", assignmentCount: 1, commentCount: 0 };
  const check = (args: string[]) => {
    const details = { kind: "command", launcher: "memsphere", args };
    return selectReceipt(scope, { ...receipt, details, nextAction: details }, true, "historical-round");
  };
  assert.equal(check(["run", "review", "show", "--review", "review", "--round", "old", "--all"]).id, "cli-run-review-wait-3");
  assert.throws(() => check(["run", "review", "show", "--review", "review", "--round", "new", "--all"]), /contract mismatch/);
  assert.throws(() => check(["run", "report", "--run", "r", "--artifact", "again"]), /contract mismatch/);
});

test("duplicate eligible contract cases fail closed", async () => {
  const { selectReceipt } = await import("../src/prompts/contracts/dispatch.js");
  const cases = commandCases("native", "runner detect")!;
  cases.push({ ...cases[0], id: "duplicate-test-case" });
  try {
    assert.throws(() => selectReceipt({ role: "native", route: "runner detect", args: [], options: {} },
      { items: [] }), /Ambiguous CLI contract/);
  } finally { cases.pop(); }
});

test("a public field cannot be introduced against the approved disclosure rule", async () => {
  const { receipt, text } = await import("../src/prompts/contracts/types.js");
  assert.throws(() => receipt("tool", "read", { rule: "Only public identity", omit: ["invocation"] },
    { id: text, invocation: text }), /Invalid public field policy/);
});
