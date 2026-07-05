import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readAllMemoryFiles, type MemoryFile } from "../memory/store.js";
import type { ProcedureMemory, SchemaMemory } from "../memory/schema.js";

export const artifactFormats = ["string", "int", "boolean", "markdown", "json", "yaml", "schema"] as const;
export type ArtifactFormat = (typeof artifactFormats)[number];
export const stepActors = ["agent", "human"] as const;
export type StepActor = (typeof stepActors)[number];

export type RunStatus = "running" | "done";
export type FrameType = "procedure" | "schema";

export type ProcedureStep = {
  action: string;
  actor: StepActor;
  artifactName: string;
  format: ArtifactFormat;
  schemaName?: string;
};

export type RunFrame = {
  type: FrameType;
  memoryName: string;
  steps: RunStep[];
  index: number;
  returnTo?: string;
};

export type RunStep = {
  id: string;
  kind?: "action" | "branch" | "loop" | "call";
  instruction: string;
  actor?: StepActor;
  artifact?: string;
  format?: ArtifactFormat;
  schemaName?: string;
  details?: string[];
  target?: string;
  branches?: {
    truthy: RunStep[];
    falsy: RunStep[];
  };
  loop?: {
    body: RunStep[];
  };
};

export type RunEvent = {
  at: string;
  frame: FrameType;
  stepId: string;
  artifact: {
      name: string;
      format: ArtifactFormat;
      schemaName?: string;
      value: string;
  };
};

export type RunState = {
  id: string;
  status: RunStatus;
  procedureName: string;
  memoryRoot: string;
  createdAt: string;
  updatedAt: string;
  plan?: RunStep[];
  stack: RunFrame[];
  events: RunEvent[];
};

const runStepSchema: z.ZodType<RunStep> = z.lazy(() =>
  z.object({
    id: z.string(),
    kind: z.enum(["action", "branch", "loop", "call"]).optional(),
    instruction: z.string(),
    actor: z.enum(stepActors).optional(),
    artifact: z.string().optional(),
    format: z.enum(artifactFormats).optional(),
    schemaName: z.string().optional(),
    details: z.array(z.string()).optional(),
    target: z.string().optional(),
    branches: z.object({
      truthy: z.array(runStepSchema),
      falsy: z.array(runStepSchema)
    }).optional(),
    loop: z.object({
      body: z.array(runStepSchema)
    }).optional()
  })
);

const runStateSchema: z.ZodType<RunState> = z.object({
  id: z.string(),
  status: z.enum(["running", "done"]),
  procedureName: z.string(),
  memoryRoot: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  plan: z.array(runStepSchema).optional(),
  stack: z.array(z.object({
    type: z.enum(["procedure", "schema"]),
    memoryName: z.string(),
    steps: z.array(runStepSchema),
    index: z.number(),
    returnTo: z.string().optional()
  })),
  events: z.array(z.object({
    at: z.string(),
    frame: z.enum(["procedure", "schema"]),
    stepId: z.string(),
    artifact: z.object({
      name: z.string(),
      format: z.enum(artifactFormats),
      schemaName: z.string().optional(),
      value: z.string()
    })
  }))
});

export async function ensureRunDirectory(runsRoot: string): Promise<string> {
  await mkdir(runsRoot, { recursive: true });
  return runsRoot;
}

export async function startRun(input: { memoryRoot: string; runsRoot: string; procedureName: string }): Promise<RunState> {
  await ensureRunDirectory(input.runsRoot);
  const procedure = await findMemoryByName(input.memoryRoot, "procedures", input.procedureName);
  if (!procedure) {
    throw new Error(`procedure not found: ${input.procedureName}`);
  }

  const steps = compileProcedureSteps(procedure.entity as ProcedureMemory);
  if (!steps.length) {
    throw new Error(`procedure has no flow steps: ${input.procedureName}`);
  }

  const now = new Date().toISOString();
  const run: RunState = {
    id: makeRunId(now),
    status: "running",
    procedureName: procedure.entity.names[0],
    memoryRoot: input.memoryRoot,
    createdAt: now,
    updatedAt: now,
    plan: cloneSteps(steps),
    stack: [{
      type: "procedure",
      memoryName: procedure.entity.names[0],
      steps,
      index: 0
    }],
    events: []
  };

  await expandAutoCallSteps(input.memoryRoot, run);
  await writeRun(input.runsRoot, run);
  return run;
}

export async function readRun(runsRoot: string, id: string): Promise<RunState> {
  const raw = await readFile(runPath(runsRoot, id), "utf8");
  return runStateSchema.parse(JSON.parse(raw));
}

