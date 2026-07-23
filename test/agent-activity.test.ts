import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import {
  AgentActivityRecorder,
  agentActivityDelta,
  agentActivityMaxEvents,
  agentActivityPath,
  agentActivityRawPath,
  readAgentActivitySnapshot
} from "../src/acp/activity.js";

const ids = {
  runId: "run-activity",
  reviewId: "review-activity",
  roundId: "round-activity",
  assignmentId: "assignment-activity",
  attemptId: "attempt-activity"
};

test("Agent Activity keeps complete raw ACP updates while exposing a filtered projection", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-agent-activity-"));
  try {
    const location = { runsRoot: root, ...ids };
    const recorder = new AgentActivityRecorder({ ...location, workspaceRoot: root });
    recorder.recordLifecycle("running", "Agent worker started", "2026-07-22T00:00:00.000Z");
    recorder.recordPrompt("initial", "Review this candidate.", "2026-07-22T00:00:00.500Z");
    recorder.recordSessionUpdate(update({
      sessionUpdate: "agent_message_chunk",
      messageId: "message-1",
      content: { type: "text", text: "Reading " }
    }), "2026-07-22T00:00:01.000Z");
    recorder.recordSessionUpdate(update({
      sessionUpdate: "agent_message_chunk",
      messageId: "message-1",
      content: { type: "text", text: "the code." }
    }), "2026-07-22T00:00:02.000Z");
    recorder.recordSessionUpdate(update({
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      title: "Run focused tests",
      kind: "execute",
      status: "in_progress",
      rawInput: { token: "PRIVATE_INPUT" },
      locations: [{ path: join(root, "src", "acp", "client.ts"), line: 1 }]
    }), "2026-07-22T00:00:03.000Z");
    await recorder.flush();

    const initial = await readAgentActivitySnapshot(location);
    const initialDelta = agentActivityDelta(initial, 0);
    assert.equal(initialDelta.events.filter((event) => event.kind === "message").length, 1);
    assert.equal(initialDelta.events.find((event) => event.kind === "message")?.body, "Reading the code.");
    assert.deepEqual(initialDelta.events.find((event) => event.kind === "tool")?.locations, ["src/acp/client.ts"]);
    const cursor = initialDelta.nextCursor;

    recorder.recordSessionUpdate(update({
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-1",
      status: "completed",
      rawOutput: { token: "PRIVATE_OUTPUT" },
      _meta: { secret: "PRIVATE_META" }
    }), "2026-07-22T00:00:04.000Z");
    recorder.recordSessionUpdate(update({
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "PRIVATE_REASONING" }
    }), "2026-07-22T00:00:05.000Z");
    recorder.recordSessionUpdate(update({
      sessionUpdate: "plan",
      entries: [{ content: "Verify the timeline", priority: "high", status: "in_progress" }]
    }), "2026-07-22T00:00:06.000Z");
    recorder.recordPrompt("reminder", "Submit the review.", "2026-07-22T00:00:06.500Z");
    await recorder.close();

    const updated = await readAgentActivitySnapshot(location);
    const delta = agentActivityDelta(updated, cursor);
    assert.equal(delta.events.find((event) => event.id === "tool:tool-1")?.status, "completed");
    assert.equal(delta.events.find((event) => event.kind === "thought")?.body, undefined);
    assert.equal(delta.events.find((event) => event.kind === "plan")?.plan?.[0]?.content, "Verify the timeline");
    const source = await readFile(agentActivityPath(location), "utf8");
    assert.doesNotMatch(source, /PRIVATE_INPUT|PRIVATE_OUTPUT|PRIVATE_META|PRIVATE_REASONING|rawInput|rawOutput|_meta/);
    const raw = await readFile(agentActivityRawPath(location), "utf8");
    assert.match(raw, /PRIVATE_INPUT/);
    assert.match(raw, /PRIVATE_OUTPUT/);
    assert.match(raw, /PRIVATE_META/);
    assert.match(raw, /PRIVATE_REASONING/);
    assert.match(raw, /Agent worker started/);
    assert.match(raw, /Review this candidate/);
    assert.match(raw, /Submit the review/);
    assert.equal(raw.trim().split("\n").length, 9);
    assert.equal(updated.sourceBytes, Buffer.byteLength(raw, "utf8"));
    assert.doesNotMatch(JSON.stringify(updated), /Review this candidate|Submit the review/);

    await rm(agentActivityPath(location));
    const rebuilt = await readAgentActivitySnapshot(location);
    assert.deepEqual(rebuilt, updated);
    assert.doesNotMatch(JSON.stringify(rebuilt), /PRIVATE_INPUT|PRIVATE_OUTPUT|PRIVATE_META|PRIVATE_REASONING/);

    const appendedLifecycle = `${JSON.stringify({
      version: 1,
      recordedAt: "2026-07-22T00:00:07.000Z",
      workspaceRoot: root,
      lifecycle: { status: "submitted", title: "Projection rebuilt from JSONL" }
    })}\n`;
    const splitAt = Math.floor(appendedLifecycle.length / 2);
    await appendFile(agentActivityRawPath(location), appendedLifecycle.slice(0, splitAt));
    const duringAppend = await readAgentActivitySnapshot(location);
    assert.equal(duringAppend.events.some((event) => event.title === "Projection rebuilt from JSONL"), false);
    assert.equal(duringAppend.sourceBytes, rebuilt.sourceBytes);
    await appendFile(agentActivityRawPath(location), appendedLifecycle.slice(splitAt));
    const refreshed = await readAgentActivitySnapshot(location);
    assert.equal(refreshed.events.some((event) => event.title === "Projection rebuilt from JSONL"), true);
    assert(refreshed.sourceBytes! > rebuilt.sourceBytes!);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Agent Activity derives projections exclusively from the JSONL source", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-agent-activity-source-"));
  try {
    const withRaw = { runsRoot: root, ...ids, attemptId: "attempt-with-raw" };
    const withRawPath = agentActivityPath(withRaw);
    const withRawRecord = `${JSON.stringify({
      version: 1,
      recordedAt: "2026-07-22T00:00:00.000Z",
      workspaceRoot: root,
      lifecycle: { status: "running", title: "Rebuilt from the only source" }
    })}\n`;
    await mkdir(dirname(withRawPath), { recursive: true });
    await writeFile(agentActivityRawPath(withRaw), withRawRecord);
    await writeFile(withRawPath, JSON.stringify({
      version: 1,
      revision: 99,
      truncated: false,
      droppedCount: 0,
      sourceBytes: 1,
      events: [{
        id: "stale",
        sequence: 1,
        updatedRevision: 99,
        kind: "lifecycle",
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
        title: "Must not survive"
      }]
    }));

    const rebuilt = await readAgentActivitySnapshot(withRaw);
    assert.equal(rebuilt.sourceBytes, Buffer.byteLength(withRawRecord, "utf8"));
    assert.equal(rebuilt.events.some((event) => event.title === "Rebuilt from the only source"), true);
    assert.equal(rebuilt.events.some((event) => event.title === "Must not survive"), false);

    const withoutRaw = { runsRoot: root, ...ids, attemptId: "attempt-without-raw" };
    const withoutRawPath = agentActivityPath(withoutRaw);
    await mkdir(dirname(withoutRawPath), { recursive: true });
    await writeFile(withoutRawPath, JSON.stringify({
      version: 1,
      revision: 99,
      truncated: false,
      droppedCount: 0,
      sourceBytes: 1,
      events: [{
        id: "unbacked",
        sequence: 1,
        updatedRevision: 99,
        kind: "lifecycle",
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
        title: "Unbacked projection"
      }]
    }));

    const empty = await readAgentActivitySnapshot(withoutRaw);
    assert.equal(empty.sourceBytes, 0);
    assert.deepEqual(empty.events, []);
    assert.deepEqual(JSON.parse(await readFile(withoutRawPath, "utf8")), empty);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Agent Activity bounds each attempt and exposes a truncation marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-agent-activity-limit-"));
  try {
    const location = { runsRoot: root, ...ids };
    const recorder = new AgentActivityRecorder({ ...location, workspaceRoot: root });
    for (let index = 0; index < agentActivityMaxEvents + 25; index += 1) {
      recorder.recordSessionUpdate(update({
        sessionUpdate: "agent_message_chunk",
        messageId: `message-${index}`,
        content: { type: "text", text: `event-${index}` }
      }));
    }
    await recorder.close();
    const snapshot = await readAgentActivitySnapshot(location);
    assert.equal(snapshot.events.length, agentActivityMaxEvents);
    assert.equal(snapshot.truncated, true);
    assert.equal(snapshot.droppedCount, 25);
    const raw = await readFile(agentActivityRawPath(location), "utf8");
    assert.equal(raw.trim().split("\n").length, agentActivityMaxEvents + 25);
    assert.equal(agentActivityDelta(snapshot, 0, 0).events.length, 0);
    assert.match(agentActivityDelta(snapshot, 0, 0).summary?.text ?? "", /event-524/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Agent Activity paths reject caller-controlled traversal", () => {
  assert.throws(() => agentActivityPath({
    runsRoot: "/tmp",
    ...ids,
    attemptId: "../outside"
  }), /invalid Agent Activity identifier/);
});

function update(value: Record<string, unknown>): SessionUpdate {
  return value as SessionUpdate;
}
