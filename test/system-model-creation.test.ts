import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createProjectModelHost } from "../src/project/models.js";
import { readModelRegistrations } from "../src/project/model-registration.js";

test("Managed and Embedded project create publish complete persistent system models before success", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-create-models-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const env = { ...process.env, MEMSPHERE_HOME: home, GIT_AUTHOR_NAME: "Model test", GIT_AUTHOR_EMAIL: "models@example.test", GIT_COMMITTER_NAME: "Model test", GIT_COMMITTER_EMAIL: "models@example.test", GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "user.name", GIT_CONFIG_VALUE_0: "Model test", GIT_CONFIG_KEY_1: "user.email", GIT_CONFIG_VALUE_1: "models@example.test" };
  try {
    await mkdir(join(workspace, "memory"), { recursive: true });
    const git = spawnSync("git", ["init", "-b", "master"], { cwd: workspace, env, encoding: "utf8" });
    assert.equal(git.status, 0, git.stderr);
    for (const mode of ["managed", "embedded"]) {
      const args = [resolve("dist/cli.js"), "project", "create", mode, ...(mode === "embedded" ? ["--embedded", join(workspace, "memory")] : [])];
      const created = spawnSync(process.execPath, args, { cwd: workspace, env, encoding: "utf8", timeout: 30000 });
      assert.equal(created.status, 0, created.stderr);
      const project = join(home, "projects", mode);
      const config = JSON.parse(await readFile(join(project, "config.json"), "utf8"));
      const input = { root: project, modelRegistration: config.modelRegistration };
      assert.equal((await readModelRegistrations({}, input)).records.filter(record => record.origin === "system").length, 5);
      const models = await (await createProjectModelHost({}, input)).list();
      assert.equal(models.length, 5);
      assert.ok(models.every(model => model.status === "available" && model.origin === "system" && model.registration?.storage === "store"));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
