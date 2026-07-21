import assert from "node:assert/strict";
import test from "node:test";
import { printLatestReportAuthorization, printRunState } from "../src/commands/run.js";
import {
  authorizeArtifactOperation,
  createControlPlaneSnapshot,
  parseControlPlaneConfig,
  resolveArtifactControlPlane
} from "../src/control-plane/index.js";
import type { RunState } from "../src/run/store.js";

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
