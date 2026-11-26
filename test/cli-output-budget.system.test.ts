import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { get_encoding } from "tiktoken";
import { invokeCliModule } from "./helpers/cli-module.js";

const graphProcedure = `!procedure
syntax: memsphere-20261027-stable
mode: graph
name: schema-cli
defines: [Report]
actions:
  - !action
    id: report
    description: Report
    dependencies: [!dependency {from: START}]
    artifact:
      name: Report
      model:
        definedBy: memsphere/schema.json
        definition: |
          !schema
          syntax: memsphere-20261027-stable
          type: object
          fields: [summary]
      payload: {contentType: application/json}
`;
const flowProcedure = `!procedure
syntax: memsphere-20261027-stable
name: flow-output-audit
flow:
  - !action
    action: Produce a sample Artifact.
    artifact: !artifact
      name: sample result
`;

function stableSample(stdout: string, temporary: string) {
  return stdout.replaceAll(temporary, "<FIXTURE>")
    .replace(/run-\d{8}-\d{6}z-[0-9a-f]{8}/g, "run-20000101-000000z-00000000")
    .replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, "00000000-0000-0000-0000-000000000000")
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, "2000-01-01T00:00:00.000Z");
}

for (const language of ["zh-CN", "en"]) {
  test(language + " Run receipts preserve their public facts within the token and byte budgets", async t => {
    const root = await mkdtemp(join(tmpdir(), "memsphere-output-budget-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const tokenizer = get_encoding("o200k_base");
    t.after(() => tokenizer.free());
    const workspace = join(root, "workspace");
    const home = join(root, "home");
    await mkdir(workspace);
    await writeFile(join(workspace, "graph.yaml"), graphProcedure);
    await writeFile(join(workspace, "flow.yaml"), flowProcedure);
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("MEMSPHERE_") || key.startsWith("GIT_CONFIG_KEY_") || key.startsWith("GIT_CONFIG_VALUE_") ||
        ["CODEX_THREAD_ID", "TRAECLI_THREAD_ID", "CLAUDE_CODE_SESSION_ID"].includes(key)) delete env[key];
    }
    Object.assign(env, { MEMSPHERE_HOME: home, GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "user.name", GIT_CONFIG_VALUE_0: "Fixture",
      GIT_CONFIG_KEY_1: "user.email", GIT_CONFIG_VALUE_1: "fixture@example.invalid" });
    const invoke = async (...args: string[]) => {
      const result = await invokeCliModule(args, workspace, env, "memsphere");
      assert.equal(result.stderr, "");
      return result.stdout;
    };
    await invoke("project", "create", "prompt-audit", "--bind");
    const configPath = join(home, "config.json");
    const config = await readFile(configPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "{}";
      throw error;
    });
    await writeFile(configPath, JSON.stringify({ ...JSON.parse(config), language }));
    const run = (...args: string[]) => invoke("--project", "prompt-audit", "run", ...args);
    await run("start", "--name", "fixture");
    const exploration = JSON.parse(await run("start", "--name", "fixture-json", "--output", "json")).runId;
    await run("report", "--run", exploration, "--name", "example", "--artifact", "hello", "--output", "json");
    const graph = JSON.parse(await run("start", "--file", "graph.yaml", "--name", "graph-schema", "--output", "json"));
    const flow = JSON.parse(await run("start", "--file", "flow.yaml", "--name", "flow audit", "--output", "json"));
    async function measure(label: string, args: string[], bytes: number, tokens: number) {
      const stdout = await run(...args);
      const length = Buffer.byteLength(stdout);
      const count = tokenizer.encode_ordinary(stableSample(stdout, root)).length;
      assert.ok(length <= bytes && count > 0 && count <= tokens,
        language + " " + label + " used " + length + "/" + bytes + " bytes and " + count + "/" + tokens + " tokens");
      return stdout;
    }
    await t.test("Run list", async () => {
      const listText = await measure("run list text", ["status"], 350, 125);
      const list = JSON.parse(await measure("run list JSON", ["status", "--output", "json"], 700, 200));
      assert.equal(list.runs.length, 4);
      for (const row of list.runs) assert.ok(listText.includes(row.runId));
    });
    await t.test("graph Schema status", async () => {
      const graphArgs = ["status", "--run", graph.runId];
      const graphText = await measure("graph text", graphArgs, 950, 300);
      const graphStatus = JSON.parse(await measure("graph JSON", [...graphArgs, "--output", "json"], 1100, 325));
      assert.equal(graphStatus.status, "running");
      assert.equal(graphStatus.schemaPhase, "not_started");
      assert.deepEqual(graphStatus.nextAction.args, ["--project", "prompt-audit", "run", "enter-schema",
        "--run", graph.runId, "--step", graph.stepId]);
      assert.match(graphText, /enter-schema/);
      assert.doesNotMatch(graphText, /schema report/);
    });
    await t.test("exploration status", async () => {
      const exploreArgs = ["status", "--run", exploration];
      const exploreText = await measure("exploration text", exploreArgs, 600, 210);
      const exploreJSON = await measure("exploration JSON", [...exploreArgs, "--output", "json"], 600, 210);
      const exploreStatus = JSON.parse(exploreJSON);
      assert.equal(exploreStatus.runId, exploration);
      assert.equal(exploreStatus.completedSteps, 1);
      assert.doesNotMatch(exploreText + exploreJSON, /hello/);
    });
    await t.test("historical flow status", async () => {
      assert.equal(JSON.parse(await run("status", "--run", flow.runId, "--output", "json")).runId, flow.runId);
    });
  });
}
