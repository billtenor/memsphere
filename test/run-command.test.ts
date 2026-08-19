import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  buildRunArtifactContractDetail,
  buildRunArtifactDetail,
  buildRunOverview,
  buildRunStepDetail,
  printRunOutput,
  printSchemaWritingOverview,
  runStartCommand,
  resolveReviewCommentBody,
  validateInlineReviewCommentBody
} from "../src/commands/run.js";
import type { ArtifactReview, ArtifactReviewRound } from "../src/artifact-review.js";
import {
  authorizeArtifactOperation,
  createControlPlaneSnapshot,
  parseControlPlaneConfig,
  resolveArtifactControlPlane
} from "../src/control-plane/index.js";
import type { RunState, SchemaWritingSnapshot } from "../src/run/store.js";
import {
  buildArtifactReviewNextActionPromptModel,
  buildArtifactReviewSummaryPromptModel,
  buildRunReviewVoteReceiptPromptModel
} from "../src/prompts/review.js";
import { renderPrompt } from "../src/prompts/renderer.js";

test("run start command rejects missing, blank, and control-character names", async () => {
  await assert.rejects(runStartCommand("procedure"), /run name is required/);
  await assert.rejects(runStartCommand("procedure", { name: "   " }), /run name is required/);
  await assert.rejects(
    runStartCommand("procedure", { name: "line one\nline two" }),
    /run name must not contain control characters/
  );
});

test("single-Run status shows the Run name and Procedure name with historical fallback", () => {
  const base: RunState = {
    contractVersion: 3,
    language: "en",
    id: "run-named",
    name: "Release candidate verification",
    status: "running",
    procedureName: "release-procedure",
    memoryRoot: "/memory",
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    stack: [{
      type: "procedure",
      memoryName: "release-procedure",
      steps: [{
        id: "flow[1]",
        kind: "action",
        instruction: "Verify the release.",
        artifact: "result",
        type: "string",
        format: { name: "plain", options: {} }
      }],
      index: 0
    }],
    events: [],
    procedureSnapshots: {}
  };
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    printRunOutput({ kind: "status", run: base });
    printRunOutput({
      kind: "status",
      run: { ...base, contractVersion: 2, id: "run-legacy", name: undefined }
    });
    printRunOutput({
      kind: "status",
      run: { ...base, id: "run-completed", status: "done", stack: [] }
    });
  } finally {
    console.log = originalLog;
  }

  const output = lines.join("\n");
  assert.match(output, /Run run-named\nName: Release candidate verification\nProcedure: release-procedure/);
  assert.match(output, /Run run-legacy\nName: release-procedure\nProcedure: release-procedure/);
  assert.match(output, /Run run-completed\nName: Release candidate verification\nProcedure: release-procedure/);
});

test("inline Artifact Review comments reject escaped multiline Markdown", () => {
  assert.doesNotThrow(() => validateInlineReviewCommentBody("A short comment about `\\n`."));
  assert.throws(
    () => validateInlineReviewCommentBody("First paragraph\\n\\nSecond paragraph"),
    /multiline Markdown must use --body-stdin/
  );
});

test("Artifact Review comments accept multiline Markdown from standard input", async () => {
  assert.equal(
    await resolveReviewCommentBody(
      { bodyStdin: true },
      Readable.from(["First paragraph\n", "\nSecond paragraph\n"])
    ),
    "First paragraph\n\nSecond paragraph\n"
  );
  await assert.rejects(
    resolveReviewCommentBody({ body: "inline", bodyStdin: true }, Readable.from([])),
    /use only one of --body, --body-file, or --body-stdin/
  );
});

