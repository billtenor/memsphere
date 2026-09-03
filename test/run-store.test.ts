import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile as writeRawFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseControlPlaneConfig } from "../src/control-plane/index.js";
import { memoryKinds } from "../src/memory/kinds.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";
import {
  abandonRun,
  activeProcedureAsserts,
  appendArtifactReviewAgentComment,
  ArtifactAuthorizationFailure,
  ArtifactReviewSubmissionConflictError,
  artifactSchemaName,
  buildRunBindingSnapshot,
  buildSchemaWritingSnapshot,
  claimArtifactReviewAgentAssignment,
  currentArtifactReview,
  currentFrame,
  currentSchemaFinalization,
  currentStep,
  enterSchema,
  ensureCurrentSchemaDraft,
  finalArtifacts,
  markArtifactReviewAgentCliReady,
  readRun,
  repeatRun,
  reportRun,
  submitArtifactReviewAssignment,
  submitArtifactReviewAgentAssignment,
  submitArtifactReviewHumanAssignmentForRunner,
  submitArtifactReviewRunnerVote,
  skipRun,
  startRun,
  updateArtifactReviewDraft,
  updateRunSlotBinding,
  waitForArtifactReview
} from "../src/run/store.js";
import { validateMemoryRoot } from "../src/validation.js";
import { reviewConfiguration } from "./helpers/review.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-test-"));

  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeFile(path: string, data: string): Promise<void> {
  const versioned = /\.ya?ml$/.test(path) && /^!(?:concept|statement|schema|procedure)\n/.test(data)
    ? data.replace(/^(!(?:concept|statement|schema|procedure))\n/, `$1\nsyntax: ${currentMemorySyntax}\n`)
    : data;
  await writeRawFile(path, versioned);
}

async function submitManagedSchemaDraft(runsRoot: string, runId: string) {
  const run = await readRun(runsRoot, runId);
  const finalization = currentSchemaFinalization(run);
  assert(finalization, "expected Schema to await finalization");
  return reportRun({
    runsRoot,
    runId,
    artifact: { kind: "file", path: join(runsRoot, finalization.draft.path) }
  });
}

test("Runner delegated Human review submit records provenance and is idempotent after settlement", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "delegated.yaml"), `!procedure
name: delegated
flow:
  - !action
    action: Produce a reviewed Artifact.
    artifact: !artifact
      name: reviewed result
      format: markdown
      review: [reviewer]
  - !action
    action: Continue.
    artifact: !artifact
      name: continuation
`);
    const controlPlane = parseControlPlaneConfig({
      runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
      actors: {
        human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] }
      }
    });
    const started = await startRun({
      name: "Delegated review",
      memoryRoot,
      runsRoot,
      procedureName: "delegated",
      controlPlane,
      reviewConfiguration: reviewConfiguration({ procedure: "delegated", slots: { reviewer: ["human"] } })
    });
    const reported = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "# Candidate\n" }
    });
    const review = currentArtifactReview(reported)!;
    await assert.rejects(submitArtifactReviewHumanAssignmentForRunner({
      runsRoot,
      runId: started.id,
      reviewId: review.id,
      roundId: review.currentRoundId,
      assignmentId: "human",
      vote: "request_changes",
      comments: [],
      authorizationNote: "Human explicitly requested changes."
    }), /requires at least one Comment/);
    const nonEmptyDraft = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: review.id,
      roundId: review.currentRoundId,
      actorId: "human",
      expectedRevision: 1,
      draft: { vote: "approve", comments: [] }
    });
    await assert.rejects(submitArtifactReviewHumanAssignmentForRunner({
      runsRoot,
      runId: started.id,
      reviewId: review.id,
      roundId: review.currentRoundId,
      assignmentId: "human",
      vote: "approve",
      comments: [],
      authorizationNote: "Human explicitly approved."
    }), ArtifactReviewSubmissionConflictError);
    await updateArtifactReviewDraft({
      runsRoot,
      reviewId: review.id,
      roundId: review.currentRoundId,
      actorId: "human",
      expectedRevision: nonEmptyDraft.round.revision,
      draft: { comments: [] }
    });
    const first = await submitArtifactReviewHumanAssignmentForRunner({
      runsRoot,
      runId: started.id,
      reviewId: review.id,
      roundId: review.currentRoundId,
      assignmentId: "human",
      vote: "request_changes",
      comments: [{ body: "Clarify the authorization boundary." }, { body: "Add the concurrency test." }],
      summary: "Please address both review comments.",
      authorizationNote: "Human explicitly asked the Runner to request changes in this Review."
    });
    assert.equal(first.review.status, "awaiting_revision");
    assert.deepEqual(first.assignment.submitted?.comments.map((comment) => comment.body), [
      "Clarify the authorization boundary.", "Add the concurrency test."
    ]);
    assert.equal(first.assignment.submitted?.authorization.subject.kind, "actor");
    assert.deepEqual(first.assignment.submitted?.delegation && {
      kind: first.assignment.submitted.delegation.kind,
      runId: first.assignment.submitted.delegation.runId,
      humanActorId: first.assignment.submitted.delegation.humanActorId,
      note: first.assignment.submitted.delegation.authorizationNote,
      subject: first.assignment.submitted.delegation.authorization.subject.kind
    }, {
      kind: "runner",
      runId: started.id,
      humanActorId: "human",
      note: "Human explicitly asked the Runner to request changes in this Review.",
      subject: "runner"
    });
    const revision = first.round.revision;
    const retried = await submitArtifactReviewHumanAssignmentForRunner({
      runsRoot,
      runId: started.id,
      reviewId: review.id,
      roundId: review.currentRoundId,
      assignmentId: "human",
      vote: "request_changes",
      comments: [{ body: "Clarify the authorization boundary." }, { body: "Add the concurrency test." }],
      summary: "Please address both review comments.",
      authorizationNote: "Human explicitly asked the Runner to request changes in this Review."
    });
    assert.equal(retried.round.revision, revision);
    assert.equal(retried.round.votes.length, 1);
    await assert.rejects(submitArtifactReviewAssignment({
      runsRoot,
      reviewId: review.id,
      roundId: review.currentRoundId,
      actorId: "human",
      expectedRevision: revision
    }), ArtifactReviewSubmissionConflictError);
    await assert.rejects(submitArtifactReviewHumanAssignmentForRunner({
      runsRoot,
      runId: started.id,
      reviewId: review.id,
      roundId: review.currentRoundId,
      assignmentId: "human",
      vote: "request_changes",
      comments: [{ body: "Clarify the authorization boundary." }, { body: "Add the concurrency test." }],
      summary: "Different.",
      authorizationNote: "Human explicitly asked the Runner to request changes in this Review."
    }), ArtifactReviewSubmissionConflictError);

    const persistedPath = join(runsRoot, started.id, `${started.id}.json`);
    const legacyFixture = JSON.parse(await readFile(persistedPath, "utf8")) as {
      artifactReviews: Array<{ rounds: Array<{ assignments: Array<{ submitted?: Record<string, unknown> }> }> }>;
    };
    const legacySubmitted = legacyFixture.artifactReviews[0]!.rounds[0]!.assignments[0]!.submitted!;
    const delegatedFixture = legacySubmitted.delegation as Record<string, unknown>;
    delegatedFixture.runId = "run-other";
    await writeRawFile(persistedPath, `${JSON.stringify(legacyFixture, null, 2)}\n`);
    await assert.rejects(readRun(runsRoot, started.id), /does not match enclosing Run/);
    delegatedFixture.runId = started.id;
    delegatedFixture.humanActorId = "human-other";
    await writeRawFile(persistedPath, `${JSON.stringify(legacyFixture, null, 2)}\n`);
    await assert.rejects(readRun(runsRoot, started.id), /does not match Assignment/);
    delegatedFixture.humanActorId = "human";
    delegatedFixture.authorizationNote = "";
    await writeRawFile(persistedPath, `${JSON.stringify(legacyFixture, null, 2)}\n`);
    await assert.rejects(readRun(runsRoot, started.id), /authorizationNote/);
    delegatedFixture.authorizationNote = "Human explicitly asked the Runner to request changes in this Review.";
    delete legacySubmitted.delegation;
    await writeRawFile(persistedPath, `${JSON.stringify(legacyFixture, null, 2)}\n`);
    const legacyRead = await readRun(runsRoot, started.id);
    const legacyOpinion = currentArtifactReview(legacyRead)!.rounds[0]!.assignments[0]!.submitted;
    assert.equal(legacyOpinion?.delegation, undefined);
    assert.equal(legacyOpinion?.vote, "request_changes");
    assert.equal(legacyOpinion?.summary, "Please address both review comments.");
    assert.equal("authorization" in (legacyOpinion ?? {}), true);
  });
});

test("direct Human and Runner delegated review submissions serialize in either lock order", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "delegated-race.yaml"), `!procedure
name: delegated-race
flow:
  - !action
    action: Produce a reviewed Artifact.
    artifact: !artifact
      name: reviewed result
      review: [reviewer]
  - !action
    action: Continue.
    artifact: !artifact
      name: continuation
`);
    const controlPlane = parseControlPlaneConfig({
      runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
      actors: {
        human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] }
      }
    });
    const createReview = async (name: string) => {
      const started = await startRun({
        name,
        memoryRoot,
        runsRoot,
        procedureName: "delegated-race",
        controlPlane,
        reviewConfiguration: reviewConfiguration({ procedure: "delegated-race", slots: { reviewer: ["human"] } })
      });
      const pending = await reportRun({
        runsRoot,
        runId: started.id,
        artifact: { kind: "inline", value: `candidate ${name}` }
      });
      return { started, review: currentArtifactReview(pending)! };
    };

    const directFirst = await createReview("direct first");
    const drafted = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: directFirst.review.id,
      roundId: directFirst.review.currentRoundId,
      actorId: "human",
      expectedRevision: directFirst.review.rounds[0]!.revision,
      draft: { vote: "approve", comments: [] }
    });
    const directPromise = submitArtifactReviewAssignment({
      runsRoot,
      reviewId: directFirst.review.id,
      roundId: directFirst.review.currentRoundId,
      actorId: "human",
      expectedRevision: drafted.round.revision
    });
    await waitForRunWriteLock(runsRoot, directFirst.started.id);
    const delegatedBehindDirect = submitArtifactReviewHumanAssignmentForRunner({
      runsRoot,
      runId: directFirst.started.id,
      reviewId: directFirst.review.id,
      roundId: directFirst.review.currentRoundId,
      assignmentId: "human",
      vote: "approve",
      comments: [],
      authorizationNote: "Human authorized the concurrent delegated submission."
    });
    const directRace = await Promise.allSettled([directPromise, delegatedBehindDirect]);
    assert.equal(directRace.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(directRace[0].status, "fulfilled");
    assert.equal(directRace[1].status, "rejected");
    assert(directRace[1].status === "rejected" && directRace[1].reason instanceof ArtifactReviewSubmissionConflictError);
    const directFinal = currentArtifactReview(await readRun(runsRoot, directFirst.started.id))!.rounds[0]!;
    assert.equal(directFinal.votes.length, 1);
    assert.equal(directFinal.assignments[0]!.submitted?.delegation, undefined);
    assert.equal(directFinal.assignments[0]!.draft.vote, "approve");

    const delegatedFirst = await createReview("delegated first");
    const delegatedPromise = submitArtifactReviewHumanAssignmentForRunner({
      runsRoot,
      runId: delegatedFirst.started.id,
      reviewId: delegatedFirst.review.id,
      roundId: delegatedFirst.review.currentRoundId,
      assignmentId: "human",
      vote: "approve",
      comments: [],
      authorizationNote: "Human authorized the concurrent delegated submission."
    });
    await waitForRunWriteLock(runsRoot, delegatedFirst.started.id);
    const directBehindDelegated = submitArtifactReviewAssignment({
      runsRoot,
      reviewId: delegatedFirst.review.id,
      roundId: delegatedFirst.review.currentRoundId,
      actorId: "human",
      expectedRevision: delegatedFirst.review.rounds[0]!.revision
    });
    const delegatedRace = await Promise.allSettled([delegatedPromise, directBehindDelegated]);
    assert.equal(delegatedRace.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(delegatedRace[0].status, "fulfilled");
    assert.equal(delegatedRace[1].status, "rejected");
    assert(delegatedRace[1].status === "rejected" && delegatedRace[1].reason instanceof ArtifactReviewSubmissionConflictError);
    const delegatedFinal = currentArtifactReview(await readRun(runsRoot, delegatedFirst.started.id))!.rounds[0]!;
    assert.equal(delegatedFinal.votes.length, 1);
    assert.equal(delegatedFinal.assignments[0]!.submitted?.delegation?.kind, "runner");
    assert.equal(delegatedFinal.assignments[0]!.draft.vote, "approve");
  });
});

async function waitForRunWriteLock(runsRoot: string, runId: string): Promise<void> {
  const lockName = createHash("sha256").update(runId).digest("hex");
  const lockPath = join(runsRoot, ".locks", `${lockName}.lock`);
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      await readFile(lockPath, "utf8");
      return;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
  throw new Error(`timed out waiting for Run lock: ${runId}`);
}

