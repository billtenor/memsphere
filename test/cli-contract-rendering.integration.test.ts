import { cliProtocol } from "../src/prompts/contracts/dispatch.js";
import assert from "node:assert/strict";
import test from "node:test";
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
