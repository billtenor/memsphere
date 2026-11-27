import assert from "node:assert/strict";
import test from "node:test";
import { Command } from "commander";
import { bindCliOutputs, cliCommand, CliOutputError, flushCliOutput, registerResultAction, withCliOutput } from "../src/commands/output.js";
import { commandCases } from "../src/prompts/contracts/dispatch.js";
import { createPromptRenderer } from "../src/prompts/renderer.js";

for (const stage of ["input", "projection", "template", "delivery", "success"] as const) {
  test(`one saved operation across ${stage} receipt processing`, async t => {
    const program = new Command("memsphere");
    const saved = { id: "note.json", inspect: cliCommand(["model", "list"]) };
    let mutations = 0, writes = 0, callbacks = 0;
    if (stage === "projection") {
      const entry = commandCases("native", "model delete")![0];
      t.mock.method(entry, "project", () => { throw new Error("projection rejected"); });
    }
    const renderer = createPromptRenderer({
      read() { if (stage === "template") throw new Error("missing result template"); return "{{command}}"; },
      partials() { return []; }
    });
    bindCliOutputs(program);
    registerResultAction(program.command("model").command("delete"), () => {
      mutations++;
      return { saved, facts: () => ({ operation: "model.delete", modelRef: "note.json", ...(stage === "input" && { internal: true }) }),
        afterDelivery: async () => { callbacks++; } };
    });
    const execute = () => withCliOutput("text", async () => {
      await program.parseAsync(["model", "delete"], { from: "user" });
      await flushCliOutput();
      await flushCliOutput();
    }, {
      locale: "en", render: renderer.renderPrompt,
      write: async output => {
        writes++;
        assert.equal(output, "model delete\n");
        if (stage === "delivery") throw new Error("closed stream");
      }
    });
    if (stage === "success") await execute();
    else await assert.rejects(execute, error => error instanceof CliOutputError && error.saved === saved);
    assert.equal(mutations, 1);
    assert.equal(writes, stage === "delivery" || stage === "success" ? 1 : 0);
    assert.equal(callbacks, stage === "success" ? 1 : 0);
  });
}
