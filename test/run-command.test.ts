import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRunArtifactContractDetail,
  buildRunArtifactDetail,
  buildRunOverview,
  buildRunStepDetail,
  printArtifactReviewSummary,
  printLatestReportAuthorization,
  printRunState
} from "../src/commands/run.js";
import type { ArtifactReview, ArtifactReviewRound } from "../src/artifact-review.js";
import {
  authorizeArtifactOperation,
  createControlPlaneSnapshot,
  parseControlPlaneConfig,
  resolveArtifactControlPlane
} from "../src/control-plane/index.js";
import type { RunState } from "../src/run/store.js";

test("Run inspection separates navigation, step detail, and Artifact content", async () => {
  const steps: NonNullable<RunState["plan"]> = [{
    id: "flow[1]",
    kind: "action",
    instruction: "Produce the summary.",
    actor: "agent",
    artifact: "summary",
    type: "object",
    format: { name: "json", options: {} },
    schema: {
      kind: "inline",
      id: "summary-contract",
      node: {
        tag: "!schema",
        names: ["Summary contract"],
        defines: [],
        type: "object",
        format: { name: "json", options: {} },
        fields: [{
          tag: "!schema",
          names: ["summary"],
          defines: [],
          type: "string"
        }]
      }
    },
    asserts: ["The summary is concrete."],
    suggests: ["Keep it short."]
  }, {
    id: "flow[2]",
    kind: "action",
    instruction: "Produce the conclusion.",
    actor: "agent",
    artifact: "conclusion",
    type: "string",
    format: { name: "plain", options: {} }
  }];
  const run: RunState = {
    contractVersion: 3,
    id: "run-inspection",
    status: "running",
    procedureName: "CLI inspection",
    memoryRoot: "/memory",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:01:00.000Z",
    plan: steps,
    stack: [{ type: "procedure", memoryName: "CLI inspection", steps, index: 1 }],
    events: [{
      at: "2026-07-21T00:00:30.000Z",
      frame: "procedure",
      stepId: "flow[1]",
      artifact: {
        name: "summary",
        type: "object",
        format: { name: "json", options: {} },
        storage: "inline",
        value: { summary: "Candidate summary" }
      }
    }]
  };

  const overview = buildRunOverview(run) as Record<string, unknown> & {
    totalSteps: number;
    currentStepRef: string;
    steps: Array<Record<string, unknown>>;
  };
  assert.equal(overview.totalSteps, 2);
  assert.equal(overview.currentStepRef, "CLI inspection#flow[2]");
  assert.equal(overview.steps[0].artifactState, "reported");
  assert.equal(overview.steps[1].current, true);
  assert.equal("stack" in overview, false);
  assert.equal("events" in overview, false);
  assert.equal("controlPlane" in overview, false);

  const detail = buildRunStepDetail(run, "CLI inspection#flow[1]") as {
    step: { asserts: string[]; suggests: string[] };
  };
  assert.deepEqual(detail.step.asserts, ["The summary is concrete."]);
  assert.deepEqual(detail.step.suggests, ["Keep it short."]);

  const artifact = await buildRunArtifactDetail("/runs", run, "CLI inspection#flow[1]") as {
    source: string;
    artifact: { value: unknown };
  };
  assert.equal(artifact.source, "run_event");
  assert.deepEqual(artifact.artifact.value, { summary: "Candidate summary" });
  assert.equal((artifact.artifact as { storage?: string }).storage, "inline");
  assert.equal((artifact.artifact as { filePath?: string }).filePath, undefined);
  assert.equal("contract" in artifact, false);

  const contract = buildRunArtifactContractDetail(run, "CLI inspection#flow[1]") as {
    action: { instruction: string; asserts: string[] };
    artifact: { schema: { kind: string; node: { fields: unknown[] } } };
  };
  assert.equal(contract.action.instruction, "Produce the summary.");
  assert.deepEqual(contract.action.asserts, ["The summary is concrete."]);
  assert.equal(contract.artifact.schema.kind, "inline");
  assert.equal(contract.artifact.schema.node.fields.length, 1);
});

