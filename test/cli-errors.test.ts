import assert from "node:assert/strict";
import test from "node:test";
import { Command, Option } from "commander";
import { z } from "zod";
import { errorCode, requestedCliOutput } from "../src/commands/cli-errors.js";

function program() {
  const root = new Command().option("--project <name>");
  for (const name of ["model", "data", "project", "memory", "archive", "run"]) {
    const group = root.command(name);
    for (const action of ["list", "read", "create"]) {
      group.command(action).option("--value <json>").option("--limit <n>")
        .addOption(new Option("--output <format>").choices(["text", "json"]));
    }
  }
  return root;
}

test("JSON errors are selected even when an earlier argument stops Commander parsing", () => {
  const cli = program();
  for (const args of [
    ["memory", "list", "--bad", "--output", "json"],
    ["archive", "list", "unknown-kind", "--output=json"],
    ["project", "list", "--limit", "invalid", "--output", "json"],
    ["--project", "example", "model", "create", "--output=json"]
  ]) assert.equal(requestedCliOutput(cli, args), "json");
});

test("output-looking values and arguments after -- do not select the JSON error protocol", () => {
  const cli = program();
  for (const args of [
    ["data", "create", "--value", "--output=json"],
    ["memory", "list", "--", "--output", "json"],
    ["run", "read", "--output", "json"],
    ["memory", "read", "example", "--output", "json"]
  ]) assert.equal(requestedCliOutput(cli, args), "text");
});

test("error codes preserve domain errors and never depend on their prose", () => {
  assert.equal(errorCode(Object.assign(new Error("anything"), { code: "REVISION_CONFLICT" })), "REVISION_CONFLICT");
  assert.equal(errorCode(Object.assign(new Error("anything"), { code: "ENOENT" })), "NOT_FOUND");
  assert.equal(errorCode(new TypeError("different text")), "INVALID_ARGUMENT");
  assert.equal(errorCode(new SyntaxError("different text")), "INVALID_INPUT");
  const invalid = z.object({ directory: z.string() }).safeParse({ directory: 1 });
  assert.equal(invalid.success, false);
  if (!invalid.success) assert.equal(errorCode(invalid.error), "INVALID_ARGUMENT");
});
