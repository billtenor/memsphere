import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import {
  ArtifactValidationFailure,
  type ArtifactReportSource,
  type ArtifactValidationPlan,
  type ArtifactValidatorRegistration,
  type ArtifactValidationResult,
  type CompiledArtifactContract,
  type PreparedArtifactCandidate,
  compileArtifactContract,
  createBuiltInArtifactValidatorRegistry,
  prepareArtifactCandidate
} from "../artifact-validation.js";
import { listMemoryFiles, readMemoryFile, type MemoryFile } from "../memory/store.js";
import { currentMemorySyntax, type MemorySyntaxVersion } from "../memory/syntax.js";
import { inheritSchemaFormat, resolveSchemaContract } from "../memory/schema.js";
import {
  builtInArtifactFormats,
  stepActors,
  type ActionNode,
  type ArtifactFormatSpec,
  type DefinitionPart,
  type FlowNode,
  type IfNode,
  type MemoryRefNode,
  type ProcedureMemory,
  schemaNodeFromMemory,
  type RepeatNode,
  type SchemaMemory,
  type SchemaNode,
  type StaticSchemaField,
  type StatementNode,
  type StepActor,
  type WhileNode
} from "../memory/ast.js";

export { builtInArtifactFormats, stepActors };
export type { ArtifactFormatSpec, ArtifactReportSource, StepActor };

const artifactValidatorRegistry = createBuiltInArtifactValidatorRegistry();

export function registerArtifactValidator(registration: ArtifactValidatorRegistration): void {
  artifactValidatorRegistry.register(registration);
}

export type RunStatus = "running" | "done";
export type FrameType = "procedure" | "schema";

export type RunFrame = {
  type: FrameType;
  memoryName: string;
  asserts?: string[];
  steps: RunStep[];
  index: number;
  returnTo?: string;
  sourceStepId?: string;
  eventStartIndex?: number;
};

export type RunStep = {
  id: string;
  kind?: "action" | "branch" | "loop" | "call" | "repeat";
  instruction: string;
  actor?: StepActor;
  artifact?: string;
  type?: string;
  format?: ArtifactFormatSpec;
  schema?: RunSchemaContract;
  validationPlan?: ArtifactValidationPlan;
  final?: boolean;
  optional?: boolean;
  asserts?: string[];
  suggests?: string[];
  details?: string[];
  target?: string;
  branches?: {
    truthy: RunStep[];
    falsy: RunStep[];
  };
  loop?: {
    body: RunStep[];
  };
  repeat?: {
    parentPath: string;
    fieldIndex: number;
    body: StaticSchemaField[];
    min: number;
    max?: number;
  };
};

export type RunSchemaContract =
  | { kind: "external"; name: string; node?: SchemaNode }
  | { kind: "inline"; id: string; node: SchemaNode };

export type RunEvent = {
  at: string;
  frame: FrameType;
  stepId: string;
  artifact: {
      name: string;
      type: string;
      format: ArtifactFormatSpec;
      fields?: Record<string, unknown>;
      schema?: RunSchemaContract;
      validation?: ArtifactValidationResult;
      final?: boolean;
      storage?: "inline" | "file";
      value?: unknown;
      path?: string;
      fileName?: string;
      contentType?: string;
  };
};

export type RunState = {
  contractVersion: 1 | 2;
  readOnly?: boolean;
  memorySyntax?: MemorySyntaxVersion;
  id: string;
  status: RunStatus;
  procedureName: string;
  asserts?: string[];
  memoryRoot: string;
  createdAt: string;
  updatedAt: string;
  plan?: RunStep[];
  stack: RunFrame[];
  events: RunEvent[];
};

const artifactFormatSpecSchema = z.object({
  name: z.string().min(1),
  options: z.record(z.unknown())
}).strict();

const runSchemaContractSchema: z.ZodType<RunSchemaContract> = z.union([
  z.object({ kind: z.literal("external"), name: z.string(), node: z.custom<SchemaNode>().optional() }).strict(),
  z.object({ kind: z.literal("inline"), id: z.string(), node: z.custom<SchemaNode>() }).strict()
]);

const validationPlanEntrySchema = z.object({
  id: z.string(),
  version: z.string(),
  stage: z.enum(["type", "format", "schema"]),
  target: z.string(),
  contractPath: z.string().optional()
}).strict();

const validationResultSchema: z.ZodType<ArtifactValidationResult> = z.object({
  status: z.enum(["passed", "failed", "unsupported"]),
  correctable: z.boolean(),
  issues: z.array(z.object({
    code: z.string(),
    stage: z.enum(["type", "format", "schema"]),
    validatorId: z.string(),
    artifactPath: z.string(),
    contractPath: z.string().optional(),
    fieldPath: z.string().optional(),
    actual: z.unknown().optional(),
    expected: z.unknown().optional(),
    message: z.string()
  }))
});

const runStepSchema: z.ZodType<RunStep> = z.lazy(() =>
  z.object({
    id: z.string(),
    kind: z.enum(["action", "branch", "loop", "call", "repeat"]).optional(),
    instruction: z.string(),
    actor: z.enum(stepActors).optional(),
    artifact: z.string().optional(),
    type: z.string().optional(),
    format: artifactFormatSpecSchema.optional(),
    schema: runSchemaContractSchema.optional(),
    validationPlan: z.array(validationPlanEntrySchema).optional(),
    final: z.boolean().optional(),
    optional: z.boolean().optional(),
    asserts: z.array(z.string()).optional(),
    suggests: z.array(z.string()).optional(),
    details: z.array(z.string()).optional(),
    target: z.string().optional(),
    branches: z.object({
      truthy: z.array(runStepSchema),
      falsy: z.array(runStepSchema)
    }).optional(),
    loop: z.object({
      body: z.array(runStepSchema)
    }).optional(),
    repeat: z.object({
      parentPath: z.string(),
      fieldIndex: z.number().int().nonnegative(),
      body: z.custom<StaticSchemaField[]>(),
      min: z.number().int().nonnegative(),
      max: z.number().int().nonnegative().optional()
    }).optional()
  })
);