test("run output separates Procedure assertions from Action assertions", () => {
  const run: RunState = {
    contractVersion: 2,
    id: "run-contract",
    status: "running",
    procedureName: "guarded-procedure",
    asserts: ["Keep the global contract active."],
    memoryRoot: "/memory",
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    stack: [{
      type: "procedure",
      memoryName: "guarded-procedure",
      asserts: ["Keep the global contract active."],
      steps: [{
        id: "flow[1]",
        kind: "action",
        instruction: "Produce the result.",
        actor: "agent",
        artifact: "result",
        type: "string",
        format: { name: "plain", options: {} },
        asserts: ["Check this step."]
      }],
      index: 0
    }],
    events: []
  };
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    printRunState(run);
  } finally {
    console.log = originalLog;
  }

  const output = lines.join("\n");
  assert.match(output, /Procedure Asserts:\n- Keep the global contract active\./);
  assert.match(output, /Asserts:\n- Check this step\./);
  assert(output.indexOf("Procedure Asserts:") < output.indexOf("\nAsserts:"));
});

test("run output presents Repeat as control without an Artifact", () => {
  const run: RunState = {
    contractVersion: 2,
    id: "run-repeat",
    status: "running",
    procedureName: "repeat-procedure",
    memoryRoot: "/memory",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    stack: [{
      type: "schema",
      memoryName: "record",
      steps: [{
        id: "schema:record.fields[1].repeat",
        kind: "repeat",
        instruction: "Choose repeat count.",
        repeat: { parentPath: "record", fieldIndex: 0, body: ["item"], min: 1, max: 3 }
      }],
      index: 0
    }],
    events: []
  };
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    printRunState(run);
  } finally {
    console.log = originalLog;
  }

  const output = lines.join("\n");
  assert.match(output, /allowed count: 1\.\.3/);
  assert.match(output, /memsphere run repeat <count> --run run-repeat/);
  assert.doesNotMatch(output, /Artifact:/);
});

test("run output explains effective runner permissions before report", () => {
  const snapshot = createControlPlaneSnapshot(parseControlPlaneConfig({
    identities: { human: { kind: "human", name: "Human" } },
    roles: {
      runner: {
        name: "Runner",
        permissions: ["artifact.read", "artifact.submit"],
        grantable_permissions: ["decision.decide"]
      },
      reviewer: {
        name: "Reviewer",
        permissions: ["artifact.read"],
        system_prompt: "Review carefully."
      }
    }
  }));
  const controlPlane = resolveArtifactControlPlane({
    snapshot,
    procedureBindings: { reviewer: { identityIds: ["human"], source: "procedure:governed" } },
    permissionGrants: { runner: ["decision.decide"] },
    artifactScope: "flow[1]",
    artifactBindingSource: "artifact:flow[1]",
    artifactGrantSource: "artifact:flow[1]"
  });
  const run: RunState = {
    contractVersion: 3,
    id: "run-governed",
    status: "running",
    procedureName: "governed",
    memoryRoot: "/memory",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    stack: [{
      type: "procedure",
      memoryName: "governed",
      steps: [{
        id: "flow[1]",
        kind: "action",
        instruction: "Produce the result.",
        artifact: "result",
        type: "string",
        format: { name: "plain", options: {} },
        controlPlane
      }],
      index: 0
    }],
    events: [],
    controlPlane: snapshot,
    procedureSnapshots: {}
  };
  const lines: string[] = [];
  const originalLog = console.log;
  const originalLang = process.env.LANG;
  process.env.LANG = "en_US.UTF-8";
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    printRunState(run);
  } finally {
    console.log = originalLog;
    if (originalLang === undefined) delete process.env.LANG;
    else process.env.LANG = originalLang;
  }

  const output = lines.join("\n");
  assert.match(output, /Control Plane:\n- mode: enabled/);
  assert.match(output, /runner grants: decision\.decide/);
  assert.match(output, /reviewer: human \(procedure:governed; system_prompt: present\)/);
  assert.match(output, /Permission Guidance:/);
  assert.match(output, /artifact\.submit: You may submit the current Artifact/);
  assert(output.indexOf("Permission Guidance:") < output.indexOf("Then:"));
});

