import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { archiveRun } from "../src/archive/store.js";
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
import { reviewConfiguration } from "./helpers/review.js";

test("Artifact Review View API isolates drafts and settles the Run once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-artifact-review-view-"));
  const memoryRoot = join(dir, "memory");
  const runsRoot = join(dir, "runs");
  const reviewsRoot = join(dir, "reviews");
  const archiveRoot = join(dir, "archives");
  await mkdir(join(memoryRoot, "procedures"), { recursive: true });
  await mkdir(reviewsRoot, { recursive: true });
  await writeFile(join(memoryRoot, "procedures", "reviewed.yaml"), withCurrentMemorySyntax(`!procedure
name: reviewed-in-view
flow:
  - !action
    action: Produce a reviewed Artifact.
    artifact: !artifact
      name: reviewed result
      format: markdown
      review: [Decider, Advisor]
`));
  const controlPlane = parseControlPlaneConfig({
    runner: {
      permissions: ["artifact.read", "artifact.submit", "decision.decide"]
    },
    actors: {
      alice: {
        kind: "human",
        name: "Alice",
        permissions: ["artifact.read", "decision.decide"]
      },
      bob: {
        kind: "human",
        name: "Bob",
        permissions: ["artifact.read", "decision.assess"]
      },
      mallory: { kind: "human", name: "Mallory", permissions: ["artifact.read"] }
    }
  });
  const started = await startRun({
    name: "Test run",
    memoryRoot,
    runsRoot,
    procedureName: "reviewed-in-view",
    controlPlane,
    reviewConfiguration: reviewConfiguration({
      procedure: "reviewed-in-view",
      slots: { Decider: ["alice"], Advisor: ["bob"] }
    })
  });
  const pending = await reportRun({
    runsRoot,
    runId: started.id,
    artifact: { kind: "inline", value: "# Private candidate\n" }
  });
  const review = currentArtifactReview(pending);
  assert(review);
  const privateAttempt = review.rounds[0].assignments.find((assignment) => assignment.actorId === "bob");
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
    archiveRoot,
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

    const summaryResponse = await fetch(`${base}/api/runs?representation=summary`);
    assert.equal(summaryResponse.status, 200);
    const summarySource = await summaryResponse.text();
    const summaryPayload = JSON.parse(summarySource) as {
      runs: Array<{ id: string; eventCount: number; reviewProgress?: { id: string; submitted: number; total: number } }>;
    };
    const runSummary = summaryPayload.runs.find((candidate) => candidate.id === started.id);
    assert.deepEqual(runSummary?.reviewProgress, {
      id: review.id,
      status: "pending",
      currentRoundId: review.currentRoundId,
      updatedAt: pending.updatedAt,
      submitted: 0,
      total: 2
    });
    assert.equal(runSummary?.eventCount, 0);
    assert.doesNotMatch(summarySource, /artifactReviews|Private candidate|attempt-private/);

    const roundPath = `${base}/api/artifact-reviews/${review.id}/rounds/${review.currentRoundId}`;
    const directRoundPath = `${base}/api/runs/${started.id}/artifact-reviews/${review.id}/rounds/${review.currentRoundId}`;
    const publicInitial = await fetch(roundPath);
    assert.equal(publicInitial.status, 200);
    const publicContext = await publicInitial.json() as ReviewContext;
    assert.equal(publicContext.assignment, undefined);
    assert.equal(publicContext.submission.artifact.content, "# Private candidate\n");
    assert.equal(publicContext.rounds[0]?.assignments.length, 2);
    const directInitial = await fetch(`${directRoundPath}?actor_id=alice`);
    assert.equal(directInitial.status, 200);
    assert.equal((await directInitial.json() as ReviewContext).assignment.actorId, "alice");

    const aliceInitial = await fetch(`${roundPath}?actor_id=alice`);
    assert.equal(aliceInitial.status, 200);
    const aliceInitialSource = await aliceInitial.text();
    assert.match(aliceInitialSource, /"provider":\s*"traex"/);
    assert.match(aliceInitialSource, /Visible retry reason/);
    assert.match(aliceInitialSource, /"category":\s*"environment"/);
    assert.doesNotMatch(aliceInitialSource, /attempt-private|workerPid|cliReadyAt|private-prompt|private-session|protocolVersion|private-agent|private-version|private-model|private-stop|"authorization"/);
    const aliceContext = JSON.parse(aliceInitialSource) as ReviewContext;
    assert.equal(aliceContext.submission.artifact.content, "# Private candidate\n");
    assert.equal(aliceContext.assignment.actorId, "alice");
    const unassigned = await fetch(`${roundPath}?actor_id=mallory`);
    assert.equal(unassigned.status, 403);

    const aliceDraft = await mutate(`${roundPath}/assignments/alice/draft`, "PATCH", {
      expectedRevision: aliceContext.review.round.revision,
      vote: "approve",
      comments: [{ body: "Alice private draft" }]
    });
    assert.equal(aliceDraft.status, 200);
    const aliceDraftContext = await aliceDraft.json() as ReviewContext;

    const bobRead = await fetch(`${roundPath}?actor_id=bob`);
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
      (assignment) => assignment.actorId === "bob"
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

    const aliceRefresh = await fetch(`${roundPath}?actor_id=alice`);
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

    const completedEvidence = await fetch(`${roundPath}?actor_id=alice`);
    assert.equal(completedEvidence.status, 200);
    const completedEvidenceContext = await completedEvidence.json() as ReviewContext;
    assert.equal(completedEvidenceContext.submission.artifact.content, "# Private candidate\n");
    assert.match(JSON.stringify(completedEvidenceContext.rounds), /Advisory suggestion/);
    const advisory = completedEvidenceContext.rounds[0]?.assignments.find(
      (assignment) => assignment.actorId === "bob"
    )?.submitted?.comments[0];
    assert.equal(advisory?.body, "Advisory suggestion\\n\\nSecond paragraph");
    assert.match(advisory?.renderedBody ?? "", /<p>Advisory suggestion<\/p>\s*<p>Second paragraph<\/p>/);

    await archiveRun({ archiveRoot, runsRoot, id: started.id });
    const archivedDetail = await fetch(`${base}/api/runs/${started.id}`);
    assert.equal(archivedDetail.status, 200);
    assert.equal((await archivedDetail.json() as { run: { readOnly?: boolean } }).run.readOnly, true);
    const archivedEvidence = await fetch(`${directRoundPath}?actor_id=alice`);
    assert.equal(archivedEvidence.status, 200);
    assert.equal((await archivedEvidence.json() as ReviewContext).submission.artifact.content, "# Private candidate\n");
    const activeSummaries = await fetch(`${base}/api/runs?representation=summary`).then(response => response.json()) as {
      runs: Array<{ id: string }>;
    };
    assert.equal(activeSummaries.runs.some((candidate) => candidate.id === started.id), false);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      const archivedReviewUrl = `${base}/tasks/${started.id}/artifact-reviews/${review.id}`
        + `?round=${review.currentRoundId}`;
      const directContextRequests: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith(`/api/runs/${started.id}/artifact-reviews/${review.id}/rounds/`)) {
          directContextRequests.push(url.pathname);
        }
      });
      await page.goto(archivedReviewUrl);
      const archivedModal = page.locator("#artifact-review-modal[open]");
      await archivedModal.waitFor();
      await archivedModal.getByText("Private candidate", { exact: true }).waitFor();

      const summaryRefresh = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/runs" && url.searchParams.get("representation") === "summary";
      });
      assert.equal((await summaryRefresh).status(), 200);
      await page.waitForFunction(() => document.querySelector("#count")?.textContent === "0 个运行");
      assert.equal(new URL(page.url()).pathname, `/tasks/${started.id}/artifact-reviews/${review.id}`);
      assert.equal(await archivedModal.isVisible(), true);
      await archivedModal.getByText("Private candidate", { exact: true }).waitFor();
      assert.equal(directContextRequests.every(path => path.includes(`/api/runs/${started.id}/`)), true);
      assert.equal(await page.locator(".task-card").count(), 0);
      assert.equal(await page.locator("#count").textContent(), "0 个运行");
    } finally {
      await browser.close();
    }
  } finally {
    server.close();
    await once(server, "close");
    await rm(dir, { recursive: true, force: true });
  }
});

