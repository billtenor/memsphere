import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "yaml";
import { emitCommandError, emitCommandResult } from "../src/commands/cli-errors.js";

function capture(action: () => void) {
  const stdout: string[] = [], stderr: string[] = [];
  const original = { stdout: process.stdout.write, stderr: process.stderr.write, exitCode: process.exitCode };
  process.stdout.write = ((chunk: string | Uint8Array) => { stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => { stderr.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()); return true; }) as typeof process.stderr.write;
  try {
    action();
    return { stdout: stdout.join(""), stderr: stderr.join(""), exitCode: process.exitCode };
  } finally {
    process.stdout.write = original.stdout;
    process.stderr.write = original.stderr;
    process.exitCode = original.exitCode;
  }
}

const strings = ["", "true", "false", "null", "~", "001", "1e3", "2026-10-06", "a: # comment", "- item",
  "*alias", "&anchor", "!tag", "{}", "[]", "  padded  ", "line one\nline two\n", "tab\tand\u0000nul", "中文 😀"];
const nested = { strings, nested: { enabled: false, zero: 0, nil: null, empty: {}, rows: [{ name: "null", values: [] }] } };
const values = [null, true, false, 0, "null", [], {}, nested,
  { project: "test-project", items: [{ id: "null", value: nested }], nextCursor: "opaque-cursor" },
  { project: "test-project", operation: "data.create", dryRun: true, value: nested }];

test("JSON command output preserves every JSON root as one compact value followed by a newline", () => {
  for (const value of values) {
    const result = capture(() => emitCommandResult(value, "json"));
    assert.equal(result.stdout, `${JSON.stringify(value)}\n`);
    assert.deepEqual(JSON.parse(result.stdout), value);
    assert.equal(result.stderr, "");
  }
});

test("explicit and default text command output preserve JSON values and cursor receipts as reversible YAML", () => {
  for (const value of values) {
    const explicit = capture(() => emitCommandResult(value, "text"));
    const implicit = capture(() => emitCommandResult(value));
    assert.deepEqual(parse(explicit.stdout), value);
    assert.equal(implicit.stdout, explicit.stdout);
    assert.equal(explicit.stderr, "");
    assert.equal(implicit.stderr, "");
  }
  assert.throws(() => JSON.parse(capture(() => emitCommandResult(nested)).stdout), SyntaxError);
});

const failure = Object.assign(new Error("line: # note\nnext"), { code: "REVISION_CONFLICT", details: { expected: 1, actual: 2 } });
test("JSON command errors write their complete diagnostic only to stderr and set exit status one", () => {
  const result = capture(() => emitCommandError(failure, "json"));
  const expected = { error: { code: failure.code, message: failure.message, details: failure.details } };
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `${JSON.stringify(expected)}\n`);
  assert.equal(result.exitCode, 1);
});

test("explicit and default text command errors write the readable message only to stderr and set exit status one", () => {
  for (const format of ["text", undefined] as const) {
    const result = capture(() => emitCommandError(failure, format));
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `error: ${failure.message}\n`);
    assert.throws(() => JSON.parse(result.stderr), SyntaxError);
    assert.equal(result.exitCode, 1);
  }
});
