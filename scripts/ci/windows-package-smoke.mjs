import crossSpawn from "cross-spawn";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

if (process.platform !== "win32") throw new Error("windows-package-smoke must run on Windows");

const workspace = process.cwd();
const project = resolve(workspace, ".ci windows project");
const cli = resolve(workspace, ".ci-install", "node_modules", ".bin", "memsphere.cmd");

await Promise.all(
  ["concepts", "statements", "schemas", "procedures"].map((kind) =>
    mkdir(resolve(project, kind), { recursive: true })
  )
);
await writeFile(resolve(project, "procedures", "windows-ci-smoke.yaml"), `!procedure
syntax: memsphere-20260721-stable
names:
  - windows-ci-smoke
  - Windows CI smoke
goals:
  - Verify the packaged Windows CLI Run path.
flow:
  - !action
    action: Report one Windows smoke Artifact.
    artifact: !artifact
      name: Windows smoke result
      format: markdown
`, "utf8");
run(cli, ["project", "create", "windows-ci", "--embedded", project, "--bind"]);

run(cli, ["validate"], project);
run(cli, ["memory", "list", "--kind", "procedures", "--output", "json"], project);
run(cli, ["memory", "read", "Windows CI smoke", "--output", "json"], project);

const started = JSON.parse(run(
  cli,
  ["run", "start", "Windows CI smoke", "--name", "Windows packaged smoke", "--output", "json"],
  project
));
const runId = started.runId;
if (typeof runId !== "string") throw new Error("Windows smoke Run did not return a runId");
run(cli, ["run", "report", "--run", runId, "--artifact", "Windows packaged CLI passed."], project);
const completed = JSON.parse(run(cli, ["run", "show", "--run", runId, "--output", "json"], project));
if (completed.run.status !== "done") throw new Error(`Windows smoke Run did not complete: ${completed.run.status}`);

run(cli, ["daemon", "start"], project);
run(cli, ["daemon", "status"], project);
const startedView = JSON.parse(run(cli, ["view", "start", "--output", "json"], project));
const origin = startedView.view.url;
if (typeof origin !== "string") throw new Error("View start did not return an origin");
run(cli, ["view", "status"], project);
const response = await fetch(origin);
if (!response.ok) throw new Error(`View request failed with HTTP ${response.status}`);
run(cli, ["view", "restart"], project);
run(cli, ["view", "status"], project);
run(cli, ["daemon", "restart"], project);
run(cli, ["view", "status"], project);
run(cli, ["view", "stop"], project);
run(cli, ["view", "status"], project);
run(cli, ["daemon", "stop"], project);

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
