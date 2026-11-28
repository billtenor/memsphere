import assert from "node:assert/strict";
import test from "node:test";
import { Command } from "commander";
import { ZodError } from "zod";
import { bindCliOutputs, cliCommand, CliOutputError, flushCliOutput, registerResultAction, withCliOutput } from "../src/commands/output.js";
import { commandCases } from "../src/prompts/contracts/dispatch.js";
import { createPromptRenderer } from "../src/prompts/renderer.js";

for (const stage of ["input", "projection", "template", "delivery", "success"] as const) {
  test(`one saved operation across ${stage} receipt processing`, async t => {
    const program = new Command("memsphere");
    const saved = { id: "note.json", inspect: cliCommand(["model", "list"]) };
    let mutations = 0, writes = 0, callbacks = 0;
    const registration = { modelRef: saved.id, name: "Note" };
    const model = commandCases("native", "model create")![0];
    const faultySelector = stage === "projection"
      ? t.mock.method(model.policy.nested!.registration, "select", () => ({ ...registration, internal: true }))
      : undefined;
    const renderer = createPromptRenderer({
      read() { if (stage === "template") throw new Error("missing result template"); return "{{command}}"; },
      partials() { return []; }
    });
    bindCliOutputs(program);
    registerResultAction(program.command("model").command("create"), () => {
      mutations++;
      return { saved, facts: () => ({ operation: "model.create", modelRef: saved.id, registration, ...(stage === "input" && { internal: true }) }),
        afterDelivery: async () => { callbacks++; } };
    });
    const execute = () => withCliOutput("text", async () => {
      await program.parseAsync(["model", "create"], { from: "user" });
      await flushCliOutput();
      await flushCliOutput();
    }, {
      locale: "en", render: renderer.renderPrompt,
      write: async output => {
        writes++;
        assert.equal(output, "model create\n");
        if (stage === "delivery") throw new Error("closed stream");
      }
    });
    if (stage === "success") await execute();
    else await assert.rejects(execute, error => {
      assert.ok(error instanceof CliOutputError);
      assert.equal(error.saved, saved);
      if (faultySelector) {
        assert.equal(faultySelector.mock.callCount(), 1);
        assert.ok(error.cause instanceof ZodError);
        assert.ok(error.cause.issues.some(issue => issue.code === "unrecognized_keys"
          && issue.path.join(".") === "registration" && issue.keys.includes("internal")));
      }
      return true;
    });
    assert.equal(mutations, 1);
    assert.equal(writes, stage === "delivery" || stage === "success" ? 1 : 0);
    assert.equal(callbacks, stage === "success" ? 1 : 0);
  });
}
