import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import test from "node:test";
import { runAgentReviewAcpSession } from "../src/acp/client.js";

for (const invalidAt of [1, 2]) test(`ACP launch fence rejects invalidation at check ${invalidAt} and leaves no provider`, async () => {
  let checks = 0;
  let provider: ChildProcessWithoutNullStreams | undefined;
  let exited: Promise<unknown> | undefined;
  await assert.rejects(runAgentReviewAcpSession({
    launch: { provider: "test", command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"],
      cwd: tmpdir(), env: process.env, startupTimeoutMs: 5000, idleTimeoutMs: null,
      maxRuntimeMs: null, promptVersion: "artifact-review-v1" },
    prompt: "review", reminder: "submit", workspaceRoot: tmpdir(),
    isSubmitted: async () => false, onSession: async () => assert.fail("stale provider connected"),
    assertLaunchValid: async () => {
      if (++checks === invalidAt) throw Error("attempt invalidated");
    }
  }, { spawn: launch => {
    provider = spawn(launch.command, launch.args, { stdio: "pipe", env: launch.env });
    exited = once(provider, "exit");
    return provider;
  } }), /attempt invalidated/);
  assert.equal(checks, invalidAt);
  if (invalidAt === 1) assert.equal(provider, undefined);
  else {
    assert.ok(provider);
    await exited;
    assert.ok(provider.exitCode !== null || provider.signalCode !== null);
  }
});
