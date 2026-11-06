import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import test from "node:test";
import { terminateProcessTree } from "../src/platform-process.js";
import { runAgentReviewAcpSession } from "../src/acp/client.js";

for (const invalidAt of [1, 2]) test(`ACP launch fence rejects invalidation at check ${invalidAt} and leaves no provider`, { timeout: 15000 }, async t => {
  let checks = 0;
  let provider: ChildProcessWithoutNullStreams | undefined;
  let exited: Promise<unknown> | undefined;
  t.after(async () => { if (provider?.pid) await terminateProcessTree(provider.pid).catch(() => undefined); });
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
    exited = once(provider, "exit", { signal: t.signal });
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

for (const mode of ["missing-executable", "provider-exited"] as const) test(`ACP preserves ${mode} diagnostics when lifecycle capture also fails`, { timeout:15000 }, async t => {
  let captured = false;
  await assert.rejects(runAgentReviewAcpSession({
    launch:{provider:"test",command:mode==="missing-executable"?`missing-provider-${process.pid}`:process.execPath,args:mode==="missing-executable"?[]:["-e","process.exit(7)"],cwd:tmpdir(),env:process.env,startupTimeoutMs:5000,idleTimeoutMs:null,maxRuntimeMs:null,promptVersion:"artifact-review-v1"},
    prompt:"review",reminder:"submit",workspaceRoot:tmpdir(),isSubmitted:async()=>false,onSession:async()=>assert.fail("failed provider connected"),
    onBeforeStop:async pid=>{captured=true;if(mode==="missing-executable")assert.equal(pid,undefined);throw Error("capture unavailable");}
  }), (error:unknown)=>{
    assert.ok(error instanceof AggregateError);
    assert.match(error.message,mode==="missing-executable"?/agent_process_spawn:/ : /agent_process_exit:|agent_connection_closed:/);
    assert.match(error.message,/capture unavailable/);
    assert.equal(error.errors.length,2);
    return true;
  });
  assert.equal(captured,true);
});