export async function listRuns(runsRoot: string): Promise<RunState[]> {
  await ensureRunDirectory(runsRoot);
  const entries = await readdir(runsRoot, { withFileTypes: true });
  const runs: RunState[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    runs.push(await readRun(runsRoot, entry.name.slice(0, -".json".length)));
  }
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function reportRun(input: { runsRoot: string; runId: string; artifactValue: string }): Promise<RunState> {
  const run = await readRun(input.runsRoot, input.runId);
  if (run.status === "done") {
    throw new Error(`run is already done: ${input.runId}`);
  }

  const frame = currentFrame(run);
  const step = currentStep(run);
  if (!frame || !step || !step.artifact || !step.format) {
    run.status = "done";
    run.updatedAt = new Date().toISOString();
    await writeRun(input.runsRoot, run);
    throw new Error(`run has no current step: ${input.runId}`);
  }

  run.events.push({
    at: new Date().toISOString(),
    frame: frame.type,
    stepId: step.id,
    artifact: {
      name: step.artifact,
      format: step.format,
      schemaName: step.schemaName,
      value: input.artifactValue
    }
  });

  frame.index += 1;
  applyControlStep(frame, step, input.artifactValue);
  collapseCompletedFrames(run);
  await expandAutoCallSteps(run.memoryRoot, run);
  run.updatedAt = new Date().toISOString();
  await writeRun(input.runsRoot, run);
  return run;
}

export async function enterSchema(input: { memoryRoot: string; runsRoot: string; runId: string; schemaName: string }): Promise<RunState> {
  const run = await readRun(input.runsRoot, input.runId);
  if (run.status === "done") {
    throw new Error(`run is already done: ${input.runId}`);
  }

  const schema = await findMemoryByName(input.memoryRoot, "schemas", input.schemaName);
  if (!schema) {
    throw new Error(`schema not found: ${input.schemaName}`);
  }

  const steps = compileSchemaSteps(schema.entity as SchemaMemory);
  if (!steps.length) {
    throw new Error(`schema has no executable fields: ${input.schemaName}`);
  }

  run.stack.push({
    type: "schema",
    memoryName: schema.entity.names[0],
    steps,
    index: 0
  });
  run.updatedAt = new Date().toISOString();
  await writeRun(input.runsRoot, run);
  return run;
}

export function currentStep(run: RunState): RunStep | undefined {
  const frame = currentFrame(run);
  return frame ? frame.steps[frame.index] : undefined;
}

export function currentFrame(run: RunState): RunFrame | undefined {
  return run.stack.at(-1);
}

function collapseCompletedFrames(run: RunState): void {
  while (run.stack.length > 0) {
    const frame = currentFrame(run);
    if (!frame || frame.index < frame.steps.length) break;
    const completed = run.stack.pop();
    const parent = currentFrame(run);
    const parentStep = parent ? parent.steps[parent.index] : undefined;
    if (
      completed?.type === "schema" &&
      parent &&
      parentStep &&
      parentStep.artifact &&
      parentStep.format === "schema" &&
      (parentStep.schemaName ?? parentStep.artifact) === completed.memoryName
    ) {
      run.events.push({
        at: new Date().toISOString(),
        frame: parent.type,
        stepId: parentStep.id,
        artifact: {
          name: parentStep.artifact,
          format: parentStep.format,
          schemaName: parentStep.schemaName,
          value: `schema:${completed.memoryName}`
        }
      });
      parent.index += 1;
    }
  }
  if (run.stack.length === 0) {
    run.status = "done";
  }
}

function compileProcedureSteps(procedure: ProcedureMemory): RunStep[] {
  return compileFlowSteps(procedure.flow, "flow");
}

function compileFlowSteps(flow: unknown[], prefix: string): RunStep[] {
  return flow.map((raw, index) => compileFlowStep(raw, `${prefix}[${index + 1}]`, index + 1));
}

function compileFlowStep(raw: unknown, id: string, position: number): RunStep {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    if (record.tag === "!if") {
      return compileIfStep(record, id, position);
    }

    if (record.tag === "!while") {
      return compileWhileStep(record, id, position);
    }

    if (record.tag === "!call") {
      const target = typeof record.target === "string" ? record.target.trim() : typeof record.value === "string" ? record.value.trim() : "";
      if (!target) throw new Error(`flow[${position}].target is required`);
      return {
        id,
        kind: "call",
        instruction: `Call ${target}`,
        target
      };
    }

    if (record.branch !== undefined) {
      const step = normalizeProcedureStep(record.branch, `${position}.branch`);
      const truthy = compileFlowSteps(readStepArray(record.when_true, `${id}.when_true`), `${id}.when_true`);
      const falsy = compileFlowSteps(readStepArray(record.when_false, `${id}.when_false`), `${id}.when_false`);
      return {
        id,
        kind: "branch",
        instruction: step.action,
        actor: step.actor,
        artifact: step.artifactName,
        format: step.format,
        schemaName: step.schemaName,
        details: describeControlTargets("true", truthy).concat(describeControlTargets("false", falsy)),
        branches: { truthy, falsy }
      };
    }

    if (record.loop !== undefined) {
      const step = normalizeProcedureStep(record.loop, `${position}.loop`);
      const body = compileFlowSteps(readStepArray(record.while_true, `${id}.while_true`), `${id}.while_true`);
      return {
        id,
        kind: "loop",
        instruction: step.action,
        actor: step.actor,
        artifact: step.artifactName,
        format: step.format,
        schemaName: step.schemaName,
        details: describeControlTargets("while true", body).concat(["false: continue after loop"]),
        loop: { body }
      };
    }
  }

  const step = normalizeProcedureStep(raw, position);
  return {
    id,
    kind: "action",
    instruction: step.action,
    actor: step.actor,
    artifact: step.artifactName,
    format: step.format,
    schemaName: step.schemaName
  };
}

