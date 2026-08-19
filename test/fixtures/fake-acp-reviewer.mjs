#!/usr/bin/env node
import crossSpawn from "cross-spawn";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const mode = process.argv[2] || "approve";
const sessions = new Set();

const app = acp
  .agent({ name: "memsphere-fake-reviewer" })
  .onRequest(acp.methods.agent.initialize, async ({ params }) => {
    if (mode === "slow-start") await delay(200);
    return {
      protocolVersion: mode === "protocol-mismatch" ? params.protocolVersion + 1 : acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      agentInfo: { name: "memsphere-fake-reviewer", version: "1.0.0" }
    };
  })
  .onRequest(acp.methods.agent.session.new, () => {
    const sessionId = `fake-${randomUUID()}`;
    sessions.add(sessionId);
    return { sessionId };
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client, signal }) => {
    if (!sessions.has(params.sessionId)) throw new Error(`unknown session: ${params.sessionId}`);
    if (mode === "internal-error") {
      process.stderr.write("provider diagnostic: reconnecting\n");
      throw new Error("synthetic provider failure");
    }
    if (mode === "idle") await delay(200);
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
    if (mode === "approve" || mode === "request_changes") {
      try {
        await sendReviewActivity(client, params.sessionId);
        completeReview(mode);
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

function completeReview(vote) {
  const cli = process.env.MEMSPHERE_CLI;
  const assignment = process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID;
  if (!cli || !assignment) throw new Error("fake reviewer is missing Memsphere Session environment");
  invoke(cli, ["run", "artifact", "show", "--assignment", assignment, "--output", "json"]);
  invoke(cli, [
    "run", "artifact", "contract", "show", "--assignment", assignment, "--output", "json"
  ]);
  invoke(cli, ["run", "review", "assignment", "show", "--assignment", assignment, "--output", "json"]);
  if (vote === "request_changes") {
    invoke(cli, ["run", "review", "comment", "--assignment", assignment, "--severity", "blocking", "--body", "Fake blocking finding", "--output", "json"]);
  }
  invoke(cli, [
    "run", "review", "submit", "--assignment", assignment,
    "--vote", vote === "request_changes" ? "request_changes" : "approve",
    "--summary", "Fake ACP review completed", "--output", "json"
  ]);
}

function invoke(command, args) {
  const result = crossSpawn.sync(command, args, { encoding: "utf8", env: process.env });
  if (result.status !== 0) throw new Error(`fake reviewer CLI failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
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