const runStateSchema: z.ZodType<RunState> = z.object({
  contractVersion: z.literal(2),
  readOnly: z.boolean().optional(),
  memorySyntax: z.string().optional(),
  id: z.string(),
  status: z.enum(["running", "done"]),
  procedureName: z.string(),
  asserts: z.array(z.string()).optional(),
  memoryRoot: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  plan: z.array(runStepSchema).optional(),
  stack: z.array(z.object({
    type: z.enum(["procedure", "schema"]),
    memoryName: z.string(),
    asserts: z.array(z.string()).optional(),
    steps: z.array(runStepSchema),
    index: z.number(),
    returnTo: z.string().optional(),
    sourceStepId: z.string().optional(),
    eventStartIndex: z.number().int().nonnegative().optional()
  })),
  events: z.array(z.object({
    at: z.string(),
    frame: z.enum(["procedure", "schema"]),
    stepId: z.string(),
    artifact: z.object({
      name: z.string(),
      type: z.string(),
      format: artifactFormatSpecSchema,
      fields: z.record(z.unknown()).optional(),
      schema: runSchemaContractSchema.optional(),
      validation: validationResultSchema.optional(),
      final: z.boolean().optional(),
      storage: z.enum(["inline", "file"]).optional(),
      value: z.unknown().optional(),
      path: z.string().optional(),
      fileName: z.string().optional(),
      contentType: z.string().optional()
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

  const procedureMemory = procedure.entity as ProcedureMemory;
  const steps = compileProcedureSteps(procedureMemory);
  await snapshotExternalSchemas(input.memoryRoot, steps);
  if (!steps.length) {
    throw new Error(`procedure has no flow steps: ${input.procedureName}`);
  }

  const now = new Date().toISOString();
  const run: RunState = {
    contractVersion: 2,
    memorySyntax: procedure.entity.syntax,
    id: makeRunId(now),
    status: "running",
    procedureName: procedure.entity.names[0],
    asserts: procedureMemory.asserts ? [...procedureMemory.asserts] : undefined,
    memoryRoot: input.memoryRoot,
    createdAt: now,
    updatedAt: now,
    plan: cloneSteps(steps),
    stack: [{
      type: "procedure",
      memoryName: procedure.entity.names[0],
      asserts: procedureMemory.asserts ? [...procedureMemory.asserts] : undefined,
      steps,
      index: 0
    }],
    events: []
  };

  await expandAutoCallSteps(run);
  await writeRun(input.runsRoot, run);
  return run;
}

export async function readRun(runsRoot: string, id: string): Promise<RunState> {
  const raw = await readFile(await existingRunPath(runsRoot, id), "utf8");
  return parseRunState(JSON.parse(raw));
}

export function parseRunState(parsed: unknown): RunState {
  if (parsed && typeof parsed === "object" && (parsed as { contractVersion?: unknown }).contractVersion === 2) {
    return runStateSchema.parse(parsed);
  }
  return normalizeLegacyRun(parsed);
}

export async function listRuns(runsRoot: string): Promise<RunState[]> {
  await ensureRunDirectory(runsRoot);
  const entries = await readdir(runsRoot, { withFileTypes: true });
  const runsById = new Map<string, RunState>();
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const id = entry.name;
      try {
        const run = await readRun(runsRoot, id);
        runsById.set(run.id, run);
      } catch {
        // Ignore directories that are not run roots.
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      const id = entry.name.slice(0, -".json".length);
      if (!runsById.has(id)) runsById.set(id, await readRun(runsRoot, id));
    }
  }
  const runs = [...runsById.values()];
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function reportRun(input: { runsRoot: string; runId: string; artifact: ArtifactReportSource }): Promise<RunState> {
  return withRunWriteLock(input.runsRoot, input.runId, () => reportRunUnlocked(input));
}

async function reportRunUnlocked(input: { runsRoot: string; runId: string; artifact: ArtifactReportSource }): Promise<RunState> {
  const run = await readRun(input.runsRoot, input.runId);
  if (run.contractVersion === 1 || run.readOnly) {
    throw new Error(`v1 run is read-only and cannot report after the Artifact Contract v2 upgrade: ${input.runId}`);
  }
  if (run.status === "done") {
    throw new Error(`run is already done: ${input.runId}`);
  }

  const frame = currentFrame(run);
  const step = currentStep(run);
  if (step?.kind === "repeat") {
    throw new Error(`current step is Repeat control; use memsphere run repeat <count> --run ${input.runId}`);
  }
  if (!frame || !step || !step.artifact || !step.format) {
    run.status = "done";
    run.updatedAt = new Date().toISOString();
    await writeRun(input.runsRoot, run);
    throw new Error(`run has no current step: ${input.runId}`);
  }

  const contract = await contractForStep(run, step);
  const context = {
    runId: run.id,
    stepId: step.id,
    artifactPath: step.id,
    attemptId: randomUUID()
  };
  const candidate = await prepareArtifactCandidate(contract, input.artifact, context);
  const plan = step.validationPlan ?? artifactValidatorRegistry.resolvePlan(contract);
  const validation = await artifactValidatorRegistry.execute(plan, { contract, candidate, context });
  if (validation.status !== "passed") throw new ArtifactValidationFailure(validation);

  const createdArtifactFiles: string[] = [];
  try {
    const artifact = await buildRunEventArtifact(
      input.runsRoot,
      run,
      step,
      candidate,
      validation,
      createdArtifactFiles
    );
    const controlValue = step.kind === "branch" || step.kind === "loop" ? candidate.representation.value : undefined;

    run.events.push({
      at: new Date().toISOString(),
      frame: frame.type,
      stepId: step.id,
      artifact
    });

    frame.index += 1;
    applyControlStep(frame, step, controlValue);
    await collapseCompletedFrames(input.runsRoot, run, createdArtifactFiles);
    await expandAutoCallSteps(run);
    run.updatedAt = new Date().toISOString();
    await writeRun(input.runsRoot, run);
    return run;
  } catch (error) {
    await removeArtifactFiles(createdArtifactFiles);
    throw error;
  }
}

export async function repeatRun(input: { runsRoot: string; runId: string; count: number }): Promise<RunState> {
  return withRunWriteLock(input.runsRoot, input.runId, () => repeatRunUnlocked(input));
}

export async function skipRun(input: { runsRoot: string; runId: string }): Promise<RunState> {
  return withRunWriteLock(input.runsRoot, input.runId, () => skipRunUnlocked(input));
}

async function skipRunUnlocked(input: { runsRoot: string; runId: string }): Promise<RunState> {
  const run = await readRun(input.runsRoot, input.runId);
  if (run.contractVersion === 1 || run.readOnly) {
    throw new Error(`v1 run is read-only and cannot skip after the Artifact Contract v2 upgrade: ${input.runId}`);
  }
  if (run.status === "done") throw new Error(`run is already done: ${input.runId}`);

  const frame = currentFrame(run);
  const step = currentStep(run);
  if (step?.kind === "repeat") {
    throw new Error(`current step is Repeat control; use memsphere run repeat <count> --run ${input.runId}`);
  }
  if (!frame || !step || !step.artifact || !step.type || !step.format) {
    throw new Error(`run has no skippable current step: ${input.runId}`);
  }
  if (step.optional !== true) {
    throw new Error(`current step is required and cannot be skipped: ${step.id}`);
  }

  run.events.push({
    at: new Date().toISOString(),
    frame: frame.type,
    stepId: step.id,
    artifact: {
      name: step.artifact,
      type: step.type,
      format: step.format,
      fields: { skipped: true },
      schema: step.schema,
      storage: "inline",
      value: ""
    }
  });

  frame.index += 1;
  await collapseCompletedFrames(input.runsRoot, run);
  await expandAutoCallSteps(run);
  run.updatedAt = new Date().toISOString();
  await writeRun(input.runsRoot, run);
  return run;
}

async function repeatRunUnlocked(input: { runsRoot: string; runId: string; count: number }): Promise<RunState> {
  const run = await readRun(input.runsRoot, input.runId);
  if (run.contractVersion === 1 || run.readOnly) {
    throw new Error(`v1 run is read-only and cannot continue after the Artifact Contract v2 upgrade: ${input.runId}`);
  }
  if (run.status === "done") {
    throw new Error(`run is already done: ${input.runId}`);
  }

  const frame = currentFrame(run);
  const step = currentStep(run);
  if (!frame || step?.kind !== "repeat" || !step.repeat) {
    throw new Error(`current step is not Repeat control: ${input.runId}`);
  }
  if (!Number.isSafeInteger(input.count) || input.count < 0) {
    throw new Error("repeat count must be a non-negative integer");
  }
  if (input.count < step.repeat.min) {
    throw new Error(`repeat count must be at least ${step.repeat.min}`);
  }
  if (step.repeat.max !== undefined && input.count > step.repeat.max) {
    throw new Error(`repeat count must be at most ${step.repeat.max}`);
  }

  const createdArtifactFiles: string[] = [];
  try {
    const expanded = compileRepeatBody(step.repeat, input.count);
    frame.steps.splice(frame.index, 1, ...expanded);
    await collapseCompletedFrames(input.runsRoot, run, createdArtifactFiles);
    await expandAutoCallSteps(run);
    run.updatedAt = new Date().toISOString();
    await writeRun(input.runsRoot, run);
    return run;
  } catch (error) {
    await removeArtifactFiles(createdArtifactFiles);
    throw error;
  }
}

export function artifactInlineValue(artifact: RunEvent["artifact"]): unknown {
  if (artifact.storage === "file") {
    throw new Error(`artifact is stored as file and has no inline value: ${artifact.name}`);
  }
  return artifact.value ?? "";
}

export function artifactSchemaName(artifact: RunEvent["artifact"]): string | undefined {
  return artifact.schema?.kind === "external" ? artifact.schema.name : undefined;
}

export async function enterSchema(input: { memoryRoot: string; runsRoot: string; runId: string; schemaName?: string }): Promise<RunState> {
  return withRunWriteLock(input.runsRoot, input.runId, () => enterSchemaUnlocked(input));
}

async function enterSchemaUnlocked(input: { memoryRoot: string; runsRoot: string; runId: string; schemaName?: string }): Promise<RunState> {
  const run = await readRun(input.runsRoot, input.runId);
  if (run.contractVersion === 1 || run.readOnly) {
    throw new Error(`v1 run is read-only and cannot enter schema after the Artifact Contract v2 upgrade: ${input.runId}`);
  }
  if (run.status === "done") {
    throw new Error(`run is already done: ${input.runId}`);
  }

  const activeStep = currentStep(run);
  if (!input.schemaName) {
    if (activeStep?.schema?.kind !== "inline") {
      throw new Error("current Artifact does not use an inline schema; provide an external schema name");
    }
    const steps = compileSchemaSteps(activeStep.schema.node, activeStep.schema.id, stepContract(activeStep));
    if (!steps.length) throw new Error(`inline schema has no executable fields: ${activeStep.artifact}`);
    run.stack.push({
      type: "schema",
      memoryName: activeStep.schema.id,
      sourceStepId: activeStep.id,
      eventStartIndex: run.events.length,
      steps,
      index: 0
    });
  } else {
    if (activeStep?.schema?.kind !== "external") {
      throw new Error("current Artifact does not use an external schema; omit the name for an inline schema");
    }
    if (activeStep.schema.name !== input.schemaName) {
      throw new Error(`current Artifact requires schema ${activeStep.schema.name}, not ${input.schemaName}`);
    }
    if (!activeStep.schema.node) throw new Error(`schema snapshot missing from Run contract: ${input.schemaName}`);
    const schemaName = activeStep.schema.name;
    const steps = compileSchemaSteps(activeStep.schema.node, schemaName, stepContract(activeStep));
    if (!steps.length) throw new Error(`schema has no executable fields: ${input.schemaName}`);
    run.stack.push({
      type: "schema",
      memoryName: schemaName,
      sourceStepId: activeStep?.id,
      eventStartIndex: run.events.length,
      steps,
      index: 0
    });
  }
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

export function activeProcedureAsserts(run: RunState): string[] {
  return [...new Set([
    ...(run.asserts ?? []),
    ...run.stack
      .filter((frame) => frame.type === "procedure")
      .flatMap((frame) => frame.asserts ?? [])
  ])];
}

export function finalArtifacts(run: RunState): RunEvent["artifact"][] {
  return run.events.filter((event) => event.artifact.final).map((event) => event.artifact);
}

async function collapseCompletedFrames(
  runsRoot: string,
  run: RunState,
  createdArtifactFiles: string[] = []
): Promise<void> {
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
      parentStep.schema &&
      completed.sourceStepId === parentStep.id
    ) {
      const contract = await contractForStep(run, parentStep);
      const assembled = await assembleSchemaArtifact(runsRoot, run, completed);
      const context = {
        runId: run.id,
        stepId: parentStep.id,
        artifactPath: parentStep.id,
        attemptId: randomUUID()
      };
      const candidate = await prepareArtifactCandidate(contract, {
        kind: "inline",
        value: assembled
      }, context);
      const plan = parentStep.validationPlan ?? artifactValidatorRegistry.resolvePlan(contract);
      const validation = await artifactValidatorRegistry.execute(plan, { contract, candidate, context });
      if (validation.status !== "passed") throw new ArtifactValidationFailure(validation);
      const artifact = await buildRunEventArtifact(
        runsRoot,
        run,
        parentStep,
        candidate,
        validation,
        createdArtifactFiles
      );
      run.events.push({
        at: new Date().toISOString(),
        frame: parent.type,
        stepId: parentStep.id,
        artifact
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

function compileFlowSteps(flow: FlowNode[], prefix: string): RunStep[] {
  return flow.map((node, index) => compileFlowStep(node, `${prefix}[${index + 1}]`));
}

function compileFlowStep(node: FlowNode, id: string): RunStep {
  switch (node.tag) {
    case "!action":
      return compileActionStep(node, id);
    case "!if":
      return compileIfStep(node, id);
    case "!while":
      return compileWhileStep(node, id);
    case "!call":
      return {
        id,
        kind: "call",
        instruction: `Call ${node.target}`,
        target: node.target
      };
  }
}

function compileActionStep(node: ActionNode, id: string): RunStep {
  return {
    id,
    kind: "action",
    instruction: node.action,
    actor: node.actor ?? "agent",
    artifact: node.artifact.name,
    ...compileArtifactStep(node.artifact, id),
    asserts: node.asserts ? [...node.asserts] : undefined,
    suggests: node.suggests ? [...node.suggests] : undefined
  };
}

function compileArtifactStep(
  artifact: ActionNode["artifact"],
  id: string
): Pick<RunStep, "artifact" | "type" | "format" | "schema" | "validationPlan" | "final"> {
  const contract = compileArtifactContract(artifact);
  const schema = typeof artifact.schema === "string"
    ? { kind: "external" as const, name: artifact.schema }
    : artifact.schema?.tag === "!schema"
      ? { kind: "inline" as const, id: `inline:${id}:${slugify(artifact.name) || "artifact"}`, node: cloneSchema(artifact.schema) }
      : artifact.schema?.tag === "!ref"
        ? { kind: "external" as const, name: artifact.schema.target }
      : undefined;
  const validationPlan = artifactSchemaNeedsResolution(artifact.schema)
    ? undefined
    : artifactValidatorRegistry.resolvePlan(contract);
  return {
    artifact: artifact.name,
    type: contract.type,
    format: contract.format,
    schema,
    validationPlan,
    final: artifact.final || undefined
  };
}

function assertSchemaNode(value: SchemaNode | MemoryRefNode, path: string): SchemaNode {
  if (value.tag === "!schema") return value;
  throw new Error(`unresolved Memory reference at ${path}: ${value.target}`);
}

function compileIfStep(node: IfNode, id: string): RunStep {
  const fallback = compileFlowSteps(node.else ?? [], `${id}.else`);
  return compileIfChain(node, id, fallback);
}

function compileIfChain(node: IfNode, id: string, fallback: RunStep[]): RunStep {
  const thenSteps = compileFlowSteps(node.then, `${id}.then`);
  const elseSteps = node.elseif
    ? [compileIfChain(node.elseif, `${id}.elseif`, fallback)]
    : fallback;
  return {
    id,
    kind: "branch",
    instruction: node.condition.action,
    actor: node.condition.actor ?? "agent",
    ...compileArtifactStep(node.condition.artifact, id),
    asserts: node.condition.asserts ? [...node.condition.asserts] : undefined,
    suggests: node.condition.suggests ? [...node.condition.suggests] : undefined,
    details: describeControlTargets("true", thenSteps).concat(describeControlTargets("false", elseSteps)),
    branches: { truthy: thenSteps, falsy: elseSteps }
  };
}

function compileWhileStep(node: WhileNode, id: string): RunStep {
  const body = compileFlowSteps(node.do, `${id}.do`);
  return {
    id,
    kind: "loop",
    instruction: node.condition.action,
    actor: node.condition.actor ?? "agent",
    ...compileArtifactStep(node.condition.artifact, id),
    asserts: node.condition.asserts ? [...node.condition.asserts] : undefined,
    suggests: node.condition.suggests ? [...node.condition.suggests] : undefined,
    details: describeControlTargets("while true", body).concat(["false: continue after loop"]),
    loop: { body }
  };
}

function describeControlTargets(label: string, steps: RunStep[]): string[] {
  if (!steps.length) return [`${label}: no steps`];
  return [`${label}: ${steps.map((step) => step.artifact ?? step.target ?? step.id).join(", ")}`];
}

function applyControlStep(frame: RunFrame, step: RunStep, artifactValue: unknown): void {
  if (step.kind === "branch" && step.branches) {
    const selected = parseBooleanArtifact(artifactValue) ? step.branches.truthy : step.branches.falsy;
    frame.steps.splice(frame.index, 0, ...cloneSteps(selected));
    return;
  }

  if (step.kind === "loop" && step.loop && parseBooleanArtifact(artifactValue)) {
    frame.steps.splice(frame.index, 0, ...cloneSteps(step.loop.body), cloneStep(step));
  }
}

function parseBooleanArtifact(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return typeof value === "string" && ["true", "yes", "y", "1", "继续", "是"].includes(value.trim().toLowerCase());
}

function cloneSteps(steps: RunStep[]): RunStep[] {
  return steps.map(cloneStep);
}

function cloneStep(step: RunStep): RunStep {
  return {
    ...step,
    format: step.format ? { name: step.format.name, options: structuredClone(step.format.options) } : undefined,
    schema: step.schema ? structuredClone(step.schema) : undefined,
    validationPlan: step.validationPlan ? structuredClone(step.validationPlan) : undefined,
    asserts: step.asserts ? [...step.asserts] : undefined,
    suggests: step.suggests ? [...step.suggests] : undefined,
    details: step.details ? [...step.details] : undefined,
    branches: step.branches
      ? {
          truthy: cloneSteps(step.branches.truthy),
          falsy: cloneSteps(step.branches.falsy)
        }
      : undefined,
    loop: step.loop ? { body: cloneSteps(step.loop.body) } : undefined,
    repeat: step.repeat
      ? {
          ...step.repeat,
          body: JSON.parse(JSON.stringify(step.repeat.body)) as StaticSchemaField[]
        }
      : undefined
  };
}

async function expandAutoCallSteps(run: RunState): Promise<void> {
  let guard = 0;
  while (run.status !== "done") {
    if (guard++ > 20) throw new Error("too many nested !call steps");
    const frame = currentFrame(run);
    const step = currentStep(run);
    if (!frame || !step || step.kind !== "call") return;
    if (!step.target) throw new Error(`${step.id}.target is required`);
    frame.index += 1;
    const procedure = await findMemoryByName(run.memoryRoot, "procedures", step.target);
    if (!procedure) throw new Error(`procedure not found: ${step.target}`);
    const procedureMemory = procedure.entity as ProcedureMemory;
    const steps = compileProcedureSteps(procedureMemory);
    await snapshotExternalSchemas(run.memoryRoot, steps);
    run.stack.push({
      type: "procedure",
      memoryName: procedure.entity.names[0],
      asserts: procedureMemory.asserts ? [...procedureMemory.asserts] : undefined,
      steps,
      index: 0,
      returnTo: step.id
    });
  }
}

async function buildRunEventArtifact(
  runsRoot: string,
  run: RunState,
  step: RunStep,
  candidate: PreparedArtifactCandidate,
  validation: ArtifactValidationResult,
  createdArtifactFiles: string[] = []
): Promise<RunEvent["artifact"]> {
  if (!step.artifact || !step.type || !step.format) {
    throw new Error(`step ${step.id} has no artifact`);
  }

  const base = {
    name: step.artifact,
    type: step.type,
    format: step.format,
    fields: artifactFieldsForStep(step),
    schema: step.schema,
    validation,
    final: step.final
  };

  if (!shouldStoreArtifactAsFile(step.format)) {
    return compactArtifact({
      ...base,
      storage: "inline",
      value: candidate.representation.value
    });
  }

  const artifactDir = await ensureRunArtifactDirectory(runsRoot, run.id);
  const fileName = nextArtifactFileName(run, step);
  const absolutePath = resolve(artifactDir, fileName);
  assertInsideRunArtifactDirectory(absolutePath, artifactDir);

  await writeFile(absolutePath, candidate.raw);
  createdArtifactFiles.push(absolutePath);

  return compactArtifact({
    ...base,
    storage: "file",
    path: join(run.id, "artifacts", fileName),
    fileName,
    contentType: contentTypeForFormat(step.format)
  });
}

async function removeArtifactFiles(paths: readonly string[]): Promise<void> {
  for (const path of [...paths].reverse()) await rm(path, { force: true });
}

async function contractForStep(run: RunState, step: RunStep): Promise<CompiledArtifactContract> {
  if (!step.artifact || !step.type || !step.format) throw new Error(`step ${step.id} has no Artifact contract`);
  let schema: string | SchemaNode | undefined;
  if (step.schema?.kind === "inline") {
    schema = cloneSchema(step.schema.node);
  } else if (step.schema?.kind === "external") {
    if (!step.schema.node) throw new Error(`schema snapshot missing from Run contract: ${step.schema.name}`);
    schema = cloneSchema(step.schema.node);
  }
  return {
    name: step.artifact,
    type: step.type,
    format: { name: step.format.name, options: structuredClone(step.format.options) },
    schema,
    final: step.final === true
  };
}

function stepContract(step: RunStep): CompiledArtifactContract {
  if (!step.artifact || !step.type || !step.format) throw new Error(`step ${step.id} has no Artifact contract`);
  return {
    name: step.artifact,
    type: step.type,
    format: structuredClone(step.format),
    schema: step.schema?.node ? cloneSchema(step.schema.node) : undefined,
    final: step.final === true
  };
}

function compactArtifact(artifact: RunEvent["artifact"]): RunEvent["artifact"] {
  if (artifact.fields && Object.keys(artifact.fields).length === 0) {
    delete artifact.fields;
  }
  return artifact;
}

function artifactFieldsForStep(step: RunStep): Record<string, unknown> | undefined {
  if (step.schema?.kind === "external") return { schema_name: step.schema.name };
  if (step.schema?.kind === "inline") return { inline_schema_id: step.schema.id };
  return undefined;
}

function shouldStoreArtifactAsFile(format: ArtifactFormatSpec): boolean {
  return ["markdown", "yaml", "json"].includes(format.name);
}

function runArtifactDirectory(runsRoot: string, runId: string): string {
  return join(runsRoot, runId, "artifacts");
}

async function ensureRunArtifactDirectory(runsRoot: string, runId: string): Promise<string> {
  const artifactDir = runArtifactDirectory(runsRoot, runId);
  await mkdir(artifactDir, { recursive: true });
  return artifactDir;
}

function assertInsideRunArtifactDirectory(path: string, artifactDir: string): void {
  const rel = relative(resolve(artifactDir), resolve(path));
  if (rel.startsWith("..") || rel === "" || rel.includes("..")) {
    throw new Error(`artifact path escapes run artifacts directory: ${path}`);
  }
}

function nextArtifactFileName(run: RunState, step: RunStep): string {
  const index = String(run.events.length + 1).padStart(3, "0");
  const slug = slugify(step.artifact ?? step.id) || slugify(step.id) || "artifact";
  return `${index}-${slug}${extensionForFormat(step.format ?? { name: "plain", options: {} })}`;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function extensionForFormat(format: ArtifactFormatSpec): string {
  switch (format.name) {
    case "markdown":
      return ".md";
    case "yaml":
      return ".yaml";
    case "json":
      return ".json";
    default:
      return ".txt";
  }
}

function contentTypeForFormat(format: ArtifactFormatSpec): string | undefined {
  switch (format.name) {
    case "markdown":
      return "text/markdown";
    case "yaml":
      return "application/yaml";
    case "json":
      return "application/json";
    default:
      return undefined;
  }
}

function compileSchemaSteps(
  schema: SchemaNode,
  rootName: string,
  parentContract: CompiledArtifactContract
): RunStep[] {
  const steps: RunStep[] = [];
  walkSchema(schema, rootName, steps, parentContract);
  return steps;
}

function schemaStepContract(
  schema: SchemaNode,
  parent: CompiledArtifactContract,
  name: string
): CompiledArtifactContract {
  const resolved = resolveSchemaContract(schema, parent.format);
  return {
    name,
    type: resolved.type,
    format: structuredClone(resolved.format),
    final: false
  };
}

function walkSchema(
  node: SchemaNode,
  path: string,
  steps: RunStep[],
  parentContract: CompiledArtifactContract
): void {
    const contract = schemaStepContract(node, parentContract, path);
  steps.push(compileSchemaValueStep({
    id: `schema:${path}`,
    instruction: `Write ${path}`,
    artifact: path,
    contract,
    details: definitionDetails(node.defines)
      .concat((node.asserts ?? []).map((value) => `asserts: ${value}`)),
    optional: node.optional === true
  }));

  if (!(contract.type === "object" && contract.format.name === "markdown" && contract.format.options.layout === "outline")) {
    return;
  }

  for (const [fieldIndex, child] of (node.fields ?? []).entries()) {
    if (typeof child === "string") {
      steps.push(compileStringSchemaStep(`${path}.${child}`, contract));
      continue;
    }
    if (child.tag === "!repeat") {
      steps.push(compileRepeatStep(child, path, fieldIndex));
      continue;
    }
    const childSchema = assertSchemaNode(child, `${path}.fields[${fieldIndex}]`);
    walkSchema(childSchema, `${path}.${childSchema.names[0]}`, steps, contract);
  }
}

function compileStringSchemaStep(path: string, parent: CompiledArtifactContract): RunStep {
  return compileSchemaValueStep({
    id: `schema:${path}`,
    instruction: `Write ${path}`,
    artifact: path,
    contract: {
      name: path,
      type: "string",
      format: inheritSchemaFormat(parent.format, "string"),
      final: false
    }
  });
}

function compileSchemaValueStep(input: {
  id: string;
  instruction: string;
  artifact: string;
  contract: CompiledArtifactContract;
  details?: string[];
  optional?: boolean;
}): RunStep {
  const contract = input.contract;
  return {
    id: input.id,
    instruction: input.instruction,
    actor: "agent",
    artifact: input.artifact,
    type: contract.type,
    format: contract.format,
    validationPlan: artifactValidatorRegistry.resolvePlan(contract),
    details: input.details,
    optional: input.optional || undefined
  };
}

function compileRepeatStep(node: RepeatNode, parentPath: string, fieldIndex: number): RunStep {
  const min = node.limit?.min ?? 0;
  const max = node.limit?.max;
  return {
    id: `schema:${parentPath}.fields[${fieldIndex + 1}].repeat`,
    kind: "repeat",
    instruction: `Choose how many times to repeat the field group in ${parentPath}`,
    actor: "agent",
    details: [
      `min: ${min}`,
      `max: ${max === undefined ? "unbounded" : max}`,
      `body fields: ${node.body.length}`
    ],
    repeat: {
      parentPath,
      fieldIndex,
      body: JSON.parse(JSON.stringify(node.body)) as StaticSchemaField[],
      min,
      max
    }
  };
}

function compileRepeatBody(repeat: NonNullable<RunStep["repeat"]>, count: number): RunStep[] {
  const steps: RunStep[] = [];
  for (let iteration = 1; iteration <= count; iteration += 1) {
    for (const child of repeat.body) {
      if (typeof child === "string") {
        steps.push(compileStringSchemaStep(`${repeat.parentPath}.${child}[${iteration}]`, {
          name: repeat.parentPath,
          type: "object",
          format: { name: "markdown", options: { layout: "outline" } },
          final: false
        }));
      } else {
        const childSchema = assertSchemaNode(child, `${repeat.parentPath}.repeat[${iteration}]`);
        walkSchema(childSchema, `${repeat.parentPath}.${childSchema.names[0]}[${iteration}]`, steps, {
          name: repeat.parentPath,
          type: "object",
          format: { name: "markdown", options: { layout: "outline" } },
          final: false
        });
      }
    }
  }
  return steps;
}

function cloneSchema(schema: SchemaNode): SchemaNode {
  return JSON.parse(JSON.stringify(schema)) as SchemaNode;
}

function definitionDetails(defines: DefinitionPart[]): string[] {
  const details: string[] = [];
  for (const definition of defines) {
    if (typeof definition === "string") {
      details.push(`defines: ${definition}`);
      continue;
    }
    if (definition.tag === "!statement") {
      details.push(...statementDefinitionDetails(definition));
      continue;
    }
    if (definition.tag === "!ref") {
      details.push(`ref: ${definition.target}`);
      continue;
    }
    details.push(...definitionDetails(definition.defines));
    details.push(...(definition.asserts ?? []).map((value) => `asserts: ${value}`));
  }
  return details;
}

function statementDefinitionDetails(statement: StatementNode, path: string[] = []): string[] {
  const details = definitionDetails(statement.defines);
  const qualifier = path.length > 0 ? ` [${path.join(" > ")}]` : "";
  details.push(...(statement.asserts ?? []).map((value) => `asserts${qualifier}: ${value}`));
  details.push(...(statement.suggests ?? []).map((value) => `suggests${qualifier}: ${value}`));

  for (const section of statement.sections ?? []) {
    details.push(...statementDefinitionDetails(section, [...path, section.names[0].trim()]));
  }
  return details;
}

async function snapshotExternalSchemas(memoryRoot: string, steps: RunStep[]): Promise<void> {
  for (const step of steps) {
    if (step.schema?.kind === "external" && !step.schema.node) {
      const memory = await findSchemaMemory(memoryRoot, step.schema.name);
      if (!memory) throw new Error(`schema not found: ${step.schema.name}`);
      step.schema.node = await resolveSchemaReferences(
        memoryRoot,
        schemaNodeFromMemory(memory.entity as SchemaMemory),
        [memoryReference(memory)]
      );
    }
    if (step.schema?.kind === "inline") {
      step.schema.node = await resolveSchemaReferences(memoryRoot, step.schema.node, [`inline:${step.schema.id}`]);
    }
    if (step.schema?.node && step.artifact && step.type && step.format) {
      step.validationPlan = artifactValidatorRegistry.resolvePlan(stepContract(step));
    }
    if (
      step.schema?.node &&
      schemaHasRepeat(step.schema.node) &&
      !(step.type === "object" && step.format?.name === "markdown" && step.format.options.layout === "outline")
    ) {
      throw new Error(`Schema Repeat is only supported by object markdown Artifacts with layout: outline: ${step.id}`);
    }
    if (step.branches) {
      await snapshotExternalSchemas(memoryRoot, step.branches.truthy);
      await snapshotExternalSchemas(memoryRoot, step.branches.falsy);
    }
    if (step.loop) await snapshotExternalSchemas(memoryRoot, step.loop.body);
  }
}

function artifactSchemaNeedsResolution(schema: ActionNode["artifact"]["schema"]): boolean {
  if (!schema || typeof schema === "string") return false;
  if (schema.tag === "!ref") return true;
  return schemaHasRef(schema);
}

async function resolveSchemaReferences(memoryRoot: string, schema: SchemaNode, stack: string[]): Promise<SchemaNode> {
  const resolved = cloneSchema(schema);
  if (resolved.fields) {
    resolved.fields = await Promise.all(resolved.fields.map((field, index) =>
      resolveSchemaField(memoryRoot, field, `${stack.at(-1) ?? "schema"}.fields[${index}]`, stack)
    ));
  }
  if (resolved.item) {
    resolved.item = await resolveSchemaItem(memoryRoot, resolved.item, `${stack.at(-1) ?? "schema"}.item`, stack);
  }
  if (resolved.items) {
    resolved.items = await Promise.all(resolved.items.map((item, index) =>
      resolveSchemaItem(memoryRoot, item, `${stack.at(-1) ?? "schema"}.items[${index}]`, stack)
    ));
  }
  return resolved;
}

async function resolveSchemaField(
  memoryRoot: string,
  field: StaticSchemaField | RepeatNode,
  path: string,
  stack: string[]
): Promise<StaticSchemaField | RepeatNode> {
  if (typeof field === "object" && field.tag === "!repeat") {
    return {
      ...field,
      body: await Promise.all(field.body.map((bodyField, index) =>
        resolveStaticSchemaField(memoryRoot, bodyField, `${path}.body[${index}]`, stack)
      ))
    };
  }
  return resolveStaticSchemaField(memoryRoot, field, path, stack);
}

async function resolveStaticSchemaField(
  memoryRoot: string,
  field: StaticSchemaField,
  path: string,
  stack: string[]
): Promise<StaticSchemaField> {
  if (typeof field === "string") return field;
  if (field.tag === "!ref") return resolveSchemaRef(memoryRoot, field, path, stack);
  return resolveSchemaReferences(memoryRoot, field, [...stack, `inline:${path}`]);
}

async function resolveSchemaItem(
  memoryRoot: string,
  item: SchemaNode | MemoryRefNode,
  path: string,
  stack: string[]
): Promise<SchemaNode> {
  if (item.tag === "!ref") return resolveSchemaRef(memoryRoot, item, path, stack);
  return resolveSchemaReferences(memoryRoot, item, [...stack, `inline:${path}`]);
}

async function resolveSchemaRef(
  memoryRoot: string,
  ref: MemoryRefNode,
  path: string,
  stack: string[]
): Promise<SchemaNode> {
  if (!ref.target.startsWith("schemas/")) {
    throw new Error(`schema reference at ${path} must target schemas/*, got ${ref.target}`);
  }
  if (stack.includes(ref.target)) {
    throw new Error(`Schema reference cycle detected: ${[...stack, ref.target].join(" -> ")}`);
  }
  const memory = await findSchemaMemory(memoryRoot, ref.target);
  if (!memory) throw new Error(`schema not found: ${ref.target}`);
  return resolveSchemaReferences(memoryRoot, schemaNodeFromMemory(memory.entity as SchemaMemory), [...stack, ref.target]);
}

function schemaHasRef(schema: SchemaNode): boolean {
  return (schema.fields ?? []).some((field) => schemaFieldHasRef(field)) ||
    (schema.item ? staticSchemaFieldHasRef(schema.item) : false) ||
    (schema.items ?? []).some((item) => staticSchemaFieldHasRef(item));
}

function schemaFieldHasRef(field: StaticSchemaField | RepeatNode): boolean {
  if (typeof field !== "object") return false;
  if (field.tag === "!repeat") return field.body.some((bodyField) => staticSchemaFieldHasRef(bodyField));
  return staticSchemaFieldHasRef(field);
}

function staticSchemaFieldHasRef(field: StaticSchemaField): boolean {
  if (typeof field !== "object") return false;
  if (field.tag === "!ref") return true;
  return schemaHasRef(field);
}

function schemaHasRepeat(schema: SchemaNode): boolean {
  return (schema.fields ?? []).some((field) =>
    typeof field === "object" && (field.tag === "!repeat" || (field.tag === "!schema" && schemaHasRepeat(field)))
  ) || (schema.item?.tag === "!schema" && schemaHasRepeat(schema.item)) ||
    (schema.items ?? []).some((item) => item.tag === "!schema" && schemaHasRepeat(item));
}

async function assembleSchemaArtifact(runsRoot: string, run: RunState, frame: RunFrame): Promise<string> {
  const events = run.events.slice(frame.eventStartIndex ?? 0);
  const chunks: string[] = [];
  for (const step of frame.steps) {
    if (!step.artifact || step.kind === "repeat") continue;
    const event = events.find((candidate) => candidate.stepId === step.id);
    if (!event) continue;
    if (event.artifact.fields?.skipped === true) continue;
    const value = event.artifact.storage === "file" && event.artifact.path
      ? await readFile(join(runsRoot, event.artifact.path), "utf8")
      : String(event.artifact.value ?? "");
    if (step.artifact === frame.memoryName) {
      if (value.trim()) chunks.push(value.trim());
      continue;
    }
    const relativePath = step.artifact.startsWith(`${frame.memoryName}.`)
      ? step.artifact.slice(frame.memoryName.length + 1)
      : step.artifact;
    const segments = relativePath.split(".");
    const title = segments.at(-1)?.replace(/\[(\d+)\]/g, " $1") ?? relativePath;
    const headingLevel = Math.min(6, segments.length + 1);
    chunks.push(`${"#".repeat(headingLevel)} ${title}`);
    if (value.trim()) chunks.push(value.trim());
  }
  return `${chunks.join("\n\n")}\n`;
}

async function findSchemaMemory(memoryRoot: string, referenceOrName: string): Promise<MemoryFile | undefined> {
  if (referenceOrName.startsWith("schemas/")) {
    return findMemoryByReference(memoryRoot, "schemas", referenceOrName);
  }
  return findMemoryByName(memoryRoot, "schemas", referenceOrName);
}

async function findMemoryByReference(memoryRoot: string, kind: "schemas", reference: string): Promise<MemoryFile | undefined> {
  const paths = await listMemoryFiles(memoryRoot, kind);
  let hasInvalidMemory = false;

  for (const path of paths) {
    let file: MemoryFile;
    try {
      file = await readMemoryFile(kind, path);
    } catch {
      hasInvalidMemory = true;
      continue;
    }
    if (memoryReference(file) === reference) {
      return file;
    }
  }

  if (hasInvalidMemory) {
    throw new Error(
      `schema ${reference} could not be resolved because the Memory store ` +
      "contains invalid Memory YAML; run memsphere validate"
    );
  }
  return undefined;
}

function memoryReference(file: MemoryFile): string {
  return `${file.kind}/${file.entity.names[0] ?? ""}`;
}

async function findMemoryByName(memoryRoot: string, kind: "procedures" | "schemas", name: string): Promise<MemoryFile | undefined> {
  const paths = await listMemoryFiles(memoryRoot, kind);
  let hasInvalidMemory = false;

  for (const path of paths) {
    let file: MemoryFile;
    try {
      file = await readMemoryFile(kind, path);
    } catch {
      // Run lookup should not be blocked by unrelated invalid memories.
      hasInvalidMemory = true;
      continue;
    }
    if (file.entity.names.includes(name)) {
      return file;
    }
  }

  if (hasInvalidMemory) {
    throw new Error(
      `${kind === "procedures" ? "procedure" : "schema"} ${name} could not be resolved because the Memory store ` +
      "contains invalid Memory YAML; run memsphere validate"
    );
  }
  return undefined;
}

function runPath(runsRoot: string, id: string): string {
  return join(runsRoot, id, `${id}.json`);
}

function legacyRunPath(runsRoot: string, id: string): string {
  return join(runsRoot, `${id}.json`);
}

async function existingRunPath(runsRoot: string, id: string): Promise<string> {
  const current = runPath(runsRoot, id);
  try {
    await readFile(current, "utf8");
    return current;
  } catch {
    return legacyRunPath(runsRoot, id);
  }
}

async function writeRun(runsRoot: string, run: RunState): Promise<void> {
  const directory = join(runsRoot, run.id);
  const targetPath = runPath(runsRoot, run.id);
  const tempPath = join(directory, `.${run.id}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(tempPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
    await rename(tempPath, targetPath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function withRunWriteLock<T>(runsRoot: string, runId: string, work: () => Promise<T>): Promise<T> {
  const lockRoot = join(runsRoot, ".locks");
  const lockName = createHash("sha256").update(runId).digest("hex");
  const lockPath = join(lockRoot, `${lockName}.lock`);
  await mkdir(lockRoot, { recursive: true });
  const deadline = Date.now() + 30_000;
  const owner = { pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() };
  while (true) {
    try {
      await writeFile(lockPath, `${JSON.stringify(owner)}\n`, { flag: "wx" });
      break;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
      await removeStaleRunLock(lockPath);
      if (Date.now() >= deadline) throw new Error(`run is busy: ${runId}`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    }
  }

  try {
    return await work();
  } finally {
    await removeOwnedRunLock(lockPath, owner.token);
  }
}

async function removeStaleRunLock(lockPath: string): Promise<void> {
  const owner = await readRunLockOwner(lockPath);
  if (!owner) {
    try {
      if (Date.now() - (await stat(lockPath)).mtimeMs < 1_000) return;
      if (!await readRunLockOwner(lockPath)) await rm(lockPath, { force: true });
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    return;
  }
  if (processExists(owner.pid)) return;
  const current = await readRunLockOwner(lockPath);
  if (current?.token === owner.token && !processExists(current.pid)) await rm(lockPath, { force: true });
}

async function removeOwnedRunLock(lockPath: string, token: string): Promise<void> {
  const owner = await readRunLockOwner(lockPath);
  if (owner?.token === token) await rm(lockPath, { force: true });
}

async function readRunLockOwner(lockPath: string): Promise<{ pid: number; token: string } | undefined> {
  try {
    const value = JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>;
    return Number.isSafeInteger(value.pid) && typeof value.token === "string"
      ? { pid: value.pid as number, token: value.token }
      : undefined;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    return undefined;
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code !== "ESRCH");
  }
}

function makeRunId(iso: string): string {
  const stamp = iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-").toLowerCase();
  return `run-${stamp}-${randomUUID().slice(0, 8)}`;
}

function normalizeLegacyRun(value: unknown): RunState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid v1 run state");
  const legacy = value as Record<string, unknown>;
  const plan = Array.isArray(legacy.plan) ? legacy.plan.map(normalizeLegacyStep) : undefined;
  const stack = Array.isArray(legacy.stack) ? legacy.stack.map((frameValue) => {
    const frame = frameValue as Record<string, unknown>;
    return {
      type: frame.type === "schema" ? "schema" as const : "procedure" as const,
      memoryName: String(frame.memoryName ?? ""),
      asserts: stringList(frame.asserts),
      steps: Array.isArray(frame.steps) ? frame.steps.map(normalizeLegacyStep) : [],
      index: Number(frame.index ?? 0),
      returnTo: typeof frame.returnTo === "string" ? frame.returnTo : undefined,
      sourceStepId: typeof frame.sourceStepId === "string" ? frame.sourceStepId : undefined,
      eventStartIndex: typeof frame.eventStartIndex === "number" ? frame.eventStartIndex : undefined
    };
  }) : [];
  const stepsById = new Map<string, RunStep>();
  for (const step of [...(plan ?? []), ...stack.flatMap((frame) => frame.steps)]) collectSteps(step, stepsById);
  const events = Array.isArray(legacy.events) ? legacy.events.map((eventValue) => normalizeLegacyEvent(eventValue, stepsById)) : [];

  return {
    contractVersion: 1,
    readOnly: true,
    id: String(legacy.id ?? ""),
    status: legacy.status === "done" ? "done" : "running",
    procedureName: String(legacy.procedureName ?? ""),
    asserts: stringList(legacy.asserts),
    memoryRoot: String(legacy.memoryRoot ?? ""),
    createdAt: String(legacy.createdAt ?? ""),
    updatedAt: String(legacy.updatedAt ?? legacy.createdAt ?? ""),
    plan,
    stack,
    events
  };
}

function normalizeLegacyStep(value: unknown): RunStep {
  const legacy = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const normalized = legacyContract(String(legacy.artifact ?? ""), legacy.format, legacy.inlineSchema);
  const schema = legacySchemaContract(legacy);
  return {
    id: String(legacy.id ?? ""),
    kind: isRunStepKind(legacy.kind) ? legacy.kind : undefined,
    instruction: String(legacy.instruction ?? ""),
    actor: legacy.actor === "human" ? "human" : legacy.actor === "agent" ? "agent" : undefined,
    artifact: typeof legacy.artifact === "string" ? legacy.artifact : undefined,
    type: normalized?.type,
    format: normalized?.format,
    schema,
    final: legacy.final === true || undefined,
    asserts: stringList(legacy.asserts),
    suggests: stringList(legacy.suggests),
    details: stringList(legacy.details),
    target: typeof legacy.target === "string" ? legacy.target : undefined,
    branches: legacy.branches && typeof legacy.branches === "object"
      ? {
          truthy: Array.isArray((legacy.branches as Record<string, unknown>).truthy)
            ? ((legacy.branches as Record<string, unknown>).truthy as unknown[]).map(normalizeLegacyStep)
            : [],
          falsy: Array.isArray((legacy.branches as Record<string, unknown>).falsy)
            ? ((legacy.branches as Record<string, unknown>).falsy as unknown[]).map(normalizeLegacyStep)
            : []
        }
      : undefined,
    loop: legacy.loop && typeof legacy.loop === "object" && Array.isArray((legacy.loop as Record<string, unknown>).body)
      ? { body: ((legacy.loop as Record<string, unknown>).body as unknown[]).map(normalizeLegacyStep) }
      : undefined,
    repeat: legacy.repeat as RunStep["repeat"]
  };
}

function normalizeLegacyEvent(value: unknown, stepsById: Map<string, RunStep>): RunEvent {
  const legacy = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const artifact = legacy.artifact && typeof legacy.artifact === "object" && !Array.isArray(legacy.artifact)
    ? legacy.artifact as Record<string, unknown>
    : {};
  const stepId = String(legacy.stepId ?? "");
  const step = stepsById.get(stepId);
  const normalized = step?.type && step.format
    ? { type: step.type, format: step.format }
    : legacyContract(String(artifact.name ?? ""), artifact.format, undefined) ?? {
        type: "string",
        format: { name: "plain", options: {} }
      };
  const schema = step?.schema ?? legacyEventSchema(artifact);
  return {
    at: String(legacy.at ?? ""),
    frame: legacy.frame === "schema" ? "schema" : "procedure",
    stepId,
    artifact: {
      name: String(artifact.name ?? step?.artifact ?? ""),
      type: normalized.type,
      format: normalized.format,
      fields: artifact.fields && typeof artifact.fields === "object" && !Array.isArray(artifact.fields)
        ? artifact.fields as Record<string, unknown>
        : undefined,
      schema,
      final: artifact.final === true || undefined,
      storage: artifact.storage === "file" ? "file" : artifact.storage === "inline" ? "inline" : undefined,
      value: artifact.value,
      path: typeof artifact.path === "string" ? artifact.path : undefined,
      fileName: typeof artifact.fileName === "string" ? artifact.fileName : undefined,
      contentType: typeof artifact.contentType === "string" ? artifact.contentType : undefined
    }
  };
}

function legacyContract(name: string, formatValue: unknown, schemaValue: unknown): Pick<CompiledArtifactContract, "type" | "format"> | undefined {
  if (typeof formatValue !== "string") return undefined;
  switch (formatValue) {
    case "boolean": return { type: "boolean", format: { name: "plain", options: {} } };
    case "number": return { type: "number", format: { name: "plain", options: {} } };
    case "string": return { type: "string", format: { name: "plain", options: {} } };
    case "markdown": return { type: "string", format: { name: "markdown", options: {} } };
    case "json": return { type: "object", format: { name: "json", options: {} } };
    case "yaml": return { type: "object", format: { name: "yaml", options: {} } };
    case "schema": {
      const layout = legacySchemaLayout(schemaValue);
      return {
        type: layout === "table" ? "array" : "object",
        format: { name: "markdown", options: { layout } }
      };
    }
    default:
      throw new Error(`unsupported v1 Artifact format ${formatValue} for ${name}`);
  }
}

function legacySchemaContract(legacy: Record<string, unknown>): RunSchemaContract | undefined {
  if (typeof legacy.schemaName === "string") return { kind: "external", name: legacy.schemaName };
  if (legacy.inlineSchema && typeof legacy.inlineSchema === "object" && !Array.isArray(legacy.inlineSchema)) {
    return {
      kind: "inline",
      id: typeof legacy.inlineSchemaId === "string" ? legacy.inlineSchemaId : "inline:v1",
      node: normalizeLegacySchema(legacy.inlineSchema)
    };
  }
  return undefined;
}

function legacyEventSchema(artifact: Record<string, unknown>): RunSchemaContract | undefined {
  const fields = artifact.fields && typeof artifact.fields === "object" && !Array.isArray(artifact.fields)
    ? artifact.fields as Record<string, unknown>
    : {};
  const name = typeof fields.schema_name === "string" ? fields.schema_name : artifact.schemaName;
  if (typeof name === "string") return { kind: "external", name };
  const id = typeof fields.inline_schema_id === "string" ? fields.inline_schema_id : artifact.inlineSchemaId;
  return typeof id === "string" ? { kind: "inline", id, node: emptyLegacySchema(id) } : undefined;
}

function normalizeLegacySchema(value: unknown): SchemaNode {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const fields = Array.isArray(source.fields) ? source.fields.map((field) => {
    if (typeof field === "string") return field;
    if (field && typeof field === "object" && (field as { tag?: unknown }).tag === "!repeat") {
      const repeat = structuredClone(field) as Record<string, unknown>;
      if (Array.isArray(repeat.body)) repeat.body = repeat.body.map((bodyField) => typeof bodyField === "string" ? bodyField : normalizeLegacySchema(bodyField));
      return repeat as unknown as StaticSchemaField;
    }
    return normalizeLegacySchema(field);
  }) : undefined;
  return {
    tag: "!schema",
    names: stringList(source.names) ?? [],
    defines: Array.isArray(source.defines) ? source.defines as DefinitionPart[] : [],
    asserts: stringList(source.asserts),
    fields: fields as SchemaNode["fields"],
    item: source.item ? normalizeLegacySchema(source.item) : undefined,
    items: Array.isArray(source.items) ? source.items.map(normalizeLegacySchema) : undefined
  };
}

function emptyLegacySchema(id: string): SchemaNode {
  return { tag: "!schema", names: [id], defines: [] };
}

function legacySchemaLayout(value: unknown): "outline" | "table" {
  return value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).format === "table"
    ? "table"
    : "outline";
}

function collectSteps(step: RunStep, steps: Map<string, RunStep>): void {
  steps.set(step.id, step);
  for (const child of step.branches?.truthy ?? []) collectSteps(child, steps);
  for (const child of step.branches?.falsy ?? []) collectSteps(child, steps);
  for (const child of step.loop?.body ?? []) collectSteps(child, steps);
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function isRunStepKind(value: unknown): value is NonNullable<RunStep["kind"]> {
  return ["action", "branch", "loop", "call", "repeat"].includes(String(value));
}
