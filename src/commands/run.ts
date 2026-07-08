import { readConfig } from "../config.js";
import {
  type ArtifactReportSource,
  currentFrame,
  currentStep,
  enterSchema,
  listRuns,
  readRun,
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
  printNext(run);
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
  printNext(run);
}

export async function runEnterSchemaCommand(schemaName: string, options: RunIdOptions): Promise<void> {
  const runId = requireRunId(options.run);
  const config = await readConfig();
  const run = await enterSchema({
    memoryRoot: config.memoryRoot,
    runsRoot: config.runsRoot,
    runId,
    schemaName
  });
  printNext(run);
}

export async function runStatusCommand(options: RunIdOptions): Promise<void> {
  const config = await readConfig();
  if (options.run) {
    printNext(await readRun(config.runsRoot, options.run));
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

function printNext(run: RunState): void {
  console.log(`run ${run.id}`);

  if (run.status === "done") {
    console.log("done");
    return;
  }

  const frame = currentFrame(run);
  const step = currentStep(run);
  if (!frame || !step || !step.artifact || !step.format) {
    console.log("done");
    return;
  }

  console.log("");
  console.log("Actor:");
  console.log(step.actor === "human" ? "human" : "agent");

  console.log("");
  console.log(step.actor === "human" ? "Ask human to do:" : "Do:");
  console.log(step.instruction);

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
    const schemaName = step.schemaName ?? step.artifact;
    console.log("Then:");
    console.log(`vibe-mem run enter-schema ${schemaName} --run ${run.id}`);
  } else {
    console.log("Then:");
    console.log(`vibe-mem run report --run ${run.id} --artifact <value>`);
  }
}
