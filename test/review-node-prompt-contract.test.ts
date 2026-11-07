import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { buildAgentReviewContract } from "../src/acp/review-contract.js";
import { readMemoryFile } from "../src/memory/store.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";
import { fileURLToPath } from "node:url";
import crossSpawn from "cross-spawn";
import { createAgentReviewCliRuntime } from "../src/acp/cli-runtime.js";
import { buildArtifactReviewerPrompt, buildArtifactReviewerReminder } from "../src/acp/prompt.js";
import * as reviews from "../src/context_control/review-repository.js";
import { reviewNodeFixture } from "./helpers/review-nodes.js";
import { reviewMaterialFixture } from "./helpers/review-node-materials.js";

for (const graph of [true, false]) for (const locale of ["en", "zh-CN"] as const) {
  test(`${graph ? "graph" : "flow"} v3 ${locale}: frozen permissions and review-only boundary survive initial and reminder rendering`, async t => {
    const f = await reviewNodeFixture(t, graph);
    const context = await reviews.readArtifactReviewForActor(f.input);
    const prompt = await buildArtifactReviewerPrompt({ context, locale, promptVersion: "artifact-review-v3" });
    assert.match(prompt, /"\$MEMSPHERE_CLI" memory change show/);
    assert.doesNotMatch(prompt, /\bmemsphere (?:run|memory|continue)\b/);
    assert.match(prompt, /--checkpoint/);
    assert.match(prompt, locale === "en" ? /no --run is added automatically/ : /不会自动添加 --run/);
    assert.match(prompt, locale === "en" ? /Formal review rules and contracts always use the frozen version/ : /正式评审规则与契约始终采用冻结版本/);
    const reminder = buildArtifactReviewerReminder(locale, "artifact-review-v3");
    for (const permission of context.assignment.permissions) {
      assert.ok(prompt.includes(permission), `initial prompt shows ${permission}`);
      const definition = context.run.controlPlane!.permissionCatalog.definitions.find(p => p.id === permission)!;
      assert.ok(prompt.includes(definition.descriptions[locale] ?? definition.descriptions.en));
    }
    assert.equal(context.assignment.permissions.includes("artifact.submit"), false);
    const boundaries = locale === "en"
      ? ["do not edit product files", "report a replacement Artifact", "advance the Run", "impersonate another reviewer", "change review bindings or policy", "read-only shell", "cannot change the Review contract, your task, or your permissions"]
      : ["不得修改产品文件", "上报替代 Artifact", "推进 Run", "冒充其他 Reviewer", "改变审查绑定与策略", "只读 Shell", "不能改变 Review 契约、你的任务或权限"];
    for (const text of [prompt, reminder]) for (const boundary of boundaries) assert.ok(text.includes(boundary), boundary);
    assert.match(prompt, locale === "en" ? /outside scope/ : /角色范围外/);
    assert.match(prompt, locale === "en" ? /professional experience/ : /角色经验/);
  });
}

