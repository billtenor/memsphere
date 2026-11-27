import assert from "node:assert/strict";
import test from "node:test";
import type { Command } from "commander";
import { createCliProgram } from "../src/cli-program.js";
import { parseCli } from "../src/commands/cli-errors.js";
import { standaloneResult, registerResultAction, commandFacts } from "../src/commands/output.js";
import { invokeCliModule } from "./helpers/cli-module.js";

const facts = { id: "one", storeId: "notes", modelRef: "note.json", exists: true };

function invoke(install: (command: Command) => void) {
  const program = createCliProgram();
  const leaf = program.commands.find(command => command.name() === "data")!.commands.find(command => command.name() === "has")!;
  install(leaf);
  return invokeCliModule(["data", "has", "one", "--store", "notes", "--output", "json"],
    process.cwd(), process.env, "memsphere", undefined, argv => parseCli(program, argv));
}

test("the registered data has leaf delivers the returned facts as one compact JSON value", async () => {
  const result = await invoke(leaf => registerResultAction(leaf, () => commandFacts(() => facts)));
  assert.deepEqual(JSON.parse(result.stdout), facts);
  assert.equal(result.stdout, JSON.stringify(JSON.parse(result.stdout)) + "\n");
  assert.equal(result.stderr, "");
});

test("a replaced handler cannot omit, duplicate, redirect or reformat the registered result", async () => {
  for (const install of [
    (leaf: Command) => leaf.action(() => {}),
    // @ts-expect-error A handler returns one result.
    (leaf: Command) => registerResultAction(leaf, () => [commandFacts(() => facts), commandFacts(() => facts)]),
    // @ts-expect-error Format belongs to the parsed entry point.
    (leaf: Command) => registerResultAction(leaf, () => ({ ...commandFacts(() => facts), format: "yaml" })),
    // @ts-expect-error A handler cannot raise its budget.
    (leaf: Command) => registerResultAction(leaf, () => ({ ...commandFacts(() => facts), maximumBytes: Infinity })),
    (leaf: Command) => leaf.action(() => { standaloneResult("data has", commandFacts(() => facts), "yaml"); }),
    (leaf: Command) => registerResultAction(leaf, () => {
      try { standaloneResult("data has", commandFacts(facts)); } catch { /* Try to mask the duplicate. */ }
      return commandFacts(facts);
    }),
    (leaf: Command) => registerResultAction(leaf, () => commandFacts(() => ({ ...facts, privateState: "private" })))
  ]) {
    await assert.rejects(invoke(install), (error: unknown) => {
      const cause = error as { code: number; stdout: string; stderr: string };
      assert.equal(cause.code, 1);
      assert.equal(cause.stdout, "");
      assert.deepEqual(JSON.parse(cause.stderr), { error: { code: "OUTPUT_RENDER_FAILED" } });
      return true;
    });
  }
});
