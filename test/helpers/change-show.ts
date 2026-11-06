import assert from "node:assert/strict";
import type test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import crossSpawn from "cross-spawn";
import { managedProjectFixture } from "./project.js";
import { runGit } from "../../src/git.js";
import { editMemories, publishMemoryChange, renameMemory, validateMemoryChange } from "../../src/memory/changeset.js";
import { readProjectRegistry } from "../../src/project/registry.js";
import { createAgentReviewCliRuntime } from "../../src/acp/cli-runtime.js";
import { invokeCliModule } from "./cli-module.js";

export async function changeShowFixture(t: test.TestContext) {
  const cli = resolve("dist/cli.js");
  const root = await mkdtemp(join(tmpdir(), "memsphere-change-show-"));
  const workspace = join(root, "workspace"), home = join(root, "home");
  const saved = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME, project: process.env.MEMSPHERE_PROJECT, git: process.env.GIT_CONFIG_GLOBAL };
  const runtime = await createAgentReviewCliRuntime({ nodeExecutable: process.execPath, cliEntrypoint: cli });
  t.after(async () => {
    process.chdir(saved.cwd);
    for (const [key, value] of [["MEMSPHERE_HOME", saved.home], ["MEMSPHERE_PROJECT", saved.project], ["GIT_CONFIG_GLOBAL", saved.git]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
    await runtime.cleanup(); await rm(root, { recursive: true, force: true });
  });
  await mkdir(workspace);
  await writeFile(join(root, "gitconfig"), "[user]\nname = Test\nemail = test@example.com\n");
  process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
  process.env.MEMSPHERE_HOME = home;
  delete process.env.MEMSPHERE_PROJECT;
  process.chdir(workspace);
  await runGit(["init", "-b", "master"], { cwd: workspace });
  await managedProjectFixture("project", { bind: true, systemMemory: false });
  const projectRoot = (await readProjectRegistry(home)).projects.project.root;
  const seed = await editMemories({ references: ["concepts/existing", "concepts/deleted", "concepts/old-name", "concepts/late-delete", "concepts/late-rename", "concepts/scope-only", "statements/dependency"] });
  const dependency = join(seed.candidateRoot, "statements/dependency.yaml");
  await writeFile(dependency, (await readFile(dependency, "utf8")).replace("asserts: []", "asserts: [Frozen dependency rule.]"));
  await publishMemoryChange(seed.change.id);
  const edit = await editMemories({ references: ["concepts/review-evidence", "concepts/existing"] });
  await editMemories({ references: ["concepts/deleted"], changeId: edit.change.id, operation: "delete" });
  await renameMemory({ reference: "concepts/old-name", newName: "new-name", changeId: edit.change.id });
  const candidate = join(edit.candidateRoot, "concepts/review-evidence.yaml");
  for (const [path, content] of [[candidate, "Pinned content."], [join(edit.candidateRoot, "concepts/existing.yaml"), "Updated existing content."]]) {
    await writeFile(path!, (await readFile(path!, "utf8")).replace("defines: []", `defines: [${content}]`));
  }
  const checkpoint = await validateMemoryChange(edit.change.id);
  assert.deepEqual(checkpoint.issues, []);
  const metadata = join(projectRoot, "changes", edit.change.id, "change.json");
  const env = { ...process.env, MEMSPHERE_CONFIG_PATH: join(projectRoot, "config.json") };
  const command = (args: string[]) => crossSpawn.sync(runtime.launcherPath, args, { cwd: workspace, env, encoding: "utf8", timeout: 20_000 });
  let digest = checkpoint.checkpointDigest;
  const invoke = (extra: string[] = []) => command(["memory", "change", "show", edit.change.id, "--checkpoint", digest, ...extra]);
  const read = (extra: string[] = []) => {
    const r = invoke(extra); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
  };
  const readMaterial = async (extra: string[] = []) => {
    const receipt = await invokeCliModule(["memory", "change", "show", edit.change.id, "--checkpoint", digest, ...extra], workspace, env, cli);
    return JSON.parse(receipt.stdout);
  };
  // Material stability exercises the real command tree without repeatedly
  // starting an OS shell. read/invoke/command retain the Reviewer subprocess
  // boundary for defaults, body/diff output, authorization and failure cases.
  const snapshot = async () => {
    const result = [];
    for (const extra of [[], ["--part", "diff"], ["--part", "memory", "--reference", "concepts/existing"], ["--part", "validation"]]) {
      result.push(await readMaterial(extra));
    }
    return result;
  };
  const versionRoot = (version = digest) => join(projectRoot, "changes", edit.change.id, "checkpoints", version);
  return { root, home, projectRoot, edit, candidate, metadata, checkpoint, command, invoke, read, readMaterial, snapshot, versionRoot, setDigest: (value: string) => { digest = value; } };
}