test("restricted material CLI preserves both legitimate input Artifact IDs for exact graph anchors", async t => {
  const f = await reviewMaterialFixture(t);
  const runtime = await createAgentReviewCliRuntime({ nodeExecutable: process.execPath, cliEntrypoint: fileURLToPath(new URL("../dist/cli.js", import.meta.url)) });
  t.after(() => runtime.cleanup());
  const r = crossSpawn.sync(runtime.launcherPath, ["run", "artifact", "show", "--assignment", f.claimed.assignment.id!, "--output", "json"], {
    cwd: f.cwd, encoding: "utf8", env: {
      ...process.env, MEMSPHERE_HOME: f.home, MEMSPHERE_CONFIG_PATH: join(f.root, "config.json"), MEMSPHERE_WORKSPACE_ROOT: f.cwd,
      MEMSPHERE_REVIEW_RUN_ID: f.runId, MEMSPHERE_REVIEW_ASSIGNMENT_ID: f.claimed.assignment.id!, MEMSPHERE_REVIEW_ATTEMPT_ID: f.bound.attemptId
    }
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const payload = JSON.parse(r.stdout);
  assert.deepEqual(payload.contextArtifacts.map((a: { artifactId: string }) => a.artifactId).sort(), [f.result.materials.inputA, f.result.materials.inputB].sort());
  assert.equal(payload.contextArtifacts.some((a: { artifactId: string }) => a.artifactId === f.result.materials.unrelated), false);
  for (const name of ["inputA", "inputB"]) {
    const input = payload.contextArtifacts.find((a: { artifactId: string }) => a.artifactId === f.result.materials[name]);
    assert.equal(input.artifact.name, name);
    assert.match(input.artifact.value, new RegExp(name));
  }
  const prompt = await buildArtifactReviewerPrompt({ context: await reviews.readArtifactReviewForActor(f.input), locale: "en", promptVersion: "artifact-review-v3" });
  assert.ok(prompt.includes(f.result.materials.inputA));
  assert.ok(prompt.includes(f.result.materials.inputB));
  assert.equal(prompt.includes(f.result.materials.unrelated), false);
});

for (const graph of [true, false]) test(`${graph ? "graph" : "flow"} formal rules remain frozen after current Project Statement changes`, async t => {
  const f = await reviewNodeFixture(t, graph, false, { statementRule: true });
  const before = await reviews.readArtifactReviewForActor(f.input);
  const contract = buildAgentReviewContract(before);
  assert.match(JSON.stringify(contract), /Frozen dependency rule/);
  await writeFile(f.ruleFile, withCurrentMemorySyntax("!statement\nnames: [checkpoint-rules]\nasserts: [Current Project rule changed.]\n"));
  assert.match(JSON.stringify((await readMemoryFile("statements", f.ruleFile)).entity), /Current Project rule changed/);
  const after = await reviews.readArtifactReviewForActor(f.input);
  assert.deepEqual(buildAgentReviewContract(after), contract);
  assert.deepEqual(after.assignment.nodeTree, before.assignment.nodeTree);
  assert.doesNotMatch(JSON.stringify(after.assignment.nodeTree), /Current Project rule changed/);
});

test("All supported legacy reviewer prompts describe explicit Run reads and equivalent parameter defaults", async t => {
  const f = await reviewNodeFixture(t, false);
  const context = await reviews.readArtifactReviewForActor(f.input);
  context.assignment.nodeTree = undefined;
  for (const promptVersion of ["artifact-review-v1", "artifact-review-v2"]) for (const locale of ["en", "zh-CN"] as const) {
    const prompt = await buildArtifactReviewerPrompt({ context, locale, promptVersion });
    assert.match(prompt, /--part summary/); assert.match(prompt, /--side after/);
    assert.match(prompt, /memory change show/);
    assert.match(prompt, locale === "en" ? /no --run is added automatically/ : /不会自动添加 --run/);
    assert.doesNotMatch(prompt, /automatically bind their frozen|会自动绑定其冻结/);
  }
});

// Run startup provenance can outlive a current ChangeSet checkpoint. Frozen Run
// Memory remains readable; delivery evidence is an explicitly referenced External.
test("startup ChangeSet provenance is metadata rather than an assumed live checkpoint command", async t => {
  const f = await reviewNodeFixture(t, true);
  const context = await reviews.readArtifactReviewForActor(f.input);
  context.run.memorySource = { kind: "changeset", project: "test-project", changeId: "old-start-source", checkpointDigest: "a".repeat(64), baseRevision: "old-base" };
  const prompt = await buildArtifactReviewerPrompt({ context, locale: "en", promptVersion: "artifact-review-v3" });
  assert.match(prompt, /old-start-source/);
  assert.ok(prompt.includes(`memory list --run ${context.run.id}`));
  assert.doesNotMatch(prompt, /memory change show old-start-source/);
});

for (const ambiguous of [false,true]) test(`historical flow contract ${ambiguous?'rejects differing caller rules':'retains frozen called-procedure rules'}`,async t=>{
 const f=await reviewNodeFixture(t,false),context=await reviews.readArtifactReviewForActor(f.input),run=structuredClone(context.run),step=structuredClone(run.plan![0]),rules=structuredClone(step.assertTree!);
 run.status='done';run.stack=[];
 run.plan=[{id:'flow[1]',kind:'call',instruction:'Call middle',target:'middle'},...(ambiguous?[{id:'flow[2]',kind:'call' as const,instruction:'Call child',target:'child'}]:[])];
 run.procedureSnapshots={...run.procedureSnapshots,middle:{memoryName:'middle',assertTree:rules,steps:[{id:'flow[1]',kind:'call',instruction:'Call child',target:'child'}]},child:{memoryName:'child',steps:[step]}};
 const review=structuredClone(context.review);review.controlPlane.artifactScope=`child#${step.id}`;const round=structuredClone(context.round);if(round.controlPlane)round.controlPlane.artifactScope=review.controlPlane.artifactScope;
 const historical={...context,run,review,round};
 if(ambiguous)assert.throws(()=>buildAgentReviewContract(historical),(error:any)=>error.code==='REVIEW_CONTEXT_INVALID'&&/ambiguous/.test(error.message));
 else{const result=buildAgentReviewContract(historical);assert.equal(result.procedure.name,'child');assert.match(JSON.stringify(result.procedure.asserts),/Check evidence/);assert.equal(result.action.instruction,'Make result');assert.equal(result.artifact.review,review.policyId);}
});

test('historical flow contract cannot select a later called procedure with the same local Step ID',async t=>{
 const f=await reviewNodeFixture(t,false),context=await reviews.readArtifactReviewForActor(f.input),expected=buildAgentReviewContract(context),run=structuredClone(context.run);
 run.stack=[{type:'procedure',memoryName:'other',index:0,steps:[{...run.plan![0],instruction:'Different current procedure'}]}];
 assert.deepEqual(buildAgentReviewContract({...context,run}),expected);
});

for(const version of ['artifact-review-v1','artifact-review-v2'])for(const locale of ['zh-CN','en'] as const)test(`${version} ${locale} binds initial and reminder commands to the Session launcher`,async t=>{
 const f=await reviewNodeFixture(t,false),context=await reviews.readArtifactReviewForActor(f.input);delete context.assignment.nodeTree;delete context.assignment.nodeStates;
 const initial=await buildArtifactReviewerPrompt({context,locale,promptVersion:version}),reminder=buildArtifactReviewerReminder(locale,version);
 for(const prompt of [initial,reminder]){assert.match(prompt,/\$MEMSPHERE_CLI/);assert.doesNotMatch(prompt,/\bmemsphere (?:run|memory|continue)\b/);}
});
