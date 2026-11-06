import assert from "node:assert/strict";
import { chmod, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { applyEmbeddedSystemMemoryRepair, prepareEmbeddedSystemMemoryRepair } from "../src/commands/project.js";
import { alterDefinition, definitionPath, embeddedFixture, fixture, memoryPath } from "./helpers/project-upgrade.js";

test("Embedded upgrade CLI isolates original user differences in a dedicated ChangeSet", async () => {
  const f = await fixture();
  try {
    const { project, memoryRoot } = await embeddedFixture(f);
    await alterDefinition(project);
    const userPath = join(memoryRoot, "concepts/user.yaml");
    const dirtyUser = `${await readFile(userPath, "utf8")}\n# Work in progress\n`;
    await writeFile(userPath, dirtyUser);
    const captured = f.run(["memory", "change", "validate"]);
    assert.equal(captured.status, 0, captured.stderr || captured.stdout);
    const ordinaryIds = await readdir(join(project, "changes"));
    assert.equal(ordinaryIds.length, 1);
    const ordinaryPath = join(project, "changes", ordinaryIds[0]!, "change.json");
    const ordinaryBefore = await readFile(ordinaryPath, "utf8");
    const linked = join(f.root, "upgrade-worktree");
    f.git(["worktree", "add", "-b", "upgrade/system", linked, "master"]);
    const head = f.git(["rev-parse", "HEAD"], linked);
    const { result, value } = f.upgrade("embedded", [], linked);
    assert.equal(result.status, 0, JSON.stringify(value));
    assert.equal(value.memory.integrationStatus, "pending");
    assert.equal(value.models.status, "upgraded");
    const id = value.memory.changeSet.id;
    assert.notEqual(id, ordinaryIds[0]);
    const dedicated = JSON.parse(await readFile(join(project, "changes", id, "change.json"), "utf8"));
    assert.equal(dedicated.intent, "system_upgrade");
    assert.deepEqual(dedicated.targets.map((target: { path: string }) => target.path), [memoryPath]);
    assert.equal(f.git(["rev-parse", "HEAD"], linked), head, "Command does not commit");
    assert.equal(await readFile(userPath, "utf8"), dirtyUser);
    assert.equal(await readFile(ordinaryPath, "utf8"), ordinaryBefore);
  } finally { await f.cleanup(); }
});

// Retry and integration guards use the domain repair/ChangeSet API to prepare
// an upgraded worktree; each test crosses only its own CLI boundary.
async function upgradedFixture(){
 const f=await fixture();const {project}=await embeddedFixture(f);
 const linked=join(f.root,"upgrade-worktree");f.git(["worktree","add","-b","upgrade/system",linked,"master"]);
 const cwd=process.cwd(),keys=["MEMSPHERE_HOME","MEMSPHERE_PROJECT","GIT_CONFIG_GLOBAL","GIT_CONFIG_NOSYSTEM"] as const;
 const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  process.chdir(linked);for(const k of keys){if(k==="MEMSPHERE_PROJECT")process.env[k]="embedded";else process.env[k]=f.env[k];}
  const {resolveProjectContext}=await import("../src/project/resolver.js");
  const {readSystemMemoryUpgradeTargets}=await import("../src/commands/project.js");
  const {readBundledSystemMemories,readReservedMemoryManifest,bundledReservedMemoryRoot,reservedSystemMemoryRemovalTombstones}=await import("../src/reserved/store.js");
  const {createHash}=await import("node:crypto");
  const {createSystemUpgradeMemoryChange}=await import("../src/memory/changeset.js");
  const context=await resolveProjectContext({project:"embedded"}),plan=await readSystemMemoryUpgradeTargets("embedded");
  const bundled=await readBundledSystemMemories(bundledReservedMemoryRoot());
  const catalog=await Promise.all(bundled.map(async item=>({reference:item.reference,path:item.path,content:await readFile(item.sourcePath,"utf8")})));
  const removals=reservedSystemMemoryRemovalTombstones(await readReservedMemoryManifest(bundledReservedMemoryRoot()));
  const sourceDigest=createHash("sha256").update(JSON.stringify({catalog,removals})).digest("hex");
  const prepared=await prepareEmbeddedSystemMemoryRepair("embedded");assert.ok(prepared);
  let id="";await applyEmbeddedSystemMemoryRepair(prepared,{afterApply:async()=>{id=(await createSystemUpgradeMemoryChange({context,targets:plan.targets,sourceDigest})).change.id;}});
  return {...f,project,linked,id};
 }catch(error){await f.cleanup();throw error;}
 finally{process.chdir(cwd);for(const k of keys){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}}
}
test("Embedded upgrade retry requires the dedicated ID and accepts that ID",async()=>{
 const f=await upgradedFixture();try{
  const missing=f.upgrade("embedded",[],f.linked);assert.notEqual(missing.result.status,0);assert.match(missing.value.failure.message,new RegExp(f.id));
  const retry=f.upgrade("embedded",["--change",f.id],f.linked);assert.equal(retry.result.status,0,JSON.stringify(retry.value));
 }finally{await f.cleanup();}
});
test("Embedded upgrade retry rejects a different worktree before model changes",async()=>{
 const f=await upgradedFixture();try{const wrong=f.upgrade("embedded",["--change",f.id]);assert.notEqual(wrong.result.status,0);assert.equal(wrong.value.models.status,"not_run");}finally{await f.cleanup();}
});
test("Embedded upgrade retry and direct validation reject a restored old baseline",async()=>{
 const f=await upgradedFixture();try{
  const target=join(f.linked,".memsphere/memory",memoryPath),upgraded=await readFile(target,"utf8");
  f.git(["restore","--",".memsphere/memory"],f.linked);
  const retry=f.upgrade("embedded",["--change",f.id],f.linked);assert.notEqual(retry.result.status,0);assert.equal(retry.value.overall,"failed");
  assert.notEqual(f.run(["memory","change","validate",f.id],f.linked).status,0);
  await writeFile(target,upgraded);assert.equal(f.upgrade("embedded",["--change",f.id],f.linked).result.status,0);
 }finally{await f.cleanup();}
});
test("Committing Embedded upgrade targets does not mark the ChangeSet integrated",async()=>{
 const f=await upgradedFixture();try{
  f.git(["add","--",".memsphere/memory"],f.linked);f.git(["commit","-m","Upgrade System Memory only"],f.linked);
  assert.deepEqual(f.git(["show","--format=","--name-only","HEAD"],f.linked).split("\n"),[`.memsphere/memory/${memoryPath}`]);
  assert.equal(JSON.parse(await readFile(join(f.project,"changes",f.id,"change.json"),"utf8")).status,"active");
 }finally{await f.cleanup();}
});