test("successful report output explains the permission in natural language", () => {
  const snapshot = createControlPlaneSnapshot(parseControlPlaneConfig({
    identities: {},
    roles: {
      runner: {
        name: "Runner",
        permissions: ["artifact.read"],
        grantable_permissions: ["artifact.submit"]
      }
    }
  }));
  const controlPlane = resolveArtifactControlPlane({
    snapshot,
    procedureBindings: {},
    permissionGrants: { runner: ["artifact.submit"] },
    artifactScope: "flow[1]",
    artifactBindingSource: "artifact:flow[1]",
    artifactGrantSource: "artifact:flow[1]"
  });
  const decision = authorizeArtifactOperation({
    controlPlane,
    subject: { kind: "runner" },
    permission: "artifact.submit"
  });
  const run: RunState = {
    contractVersion: 3,
    id: "run-report-guidance",
    status: "done",
    procedureName: "governed",
    memoryRoot: "/memory",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    stack: [],
    events: [{
      at: "2026-07-21T00:00:01.000Z",
      frame: "procedure",
      stepId: "flow[1]",
      artifact: {
        name: "result",
        type: "string",
        format: { name: "plain", options: {} },
        authorization: decision
      }
    }],
    controlPlane: snapshot,
    procedureSnapshots: {}
  };
  const lines: string[] = [];
  const originalLog = console.log;
  const originalLang = process.env.LANG;
  process.env.LANG = "en_US.UTF-8";
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    printLatestReportAuthorization(run);
  } finally {
    console.log = originalLog;
    if (originalLang === undefined) delete process.env.LANG;
    else process.env.LANG = originalLang;
  }

  const output = lines.join("\n");
  assert.match(output, /Allowed: this operation uses the artifact\.submit permission/);
  assert.match(output, /artifact\.submit \(grant\): You may submit the current Artifact/);
  assert.match(output, /grant: artifact:flow\[1\]/);
});

test("Artifact Review output emphasizes votes, comments, and an actionable conclusion", () => {
  const round: ArtifactReviewRound = {
    id: "round-1",
    sequence: 1,
    submissionId: "submission-1",
    status: "changes_requested",
    revision: 3,
    createdAt: "2026-07-21T00:00:00.000Z",
    assignments: [{
      identityId: "advisor",
      identityName: "Advisor",
      roleIds: ["advisor"],
      permissions: ["artifact.read", "decision.assess"],
      binding: "advisory",
      status: "submitted",
      draft: { comments: [] },
      submitted: {
        vote: "request_changes",
        comments: [{ id: "comment-1", body: "Clarify the conclusion.", createdAt: "2026-07-21T00:01:00.000Z", updatedAt: "2026-07-21T00:01:00.000Z" }],
        submittedAt: "2026-07-21T00:01:00.000Z",
        authorization: {} as never
      }
    }, {
      identityId: "decider",
      identityName: "Decider",
      roleIds: ["decider"],
      permissions: ["artifact.read", "decision.decide"],
      binding: "decision",
      status: "submitted",
      draft: { comments: [] },
      submitted: {
        vote: "request_changes",
        comments: [],
        submittedAt: "2026-07-21T00:02:00.000Z",
        authorization: {} as never
      }
    }],
    votes: [{
      id: "vote-runner",
      subject: { kind: "runner" },
      binding: "decision",
      value: "approve",
      automatic: true,
      authorization: {} as never,
      submittedAt: "2026-07-21T00:00:00.000Z"
    }],
    result: {
      status: "changes_requested",
      completedAt: "2026-07-21T00:02:00.000Z",
      humanSubmitted: 2,
      humanTotal: 2,
      decisionApprove: 1,
      decisionTotal: 2,
      advisoryTotal: 1
    }
  };
  const review: ArtifactReview<RunState["events"][number]["artifact"]> = {
    id: "review-1",
    stepId: "flow[1]",
    artifactName: "candidate",
    policyId: "artifact_acceptance.unanimous",
    controlPlane: {} as never,
    status: "awaiting_revision",
    currentRoundId: round.id,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:02:00.000Z",
    submissions: [],
    rounds: [round]
  };
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    printArtifactReviewSummary(review, round);
  } finally {
    console.log = originalLog;
  }

  const output = lines.join("\n");
  assert.match(output, /- submitted: 2\/2/);
  assert.match(output, /- Advisor \(advisory\)\n  - vote: request_changes/);
  assert.doesNotMatch(output, /Clarify the conclusion/);
  assert.match(output, /- Runner \(decision, automatic\)\n  - vote: approve/);
  assert.match(output, /unanimous approval was not reached: 1\/2 decision votes approved/);
  assert.match(output, /Conclusion:\n- This review round did not pass because unanimous approval was not reached; revise the Artifact/);
  assert.doesNotMatch(output, /Human submitted|; submitted;|formal votes|advisory votes|result:/);
});

