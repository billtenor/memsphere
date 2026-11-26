import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once, EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawnCommand } from "../../../src/platform-process.js";
import { tmpdir } from "node:os";
import test from "node:test";
import { terminateProcessTree } from "../../../src/platform-process.js";
import { runAgentReviewAcpSession } from "../../../src/acp/client.js";
import { claudeAcpVersion } from "../../../src/acp/catalog.js";

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
  let closed:Promise<void>|undefined;
  // Let the initial write finish before the deliberate Provider failure.
  const exitAfterRequest = String.raw`
let request = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", function receive(chunk) {
  request += chunk;
  const end = request.indexOf("\n");
  if (end < 0) return;
  process.stdin.off("data", receive);
  JSON.parse(request.slice(0, end));
  process.stderr.write("provider configuration rejected\n", () => process.exit(7));
});`;
  await assert.rejects(runAgentReviewAcpSession({
    launch:{provider:"test",command:mode==="missing-executable"?`missing-provider-${process.pid}`:process.execPath,args:mode==="missing-executable"?[]:["-e",exitAfterRequest],cwd:tmpdir(),env:process.env,startupTimeoutMs:5000,idleTimeoutMs:null,maxRuntimeMs:null,promptVersion:"artifact-review-v1"},
    prompt:"review",reminder:"submit",workspaceRoot:tmpdir(),isSubmitted:async()=>false,onSession:async()=>assert.fail("failed provider connected"),
    onBeforeStop:async pid=>{captured=true;if(mode==="missing-executable")assert.equal(typeof pid,process.platform==="win32"?"number":"undefined");throw Error("capture unavailable");}
  },{spawn:launch=>{
    const provider=spawnCommand(launch.command,launch.args,{cwd:launch.cwd,env:launch.env,stdio:"pipe"}) as ChildProcessWithoutNullStreams;
    closed=new Promise<void>(resolve=>provider.once("close",()=>resolve()));return provider;
  }}), (error:unknown)=>{
    assert.ok(error instanceof AggregateError);
    assert.match(error.message,mode==="missing-executable"?/agent_process_spawn:/ : /agent_process_exit:|agent_connection_closed:/);
    assert.match(error.message,/capture unavailable/);
    assert.equal(error.errors.length,2);
    if(mode==="provider-exited") {
      assert.match(error.message,/provider configuration rejected/);
      assert.match(error.errors[0].message,/provider configuration rejected/);
      assert.equal(error.cause,error.errors[0]);
    }
    return true;
  });
  await closed; // All OS/wrapper events must still belong to this test/session.
  assert.equal(captured,true);
});


test("ACP attributes a launcher error after stdout EOF to the original spawn failure",{timeout:5000},async()=>{
 const provider=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),pid:undefined,exitCode:null as number|null,signalCode:null,kill:()=>true});
 let lateErrorObserved=false;
 provider.stdout.once("end",()=>setImmediate(()=>{
  lateErrorObserved=true;provider.emit("error",new Error("ENOENT controlled launcher failure"));provider.exitCode=-1;provider.emit("exit",-1,null);provider.emit("close",-1,null);
 }));
 await assert.rejects(runAgentReviewAcpSession({
  launch:{provider:"test",command:"controlled-launcher",args:[],cwd:tmpdir(),env:process.env,startupTimeoutMs:1000,idleTimeoutMs:null,maxRuntimeMs:null,promptVersion:"artifact-review-v1"},
  prompt:"review",reminder:"submit",workspaceRoot:tmpdir(),isSubmitted:async()=>false,onSession:async()=>assert.fail("failed launcher connected")
 },{spawn:()=>{queueMicrotask(()=>{provider.emit("spawn");provider.stdout.end();});return provider as unknown as ChildProcessWithoutNullStreams;}}),/agent_process_spawn: ENOENT controlled launcher failure/);
 assert.equal(lateErrorObserved,true);
});

test("Claude ACP checks the adapter and configures the default mode before prompting", { timeout: 30000 }, async () => {
  const fixture = String.raw`
const assert = require("node:assert/strict");
const { createInterface } = require("node:readline");
const fixtureMode = process.argv[1];
let permissionMode = "auto";
createInterface({ input: process.stdin }).on("line", line => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  let result, error;
  if (method === "initialize") {
    result = {
      protocolVersion: 1, agentCapabilities: {}, agentInfo: {
        name: "@agentclientprotocol/claude-agent-acp",
        version: fixtureMode === "wrong-version" ? "9.9.9" : process.argv[2]
      }
    };
  } else if (method === "session/new") {
    assert.deepEqual(params.mcpServers, []);
    const options = params._meta.claudeCode.options;
    assert.equal(Object.hasOwn(options, "settingSources"), false);
    assert.deepEqual(options.tools, ["Bash", "Read"]);
    assert.equal(options.model, "fixture-claude-model");
    assert.equal(options.allowDangerouslySkipPermissions, false);
    result = { sessionId: "fixture", modes: {
      currentModeId: permissionMode,
      availableModes: fixtureMode === "missing-mode" ? [{ id: "auto", name: "Auto" }]
        : [{ id: "auto", name: "Auto" }, { id: "default", name: "Default" }]
    } };
  } else if (method === "session/set_mode") {
    assert.equal(params.sessionId, "fixture");
    assert.equal(params.modeId, "default");
    if (fixtureMode === "mode-rejected") error = { code: -32603, message: "Mode change rejected" };
    else { permissionMode = "default"; result = {}; }
  } else if (method === "session/prompt") {
    assert.equal(fixtureMode, "ready");
    assert.equal(permissionMode, "default");
    result = { stopReason: "end_turn" };
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result, error }) + "\n");
});
`;
  const run = (mode: string) => runAgentReviewAcpSession({
    launch: {
      provider: "claude", command: process.execPath, args: ["-e", fixture, mode, claudeAcpVersion], cwd: tmpdir(),
      env: process.env, startupTimeoutMs: 5000, idleTimeoutMs: 5000, maxRuntimeMs: null,
      promptVersion: "artifact-review-v1", model: "fixture-claude-model"
    },
    prompt: "review", reminder: "submit", workspaceRoot: tmpdir(),
    isSubmitted: async () => true, onSession: async () => undefined
  });
  await assert.rejects(run("wrong-version"), /requires verified claude-agent-acp/);
  await assert.rejects(run("missing-mode"), /default permission mode is unavailable/);
  await assert.rejects(run("mode-rejected"));
  assert.equal((await run("ready")).stopReason, "end_turn");
});