function compileIfStep(record: Record<string, unknown>, id: string, position: number | string): RunStep {
  const condition = normalizeProcedureStep(record.condition, `${position}.condition`);
  if (condition.format !== "boolean") {
    throw new Error(`flow[${position}].condition.format must be boolean`);
  }
  const thenSteps = compileFlowSteps(readRequiredStepArray(record.then, `${id}.then`), `${id}.then`);
  const elseSteps = compileElseSteps(record, id, position);
  return {
    id,
    kind: "branch",
    instruction: condition.action,
    actor: condition.actor,
    artifact: condition.artifactName,
    format: condition.format,
    schemaName: condition.schemaName,
    details: describeControlTargets("true", thenSteps).concat(describeControlTargets("false", elseSteps)),
    branches: { truthy: thenSteps, falsy: elseSteps }
  };
}

function compileElseSteps(record: Record<string, unknown>, id: string, position: number | string): RunStep[] {
  const elseif = record.elseif;
  if (elseif !== undefined) {
    if (!Array.isArray(elseif)) throw new Error(`flow[${position}].elseif must be an array`);
    if (elseif.length > 0) {
      const [head, ...tail] = elseif;
      if (!head || typeof head !== "object" || Array.isArray(head)) {
        throw new Error(`flow[${position}].elseif[1] must be an object`);
      }
      const nestedRecord = {
        tag: "!if",
        ...(head as Record<string, unknown>),
        elseif: tail.length ? tail : undefined,
        else: tail.length ? record.else : (head as Record<string, unknown>).else ?? record.else
      };
      return [compileIfStep(nestedRecord, `${id}.elseif[1]`, `${position}.elseif[1]`)];
    }
  }
  return readStepArray(record.else, `${id}.else`).length
    ? compileFlowSteps(readStepArray(record.else, `${id}.else`), `${id}.else`)
    : [];
}

function compileWhileStep(record: Record<string, unknown>, id: string, position: number | string): RunStep {
  const condition = normalizeProcedureStep(record.condition, `${position}.condition`);
  if (condition.format !== "boolean") {
    throw new Error(`flow[${position}].condition.format must be boolean`);
  }
  const body = compileFlowSteps(readRequiredStepArray(record.do, `${id}.do`), `${id}.do`);
  return {
    id,
    kind: "loop",
    instruction: condition.action,
    actor: condition.actor,
    artifact: condition.artifactName,
    format: condition.format,
    schemaName: condition.schemaName,
    details: describeControlTargets("while true", body).concat(["false: continue after loop"]),
    loop: { body }
  };
}

function normalizeProcedureStep(raw: unknown, position: number | string): ProcedureStep {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`flow[${position}] must be an object with action, artifact, and format`);
  }

  const record = raw as Record<string, unknown>;
  if (typeof record.tag === "string" && record.tag.startsWith("!")) {
    throw new Error(`flow[${position}] must be an object with action, artifact, and format`);
  }
  const action = typeof record.action === "string" ? record.action.trim() : "";
  const actor = readStepActor(record.actor, position);
  const artifact = readArtifactSpec(record.artifact, position);

  if (!action) throw new Error(`flow[${position}].action is required`);

  return {
    action,
    actor,
    artifactName: artifact.name,
    format: artifact.format,
    schemaName: artifact.schema
  };
}

function readStepActor(value: unknown, position: number | string): StepActor {
  if (value === undefined) return "agent";
  if (typeof value === "string" && (stepActors as readonly string[]).includes(value)) {
    return value as StepActor;
  }
  throw new Error(`flow[${position}].actor must be one of: ${stepActors.join(", ")}`);
}

