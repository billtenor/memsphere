import { readConfig } from "../config.js";
import {
  activeProcedureAsserts,
  type ArtifactReportSource,
  currentFrame,
  currentStep,
  enterSchema,
  finalArtifacts,
  listRuns,
  readRun,
  repeatRun,
  reportRun,
  startRun,
  type RunState
} from "../run/store.js";

type ReportOptions = {
  run?: string;
  artifact?: string;
  artifactFile?: string;
};

type RunIdOptions = {
  run?: string;
};

export async function runStartCommand(procedureName: string): Promise<void> {
  const config = await readConfig();
  const run = await startRun({
    memoryRoot: config.memoryRoot,
    runsRoot: config.runsRoot,
    procedureName
  });
  printRunState(run);
}

export async function runReportCommand(options: ReportOptions): Promise<void> {
  const runId = requireRunId(options.run);
  const artifact = readArtifactOption(options);
  const config = await readConfig();
  const run = await reportRun({
    runsRoot: config.runsRoot,
    runId,
    artifact
  });
  printRunState(run);
}

export async function runEnterSchemaCommand(schemaName: string | undefined, options: RunIdOptions): Promise<void> {
  const runId = requireRunId(options.run);
  const config = await readConfig();
  const run = await enterSchema({
    memoryRoot: config.memoryRoot,
    runsRoot: config.runsRoot,
    runId,
    schemaName
  });
  printRunState(run);
}

export async function runRepeatCommand(countValue: string, options: RunIdOptions): Promise<void> {
  const runId = requireRunId(options.run);
  if (!/^\d+$/.test(countValue)) {
    throw new Error("repeat count must be a non-negative integer");
  }
  const count = Number(countValue);
  if (!Number.isSafeInteger(count)) {
    throw new Error("repeat count must be a safe integer");
  }
  const config = await readConfig();
  const run = await repeatRun({ runsRoot: config.runsRoot, runId, count });
  printRunState(run);
}

export async function runStatusCommand(options: RunIdOptions): Promise<void> {
  const config = await readConfig();
  if (options.run) {
    printRunState(await readRun(config.runsRoot, options.run));
    return;
  }

  const runs = await listRuns(config.runsRoot);
  if (!runs.length) {
    console.log("No runs found.");
    return;
  }

  for (const run of runs) {
    console.log(`${run.id} ${run.status} ${run.procedureName}`);
  }
}

function readArtifactOption(options: ReportOptions): ArtifactReportSource {
  if (typeof options.artifact === "string") {
    return { kind: "inline", value: options.artifact };
  }
  if (options.artifactFile) {
    return { kind: "file", path: options.artifactFile };
  }
  throw new Error("report requires --artifact <value> or --artifact-file <path>");
}

function requireRunId(value: string | undefined): string {
  const runId = value?.trim();
  if (!runId) {
    throw new Error("--run <id> is required");
  }
  return runId;
}

export function printRunState(run: RunState): void {
  console.log(`run ${run.id}`);

  if (run.status === "done") {
    console.log("done");
    const finals = finalArtifacts(run);
    if (finals.length) {
      console.log("");
      console.log("Final Artifacts:");
      for (const artifact of finals) console.log(`- ${artifact.name}${artifact.path ? `: ${artifact.path}` : ""}`);
    }
    return;
  }

  const frame = currentFrame(run);
  const step = currentStep(run);
  if (frame && step?.kind === "repeat" && step.repeat) {
    const max = step.repeat.max === undefined ? "unbounded" : String(step.repeat.max);
    console.log("");
    console.log("Actor:");
    console.log("agent");
    console.log("");
    console.log("Do:");
    console.log(step.instruction);
    console.log("");
    console.log("Details:");
    console.log(`- allowed count: ${step.repeat.min}..${max}`);
    console.log(`- body fields: ${step.repeat.body.length}`);
    console.log("");
    console.log("Then:");
    console.log(`memsphere run repeat <count> --run ${run.id}`);
    return;
  }
  if (!frame || !step || !step.artifact || !step.format) {
    console.log("done");
    return;
  }

  const procedureAsserts = activeProcedureAsserts(run);
  if (procedureAsserts.length) {
    console.log("");
    console.log("Procedure Asserts:");
    for (const value of procedureAsserts) console.log(`- ${value}`);
  }

  console.log("");
  console.log("Actor:");
  console.log(step.actor === "human" ? "human" : "agent");

  console.log("");
  console.log(step.actor === "human" ? "Ask human to do:" : "Do:");
  console.log(step.instruction);

  if (step.asserts?.length) {
    console.log("");
    console.log("Asserts:");
    for (const value of step.asserts) console.log(`- ${value}`);
  }

  if (step.suggests?.length) {
    console.log("");
    console.log("Suggests:");
    for (const value of step.suggests) console.log(`- ${value}`);
  }

  if (step.details?.length) {
    console.log("");
    console.log("Details:");
    for (const detail of step.details) {
      console.log(`- ${detail}`);
    }
  }

  console.log("");
  console.log("Artifact:");
  console.log(`${step.artifact} (${step.format})`);
  if (step.actor === "human") {
    console.log("Report the artifact value provided by the human.");
  }

  console.log("");
  if (step.format === "schema") {
    console.log("Then:");
    if (step.inlineSchema) {
      console.log(`memsphere run enter-schema --run ${run.id}`);
    } else {
      console.log(`memsphere run enter-schema ${step.schemaName ?? step.artifact} --run ${run.id}`);
    }
  } else {
    console.log("Then:");
    console.log(`memsphere run report --run ${run.id} --artifact <value>`);
  }
}
