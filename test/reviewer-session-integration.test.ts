import { graphReviewId } from "../src/context_control/graph-review.js";
import { buildArtifactReviewerPrompt } from "../src/acp/prompt.js";
import { createHash } from "node:crypto";
import { openBusinessStore } from "../src/project/business-stores.js";
import { bytesContent } from "../src/data/extensions/shared/payload.js";
import assert from "node:assert/strict";
import test from "node:test";
import crossSpawn from "cross-spawn";
import { mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initializedContextFixture } from "./helpers/initialized-context.js";
import { openContextControl } from "../src/project/context-control.js";
import { createAgentReviewCliRuntime } from "../src/acp/cli-runtime.js";
import { graphMemorySyntax } from "../src/memory/syntax.js";
import type { GraphAction, GraphProcedureMemory } from "../src/memory/ast.js";
import * as reviews from "../src/context_control/review-repository.js";
import { runGit, gitOutput } from "../src/git.js";
import { GraphRuntime } from "../src/context_control/graph-runtime.js";
import { currentReviewNode } from "../src/review-nodes.js";
const entrypoint = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const spec = { name: "Result", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/markdown" } };
const action = (id: string, from = "START", review = false): GraphAction => ({ tag: "!action", id, description: id, dependencies: [{ tag: "!dependency", from }], artifact: { ...spec, ...(review ? { review: ["test"] } : {}) } });

async function evidenceFixture(t: test.TestContext) {
  const f = await initializedContextFixture(t, { "text.json": { type: "string" } }), service = (await openContextControl(f.root))!;
  await mkdir(join(f.root, "memory", "concepts"), { recursive: true });
  await writeFile(join(f.root, "memory", "concepts", "live-evidence.yaml"), `!concept\nsyntax: ${graphMemorySyntax}\nnames: [live-evidence]\ndefines: [Current Project auxiliary evidence.]\n`);
  for (const kind of ["statements", "procedures", "schemas"]) await mkdir(join(f.root, "memory", kind), { recursive: true });
  await runGit(["init", "-b", "master"], { cwd: join(f.root,"memory") });
  await runGit(["add", "."], { cwd: join(f.root,"memory") });
  await runGit(["-c","user.name=Test","-c","user.email=test@example.com","commit","-qm","Memory fixture"], { cwd: join(f.root,"memory") });
  const configFile=join(f.root,"config.json"), cfg=JSON.parse(await readFile(configFile,"utf8"));
  cfg.store.published_revision=await gitOutput(["rev-parse","HEAD"],join(f.root,"memory")); await writeFile(configFile,JSON.stringify(cfg));
  const procedure: GraphProcedureMemory = { tag: "!procedure", syntax: graphMemorySyntax, mode: "graph", names: ["reviewer-evidence"], defines: ["Evidence"], asserts: ["Global frozen rule"], actions: [{ ...action("A"), artifact: { ...spec, review: ["source"] } }, action("U"), action("B", "A"), action("C", "B", true), { ...action("V", "START", true), artifact: { ...spec, payload: { contentType: "text/plain" }, review: ["test"] } }] };
  const start = await service.withGraph(g => g.start({ name: "Evidence", procedure, controlPlane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { owner: { kind: "human", name: "Owner", permissions: ["artifact.read", "decision.decide"] }, tester: { kind: "agent", name: "Tester", permissions: ["artifact.read", "decision.assess"], agent: { provider: "test", providerType: "traex", command: "unused", args: [], env: {}, startupTimeoutMs: 10000, idleTimeoutMs: null, maxRuntimeMs: null } } }, acpProviders: {} }, reviewConfiguration: { reviews: { "reviewer-evidence#actions[A]": { policy: "artifact_acceptance.unanimous" }, "reviewer-evidence#actions[C]": { policy: "artifact_acceptance.unanimous" }, "reviewer-evidence#actions[V]": { policy: "artifact_acceptance.unanimous" } }, slots: { "reviewer-evidence::source": { actorIds: ["owner"] }, "reviewer-evidence::test": { actorIds: ["tester", "owner"] } } } }));
  const runId = start.run.id;
  const produce = async (id: string, text: string, dependencies?: Array<{kind:"artifact"|"external";id:string}>) => service.withGraph(async g => {
    const s = (await g.snapshot(runId)).steps.find(s => s.source?.actionId === id)!;
    await g.enter(runId, s.id); return g.report(runId, s.id, { text, ...(dependencies ? { dependencies } : {}) });
  });
  const a = await produce("A", "fixed requirements");
  await service.withGraph(async g=>{const round=a.step.reviewRounds![0];await g.submitReview(runId,a.step.id,round.id,"owner","approve");await g.submitReview(runId,a.step.id,round.id,"runner","approve");});
  const u = await produce("U", "UNRELATED_SECRET");
  await produce("B", "fixed plan");
  const bytes = Buffer.from(("中文完整证据\n".repeat(160)));
  await f.createStore("sources", "text.json", "data");
  const opened = await openBusinessStore({}, f.root, "sources"); assert.equal(opened.store.kind, "DataStore");
  if (opened.store.kind !== "DataStore") throw new Error("Expected source DataStore");
  await opened.store.create({}, { id: "source.txt", model: "text.json", payload: { contentType: "text/plain", content: bytesContent(bytes) } });
  const eRef = await service.addExternal(runId, "fixed-content-ref", { contentRef: { storeId: "sources", dataId: "source.txt", sha256: createHash("sha256").update(bytes).digest("hex") } });
  const e = await service.addExternal(runId, "fixed-source", { content: { model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/plain", content: bytes.toString() } } });
  const outside = await service.addExternal(runId, "outside", { content: { model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/plain", content: "EXTERNAL_SECRET" } } });
  await service.withGraph(async g => {
    const v=(await g.snapshot(runId)).steps.find(s=>s.source?.actionId==="V")!;await g.enter(runId,v.id);
    await g.report(runId,v.id,{contentRef:{storeId:"sources",dataId:"source.txt",sha256:createHash("sha256").update(bytes).digest("hex")}});
  });
  const c = await produce("C", "candidate", [{ kind: "artifact", id: a.artifact.id }, { kind: "external", id: e.id }, { kind: "external", id: eRef.id }]);
  assert.equal(c.artifact.dependencies.filter(r => r.kind === "artifact").length, 2, "mandatory B and explicit A both remain fixed");
  const input = { service, runsRoot: join(f.root, "runs"), reviewId: reviews.graphReviewHandle(runId, c.step.id), roundId: c.step.reviewRounds![0].id, actorId: "tester" };
  const first = (await reviews.claimArtifactReviewAgentAssignment({ ...input, workerPid: process.pid }))!;
  const attempt = join(f.directory, "attempt"); await mkdir(attempt);
  const runtime = await createAgentReviewCliRuntime({ nodeExecutable: process.execPath, cliEntrypoint: entrypoint }); t.after(() => runtime.cleanup());
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("MEMSPHERE_")));
  Object.assign(env, { MEMSPHERE_HOME: f.home, MEMSPHERE_CONFIG_PATH: join(f.root, "config.json"), MEMSPHERE_REVIEW_RUN_ID: runId, MEMSPHERE_REVIEW_MEMORY_RUN_ID: runId, MEMSPHERE_REVIEW_ASSIGNMENT_ID: first.assignment.id, MEMSPHERE_REVIEW_ATTEMPT_ID: first.attempt.id, MEMSPHERE_WORKSPACE_ROOT: attempt, MEMSPHERE_REVIEW_SOURCE_WORKSPACE: f.cwd });
  async function cli(args: string[], changes: NodeJS.ProcessEnv = {}, cwd = attempt) {
    const r = crossSpawn.sync(runtime.launcherPath, args, { env: { ...env, ...changes }, cwd, encoding: "utf8", timeout: 20000, maxBuffer: 2_000_000 });
    assert.ifError(r.error);
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }
  return { f, service, runId, a, u, e, eRef, outside, c, input, first, attempt, runtime, env, cli, bytes, opened };
}

test('generated Artifact and External read commands execute inside the restricted launcher', { timeout: 120000 }, async t => {
  const { f, service, runId, a, u, e, eRef, outside, c, input, first, attempt, runtime, env, cli, bytes, opened } = await evidenceFixture(t);
  const generatedPrompt=await buildArtifactReviewerPrompt({context:await reviews.readArtifactReviewForActor(input),locale:"zh-CN",promptVersion:"artifact-review-v3"});
  const generatedReads=[...generatedPrompt.matchAll(/memsphere run (?:artifact|external) show --run [a-z0-9-]+ --(?:artifact|external) [a-z0-9-]+ --out [a-z0-9.-]+/g)].map(m=>m[0]);
  assert.equal(generatedReads.length,4,"both Artifact inputs and both External references have read commands");
  for(const command of generatedReads){const r=await cli([...command.split(" ").slice(1),"--output","json"]);assert.equal(r.status,0,command+": "+r.stderr);}

});

test('global Project positions work and explicit conflicting identities are rejected', { timeout: 120000 }, async t => {
  const { f, service, runId, a, u, e, eRef, outside, c, input, first, attempt, runtime, env, cli, bytes, opened } = await evidenceFixture(t);
  for (const args of [["--project", "test-project", "run", "artifact", "show"], ["--project", " test-project ", "run", "artifact", "show"], ["run", "artifact", "show", "--project=test-project"]]) {
    const r = await cli([...args, "--run", runId, "--artifact", a.artifact.id, "--output", "json"]);
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /fixed requirements/);
  }
  for (const args of [
    ["--project", "other", "run", "artifact", "show"],
    ["run", "artifact", "show", "--project=other", "--project=test-project"],
    ["run", "artifact", "show", "--run", "other"],
    ["run", "artifact", "show", "--assignment", "other"]
  ]) { const r = await cli([...args, "--output", "json"]); assert.notEqual(r.status, 0); assert.equal(r.stdout, ""); assert.match(r.stderr, /REVIEW_IDENTITY_CONFLICT|REVIEW_SESSION_DENIED/); }

});

test('Artifact, External and Step reads reject unrelated branch resources', { timeout: 120000 }, async t => {
  const { f, service, runId, a, u, e, eRef, outside, c, input, first, attempt, runtime, env, cli, bytes, opened } = await evidenceFixture(t);
  for (const args of [["run", "artifact", "show", "--artifact", u.artifact.id], ["run", "external", "show", "--external", outside.id], ["run", "step", "show", "--step", u.step.id]]) {
    const r = await cli([...args, "--output", "json"]); assert.notEqual(r.status, 0); assert.equal(r.stdout, ""); assert.match(r.stderr, /REVIEW_RESOURCE_DENIED/);
  }

});

test('current Project Memory stays distinct from explicit frozen Run Memory', { timeout: 120000 }, async t => {
  const { f, service, runId, a, u, e, eRef, outside, c, input, first, attempt, runtime, env, cli, bytes, opened } = await evidenceFixture(t);
  const liveMemory = await cli(["memory", "read", "live-evidence", "--output", "json"]); assert.equal(liveMemory.status, 0, liveMemory.stderr); assert.match(liveMemory.stdout, /Current Project auxiliary evidence/);
  const frozenMemory = await cli(["memory", "list", "--run", runId, "--output", "json"]); assert.equal(frozenMemory.status, 0, frozenMemory.stderr); assert.doesNotMatch(frozenMemory.stdout, /live-evidence/);
  const frozenMissing = await cli(["memory", "read", "live-evidence", "--run", runId, "--output", "json"]); assert.notEqual(frozenMissing.status, 0); assert.equal(frozenMissing.stdout, "");
  for (const args of [["memory", "list", "--run", "other"], ["memory", "list", "--project", "test-project", "--project=other"]]) { const r=await cli([...args,"--output","json"]); assert.notEqual(r.status,0); assert.equal(r.stdout,""); assert.match(r.stderr,/REVIEW_IDENTITY_CONFLICT/); }

});

test('literal separator and malformed or empty resource arguments retain CLI error semantics', { timeout: 120000 }, async t => {
  const { f, service, runId, a, u, e, eRef, outside, c, input, first, attempt, runtime, env, cli, bytes, opened } = await evidenceFixture(t);
  const literal = await cli(["memory","read","--output","json","--","--project"]);assert.equal(literal.status,1);assert.equal(literal.stdout,"");assert.doesNotMatch(literal.stderr,/REVIEW_IDENTITY_CONFLICT/);
  for(const flag of ["--artifact","--out"]){const bad=await cli(["run","artifact","show",flag,"","--output","json"]);assert.equal(bad.status,1);assert.equal(bad.stdout,"");assert.match(bad.stderr,/INVALID_ARGUMENT/);}
  const malformed = await cli(["run", "artifact", "show", "--output", "json", "--artifact"]); assert.notEqual(malformed.status, 0); assert.equal(malformed.stdout, ""); assert.match(malformed.stderr, /INVALID_ARGUMENT/);

});

test('upstream contracts include the same complete frozen global contract', async t => {
  const { f, service, runId, a, u, e, eRef, outside, c, input, first, attempt, runtime, env, cli, bytes, opened } = await evidenceFixture(t);
  const contract = await cli(["run", "artifact", "contract", "show", "--artifact", a.artifact.id, "--output", "json"]); assert.equal(contract.status, 0, contract.stderr); const frozenContract=JSON.parse(contract.stdout); assert.match(JSON.stringify(frozenContract.procedure.asserts),/Global frozen rule/); assert.equal(frozenContract.action.instruction,"A"); assert.equal(frozenContract.artifact.name,"Result");

});

test('Run summaries exclude unrelated data and peer Review details', async t => {
  const { f, service, runId, a, u, e, eRef, outside, c, input, first, attempt, runtime, env, cli, bytes, opened } = await evidenceFixture(t);
  const summary = await cli(["run", "show", "--output", "json"]); assert.equal(summary.status, 0, summary.stderr); assert.doesNotMatch(summary.stdout, /UNRELATED_SECRET|EXTERNAL_SECRET|reviewConfig|nodeStates/);

});

test('original Human confirmations are readable while current peer drafts are denied', async t => {
  const { f, service, runId, a, u, e, eRef, outside, c, input, first, attempt, runtime, env, cli, bytes, opened } = await evidenceFixture(t);
  const confirmation=await cli(["run","review","show","--review",graphReviewId(a.step.reviewRounds![0].id,"owner"),"--output","json"]);assert.equal(confirmation.status,0,confirmation.stderr);assert.equal(JSON.parse(confirmation.stdout).artifactId,a.artifact.id);assert.equal(JSON.parse(confirmation.stdout).vote.value,"approve");assert.equal(JSON.parse(confirmation.stdout).reviewer.source,"human");
  const confirmations=await cli(["run","review","list","--artifact",a.artifact.id,"--output","json"]);assert.equal(confirmations.status,0,confirmations.stderr);assert.equal(JSON.parse(confirmations.stdout).length,2);
  const peer=await cli(["run","review","show","--review",graphReviewId(c.step.reviewRounds![0].id,"owner"),"--output","json"]);assert.equal(peer.status,1);assert.equal(peer.stdout,"");assert.match(peer.stderr,/REVIEW_RESOURCE_DENIED/);

});

test('Assignment discovery lists fixed references and executable resource reads', async t => {
  const { f, service, runId, a, u, e, eRef, outside, c, input, first, attempt, runtime, env, cli, bytes, opened } = await evidenceFixture(t);
  const detail = await cli(["run", "review", "assignment", "show", "--output", "json"]); assert.equal(detail.status, 0, detail.stderr); assert.match(detail.stdout, new RegExp(e.id));
});

test('External exports preserve full inline and contentRef bytes and reject changed content', { timeout: 120000 }, async t => {
  const { f, service, runId, a, u, e, eRef, outside, c, input, first, attempt, runtime, env, cli, bytes, opened } = await evidenceFixture(t);
  const external = await cli(["run", "external", "show", "--external", e.id, "--output", "json"]); assert.equal(external.status, 0, external.stderr); assert.equal(JSON.parse(external.stdout).truncated, true); assert.deepEqual(JSON.parse(external.stdout).viaArtifactIds, [c.artifact.id]);
  const exported = await cli(["run", "external", "show", "--external", e.id, "--out", "full.txt", "--output", "json"]); assert.equal(exported.status, 0, exported.stderr); assert.deepEqual(await readFile(join(attempt, "full.txt")), bytes);
  const refExport = await cli(["run", "external", "show", "--external", eRef.id, "--out", "full-ref.txt", "--output", "json"]); assert.equal(refExport.status, 0, refExport.stderr); assert.deepEqual(await readFile(join(attempt, "full-ref.txt")), bytes);
  await opened.store.update({}, { id: "source.txt", model: "text.json", payload: { contentType: "text/plain", content: bytesContent(Buffer.from("changed")) } });
  const corruptRef = await cli(["run", "external", "show", "--external", eRef.id, "--out", "corrupt.txt", "--output", "json"]); assert.notEqual(corruptRef.status, 0); assert.equal(corruptRef.stdout, ""); assert.match(corruptRef.stderr, /CONTENT_CHANGED/); await assert.rejects(readFile(join(attempt,"corrupt.txt")), { code: "ENOENT" });
  await opened.store.delete({}, "source.txt");
  const unaffected=await cli(["run","artifact","show","--output","json"]);assert.equal(unaffected.status,0,unaffected.stderr);assert.match(unaffected.stdout,/candidate/);

});

test('exports reject outside parents, directory symlinks and existing targets', { timeout: 120000 }, async t => {
  const { f, service, runId, a, u, e, eRef, outside, c, input, first, attempt, runtime, env, cli, bytes, opened } = await evidenceFixture(t);
  await writeFile(join(attempt,"full.txt"),"existing");
  await symlink(f.cwd, join(attempt, "escape"), "dir");
  for (const out of ["../escape.txt", "escape/escape.txt", "full.txt"]) { const r = await cli(["run", "external", "show", "--external", e.id, "--out", out, "--output", "json"]); assert.notEqual(r.status, 0); assert.equal(r.stdout, ""); }

});

test('failed, queued and replaced Attempts cannot read while a claimed retry can', { timeout: 120000 }, async t => {
  const { f, service, runId, a, u, e, eRef, outside, c, input, first, attempt, runtime, env, cli, bytes, opened } = await evidenceFixture(t);
  assert.equal((await reviews.readArtifactReviewForActor(input)).assignment.attempts![0].cliReadyAt, undefined, "reads must not handshake");
  await reviews.failArtifactReviewAgentAssignment({ ...input, attemptId: first.attempt.id, failure: { stage: "process", code: "fixture", message: "controlled failure" } });
  const failed = await cli(["run","artifact","show","--output","json"]);assert.notEqual(failed.status,0);assert.equal(failed.stdout,"");assert.match(failed.stderr,/REVIEW_SESSION_INVALID/);
  await reviews.retryArtifactReviewAgentAssignment(input);
  const queued = (await reviews.readArtifactReviewForActor(input)).assignment.attempts!.at(-1)!;
  const queuedRead = await cli(["run","artifact","show","--output","json"],{MEMSPHERE_REVIEW_ATTEMPT_ID:queued.id});assert.notEqual(queuedRead.status,0);assert.equal(queuedRead.stdout,"");
  const second = (await reviews.claimArtifactReviewAgentAssignment({ ...input, workerPid: process.pid }))!;
  const stale = await cli(["run", "artifact", "show", "--output", "json"]); assert.notEqual(stale.status, 0); assert.equal(stale.stdout, "");
  env.MEMSPHERE_REVIEW_ATTEMPT_ID = second.attempt.id;
  const current = await cli(["run", "artifact", "show", "--output", "json"]); assert.equal(current.status, 0, current.stderr);

});

test('comments may anchor only authorized fixed External evidence', { timeout: 120000 }, async t => {
  const { f, service, runId, a, u, e, eRef, outside, c, input, first, attempt, runtime, env, cli, bytes, opened } = await evidenceFixture(t);
  const tree=(await reviews.readArtifactReviewForActor(input)).assignment.nodeTree!;
  const allNodes=(node:typeof tree.root):Array<typeof tree.root>=>[node,...node.children.flatMap(allNodes)];
  const openNode=allNodes(tree.root).find(n=>n.kind==="open_review")!;
  const anchorComment={body:"Fixed External checked",severity:"suggestion",anchor:{targetRef:{kind:"external",id:e.id},location:"line 1"}};
  const anchorSaved=await cli(["continue","comment","add","--node",openNode.nodeId,"--artifact",JSON.stringify(anchorComment),"--output","json"]);assert.equal(anchorSaved.status,0,anchorSaved.stderr);
  const anchorDenied=await cli(["continue","comment","add","--node",openNode.nodeId,"--artifact",JSON.stringify({...anchorComment,anchor:{...anchorComment.anchor,targetRef:{kind:"external",id:outside.id}}}),"--output","json"]);assert.notEqual(anchorDenied.status,0);assert.equal(anchorDenied.stdout,"");

});

test('submitted Assignments retain fixed reads and reject further writes', { timeout: 120000 }, async t => {
  const { f, service, runId, a, u, e, eRef, outside, c, input, first, attempt, runtime, env, cli, bytes, opened } = await evidenceFixture(t);
  await reviews.markArtifactReviewAgentCliReady({ ...input, attemptId: first.attempt.id });
  let context = await reviews.readArtifactReviewForActor(input);
  while (currentReviewNode(context.assignment)) context = await reviews.mutateArtifactReviewNodes({ ...input, attemptId: first.attempt.id, mutation: { operation: "report", expectedNodeId: currentReviewNode(context.assignment)!.nodeId, artifact: { applicable: true } } });
  await reviews.submitArtifactReviewAgentAssignment({ ...input, attemptId: first.attempt.id, vote: "approve" });
  const submitted = await cli(["run", "artifact", "show", "--output", "json"]); assert.equal(submitted.status, 0, submitted.stderr);
  const write = await cli(["continue", "report", "--artifact", '{"applicable":true}', "--output", "json"]); assert.notEqual(write.status, 0); assert.equal(write.stdout, "");

});

test('rewind revokes the affected restricted Session without deleting history', { timeout: 120000 }, async t => {
  const { f, service, runId, a, u, e, eRef, outside, c, input, first, attempt, runtime, env, cli, bytes, opened } = await evidenceFixture(t);
  // No worker was spawned in this fixture. OS cleanup is covered by the real
  // ACP worker suite; keep this test focused on persisted revocation + real CLI.
  t.mock.method(GraphRuntime.prototype, "stopReviewer", async () => {});
  await service.withGraph(g => g.rewind(runId, a.step.id, "new requirement"));
  const revoked = await cli(["run", "artifact", "show", "--output", "json"]); assert.notEqual(revoked.status, 0); assert.equal(revoked.stdout, "");
});

test("restricted Embedded Memory uses the launching worktree with a custom Home and independent Attempt cwd", { timeout: 60000 }, async t => {
 const f=await initializedContextFixture(t), main=join(f.directory,'repo'), worktree=join(f.directory,'other-worktree'), memoryPath='.memsphere/memory';
 await mkdir(main);
 for(const kind of ['concepts','statements','procedures','schemas'])await mkdir(join(main,memoryPath,kind),{recursive:true});
 const concept=(text:string)=>`!concept\nsyntax: ${graphMemorySyntax}\nnames: [workspace-evidence]\ndefines: [${text}]\n`;
 await writeFile(join(main,memoryPath,'concepts/workspace-evidence.yaml'),concept('MAIN_CANONICAL'));
 await runGit(['init','-b','master'],{cwd:main});await runGit(['add','.'],{cwd:main});await runGit(['-c','user.name=Test','-c','user.email=test@example.com','commit','-qm','main'],{cwd:main});
 await runGit(['worktree','add','-b','review-source',worktree],{cwd:main});
 await writeFile(join(worktree,memoryPath,'concepts/workspace-evidence.yaml'),concept('SOURCE_WORKTREE'));
 const configPath=join(f.root,'config.json'), config=JSON.parse(await readFile(configPath,'utf8'));config.store={type:'embedded',repository_path:main,memory_path:memoryPath};await writeFile(configPath,JSON.stringify(config));
 const {reviewerSessionEnvironment}=await import('./helpers/reviewer-session.js');
 const session=await reviewerSessionEnvironment(f.root,f.home,f.cwd);
 const env={...process.env,...session,MEMSPHERE_REVIEW_SOURCE_WORKSPACE:worktree};
 const runtime=await createAgentReviewCliRuntime({nodeExecutable:process.execPath,cliEntrypoint:entrypoint});t.after(()=>runtime.cleanup());
 const read=crossSpawn.sync(runtime.launcherPath,['--project','test-project','memory','read','workspace-evidence','--output','json'],{cwd:f.cwd,env,encoding:'utf8',timeout:20000});
 assert.equal(read.status,0,read.stderr);assert.match(read.stdout,/SOURCE_WORKTREE/);assert.doesNotMatch(read.stdout,/MAIN_CANONICAL/);
 const bad=crossSpawn.sync(runtime.launcherPath,['memory','read','workspace-evidence','--output','json'],{cwd:f.cwd,env:{...env,MEMSPHERE_REVIEW_SOURCE_WORKSPACE:main,MEMSPHERE_CONFIG_PATH:join(f.cwd,'config.json')},encoding:'utf8',timeout:20000});
 assert.notEqual(bad.status,0);assert.equal(bad.stdout,'');assert.match(bad.stderr,/REVIEW_SESSION_INVALID/);
});


async function revisedJsonFixture(t: test.TestContext) {
 const f=await initializedContextFixture(t), service=(await openContextControl(f.root))!;
 const {reviewerSessionEnvironment}=await import('./helpers/reviewer-session.js');
 const session=await reviewerSessionEnvironment(f.root,f.home,f.cwd,{contentType:'application/json',text:'{"version":1}'});
 const runId=session.MEMSPHERE_REVIEW_RUN_ID, step=(await service.snapshot(runId)).steps[0];
 const input={service,runsRoot:join(f.root,'runs'),reviewId:reviews.graphReviewHandle(runId,step.id),roundId:step.reviewRounds![0].id,actorId:'reader',attemptId:session.MEMSPHERE_REVIEW_ATTEMPT_ID};
 await reviews.markArtifactReviewAgentCliReady(input);let c=await reviews.readArtifactReviewForActor(input);
 while(currentReviewNode(c.assignment))c=await reviews.mutateArtifactReviewNodes({...input,mutation:{operation:'report',expectedNodeId:currentReviewNode(c.assignment)!.nodeId,artifact:{applicable:true}}});
 await reviews.submitArtifactReviewAgentAssignment({...input,vote:'approve'});
 await reviews.submitArtifactReviewRunnerVote({...input,vote:'request_changes',comment:'Revise JSON'});
 const revised=await service.withGraph(g=>g.report(runId,step.id,{text:'{"version":2}',revisionSummary:'Updated JSON evidence'}));
 const claimed=(await reviews.claimArtifactReviewAgentAssignment({...input,roundId:revised.step.reviewRounds!.at(-1)!.id,workerPid:process.pid}))!;
 const env={...process.env,...session,MEMSPHERE_REVIEW_ASSIGNMENT_ID:claimed.assignment.id!,MEMSPHERE_REVIEW_ATTEMPT_ID:claimed.attempt.id};
 const runtime=await createAgentReviewCliRuntime({nodeExecutable:process.execPath,cliEntrypoint:entrypoint});t.after(()=>runtime.cleanup());
 return {f,step,env,runtime};
}

test("scoped candidate reads preserve decoded JSON and structured revision metadata", async t => {
 const {f,step,env,runtime}=await revisedJsonFixture(t);
 const r=crossSpawn.sync(runtime.launcherPath,['run','artifact','show','--output','json'],{cwd:f.cwd,env,encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr);
 const payload=JSON.parse(r.stdout);assert.deepEqual(payload.artifact.value,{version:2});assert.equal(payload.artifact.type,'object');assert.equal(payload.artifact.format.name,'json');assert.equal(payload.artifact.storage,'inline');assert.equal(payload.revisionSummary.body,'Updated JSON evidence');assert.equal(payload.revisionSummary.previousSubmissionId,step.artifact!.mode==='produce'?step.artifact.id:undefined);assert.match(payload.revisionSummary.digest,/^[a-f0-9]{64}$/);
});

test("exports accept canonical aliases of the Attempt directory", async t => {
 const {f,env,runtime}=await revisedJsonFixture(t);
 const alias=join(f.directory,'workspace-alias');await symlink(f.cwd,alias,'junction');
 const exported=crossSpawn.sync(runtime.launcherPath,['run','artifact','show','--out',join(alias,'candidate.json'),'--output','json'],{cwd:f.cwd,env,encoding:'utf8',timeout:20000});
 assert.equal(exported.status,0,exported.stderr);assert.equal(await readFile(join(f.cwd,'candidate.json'),'utf8'),'{"version":2}');
});

async function reviseEvidence(f: Awaited<ReturnType<typeof evidenceFixture>>) {
  const { input, first, service, runId, c } = f;
  await reviews.markArtifactReviewAgentCliReady({ ...input, attemptId: first.attempt.id });
  let context = await reviews.readArtifactReviewForActor(input);
  while (currentReviewNode(context.assignment)) context = await reviews.mutateArtifactReviewNodes({ ...input, attemptId: first.attempt.id, mutation: { operation: 'report', expectedNodeId: currentReviewNode(context.assignment)!.nodeId, artifact: { applicable: true } } });
  await reviews.submitArtifactReviewAgentAssignment({ ...input, attemptId: first.attempt.id, vote: 'approve' });
  await reviews.submitArtifactReviewRunnerVote({ ...input, vote: 'request_changes', comment: 'Revise evidence' });
  const next = await service.withGraph(g => g.report(runId, c.step.id, { text: 'revised candidate', revisionSummary: 'New fixed candidate' }));
  const claim = (await reviews.claimArtifactReviewAgentAssignment({ ...input, roundId: next.step.reviewRounds!.at(-1)!.id, workerPid: process.pid }))!;
  return { next, changes: { MEMSPHERE_REVIEW_ASSIGNMENT_ID: claim.assignment.id!, MEMSPHERE_REVIEW_ATTEMPT_ID: claim.attempt.id } };
}

test('current Session reads survive a missing unrelated old-round Artifact record', async t => {
  const f = await evidenceFixture(t), revised = await reviseEvidence(f);
  await f.service.withGraph(g => g.records.stores.artifact.delete({}, g.records.key('artifact', f.runId, f.c.artifact.id)));
  for (const args of [['run','artifact','show'], ['run','review','assignment','show'], ['memory','list','--run',f.runId]]) {
    const r = await f.cli([...args,'--output','json'], revised.changes); assert.equal(r.status,0,r.stderr);
  }
  const missing = await f.cli(['run','artifact','show','--output','json']); assert.notEqual(missing.status,0); assert.equal(missing.stdout,'');
});

test('submitted historical Session does not load a later candidate record', async t => {
  const f = await evidenceFixture(t), revised = await reviseEvidence(f);
  await f.service.withGraph(g => g.records.stores.artifact.delete({}, g.records.key('artifact', f.runId, revised.next.artifact.id)));
  const old = await f.cli(['run','artifact','show','--output','json']); assert.equal(old.status,0,old.stderr); assert.equal(JSON.parse(old.stdout).artifact.value,'candidate');
  const missing = await f.cli(['run','artifact','show','--output','json'],revised.changes); assert.notEqual(missing.status,0); assert.equal(missing.stdout,'');
});

test('peer draft anchors never load their damaged content during personal reads', async t => {
  const f = await evidenceFixture(t);
  await f.service.withGraph(async g => {
    const row = await g.records.require<any>('review',f.runId,graphReviewId(f.input.roundId,'owner'));
    await g.records.update('review',f.runId,row,{...row.value,comments:[{commentId:'peer-anchor',body:'Peer private draft',severity:'risk',createdAt:new Date().toISOString(),anchor:{targetRef:{kind:'external',id:f.eRef.id},location:'line 1'}}]});
  });
  await f.opened.store.delete({},'source.txt');
  for (const args of [['run','artifact','show'],['run','review','assignment','show'],['memory','list','--run',f.runId]]) {
    const r=await f.cli([...args,'--output','json']);assert.equal(r.status,0,r.stderr);assert.doesNotMatch(r.stdout,/Peer private draft/);
  }
  const denied=await f.cli(['run','external','show','--external',f.eRef.id,'--out','damaged.txt','--output','json']);assert.notEqual(denied.status,0);assert.equal(denied.stdout,'');await assert.rejects(readFile(join(f.attempt,'damaged.txt')),{code:'ENOENT'});
});

test('personal node report and comment edits survive a missing unrelated old candidate',async t=>{
 const f=await evidenceFixture(t),revised=await reviseEvidence(f),input={...f.input,roundId:revised.next.step.reviewRounds!.at(-1)!.id};
 const context=await reviews.readArtifactReviewForActor(input),firstNode=currentReviewNode(context.assignment)!.nodeId;
 const nodes=(n:any):any[]=>[n,...n.children.flatMap(nodes)],openNode=nodes(context.assignment.nodeTree!.root).find(n=>n.kind==='open_review').nodeId;
 await f.service.withGraph(g=>g.records.stores.artifact.delete({},g.records.key('artifact',f.runId,f.c.artifact.id)));
 const cli=async(args:string[])=>{const r=await f.cli([...args,'--output','json'],revised.changes);assert.equal(r.status,0,r.stderr);return r;};
 await cli(['continue','report','--artifact','{"applicable":true}']);
 await cli(['continue','update','--node',firstNode,'--artifact','{"applicable":true,"comments":[]}']);
 await cli(['continue','comment','add','--node',openNode,'--artifact',JSON.stringify({body:'Fixed context',severity:'suggestion',anchor:{targetRef:{kind:'artifact',id:f.a.artifact.id},location:'line 1'}})]);
 const comment=(await reviews.readArtifactReviewForActor(input)).assignment.draft.comments.find(c=>c.body==='Fixed context')!;assert.ok(comment);
 await cli(['continue','comment','update','--comment',comment.commentId!,'--artifact','{"body":"Edited fixed context","severity":"risk"}']);
 assert.ok((await reviews.readArtifactReviewForActor(input)).assignment.draft.comments.some(c=>c.body==='Edited fixed context'));
 await cli(['continue','comment','delete','--comment',comment.commentId!]);
 const before=(await reviews.readArtifactReviewForActor(input)).assignment;
 const denied=await f.cli(['continue','comment','add','--node',openNode,'--artifact',JSON.stringify({body:'Outside',severity:'risk',anchor:{targetRef:{kind:'external',id:f.outside.id},location:'1'}}),'--output','json'],revised.changes);
 assert.notEqual(denied.status,0);assert.equal(denied.stdout,'');const after=(await reviews.readArtifactReviewForActor(input)).assignment;assert.deepEqual(after.nodeStates,before.nodeStates);assert.deepEqual(after.draft,before.draft);
});


test('Reviewer production commands remain forbidden independently of target identity',async t=>{
 const f=await evidenceFixture(t),r=await f.cli(['run','report','--run',f.runId,'--step',f.c.step.id,'--artifact','attack','--output','json']);assert.notEqual(r.status,0);assert.equal(r.stdout,'');assert.match(r.stderr,/REVIEW_SESSION_DENIED/);
});
test('Reviewer reads reject a cwd outside the bound Attempt',async t=>{
 const f=await evidenceFixture(t),r=await f.cli(['run','artifact','show','--output','json'],{},f.f.cwd);assert.notEqual(r.status,0);assert.equal(r.stdout,'');assert.match(r.stderr,/REVIEW_SESSION_INVALID/);
});