test("Artifact Review comments accept multiline Markdown from a file", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-comment-"));
  const path = join(root, "comment.md");
  try {
    await writeFile(path, "First paragraph\n\nSecond paragraph\n", "utf8");
    assert.equal(
      await resolveReviewCommentBody({ bodyFile: path }, Readable.from([])),
      "First paragraph\n\nSecond paragraph\n"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
    name: "Inspection run",
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
  assert.equal(overview.name, "Inspection run");
  assert.equal(overview.procedureName, "CLI inspection");
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
    language: "en",
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
    printRunOutput({ kind: "status", run });
  } finally {
    console.log = originalLog;
  }

  const output = normalizeNewlines(lines.join("\n"));
  assert.match(output, /Procedure Asserts:\n- Keep the global contract active\./);
  assert.match(output, /Asserts:\n- Check this step\./);
  assert(output.indexOf("Procedure Asserts:") < output.indexOf("\nAsserts:"));
});

test("run start and status omit the redundant Agent actor and permission list", () => {
  const run: RunState = {
    contractVersion: 3,
    id: "run-default-language",
    status: "running",
    procedureName: "default-language",
    memoryRoot: "/memory",
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    stack: [{
      type: "procedure",
      memoryName: "default-language",
      steps: [{
        id: "flow[1]",
        kind: "action",
        instruction: "Produce the result.",
        actor: "agent",
        artifact: "result",
        type: "string",
        format: { name: "plain", options: {} }
      }],
      index: 0
    }],
    events: []
  };
  const originalLog = console.log;
  const originalLang = process.env.LANG;
  process.env.LANG = "en_US.UTF-8";
  try {
    for (const kind of ["start", "status"] as const) {
      const lines: string[] = [];
      console.log = (...values: unknown[]) => lines.push(values.join(" "));
      printRunOutput({ kind, run });
      const output = normalizeNewlines(lines.join("\n"));
      assert.match(output, /请执行：/);
      assert.match(output, /下一步：/);
      assert.doesNotMatch(output, /执行者：|可用权限：/);
      assert.doesNotMatch(output, /\nActor:\n|\nThen:\n|Available Permissions:/);
    }
  } finally {
    console.log = originalLog;
    if (originalLang === undefined) delete process.env.LANG;
    else process.env.LANG = originalLang;
  }
});

test("run current-step output keeps an explicit Human handoff", () => {
  const run: RunState = {
    contractVersion: 3,
    language: "zh-CN",
    id: "run-human-step",
    status: "running",
    procedureName: "human-step",
    memoryRoot: "/memory",
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    stack: [{
      type: "procedure",
      memoryName: "human-step",
      steps: [{
        id: "flow[1]",
        kind: "action",
        instruction: "确认是否接受结果。",
        actor: "human",
        artifact: "验收反馈",
        type: "string",
        format: { name: "plain", options: {} }
      }],
      index: 0
    }],
    events: []
  };
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    printRunOutput({ kind: "status", run });
  } finally {
    console.log = originalLog;
  }
  const output = normalizeNewlines(lines.join("\n"));
  assert.match(output, /请 Human 执行：\n确认是否接受结果。/);
  assert.match(output, /请上报 Human 提供的产物值。/);
  assert.doesNotMatch(output, /执行者：|可用权限：/);
});

test("run output presents Repeat as control without an Artifact", () => {
  const run: RunState = {
    contractVersion: 2,
    language: "en",
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
    printRunOutput({ kind: "status", run });
  } finally {
    console.log = originalLog;
  }

  const output = normalizeNewlines(lines.join("\n"));
  assert.match(output, /allowed count: 1\.\.3/);
  assert.match(output, /memsphere run repeat <count> --run run-repeat/);
  assert.doesNotMatch(output, /Artifact:/);
});

