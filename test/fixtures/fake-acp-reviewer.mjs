#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { processGate } from './process-gates.mjs';
import crossSpawn from "cross-spawn";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { access, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";

const mode = process.argv[2] || "approve";
const sessions = new Set();

const app = acp
  .agent({ name: "memsphere-fake-reviewer" })
  .onRequest(acp.methods.agent.initialize, async ({ params }) => {
    if (mode === "slow-start") await delay(1_500);
    return {
      protocolVersion: mode === "protocol-mismatch" ? params.protocolVersion + 1 : acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      agentInfo: { name: "memsphere-fake-reviewer", version: "1.0.0" }
    };
  })
  .onRequest(acp.methods.agent.session.new, ({ params }) => {
    if (process.env.MEMSPHERE_WORKSPACE_ROOT) {
      assert.equal(realpathSync(params.cwd), realpathSync(process.cwd()));
      assert.equal(params.cwd, process.env.MEMSPHERE_WORKSPACE_ROOT);
      for (const name of ["TMPDIR", "TMP", "TEMP"]) assert.equal(process.env[name], params.cwd);
    }
    const sessionId = `fake-${randomUUID()}`;
    sessions.add(sessionId);
    return { sessionId };
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client, signal }) => {
    if (!sessions.has(params.sessionId)) throw new Error(`unknown session: ${params.sessionId}`);
    if (mode === "exit-zero") process.exit(0);
    if (mode === "exit-error") process.exit(7);
    if (mode === "exit-signal") process.kill(process.pid, "SIGTERM");
    if (mode === "internal-error") {
      process.stderr.write("provider diagnostic: reconnecting\n");
      throw new Error("synthetic provider failure");
    }
    if (mode === "idle") await delay(1_500);
    if (mode === "progress") {
      for (let index = 0; index < 8; index += 1) {
        await delay(15);
        await sendProgress(client, params.sessionId, index);
      }
    }
    if (mode === "progress-hang") {
      let index = 0;
      while (!signal.aborted) {
        await delay(15);
        await sendProgress(client, params.sessionId, index++);
      }
    }
    if (mode === "rewind-gated") {
      // Test teardown addresses this owned fixture through its unique gate,
      // never through a potentially recycled Provider PID.
      void processGate(process.env.REVIEW_TEST_GATES,'wait',`release-provider:${process.env.REVIEW_TEST_READY}`,undefined,undefined,true)
        .then(()=>process.exit(0), error=>{ console.error(error); process.exitCode=1; });
      await processGate(process.env.REVIEW_TEST_GATES,'publish',`provider-launched:${process.env.REVIEW_TEST_READY}`);
      if(process.env.REVIEW_TEST_RESISTANT){process.on("SIGTERM",()=>{});process.on("SIGUSR1",()=>process.removeAllListeners("SIGTERM"));}
      if (process.env.REVIEW_TEST_SETUP_API) {
        // These cancellation tests target OS/ACP lifecycle, not CLI dispatch.
        const {mutateBoundReviewNode} = await import('../../dist/acp/review-session.js');
        await mutateBoundReviewNode({operation:'report',artifact:{applicable:true}});
      } else {
        await invoke(process.env.MEMSPHERE_CLI,["run","artifact","show","--assignment",process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID,"--output","json"]);
        await invoke(process.env.MEMSPHERE_CLI,["continue","report","--artifact",JSON.stringify({applicable:true}),"--output","json"]);
      }
      const child = spawn(process.execPath,[fileURLToPath(new URL(process.env.REVIEW_TEST_LATE_DESCENDANT ? './rewind-late-child.mjs' : './rewind-provider-child.mjs', import.meta.url))],{detached:process.platform === "win32" && Boolean(process.env.REVIEW_TEST_RELEASE),stdio:["ignore","ignore","ignore","ipc"]});
      await new Promise(resolve=>child.once("message",resolve));
      if (process.env.REVIEW_TEST_SUBMITTED) await completeReview("approve", client, params.sessionId, true);
      await processGate(process.env.REVIEW_TEST_GATES,'publish',process.env.REVIEW_TEST_READY,{providerPid:process.pid,childPid:child.pid});
      if (process.env.REVIEW_TEST_COMPLETE) {
        await processGate(process.env.REVIEW_TEST_GATES,'wait',`finish-review:${process.env.REVIEW_TEST_READY}`,undefined,signal);
      } else if (process.env.REVIEW_TEST_RELEASE) {
        await processGate(process.env.REVIEW_TEST_GATES,'wait',process.env.REVIEW_TEST_RELEASE,undefined,signal);
      } else if (!signal.aborted) {
        await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      }
    }
    if (mode === "gated-approve") {
      while (!signal.aborted) {
        try { await access(process.env.REVIEW_TEST_GATE); break; }
        catch { await delay(25); }
      }
    }
    if (mode === "approve" || mode === "request_changes" || mode === "gated-approve") {
      try {
        await sendReviewActivity(client, params.sessionId);
        await completeReview(mode === "gated-approve" ? "approve" : mode, client, params.sessionId);
      } catch (error) {
        process.stderr.write(`fake reviewer completion failed: ${error?.stack || error}\n`);
        throw error;
      }
    }
    return { stopReason: "end_turn" };
  })
  .onNotification(acp.methods.agent.session.cancel, () => undefined);

