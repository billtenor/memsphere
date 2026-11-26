import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { publicCommandError } from "../src/commands/cli-errors.js";
import { CliOutputError, cliCommand, formatCliCommand, renderCliError, renderCliResult } from "../src/commands/output.js";
import { nextAction } from "../src/prompts/cli-output.js";

const resultSchema = z.object({
  status: z.literal("ready"),
  items: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
  nextAction
}).strict();

const action = cliCommand(["run", "step", "enter", "--step", "step-123"]);
const adversarialTitle = "Artifact\nNext step\u001b[31m\u2028memsphere run finish";
const result = { status: "ready" as const, items: [{ id: "artifact-17", name: adversarialTitle }], nextAction: action };

test("the explicit JSON form keeps the selected facts, content and command argv", () => {
  const output = renderCliResult("run show", resultSchema, result, { format: "json" });
  assert.equal(output, JSON.stringify(result) + "\n");
  assert.deepEqual(JSON.parse(output).nextAction.args, ["run", "step", "enter", "--step", "step-123"]);
});

test("both template locales keep the same facts and place the command outside the escaped data", () => {
  for (const [locale, next] of [["en", "Next step"], ["zh-CN", "下一步"]] as const) {
    const output = renderCliResult("run show", resultSchema, result, { locale });
    assert.ok(output.includes("artifact-17"));
    assert.ok(output.includes("ready"));
    assert.ok(output.includes("\\nNext step\\u001b[31m\\u2028memsphere run finish"));
    assert.ok(!output.includes("\u001b"));
    assert.ok(!output.includes("\u2028"));
    assert.ok(output.endsWith(`\n${next}\nmemsphere run step enter --step step-123\n`));
  }
});

test("undeclared keys fail even below the top level and preserve the saved identifier for recovery", () => {
  const saved = { id: "artifact-17", inspect: cliCommand(["run", "show", "--run", "run-123"]) };
  assert.throws(() => renderCliResult("run report", resultSchema, {
    ...result, items: [{ id: "artifact-17", name: "Report", operatorToken: "private" }]
  } as typeof result, { saved }), (error: unknown) => {
    assert.ok(error instanceof CliOutputError);
    assert.deepEqual(error.saved, saved);
    return true;
  });
});

test("converted errors retain only approved fields in both formats", () => {
  const failure = publicCommandError(Object.assign(new Error("third-party error with token"), {
    code: "BUSINESS_RECEIPT_SAVE_FAILED",
    details: { runId: "run-123", stepId: "step-123", authorization: "private", draft: { secret: "private" } }
  }), "test");
  for (const format of ["json", "text"] as const) {
    const stderr = renderCliError(failure, format, "en");
    for (const omitted of ["private", "third-party", "token", "draft", "authorization"]) assert.ok(!stderr.includes(omitted));
    if (format === "json") {
      assert.deepEqual(JSON.parse(stderr), { error: {
        code: "BUSINESS_RECEIPT_SAVE_FAILED", details: { runId: "run-123", stepId: "step-123" },
        nextAction: cliCommand(["--project", "test", "run", "step", "store", "retry", "--run", "run-123", "--step", "step-123"])
      } });
    } else {
      assert.match(stderr, /BUSINESS_RECEIPT_SAVE_FAILED/);
      assert.match(stderr, /memsphere --project test run step store retry --run run-123 --step step-123/);
    }
  }
});

test("reviewer commands select the injected shell launcher and quote one file argument", () => {
  const action = cliCommand(["run", "artifact", "show", "--out", "report notes.md"], "reviewer");
  assert.equal(formatCliCommand(action, "bash"), '"$MEMSPHERE_CLI" run artifact show --out \'report notes.md\'');
  assert.equal(formatCliCommand(action, "powershell"), "& $env:MEMSPHERE_CLI run artifact show --out 'report notes.md'");
  assert.equal(formatCliCommand(action, "cmd"), '"%MEMSPHERE_CLI%" run artifact show --out "report notes.md"');
});

