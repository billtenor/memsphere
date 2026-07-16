import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import { listMemoryFiles, readMemoryFile, type MemoryFile } from "../memory/store.js";
import {
  artifactFormats,
  stepActors,
  type ActionNode,
  type ArtifactFormat,
  type DefinitionPart,
  type FlowNode,
  type IfNode,
  type ProcedureMemory,
  type SchemaMemory,
  type SchemaNode,
  type StepActor,
  type WhileNode
} from "../memory/ast.js";

export { artifactFormats, stepActors };
export type { ArtifactFormat, StepActor };

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
};

export type RunStep = {
  id: string;
  kind?: "action" | "branch" | "loop" | "call";
  instruction: string;
  actor?: StepActor;
  artifact?: string;
  format?: ArtifactFormat;
  schemaName?: string;
  inlineSchema?: SchemaNode;
  inlineSchemaId?: string;
  final?: boolean;
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
};

export type RunEvent = {
  at: string;
  frame: FrameType;
  stepId: string;
  artifact: {
      name: string;
      format: ArtifactFormat;
      fields?: Record<string, unknown>;
      schemaName?: string;
      schemaKind?: "external" | "inline";
      inlineSchemaId?: string;
      final?: boolean;
      storage?: "inline" | "file";
      value?: string;
      path?: string;
      fileName?: string;
      contentType?: string;
  };
};

export type ArtifactReportSource =
  | { kind: "inline"; value: string }
  | { kind: "file"; path: string };

export type RunState = {
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

const runStepSchema: z.ZodType<RunStep> = z.lazy(() =>
  z.object({
    id: z.string(),
    kind: z.enum(["action", "branch", "loop", "call"]).optional(),
    instruction: z.string(),
    actor: z.enum(stepActors).optional(),
    artifact: z.string().optional(),
    format: z.enum(artifactFormats).optional(),
    schemaName: z.string().optional(),
    inlineSchema: z.custom<SchemaNode>().optional(),
    inlineSchemaId: z.string().optional(),
    final: z.boolean().optional(),
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
    }).optional()
  })
);

