import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { parseControlPlaneConfig } from "../src/control-plane/index.js";
import { currentArtifactReview, reportRun, startRun } from "../src/run/store.js";
import { businessFixture } from "./helpers/business-data.js";
import { invokeCliModule } from "./helpers/cli-module.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";
import { reviewConfiguration } from "./helpers/review.js";

test("historical flow CLI keeps the current candidate and binding frozen when its future reviewer changes", async t => {
  const f = await businessFixture(t, {});
  const memoryRoot = join(f.root, "memory"), runsRoot = join(f.root, "runs");
  await mkdir(join(memoryRoot, "procedures"));
  await writeFile(join(memoryRoot, "procedures", "delivery.yaml"), withCurrentMemorySyntax(`!procedure
name: delivery
flow:
  - !action
    action: Review the delivery.
    artifact: !artifact
      name: delivery
      format: markdown
      review: [owner]
`));
  const started = await startRun({ name: "Legacy delivery", memoryRoot, runsRoot, procedureName: "delivery",
    controlPlane: parseControlPlaneConfig({
      runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] },
      actors: Object.fromEntries(["original", "next"].map(id => [id,
        { kind: "human", name: id, permissions: ["artifact.read", "decision.decide"] }]))
    }), reviewConfiguration: reviewConfiguration({ procedure: "delivery", slots: { owner: ["original"] } }) });
  const sourceFile = join(f.directory, "original.md");
  await writeFile(sourceFile, "Published candidate");
  const reported = await reportRun({ runsRoot, runId: started.id, artifact: { kind: "file", path: sourceFile } });
  const review = currentArtifactReview(reported)!;
  const roundId = review.currentRoundId;
  const env = { ...process.env, MEMSPHERE_HOME: f.home };
  const call = async (args: string[], json = false) => {
    const r = await invokeCliModule(["--project", "test-project", "run", ...args, "--run", started.id,
      ...(json ? ["--output", "json"] : [])], f.cwd, env, "memsphere");
    assert.equal(r.stderr, "");
    return r.stdout;
  };
  const show = ["binding", "show"], update = ["binding", "update", "--slot", "delivery::owner", "--actor", "next"];
  const before = JSON.parse(await call(show, true));
  assert.deepEqual(before.slots[0].binding.actorIds, ["original"]);
  assert.ok((await call(show)).includes("delivery::owner"));
  const change = JSON.parse(await call(update, true));
  assert.deepEqual(change.nextBinding.actorIds, ["next"]);
  const frozen = change.bindings.slots[0].activeReviews[0];
  assert.equal(frozen.currentRoundId, roundId);
  assert.deepEqual(frozen.currentBinding.actorIds, ["original"]);
  assert.deepEqual(frozen.nextBinding.actorIds, ["next"]);
  assert.ok((await call([...update.slice(0, -1), "original"])).includes(roundId));
  const target = ["--step", review.stepId];
  const receipt = JSON.parse(await call(["artifact", "show", ...target], true));
  assert.equal(receipt.source, "review_submission");
  assert.equal(receipt.artifact.value, "Published candidate");
  assert.ok((await call(["artifact", "show", ...target])).includes("Published candidate"));
  const output = join(f.directory, "export.md");
  const exported = JSON.parse(await call(["artifact", "export", ...target, "--file", output], true));
  assert.equal(exported.exported, output);
  assert.equal(await readFile(output, "utf8"), "Published candidate");
  for (const args of [["step", "show", ...target], ["artifact", "contract", "show", ...target]]) {
    const detail = JSON.parse(await call(args, true));
    assert.ok(JSON.stringify(detail).includes("delivery"));
    assert.ok((await call(args)).includes("delivery"));
  }
});