function readArtifactSpec(value: unknown, position: number | string): { name: string; format: ArtifactFormat; schema?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`flow[${position}].artifact must be an object with name and format`);
  }

  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const format = typeof record.format === "string" && isArtifactFormat(record.format) ? record.format : undefined;
  const schema = typeof record.schema === "string" ? record.schema.trim() : undefined;

  if (!name) throw new Error(`flow[${position}].artifact.name is required`);
  if (!format) throw new Error(`flow[${position}].artifact.format is required and must be one of: ${artifactFormats.join(", ")}`);
  if (format === "schema" && !schema) throw new Error(`flow[${position}].artifact.schema is required when format is schema`);

  return { name, format, schema };
}

function readStepArray(value: unknown, path: string): unknown[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  throw new Error(`${path} must be an array`);
}

function readRequiredStepArray(value: unknown, path: string): unknown[] {
  const steps = readStepArray(value, path);
  if (!steps.length) throw new Error(`${path} must contain at least one step`);
  return steps;
}

function describeControlTargets(label: string, steps: RunStep[]): string[] {
  if (!steps.length) return [`${label}: no steps`];
  return [`${label}: ${steps.map((step) => step.artifact ?? step.target ?? step.id).join(", ")}`];
}

function applyControlStep(frame: RunFrame, step: RunStep, artifactValue: string): void {
  if (step.kind === "branch" && step.branches) {
    const selected = parseBooleanArtifact(artifactValue) ? step.branches.truthy : step.branches.falsy;
    frame.steps.splice(frame.index, 0, ...cloneSteps(selected));
    return;
  }

  if (step.kind === "loop" && step.loop && parseBooleanArtifact(artifactValue)) {
    frame.steps.splice(frame.index, 0, ...cloneSteps(step.loop.body), cloneStep(step));
  }
}

function parseBooleanArtifact(value: string): boolean {
  return ["true", "yes", "y", "1", "继续", "是"].includes(value.trim().toLowerCase());
}

function cloneSteps(steps: RunStep[]): RunStep[] {
  return steps.map(cloneStep);
}

function cloneStep(step: RunStep): RunStep {
  return {
    ...step,
    details: step.details ? [...step.details] : undefined,
    branches: step.branches
      ? {
          truthy: cloneSteps(step.branches.truthy),
          falsy: cloneSteps(step.branches.falsy)
        }
      : undefined,
    loop: step.loop ? { body: cloneSteps(step.loop.body) } : undefined
  };
}

async function expandAutoCallSteps(memoryRoot: string, run: RunState): Promise<void> {
  let guard = 0;
  while (run.status !== "done") {
    if (guard++ > 20) throw new Error("too many nested !call steps");
    const frame = currentFrame(run);
    const step = currentStep(run);
    if (!frame || !step || step.kind !== "call") return;
    if (!step.target) throw new Error(`${step.id}.target is required`);
    frame.index += 1;
    const procedure = await findMemoryByName(memoryRoot, "procedures", step.target);
    if (!procedure) throw new Error(`procedure not found: ${step.target}`);
    run.stack.push({
      type: "procedure",
      memoryName: procedure.entity.names[0],
      steps: compileProcedureSteps(procedure.entity as ProcedureMemory),
      index: 0,
      returnTo: step.id
    });
  }
}

function compileSchemaSteps(schema: SchemaMemory): RunStep[] {
  const steps: RunStep[] = [];
  walkSchema(schema, schema.names[0], steps);
  return steps;
}

function walkSchema(node: SchemaMemory, path: string, steps: RunStep[]): void {
  steps.push({
    id: `schema:${path}`,
    instruction: `Write ${path}`,
    actor: "agent",
    artifact: path,
    format: schemaFormatToArtifactFormat(node.format),
    details: [
      ...node.defines.map((value) => `defines: ${value}`),
      ...(node.asserts ?? []).map((value) => `asserts: ${value}`)
    ]
  });

  for (const child of node.fields ?? []) {
    walkSchema(child, `${path}.${child.names[0]}`, steps);
  }
}

function schemaFormatToArtifactFormat(format: SchemaMemory["format"]): ArtifactFormat {
  if (format === "table" || format === "template") return "markdown";
  if (format === "list") return "markdown";
  return "string";
}

async function findMemoryByName(memoryRoot: string, kind: "procedures" | "schemas", name: string): Promise<MemoryFile | undefined> {
  const files = await readAllMemoryFiles(memoryRoot, kind);
  return files.find((file) => file.entity.names.includes(name));
}

function isArtifactFormat(value: string): value is ArtifactFormat {
  return (artifactFormats as readonly string[]).includes(value);
}

function runPath(runsRoot: string, id: string): string {
  return join(runsRoot, `${id}.json`);
}

async function writeRun(runsRoot: string, run: RunState): Promise<void> {
  await ensureRunDirectory(runsRoot);
  await writeFile(runPath(runsRoot, run.id), `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

function makeRunId(iso: string): string {
  const stamp = iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-").toLowerCase();
  return `run-${stamp}-${randomUUID().slice(0, 8)}`;
}
