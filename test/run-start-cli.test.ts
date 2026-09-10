import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runGit } from "../src/git.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

const builtCliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

test("run start CLI accepts all skipped Review Slots without a control plane", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-run-start-cli-"));
  const home = join(root, "home");
  const projectRoot = join(root, "project");
  const proceduresRoot = join(projectRoot, "memory", "procedures");
  const runsRoot = join(projectRoot, "runs");
  const projectName = "run-start-cli";
  try {
    await mkdir(proceduresRoot, { recursive: true });
    await mkdir(home, { recursive: true });
    await runGit(["init", "-b", "master"], { cwd: projectRoot });
    await writeFile(join(proceduresRoot, "reviewed.yaml"), withCurrentMemorySyntax(`!procedure
name: reviewed-cli
flow:
  - !action
    action: Produce a reviewed Artifact.
    artifact: !artifact
      name: reviewed result
      review: [reviewer]
`));
    await writeFile(join(projectRoot, "project.json"), `${JSON.stringify({
      format_version: 1,
      name: projectName,
      created_at: new Date().toISOString()
    })}\n`);
    await writeFile(join(projectRoot, "config.json"), `${JSON.stringify({
      store: { type: "embedded", repository_path: projectRoot, memory_path: "memory" }
    })}\n`);
    await writeFile(join(home, "registry.json"), `${JSON.stringify({
      format_version: 1,
      projects: { [projectName]: { root: projectRoot } },
      workspaces: {}
    })}\n`);

    const preflight = runBuiltCli(projectRoot, home, projectName, [
      "run", "start", "reviewed-cli", "--name", "preflight"
    ]);
    assert.equal(preflight.status, 0, preflight.stderr);
    assert.match(preflight.stdout, /artifact_acceptance\.unanimous/);
    assert.match(preflight.stdout, /"skip": true/);
    assert.deepEqual(await readdir(runsRoot), []);

    const skippedConfigPath = join(root, "skipped-review.json");
    await writeFile(skippedConfigPath, JSON.stringify({
      reviews: {
        "reviewed-cli#flow[1]": { policy: "artifact_acceptance.unanimous" }
      },
      slots: {
        "reviewed-cli::reviewer": { skip: true }
      }
    }));
    const started = runBuiltCli(projectRoot, home, projectName, [
      "run", "start", "reviewed-cli", "--name", "all skipped", "--review-config", skippedConfigPath
    ]);
    assert.equal(started.status, 0, started.stderr);
    const runId = started.stdout.match(/Run (run-[^\s]+)/)?.[1];
    assert(runId, started.stdout);
    assert.deepEqual(await runDirectories(runsRoot), [runId]);

    const reported = runBuiltCli(projectRoot, home, projectName, [
      "run", "report", "--run", runId, "--artifact", "accepted without Review"
    ]);
    assert.equal(reported.status, 0, reported.stderr);
    assert.match(reported.stdout, /完成|Done/);

    const actorConfigPath = join(root, "actor-review.json");
    await writeFile(actorConfigPath, JSON.stringify({
      reviews: {
        "reviewed-cli#flow[1]": { policy: "artifact_acceptance.unanimous" }
      },
      slots: {
        "reviewed-cli::reviewer": { actors: ["human"] }
      }
    }));
    const rejected = runBuiltCli(projectRoot, home, projectName, [
      "run", "start", "reviewed-cli", "--name", "actor bound", "--review-config", actorConfigPath
    ]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /control_plane config is required/);
    assert.doesNotMatch(rejected.stderr, /Review configuration is required/);
    assert.deepEqual(await runDirectories(runsRoot), [runId]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function runBuiltCli(
  cwd: string,
  home: string,
  project: string,
  args: string[]
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [builtCliPath, ...args], {
    cwd,
    env: { ...process.env, MEMSPHERE_HOME: home, MEMSPHERE_PROJECT: project },
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function runDirectories(runsRoot: string): Promise<string[]> {
  return (await readdir(runsRoot)).filter((name) => name.startsWith("run-")).sort();
}
