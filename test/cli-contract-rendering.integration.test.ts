import { z } from "zod";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCliProgram } from "../src/cli-program.js";
import { formatCliCommand, renderCliResult } from "../src/commands/output.js";
import { createReviewerContinueRouter } from "../src/commands/review-nodes.js";
import { cliCommandSchema } from "../src/prompts/cli-output.js";
import { withActionScope } from "../src/prompts/contracts/actions.js";
import { cliProtocol, commandCases, selectReceipt, type CliRole, type ReceiptContext } from "../src/prompts/contracts/dispatch.js";

type Example = { expected?: Record<string, unknown>; omitted?: string[]; value: Record<string, unknown>; options?: Record<string, unknown>; context?: ReceiptContext };
type Row = { id: string } & (Example | { like: string });

function assertFacts(text: string, value: unknown, id: string) {
  const command = cliCommandSchema.safeParse(value);
  if (command.success) {
    assert.ok(text.includes(formatCliCommand(command.data)) || text.includes(JSON.stringify(command.data)), id);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) assertFacts(text, item, id);
  } else {
    assert.ok(text.includes(String(value)), id + " missing " + String(value));
  }
}

function assertLabeledFacts(text: string, value: Record<string, unknown>, id: string) {
  const lines = text.split(/\r?\n/);
  for (const [key, item] of Object.entries(value)) {
    if (key === "items" || key === "nextAction" || item === undefined) continue;
    if (key === "details" && JSON.stringify(item) === JSON.stringify(value.nextAction)) {
      assertFacts(text, item, id);
      continue;
    }
    const action = cliCommandSchema.safeParse(value.nextAction);
    if (key === "position" && action.success && action.data.args.some((arg, i) => arg === "--position" && action.data.args[i + 1] === item)) {
      assertFacts(text, item, id);
      continue;
    }
    const line = lines.find(row => row.startsWith(key + ": ") || row.startsWith(key + "："));
    assert.ok(line, id + " missing field " + key);
    const display = line.slice(key.length).replace(/^(?:: |：)/, "");
    if (item === "") assert.equal(display, '""', id + "." + key);
    else assertFacts(display, item, id + "." + key);
  }
}

test("two equal field values and an empty string retain independent labels", () => {
  const value = { draft: false, submitted: false, summary: "" };
  const text = 'draft: false\nsubmitted: false\nsummary: ""';
  assertLabeledFacts(text, value, "round");
  for (const missing of Object.keys(value)) {
    assert.throws(() => assertLabeledFacts(text.split("\n").filter(line => !line.startsWith(missing + ":")).join("\n"), value, "round"));
  }
});

test("report previews stop at 20 and the full list is scoped to an explicit native read", () => {
  const keys = Array.from({ length: 21 }, (_, i) => "external:" + i);
  const report = { role: "native" as const, route: "run report", options: {}, args: [] };
  const saved = { runId: "run", stepId: "step", artifactId: "artifact", stepStatus: "done", artifactStatus: "submitted" };
  assert.equal(selectReceipt(report, { ...saved, candidates: keys.slice(0, 20), candidateCount: 20 }).data.candidateCount, undefined);
  assert.throws(() => selectReceipt(report, { ...saved, candidates: keys, candidateCount: 21 }));
  const preview = { ...saved, candidates: keys.slice(0, 20), candidateCount: 21 };
  assert.throws(() => selectReceipt(report, preview));
  const candidateDetails = { kind: "command", launcher: "memsphere", args: ["run", "step", "show", "--step", "step", "--candidates", "--run", "run"] };
  assert.deepEqual(selectReceipt(report, { ...preview, candidateDetails }).data.candidateDetails, candidateDetails);
  assert.throws(() => selectReceipt(report, { ...preview, stepId: "another", candidateDetails }));
  const full = { runId: "run", stepId: "step", candidates: keys };
  const read = { ...report, route: "run step show" };
  assert.throws(() => selectReceipt(read, full));
  assert.deepEqual(selectReceipt({ ...read, options: { candidates: true } }, full).data, full);
  assert.throws(() => selectReceipt({ ...read, options: { candidates: true }, role: "reviewer" }, full));
});

test("reviewed examples select exactly their authorized case and preserve every displayed fact", () => {
  const program = createCliProgram();
  const reviewerProgram = createReviewerContinueRouter(program.commands.find(c => c.name() === "run")!);
  const approved = JSON.parse(readFileSync(new URL("./fixtures/cli-output-signatures.json", import.meta.url), "utf8"));
  const lines = readFileSync(new URL("./fixtures/cli-output-scenarios.jsonl", import.meta.url), "utf8").trimEnd().split("\n");
  const examples = new Map<string, Example>();
  for (const line of lines) {
    const row: Row = JSON.parse(line);
    assert.ok(!examples.has(row.id), row.id);
    const example = "like" in row ? examples.get(row.like) : row;
    assert.ok(example, row.id);
    examples.set(row.id, example);
    const [role, route, signature]: [CliRole, string, string] = approved.cases[row.id];
    const scope = { role, route, options: example.options ?? {}, args: [] };
    const reviewer = role.startsWith("reviewer");
    withActionScope({ program: reviewer ? reviewerProgram : program, reviewer, protocol: "graph" }, () => {
      const select = (value: unknown) => selectReceipt(scope, value, true, example.context);
      const { value } = example;
      let selected;
      try { selected = select(value); } catch (cause) { throw new Error(row.id, { cause }); }
      const expected = structuredClone(example.expected ?? value);
      for (const path of example.omitted ?? []) {
        const [key, member] = path.split(".");
        if (member) delete (expected[key] as Record<string, unknown>)[member];
        else delete expected[key];
      }
      assert.deepEqual(selected, { id: row.id, data: expected }, row.id);
      assert.throws(() => select({ ...value, privateState: "sentinel" }), /contract mismatch/, row.id);
      const entry = commandCases(role, route)!.find(caseEntry => caseEntry.id === row.id)!;
      for (const key of Object.keys(approved.fields[signature]).filter(k => !k.endsWith("?"))) {
        const incomplete = { ...value };
        delete incomplete[key];
        assert.equal(entry.schema.safeParse(incomplete).success, false, row.id + "." + key);
      }
      const nativeRoute = route.replace(/^continue /, role === "reviewerContinue" ? "run review " : "run ");
      if (cliProtocol(nativeRoute) !== "result" || nativeRoute === "data read" || example.options?.out === "-") return;
      assert.deepEqual(JSON.parse(renderCliResult(route, z.record(z.unknown()), selected.data, { format: "json" })), expected, row.id);
      for (const locale of ["en", "zh-CN"] as const) {
        const text = renderCliResult(route, z.record(z.unknown()), selected.data, { format: "text", locale });
        assert.ok(text.includes(route), row.id);
        assertLabeledFacts(text, expected, row.id);
        assertFacts(text, expected, row.id);
      }
    });
  }
  assert.deepEqual([...examples.keys()].sort(), Object.keys(approved.cases).sort());
});
