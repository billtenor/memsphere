import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ExplorationReviews } from "../src/context_control/exploration-review.js";
import { explorationFixture as fixture } from "./helpers/exploration.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

test("free exploration Schema and Runner Review use explicit native targets and Continue bindings", { timeout: 60000 }, async t => {
  const f = await fixture(t), R = (await f.call("run", "start", "--name", "Explore")).id;
  await writeFile(f.schema, (await readFile(f.schema, "utf8")) + "  - !repeat\n    limit: {min: 0, max: 2}\n    body: [Example]\n");
  const draft = await f.call("continue", "enter-schema", "report", "--name", "Findings", "--content-type", "text/markdown");
  const A = draft.artifactId, S = draft.stepId;
  const repository = new ExplorationReviews(f.service);
  await assert.rejects(f.call("run", "review", "start", "--run", R, "--artifact", A), /INCOMPLETE_ARTIFACT/);
  assert.equal((await f.call("run", "enter-schema", "--run", R, "--step", S)).artifactId, A);
  const title = await f.call("continue", "schema", "report", "--position", draft.position, "--artifact", "# Findings");
  const next = await f.call("continue", "skip", "--position", title.position);
  await assert.rejects(f.call("continue", "schema", "report", "--position", draft.position, "--artifact", "1"), /POSITION|position/);
  await assert.rejects(f.call("continue", "schema", "report", "--position", next.position, "--artifact", "invalid"));
  assert.equal((await f.call("continue", "schema", "show")).position, next.position);
  const count = await f.call("continue", "schema", "report", "--position", next.position, "--artifact", "42");
  const repeat = await f.call("continue", "repeat", "1", "--position", count.position);
  const saved = await f.call("continue", "schema", "report", "--position", repeat.position, "--artifact", "An example");
  assert.equal(saved.phase, "awaiting_finalization");
  const path = join(f.directory, "draft.md");
  await f.call("continue", "artifact", "export", "--file", path);
  assert.match(await readFile(path, "utf8"), /42/);
  assert.match(await readFile(path, "utf8"), /An example/);
  const E = (await f.call("continue", "external", "add", "--source", "used", "--content", "fixed")).externalId;
  const unused = (await f.call("continue", "external", "add", "--source", "unattached", "--content", "unused")).externalId;
  assert.equal((await f.call("continue", "report", "--depends-on", `external:${E}`)).artifactId, A);
  await assert.rejects(f.call("continue", "review", "start", "--artifact", A), /REVIEWER_REQUIRED/);
  await f.call("continue", "step", "configure", "--step", S, "--reviewer", "runner");
  await assert.rejects(f.call("continue", "review", "start", "--artifact", A), /REVIEW_RULES_REQUIRED/);
  assert.deepEqual(await repository.list(R), []);
  await f.call("continue", "step", "configure", "--step", S, "--asserts", "fact", "--suggests", "statements/fact");
  const first = await f.call("continue", "review", "start", "--artifact", A), V = first.reviewId;
  assert.deepEqual(first.materials.map((ref: { id: string }) => ref.id), [A, E]);
  assert.ok(!first.materials.some((ref: { id: string }) => ref.id === unused));
  await assert.rejects(f.call("continue", "review", "submit", "--artifact", '{"vote":"approve"}'), /review_node_incomplete/);
  await writeFile(f.statement, withCurrentMemorySyntax("!statement\nnames: [fact]\nasserts: [Check updated fact]\nsuggests: [Use plain language]\n"));
  const frozen = await f.call("run", "review", "show", "--run", R, "--review", V, "--all");
  assert.ok(frozen.nodes.some((n: { asserts: Array<{ text: string }> }) => n.asserts.some(rule => rule.text === "Check original fact")));
  let progress = await f.call("continue", "review", "show");
  const ruleNode = progress.node.nodeId;
  progress = await f.call("run", "review", "report", "--run", R, "--review", V, "--artifact", '{"applicable":true}');
  const afterUpdate = await f.call("continue", "review", "update", "--node", ruleNode, "--artifact", '{"applicable":true,"comments":[]}');
  assert.equal(afterUpdate.node.nodeId, progress.node.nodeId);
  while (progress.node?.kind !== "open_review") progress = await f.call("continue", "review", "report", "--artifact", '{"applicable":true}');
  const finding = await f.call("run", "review", "comment", "add", "--run", R, "--review", V, "--node", progress.node.nodeId,
    "--artifact", '{"body":"First opinion","severity":"suggestion"}');
  const comment = finding.node.comments[0].commentId;
  const updated = await f.call("continue", "review", "comment", "update", "--comment", comment, "--artifact", '{"body":"Updated opinion"}');
  assert.equal(updated.node.comments[0].body, "Updated opinion");
  const deleted = await f.call("run", "review", "comment", "delete", "--run", R, "--review", V, "--comment", comment);
  assert.deepEqual(deleted.node.comments, []);
  while (progress.node) progress = await f.call("continue", "review", "report", "--artifact", '{"applicable":true}');
  assert.equal((await f.call("run", "review", "submit", "--run", R, "--review", V, "--artifact", '{"vote":"approve","summary":"Confirmed"}')).status, "submitted");
  await assert.rejects(f.call("continue", "review", "show"), /Enter a Review/);
  const old = await f.call("run", "review", "show", "--run", R, "--review", V);
  assert.equal(old.vote.value, "approve");
  const revised = await f.call("continue", "enter-schema", "--revised-from", A);
  assert.notEqual(revised.artifactId, A);
  const inherited = await f.call("run", "step", "show", "--run", R, "--step", revised.stepId);
  assert.equal(inherited.configuration.inheritedFrom.artifactId, A);
  assert.deepEqual(inherited.configuration.asserts, ["statements/fact"]);
  await f.call("continue", "step", "configure", "--step", revised.stepId, "--clear-asserts");
  assert.deepEqual((await f.call("run", "step", "show", "--run", R, "--step", S)).configuration.asserts, ["statements/fact"]);
  const second = await f.call("run", "review", "start", "--run", R, "--artifact", A);
  assert.notEqual(second.reviewId, V);
  assert.deepEqual((await f.call("run", "review", "list", "--run", R, "--artifact", A)).map((r: { id: string }) => r.id), []);
  assert.equal((await f.call("run", "review", "list", "--run", R, "--artifact", A, "--progressive")).length, 2);
});