test("Runner delegated Human review submit fails closed for either permission layer and Agent targets", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "delegated-denied.yaml"), `!procedure
name: delegated-denied
flow:
  - !action
    action: Produce a reviewed Artifact.
    artifact: !artifact
      name: reviewed result
      review: [reviewer]
`);
    const cases = [{
      name: "runner-denied",
      runner: ["artifact.read", "artifact.submit"],
      actor: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] },
      expected: /Artifact authorization denied: decision\.decide/,
      tamperHumanPermission: false
    }, {
      name: "human-denied",
      runner: ["artifact.read", "artifact.submit", "decision.decide"],
      actor: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.assess"] },
      expected: /Artifact authorization denied: decision\.assess/,
      tamperHumanPermission: true
    }, {
      name: "agent-target",
      runner: ["artifact.read", "artifact.submit", "decision.decide"],
      actor: { kind: "agent", name: "Agent", permissions: ["artifact.read", "decision.assess"], agent: { provider: "traex" } },
      expected: /requires a Human/,
      tamperHumanPermission: false
    }] as const;
    for (const entry of cases) {
      const controlPlane = parseControlPlaneConfig({
        runner: { permissions: [...entry.runner] }, actors: { reviewer: entry.actor }
      });
      const started = await startRun({
        name: entry.name, memoryRoot, runsRoot, procedureName: "delegated-denied", controlPlane,
        reviewConfiguration: reviewConfiguration({ procedure: "delegated-denied", slots: { reviewer: ["reviewer"] } })
      });
      const reported = await reportRun({
        runsRoot, runId: started.id, artifact: { kind: "inline", value: "candidate" }
      });
      const review = currentArtifactReview(reported)!;
      if (entry.tamperHumanPermission) {
        const frozen = review.rounds[0]!.controlPlane ?? review.controlPlane;
        frozen.permissions.reviewer!.effective = ["artifact.read"];
        await writeRawFile(join(runsRoot, started.id, `${started.id}.json`), `${JSON.stringify(reported, null, 2)}\n`);
      }
      await assert.rejects(submitArtifactReviewHumanAssignmentForRunner({
        runsRoot, runId: started.id, reviewId: review.id, roundId: review.currentRoundId,
        assignmentId: "reviewer", vote: "approve", comments: [], authorizationNote: "Explicit authorization."
      }), entry.expected);
      const unchanged = await readRun(runsRoot, started.id);
      const assignment = currentArtifactReview(unchanged)!.rounds[0]!.assignments[0]!;
      assert.equal(assignment.status === "submitted", false);
      assert.equal(assignment.submitted, undefined);
    }
  });
});

const validProcedure = `!procedure
names: [target-procedure]
asserts:
  - Keep the procedure contract active.
flow:
  - !action
    action: Capture result.
    artifact: !artifact
      name: result
      type: string
`;

const invalidProcedure = `!procedure
names: [unrelated-invalid-procedure]
flow:
  - legacy string step
`;

test("startRun skips unrelated invalid procedures when resolving the target procedure", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "a-invalid.yaml"), invalidProcedure);
    await writeFile(join(proceduresRoot, "z-target.yaml"), validProcedure);

    const run = await startRun({ name: "  需求 A  ", memoryRoot, runsRoot, procedureName: "target-procedure" });

    assert.equal(run.status, "running");
    assert.equal(run.name, "需求 A");
    assert.equal(run.memorySyntax, currentMemorySyntax);
    assert.equal(run.procedureName, "target-procedure");
    assert.deepEqual(run.asserts, ["Keep the procedure contract active."]);
    assert.equal(run.stack[0].memoryName, "target-procedure");
    assert.deepEqual(run.stack[0].asserts, ["Keep the procedure contract active."]);
    assert.deepEqual(activeProcedureAsserts(run), ["Keep the procedure contract active."]);
    assert.equal(run.stack[0].steps[0].instruction, "Capture result.");
  });
});

test("startRun freezes and persists the configured work language", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "target.yaml"), validProcedure);

    const started = await startRun({
      name: "Test run",
      memoryRoot,
      runsRoot,
      procedureName: "target-procedure",
      language: "en"
    });
    const persisted = await readRun(runsRoot, started.id);

    assert.equal(started.language, "en");
    assert.equal(started.name, "Test run");
    assert.equal(persisted.language, "en");
    assert.equal(persisted.name, "Test run");
  });
});

test("abandonRun records a Human terminal decision, preserves evidence, and blocks progress", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "target.yaml"), validProcedure);
    const started = await startRun({ name: "Abandon me", memoryRoot, runsRoot, procedureName: "target-procedure" });

    const first = await abandonRun({
      runsRoot,
      runId: started.id,
      source: "cli",
      reason: "No longer needed",
      terminateWorker: async () => undefined
    });
    assert.equal(first.run.status, "abandoned");
    assert.equal(first.run.abandonment?.reason, "No longer needed");
    assert.equal(first.run.abandonment?.initiator.kind, "human");
    assert.equal(first.run.abandonment?.current?.stepId, "flow[1]");
    assert.equal(currentStep(first.run), undefined);

    const second = await abandonRun({
      runsRoot,
      runId: started.id,
      source: "view",
      reason: "ignored",
      terminateWorker: async () => undefined
    });
    assert.equal(second.run.abandonment?.abandonedAt, first.run.abandonment?.abandonedAt);
    assert.equal(second.run.abandonment?.reason, "No longer needed");
    await assert.rejects(
      reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "late" } }),
      /Run is not running.*abandoned/
    );
  });
});

test("abandonRun rejects invalid terminal states, actors, and reasons without modifying the Run", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "target.yaml"), validProcedure);
    const controlPlane = parseControlPlaneConfig({
      runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
      actors: {
        human: { kind: "human", name: "Human", permissions: ["artifact.read"] },
        agent: {
          kind: "agent",
          name: "Agent",
          permissions: ["artifact.read"],
          system_prompt: "Review independently.",
          agent: { provider: "traex" }
        }
      }
    });
    const running = await startRun({ name: "Guarded", memoryRoot, runsRoot, procedureName: "target-procedure", controlPlane });
    const original = await readFile(join(runsRoot, running.id, `${running.id}.json`), "utf8");
    await assert.rejects(
      abandonRun({ runsRoot, runId: running.id, source: "cli", actorId: "agent" }),
      /must be a Human Actor/
    );
    await assert.rejects(
      abandonRun({ runsRoot, runId: running.id, source: "cli", actorId: "missing" }),
      /must be a Human Actor/
    );
    await assert.rejects(
      abandonRun({ runsRoot, runId: running.id, source: "cli", reason: "x".repeat(2_001) }),
      /must not exceed 2000 characters/
    );
    assert.equal(await readFile(join(runsRoot, running.id, `${running.id}.json`), "utf8"), original);

    const completed = await startRun({ name: "Complete", memoryRoot, runsRoot, procedureName: "target-procedure" });
    await reportRun({ runsRoot, runId: completed.id, artifact: { kind: "inline", value: "done" } });
    await assert.rejects(abandonRun({ runsRoot, runId: completed.id, source: "view" }), /already done/);

    const readOnly = await startRun({ name: "Read only", memoryRoot, runsRoot, procedureName: "target-procedure" });
    const readOnlyState = await readRun(runsRoot, readOnly.id);
    readOnlyState.readOnly = true;
    await writeRawFile(join(runsRoot, readOnly.id, `${readOnly.id}.json`), `${JSON.stringify(readOnlyState, null, 2)}\n`);
    await assert.rejects(abandonRun({ runsRoot, runId: readOnly.id, source: "view" }), /read-only.*cannot be abandoned/);
  });
});

test("abandonRun and reportRun serialize to exactly one terminal outcome", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "target.yaml"), validProcedure);
    const started = await startRun({ name: "Race", memoryRoot, runsRoot, procedureName: "target-procedure" });

    const results = await Promise.allSettled([
      abandonRun({ runsRoot, runId: started.id, source: "view", terminateWorker: async () => undefined }),
      reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "completed first" } })
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const final = await readRun(runsRoot, started.id);
    assert.ok(final.status === "done" || final.status === "abandoned");
    assert.equal(final.events.length, final.status === "done" ? 1 : 0);
  });
});

test("abandonRun preserves a Schema draft and rejects finalization", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "schema.yaml"), `!procedure
name: abandon-schema-draft
flow:
  - !action
    action: Produce a structured result.
    artifact: !artifact
      name: structured result
      type: object
      format: { name: markdown, layout: outline }
      schema: !schema
        name: Structured result
        fields: [summary]
`);
    const started = await startRun({ name: "Schema draft", memoryRoot, runsRoot, procedureName: "abandon-schema-draft" });
    await enterSchema({ memoryRoot, runsRoot, runId: started.id });
    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Structured result" } });
    const awaiting = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "Preserved summary" } });
    assert(currentSchemaFinalization(awaiting));
    const draft = awaiting.schemaDrafts?.["flow[1]"];
    assert(draft);
    const draftPath = join(runsRoot, draft.path);
    const before = await readFile(draftPath, "utf8");

    const abandoned = await abandonRun({ runsRoot, runId: started.id, source: "view", terminateWorker: async () => undefined });
    assert.equal(abandoned.run.schemaDrafts?.["flow[1]"]?.status, "awaiting_finalization");
    assert.equal(await readFile(draftPath, "utf8"), before);
    await assert.rejects(submitManagedSchemaDraft(runsRoot, started.id), /Run is not running.*abandoned/);
    await assert.rejects(enterSchema({ memoryRoot, runsRoot, runId: started.id }), /Run is not running.*abandoned/);
    assert.equal(await readFile(draftPath, "utf8"), before);
  });
});

test("abandonRun serializes with Human Review submission and rejects later Review writes", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "review.yaml"), `!procedure
name: abandon-human-review
flow:
  - !action
    action: Produce a reviewed result.
    artifact: !artifact
      name: reviewed result
      review: [reviewer]
`);
    const controlPlane = parseControlPlaneConfig({
      runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
      actors: {
        human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] }
      }
    });
    const started = await startRun({
      name: "Human review race",
      memoryRoot,
      runsRoot,
      procedureName: "abandon-human-review",
      controlPlane,
      reviewConfiguration: reviewConfiguration({ procedure: "abandon-human-review", slots: { reviewer: ["human"] } })
    });
    const pending = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "candidate" } });
    const review = currentArtifactReview(pending);
    assert(review);
    const round = review.rounds[0];
    const assignment = round.assignments[0];
    const drafted = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: review.id,
      roundId: round.id,
      actorId: assignment.actorId,
      expectedRevision: round.revision,
      draft: { vote: "approve", comments: [] }
    });
    const raced = await Promise.allSettled([
      abandonRun({ runsRoot, runId: started.id, source: "view", terminateWorker: async () => undefined }),
      submitArtifactReviewAssignment({
        runsRoot,
        reviewId: review.id,
        roundId: round.id,
        actorId: assignment.actorId,
        expectedRevision: drafted.round.revision
      })
    ]);
    assert.equal(raced[0].status, "fulfilled");
    const final = await readRun(runsRoot, started.id);
    assert.equal(final.status, "abandoned");
    const finalRevision = final.artifactReviews?.[0]?.rounds[0]?.revision;
    assert(finalRevision);
    await assert.rejects(updateArtifactReviewDraft({
      runsRoot,
      reviewId: review.id,
      roundId: round.id,
      actorId: assignment.actorId,
      expectedRevision: finalRevision,
      draft: { vote: "request_changes", comments: [{ body: "late" }] }
    }), /Run is not running.*abandoned/);
    await assert.rejects(submitArtifactReviewAssignment({
      runsRoot,
      reviewId: review.id,
      roundId: round.id,
      actorId: assignment.actorId,
      expectedRevision: finalRevision
    }), /Run is not running.*abandoned/);
  });
});

test("startRun requires a non-empty single-line name before creating runsRoot", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const runsRoot = join(dir, "runs");
    for (const name of [undefined, "   ", "line one\nline two", `control${String.fromCharCode(127)}`]) {
      await assert.rejects(
        startRun({
          name: name as unknown as string,
          memoryRoot,
          runsRoot,
          procedureName: "target-procedure"
        }),
        name === undefined || !name.trim() ? /run name is required/ : /control characters/
      );
      await assert.rejects(readdir(runsRoot), (error: unknown) => (
        Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      ));
    }
  });
});

test("invalid Run names do not modify an existing runsRoot", async () => {
  await withTempDir(async (dir) => {
    const runsRoot = join(dir, "runs");
    await mkdir(join(runsRoot, "existing-run"), { recursive: true });
    const before = await readdir(runsRoot);

    await assert.rejects(
      startRun({
        name: "\t",
        memoryRoot: join(dir, "memory"),
        runsRoot,
        procedureName: "target-procedure"
      }),
      /run name is required/
    );

    assert.deepEqual(await readdir(runsRoot), before);
  });
});

test("Run names need not be unique and historical v3 Runs may omit them", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "target.yaml"), validProcedure);

    const first = await startRun({ name: "同名执行", memoryRoot, runsRoot, procedureName: "target-procedure" });
    const second = await startRun({ name: "同名执行", memoryRoot, runsRoot, procedureName: "target-procedure" });
    assert.notEqual(first.id, second.id);
    assert.equal(second.name, first.name);

    const path = join(runsRoot, first.id, `${first.id}.json`);
    const stored = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    delete stored.name;
    await writeRawFile(path, `${JSON.stringify(stored, null, 2)}\n`);
    const historical = await readRun(runsRoot, first.id);
    assert.equal(historical.name, undefined);
    assert.equal(historical.procedureName, "target-procedure");
  });
});

test("startRun loads a root Procedure file outside memoryRoot", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    const fixtureRoot = join(dir, "fixtures");
    const procedureFile = join(fixtureRoot, "external-procedure.yaml");
    await mkdir(proceduresRoot, { recursive: true });
    await mkdir(fixtureRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "invalid.yaml"), invalidProcedure);
    await writeFile(procedureFile, validProcedure.replace("target-procedure", "external-procedure"));

    const run = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureFile });

    assert.equal(run.name, "Test run");
    assert.equal(run.status, "running");
    assert.equal(run.procedureName, "external-procedure");
    assert.equal(run.memoryRoot, memoryRoot);
    assert.equal(run.stack[0].memoryName, "external-procedure");
    assert.equal(run.stack[0].steps[0].instruction, "Capture result.");
  });
});

test("startRun requires exactly one Procedure source", async () => {
  await withTempDir(async (dir) => {
    const base = { name: "Test run", memoryRoot: join(dir, "memory"), runsRoot: join(dir, "runs") };
    await assert.rejects(startRun(base), /provide a procedure name or procedure file/);
    await assert.rejects(
      startRun({ name: "Test run", ...base, procedureName: "installed", procedureFile: join(dir, "external.yaml") }),
      /use either a procedure name or procedure file, not both/
    );
  });
});