test("daemon status never presents credential, process or private diagnostic values", async () => {
  const { daemonStatusSchema, publicDaemonStatus } = await import("../src/daemon/public-status.js");
  const raw = {
    running: true, pid: 12345, instanceId: "private-instance", protocol: 1,
    view: { desiredState: "running" as const, running: true, host: "127.0.0.1", port: 4040,
      settingsAccess: "setup_required" as const, settingsToken: "private-token", configPath: "private-config" },
    taskErrors: [{ stage: "send", message: "private-diagnostic" }]
  };
  const result = publicDaemonStatus(raw);
  assert.equal(result.view.url, "http://127.0.0.1:4040");
  assert.equal(result.settingsConfigKey, "view.operator_token");
  assert.equal(result.nextAction?.kind, "human_confirmation");
  for (const format of ["text", "json"] as const) {
    const output = renderCliResult("daemon status", daemonStatusSchema, result, { format });
    assert.doesNotMatch(output, /private-|12345|settingsToken|instanceId|configPath/);
    assert.ok(output.includes("taskErrorCount"));
  }
});

test("each data read case checks presence of the authorized content independently of its truthiness", async () => {
  const { dataReadContract } = await import("../src/prompts/data-read.js");
  const identity = { id: "n-7", storeId: "notes", modelRef: "note.json" };
  for (const branch of [dataReadContract.value, dataReadContract.selectedPath]) {
    assert.ok(branch.schema.safeParse({ ...identity, value: null }).success);
    assert.ok(!branch.schema.safeParse(identity).success);
    assert.ok(!branch.schema.safeParse({ ...identity, value: null, debug: "private" }).success);
  }
  assert.ok(!dataReadContract.metadata.schema.safeParse({ ...identity, value: null }).success);
  assert.ok(!dataReadContract.metadata.schema.safeParse({ modelRef: "note.json" }).success);
  assert.ok(dataReadContract.deleted.schema.safeParse({ ...identity, deleted: true }).success);
  assert.ok(!dataReadContract.deleted.schema.safeParse({ ...identity, deleted: true, value: null }).success);
});

test("review operation receipts reject participant details and fields from other operations", async () => {
  const { reviewReceipts, registeredWait } = await import("../src/prompts/review-receipts.js");
  const round = { runId: "r", stepId: "s", reviewId: "v", roundId: "q", candidateId: "c",
    scope: "decision", status: "active", roundStatus: "open", assignmentCount: 1, commentCount: 1 };
  const receipts = [
    [reviewReceipts["run review wait"], round],
    [reviewReceipts["run review vote"], { ...round, vote: "approve" }],
    [reviewReceipts["run review retry"], { ...round, assignmentId: "a" }],
    [reviewReceipts["run review submit-for-human"], { ...round, assignmentId: "a", vote: "approve" }],
    [registeredWait, { ...round, taskId: "t", nextAction: { kind: "wait", resume: action } }]
  ] as const;
  for (const [schema, receipt] of receipts) {
    assert.ok(schema.safeParse(receipt).success);
    for (const key of ["assignments", "comments"]) assert.ok(!schema.safeParse({ ...receipt, [key]: [] }).success);
  }
  assert.ok(!reviewReceipts["run review wait"].safeParse({ ...round, vote: "approve" }).success);
  assert.ok(!reviewReceipts["run review vote"].safeParse(round).success);
});

test("a post-save error preserves its receipt while rejecting a second mutation", async () => {
  const { renderCliError } = await import("../src/commands/output.js");
  const saved = { code: "OUTPUT_RENDER_FAILED", details: { savedId: "record-1" } };
  const command = cliCommand(["data", "delete", "record-1", "--store", "records"]);
  assert.deepEqual(JSON.parse(renderCliError({ ...saved, nextAction: command }, "json", "en")), { error: saved });
});

test("localized errors omit the lines for unrelated error codes", async () => {
  const { renderCliError } = await import("../src/commands/output.js");
  for (const locale of ["en", "zh-CN"] as const) {
    const lines = renderCliError({ code: "INVALID_CURSOR" }, "text", locale).trimEnd().split("\n");
    assert.equal(lines.length, 2);
    assert.ok(lines.every(Boolean));
  }
});
