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