test("non-loopback View updates Run Slot bindings without the Settings token and still rejects forged origins", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-run-binding-view-"));
  const memoryRoot = join(dir, "memory");
  const runsRoot = join(dir, "runs");
  const reviewsRoot = join(dir, "reviews");
  await mkdir(join(memoryRoot, "procedures"), { recursive: true });
  await mkdir(reviewsRoot, { recursive: true });
  await writeFile(join(memoryRoot, "procedures", "handoff.yaml"), withCurrentMemorySyntax(`!procedure
name: view-handoff
flow:
  - !action
    action: Produce it.
    artifact: !artifact
      name: result
      review: [owner]
`));
  const controlPlane = parseControlPlaneConfig({
    runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
    actors: {
      human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] },
      agent: {
        kind: "agent",
        name: "Agent",
        permissions: ["artifact.read", "decision.assess"],
        agent: { provider: "traex" }
      }
    }
  });
  const started = await startRun({
    name: "View binding handoff",
    memoryRoot,
    runsRoot,
    procedureName: "view-handoff",
    controlPlane,
    reviewConfiguration: reviewConfiguration({ procedure: "view-handoff", slots: { owner: ["human"] } })
  });
  const config: MemsphereConfig = {
    configPath: join(dir, "config.json"),
    scopeRoot: dir,
    memoryRoot,
    reviewsRoot,
    runsRoot,
    archiveRoot: join(dir, "archives"),
    view: { host: "0.0.0.0", port: 0 },
    controlPlane
  };
  const server = createViewServer(config, { settingsToken: "settings-secret" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const endpoint = `http://127.0.0.1:${address.port}/api/runs/${started.id}/bindings`;
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/settings/global`)).status, 401);
    const initial = await fetch(endpoint);
    assert.equal(initial.status, 200);
    assert.deepEqual((await initial.json() as { slots: Array<{ binding: unknown }> }).slots[0].binding, { actorIds: ["human"] });

    const rejectedOrigin = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot: "view-handoff::owner", actorIds: ["agent"] })
    });
    assert.equal(rejectedOrigin.status, 403);

    const forgedOrigin = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ slot: "view-handoff::owner", actorIds: ["agent"] })
    });
    assert.equal(forgedOrigin.status, 403);

    const nonJson = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "text/plain", origin: new URL(endpoint).origin },
      body: JSON.stringify({ slot: "view-handoff::owner", actorIds: ["agent"] })
    });
    assert.equal(nonJson.status, 403);

    const updated = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(endpoint).origin },
      body: JSON.stringify({ slot: "view-handoff::owner", actorIds: ["agent"] })
    });
    assert.equal(updated.status, 200);
    const payload = await updated.json() as { change: { before: unknown; after: unknown } };
    assert.deepEqual(payload.change.before, { actorIds: ["human"] });
    assert.deepEqual(payload.change.after, { actorIds: ["agent"] });

    const invalid = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(endpoint).origin },
      body: JSON.stringify({ slot: "view-handoff::owner", actorIds: ["missing"] })
    });
    assert.equal(invalid.status, 400);
    assert.match(await invalid.text(), /unknown frozen Actor/);
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
    actorId: string;
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
      actorId: string;
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