test("Schema field output shows production constraints and progress without permission guidance", () => {
  const parentStep: NonNullable<RunState["plan"]>[number] = {
    id: "flow[1]",
    kind: "action",
    instruction: "Produce the delivery.",
    artifact: "delivery",
    type: "object",
    format: { name: "markdown", options: { layout: "outline" } },
    schema: { kind: "inline", id: "Delivery", node: { tag: "!schema", names: ["Delivery"], defines: [] } },
    asserts: ["Keep the delivery coherent."]
  };
  const fieldStep: NonNullable<RunState["plan"]>[number] = {
    id: "schema:Delivery.summary",
    instruction: "Write Delivery.summary",
    artifact: "Delivery.summary",
    type: "string",
    format: { name: "markdown", options: {} },
    schemaContext: {
      rootName: "Delivery",
      path: "Delivery.summary",
      sources: [{
        path: "Delivery",
        type: "object",
        format: { name: "markdown", options: { layout: "outline" } },
        defines: ["A complete delivery."],
        asserts: ["Include every required section."],
        suggests: ["Keep the complete delivery concise."]
      }, {
        path: "Delivery.summary",
        type: "string",
        format: { name: "markdown", options: {} },
        defines: ["Summarize the delivery."],
        asserts: ["Describe the delivered result."],
        suggests: ["Use one sentence."]
      }]
    }
  };
  const run: RunState = {
    contractVersion: 3,
    language: "en",
    id: "run-schema-writing",
    status: "running",
    procedureName: "schema-writing",
    memoryRoot: "/memory",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    plan: [parentStep],
    stack: [
      { type: "procedure", memoryName: "schema-writing", steps: [parentStep], index: 0 },
      {
        type: "schema",
        memoryName: "Delivery",
        sourceStepId: "flow[1]",
        eventStartIndex: 0,
        steps: [fieldStep],
        index: 0
      }
    ],
    events: []
  };

  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    printRunOutput({ kind: "status", run, runsRoot: "/runs" });
  } finally {
    console.log = originalLog;
  }
  const output = normalizeNewlines(lines.join("\n"));
  assert.match(output, /Current Procedure Step:/);
  assert.match(output, /Schema Writing:/);
  assert.match(output, /current field: summary/);
  assert.match(output, /workflow: report each field to update one managed draft/);
  assert.match(output, /field contract: string · markdown/);
  assert.match(output, /Field Definition:\n- A complete delivery\.\n- Summarize the delivery\./);
  assert.match(output, /Field Asserts:\n- Include every required section\.\n- Describe the delivered result\./);
  assert.match(output, /Field Suggests:\n- Keep the complete delivery concise\.\n- Use one sentence\./);
  assert.match(output, /View the complete Schema:\nmemsphere run schema show --run run-schema-writing/);
  assert.doesNotMatch(output, /Delivery\.summary|constraint source/);
  assert.doesNotMatch(output, /Permission Guidance|Control Plane|Review/);
});

test("Schema root output uses a readable label instead of its internal node path", () => {
  const parentStep: NonNullable<RunState["plan"]>[number] = {
    id: "flow[1]",
    kind: "action",
    instruction: "按 Schema 编写功能说明。",
    artifact: "小型功能说明",
    type: "object",
    format: { name: "markdown", options: { layout: "outline" } },
    schema: {
      kind: "inline",
      id: "inline:flow[1]:artifact",
      node: { tag: "!schema", names: ["小型功能说明"], defines: [] }
    }
  };
  const rootStep: NonNullable<RunState["plan"]>[number] = {
    id: "schema:inline:flow[1]:artifact",
    instruction: "Write inline:flow[1]:artifact",
    artifact: "inline:flow[1]:artifact",
    type: "object",
    format: { name: "markdown", options: { layout: "outline" } },
    schemaContext: {
      rootName: "inline:flow[1]:artifact",
      path: "inline:flow[1]:artifact",
      sources: [{
        path: "inline:flow[1]:artifact",
        type: "object",
        format: { name: "markdown", options: { layout: "outline" } }
      }]
    }
  };
  const run: RunState = {
    contractVersion: 3,
    language: "zh-CN",
    id: "run-schema-root",
    status: "running",
    procedureName: "Schema 小型流程",
    memoryRoot: "/memory",
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    plan: [parentStep],
    stack: [
      { type: "procedure", memoryName: "Schema 小型流程", steps: [parentStep], index: 0 },
      {
        type: "schema",
        memoryName: "inline:flow[1]:artifact",
        sourceStepId: "flow[1]",
        eventStartIndex: 0,
        steps: [rootStep],
        index: 0
      }
    ],
    events: []
  };

  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    printRunOutput({ kind: "status", run, runsRoot: "/runs" });
  } finally {
    console.log = originalLog;
  }

  const output = normalizeNewlines(lines.join("\n"));
  assert.match(output, /当前字段：文档标题与概述/);
  assert.match(output, /工作方式：逐字段上报以更新同一份托管草稿/);
  assert.match(output, /请填写：\n文档标题与概述/);
  assert.doesNotMatch(output, /Write inline:flow\[1\]:artifact/);
});

