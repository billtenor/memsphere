import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readBundledSystemModels } from "../../src/reserved/models.js";
import { withCurrentMemorySyntax } from "./memory.js";

const cli = resolve("dist/cli.js");
export const memoryPath = "concepts/memsphere-framework.yaml";
export const systemModel = readBundledSystemModels().find(model => model.registration.modelRef === "memsphere/model-registration.json")!;
export const definitionPath = "models/registrations/system/definitions/json-schema/draft-07/memsphere/model-registration.json";

type Fixture = Awaited<ReturnType<typeof fixture>>;
export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "memsphere-upgrade-cli-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const gitconfig = join(root, "gitconfig");
  await writeFile(gitconfig, "[user]\n name = Upgrade Test\n email = upgrade@example.invalid\n");
  const env = { ...process.env, HOME: root, USERPROFILE: root, MEMSPHERE_HOME: home, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: "1" };
  delete env.MEMSPHERE_PROJECT;
  const run = (args: string[], cwd = workspace) => spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8" });
  const git = (args: string[], cwd = workspace) => {
    const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const create = (name: string, options: string[] = []) => {
    const result = run(["project", "create", name, ...options]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return join(home, "projects", name);
  };
  const upgrade = (name: string, args: string[] = [], cwd = workspace) => {
    const result = run(["project", "upgrade", name, "--output", "json", ...args], cwd);
    assert.ok(result.stdout.trim(), result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(result.stdout.trim().split("\n").length, 1, "JSON stdout is a single object");
    return { result, value };
  };
  return { root, home, workspace, env, run, git, create, upgrade, cleanup: () => rm(root, { recursive: true, force: true }) };
}
export async function alterDefinition(projectRoot: string) {
  const path = join(projectRoot, definitionPath);
  const definition = JSON.parse(await readFile(path, "utf8"));
  definition.description = "Previous supported system definition";
  await writeFile(path, `${JSON.stringify(definition, null, 2)}\n`);
}
export async function managedDrift(f: Fixture, projectRoot: string) {
  const path = join(projectRoot, "memory", memoryPath);
  await writeFile(path, `${await readFile(path, "utf8")}\n# Previous bundled version\n`);
  f.git(["add", "."], join(projectRoot, "memory"));
  f.git(["commit", "-m", "Previous published system memory"], join(projectRoot, "memory"));
  const configPath = join(projectRoot, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.store.published_revision = f.git(["rev-parse", "HEAD"], join(projectRoot, "memory"));
  await writeFile(configPath, JSON.stringify(config));
}
export async function registrations(projectRoot: string) {
  const directory = join(projectRoot, "models/registrations/system/registrations");
  return Promise.all((await readdir(directory)).map(async name => ({ name, path: join(directory, name), bytes: await readFile(join(directory, name), "utf8") })));
}

export async function embeddedFixture(f: Fixture, branch = "master") {
  f.git(["init", "-b", branch]);
  const memoryRoot = join(f.workspace, ".memsphere/memory");
  await mkdir(memoryRoot, { recursive: true });
  const project = f.create("embedded", ["--embedded", memoryRoot, "--bind"]);
  await writeFile(join(memoryRoot, memoryPath), `${await readFile(join(memoryRoot, memoryPath), "utf8")}\n# Previous bundled version\n`);
  await writeFile(join(memoryRoot, "concepts/user.yaml"), withCurrentMemorySyntax("!concept\nnames: [user]\ndefines: [User-owned concept.]\n"));
  f.git(["add", "."]);
  f.git(["commit", "-m", "Previous project baseline"]);
  return { project, memoryRoot };
}
