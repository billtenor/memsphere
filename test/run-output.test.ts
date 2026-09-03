import assert from "node:assert/strict";
import test from "node:test";
import { renderRunOutput, runOutputPromptIds } from "../src/prompts/run-output.js";
import type { RunState, SchemaWritingSnapshot } from "../src/run/store.js";

const action = {
  id: "flow[1]",
  kind: "action" as const,
  instruction: "Produce the result.",
  actor: "agent" as const,
  artifact: "result",
  type: "string" as const,
  format: { name: "plain" as const, options: {} }
};

function runningRun(): RunState {
  return {
    contractVersion: 3,
    language: "en",
    id: "run-output",
    status: "running",
    procedureName: "output",
    memoryRoot: "/memory",
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    plan: [action],
    stack: [{
      type: "procedure",
      memoryName: "output",
      steps: [action],
      index: 0
    }],
    events: []
  };
}

test("Run output scenes select stable Prompt compositions", () => {
  const run = runningRun();
  for (const kind of ["start", "status", "repeat", "skip"] as const) {
    assert.deepEqual(runOutputPromptIds({ kind, run }, "en"), ["run.current-step"]);
  }

  run.events.push({
    at: "2026-07-25T00:01:00.000Z",
    frame: "procedure",
    stepId: "flow[1]",
    artifact: {
      name: "result",
      type: "string",
      format: { name: "plain", options: {} },
      value: "done"
    }
  });
  run.stack = [];
  run.status = "done";
  assert.deepEqual(
    runOutputPromptIds({ kind: "report", run }, "en"),
    ["run.report-receipt", "run.completed"]
  );
  assert.deepEqual(runOutputPromptIds({ kind: "status", run }, "en"), ["run.completed"]);
});

test("Schema entry returns only the current field instruction", () => {
  const run = runningRun();
  const snapshot: SchemaWritingSnapshot = {
    runId: run.id,
    procedureName: run.procedureName,
    parentStepId: action.id,
    action: {
      instruction: action.instruction,
      asserts: [],
      suggests: []
    },
    artifact: {
      name: action.artifact,
      type: "string",
      format: action.format,
      final: false
    },
    progress: {
      completed: 0,
      total: 1,
      remaining: 1,
      pendingRepeatControls: 0,
      current: "Result",
      fields: [{ id: "schema:Result", path: "Result", status: "current" }]
    },
    currentField: {
      id: "schema:Result",
      path: "Result",
      type: "string",
      format: action.format,
      sources: []
    }
  };
  run.stack.push({
    type: "schema",
    memoryName: "Result",
    sourceStepId: action.id,
    eventStartIndex: 0,
    steps: [{
      id: "schema:Result",
      instruction: "Write Result.",
      artifact: "Result",
      type: "string",
      format: action.format
    }],
    index: 0
  });

  assert.deepEqual(
    runOutputPromptIds({ kind: "enter_schema", run, snapshot }, "en"),
    ["run.schema-overview", "run.current-step"]
  );
});

test("abandoned Run output is terminal and has no next action", () => {
  const run = runningRun();
  run.status = "abandoned";
  run.abandonment = {
    abandonedAt: "2026-08-22T00:00:00.000Z",
    initiator: { kind: "human", source: "view" },
    current: { frame: "procedure", memoryName: "output", stepId: "flow[1]" }
  };
  assert.deepEqual(runOutputPromptIds({ kind: "status", run }, "en"), ["run.abandoned"]);
});

test("pending Human Review assignments produce localized collection guidance", () => {
  const run = runningRun();
  run.language = "zh-CN";
  const round = {
    id: "round-human",
    sequence: 1,
    submissionId: "submission-human",
    status: "pending" as const,
    revision: 0,
    createdAt: "2026-07-25T00:01:00.000Z",
    assignments: [{
      id: "assignment-human",
      actorId: "human-1",
      actorName: "提需方",
      actorKind: "human" as const,
      slotIds: ["owner"],
      permissions: ["artifact.read", "decision.decide"] as const,
      binding: "decision" as const,
      status: "draft" as const,
      draft: { comments: [] }
    }, {
      id: "assignment-agent",
      actorId: "agent-1",
      actorName: "产品",
      actorKind: "agent" as const,
      slotIds: ["product"],
      permissions: ["artifact.read", "decision.assess"] as const,
      binding: "advisory" as const,
      status: "running" as const,
      draft: { comments: [] }
    }],
    votes: []
  };
  const review = {
    id: "review-human",
    stepId: "flow[1]",
    artifactName: "result",
    policyId: "artifact_acceptance.unanimous",
    controlPlane: {} as never,
    status: "pending" as const,
    currentRoundId: round.id,
    createdAt: "2026-07-25T00:01:00.000Z",
    updatedAt: "2026-07-25T00:01:00.000Z",
    submissions: [],
    rounds: [round]
  };
  run.artifactReviews = [review];
  run.events.push({
    at: "2026-07-25T00:01:00.000Z",
    frame: "procedure",
    stepId: "flow[1]",
    artifact: {
      name: "result",
      type: "string",
      format: { name: "plain", options: {} },
      value: "candidate"
    }
  });

  assert.deepEqual(runOutputPromptIds({ kind: "status", run }, "zh-CN"), [
    "run.review-summary",
    "run.review-next-action"
  ]);
  assert.deepEqual(runOutputPromptIds({ kind: "report", run }, "zh-CN"), [
    "run.report-receipt",
    "run.review-next-action"
  ]);
  assert.deepEqual(runOutputPromptIds({ kind: "review", run, review, round }, "zh-CN"), [
    "run.review-summary",
    "run.review-next-action"
  ]);
  const chinese = renderRunOutput({ kind: "status", run }, "zh-CN");
  assert.match(chinese, /向以下 Human 收集本轮正式投票/);
  assert.match(chinese, /提需方（actor_id=human-1；assignment_id=assignment-human）/);
  assert.match(chinese, /通过：Comment 可选/);
  assert.match(chinese, /要求修改：至少需要一条 Comment/);
  assert.match(chinese, /弃权：至少需要一条说明原因的 Comment/);
  assert.match(chinese, /Agent Reviewer 仍在后台评审；无需等待其完成/);
  assert.match(chinese, /“我投通过”.*同时构成本次投票决定和 Runner 代提交授权/s);
  assert.match(chinese, /不要再次询问同义确认/);
  assert.match(chinese, /目标不明确.*才完整复述待提交内容并取得确认/s);
  assert.match(chinese, /submit-for-human --run run-output --review review-human --round round-human/);
  assert.match(renderRunOutput({ kind: "report", run }, "zh-CN"), /向以下 Human 收集本轮正式投票/);
  assert.match(renderRunOutput({ kind: "review", run, review, round }, "zh-CN"), /向以下 Human 收集本轮正式投票/);

  const english = renderRunOutput({ kind: "status", run }, "en");
  assert.match(english, /collect a formal vote for this round/);
  assert.match(english, /Request changes: at least one Comment is required/);
  assert.match(english, /that statement is both the formal decision and authorization/);
  assert.match(english, /do not ask for a synonymous confirmation/);

  round.assignments[0]!.status = "submitted";
  round.assignments[0]!.submitted = {
    comments: [],
    vote: "approve",
    submittedAt: "2026-07-25T00:02:00.000Z",
    authorization: {} as never
  };
  const agentOnly = renderRunOutput({ kind: "status", run }, "zh-CN");
  assert.doesNotMatch(agentOnly, /向以下 Human 收集本轮正式投票/);
  assert.match(agentOnly, /memsphere run review wait --review review-human/);
});