test("Schema overview includes the parent production contract without Review control data", () => {
  const snapshot = {
    runId: "run-schema-overview",
    procedureName: "delivery-procedure",
    parentStepId: "flow[1]",
    action: {
      instruction: "Produce a complete delivery.",
      asserts: ["Keep the document coherent."],
      suggests: ["Prefer concise sections."]
    },
    artifact: {
      name: "delivery",
      type: "object",
      format: { name: "markdown", options: { layout: "outline" } },
      schema: {
        kind: "inline",
        id: "Delivery",
        node: { tag: "!schema", names: ["Delivery"], defines: [] }
      },
      final: true
    },
    progress: {
      completed: 0,
      total: 2,
      remaining: 2,
      pendingRepeatControls: 0,
      current: "Delivery",
      fields: [
        { id: "schema:Delivery", path: "Delivery", status: "current" },
        { id: "schema:Delivery.summary", path: "Delivery.summary", status: "remaining" }
      ]
    },
    currentField: {
      id: "schema:Delivery",
      path: "Delivery",
      type: "object",
      format: { name: "markdown", options: { layout: "outline" } },
      sources: []
    }
  } satisfies SchemaWritingSnapshot;

  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    printSchemaWritingOverview(snapshot);
  } finally {
    console.log = originalLog;
  }
  const output = normalizeNewlines(lines.join("\n"));
  assert.match(output, /action assert: Keep the document coherent\./);
  assert.match(output, /action suggest: Prefer concise sections\./);
  assert.match(output, /schema: Delivery/);
  assert.match(output, /final artifact: yes/);
  assert.match(output, /report each field to update one managed draft/);
  assert.doesNotMatch(output, /Review|Role Binding|Permission|Vote|Decision/);
});

test("Schema finalization output points to the managed draft and exact report command", () => {
  const parentStep: NonNullable<RunState["plan"]>[number] = {
    id: "flow[1]",
    instruction: "Produce the delivery.",
    artifact: "delivery",
    type: "object",
    format: { name: "markdown", options: { layout: "outline" } },
    schema: { kind: "inline", id: "Delivery", node: { tag: "!schema", names: ["Delivery"], defines: [] } }
  };
  const fieldStep: NonNullable<RunState["plan"]>[number] = {
    id: "schema:Delivery",
    instruction: "Write Delivery",
    artifact: "Delivery",
    type: "object",
    format: { name: "markdown", options: { layout: "outline" } }
  };
  const run: RunState = {
    contractVersion: 3,
    language: "en",
    id: "run-schema-final",
    status: "running",
    procedureName: "schema-final",
    memoryRoot: "/memory",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    plan: [parentStep],
    stack: [
      { type: "procedure", memoryName: "schema-final", steps: [parentStep], index: 0 },
      {
        type: "schema",
        memoryName: "Delivery",
        sourceStepId: "flow[1]",
        eventStartIndex: 0,
        steps: [fieldStep],
        index: 1
      }
    ],
    events: [],
    schemaDrafts: {
      "flow[1]": {
        stepId: "flow[1]",
        schemaName: "Delivery",
        status: "awaiting_finalization",
        path: "run-schema-final/artifacts/drafts/delivery.draft.md",
        fileName: "delivery.draft.md",
        contentType: "text/markdown",
        completed: 1,
        total: 1,
        validation: { status: "passed", correctable: false, issues: [] },
        updatedAt: "2026-07-22T00:00:00.000Z"
      }
    }
  };

  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    printRunOutput({ kind: "status", run, runsRoot: "/runs" });
  } finally {
    console.log = originalLog;
  }
  const output = normalizeNewlines(lines.join("\n"));
  assert.match(output, /Schema Finalization:/);
  const expectedDraftPath = resolve("/runs", "run-schema-final", "artifacts", "drafts", "delivery.draft.md");
  assert(output.includes(`managed draft: ${expectedDraftPath}`));
  assert.match(output, /contract validation: passed/);
  assert.match(output, /Read the complete managed draft, edit it directly as needed/);
  assert(output.includes("memsphere run report --run run-schema-final --artifact-file"));
  assert(output.includes(expectedDraftPath));
  assert.doesNotMatch(output, /Review|Permission Guidance/);
});