const runStateSchema: z.ZodType<RunState> = z.object({
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
    sourceStepId: z.string().optional()
  })),
  events: z.array(z.object({
    at: z.string(),
    frame: z.enum(["procedure", "schema"]),
    stepId: z.string(),
    artifact: z.object({
      name: z.string(),
      format: z.enum(artifactFormats),
      fields: z.record(z.unknown()).optional(),
      schemaName: z.string().optional(),
      schemaKind: z.enum(["external", "inline"]).optional(),
      inlineSchemaId: z.string().optional(),
      final: z.boolean().optional(),
      storage: z.enum(["inline", "file"]).optional(),
      value: z.string().optional(),
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
  if (!steps.length) {
    throw new Error(`procedure has no flow steps: ${input.procedureName}`);
  }

  const now = new Date().toISOString();
  const run: RunState = {
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
  return runStateSchema.parse(JSON.parse(raw));
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

  const artifact = await buildRunEventArtifact(input.runsRoot, run, step, input.artifact);
  const controlValue = step.kind === "branch" || step.kind === "loop" ? artifactInlineValue(artifact) : "";

  run.events.push({
    at: new Date().toISOString(),
    frame: frame.type,
    stepId: step.id,
    artifact
  });

  frame.index += 1;
  applyControlStep(frame, step, controlValue);
  await collapseCompletedFrames(input.runsRoot, run);
  await expandAutoCallSteps(run);
  run.updatedAt = new Date().toISOString();
  await writeRun(input.runsRoot, run);
  return run;
}

export function artifactInlineValue(artifact: RunEvent["artifact"]): string {
  if (artifact.storage === "file") {
    throw new Error(`artifact is stored as file and has no inline value: ${artifact.name}`);
  }
  return artifact.value ?? "";
}

export function artifactSchemaName(artifact: RunEvent["artifact"]): string | undefined {
  const fieldValue = artifact.fields?.schema_name;
  return typeof fieldValue === "string" ? fieldValue : artifact.schemaName;
}

export async function enterSchema(input: { memoryRoot: string; runsRoot: string; runId: string; schemaName?: string }): Promise<RunState> {
  const run = await readRun(input.runsRoot, input.runId);
  if (run.status === "done") {
    throw new Error(`run is already done: ${input.runId}`);
  }

  const activeStep = currentStep(run);
  if (!input.schemaName) {
    if (!activeStep?.inlineSchema || !activeStep.inlineSchemaId) {
      throw new Error("current Artifact does not use an inline schema; provide an external schema name");
    }
    const steps = compileSchemaSteps(activeStep.inlineSchema, activeStep.inlineSchemaId);
    if (!steps.length) throw new Error(`inline schema has no executable fields: ${activeStep.artifact}`);
    run.stack.push({
      type: "schema",
      memoryName: activeStep.inlineSchemaId,
      sourceStepId: activeStep.id,
      steps,
      index: 0
    });
  } else {
    const schema = await findMemoryByName(input.memoryRoot, "schemas", input.schemaName);
    if (!schema) throw new Error(`schema not found: ${input.schemaName}`);
    const steps = compileSchemaSteps(schema.entity as SchemaMemory, schema.entity.names[0]);
    if (!steps.length) throw new Error(`schema has no executable fields: ${input.schemaName}`);
    run.stack.push({
      type: "schema",
      memoryName: schema.entity.names[0],
      sourceStepId: activeStep?.id,
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

async function collapseCompletedFrames(runsRoot: string, run: RunState): Promise<void> {
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
      completed.sourceStepId === parentStep.id
    ) {
      const artifact = await buildRunEventArtifact(runsRoot, run, parentStep, {
        kind: "inline",
        value: `schema:${completed.memoryName}`
      });
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
    format: node.artifact.format,
    ...compileArtifactStep(node.artifact, id),
    asserts: node.asserts ? [...node.asserts] : undefined,
    suggests: node.suggests ? [...node.suggests] : undefined
  };
}

function compileArtifactStep(artifact: ActionNode["artifact"], id: string): Pick<RunStep, "artifact" | "format" | "schemaName" | "inlineSchema" | "inlineSchemaId" | "final"> {
  const schemaName = typeof artifact.schema === "string" ? artifact.schema : undefined;
  const inlineSchema = typeof artifact.schema === "object" ? cloneSchema(artifact.schema) : undefined;
  return {
    artifact: artifact.name,
    format: artifact.format,
    schemaName,
    inlineSchema,
    inlineSchemaId: inlineSchema ? `inline:${id}:${slugify(artifact.name) || "artifact"}` : undefined,
    final: artifact.final || undefined
  };
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
    inlineSchema: step.inlineSchema ? cloneSchema(step.inlineSchema) : undefined,
    asserts: step.asserts ? [...step.asserts] : undefined,
    suggests: step.suggests ? [...step.suggests] : undefined,
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
    run.stack.push({
      type: "procedure",
      memoryName: procedure.entity.names[0],
      asserts: procedureMemory.asserts ? [...procedureMemory.asserts] : undefined,
      steps: compileProcedureSteps(procedureMemory),
      index: 0,
      returnTo: step.id
    });
  }
}

async function buildRunEventArtifact(
  runsRoot: string,
  run: RunState,
  step: RunStep,
  source: ArtifactReportSource
): Promise<RunEvent["artifact"]> {
  if (!step.artifact || !step.format) {
    throw new Error(`step ${step.id} has no artifact`);
  }

  const base = {
    name: step.artifact,
    format: step.format,
    fields: artifactFieldsForStep(step),
    schemaKind: step.inlineSchema ? "inline" as const : step.schemaName ? "external" as const : undefined,
    inlineSchemaId: step.inlineSchemaId,
    final: step.final
  };

  if (source.kind === "inline" && !shouldStoreArtifactAsFile(step.format)) {
    return compactArtifact({
      ...base,
      storage: "inline",
      value: source.value
    });
  }

  const artifactDir = await ensureRunArtifactDirectory(runsRoot, run.id);
  const fileName = nextArtifactFileName(run, step);
  const absolutePath = resolve(artifactDir, fileName);
  assertInsideRunArtifactDirectory(absolutePath, artifactDir);

  if (source.kind === "file") {
    await copyFile(source.path, absolutePath);
  } else {
    await writeFile(absolutePath, source.value, "utf8");
  }

  return compactArtifact({
    ...base,
    storage: "file",
    path: join(run.id, "artifacts", fileName),
    fileName,
    contentType: contentTypeForFormat(step.format)
  });
}

function compactArtifact(artifact: RunEvent["artifact"]): RunEvent["artifact"] {
  if (artifact.fields && Object.keys(artifact.fields).length === 0) {
    delete artifact.fields;
  }
  return artifact;
}

function artifactFieldsForStep(step: RunStep): Record<string, unknown> | undefined {
  if (step.format === "schema") {
    if (step.schemaName) return { schema_name: step.schemaName };
    if (step.inlineSchemaId) return { inline_schema_id: step.inlineSchemaId };
  }
  return undefined;
}

function shouldStoreArtifactAsFile(format: ArtifactFormat): boolean {
  return ["markdown", "yaml", "json", "schema"].includes(format);
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
  return `${index}-${slug}${extensionForFormat(step.format ?? "string")}`;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function extensionForFormat(format: ArtifactFormat): string {
  switch (format) {
    case "markdown":
      return ".md";
    case "yaml":
      return ".yaml";
    case "json":
      return ".json";
    case "schema":
      return ".schema.md";
    default:
      return ".txt";
  }
}

function contentTypeForFormat(format: ArtifactFormat): string | undefined {
  switch (format) {
    case "markdown":
    case "schema":
      return "text/markdown";
    case "yaml":
      return "application/yaml";
    case "json":
      return "application/json";
    default:
      return undefined;
  }
}

function compileSchemaSteps(schema: SchemaNode, rootName: string): RunStep[] {
  const steps: RunStep[] = [];
  walkSchema(schema, rootName, steps);
  return steps;
}

function walkSchema(node: SchemaNode, path: string, steps: RunStep[]): void {
  const elementTypeDetails = node.element_types?.length
    ? [`element_types: List<${node.element_types.join(" | ")}>`]
    : [];
  steps.push({
    id: `schema:${path}`,
    instruction: `Write ${path}`,
    actor: "agent",
    artifact: path,
    format: schemaNodeArtifactFormat(node),
    details: definitionDetails(node.defines)
      .concat(elementTypeDetails)
      .concat((node.asserts ?? []).map((value) => `asserts: ${value}`))
  });

  for (const child of node.fields ?? []) {
    if (typeof child === "string") {
      const childPath = `${path}.${child}`;
      steps.push({
        id: `schema:${childPath}`,
        instruction: `Write ${childPath}`,
        actor: "agent",
        artifact: childPath,
        format: "string"
      });
      continue;
    }
    walkSchema(child, `${path}.${child.names[0]}`, steps);
  }
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
      details.push(...definition.asserts.map((value) => `asserts: ${value}`));
      continue;
    }
    details.push(...definitionDetails(definition.defines));
    details.push(...(definition.asserts ?? []).map((value) => `asserts: ${value}`));
  }
  return details;
}

function schemaNodeArtifactFormat(node: SchemaNode): ArtifactFormat {
  return node.format === "table" || node.fields?.length || node.element_types?.length ? "markdown" : "string";
}

async function findMemoryByName(memoryRoot: string, kind: "procedures" | "schemas", name: string): Promise<MemoryFile | undefined> {
  const paths = await listMemoryFiles(memoryRoot, kind);

  for (const path of paths) {
    try {
      const file = await readMemoryFile(kind, path);
      if (file.entity.names.includes(name)) return file;
    } catch {
      // Run lookup should not be blocked by unrelated invalid memories.
    }
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
  await mkdir(join(runsRoot, run.id), { recursive: true });
  await writeFile(runPath(runsRoot, run.id), `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

function makeRunId(iso: string): string {
  const stamp = iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-").toLowerCase();
  return `run-${stamp}-${randomUUID().slice(0, 8)}`;
}