test("Artifact Review output asks the Runner to decide after assigned reviews complete", () => {
  const snapshot = createControlPlaneSnapshot(parseControlPlaneConfig({
    identities: {},
    roles: {
      runner: {
        name: "Runner",
        permissions: ["artifact.read", "artifact.submit", "decision.decide"]
      }
    }
  }));
  const controlPlane = resolveArtifactControlPlane({
    snapshot,
    procedureBindings: {},
    artifactScope: "flow[1]",
    artifactBindingSource: "artifact:flow[1]",
    artifactGrantSource: "artifact:flow[1]"
  });
  const round: ArtifactReviewRound = {
    id: "round-2",
    sequence: 2,
    submissionId: "submission-2",
    status: "awaiting_runner_vote",
    revision: 4,
    createdAt: "2026-07-21T00:00:00.000Z",
    assignments: [{
      identityId: "advisor",
      identityName: "Advisor",
      roleIds: ["advisor"],
      permissions: ["artifact.read", "decision.assess"],
      binding: "advisory",
      status: "submitted",
      draft: { comments: [] },
      submitted: {
        vote: "request_changes",
        comments: [{ id: "comment-1", body: "Please tighten the explanation.", createdAt: "2026-07-21T00:01:00.000Z", updatedAt: "2026-07-21T00:01:00.000Z" }],
        submittedAt: "2026-07-21T00:01:00.000Z",
        authorization: {} as never
      }
    }, {
      identityId: "decider",
      identityName: "Decider",
      roleIds: ["decider"],
      permissions: ["artifact.read", "decision.decide"],
      binding: "decision",
      status: "submitted",
      draft: { comments: [] },
      submitted: {
        vote: "approve",
        comments: [],
        submittedAt: "2026-07-21T00:02:00.000Z",
        authorization: {} as never
      }
    }],
    votes: [{
      id: "vote-advisor",
      subject: { kind: "identity", identityId: "advisor" },
      binding: "advisory",
      value: "request_changes",
      automatic: false,
      authorization: {} as never,
      submittedAt: "2026-07-21T00:01:00.000Z"
    }, {
      id: "vote-decider",
      subject: { kind: "identity", identityId: "decider" },
      binding: "decision",
      value: "approve",
      automatic: false,
      authorization: {} as never,
      submittedAt: "2026-07-21T00:02:00.000Z"
    }]
  };
  const review: ArtifactReview<RunState["events"][number]["artifact"]> = {
    id: "review-2",
    stepId: "flow[1]",
    artifactName: "candidate",
    policyId: "artifact_acceptance.unanimous",
    controlPlane,
    status: "awaiting_runner_vote",
    currentRoundId: round.id,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:02:00.000Z",
    submissions: [],
    rounds: [round]
  };
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    printArtifactReviewSummary(review, round);
  } finally {
    console.log = originalLog;
  }

  const output = lines.join("\n");
  assert.match(output, /- Runner \(decision\)\n  - vote: pending/);
  assert.match(output, /All assigned reviews are submitted: 1\/1 decision votes approved; 1 advisory vote was recorded/);
  assert.doesNotMatch(output, /Human review|Human decision/);
  assert.match(output, /You are the Runner for this Run, and your decision vote is pending/);
  assert.match(output, /As the Runner, review every comment above, then cast your vote explicitly/);
  assert.match(output, /The Artifact has not been accepted and the Run has not advanced/);
  assert.doesNotMatch(output, /passed unanimously|Run advanced/);
});
