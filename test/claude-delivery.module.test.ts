import assert from "node:assert/strict";
import test from "node:test";
import { recordClaudeDelivery, type TaskRow } from "../src/daemon/tasks.js";

test("Claude delivery merges an independent read and send after a revision conflict", async t => {
  const id = "task-1";
  const deliveryId = "00000000-0000-4000-8000-000000000000";
  const baseline = "2026-11-22T12:00:00.000Z";
  const observedAt = "2026-11-22T12:00:02.000Z";
  t.mock.timers.enable({ apis: ["Date"], now: new Date(observedAt) });
  let row: TaskRow = {
    id, revision: "1", value: {
      id, type: "review-wait", status: "running",
      input: { project: "p", runId: "r", reviewId: "v", roundId: "round", configPath: "config", cwd: "work" },
      recipient: {
        agentType: "claude", sessionId: "session", agentCommand: "claude",
        inbox: { path: "/inbox/1.sock", device: "1", inode: "2", pid: 1, startedAt: 1 }
      },
      claudeDelivery: { id: deliveryId }, createdAt: baseline, updatedAt: baseline
    }
  };
  let bothReadersReady!: () => void;
  const bothReaders = new Promise<void>(resolve => { bothReadersReady = resolve; });
  const reads: string[] = [], conflicts: string[] = [];
  const store = {
    async read() {
      const snapshot = row;
      reads.push(snapshot.revision);
      if (reads.length === 2) bothReadersReady();
      await bothReaders;
      return snapshot;
    },
    async update(previous: TaskRow, changes: Partial<TaskRow["value"]>) {
      if (previous.revision !== row.revision) {
        conflicts.push(previous.revision);
        throw Object.assign(new Error("Contended delivery"), { code: "REVISION_CONFLICT" });
      }
      row = { ...row, revision: String(Number(row.revision) + 1), value: { ...row.value, ...changes } };
      return row;
    }
  };

  await Promise.all([
    recordClaudeDelivery(id, deliveryId, "readAt", undefined, store),
    recordClaudeDelivery(id, deliveryId, "sentAt", undefined, store)
  ]);

  assert.deepEqual(reads, ["1", "1", "2"]);
  assert.deepEqual(conflicts, ["1"]);
  assert.equal(row.revision, "3");
  assert.equal(row.value.status, "completed");
  assert.equal(row.value.claudeDelivery?.sentAt, observedAt);
  assert.equal(row.value.claudeDelivery?.readAt, observedAt);
});