test("Agent Review smoke Procedures start directly from test fixture files", async () => {
  await withTempDir(async (dir) => {
    const controlPlane = parseControlPlaneConfig({
      runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
      actors: {
        traex1: {
          kind: "agent",
          name: "Development engineer",
          permissions: ["artifact.read", "decision.assess"],
          agent: { provider: "traex" }
        },
        traex2: {
          kind: "agent",
          name: "Test engineer",
          permissions: ["artifact.read", "decision.decide"],
          agent: { provider: "traex" }
        },
        human: {
          kind: "human",
          name: "System architect",
          permissions: ["artifact.read", "decision.decide"]
        }
      },
    });
    const fixtureRoot = join(
      process.cwd(),
      "test",
      "fixtures",
      "agent-review",
      ".memsphere",
      "memory",
      "procedures"
    );
    const cases = [
      ["traex-artifact-review-smoke.yaml", "traex-artifact-review-smoke"],
      ["traex-code-fact-review-smoke.yaml", "traex-code-fact-review-smoke"]
    ] as const;

    for (const [fileName, procedureName] of cases) {
      const run = await startRun({
        name: "Test run",
        memoryRoot: join(dir, "memory"),
        runsRoot: join(dir, "runs"),
        procedureFile: join(fixtureRoot, fileName),
        controlPlane,
        reviewConfiguration: reviewConfiguration({
          procedure: procedureName,
          slots: {
            development_engineer: ["traex1"],
            test_engineer: ["traex2"],
            system_architect: ["human"]
          }
        })
      });
      assert.equal(run.procedureName, procedureName);
      assert.equal(run.status, "running");
      assert.equal(currentStep(run)?.controlPlane?.bindings[`${procedureName}::development_engineer`]?.actorIds[0], "traex1");
      assert.equal(currentStep(run)?.controlPlane?.bindings[`${procedureName}::test_engineer`]?.actorIds[0], "traex2");
      assert.equal(currentStep(run)?.controlPlane?.bindings[`${procedureName}::system_architect`]?.actorIds[0], "human");
    }
  });
});

test("startRun routes an unversioned Procedure to store validation without parsing legacy content", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    await mkdir(proceduresRoot, { recursive: true });
    await writeRawFile(join(proceduresRoot, "target.yaml"), validProcedure);

    await assert.rejects(
      startRun({ name: "Test run", memoryRoot, runsRoot: join(dir, "runs"), procedureName: "target-procedure" }),
      /Memory store contains invalid Memory YAML; run memsphere validate/
    );
  });
});

test("validateMemoryStore still reports unrelated invalid procedures", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const invalidPath = join(proceduresRoot, "a-invalid.yaml");
    await mkdir(memoryRoot);
    for (const kind of memoryKinds) {
      await mkdir(join(memoryRoot, kind));
    }

    await writeFile(invalidPath, invalidProcedure);
    await writeFile(join(proceduresRoot, "z-target.yaml"), validProcedure);
    const result = await validateMemoryRoot(memoryRoot);

    assert(result.issues.some((issue) =>
      issue.path === invalidPath &&
      issue.message.includes("flow.0")
    ));
  });
});

test("startRun writes run state inside the run root directory", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "target.yaml"), validProcedure);

    const run = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "target-procedure" });
    const raw = await readFile(join(runsRoot, run.id, `${run.id}.json`), "utf8");
    const persisted = JSON.parse(raw);

    assert.equal(persisted.id, run.id);
    assert.equal((await readRun(runsRoot, run.id)).id, run.id);
  });
});

test("readRun still accepts legacy root-level run JSON files", async () => {
  await withTempDir(async (dir) => {
    const runsRoot = join(dir, "runs");
    await mkdir(runsRoot);
    await writeFile(join(runsRoot, "run-legacy-layout.json"), `${JSON.stringify({
      id: "run-legacy-layout",
      status: "done",
      procedureName: "legacy",
      memoryRoot: join(dir, "memory"),
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
      stack: [],
      events: []
    }, null, 2)}\n`);

    const run = await readRun(runsRoot, "run-legacy-layout");
    assert.equal(run.id, "run-legacy-layout");
  });
});

test("reportRun stores markdown artifacts as managed files", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [target-procedure]
flow:
  - !action
    action: Capture markdown.
    artifact: !artifact
      name: markdown result
      type: string
      format: markdown
`);

    const run = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "target-procedure" });
    const updated = await reportRun({
      runsRoot,
      runId: run.id,
      artifact: { kind: "inline", value: "# Result\n" }
    });

    const artifact = updated.events[0].artifact;
    assert.equal(artifact.storage, "file");
    assert.deepEqual(artifact.format, { name: "markdown", options: {} });
    assert.match(artifact.path ?? "", new RegExp(`^${run.id}/artifacts/`));
    assert.equal(await readFile(join(runsRoot, artifact.path ?? ""), "utf8"), "# Result\n");
  });
});

test("reportRun validates and stores external-schema Markdown artifacts", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const schemasRoot = join(memoryRoot, "schemas");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await mkdir(schemasRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [target-procedure]
flow:
  - !action
    action: Capture schema.
    artifact: !artifact
      name: schema result
      type: object
      format:
        name: markdown
        layout: outline
      schema: demo-schema
`);
    await writeFile(join(schemasRoot, "demo.yaml"), `!schema
names: [demo-schema]
fields: [summary]
`);

    const run = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "target-procedure" });
    const updated = await reportRun({
      runsRoot,
      runId: run.id,
      artifact: { kind: "inline", value: "# Delivery\n\n## summary\n\nschema content\n" }
    });

    const artifact = updated.events[0].artifact;
    assert.equal(artifact.storage, "file");
    assert.equal(artifactSchemaName(artifact), "demo-schema");
    assert.match(artifact.fileName ?? "", /\.md$/);
    assert.equal(await readFile(join(runsRoot, artifact.path ?? ""), "utf8"), "# Delivery\n\n## summary\n\nschema content\n");
  });
});

test("failed Artifact validation leaves Run state and managed artifacts unchanged", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [atomic-report]
flow:
  - !action
    action: Produce a release record.
    artifact: !artifact
      name: release record
      type: object
      format:
        name: markdown
        layout: outline
      schema: !schema
        fields: [summary]
`);

    const started = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "atomic-report" });
    const runPath = join(runsRoot, started.id, `${started.id}.json`);
    const before = await readFile(runPath, "utf8");
    await assert.rejects(
      reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Release\n\nNo summary heading.\n" } }),
      /missing heading summary/
    );
    assert.equal(await readFile(runPath, "utf8"), before);
    await assert.rejects(readFile(join(runsRoot, started.id, "artifacts", "001-release-record.md"), "utf8"), { code: "ENOENT" });

    const done = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "# Release\n\n## summary\n\nReady.\n" }
    });
    assert.equal(done.status, "done");
    assert.equal(done.events.length, 1);
    assert.equal(done.events[0]?.artifact.validation?.status, "passed");
  });
});

test("external schemas are snapshotted when a Run starts", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const schemasRoot = join(memoryRoot, "schemas");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await mkdir(schemasRoot, { recursive: true });
    const schemaPath = join(schemasRoot, "release.yaml");
    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [schema-snapshot]
flow:
  - !action
    action: Produce a release record.
    artifact: !artifact
      name: release record
      type: object
      format: { name: markdown, layout: outline }
      schema: release-schema
`);
    await writeFile(schemaPath, "!schema\nnames: [release-schema]\nfields: [summary]\n");

    const started = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "schema-snapshot" });
    assert.equal(started.stack[0]?.steps[0]?.schema?.kind, "external");
    assert.deepEqual(started.stack[0]?.steps[0]?.schema?.node?.fields, ["summary"]);
    await writeFile(schemaPath, "!schema\nnames: [release-schema]\nfields: [different]\n");

    const done = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "# Release\n\n## summary\n\nReady.\n" }
    });
    assert.equal(done.status, "done");
  });
});

test("schema Memory refs are resolved into the Run schema snapshot", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const schemasRoot = join(memoryRoot, "schemas");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await mkdir(schemasRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [schema-ref-procedure]
flow:
  - !action
    action: Produce delivery.
    artifact: !artifact
      name: delivery
      type: object
      format: { name: markdown, layout: outline }
      schema: !ref
        target: schemas/delivery-schema
`);
    await writeFile(join(schemasRoot, "delivery.yaml"), `!schema
names: [delivery-schema, Delivery Schema]
fields:
  - summary
  - !ref
    target: schemas/detail-schema
`);
    await writeFile(join(schemasRoot, "detail.yaml"), `!schema
names: [detail-schema, Detail Schema]
fields: [owner]
`);

    const started = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "schema-ref-procedure" });
    const step = started.stack[0].steps[0];
    assert.equal(step.schema?.kind, "external");
    assert.equal(step.schema?.name, "schemas/delivery-schema");
    assert.deepEqual(step.schema?.node?.fields?.map((field) => typeof field === "string" ? field : field.names[0]), [
      "summary",
      "detail-schema"
    ]);

    const entered = await enterSchema({ memoryRoot, runsRoot, runId: started.id, schemaName: "schemas/delivery-schema" });
    assert.deepEqual(entered.stack.at(-1)?.steps.map((schemaStep) => schemaStep.artifact), [
      "schemas/delivery-schema",
      "schemas/delivery-schema.summary",
      "schemas/delivery-schema.detail-schema",
      "schemas/delivery-schema.detail-schema.owner"
    ]);

    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Delivery\n" } });
    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "ready" } });
    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "Detail" } });
    const awaitingFinalization = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "Ada" }
    });

    assert.equal(awaitingFinalization.status, "running");
    assert(currentSchemaFinalization(awaitingFinalization));
    const done = await submitManagedSchemaDraft(runsRoot, started.id);
    assert.equal(done.status, "done");
    const delivery = done.events.find((event) => event.artifact.name === "delivery")?.artifact;
    assert(delivery?.path);
    assert.match(await readFile(join(runsRoot, delivery.path), "utf8"), /## detail-schema\n\nDetail\n\n### owner\n\nAda/);
  });
});

test("Run persistent dependencies reject kebab-case aliases", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const schemasRoot = join(memoryRoot, "schemas");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await mkdir(schemasRoot, { recursive: true });

    await writeFile(join(schemasRoot, "real-schema.yaml"), `!schema
names: [real-schema, alias-schema]
fields: [summary]
`);
    await writeFile(join(proceduresRoot, "schema-alias.yaml"), `!procedure
names: [schema-alias-consumer]
flow:
  - !action
    action: Produce a result.
    artifact: !artifact
      name: result
      type: object
      format: { name: markdown, layout: outline }
      schema: alias-schema
`);
    await assert.rejects(
      startRun({ name: "Schema alias", memoryRoot, runsRoot, procedureName: "schema-alias-consumer" }),
      /schema not found: alias-schema/
    );

    await writeFile(join(proceduresRoot, "canonical-child.yaml"), `!procedure
names: [canonical-child, alias-child]
flow: []
`);
    await writeFile(join(proceduresRoot, "call-alias.yaml"), `!procedure
names: [call-alias-consumer]
flow:
  - !call
    target: alias-child
`);
    await assert.rejects(
      startRun({ name: "Call alias", memoryRoot, runsRoot, procedureName: "call-alias-consumer" }),
      /procedure not found: alias-child/
    );
  });
});

test("inline schema contracts are snapshotted, enter without a name, and persist final artifacts", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    const procedurePath = join(proceduresRoot, "inline.yaml");
    await writeFile(procedurePath, `!procedure
names: [inline-contract]
flow:
  - !action
    action: Produce delivery.
    asserts: [Keep every required field.]
    suggests: [Prefer short prose.]
    artifact: !artifact
      name: delivery
      type: object
      format:
        name: markdown
        layout: outline
      final: true
      schema: !schema
        fields: [summary]
`);

    const started = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "inline-contract" });
    const step = started.stack[0].steps[0];
    assert.deepEqual(step.asserts, ["Keep every required field."]);
    assert.deepEqual(step.suggests, ["Prefer short prose."]);
    assert.equal(step.schema?.kind, "inline");
    assert(step.schema?.kind === "inline" && step.schema.id.startsWith("inline:flow[1]:delivery"));
    await writeFile(procedurePath, validProcedure);

    const entered = await enterSchema({ memoryRoot, runsRoot, runId: started.id });
    const inlineSchemaId = step.schema?.kind === "inline" ? step.schema.id : "";
    assert.equal(entered.stack.at(-1)?.memoryName, inlineSchemaId);
    assert.equal(entered.stack.at(-1)?.steps[0]?.artifact, inlineSchemaId);
    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Delivery\n" } });
    const awaitingFinalization = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "finished" }
    });
    assert(currentSchemaFinalization(awaitingFinalization));
    const done = await submitManagedSchemaDraft(runsRoot, started.id);
    assert.equal(done.status, "done");
    assert.equal(finalArtifacts(done).length, 1);
    const delivery = finalArtifacts(done)[0];
    assert.equal(delivery.schema?.kind, "inline");
    assert.equal(delivery.final, true);
    assert.match(delivery.path ?? "", /\.md$/);
    assert.equal(await readFile(join(runsRoot, delivery.path ?? ""), "utf8"), "# Delivery\n\n## summary\n\nfinished\n");
  });
});

test("enter-schema records a local Markdown table as one complete structured step", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "table.yaml"), `!procedure
names: [table-contract]
flow:
  - !action
    action: Produce delivery.
    artifact: !artifact
      name: delivery
      type: object
      format: { name: markdown, layout: outline }
      schema: !schema
        fields:
          - !schema
            names: [Requirements]
            type: array
            format: { name: markdown, layout: table }
            item: !schema
              type: object
              fields: [ID, Summary]
`);

    const started = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "table-contract" });
    const entered = await enterSchema({ memoryRoot, runsRoot, runId: started.id });
    const schemaSteps = entered.stack.at(-1)?.steps ?? [];
    assert.equal(schemaSteps.length, 2);
    assert.equal(schemaSteps[1]?.artifact?.endsWith(".Requirements"), true);
    assert.deepEqual(schemaSteps[1]?.format, { name: "markdown", options: { layout: "table" } });

    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Delivery" } });
    const awaitingFinalization = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "| ID | Summary |\n| --- | --- |\n| R-1 | First |\n" }
    });
    assert(currentSchemaFinalization(awaitingFinalization));
    const done = await submitManagedSchemaDraft(runsRoot, started.id);
    assert.equal(done.status, "done");
    assert.equal(done.events.filter((event) => event.frame === "schema").length, 2);
    assert.match(await readFile(join(runsRoot, done.events.at(-1)?.artifact.path ?? ""), "utf8"), /## Requirements/);
  });
});

test("Schema parent validation failure preserves field progress and supports whole-draft repair", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "table.yaml"), `!procedure
names: [table-contract]
flow:
  - !action
    action: Produce delivery.
    artifact: !artifact
      name: delivery
      type: object
      format: { name: markdown, layout: outline }
      schema: !schema
        fields:
          - !schema
            names: [Requirements]
            type: array
            format: { name: markdown, layout: table }
            item: !schema
              type: object
              fields: [ID, Summary]
`);

    const started = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "table-contract" });
    await enterSchema({ memoryRoot, runsRoot, runId: started.id });
    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Delivery" } });

    const awaitingFinalization = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "| ID |\n| --- |\n| R-1 |\n" }
    });
    const finalization = currentSchemaFinalization(awaitingFinalization);
    assert(finalization);
    assert.equal(finalization.draft.validation?.status, "failed");
    assert.match(finalization.draft.validation?.issues[0]?.message ?? "", /missing column Summary/);
    assert.equal(awaitingFinalization.events.filter((event) => event.frame === "schema").length, 2);

    const draftPath = join(runsRoot, finalization.draft.path);
    await assert.rejects(
      reportRun({ runsRoot, runId: started.id, artifact: { kind: "file", path: draftPath } }),
      /missing column Summary/
    );
    assert(currentSchemaFinalization(await readRun(runsRoot, started.id)));

    await writeRawFile(
      draftPath,
      "# Delivery\n\n## Requirements\n\n| ID | Summary |\n| --- | --- |\n| R-1 | First |\n"
    );
    const done = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "file", path: draftPath }
    });
    assert.equal(done.status, "done");
    assert.equal(done.events.at(-1)?.artifact.name, "delivery");
  });
});

test("final artifacts only include the executed branch", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "branch.yaml"), `!procedure
names: [branch-final]
flow:
  - !if
    condition: !action
      action: Choose path.
      artifact: !artifact
        name: choose
        type: boolean
    then:
      - !action
        action: True delivery.
        artifact: !artifact
          name: true result
          type: string
          final: true
    else:
      - !action
        action: False delivery.
        artifact: !artifact
          name: false result
          type: string
          final: true
`);
    const started = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "branch-final" });
    const afterChoice = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "false" } });
    const done = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "false result" } });
    assert.equal(afterChoice.stack[0].steps[afterChoice.stack[0].index]?.artifact, "false result");
    assert.deepEqual(finalArtifacts(done).map((artifact) => artifact.name), ["false result"]);
  });
});

test("completed schema flows store the parent schema artifact as a managed file", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const schemasRoot = join(memoryRoot, "schemas");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await mkdir(schemasRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [target-procedure]
flow:
  - !action
    action: Capture schema.
    artifact: !artifact
      name: schema result
      type: object
      format:
        name: markdown
        layout: outline
      schema: demo-schema
`);
    await writeFile(join(schemasRoot, "demo.yaml"), `!schema
names: [demo-schema]
type: object
defines:
  - Demo schema.
`);

    const run = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "target-procedure" });
    await enterSchema({ memoryRoot, runsRoot, runId: run.id, schemaName: "demo-schema" });
    const awaitingFinalization = await reportRun({
      runsRoot,
      runId: run.id,
      artifact: { kind: "inline", value: "schema field value" }
    });
    assert(currentSchemaFinalization(awaitingFinalization));
    const updated = await submitManagedSchemaDraft(runsRoot, run.id);

    const artifact = updated.events.at(-1)?.artifact;
    assert.equal(artifact?.name, "schema result");
    assert.equal(artifact?.storage, "file");
    assert.equal(artifactSchemaName(artifact), "demo-schema");
    assert.match(artifact?.fileName ?? "", /\.md$/);
    assert.equal(await readFile(join(runsRoot, artifact?.path ?? ""), "utf8"), "schema field value\n");
  });
});