app.connect(acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin)
));

async function completeReview(vote, client, sessionId, graphAlreadyRead = false) {
  if (mode === 'rewind-gated' && process.env.REVIEW_TEST_SETUP_API) {
    assert.equal(vote,'approve');
    const {boundReviewNodeView,mutateBoundReviewNode,submitBoundReviewNodes} = await import('../../dist/acp/review-session.js');
    let view=await boundReviewNodeView();
    while(view.node)view=await mutateBoundReviewNode({operation:'report',artifact:{applicable:true}});
    await submitBoundReviewNodes({vote:'approve',summary:'Fake ACP review completed'});
    return;
  }
  const cli = process.env.MEMSPHERE_CLI;
  const assignment = process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID;
  if (!cli || !assignment) throw new Error("fake reviewer is missing Memsphere Session environment");
  let commandIndex = 0;
  const invokeReviewCli = async (args) => {
    // Report actual work boundaries so a busy fixture does not look idle between CLI calls.
    await sendProgress(client, sessionId, `cli-${++commandIndex}`);
    return invoke(cli, args);
  };
  let graph = graphAlreadyRead;
  if (!graphAlreadyRead) {
    await invokeReviewCli(["run", "artifact", "show", "--assignment", assignment, "--output", "json"]);
    await invokeReviewCli(["run", "artifact", "contract", "show", "--assignment", assignment, "--output", "json"]);
    const detail = JSON.parse(await invokeReviewCli(["run", "review", "assignment", "show", "--assignment", assignment, "--output", "json"]));
    graph = Boolean(detail.reviewProgress);
  }
  if (graph) {
    let view = JSON.parse(await invokeReviewCli(["continue", "show", "--output", "json"]));
    while (view.node) {
      if (view.node.kind === "open_review" && vote === "request_changes") await invokeReviewCli(["continue", "comment", "add", "--artifact", JSON.stringify({body:"Fake blocking finding",severity:"blocking"}), "--output", "json"]);
      view = JSON.parse(await invokeReviewCli(["continue", "report", "--artifact", JSON.stringify({applicable:true}), "--output", "json"]));
    }
    await invokeReviewCli(["continue", "submit", "--artifact", JSON.stringify({vote:vote === "request_changes" ? "request_changes" : "approve",summary:"Fake ACP review completed"}), "--output", "json"]);
    return;
  }
  if (vote === "request_changes") {
    await invokeReviewCli(["run", "review", "comment", "--assignment", assignment, "--severity", "blocking", "--body", "Fake blocking finding", "--output", "json"]);
  }
  await invokeReviewCli([
    "run", "review", "submit", "--assignment", assignment,
    "--vote", vote === "request_changes" ? "request_changes" : "approve",
    "--summary", "Fake ACP review completed", "--output", "json"
  ]);
}

async function invoke(command, args) {
  // CLI tools are real child processes. Keep the ACP event loop available so
  // queued progress and cancellation traffic can be delivered during execution.
  const child = crossSpawn(command, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [], errors = [];
  const limit = 1024 * 1024; // Preserve spawnSync's default output bound.
  let outputBytes = 0, errorBytes = 0;
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.on('data', chunk => {
      output.push(chunk); outputBytes += chunk.length;
      if (outputBytes > limit) { child.kill(); reject(new Error('fake reviewer CLI stdout exceeded maxBuffer')); }
    });
    child.stderr.on('data', chunk => {
      errors.push(chunk); errorBytes += chunk.length;
      if (errorBytes > limit) { child.kill(); reject(new Error('fake reviewer CLI stderr exceeded maxBuffer')); }
    });
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`fake reviewer CLI failed: ${Buffer.concat(errors).toString() || Buffer.concat(output).toString()}`)));
  });
  return Buffer.concat(output).toString().trim();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sendProgress(client, sessionId, index) {
  try {
    await client.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `progress-${index}` }
      }
    });
  } catch (error) {
    process.stderr.write(`progress update failed: ${error?.stack || error}\n`);
    throw error;
  }
}

async function sendReviewActivity(client, sessionId) {
  await client.notify(acp.methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      messageId: "fake-review-message",
      content: { type: "text", text: "Reviewing implementation evidence." }
    }
  });
  await client.notify(acp.methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "fake-test-tool",
      title: "Run focused tests",
      kind: "execute",
      status: "in_progress",
      rawInput: { private: true }
    }
  });
  await client.notify(acp.methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "fake-test-tool",
      status: "completed",
      rawOutput: { private: true }
    }
  });
  await client.notify(acp.methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: "plan",
      entries: [{ content: "Inspect and submit", priority: "high", status: "completed" }]
    }
  });
  for (let index = 0; index < 36; index += 1) {
    await client.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: `fake-detail-${index}`,
        content: { type: "text", text: `Inspected implementation detail ${index}.` }
      }
    });
  }
}
