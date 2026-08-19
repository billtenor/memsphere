import crossSpawn from "cross-spawn";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

if (process.platform !== "win32") throw new Error("windows-package-smoke must run on Windows");

const workspace = process.cwd();
const project = resolve(workspace, ".ci windows project");
const cli = resolve(workspace, ".ci-install", "node_modules", ".bin", "memsphere.cmd");

run(cli, ["init", "--folder", project]);
await mkdir(resolve(project, ".memsphere", "memory", "procedures"), { recursive: true });
await writeFile(resolve(project, ".memsphere", "memory", "procedures", "windows-ci-smoke.yaml"), `!procedure
syntax: memsphere-20260721-stable
name: Windows CI smoke
goals:
  - Verify the packaged Windows CLI Run path.
flow:
  - !action
    action: Report one Windows smoke Artifact.
    artifact: !artifact
      name: Windows smoke result
      format: markdown
`, "utf8");

run(cli, ["validate"], project);
run(cli, ["memory", "list", "--kind", "procedures", "--output", "json"], project);
run(cli, ["memory", "read", "Windows CI smoke", "--output", "json"], project);

const started = run(cli, ["run", "start", "Windows CI smoke"], project);
const runId = started.match(/\b(run-[a-z0-9-]+)\b/i)?.[1];
if (!runId) throw new Error(`Could not read Run id from output:\n${started}`);
run(cli, ["run", "report", "--run", runId, "--artifact", "Windows packaged CLI passed."], project);
const completed = JSON.parse(run(cli, ["run", "show", "--run", runId, "--output", "json"], project));
if (completed.status !== "done") throw new Error(`Windows smoke Run did not complete: ${completed.status}`);

const startedView = run(cli, ["view", "start"], project);
const origin = startedView.match(/https?:\/\/[^\s]+/)?.[0];
if (!origin) throw new Error(`View start did not return an origin:\n${startedView}`);
run(cli, ["view", "status"], project);
const response = await fetch(origin);
if (!response.ok) throw new Error(`View request failed with HTTP ${response.status}`);
run(cli, ["view", "restart"], project);
run(cli, ["view", "status"], project);
run(cli, ["view", "stop"], project);
run(cli, ["view", "status"], project);

function run(command, args, cwd = workspace) {
  const result = crossSpawn.sync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
  return result.stdout ?? "";
}