test("exploration Schema CLI writes files and empty fields and preserves an incomplete draft", { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const R = (await f.call("run", "start", "--name", "Schema field inputs")).id;
  const draft = await f.call("run", "enter-schema", "report", "--run", R, "--name", "Findings", "--content-type", "text/markdown");
  const S = draft.stepId;
  const field = join(f.directory, "title.md");
  await writeFile(field, "# Findings\n");
  const notes = await f.call("run", "schema", "report", "--run", R, "--step", S, "--position", draft.position, "--artifact-file", field);
  assert.ok(Object.values(notes.draft.writing.values).includes("# Findings\n"));
  const count = await f.call("continue", "schema", "report", "--position", notes.position, "--artifact", "");
  assert.ok(Object.values(count.draft.writing.values).includes(""));
  assert.deepEqual(count.progress.skipped, []);

  const second = await f.call("continue", "enter-schema", "report", "--name", "Other draft", "--content-type", "text/markdown");
  assert.notEqual(second.artifactId, draft.artifactId);
  assert.equal((await f.call("continue", "enter-schema", "--step", S)).position, count.position);
  const incomplete = await f.service.inspect(R);
  await assert.rejects(f.call("continue", "report"), /SCHEMA_INCOMPLETE/);
  assert.deepEqual(await f.service.inspect(R), incomplete);

  await assert.rejects(f.call("continue", "schema", "report", "--position", count.position, "--artifact", ""), /number|finite/i);
  const restored = await f.call("continue", "schema", "show");
  assert.equal(restored.position, count.position);
  assert.deepEqual(restored.draft, count.draft);
  assert.equal((await f.call("run", "schema", "show", "--run", R, "--step", second.stepId)).position, second.position);
  await f.call("continue", "schema", "report", "--position", count.position, "--artifact", "42");
  assert.equal((await f.call("continue", "report")).artifactId, draft.artifactId);
});

test("Step configuration changes only selected fields and Continue rejects another Run's targets", { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const R = (await f.call("run", "start", "--name", "Configured Run")).id;
  const candidate = await f.call("continue", "report", "--name", "Candidate", "--artifact", "Body");
  const S = candidate.stepId;
  const configure = (...options: string[]) => f.call("continue", "step", "configure", "--step", S, ...options);
  const show = () => f.call("run", "step", "show", "--run", R, "--step", S);
  const configured = await configure("--asserts", "fact", "--suggests", "fact", "--reviewer", "runner");
  for (const options of [
    ["--asserts", "fact", "--clear-asserts"],
    ["--suggests", "fact", "--clear-suggests"],
    ["--reviewer", "runner", "--clear-reviewer"]
  ]) await assert.rejects(configure(...options), /Choose setting or clearing/);
  await assert.rejects(configure("--asserts", "statements/absent"), /absent/);
  await assert.rejects(configure("--suggests", ""));
  await assert.rejects(configure("--reviewer", "project:absent"), /INVALID_REVIEWER/);
  assert.deepEqual((await show()).configuration, configured.configuration);
  for (const [option, field] of [["--clear-asserts", "asserts"], ["--clear-suggests", "suggests"], ["--clear-reviewer", "reviewer"]] as const) {
    const expected = { ...(await show()).configuration };
    if (field === "reviewer") delete expected[field];
    else expected[field] = [];
    assert.deepEqual((await configure(option)).configuration, expected);
  }

  const other = (await f.call("run", "start", "--name", "Foreign Run")).id;
  const foreign = await f.call("continue", "report", "--name", "Foreign candidate", "--artifact", "Other body");
  const draft = await f.call("continue", "enter-schema", "report", "--name", "Local draft", "--content-type", "text/markdown");
  await assert.rejects(f.call("continue", "step", "configure", "--step", S, "--reviewer", "runner"), /NOT_FOUND/);
  await assert.rejects(f.call("continue", "review", "start", "--artifact", candidate.artifactId), /NOT_FOUND/);
  assert.equal((await f.call("continue", "schema", "show")).position, draft.position);
  await f.call("run", "enter", "--run", R);
  await assert.rejects(f.call("continue", "review", "start", "--artifact", foreign.artifactId), /NOT_FOUND/);
  const repository = new ExplorationReviews(f.service);
  assert.deepEqual(await repository.list(R), []);
  assert.deepEqual(await repository.list(other), []);
});

