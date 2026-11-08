import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runGit } from "../src/git.js";



import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";



import { objectSchema } from "./helpers/business-data.js";
import { initializedModelFixture } from "./helpers/initialized-context.js";
import { readData, listData } from "../src/project/data-service.js";

import { startRun, reportRun, readRun, currentStep, currentArtifactReview, submitArtifactReviewHumanAssignmentForRunner, submitArtifactReviewRunnerVote } from "../src/run/store.js";
import { parseControlPlaneConfig } from "../src/control-plane/index.js";
import { reviewConfiguration } from "./helpers/review.js";





const action = (review = false, type = "object", format = "json") => `  - !action
    action: Produce a model value.
    artifact: !artifact
      name: result
      type: ${type}
      format: ${format}
      store: records
${review ? '      review: [owner]\n' : ''}`;
async function fixture(t: TestContext, flow = action(), schemas?: Record<string, unknown>) {
  const f = await initializedModelFixture(t, schemas ?? { "record.json": objectSchema }); await f.createStore();
  const memoryRoot = join(f.root, "memory"); const runsRoot = join(f.root, "runs");
  await fs.mkdir(join(memoryRoot, "procedures"), { recursive: true });
  const save = (name: string, body: string) => fs.writeFile(join(memoryRoot, "procedures", `${name}.yaml`), `!procedure\nsyntax: memsphere-20260721-stable\nname: ${name}\nflow:\n${body}`);
  await save("model-flow", flow);
  const start = (review = false) => startRun({ memoryRoot, runsRoot, projectRoot: f.root, procedureName: "model-flow", name: "Model test", ...(review ? {
    controlPlane: parseControlPlaneConfig({ runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { human: { kind: "human", name: "Owner", permissions: ["artifact.read", "decision.decide"] } } }),
    reviewConfiguration: reviewConfiguration({ procedure: "model-flow", slots: { owner: ["human"] } })
  } : {}) });
  const report = (runId: string, value = '{"name":"original","count":1}', revisionSummary?: string, dataId?: string) => reportRun({ runsRoot, runId, artifact: { kind: "inline", value }, revisionSummary, writeOptions: dataId === undefined ? undefined : { data_id: dataId } });
  return { ...f, memoryRoot, runsRoot, save, start, report };
}

async function reviewVote(f: Awaited<ReturnType<typeof fixture>>, runId: string, vote: "approve" | "request_changes") {
  const run = await readRun(f.runsRoot, runId); const review = currentArtifactReview(run)!;
  await submitArtifactReviewHumanAssignmentForRunner({ runsRoot: f.runsRoot, runId, reviewId: review.id, roundId: review.currentRoundId, assignmentId: "human", vote, comments: vote === "approve" ? [] : [{ body: "Revise the value." }], authorizationNote: `Fixture Human ${vote}.` });
  if (vote === "approve") await submitArtifactReviewRunnerVote({ runsRoot: f.runsRoot, reviewId: review.id, roundId: review.currentRoundId, vote });
}

test("real CLI report forwards explicit ID and exposes it in the receipt", async t => {
  const f = await fixture(t); const run = await f.start();
  const configPath = join(f.root, "config.json"); const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  config.store = { type: "embedded", repository_path: f.root, memory_path: "memory" };
  await fs.writeFile(configPath, JSON.stringify(config)); await runGit(["init", "-b", "master"], { cwd: f.root });
  const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const cli = (...args: string[]) => spawnSync(process.execPath, [cliPath, "--project", "test-project", "run", "report", "--run", run.id, "--artifact", '{"name":"cli","count":1}', ...args], { cwd: f.root, env: { ...process.env, MEMSPHERE_HOME: f.home }, encoding: "utf8" });
  for (const value of ["", "{", "null", "[]", '"task"', '{"data_id":null}', '{"data_id":1}', '{"data_id":""}', '{"data_id":"task","expected_revision":3}', "@options.json", "data_id: task"]) {
    const invalid = cli("--write-options", value); assert.equal(invalid.status, 1, value); assert.match(invalid.stderr, /write-options|data_id/);
    const state = await readRun(f.runsRoot, run.id);
    assert.equal(state.events.length, 0); assert.equal(currentStep(state)!.stepExecutionId, undefined);
    assert.deepEqual((await listData({}, f.root, "records")).items, []);
  }
  const removed = cli("--data-id", "task"); assert.equal(removed.status, 1); assert.match(removed.stderr, /unknown option/);
  const result = cli("--write-options", '{"data_id":"cli-task"}'); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /data_id: cli-task/);
  assert.deepEqual((await readData({}, f.root, "records", "cli-task")).value, { name: "cli", count: 1 });
});