test("run current-step output does not expose effective runner permissions", () => {
  const snapshot = createControlPlaneSnapshot(parseControlPlaneConfig({
    runner: {
      permissions: ["artifact.read", "artifact.submit", "decision.decide"]
    },
    actors: {
      human: {
        kind: "human",
        name: "Reviewer",
        permissions: ["artifact.read"],
        system_prompt: "Review carefully."
      }
    }
  }));
  const controlPlane = resolveArtifactControlPlane({
    snapshot,
    slotBindings: { "governed::reviewer": { actorIds: ["human"], source: "run:governed::reviewer" } },
    artifactScope: "flow[1]",
    policyId: "artifact_acceptance.unanimous"
  });
  const run: RunState = {
    contractVersion: 3,
    language: "en",
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
    printRunOutput({ kind: "status", run });
  } finally {
    console.log = originalLog;
    if (originalLang === undefined) delete process.env.LANG;
    else process.env.LANG = originalLang;
  }

  const output = normalizeNewlines(lines.join("\n"));
  assert.match(output, /Do:\nProduce the result\./);
  assert.match(output, /Then:/);
  assert.doesNotMatch(
    output,
    /Actor:|Available Permissions:|artifact\.submit|Control Plane|runner permissions|governed::reviewer|revision|authority source/
  );
});

test("successful report output is a receipt followed by the completed state", () => {
  const snapshot = createControlPlaneSnapshot(parseControlPlaneConfig({
    runner: {
      permissions: ["artifact.read", "artifact.submit"]
    },
    actors: {}
  }));
  const controlPlane = resolveArtifactControlPlane({
    snapshot,
    slotBindings: {},
    artifactScope: "flow[1]",
    policyId: "artifact_acceptance.unanimous"
  });
  const decision = authorizeArtifactOperation({
    controlPlane,
    subject: { kind: "runner" },
    permission: "artifact.submit"
  });
  const run: RunState = {
    contractVersion: 3,
    language: "en",
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
    printRunOutput({ kind: "report", run });
  } finally {
    console.log = originalLog;
    if (originalLang === undefined) delete process.env.LANG;
    else process.env.LANG = originalLang;
  }

  const output = normalizeNewlines(lines.join("\n"));
  assert.match(output, /Report succeeded:\n- Run: run-report-guidance\n- Artifact: result/);
  assert.match(output, /Run run-report-guidance[\s\S]*Done/);
  assert.doesNotMatch(output, /Allowed:|Permission Guidance|grant:/);
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
      actorId: "advisor",
      actorName: "Advisor",
      slotIds: ["advisor"],
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
      actorId: "decider",
      actorName: "Decider",
      slotIds: ["decider"],
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
    console.log(renderPrompt(
      "run.review-summary",
      "en",
      buildArtifactReviewSummaryPromptModel(review, round, "en")
    ));
  } finally {
    console.log = originalLog;
  }

  const output = normalizeNewlines(lines.join("\n"));
  assert.match(output, /- submitted: 2\/2/);
  assert.match(output, /- Advisor \(advisory\)\n  - vote: request_changes/);
  assert.match(output, /comment \[unspecified\]: Clarify the conclusion/);
  assert.doesNotMatch(output, /- Runner \(/);
  assert.match(output, /unanimous approval was not reached: 1\/2 decision votes approved/);
  assert.match(output, /Conclusion:\n- This review round did not pass because unanimous approval was not reached; revise the Artifact/);
  assert.doesNotMatch(output, /Human submitted|; submitted;|formal votes|advisory votes|result:/);
});