test("reportRun copies file sources into the managed artifacts directory", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    const sourcePath = join(dir, "external.md");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(sourcePath, "external content\n");

    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [target-procedure]
flow:
  - !action
    action: Capture markdown.
    artifact: !artifact
      name: markdown result
      type: string
      format: markdown
`);

    const run = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "target-procedure" });
    const updated = await reportRun({
      runsRoot,
      runId: run.id,
      artifact: { kind: "file", path: sourcePath }
    });

    const artifact = updated.events[0].artifact;
    assert.equal(artifact.storage, "file");
    assert.notEqual(artifact.path, sourcePath);
    assert.match(artifact.path ?? "", new RegExp(`^${run.id}/artifacts/`));
    assert.equal(await readFile(join(runsRoot, artifact.path ?? ""), "utf8"), "external content\n");
  });
});

test("boolean artifacts remain inline and continue to drive branches", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [target-procedure]
flow:
  - !if
    condition: !action
      action: Choose path.
      artifact: !artifact
        name: choose
        type: boolean
    then:
      - !action
        action: Capture true path.
        artifact: !artifact
          name: true result
          type: string
    else:
      - !action
        action: Capture false path.
        artifact: !artifact
          name: false result
          type: string
`);

    const run = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "target-procedure" });
    const updated = await reportRun({
      runsRoot,
      runId: run.id,
      artifact: { kind: "inline", value: "true" }
    });

    assert.equal(updated.events[0].artifact.storage, "inline");
    assert.equal(updated.events[0].artifact.value, true);
    assert.equal(updated.stack[0].steps[updated.stack[0].index].artifact, "true result");
  });
});

test("recursive elseif evaluates in order and falls back to the root else", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [target-procedure]
flow:
  - !if
    condition: !action
      action: Check A.
      artifact: !artifact
        name: A
        type: boolean
    then:
      - !action
        action: Handle A.
        artifact: !artifact
          name: A result
          type: string
    elseif: !if
      condition: !action
        action: Check B.
        artifact: !artifact
          name: B
          type: boolean
      then:
        - !action
          action: Handle B.
          artifact: !artifact
            name: B result
            type: string
    else:
      - !action
        action: Handle fallback.
        artifact: !artifact
          name: fallback result
          type: string
`);

    const started = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "target-procedure" });
    assert.equal(started.stack[0].steps[started.stack[0].index].artifact, "A");

    const afterA = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "false" } });
    assert.equal(afterA.stack[0].steps[afterA.stack[0].index].artifact, "B");

    const afterB = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "false" } });
    assert.equal(afterB.stack[0].steps[afterB.stack[0].index].artifact, "fallback result");
  });
});

test("while repeats its body and call automatically enters the child procedure", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "parent.yaml"), `!procedure
names: [parent]
asserts: [Keep the parent contract active.]
flow:
  - !while
    condition: !action
      action: Continue?
      artifact: !artifact
        name: continue
        type: boolean
    do:
      - !action
        action: Record iteration.
        artifact: !artifact
          name: iteration
          type: number
  - !call
    target: child
`);
    await writeFile(join(proceduresRoot, "child.yaml"), `!procedure
names: [child]
asserts: [Keep the child contract active.]
flow:
  - !action
    action: Finish child.
    artifact: !artifact
      name: child result
      type: string
`);

    const started = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "parent" });
    const enteredLoop = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "true" } });
    assert.equal(enteredLoop.stack[0].steps[enteredLoop.stack[0].index].artifact, "iteration");

    const repeated = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "1" } });
    assert.equal(repeated.stack[0].steps[repeated.stack[0].index].artifact, "continue");

    const enteredChild = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "false" } });
    assert.equal(enteredChild.stack.at(-1)?.memoryName, "child");
    assert.equal(enteredChild.stack.at(-1)?.steps[0].artifact, "child result");
    assert.deepEqual(activeProcedureAsserts(enteredChild), [
      "Keep the parent contract active.",
      "Keep the child contract active."
    ]);

    const done = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "done" } });
    assert.equal(done.status, "done");
  });
});

test("schema execution expands shorthand string fields", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const schemasRoot = join(memoryRoot, "schemas");
    const statementsRoot = join(memoryRoot, "statements");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await mkdir(schemasRoot, { recursive: true });
    await mkdir(statementsRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [target-procedure]
flow:
  - !action
    action: Capture schema.
    artifact: !artifact
      name: schema result
      type: object
      format:
        name: markdown
        layout: outline
      schema: demo-schema
`);
    await writeFile(join(schemasRoot, "demo.yaml"), `!schema
names: [demo-schema]
defines:
  - Guidance for the demo schema.
asserts:
  - !ref
    target: statements/demo-guidance
suggests:
  - !ref
    target: statements/demo-guidance
fields:
  - summary
  - !schema
    names: [details]
`);
    await writeFile(join(statementsRoot, "demo-guidance.yaml"), `!statement
names: [demo-guidance]
defines:
  - Shared writing guidance.
asserts:
  - Keep it concise.
suggests:
  - Prefer direct wording.
sections:
  - !statement
    names: [Formatting]
    asserts:
      - Use Markdown headings.
    sections:
      - !statement
        names: [Examples]
        suggests:
          - Include one example when useful.
`);

    const started = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "target-procedure" });
    const entered = await enterSchema({ memoryRoot, runsRoot, runId: started.id, schemaName: "demo-schema" });
    const schemaFrame = entered.stack.at(-1);
    assert.deepEqual(schemaFrame?.steps.map((step) => step.artifact), [
      "demo-schema",
      "demo-schema.summary",
      "demo-schema.details"
    ]);
    assert.deepEqual(schemaFrame?.steps.map((step) => step.format), [
      { name: "markdown", options: { layout: "outline" } },
      { name: "markdown", options: {} },
      { name: "markdown", options: {} }
    ]);
    assert.deepEqual(schemaFrame?.steps.map((step) => step.type), ["object", "string", "string"]);
    assert.deepEqual(schemaFrame?.steps[0].schemaContext?.sources[0].asserts, [
      "Keep it concise.",
      "Use Markdown headings."
    ]);
    assert.deepEqual(schemaFrame?.steps[0].schemaContext?.sources[0].suggests, [
      "Prefer direct wording.",
      "Include one example when useful."
    ]);
  });
});

test("schema Repeat persists its control step and expands a chosen count without artifacts", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const schemasRoot = join(memoryRoot, "schemas");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await mkdir(schemasRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [target-procedure]
flow:
  - !action
    action: Capture schema.
    artifact: !artifact
      name: schema result
      type: object
      format:
        name: markdown
        layout: outline
      schema: repeat-schema
`);
    await writeFile(join(schemasRoot, "repeat.yaml"), `!schema
names: [repeat-schema]
fields:
  - context
  - !repeat
    limit: { min: 1, max: 3 }
    body:
      - !schema
        names: [decision]
        fields: [conclusion]
      - owner
  - summary
`);

    const started = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "target-procedure" });
    await enterSchema({ memoryRoot, runsRoot, runId: started.id, schemaName: "repeat-schema" });
    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Record" } });
    const waiting = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "context" } });

    assert.equal(currentStep(waiting)?.kind, "repeat");
    assert.deepEqual(currentStep(waiting)?.repeat?.body.map((field) => typeof field === "string" ? field : field.names[0]), ["decision", "owner"]);
    assert.equal((await readRun(runsRoot, started.id)).stack.at(-1)?.steps.at(-2)?.kind, "repeat");
    await assert.rejects(
      reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "2" } }),
      /run repeat/
    );
    await assert.rejects(repeatRun({ runsRoot, runId: started.id, count: 0 }), /at least 1/);
    await assert.rejects(repeatRun({ runsRoot, runId: started.id, count: 4 }), /at most 3/);

    const expanded = await repeatRun({ runsRoot, runId: started.id, count: 2 });
    assert.equal(expanded.events.length, 2);
    assert.deepEqual(expanded.stack.at(-1)?.steps.slice(expanded.stack.at(-1)?.index).map((step) => step.artifact), [
      "repeat-schema.decision[1]",
      "repeat-schema.decision[1].conclusion",
      "repeat-schema.owner[1]",
      "repeat-schema.decision[2]",
      "repeat-schema.decision[2].conclusion",
      "repeat-schema.owner[2]",
      "repeat-schema.summary"
    ]);
  });
});

test("schema optional fields can be explicitly skipped", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const schemasRoot = join(memoryRoot, "schemas");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await mkdir(schemasRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [target-procedure]
flow:
  - !action
    action: Capture schema.
    artifact: !artifact
      name: schema result
      type: object
      format:
        name: markdown
        layout: outline
      schema: optional-schema
`);
    await writeFile(join(schemasRoot, "optional.yaml"), `!schema
names: [optional-schema]
fields:
  - required
  - !schema
    names: [notes]
    optional: true
`);

    const started = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "target-procedure" });
    await enterSchema({ memoryRoot, runsRoot, runId: started.id, schemaName: "optional-schema" });
    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Record" } });
    await assert.rejects(skipRun({ runsRoot, runId: started.id }), /required/);
    const required = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "ready" } });

    assert.equal(currentStep(required)?.artifact, "optional-schema.notes");
    assert.equal(currentStep(required)?.optional, true);

    const skipped = await skipRun({ runsRoot, runId: started.id });
    assert.equal(skipped.events.find((event) => event.stepId === "schema:optional-schema.notes")?.artifact.fields?.skipped, true);
    assert.equal(skipped.status, "running");
    assert(currentSchemaFinalization(skipped));
    const done = await submitManagedSchemaDraft(runsRoot, started.id);
    assert.equal(done.status, "done");
    const assembledArtifact = done.events.find((event) => event.artifact.name === "schema result")?.artifact;
    assert(assembledArtifact?.path);
    const assembled = await readFile(join(runsRoot, assembledArtifact.path), "utf8");
    assert.match(assembled, /## required/);
    assert.doesNotMatch(assembled, /notes/);
  });
});

