import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createViewServer } from "../src/commands/view.js";
import type { MemsphereConfig } from "../src/config.js";
import { parseControlPlaneConfig } from "../src/control-plane/index.js";
import {
  currentArtifactReview,
  readRun,
  reportRun,
  resolveArtifactReviewComment,
  startRun,
  submitArtifactReviewRunnerVote
} from "../src/run/store.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

test("Artifact Review View API isolates drafts and settles the Run once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-artifact-review-view-"));
  const memoryRoot = join(dir, "memory");
  const runsRoot = join(dir, "runs");
  const reviewsRoot = join(dir, "reviews");
  await mkdir(join(memoryRoot, "procedures"), { recursive: true });
  await mkdir(reviewsRoot, { recursive: true });
  await writeFile(join(memoryRoot, "procedures", "reviewed.yaml"), withCurrentMemorySyntax(`!procedure
name: reviewed-in-view
role_bindings:
  decider: alice
  advisor: bob
flow:
  - !action
    action: Produce a reviewed Artifact.
    artifact: !artifact
      name: reviewed result
      format: markdown
      review: artifact_acceptance.unanimous
`));
  const controlPlane = parseControlPlaneConfig({
    identities: {
      alice: { kind: "human", name: "Alice" },
      bob: { kind: "human", name: "Bob" },
      mallory: { kind: "human", name: "Mallory" }
    },
    roles: {
      runner: {
        name: "Runner",
        permissions: ["artifact.read", "artifact.submit", "decision.decide"]
      },
      decider: {
        name: "Decider",
        permissions: ["artifact.read", "decision.decide"]
      },
      advisor: {
        name: "Advisor",
        permissions: ["artifact.read", "decision.assess"]
      }
    }
  });
  const started = await startRun({ memoryRoot, runsRoot, procedureName: "reviewed-in-view", controlPlane });
  const pending = await reportRun({
    runsRoot,
    runId: started.id,
    artifact: { kind: "inline", value: "# Private candidate\n" }
  });
  const review = currentArtifactReview(pending);
  assert(review);
  const privateAttempt = review.rounds[0].assignments.find((assignment) => assignment.identityId === "bob");
  assert(privateAttempt);
  privateAttempt.attempts = [{
    id: "attempt-private",
    sequence: 1,
    status: "failed",
    provider: "traex",
    createdAt: "2026-07-22T00:00:00.000Z",
    startedAt: "2026-07-22T00:00:01.000Z",
    completedAt: "2026-07-22T00:00:02.000Z",
    workerPid: 4242,
    cliReadyAt: "2026-07-22T00:00:01.500Z",
    promptVersion: "private-prompt",
    sessionId: "private-session",
    protocolVersion: 9,
    agentName: "private-agent",
    agentVersion: "private-version",
    model: "private-model",
    stopReason: "private-stop",
    failure: { stage: "session", code: "review_failed", message: "listen EPERM: Visible retry reason" }
  }];
  await writeFile(
    join(runsRoot, started.id, `${started.id}.json`),
    `${JSON.stringify(pending, null, 2)}\n`
  );

  const config: MemsphereConfig = {
    configPath: join(dir, "config.json"),
    scopeRoot: dir,
    memoryRoot,
    reviewsRoot,
    runsRoot,
    archiveRoot: join(dir, "archives"),
    view: { host: "127.0.0.1", port: 0 },
    controlPlane
  };
  const server = createViewServer(config);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const publicRuns = await fetch(`${base}/api/runs`);
    assert.equal(publicRuns.status, 200);
    const publicSource = await publicRuns.text();
    assert.match(publicSource, /"artifactReview"/);
    assert.match(publicSource, /"artifactReviewSummaries"/);
    assert.match(publicSource, /"provider":\s*"traex"/);
    assert.match(publicSource, /Visible retry reason/);
    assert.match(publicSource, /"category":\s*"environment"/);
    assert.doesNotMatch(publicSource, /artifactReviews|Private candidate/);
    assert.doesNotMatch(publicSource, /attempt-private|workerPid|cliReadyAt|private-prompt|private-session|protocolVersion|private-agent|private-version|private-model|private-stop/);

    const roundPath = `${base}/api/artifact-reviews/${review.id}/rounds/${review.currentRoundId}`;
    const publicInitial = await fetch(roundPath);
    assert.equal(publicInitial.status, 200);
    const publicContext = await publicInitial.json() as ReviewContext;
    assert.equal(publicContext.assignment, undefined);
    assert.equal(publicContext.submission.artifact.content, "# Private candidate\n");
    assert.equal(publicContext.rounds[0]?.assignments.length, 2);

    const aliceInitial = await fetch(`${roundPath}?identity_id=alice`);
    assert.equal(aliceInitial.status, 200);
    const aliceInitialSource = await aliceInitial.text();
    assert.match(aliceInitialSource, /"provider":\s*"traex"/);
    assert.match(aliceInitialSource, /Visible retry reason/);
    assert.match(aliceInitialSource, /"category":\s*"environment"/);
    assert.doesNotMatch(aliceInitialSource, /attempt-private|workerPid|cliReadyAt|private-prompt|private-session|protocolVersion|private-agent|private-version|private-model|private-stop|"authorization"/);
    const aliceContext = JSON.parse(aliceInitialSource) as ReviewContext;
    assert.equal(aliceContext.submission.artifact.content, "# Private candidate\n");
    assert.equal(aliceContext.assignment.identityId, "alice");
    const unassigned = await fetch(`${roundPath}?identity_id=mallory`);
    assert.equal(unassigned.status, 403);

    const aliceDraft = await mutate(`${roundPath}/assignments/alice/draft`, "PATCH", {
      expectedRevision: aliceContext.review.round.revision,
      vote: "approve",
      comments: [{ body: "Alice private draft" }]
    });
    assert.equal(aliceDraft.status, 200);
    const aliceDraftContext = await aliceDraft.json() as ReviewContext;

    const bobRead = await fetch(`${roundPath}?identity_id=bob`);
    assert.equal(bobRead.status, 200);
    const bobSource = await bobRead.text();
    assert.doesNotMatch(bobSource, /Alice private draft/);
    const bobContext = JSON.parse(bobSource) as ReviewContext;

    const stale = await mutate(`${roundPath}/assignments/bob/draft`, "PATCH", {
      expectedRevision: aliceContext.review.round.revision,
      vote: "approve",
      comments: []
    });
    assert.equal(stale.status, 409);

    const bobDraft = await mutate(`${roundPath}/assignments/bob/draft`, "PATCH", {
      expectedRevision: bobContext.review.round.revision,
      vote: "request_changes",
      comments: [{ body: "Advisory suggestion\\n\\nSecond paragraph", severity: "suggestion" }]
    });
    assert.equal(bobDraft.status, 200);
    const bobDraftContext = await bobDraft.json() as ReviewContext;
    const bobSubmit = await mutate(`${roundPath}/assignments/bob/submit`, "POST", {
      expectedRevision: bobDraftContext.review.round.revision
    });
    assert.equal(bobSubmit.status, 200);
    const afterBob = await bobSubmit.json() as ReviewContext;
    assert.equal(afterBob.review.status, "pending");
    const advisoryCommentId = afterBob.rounds[0]?.assignments.find(
      (assignment) => assignment.identityId === "bob"
    )?.submitted?.comments[0]?.id;
    assert(advisoryCommentId);
    await resolveArtifactReviewComment({
      runsRoot,
      reviewId: review.id,
      roundId: review.currentRoundId,
      commentId: advisoryCommentId,
      disposition: "accepted-fixed",
      note: "Applied the advisory suggestion.",
      validationSummary: "Verified in the revised candidate."
    });

    const aliceRefresh = await fetch(`${roundPath}?identity_id=alice`);
    const aliceRefreshedContext = await aliceRefresh.json() as ReviewContext;
    assert.equal(aliceRefreshedContext.assignment.draft.comments[0]?.body, "Alice private draft");
    assert.match(JSON.stringify(aliceRefreshedContext.rounds), /Advisory suggestion/);
    assert.deepEqual(aliceRefreshedContext.rounds[0]?.commentDispositions?.[0], {
      commentId: advisoryCommentId,
      disposition: "accepted-fixed",
      note: "Applied the advisory suggestion.",
      validationSummary: "Verified in the revised candidate.",
      updatedAt: aliceRefreshedContext.rounds[0]?.commentDispositions?.[0]?.updatedAt
    });
    for (const round of aliceRefreshedContext.rounds as Array<{ assignments: Array<Record<string, unknown>> }>) {
      for (const assignment of round.assignments) assert.equal("draft" in assignment, false);
    }
    const aliceSubmit = await mutate(`${roundPath}/assignments/alice/submit`, "POST", {
      expectedRevision: aliceRefreshedContext.review.round.revision
    });
    assert.equal(aliceSubmit.status, 200);
    const settled = await aliceSubmit.json() as ReviewContext;
    assert.equal(settled.review.status, "awaiting_runner_vote");

    const runnerSettled = await submitArtifactReviewRunnerVote({
      runsRoot,
      reviewId: review.id,
      roundId: review.currentRoundId,
      vote: "approve"
    });
    assert.equal(runnerSettled.review.status, "passed");

    const completed = await readRun(runsRoot, started.id);
    assert.equal(completed.status, "done");
    assert.equal(completed.events.length, 1);
    assert.equal(completed.events[0]?.artifact.content, undefined);
    assert.equal(completed.artifactReviews?.[0]?.rounds[0]?.result?.decisionApprove, 2);
    assert.equal(completed.artifactReviews?.[0]?.rounds[0]?.result?.advisoryTotal, 1);

    const completedRunsResponse = await fetch(`${base}/api/runs`);
    assert.equal(completedRunsResponse.status, 200);
    const completedRuns = await completedRunsResponse.json() as {
      runs: Array<{
        id: string;
        artifactReview?: unknown;
        artifactReviewSummaries?: Array<{
          id: string;
          status: string;
          createdAt?: string;
          updatedAt?: string;
        }>;
      }>;
    };
    const completedRun = completedRuns.runs.find((candidate) => candidate.id === started.id);
    assert(completedRun);
    assert.equal(completedRun.artifactReview, undefined);
    assert.equal(completedRun.artifactReviewSummaries?.length, 1);
    assert.equal(completedRun.artifactReviewSummaries?.[0]?.id, review.id);
    assert.equal(completedRun.artifactReviewSummaries?.[0]?.status, "passed");
    assert.equal(typeof completedRun.artifactReviewSummaries?.[0]?.createdAt, "string");
    assert.equal(typeof completedRun.artifactReviewSummaries?.[0]?.updatedAt, "string");

    const completedEvidence = await fetch(`${roundPath}?identity_id=alice`);
    assert.equal(completedEvidence.status, 200);
    const completedEvidenceContext = await completedEvidence.json() as ReviewContext;
    assert.equal(completedEvidenceContext.submission.artifact.content, "# Private candidate\n");
    assert.match(JSON.stringify(completedEvidenceContext.rounds), /Advisory suggestion/);
    const advisory = completedEvidenceContext.rounds[0]?.assignments.find(
      (assignment) => assignment.identityId === "bob"
    )?.submitted?.comments[0];
    assert.equal(advisory?.body, "Advisory suggestion\\n\\nSecond paragraph");
    assert.match(advisory?.renderedBody ?? "", /<p>Advisory suggestion<\/p>\s*<p>Second paragraph<\/p>/);
  } finally {
    server.close();
    await once(server, "close");
    await rm(dir, { recursive: true, force: true });
  }
});

type ReviewContext = {
  review: {
    id: string;
    status: string;
    round: { revision: number };
  };
  submission: { artifact: { content?: string } };
  assignment?: {
    identityId: string;
    draft: { comments: Array<{ body: string }> };
  };
  rounds: Array<{
    commentDispositions?: Array<{
      commentId: string;
      disposition: string;
      note?: string;
      validationSummary?: string;
      updatedAt: string;
    }>;
    assignments: Array<{
      identityId: string;
      submitted?: { comments: Array<{ id: string; body: string; renderedBody?: string }> };
    }>;
  }>;
};

function mutate(url: string, method: "PATCH" | "POST", body: unknown): Promise<Response> {
  return fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