test("Embedded upgrade CLI refuses dirty Memory before model writes", async () => {
  // The API suite covers original/main, detached HEAD and missing master.
  // This CLI boundary proves rejection happens before either resource is changed.
  const f = await fixture();
  try {
    const { project, memoryRoot } = await embeddedFixture(f);
    await alterDefinition(project);
    const modelBefore = await readFile(join(project, definitionPath), "utf8");
    const linked = join(f.root, "upgrade-worktree");
    f.git(["worktree", "add", "-b", "upgrade/system", linked, "master"]);
    const userPath = join(linked, ".memsphere/memory/concepts/user.yaml");
    const dirty = `${await readFile(userPath, "utf8")}\n# dirty\n`;
    await writeFile(userPath, dirty);
    const memoryBefore = await readFile(join(memoryRoot, memoryPath), "utf8");
    const failed = f.upgrade("embedded", [], linked);
    assert.notEqual(failed.result.status, 0);
    assert.equal(failed.value.failure.stage, "preflight");
    assert.equal(failed.value.models.status, "not_run");
    assert.equal(await readFile(join(project, definitionPath), "utf8"), modelBefore);
    assert.equal(await readFile(join(memoryRoot, memoryPath), "utf8"), memoryBefore);
    assert.equal(await readFile(userPath, "utf8"), dirty);
    assert.deepEqual(await readdir(join(project, "changes")), []);
  } finally { await f.cleanup(); }
});