test("Schema writing updates one stable draft, rebuilds it, and submits the edited whole document", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "draft.yaml"), `!procedure
name: schema-draft
flow:
  - !action
    action: Produce a complete delivery.
    asserts: [Keep the document coherent.]
    suggests: [Prefer concise sections.]
    artifact: !artifact
      name: delivery
      type: object
      format: { name: markdown, layout: outline }
      schema: !schema
        names: [Delivery]
        asserts: [Every section belongs to this delivery.]
        suggests: [Keep the whole document focused.]
        fields:
          - !schema
            name: summary
            asserts: [The summary must describe the result.]
            suggests: [Use one sentence.]
          - details
`);

    const started = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "schema-draft" });
    const entered = await enterSchema({ memoryRoot, runsRoot, runId: started.id });
    const overview = buildSchemaWritingSnapshot(runsRoot, entered);
    assert(overview);
    assert.deepEqual(overview.action.asserts, ["Keep the document coherent."]);
    assert.deepEqual(overview.currentField?.sources[0]?.suggests, ["Keep the whole document focused."]);
    assert.equal(overview.progress.total, 3);
    assert.equal(overview.progress.current, "inline:flow[1]:delivery");
    assert.equal(overview.draft, undefined);

    const rootReported = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "# Delivery" }
    });
    assert.deepEqual(
      buildSchemaWritingSnapshot(runsRoot, rootReported)?.currentField?.sources.flatMap((source) => source.asserts ?? []),
      ["Every section belongs to this delivery.", "The summary must describe the result."]
    );
    assert.deepEqual(
      buildSchemaWritingSnapshot(runsRoot, rootReported)?.currentField?.sources.flatMap((source) => source.suggests ?? []),
      ["Keep the whole document focused.", "Use one sentence."]
    );
    const firstDraft = rootReported.schemaDrafts?.["flow[1]"];
    assert(firstDraft);
    const draftPath = join(runsRoot, firstDraft.path);
    assert.match(await readFile(draftPath, "utf8"), /memsphere:pending field=.*summary/);

    const summaryReported = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "A concise summary." }
    });
    assert.equal(summaryReported.schemaDrafts?.["flow[1]"]?.path, firstDraft.path);
    assert.match(await readFile(draftPath, "utf8"), /A concise summary\./);
    assert.match(await readFile(draftPath, "utf8"), /memsphere:pending field=.*details/);

    await rm(draftPath);
    const restored = await ensureCurrentSchemaDraft(runsRoot, await readRun(runsRoot, started.id));
    assert.equal(restored.schemaDrafts?.["flow[1]"]?.path, firstDraft.path);
    assert.match(await readFile(draftPath, "utf8"), /A concise summary\./);

    const awaitingFinalization = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "Implementation details." }
    });
    assert.equal(awaitingFinalization.schemaDrafts?.["flow[1]"]?.path, firstDraft.path);
    assert.equal(awaitingFinalization.schemaDrafts?.["flow[1]"]?.status, "awaiting_finalization");
    assert.equal(awaitingFinalization.events.some((event) => event.stepId === "flow[1]"), false);

    await writeRawFile(draftPath, `${await readFile(draftPath, "utf8")}\nGlobal adjustment.\n`);
    const done = await submitManagedSchemaDraft(runsRoot, started.id);
    assert.equal(done.status, "done");
    const accepted = done.events.find((event) => event.stepId === "flow[1]")?.artifact;
    assert(accepted?.path);
    assert.match(await readFile(join(runsRoot, accepted.path), "utf8"), /Global adjustment\./);
    assert.equal(done.schemaDrafts?.["flow[1]"]?.status, "accepted");
  });
});

test("reviewed Schema Artifacts enter Review only after explicit whole-draft submission", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const schemasRoot = join(memoryRoot, "schemas");
    const runsRoot = join(dir, "runs");
    const fixtureRoot = join(process.cwd(), "test", "fixtures", "schema-artifact-composition-review");
    await mkdir(proceduresRoot, { recursive: true });
    await mkdir(schemasRoot, { recursive: true });
    await writeRawFile(
      join(proceduresRoot, "procedure.yaml"),
      await readFile(join(fixtureRoot, "procedure.yaml"), "utf8")
    );
    await writeRawFile(
      join(schemasRoot, "schema.yaml"),
      await readFile(join(fixtureRoot, "schema.yaml"), "utf8")
    );
    const controlPlane = parseControlPlaneConfig({
      runner: {
        permissions: ["artifact.read", "artifact.submit", "decision.decide"]
      },
      actors: {
        agent: {
          kind: "agent",
          name: "Agent reviewer",
          permissions: ["artifact.read", "decision.decide"],
          agent: { provider: "traex" }
        },
        human: {
          kind: "human",
          name: "Human reviewer",
          permissions: ["artifact.read", "decision.decide"]
        }
      }
    });

    const started = await startRun({
      name: "Test run",
      memoryRoot,
      runsRoot,
      procedureName: "schema-artifact-composition-review",
      controlPlane,
      reviewConfiguration: reviewConfiguration({
        procedure: "schema-artifact-composition-review",
        slots: {
          agent_reviewer: ["agent"],
          human_reviewer: ["human"]
        }
      })
    });
    const entered = await enterSchema({
      memoryRoot,
      runsRoot,
      runId: started.id,
      schemaName: "reviewed-delivery"
    });
    const productionContext = JSON.stringify(buildSchemaWritingSnapshot(runsRoot, entered));
    assert.doesNotMatch(productionContext, /artifact_acceptance|roleBindings|controlPlane|permission|reviewer/i);

    await reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "# Reviewed delivery" } });
    await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "Implementation summary." }
    });
    const awaitingFinalization = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "Initial verification evidence." }
    });
    assert(currentSchemaFinalization(awaitingFinalization));
    assert.equal(awaitingFinalization.artifactReviews, undefined);
    assert.equal(awaitingFinalization.events.some((event) => event.stepId === "flow[1]"), false);

    const submitted = await submitManagedSchemaDraft(runsRoot, started.id);
    const review = currentArtifactReview(submitted);
    assert(review);
    assert.equal(submitted.events.some((event) => event.stepId === "flow[1]"), false);
    assert.equal(currentStep(submitted)?.id, "flow[1]");
    assert.equal(submitted.schemaDrafts?.["flow[1]"]?.status, "submitted");

    const round = review.rounds[0];
    const agentAssignment = round.assignments.find((assignment) => assignment.actorKind === "agent");
    const humanAssignment = round.assignments.find((assignment) => assignment.actorKind === "human");
    assert(agentAssignment);
    assert(humanAssignment);
    assert.equal(round.assignments.length, 2);
    const claimed = await claimArtifactReviewAgentAssignment({
      runsRoot,
      reviewId: review.id,
      roundId: round.id,
      actorId: agentAssignment.actorId,
      workerPid: process.pid
    });
    assert(claimed);
    await markArtifactReviewAgentCliReady({
      runsRoot,
      reviewId: review.id,
      roundId: round.id,
      actorId: agentAssignment.actorId,
      attemptId: claimed.attempt.id,
      protocolVersion: 1,
      sessionId: "agent-round-1"
    });
    await assert.rejects(
      submitArtifactReviewAgentAssignment({
        runsRoot,
        reviewId: review.id,
        roundId: round.id,
        actorId: agentAssignment.actorId,
        attemptId: claimed.attempt.id,
        vote: "abstain"
      }),
      /abstain requires at least one Comment or Summary/
    );
    await assert.rejects(
      appendArtifactReviewAgentComment({
        runsRoot,
        reviewId: review.id,
        roundId: round.id,
        actorId: agentAssignment.actorId,
        attemptId: claimed.attempt.id,
        body: "This anchor uses the wrong digest.",
        anchor: {
          sourceHash: "digest-wrong",
          target: "artifact:root"
        }
      }),
      /does not match the current Submission/
    );
    const agentCommented = await appendArtifactReviewAgentComment({
      runsRoot,
      reviewId: review.id,
      roundId: round.id,
      actorId: agentAssignment.actorId,
      attemptId: claimed.attempt.id,
      body: "The candidate is traceable.",
      anchor: {
        sourceHash: review.submissions[0].digest,
        target: " artifact:root ",
        context: " Reviewed delivery "
      }
    });
    assert.deepEqual(agentCommented.assignment.draft.comments[0]?.anchor, {
      submissionId: review.submissions[0].id,
      sourceHash: review.submissions[0].digest,
      target: "artifact:root",
      location: undefined,
      context: "Reviewed delivery"
    });
    const agentSubmitted = await submitArtifactReviewAgentAssignment({
      runsRoot,
      reviewId: review.id,
      roundId: round.id,
      actorId: agentAssignment.actorId,
      attemptId: claimed.attempt.id,
      vote: "approve",
      summary: "Agent approves the first candidate."
    });
    assert.equal(agentSubmitted.review.status, "pending");
    assert.equal(agentSubmitted.run.events.some((event) => event.stepId === "flow[1]"), false);

    const firstDraft = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: review.id,
      roundId: round.id,
      actorId: humanAssignment.actorId,
      expectedRevision: agentSubmitted.round.revision,
      draft: {
        vote: "request_changes",
        comments: [{ body: "Strengthen the verification evidence." }]
      }
    });
    await submitArtifactReviewAssignment({
      runsRoot,
      reviewId: review.id,
      roundId: round.id,
      actorId: humanAssignment.actorId,
      expectedRevision: firstDraft.round.revision
    });
    const requested = await waitForArtifactReview({ runsRoot, reviewId: review.id, pollIntervalMs: 1 });
    assert.equal(requested.review.status, "awaiting_revision");
    assert.equal(requested.run.events.some((event) => event.stepId === "flow[1]"), false);

    const draftPath = join(runsRoot, requested.run.schemaDrafts!["flow[1]"].path);
    await writeRawFile(draftPath, `${await readFile(draftPath, "utf8")}\nAdditional verification evidence.\n`);
    const revised = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "file", path: draftPath },
      revisionSummary: "Strengthened the verification evidence."
    });
    const revisedReview = currentArtifactReview(revised);
    assert(revisedReview);
    assert.equal(revisedReview.rounds.length, 2);
    const secondRound = revisedReview.rounds[1];
    const secondAgent = secondRound.assignments.find((assignment) => assignment.actorKind === "agent");
    const secondHuman = secondRound.assignments.find((assignment) => assignment.actorKind === "human");
    assert(secondAgent);
    assert(secondHuman);
    assert.equal(secondAgent.status, "queued");
    assert.equal(secondHuman.status, "draft");
    assert.equal(secondRound.votes.length, 0);

    const secondClaim = await claimArtifactReviewAgentAssignment({
      runsRoot,
      reviewId: revisedReview.id,
      roundId: secondRound.id,
      actorId: secondAgent.actorId,
      workerPid: process.pid
    });
    assert(secondClaim);
    await markArtifactReviewAgentCliReady({
      runsRoot,
      reviewId: revisedReview.id,
      roundId: secondRound.id,
      actorId: secondAgent.actorId,
      attemptId: secondClaim.attempt.id,
      protocolVersion: 1,
      sessionId: "agent-round-2"
    });
    const secondAgentSubmitted = await submitArtifactReviewAgentAssignment({
      runsRoot,
      reviewId: revisedReview.id,
      roundId: secondRound.id,
      actorId: secondAgent.actorId,
      attemptId: secondClaim.attempt.id,
      vote: "approve",
      summary: "Agent approves the revised candidate."
    });
    assert.equal(secondAgentSubmitted.review.status, "pending");
    assert.equal(secondAgentSubmitted.run.events.some((event) => event.stepId === "flow[1]"), false);

    const secondDraft = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: revisedReview.id,
      roundId: secondRound.id,
      actorId: secondHuman.actorId,
      expectedRevision: secondAgentSubmitted.round.revision,
      draft: { vote: "approve", comments: [] }
    });
    await submitArtifactReviewAssignment({
      runsRoot,
      reviewId: revisedReview.id,
      roundId: secondRound.id,
      actorId: secondHuman.actorId,
      expectedRevision: secondDraft.round.revision
    });
    const secondWaiting = await waitForArtifactReview({
      runsRoot,
      reviewId: revisedReview.id,
      pollIntervalMs: 1
    });
    assert.equal(secondWaiting.review.status, "awaiting_runner_vote");
    const accepted = await submitArtifactReviewRunnerVote({
      runsRoot,
      reviewId: revisedReview.id,
      roundId: secondRound.id,
      vote: "approve"
    });
    assert.equal(currentStep(accepted.run)?.id, "flow[2]");
    assert.equal(accepted.run.events.filter((event) => event.stepId === "flow[1]").length, 1);
    assert.equal(accepted.run.schemaDrafts?.["flow[1]"]?.status, "accepted");
  });
});

test("readRun accepts legacy artifact value and schemaName fields", async () => {
  await withTempDir(async (dir) => {
    const runsRoot = join(dir, "runs");
    await mkdir(runsRoot);
    await writeFile(join(runsRoot, "run-legacy.json"), `${JSON.stringify({
      id: "run-legacy",
      status: "done",
      procedureName: "legacy",
      memoryRoot: join(dir, "memory"),
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
      stack: [],
      events: [{
        at: "2026-07-08T00:00:00.000Z",
        frame: "procedure",
        stepId: "flow[1]",
        artifact: {
          name: "legacy schema",
          format: "schema",
          schemaName: "legacy-schema",
          value: "legacy value"
        }
      }]
    }, null, 2)}\n`);

    const run = await readRun(runsRoot, "run-legacy");
    assert.equal(run.events[0].artifact.value, "legacy value");
    assert.equal(artifactSchemaName(run.events[0].artifact), "legacy-schema");
  });
});

test("running v1 Runs remain byte-for-byte read-only", async () => {
  await withTempDir(async (dir) => {
    const runsRoot = join(dir, "runs");
    const runId = "run-v1-running";
    await mkdir(runsRoot);
    const path = join(runsRoot, `${runId}.json`);
    const source = `${JSON.stringify({
      id: runId,
      status: "running",
      procedureName: "legacy",
      memoryRoot: join(dir, "memory"),
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
      stack: [{
        type: "procedure",
        memoryName: "legacy",
        steps: [{ id: "flow[1]", instruction: "Legacy step", artifact: "result", format: "string" }],
        index: 0
      }],
      events: []
    }, null, 2)}\n`;
    await writeFile(path, source);

    const run = await readRun(runsRoot, runId);
    assert.equal(run.contractVersion, 1);
    assert.equal(run.readOnly, true);
    await assert.rejects(
      reportRun({ runsRoot, runId, artifact: { kind: "inline", value: "result" } }),
      /v1 run is read-only/
    );
    await assert.rejects(
      abandonRun({ runsRoot, runId, source: "view" }),
      /read-only and cannot be abandoned/
    );
    assert.equal(await readFile(path, "utf8"), source);
  });
});

