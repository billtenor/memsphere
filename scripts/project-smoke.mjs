import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = mkdtempSync(join(tmpdir(), "memsphere-project-smoke-"));
const home = join(root, "home");
const workspace = join(root, "workspace");
const gitConfig = join(root, "gitconfig");
const cli = resolve("dist", "cli.js");

try {
  mkdirSync(workspace);
  writeFileSync(gitConfig, "[user]\n\tname = Memsphere Smoke\n\temail = smoke@example.com\n");
  const env = { ...process.env, MEMSPHERE_HOME: home, GIT_CONFIG_GLOBAL: gitConfig };
  execFileSync("git", ["init", "-b", "master"], { cwd: workspace, env, stdio: "pipe" });
  execFileSync(process.execPath, [cli, "project", "create", "smoke", "--bind"], {
    cwd: workspace,
    env,
    stdio: "pipe"
  });
  const projects = JSON.parse(execFileSync(
    process.execPath,
    [cli, "project", "list", "--output", "json"],
    { cwd: workspace, env, encoding: "utf8" }
  ));
  assert.deepEqual(projects.map((project) => ({ name: project.name, primary: project.primary })), [
    { name: "smoke", primary: true }
  ]);
  const validation = execFileSync(process.execPath, [cli, "validate"], {
    cwd: workspace,
    env,
    encoding: "utf8"
  });
  assert.match(validation, /memsphere validation passed/);
  console.log(`Project smoke passed on ${process.platform}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