test("Embedded upgrade CLI rolls back Memory when dedicated record creation fails and can restart cleanly", {
  skip: process.platform === "win32" || process.getuid?.() === 0
    ? "Requires POSIX permissions enforced for a non-root user" : false
}, async () => {
  const f = await fixture();
  let changesRoot: string | undefined;
  try {
    const { project, memoryRoot } = await embeddedFixture(f);
    await alterDefinition(project);
    const linked = join(f.root, "upgrade-worktree");
    f.git(["worktree", "add", "-b", "upgrade/system", linked, "master"]);
    const target = join(linked, ".memsphere/memory", memoryPath);
    const baseline = await readFile(target, "utf8");
    const head = f.git(["rev-parse", "HEAD"], linked);
    changesRoot = join(project, "changes");
    const recordsBefore = await readdir(changesRoot);
    await chmod(changesRoot, 0o555);
    const failed = f.upgrade("embedded", [], linked);
    assert.notEqual(failed.result.status, 0, JSON.stringify(failed.value));
    assert.equal(failed.value.overall, "failed");
    assert.equal(failed.value.models.status, "upgraded");
    assert.equal(failed.value.memory.status, "failed");
    assert.equal(failed.value.failure.stage, "memory");
    assert.match(failed.value.failure.message, /EACCES|EPERM|permission/i);
    assert.equal(failed.value.memory.changeSet, undefined, "No record ID may be claimed before persistence");
    assert.equal(await readFile(target, "utf8"), baseline, "Failed record creation must restore applied targets");
    assert.equal(await readFile(join(memoryRoot, memoryPath), "utf8"), baseline, "Original worktree is untouched");
    assert.equal(f.git(["status", "--porcelain", "--", ".memsphere/memory"], linked), "", "No orphaned upgrade diff blocks restart");
    assert.equal(f.git(["rev-parse", "HEAD"], linked), head);
    assert.deepEqual(await readdir(changesRoot), recordsBefore);
    await chmod(changesRoot, 0o755);
    const retry = f.upgrade("embedded", [], linked);
    assert.equal(retry.result.status, 0, JSON.stringify(retry.value));
    assert.equal(retry.value.models.status, "unchanged");
    assert.equal(retry.value.memory.status, "upgraded");
    assert.equal(retry.value.memory.integrationStatus, "pending");
    assert.equal(retry.value.memory.changeSet.intent, "system_upgrade");
    assert.equal(retry.value.memory.changeSet.validation, "passed");
    const change = JSON.parse(await readFile(join(changesRoot, retry.value.memory.changeSet.id, "change.json"), "utf8"));
    assert.equal(change.status, "active");
    assert.equal(change.checkpoint.valid, true);
    assert.deepEqual(change.targets.map((item: { path: string }) => item.path), [memoryPath]);
    assert.equal(f.git(["rev-parse", "HEAD"], linked), head);
  } finally {
    if (changesRoot) await chmod(changesRoot, 0o755);
    await f.cleanup();
  }
});

test("Embedded repair API restores updated and created targets when the afterApply callback fails", async () => {
  const f = await fixture();
  const previousCwd = process.cwd();
  const environmentKeys = ["MEMSPHERE_HOME", "MEMSPHERE_PROJECT", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"] as const;
  const previous = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  try {
    const { project, memoryRoot } = await embeddedFixture(f);
    const createdPath = "concepts/memsphere-memory.yaml";
    await rm(join(memoryRoot, createdPath));
    f.git(["add", "--", ".memsphere/memory"]);
    f.git(["commit", "-m", "Previous bundle lacked a system file"]);
    const linked = join(f.root, "upgrade-worktree");
    f.git(["worktree", "add", "-b", "upgrade/system", linked, "master"]);
    process.env.MEMSPHERE_HOME = f.home;
    delete process.env.MEMSPHERE_PROJECT;
    process.env.GIT_CONFIG_GLOBAL = f.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    process.chdir(linked);
    const target = join(linked, ".memsphere/memory", memoryPath);
    const createdTarget = join(linked, ".memsphere/memory", createdPath);
    const baseline = await readFile(target, "utf8");
    const recordsBefore = await readdir(join(project, "changes"));
    const prepared = await prepareEmbeddedSystemMemoryRepair("embedded");
    assert.ok(prepared);
    assert.ok(prepared.created > 0);
    assert.ok(prepared.updated > 0);
    let invoked = false;
    await assert.rejects(applyEmbeddedSystemMemoryRepair(prepared, { afterApply: async () => {
      invoked = true;
      assert.notEqual(await readFile(target, "utf8"), baseline, "Callback runs after actual file writes");
      assert.ok(await readFile(createdTarget, "utf8"));
      throw new Error("Injected dedicated record persistence failure");
    } }), /Injected dedicated record persistence failure/);
    assert.equal(invoked, true);
    assert.equal(await readFile(target, "utf8"), baseline);
    await assert.rejects(readFile(createdTarget), { code: "ENOENT" });
    assert.equal(f.git(["status", "--porcelain", "--", ".memsphere/memory"], linked), "");
    assert.deepEqual(await readdir(join(project, "changes")), recordsBefore);
  } finally {
    process.chdir(previousCwd);
    for (const key of environmentKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await f.cleanup();
  }
});