test("missing file sources do not append partial events", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });

    await writeFile(join(proceduresRoot, "target.yaml"), `!procedure
names: [target-procedure]
flow:
  - !action
    action: Capture markdown.
    artifact: !artifact
      name: markdown result
      type: string
      format: markdown
`);

    const run = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "target-procedure" });
    await assert.rejects(
      reportRun({
        runsRoot,
        runId: run.id,
        artifact: { kind: "file", path: join(dir, "missing.md") }
      }),
      /ENOENT/
    );

    const unchanged = await readRun(runsRoot, run.id);
    assert.equal(unchanged.events.length, 0);
  });
});

test("concurrent reports serialize through the per-Run write lock", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "concurrent.yaml"), `!procedure
names: [concurrent-report]
flow:
  - !action
    action: Capture first.
    artifact: !artifact
      name: first
  - !action
    action: Capture second.
    artifact: !artifact
      name: second
`);
    const started = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "concurrent-report" });

    await Promise.all([
      reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "A" } }),
      reportRun({ runsRoot, runId: started.id, artifact: { kind: "inline", value: "B" } })
    ]);

    const completed = await readRun(runsRoot, started.id);
    assert.equal(completed.status, "done");
    assert.equal(completed.events.length, 2);
    assert.deepEqual(new Set(completed.events.map((event) => event.artifact.value)), new Set(["A", "B"]));
  });
});

test("Run writes recover a lock left by a terminated process", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "stale-lock.yaml"), `!procedure
names: [stale-lock]
flow:
  - !action
    action: Capture result.
    artifact: !artifact
      name: result
`);
    const started = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "stale-lock" });
    const lockRoot = join(runsRoot, ".locks");
    const lockName = createHash("sha256").update(started.id).digest("hex");
    await mkdir(lockRoot, { recursive: true });
    await writeRawFile(join(lockRoot, `${lockName}.lock`), `${JSON.stringify({
      pid: 99_999_999,
      token: "terminated-owner",
      startedAt: "2026-01-01T00:00:00.000Z"
    })}\n`);

    let reviewChecks = 0;
    const completed = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "done" },
      beforeArtifactReview: async () => {
        reviewChecks += 1;
      }
    });
    assert.equal(reviewChecks, 0);
    assert.equal(completed.status, "done");
    assert.deepEqual(await readdir(lockRoot), []);
    assert.equal((await readdir(join(runsRoot, started.id))).some((name) => name.endsWith(".tmp")), false);
  });
});

test("Run v3 snapshots Actor bindings, permissions, and report authorization", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "governed.yaml"), `!procedure
name: governed
flow:
  - !action
    action: Produce a governed Artifact.
    artifact: !artifact
      name: governed result
      review: [reviewer]
`);
    const controlPlane = parseControlPlaneConfig({
      runner: {
        permissions: ["artifact.read", "artifact.submit", "decision.decide"]
      },
      actors: {
        human: {
          kind: "human",
          name: "Human",
          permissions: ["artifact.read", "decision.decide"]
        },
        agent: {
          kind: "agent",
          name: "Agent",
          permissions: ["artifact.read", "decision.assess"],
          agent: { provider: "traex" }
        }
      }
    });

    const run = await startRun({
      name: "Test run",
      memoryRoot,
      runsRoot,
      procedureName: "governed",
      controlPlane,
      reviewConfiguration: reviewConfiguration({
        procedure: "governed",
        slots: { reviewer: ["human", "agent"] }
      })
    });
    assert.equal(run.contractVersion, 3);
    assert(run.controlPlane);
    assert(run.procedureSnapshots?.governed);
    assert.deepEqual(currentStep(run)?.controlPlane?.bindings["governed::reviewer"].actorIds, ["human", "agent"]);
    assert.deepEqual(currentStep(run)?.controlPlane?.permissions.runner.effective, [
      "artifact.read",
      "artifact.submit",
      "decision.decide"
    ]);

    const blocked = new Error("review execution unavailable");
    await assert.rejects(
      reportRun({
        runsRoot,
        runId: run.id,
        artifact: { kind: "inline", value: "done" },
        beforeArtifactReview: async () => {
          throw blocked;
        }
      }),
      (error) => error === blocked
    );
    const unchanged = await readRun(runsRoot, run.id);
    assert.equal(unchanged.artifactReviews, undefined);
    assert.equal(currentStep(unchanged)?.id, currentStep(run)?.id);

    let reviewChecks = 0;
    const pending = await reportRun({
      runsRoot,
      runId: run.id,
      artifact: { kind: "inline", value: "done" },
      beforeArtifactReview: async () => {
        reviewChecks += 1;
      }
    });
    assert.equal(reviewChecks, 1);
    const submission = currentArtifactReview(pending)?.submissions[0];
    assert.equal(submission?.artifact.authorization?.allowed, true);
    assert.equal(submission?.artifact.authorization?.permission, "artifact.submit");
    assert.equal(submission?.artifact.authorization?.artifactScope, "governed#flow[1]");
    assert.equal(submission?.artifact.authorization?.grantSource, undefined);
  });
});

test("running Run can replace a future Slot binding without changing an existing Review", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "handoff.yaml"), `!procedure
name: handoff
flow:
  - !action
    action: Human reviews first.
    artifact: !artifact
      name: first
      review: [owner]
  - !action
    action: Agent reviews second.
    artifact: !artifact
      name: second
      review: [owner]
`);
    const controlPlane = parseControlPlaneConfig({
      runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
      actors: {
        human: {
          kind: "human",
          name: "Human",
          permissions: ["artifact.read", "decision.decide"]
        },
        agent: {
          kind: "agent",
          name: "Agent",
          permissions: ["artifact.read", "decision.assess"],
          agent: { provider: "traex" }
        }
      }
    });
    const started = await startRun({
      name: "Runtime binding handoff",
      memoryRoot,
      runsRoot,
      procedureName: "handoff",
      controlPlane,
      reviewConfiguration: reviewConfiguration({ procedure: "handoff", flowIndexes: [1, 2], slots: { owner: ["human"] } })
    });
    const firstPending = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "first result" }
    });
    const firstReview = currentArtifactReview(firstPending);
    assert(firstReview);
    const firstRound = firstReview.rounds[0];

    const changed = await updateRunSlotBinding({
      runsRoot,
      runId: started.id,
      slot: "handoff::owner",
      actorIds: ["agent"]
    });
    assert.deepEqual(changed.change.before, { actorIds: ["human"] });
    assert.deepEqual(changed.change.after, { actorIds: ["agent"] });
    assert.deepEqual(changed.change.affectedReviewScopes, ["handoff#flow[1]", "handoff#flow[2]"]);
    assert.deepEqual(changed.change.preservedReviewIds, []);
    assert.deepEqual(changed.change.affectedReviews, [{
      reviewId: firstReview.id,
      artifactScope: "handoff#flow[1]",
      effectiveFromRoundSequence: 2,
      preservedRoundIds: [firstRound.id]
    }]);
    assert.deepEqual(buildRunBindingSnapshot(changed.run).slots[0], {
      key: "handoff::owner",
      binding: { actorIds: ["agent"] },
      reviewScopes: ["handoff#flow[1]", "handoff#flow[2]"],
      reviewIds: [firstReview.id],
      activeReviews: [{
        reviewId: firstReview.id,
        artifactScope: "handoff#flow[1]",
        currentRoundId: firstRound.id,
        currentRoundSequence: 1,
        currentBinding: { actorIds: ["human"] },
        nextBinding: { actorIds: ["agent"] },
        effectiveFromRoundSequence: 2
      }]
    });
    assert.deepEqual(changed.run.artifactReviews?.[0].rounds[0].assignments.map((assignment) => assignment.actorId), ["human"]);

    const firstDraft = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: firstReview.id,
      roundId: firstRound.id,
      actorId: "human",
      expectedRevision: firstRound.revision,
      draft: { vote: "approve", comments: [] }
    });
    await submitArtifactReviewAssignment({
      runsRoot,
      reviewId: firstReview.id,
      roundId: firstRound.id,
      actorId: "human",
      expectedRevision: firstDraft.round.revision
    });
    const firstApproved = await submitArtifactReviewRunnerVote({
      runsRoot,
      reviewId: firstReview.id,
      roundId: firstRound.id,
      vote: "approve"
    });
    assert.equal(currentStep(firstApproved.run)?.id, "flow[2]");

    const secondPending = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "second result" }
    });
    const reviews = secondPending.artifactReviews ?? [];
    assert.equal(reviews.length, 2);
    assert.deepEqual(reviews[0].rounds[0].assignments.map((assignment) => assignment.actorId), ["human"]);
    assert.deepEqual(reviews[1].rounds[0].assignments.map((assignment) => assignment.actorId), ["agent"]);
    assert.deepEqual(reviews[0].controlPlane.bindings["handoff::owner"].actorIds, ["human"]);
    assert.deepEqual(reviews[1].controlPlane.bindings["handoff::owner"].actorIds, ["agent"]);
  });
});

test("Run binding update applies to the next Round of the same Review without changing the current Round", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "round-handoff.yaml"), `!procedure
name: round-handoff
flow:
  - !action
    action: Review and revise it.
    artifact: !artifact
      name: result
      review: [owner]
`);
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
      name: "Same Review round handoff",
      memoryRoot,
      runsRoot,
      procedureName: "round-handoff",
      controlPlane,
      reviewConfiguration: reviewConfiguration({ procedure: "round-handoff", slots: { owner: ["human"] } })
    });
    const firstPending = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "first" }
    });
    const review = currentArtifactReview(firstPending);
    assert(review);
    const firstRound = review.rounds[0];
    const draft = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: review.id,
      roundId: firstRound.id,
      actorId: "human",
      expectedRevision: firstRound.revision,
      draft: { vote: "request_changes", comments: [{ body: "Please revise." }] }
    });
    const rejected = await submitArtifactReviewAssignment({
      runsRoot,
      reviewId: review.id,
      roundId: firstRound.id,
      actorId: "human",
      expectedRevision: draft.round.revision
    });
    assert.equal(rejected.review.status, "awaiting_revision");
    const frozenFirstRound = JSON.parse(JSON.stringify(rejected.round)) as typeof rejected.round;

    const changed = await updateRunSlotBinding({
      runsRoot,
      runId: started.id,
      slot: "round-handoff::owner",
      actorIds: ["agent"]
    });
    assert.deepEqual(changed.change.affectedReviews?.[0], {
      reviewId: review.id,
      artifactScope: "round-handoff#flow[1]",
      effectiveFromRoundSequence: 2,
      preservedRoundIds: [firstRound.id]
    });

    const revised = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "second" },
      revisionSummary: "Addressed the Human feedback."
    });
    const sameReview = currentArtifactReview(revised);
    assert(sameReview);
    assert.equal(sameReview.id, review.id);
    assert.equal(sameReview.rounds.length, 2);
    assert.deepEqual(sameReview.rounds[0], frozenFirstRound);
    assert.deepEqual(sameReview.rounds[1].assignments.map((assignment) => assignment.actorId), ["agent"]);
    assert.deepEqual(sameReview.rounds[1].controlPlane?.bindings["round-handoff::owner"].actorIds, ["agent"]);
    assert.deepEqual(sameReview.rounds[1].bindingSource?.slots["round-handoff::owner"], {
      kind: "run-update",
      changeId: changed.change.id
    });

    await updateRunSlotBinding({
      runsRoot,
      runId: started.id,
      slot: "round-handoff::owner",
      actorIds: ["human"]
    });
    const persisted = await readRun(runsRoot, started.id);
    const current = currentArtifactReview(persisted);
    assert.deepEqual(current?.rounds[1].assignments.map((assignment) => assignment.actorId), ["agent"]);
    assert.deepEqual(buildRunBindingSnapshot(persisted).slots[0].activeReviews?.[0].nextBinding, {
      actorIds: ["human"]
    });
  });
});

test("binding update and revision report are linearizable in both forced lock orders", async () => {
  await withTempDir(async (dir) => {
    for (const order of ["update-first", "report-first"] as const) {
      const scenarioRoot = join(dir, order);
      const memoryRoot = join(scenarioRoot, "memory");
      const proceduresRoot = join(memoryRoot, "procedures");
      const runsRoot = join(scenarioRoot, "runs");
      await mkdir(proceduresRoot, { recursive: true });
      await writeFile(join(proceduresRoot, "round-race.yaml"), `!procedure
name: round-race
flow:
  - !action
    action: Review and revise it.
    artifact: !artifact
      name: result
      review: [owner]
`);
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
        name: `Round binding race ${order}`,
        memoryRoot,
        runsRoot,
        procedureName: "round-race",
        controlPlane,
        reviewConfiguration: reviewConfiguration({ procedure: "round-race", slots: { owner: ["human"] } })
      });
      const pending = await reportRun({
        runsRoot,
        runId: started.id,
        artifact: { kind: "inline", value: "first" }
      });
      const review = currentArtifactReview(pending);
      assert(review);
      const firstRound = review.rounds[0];
      const draft = await updateArtifactReviewDraft({
        runsRoot,
        reviewId: review.id,
        roundId: firstRound.id,
        actorId: "human",
        expectedRevision: firstRound.revision,
        draft: { vote: "request_changes", comments: [{ body: "Revise it." }] }
      });
      await submitArtifactReviewAssignment({
        runsRoot,
        reviewId: review.id,
        roundId: firstRound.id,
        actorId: "human",
        expectedRevision: draft.round.revision
      });

      let enteredCriticalSection!: () => void;
      let releaseCriticalSection!: () => void;
      const entered = new Promise<void>((resolve) => { enteredCriticalSection = resolve; });
      const release = new Promise<void>((resolve) => { releaseCriticalSection = resolve; });
      const update = () => updateRunSlotBinding({
        runsRoot,
        runId: started.id,
        slot: "round-race::owner",
        actorIds: ["agent"],
        beforeBindingWrite: order === "update-first" ? async () => {
          enteredCriticalSection();
          await release;
        } : undefined
      });
      const report = () => reportRun({
        runsRoot,
        runId: started.id,
        artifact: { kind: "inline", value: "second" },
        revisionSummary: "Revised concurrently with the handoff.",
        beforeArtifactReview: order === "report-first" ? async () => {
          enteredCriticalSection();
          await release;
        } : undefined
      });
      const first = order === "update-first" ? update() : report();
      await entered;
      const second = order === "update-first" ? report() : update();
      releaseCriticalSection();
      await Promise.all([first, second]);

      const final = await readRun(runsRoot, started.id);
      const finalReview = currentArtifactReview(final);
      assert(finalReview);
      const secondRound = finalReview.rounds[1];
      const change = final.bindingChanges?.at(-1);
      assert(change?.affectedReviews?.[0]);
      assert.equal(change.affectedReviews[0].effectiveFromRoundSequence, order === "update-first" ? 2 : 3);
      assert.deepEqual(secondRound.assignments.map((assignment) => assignment.actorId), [
        order === "update-first" ? "agent" : "human"
      ]);
      assert.deepEqual(final.reviewConfiguration?.slots["round-race::owner"], { actorIds: ["agent"] });
    }
  });
});

