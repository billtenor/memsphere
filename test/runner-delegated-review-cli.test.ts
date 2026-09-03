import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runReviewSubmitForHumanCommand } from "../src/commands/run.js";
import { parseControlPlaneConfig } from "../src/control-plane/index.js";
import { currentArtifactReview, readRun, reportRun, startRun } from "../src/run/store.js";
import { runGit } from "../src/git.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";
import { reviewConfiguration } from "./helpers/review.js";

const builtCliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

test("submit-for-human CLI writes delegated opinions and returns JSON/text receipts", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-delegated-cli-"));
  const home = join(root, "home");
  const projectRoot = join(root, "project");
  const memoryRoot = join(projectRoot, "memory");
  const runsRoot = join(projectRoot, "runs");
  const projectName = "delegated-cli";
  const previousCwd = process.cwd();
  const previousHome = process.env.MEMSPHERE_HOME;
  const previousProject = process.env.MEMSPHERE_PROJECT;
  try {
    await mkdir(join(memoryRoot, "procedures"), { recursive: true });
    await mkdir(runsRoot, { recursive: true });
    await mkdir(join(projectRoot, "reviews"), { recursive: true });
    await runGit(["init", "-b", "master"], { cwd: projectRoot });
    await writeFile(join(memoryRoot, "procedures", "delegated-cli.yaml"), withCurrentMemorySyntax(`!procedure
name: delegated-cli
flow:
  - !action
    action: Produce a reviewed Artifact.
    artifact: !artifact
      name: reviewed result
      review: [reviewer]
`));
    const controlPlane = parseControlPlaneConfig({
      runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
      actors: { human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] } }
    });
    await mkdir(home, { recursive: true });
    await writeFile(join(projectRoot, "project.json"), `${JSON.stringify({
      format_version: 1, name: projectName, created_at: new Date().toISOString()
    })}\n`);
    await writeFile(join(projectRoot, "config.json"), `${JSON.stringify({
      store: { type: "embedded", repository_path: projectRoot, memory_path: "memory" },
      control_plane: {
        runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
        actors: { human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] } }
      }
    })}\n`);
    await writeFile(join(home, "registry.json"), `${JSON.stringify({
      format_version: 1, projects: { [projectName]: { root: projectRoot } }, workspaces: {}
    })}\n`);
    process.env.MEMSPHERE_HOME = home;
    process.env.MEMSPHERE_PROJECT = projectName;
    process.chdir(projectRoot);

    const createReview = async (name: string) => {
      const started = await startRun({
        name, memoryRoot, runsRoot, procedureName: "delegated-cli", controlPlane,
        reviewConfiguration: reviewConfiguration({ procedure: "delegated-cli", slots: { reviewer: ["human"] } })
      });
      const pending = await reportRun({
        runsRoot, runId: started.id, artifact: { kind: "inline", value: `candidate ${name}` }
      });
      return { started, review: currentArtifactReview(pending)! };
    };

    const jsonCase = await createReview("json receipt");
    const commentsPath = join(root, "comments.json");
    const summaryPath = join(root, "summary.md");
    const notePath = join(root, "authorization.txt");
    await writeFile(commentsPath, JSON.stringify([
      { body: "First requested change." }, { body: "Second requested change." }
    ]));
    await writeFile(summaryPath, "Please address both comments.\n");
    await writeFile(notePath, "Human explicitly authorized this request_changes submission.\n");
    const jsonResult = runBuiltCli(projectRoot, home, projectName, [
      "run", "review", "submit-for-human",
      "--run", jsonCase.started.id,
      "--review", jsonCase.review.id,
      "--round", jsonCase.review.currentRoundId,
      "--assignment", "human",
      "--vote", "request_changes",
      "--comments-file", commentsPath,
      "--summary-file", summaryPath,
      "--authorization-note-file", notePath,
      "--output", "json"
    ]);
    assert.equal(jsonResult.status, 0, jsonResult.stderr);
    assert.equal(jsonResult.stderr, "");
    const receipt = JSON.parse(jsonResult.stdout) as Record<string, unknown>;
    assert.equal(receipt.runId, jsonCase.started.id);
    assert.equal(receipt.vote, "request_changes");
    assert.equal(receipt.commentCount, 2);
    assert.equal(receipt.delegatedBy, "runner");
    assert.equal(receipt.roundStatus, "changes_requested");
    assert.deepEqual(receipt.nextAction, { kind: "revision", runId: jsonCase.started.id });
    const persisted = await readRun(runsRoot, jsonCase.started.id);
    const opinion = currentArtifactReview(persisted)!.rounds[0]!.assignments[0]!.submitted!;
    assert.deepEqual(opinion.comments.map((comment) => comment.body), [
      "First requested change.", "Second requested change."
    ]);
    assert.equal(opinion.summary, "Please address both comments.");
    assert.equal(opinion.delegation?.humanActorId, "human");
    assert.equal(opinion.delegation?.runId, jsonCase.started.id);
    assert.equal(opinion.delegation?.authorizationNote, "Human explicitly authorized this request_changes submission.");

    await assert.rejects(runReviewSubmitForHumanCommand({
      run: jsonCase.started.id, review: jsonCase.review.id, round: jsonCase.review.currentRoundId,
      assignment: "human", vote: "approve", commentsFile: commentsPath,
      authorizationNote: "Different payload", output: "text"
    }), /submission conflict/);
    assert.equal(currentArtifactReview(await readRun(runsRoot, jsonCase.started.id))!.rounds[0]!.votes.length, 1);

    const textCase = await createReview("text receipt");
    const emptyCommentsPath = join(root, "empty-comments.json");
    await writeFile(emptyCommentsPath, "[]\n");
    const textResult = runBuiltCli(projectRoot, home, projectName, [
      "run", "review", "submit-for-human",
      "--run", textCase.started.id,
      "--review", textCase.review.id,
      "--round", textCase.review.currentRoundId,
      "--assignment", "human",
      "--vote", "approve",
      "--comments-file", emptyCommentsPath,
      "--authorization-note", "Human explicitly approved this Review.",
      "--output", "text"
    ]);
    assert.equal(textResult.status, 0, textResult.stderr);
    assert.equal(textResult.stderr, "");
    assert.match(textResult.stdout, new RegExp(textCase.started.id));
    assert.match(textResult.stdout, /Runner 代 Human 提交评审成功/);
    assert.match(textResult.stdout, /- 投票：通过/);
    assert.match(textResult.stdout, /- Comment 数：0/);
    assert.match(textResult.stdout, /- 受托提交者：runner/);
    assert.match(textResult.stdout, /memsphere run review vote --review/);
    const textPersisted = await readRun(runsRoot, textCase.started.id);
    const textOpinion = currentArtifactReview(textPersisted)!.rounds[0]!.assignments[0]!.submitted!;
    assert.equal(textOpinion.vote, "approve");
    assert.deepEqual(textOpinion.comments, []);
    assert.equal(textOpinion.delegation?.kind, "runner");
    assert.equal(textOpinion.delegation?.authorizationNote, "Human explicitly approved this Review.");

    const rejectedCase = await createReview("rejected inputs");
    const base = {
      run: rejectedCase.started.id, review: rejectedCase.review.id, round: rejectedCase.review.currentRoundId,
      assignment: "human", vote: "request_changes", commentsFile: emptyCommentsPath, output: "text" as const
    };
    await assert.rejects(runReviewSubmitForHumanCommand({
      ...base, authorizationNote: "Explicit authorization."
    }), /requires at least one Comment/);
    await assert.rejects(runReviewSubmitForHumanCommand(base), /exactly one/);
    await assert.rejects(runReviewSubmitForHumanCommand({
      ...base, authorizationNote: "inline", authorizationNoteFile: notePath
    }), /exactly one/);
    const failedResult = runBuiltCli(projectRoot, home, projectName, [
      "run", "review", "submit-for-human",
      "--run", rejectedCase.started.id,
      "--review", rejectedCase.review.id,
      "--round", rejectedCase.review.currentRoundId,
      "--assignment", "human",
      "--vote", "request_changes",
      "--comments-file", emptyCommentsPath,
      "--authorization-note", "Explicit authorization.",
      "--output", "json"
    ]);
    assert.notEqual(failedResult.status, 0);
    assert.match(failedResult.stderr, /requires at least one Comment/);
    assert.equal(currentArtifactReview(await readRun(runsRoot, rejectedCase.started.id))!.rounds[0]!.assignments[0]!.submitted, undefined);
  } finally {
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previousHome;
    if (previousProject === undefined) delete process.env.MEMSPHERE_PROJECT;
    else process.env.MEMSPHERE_PROJECT = previousProject;
    await rm(root, { recursive: true, force: true });
  }
});

function runBuiltCli(
  cwd: string,
  home: string,
  project: string,
  args: string[]
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [builtCliPath, ...args], {
    cwd,
    env: { ...process.env, MEMSPHERE_HOME: home, MEMSPHERE_PROJECT: project },
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function captureOutput(operation: () => Promise<void>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...values: unknown[]) => { lines.push(values.map(String).join(" ")); };
  try {
    await operation();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}