for (const schema of [false, true]) {
  test(`${schema ? "Schema" : "ordinary"} CLI revision reviews retained and newly attached External independently`, { timeout: 30000 }, async t => {
    const f = await fixture(t);
    const R = (await f.call("run", "start", "--name", "Review material versions")).id;
    const first = (await f.call("continue", "external", "add", "--source", "First", "--content", "First material")).externalId;
    const write = async (draft: { position: string }) => {
      const notes = await f.call("continue", "schema", "report", "--position", draft.position, "--artifact", "# Findings");
      const count = await f.call("continue", "skip", "--position", notes.position);
      await f.call("continue", "schema", "report", "--position", count.position, "--artifact", "42");
    };
    let original;
    if (schema) {
      const draft = await f.call("continue", "enter-schema", "report", "--name", "Findings", "--content-type", "text/markdown");
      await write(draft);
      original = await f.call("continue", "report", "--depends-on", `external:${first}`);
      assert.equal(original.artifactId, draft.artifactId);
    } else {
      original = await f.call("continue", "report", "--name", "Findings", "--artifact", "First", "--depends-on", `external:${first}`);
    }
    const A1 = original.artifactId, S1 = original.stepId;
    await f.call("continue", "step", "configure", "--step", S1, "--asserts", "fact", "--reviewer", "runner");
    const old = await f.call("continue", "review", "start", "--artifact", A1);
    let progress = old;
    while (progress.node) progress = await f.call("continue", "review", "report", "--artifact", '{"applicable":true}');
    await f.call("continue", "review", "submit", "--artifact", '{"vote":"approve"}');
    const second = (await f.call("continue", "external", "add", "--source", "Second", "--content", "Second material")).externalId;
    const dependencies = ["--depends-on", `external:${first}`, "--depends-on", `external:${second}`];
    let revision;
    if (schema) {
      const draft = await f.call("continue", "enter-schema", "--revised-from", A1);
      const before = await f.service.explorationSchemaShow(R, S1);
      assert.deepEqual(draft.draft.schemaContract, before.draft.schemaContract);
      await write(draft);
      revision = await f.call("continue", "report", ...dependencies);
      assert.equal(revision.artifactId, draft.artifactId);
    } else {
      revision = await f.call("run", "report", "--run", R, "--revised-from", A1, "--artifact", "Second", ...dependencies);
    }
    const A2 = revision.artifactId, S2 = revision.stepId;
    assert.notEqual(A1, A2);
    assert.notEqual(S1, S2);
    const inherited = (await f.call("run", "step", "show", "--run", R, "--step", S2)).configuration;
    assert.deepEqual(inherited, {
      inheritedFrom: { artifactId: A1, stepId: S1 }, asserts: ["statements/fact"], reviewer: "runner"
    });
    await f.call("continue", "step", "configure", "--step", S2, "--clear-asserts", "--suggests", "fact");
    const updated = await f.call("continue", "review", "start", "--artifact", A2);
    const again = await f.call("run", "review", "start", "--run", R, "--artifact", A1);
    assert.notEqual(again.reviewId, old.reviewId);
    assert.deepEqual(updated.configuration, { asserts: [], suggests: ["statements/fact"], reviewer: "runner" });
    assert.deepEqual(again.configuration, old.configuration);
    assert.deepEqual((await f.call("run", "review", "show", "--run", R, "--review", old.reviewId)).materials, old.materials);
    const materialIds = (review: { materials: Array<{ id: string }> }) => review.materials.map(ref => ref.id);
    assert.deepEqual(materialIds(again), [A1, first]);
    assert.deepEqual(materialIds(updated), [A2, first, second]);
    const saved = await f.service.inspect(R);
    assert.deepEqual(saved.artifacts.find(a => a.id === A1)?.dependencies.map(ref => ref.id), [first]);
    assert.deepEqual(saved.artifacts.find(a => a.id === A2)?.dependencies.map(ref => ref.id), [first, second]);
  });
}