test("Run binding update reaches a future loop iteration that reuses an existing Review scope", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "loop-handoff.yaml"), `!procedure
name: loop-handoff
flow:
  - !while
    condition: !action
      action: Continue?
      artifact: !artifact
        name: continue
        type: boolean
    do:
      - !action
        action: Review this iteration.
        artifact: !artifact
          name: iteration
          review: [owner]
`);
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
      name: "Loop binding handoff",
      memoryRoot,
      runsRoot,
      procedureName: "loop-handoff",
      controlPlane,
      reviewConfiguration: {
        reviews: { "loop-handoff#flow[1].do[1]": { policy: "artifact_acceptance.unanimous" } },
        slots: { "loop-handoff::owner": { actorIds: ["human"] } }
      }
    });
    const firstBody = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "true" }
    });
    assert.equal(currentStep(firstBody)?.id, "flow[1].do[1]");
    const firstPending = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "first iteration" }
    });
    const firstReview = currentArtifactReview(firstPending);
    assert(firstReview);
    const firstRound = firstReview.rounds[0];
    const firstDraft = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: firstReview.id,
      roundId: firstRound.id,
      actorId: "human",
      expectedRevision: firstRound.revision,
      draft: { vote: "approve", comments: [] }
    });
    await submitArtifactReviewAssignment({
      runsRoot,
      reviewId: firstReview.id,
      roundId: firstRound.id,
      actorId: "human",
      expectedRevision: firstDraft.round.revision
    });
    const firstApproved = await submitArtifactReviewRunnerVote({
      runsRoot,
      reviewId: firstReview.id,
      roundId: firstRound.id,
      vote: "approve"
    });
    assert.equal(currentStep(firstApproved.run)?.id, "flow[1]");

    const changed = await updateRunSlotBinding({
      runsRoot,
      runId: started.id,
      slot: "loop-handoff::owner",
      actorIds: ["agent"]
    });
    assert.deepEqual(changed.change.affectedReviewScopes, ["loop-handoff#flow[1].do[1]"]);
    assert.deepEqual(changed.change.preservedReviewIds, [firstReview.id]);
    assert.deepEqual(buildRunBindingSnapshot(changed.run).slots[0].reviewScopes, ["loop-handoff#flow[1].do[1]"]);

    const secondBody = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "true" }
    });
    assert.equal(currentStep(secondBody)?.id, "flow[1].do[1]");
    const secondPending = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "second iteration" }
    });
    const reviews = secondPending.artifactReviews ?? [];
    assert.equal(reviews.length, 2);
    assert.deepEqual(reviews[0].rounds[0].assignments.map((assignment) => assignment.actorId), ["human"]);
    assert.deepEqual(reviews[1].rounds[0].assignments.map((assignment) => assignment.actorId), ["agent"]);
  });
});

test("Run binding update validates future scopes without revalidating frozen historical scopes", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "scoped-validation.yaml"), `!procedure
name: scoped-validation
flow:
  - !action
    action: Complete the historical review.
    artifact: !artifact
      name: historical
      review: [owner]
  - !action
    action: Complete the future review.
    artifact: !artifact
      name: future
      review: [owner, approver]
`);
    const controlPlane = parseControlPlaneConfig({
      runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
      actors: {
        human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] },
        agent: {
          kind: "agent",
          name: "Agent",
          permissions: ["artifact.read", "decision.assess"],
          agent: { provider: "traex" }
        },
        approver: { kind: "human", name: "Approver", permissions: ["artifact.read", "decision.decide"] }
      }
    });
    const started = await startRun({
      name: "Scoped binding validation",
      memoryRoot,
      runsRoot,
      procedureName: "scoped-validation",
      controlPlane,
      reviewConfiguration: reviewConfiguration({
        procedure: "scoped-validation",
        flowIndexes: [1, 2],
        slots: { owner: ["human"], approver: ["approver"] }
      })
    });
    const historicalPending = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "historical" }
    });
    const historicalReview = currentArtifactReview(historicalPending);
    assert(historicalReview);
    const historicalRound = historicalReview.rounds[0];
    const historicalDraft = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: historicalReview.id,
      roundId: historicalRound.id,
      actorId: "human",
      expectedRevision: historicalRound.revision,
      draft: { vote: "approve", comments: [] }
    });
    await submitArtifactReviewAssignment({
      runsRoot,
      reviewId: historicalReview.id,
      roundId: historicalRound.id,
      actorId: "human",
      expectedRevision: historicalDraft.round.revision
    });
    await submitArtifactReviewRunnerVote({
      runsRoot,
      reviewId: historicalReview.id,
      roundId: historicalRound.id,
      vote: "approve"
    });

    const changed = await updateRunSlotBinding({
      runsRoot,
      runId: started.id,
      slot: "scoped-validation::owner",
      actorIds: ["agent"]
    });
    assert.deepEqual(changed.change.affectedReviewScopes, ["scoped-validation#flow[2]"]);
    assert.deepEqual(changed.change.preservedReviewIds, [historicalReview.id]);
    const futurePending = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "future" }
    });
    assert.deepEqual(
      currentArtifactReview(futurePending)?.rounds[0].assignments.map((assignment) => assignment.actorId).sort(),
      ["agent", "approver"].sort()
    );
    assert.deepEqual(historicalReview.controlPlane.bindings["scoped-validation::owner"].actorIds, ["human"]);
  });
});

test("Run binding update rejects invalid mutations without changing persisted state", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "guarded.yaml"), `!procedure
name: guarded
flow:
  - !action
    action: Review it.
    artifact: !artifact
      name: result
      review: [owner]
`);
    const controlPlane = parseControlPlaneConfig({
      runner: { permissions: ["artifact.read", "artifact.submit"] },
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
      name: "Invalid binding mutations",
      memoryRoot,
      runsRoot,
      procedureName: "guarded",
      controlPlane,
      reviewConfiguration: reviewConfiguration({ procedure: "guarded", slots: { owner: ["human"] } })
    });
    const before = await readRun(runsRoot, started.id);
    await assert.rejects(
      updateRunSlotBinding({ runsRoot, runId: started.id, slot: "guarded::owner", actorIds: ["missing"] }),
      /unknown frozen Actor/
    );
    await assert.rejects(
      updateRunSlotBinding({ runsRoot, runId: started.id, slot: "missing::slot", skip: true }),
      /Unknown Review Slot/
    );
    await assert.rejects(
      updateRunSlotBinding({ runsRoot, runId: started.id, slot: "guarded::owner", actorIds: ["human", "human"] }),
      /duplicate Actor/
    );
    await assert.rejects(
      updateRunSlotBinding({ runsRoot, runId: started.id, slot: "guarded::owner", actorIds: ["agent"] }),
      /decision|decid/i
    );
    const after = await readRun(runsRoot, started.id);
    assert.deepEqual(after.reviewConfiguration, before.reviewConfiguration);
    assert.equal(after.bindingChanges, undefined);

    const skipped = await updateRunSlotBinding({
      runsRoot,
      runId: started.id,
      slot: "guarded::owner",
      skip: true
    });
    assert.deepEqual(skipped.change.after, { skip: true });
    assert.equal(currentStep(skipped.run)?.reviewPolicy, undefined);
    const done = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "accepted without a future reviewer" }
    });
    assert.equal(done.status, "done");
    await assert.rejects(
      updateRunSlotBinding({ runsRoot, runId: started.id, slot: "guarded::owner", actorIds: ["human"] }),
      /not running/
    );
  });
});

test("Run binding update reaches a called Procedure before its frame is instantiated", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "parent.yaml"), `!procedure
name: binding-parent
flow:
  - !action
    action: Prepare the child.
    artifact: !artifact
      name: preparation
  - !call
    target: binding-child
`);
    await writeFile(join(proceduresRoot, "child.yaml"), `!procedure
name: binding-child
flow:
  - !action
    action: Review the child result.
    artifact: !artifact
      name: child result
      review: [owner]
`);
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
      name: "Called Procedure binding",
      memoryRoot,
      runsRoot,
      procedureName: "binding-parent",
      controlPlane,
      reviewConfiguration: reviewConfiguration({ procedure: "binding-child", slots: { owner: ["human"] } })
    });
    await updateRunSlotBinding({
      runsRoot,
      runId: started.id,
      slot: "binding-child::owner",
      actorIds: ["agent"]
    });
    const child = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "ready" }
    });
    assert.equal(currentFrame(child)?.memoryName, "binding-child");
    assert.deepEqual(currentStep(child)?.controlPlane?.bindings["binding-child::owner"].actorIds, ["agent"]);
    const pending = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "child result" }
    });
    assert.deepEqual(currentArtifactReview(pending)?.rounds[0].assignments.map((assignment) => assignment.actorId), ["agent"]);
  });
});

test("control-plane fixture validates and freezes reachable called Procedures", async () => {
  await withTempDir(async (dir) => {
    const fixtureRoot = join(process.cwd(), "test", "fixtures", "control-plane", ".memsphere");
    const fixtureConfig = JSON.parse(await readFile(join(fixtureRoot, "config.json"), "utf8")) as {
      control_plane: unknown;
    };
    const memoryRoot = join(fixtureRoot, "memory");
    const controlPlane = parseControlPlaneConfig(fixtureConfig.control_plane);
    const validation = await validateMemoryRoot(memoryRoot);
    assert.deepEqual(validation.issues, []);

    const run = await startRun({
      name: "Test run",
      memoryRoot,
      runsRoot: join(dir, "runs"),
      procedureName: "control-plane-caller",
      controlPlane
    });
    assert(run.controlPlane);
    assert(run.procedureSnapshots?.["control-plane-child"]);

    const child = await reportRun({
      runsRoot: join(dir, "runs"),
      runId: run.id,
      artifact: { kind: "inline", value: "caller" }
    });
    assert.equal(currentStep(child)?.instruction, "Produce the child Artifact.");
    assert(currentStep(child)?.controlPlane);
  });
});

test("report authorization denial leaves Run and Artifact files unchanged", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "governed.yaml"), `!procedure
name: governed
flow:
  - !action
    action: Produce a governed Artifact.
    artifact: !artifact { name: result }
`);
    const controlPlane = parseControlPlaneConfig({
      runner: { permissions: ["artifact.read"] },
      actors: {}
    });
    const run = await startRun({
      name: "Test run",
      memoryRoot,
      runsRoot,
      procedureName: "governed",
      controlPlane,
      language: "en"
    });
    const runPath = join(runsRoot, run.id, `${run.id}.json`);
    const before = await readFile(runPath, "utf8");

    await assert.rejects(
      reportRun({ runsRoot, runId: run.id, artifact: { kind: "inline", value: "denied" } }),
      (error: unknown) => {
        assert(error instanceof ArtifactAuthorizationFailure);
        assert.match(error.message, /requires artifact\.submit|requires artifact.submit/);
        assert.match(error.message, /artifact\.read/);
        return true;
      }
    );
    assert.equal(await readFile(runPath, "utf8"), before);
    assert.deepEqual(await readdir(join(runsRoot, run.id)), [`${run.id}.json`]);
  });
});

test("configured control plane authorizes every Artifact even without Memory governance fields", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "plain.yaml"), `!procedure
name: plain
flow:
  - !action
    action: Produce an ordinary Artifact.
    artifact: !artifact { name: result }
`);
    const controlPlane = parseControlPlaneConfig({
      runner: { permissions: ["artifact.read"] },
      actors: {}
    });
    const run = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "plain", controlPlane });
    assert(currentStep(run)?.controlPlane);

    await assert.rejects(
      reportRun({ runsRoot, runId: run.id, artifact: { kind: "inline", value: "denied" } }),
      ArtifactAuthorizationFailure
    );
  });
});

test("Run Review uses the runner permissions configured in the control plane", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "granted.yaml"), `!procedure
name: granted
flow:
  - !action
    action: Produce a granted Artifact.
    artifact: !artifact
      name: result
      review: [optional_reviewer]
`);
    const controlPlane = parseControlPlaneConfig({
      runner: {
        permissions: ["artifact.read", "artifact.submit"]
      },
      actors: {}
    });
    const run = await startRun({
      name: "Test run",
      memoryRoot,
      runsRoot,
      procedureName: "granted",
      controlPlane,
      reviewConfiguration: reviewConfiguration({
        procedure: "granted",
        slots: { optional_reviewer: "skip" }
      })
    });
    const completed = await reportRun({ runsRoot, runId: run.id, artifact: { kind: "inline", value: "allowed" } });
    assert.equal(completed.events[0].artifact.authorization?.allowed, true);
    assert.equal(completed.events[0].artifact.authorization?.grantSource, undefined);
  });
});