test("Artifact Review output asks the Runner to decide after assigned reviews complete", () => {
  const snapshot = createControlPlaneSnapshot(parseControlPlaneConfig({
    runner: {
      permissions: ["artifact.read", "artifact.submit", "decision.decide"]
    },
    actors: {}
  }));
  const controlPlane = resolveArtifactControlPlane({
    snapshot,
    slotBindings: {},
    artifactScope: "flow[1]",
    policyId: "artifact_acceptance.unanimous",
    grantSource: "run:flow[1]"
  });
  const round: ArtifactReviewRound = {
    id: "round-2",
    sequence: 2,
    submissionId: "submission-2",
    status: "awaiting_runner_vote",
    revision: 4,
    createdAt: "2026-07-21T00:00:00.000Z",
    assignments: [{
      actorId: "advisor",
      actorName: "Advisor",
      slotIds: ["advisor"],
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
      actorId: "decider",
      actorName: "Decider",
      slotIds: ["decider"],
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
      subject: { kind: "actor", actorId: "advisor" },
      binding: "advisory",
      value: "request_changes",
      automatic: false,
      authorization: {} as never,
      submittedAt: "2026-07-21T00:01:00.000Z"
    }, {
      id: "vote-decider",
      subject: { kind: "actor", actorId: "decider" },
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
    console.log(renderPrompt(
      "run.review-summary",
      "en",
      buildArtifactReviewSummaryPromptModel(review, round, "en")
    ));
  } finally {
    console.log = originalLog;
  }

  const output = normalizeNewlines(lines.join("\n"));
  assert.match(output, /^Review opinions collected\. Review information:/);
  assert.doesNotMatch(output, /- Runner \(/);
  assert.match(output, /All assigned reviews are submitted: 1\/1 decision votes approved; 1 advisory vote was recorded/);
  assert.doesNotMatch(output, /Human review|Human decision/);
  assert.match(output, /All decision votes approved; only advisory reviewers requested changes\. You have final decision authority/);
  assert.match(output, /Review every opinion above, then cast your vote explicitly/);
  assert.doesNotMatch(output, /The Artifact has not been accepted and the Run has not advanced/);
  assert.doesNotMatch(output, /policy can still reach unanimous approval/);
  assert.doesNotMatch(output, /passed unanimously|Run advanced/);

  round.votes[0]!.value = "approve";
  const approvedAdvisoryOutput = renderPrompt(
    "run.review-summary",
    "en",
    buildArtifactReviewSummaryPromptModel(review, round, "en")
  );
  assert.match(approvedAdvisoryOutput, /All decision votes approved\. You have final decision authority/);
  assert.doesNotMatch(approvedAdvisoryOutput, /only advisory reviewers requested changes/);

  review.status = "awaiting_revision";
  round.status = "changes_requested";
  const voteOutput: string[] = [];
  console.log = (...values: unknown[]) => voteOutput.push(values.join(" "));
  try {
    printRunOutput({
      kind: "review_vote",
      run: {
        contractVersion: 3,
        language: "en",
        id: "run-vote-receipt",
        status: "running",
        procedureName: "reviewed",
        memoryRoot: "/memory",
        createdAt: "2026-07-21T00:00:00.000Z",
        updatedAt: "2026-07-21T00:02:00.000Z",
        stack: [{
          type: "procedure",
          memoryName: "reviewed",
          steps: [{
            id: "flow[1]",
            instruction: "Submit a candidate.",
            artifact: "candidate",
            type: "string",
            format: { name: "plain", options: {} }
          }],
          index: 0
        }],
        events: [],
        artifactReviews: [review]
      },
      review,
      round,
      vote: "request_changes"
    });
  } finally {
    console.log = originalLog;
  }
  const renderedVoteOutput = voteOutput.join("\n");
  assert.match(renderedVoteOutput, /^Vote submitted: request_changes/);
  assert.match(renderedVoteOutput, /Next, revise the Artifact according to the review opinions above/);
  assert.match(
    renderedVoteOutput,
    /memsphere run report --run run-vote-receipt --artifact <value> --revision-summary <text>/
  );
  assert.match(
    renderedVoteOutput,
    /memsphere run report --run run-vote-receipt --artifact-file <path> --revision-summary-file <path>/
  );
  assert.doesNotMatch(renderedVoteOutput, /Participants:|Advisor|Decider|Review information/);

  const approveReceipt = renderPrompt(
    "run.review-vote-receipt",
    "en",
    buildRunReviewVoteReceiptPromptModel("approve", "en")
  );
  assert.equal(approveReceipt, "Vote submitted: approve");
});

test("report output does not expose background reviewer failures", () => {
  const snapshot = createControlPlaneSnapshot(parseControlPlaneConfig({
    runner: {
      permissions: ["artifact.read"]
    },
    actors: {
      reviewer: {
        kind: "agent",
        name: "Reviewer",
        permissions: ["artifact.read", "decision.assess"],
        agent: { provider: "traex" }
      }
    }
  }));
  const controlPlane = resolveArtifactControlPlane({
    snapshot,
    slotBindings: { reviewer: { actorIds: ["reviewer"], source: "run:reviewer" } },
    artifactScope: "flow[1]",
    policyId: "artifact_acceptance.unanimous"
  });
  const round: ArtifactReviewRound = {
    id: "round-failed",
    sequence: 1,
    submissionId: "submission-failed",
    status: "pending",
    revision: 1,
    createdAt: "2026-07-25T00:00:00.000Z",
    assignments: [{
      id: "assignment-failed",
      actorId: "reviewer",
      actorName: "Reviewer",
      actorKind: "agent",
      slotIds: ["reviewer"],
      permissions: ["artifact.read", "decision.assess"],
      binding: "advisory",
      status: "failed",
      draft: { comments: [] },
      attempts: [{
        id: "attempt-failed",
        sequence: 1,
        status: "failed",
        provider: "traex",
        createdAt: "2026-07-25T00:00:00.000Z",
        completedAt: "2026-07-25T00:00:01.000Z",
        failure: {
          stage: "protocol",
          code: "acp_protocol_error",
          message: "ACP connection closed"
        }
      }]
    }],
    votes: []
  };
  const review: ArtifactReview<RunState["events"][number]["artifact"]> = {
    id: "review-failed",
    stepId: "flow[1]",
    artifactName: "candidate",
    policyId: "artifact_acceptance.unanimous",
    controlPlane,
    status: "pending",
    currentRoundId: round.id,
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:01.000Z",
    submissions: [],
    rounds: [round]
  };
  const capture = (): string => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => lines.push(values.join(" "));
    try {
      const run: RunState = {
        contractVersion: 3,
        language: "zh-CN",
        id: "run-report-failed-reviewer",
        status: "running",
        procedureName: "reviewed",
        memoryRoot: "/memory",
        createdAt: "2026-07-25T00:00:00.000Z",
        updatedAt: "2026-07-25T00:00:01.000Z",
        stack: [{
          type: "procedure",
          memoryName: "reviewed",
          steps: [{
            id: "flow[1]",
            instruction: "提交候选产物。",
            artifact: "candidate",
            type: "string",
            format: { name: "plain", options: {} }
          }],
          index: 0
        }],
        events: [],
        artifactReviews: [review]
      };
      printRunOutput({ kind: "report", run });
    } finally {
      console.log = originalLog;
    }
    return normalizeNewlines(lines.join("\n"));
  };

  const normal = capture();
  assert.match(normal, /上报成功：\n- Run：run-report-failed-reviewer\n- 产物：candidate/);
  assert.doesNotMatch(normal, /评审汇总|Agent 失败|Provider|ACP connection closed|Agent Assignment|重试/);
  assert.deepEqual(
    buildArtifactReviewNextActionPromptModel(review, round, "run-1"),
    { kind: "none" }
  );

});

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}
