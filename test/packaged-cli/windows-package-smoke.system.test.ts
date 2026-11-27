import crossSpawn from "cross-spawn";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("installed Windows CLI completes a Run and exercises the View and daemon lifecycle", async () => {
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
  run(["project", "create", "windows-ci", "--embedded", project, "--bind"], workspace);

  run(["validate"]);
  run(["memory", "list", "--kind", "procedures", "--output", "json"]);
  run(["memory", "read", "Windows CI smoke", "--output", "json"]);

  const started = run(["run", "start", "Windows CI smoke", "--name", "Windows packaged smoke"]);
  const runId = started.match(/\b(run-[a-z0-9-]+)\b/i)?.[1];
  if (!runId) throw new Error(`Could not read Run id from output:\n${started}`);
  run(["run", "report", "--run", runId, "--artifact", "Windows packaged CLI passed."]);
  const completed = JSON.parse(run(["run", "show", "--run", runId, "--output", "json"]));
  if (completed.run?.status !== "done") throw new Error(`Windows smoke Run did not complete: ${completed.run?.status}`);

  run(["daemon", "start"]);
  run(["daemon", "status"]);
  const startedView = JSON.parse(run(["view", "start", "--output", "json"]));
  const origin = startedView.view?.url;
  if (!origin) throw new Error("View start did not return view.url");
  run(["view", "status"]);
  const response = await fetch(origin);
  if (!response.ok) throw new Error(`View request failed with HTTP ${response.status}`);
  run(["view", "restart"]);
  run(["view", "status"]);
  run(["daemon", "restart"]);
  run(["view", "status"]);
  run(["view", "stop"]);
  run(["view", "status"]);
  run(["daemon", "stop"]);

  function run(args: string[], cwd = project) {
    const result = crossSpawn.sync(cli, args, {
      cwd,
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${cli} ${args.join(" ")} exited ${result.status}`);
    return result.stdout ?? "";
  }
});