test("reachable called Procedures are frozen before the Run advances into them", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "caller.yaml"), `!procedure
name: caller
flow:
  - !action
    action: Before call.
    artifact: !artifact { name: first }
  - !call
    target: child
`);
    const childPath = join(proceduresRoot, "child.yaml");
    await writeFile(childPath, `!procedure
name: child
flow:
  - !action
    action: Original child instruction.
    artifact: !artifact { name: child result }
`);
    const controlPlane = parseControlPlaneConfig({
      runner: { permissions: ["artifact.submit"] },
      actors: {}
    });
    const run = await startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "caller", controlPlane });

    await writeFile(childPath, `!procedure
name: child
flow:
  - !action
    action: Mutated child instruction.
    artifact: !artifact { name: mutated result }
`);
    const enteredChild = await reportRun({ runsRoot, runId: run.id, artifact: { kind: "inline", value: "first" } });
    assert.equal(currentStep(enteredChild)?.instruction, "Original child instruction.");
    assert.equal(currentStep(enteredChild)?.artifact, "child result");
    assert.deepEqual(currentStep(enteredChild)?.controlPlane?.bindings, {});
  });
});

test("Artifact Review prerequisites fail before a Run is persisted", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "reviewed.yaml"), `!procedure
name: reviewed-prerequisites
flow:
  - !action
    action: Produce a reviewed Artifact.
    artifact: !artifact
      name: reviewed result
      review: [reviewer]
`);

    await assert.rejects(
      startRun({ name: "Test run", memoryRoot, runsRoot, procedureName: "reviewed-prerequisites" }),
      /Review configuration is required/
    );
    assert.deepEqual(await readdir(runsRoot), []);

    const noDecider = parseControlPlaneConfig({
      runner: { permissions: ["artifact.read", "artifact.submit"] },
      actors: {
        human: {
          kind: "human",
          name: "Human",
          permissions: ["artifact.read", "decision.assess"]
        }
      }
    });
    await assert.rejects(
      startRun({
        name: "Test run",
        memoryRoot,
        runsRoot,
        procedureName: "reviewed-prerequisites",
        controlPlane: noDecider,
        reviewConfiguration: reviewConfiguration({
          procedure: "reviewed-prerequisites",
          slots: { reviewer: ["human"] }
        })
      }),
      /requires at least one decision\.decide subject/
    );
    assert.deepEqual(await readdir(runsRoot), []);

    const duplicateActor = parseControlPlaneConfig({
      runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
      actors: {
        human: {
          kind: "human",
          name: "Human",
          permissions: ["artifact.read", "decision.assess"]
        }
      }
    });
    await assert.rejects(
      startRun({
        name: "Test run",
        memoryRoot,
        runsRoot,
        procedureName: "reviewed-prerequisites",
        controlPlane: duplicateActor,
        reviewConfiguration: reviewConfiguration({
          procedure: "reviewed-prerequisites",
          slots: { reviewer: ["human", "human"] }
        })
      }),
      /slots\.reviewed-prerequisites::reviewer\.actors\[1\]: duplicate Actor id human/
    );
    assert.deepEqual(await readdir(runsRoot), []);
  });
});

test("Artifact Review requests a revision and accepts only the approved Submission", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeFile(join(proceduresRoot, "reviewed.yaml"), `!procedure
name: reviewed
flow:
  - !action
    action: Produce a reviewed Artifact.
    artifact: !artifact
      name: reviewed result
      format: markdown
      review: [reviewer]
  - !action
    action: Continue after review.
    artifact: !artifact
      name: continuation
`);
    const controlPlane = parseControlPlaneConfig({
      runner: {
        permissions: ["artifact.read", "artifact.submit", "decision.decide"]
      },
      actors: {
        human: {
          kind: "human",
          name: "Reviewer",
          permissions: ["artifact.read", "decision.decide"]
        }
      }
    });

    const started = await startRun({
      name: "Test run",
      memoryRoot,
      runsRoot,
      procedureName: "reviewed",
      controlPlane,
      reviewConfiguration: reviewConfiguration({
        procedure: "reviewed",
        slots: { reviewer: ["human"] }
      })
    });
    let reviewChecks = 0;
    const beforeArtifactReview = async () => {
      reviewChecks += 1;
    };
    const first = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "# First candidate\n" },
      beforeArtifactReview
    });
    assert.equal(reviewChecks, 1);
    const review = currentArtifactReview(first);
    assert(review);
    assert.equal(first.events.length, 0);
    assert.equal(currentStep(first)?.id, "flow[1]");
    assert.equal(review.rounds[0].votes.length, 0);

    const duplicate = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "# First candidate\n" },
      beforeArtifactReview
    });
    assert.equal(reviewChecks, 1);
    assert.equal(currentArtifactReview(duplicate)?.rounds.length, 1);
    await assert.rejects(
      reportRun({
        runsRoot,
        runId: started.id,
        artifact: { kind: "inline", value: "# Conflicting candidate\n" },
        beforeArtifactReview
      }),
      /is in progress; wait/
    );
    assert.equal(reviewChecks, 1);

    await assert.rejects(
      updateArtifactReviewDraft({
        runsRoot,
        reviewId: review.id,
        roundId: review.currentRoundId,
        actorId: "human",
        expectedRevision: 1,
        draft: {
          vote: "approve",
          comments: [{
            body: "Wrong submission.",
            anchor: {
              submissionId: "submission-wrong",
              sourceHash: review.submissions[0].digest,
              target: "markdown:h1:0"
            }
          }]
        }
      }),
      /does not match the current Submission/
    );
    const abstainDraft = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: review.id,
      roundId: review.currentRoundId,
      actorId: "human",
      expectedRevision: 1,
      draft: { vote: "abstain", comments: [] }
    });
    await assert.rejects(
      submitArtifactReviewAssignment({
        runsRoot,
        reviewId: review.id,
        roundId: review.currentRoundId,
        actorId: "human",
        expectedRevision: abstainDraft.round.revision
      }),
      /abstain requires at least one Comment/
    );
    const draft = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: review.id,
      roundId: review.currentRoundId,
      actorId: "human",
      expectedRevision: abstainDraft.round.revision,
      draft: {
        vote: "request_changes",
        comments: [{
          body: "Please revise the candidate.",
          anchor: {
            submissionId: review.submissions[0].id,
            sourceHash: review.submissions[0].digest,
            target: " markdown:h1:0 ",
            context: " First candidate "
          }
        }]
      }
    });
    assert.deepEqual(draft.assignment.draft.comments[0]?.anchor, {
      submissionId: review.submissions[0].id,
      sourceHash: review.submissions[0].digest,
      target: "markdown:h1:0",
      location: undefined,
      context: "First candidate"
    });
    const rejected = await submitArtifactReviewAssignment({
      runsRoot,
      reviewId: review.id,
      roundId: review.currentRoundId,
      actorId: "human",
      expectedRevision: draft.round.revision
    });
    assert.equal(rejected.review.status, "awaiting_revision");
    assert.equal(rejected.run.events.length, 0);
    await assert.rejects(
      reportRun({
        runsRoot,
        runId: started.id,
        artifact: { kind: "inline", value: "# Second candidate\n" },
        beforeArtifactReview
      }),
      /requires a revision summary/
    );
    assert.equal(reviewChecks, 1);

    const second = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "# Second candidate\n" },
      revisionSummary: "Addressed the Human comment.",
      beforeArtifactReview
    });
    assert.equal(reviewChecks, 2);
    const secondReview = currentArtifactReview(second);
    assert(secondReview);
    assert.equal(secondReview.id, review.id);
    assert.equal(secondReview.rounds.length, 2);
    assert.equal(secondReview.submissions[1].revisionSummary?.previousSubmissionId, secondReview.submissions[0].id);
    await assert.rejects(
      updateArtifactReviewDraft({
        runsRoot,
        reviewId: review.id,
        roundId: secondReview.currentRoundId,
        actorId: "human",
        expectedRevision: 1,
        draft: {
          vote: "approve",
          comments: [{
            body: "Stale anchor.",
            anchor: draft.assignment.draft.comments[0]!.anchor
          }]
        }
      }),
      /does not match the current Submission/
    );

    const approvedDraft = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: review.id,
      roundId: secondReview.currentRoundId,
      actorId: "human",
      expectedRevision: 1,
      draft: { vote: "approve", comments: [] }
    });
    const awaitingRunner = await submitArtifactReviewAssignment({
      runsRoot,
      reviewId: review.id,
      roundId: secondReview.currentRoundId,
      actorId: "human",
      expectedRevision: approvedDraft.round.revision
    });
    assert.equal(awaitingRunner.review.status, "awaiting_runner_vote");
    assert.equal(awaitingRunner.round.status, "awaiting_runner_vote");
    assert.equal(awaitingRunner.run.events.length, 0);
    assert.equal(currentStep(awaitingRunner.run)?.id, "flow[1]");
    const waited = await waitForArtifactReview({ runsRoot, reviewId: review.id, pollIntervalMs: 0 });
    assert.equal(waited.review.status, "awaiting_runner_vote");
    await assert.rejects(
      submitArtifactReviewRunnerVote({
        runsRoot,
        reviewId: review.id,
        roundId: secondReview.currentRoundId,
        vote: "request_changes"
      }),
      /requires --comment/
    );
    const runnerRejected = await submitArtifactReviewRunnerVote({
      runsRoot,
      reviewId: review.id,
      roundId: secondReview.currentRoundId,
      vote: "request_changes",
      comment: "Please address the advisory feedback before acceptance."
    });
    assert.equal(runnerRejected.review.status, "awaiting_revision");
    assert.equal(runnerRejected.run.events.length, 0);
    assert.equal(runnerRejected.round.votes.find((vote) => vote.subject.kind === "runner")?.automatic, false);
    assert.equal(
      runnerRejected.round.votes.find((vote) => vote.subject.kind === "runner")?.comment,
      "Please address the advisory feedback before acceptance."
    );

    const third = await reportRun({
      runsRoot,
      runId: started.id,
      artifact: { kind: "inline", value: "# Third candidate\n" },
      revisionSummary: "Addressed the Runner decision comment."
    });
    const thirdReview = currentArtifactReview(third);
    assert(thirdReview);
    const thirdDraft = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: review.id,
      roundId: thirdReview.currentRoundId,
      actorId: "human",
      expectedRevision: 1,
      draft: { vote: "approve", comments: [] }
    });
    await submitArtifactReviewAssignment({
      runsRoot,
      reviewId: review.id,
      roundId: thirdReview.currentRoundId,
      actorId: "human",
      expectedRevision: thirdDraft.round.revision
    });
    const approved = await submitArtifactReviewRunnerVote({
      runsRoot,
      reviewId: review.id,
      roundId: thirdReview.currentRoundId,
      vote: "approve"
    });
    assert.equal(approved.review.status, "passed");
    assert.equal(approved.run.events.length, 1);
    assert.equal(approved.run.events[0].artifact.path?.includes(thirdReview.submissions[2].id), true);
    assert.equal(currentStep(approved.run)?.id, "flow[2]");
    const waitedAfterVote = await waitForArtifactReview({ runsRoot, reviewId: review.id, pollIntervalMs: 0 });
    assert.equal(waitedAfterVote.review.status, "passed");
    assert.equal(waitedAfterVote.round.id, thirdReview.currentRoundId);
  });
});

test("Artifact Review snapshots every prior Artifact without giving blocking advisories veto power", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    const runsRoot = join(dir, "runs");
    await mkdir(proceduresRoot, { recursive: true });
    await writeRawFile(join(proceduresRoot, "package.yaml"), `!procedure
syntax: ${currentMemorySyntax}
name: package-review
flow:
  - !action
    action: Record implementation.
    artifact: !artifact
      name: implementation
      format: markdown
  - !action
    action: Record validation.
    artifact: !artifact
      name: validation
      format: markdown
  - !action
    action: Review delivery package.
    artifact: !artifact
      name: review material
      format: markdown
      review: [advisor]
`);
    const controlPlane = parseControlPlaneConfig({
      runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
      actors: {
        advisor: {
          kind: "human",
          name: "Advisor",
          permissions: ["artifact.read", "decision.assess"]
        }
      }
    });
    let run = await startRun({
      name: "Test run",
      memoryRoot,
      runsRoot,
      procedureName: "package-review",
      controlPlane,
      reviewConfiguration: reviewConfiguration({
        procedure: "package-review",
        flowIndexes: [3],
        slots: { advisor: ["advisor"] }
      })
    });
    run = await reportRun({ runsRoot, runId: run.id, artifact: { kind: "inline", value: "# Implementation\nChanged src/a.ts." } });
    run = await reportRun({ runsRoot, runId: run.id, artifact: { kind: "inline", value: "# Validation\nnpm test passed." } });
    run = await reportRun({ runsRoot, runId: run.id, artifact: { kind: "inline", value: "# Review material\nReady." } });
    const review = currentArtifactReview(run);
    assert(review);
    const submission = review.submissions[0];
    assert.deepEqual(submission.contextArtifacts.map((item) => [item.stepId, item.artifact.name]), [
      ["flow[1]", "implementation"],
      ["flow[2]", "validation"]
    ]);
    for (const item of submission.contextArtifacts) {
      assert.match(item.artifact.path ?? "", /artifacts\/reviews\/review-.*\/submission-.*\/context\//);
      assert.equal(typeof await readFile(join(runsRoot, item.artifact.path!), "utf8"), "string");
    }

    const draft = await updateArtifactReviewDraft({
      runsRoot,
      reviewId: review.id,
      roundId: review.currentRoundId,
      actorId: "advisor",
      expectedRevision: 1,
      draft: {
        vote: "request_changes",
        comments: [{ body: "Fix the implementation issue.", severity: "blocking" }]
      }
    });
    const awaitingRunner = await submitArtifactReviewAssignment({
      runsRoot,
      reviewId: review.id,
      roundId: review.currentRoundId,
      actorId: "advisor",
      expectedRevision: draft.round.revision
    });
    assert.equal(awaitingRunner.assignment.submitted?.comments[0].severity, "blocking");
    const approved = await submitArtifactReviewRunnerVote({
      runsRoot,
      reviewId: review.id,
      roundId: review.currentRoundId,
      vote: "approve"
    });
    assert.equal(approved.review.status, "passed");
    assert.equal(approved.round.commentDispositions, undefined);
  });
});
