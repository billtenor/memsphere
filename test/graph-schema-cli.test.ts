import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { initializedContextFixture } from "./helpers/initialized-context.js";
const exec = promisify(execFile), cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

async function schemaCliFixture(t: test.TestContext) {
  const f = await initializedContextFixture(t);
  await exec("git", ["init", "-b", "master"], { cwd: f.root });
  const config = JSON.parse(await readFile(join(f.root, "config.json"), "utf8"));
  config.store = { type: "embedded", repository_path: f.root, memory_path: "memory" };
  await writeFile(join(f.root, "config.json"), JSON.stringify(config));
  await writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: { codex: { identity_enabled: true, async_enabled: false } } }));
  const env = { ...process.env, MEMSPHERE_HOME: f.home, MEMSPHERE_REVIEW_ASSIGNMENT_ID: "", MEMSPHERE_REVIEW_SESSION_ID: "", CODEX_THREAD_ID: "schema-cli", TRAECLI_THREAD_ID: "" };
  const call = async (...args: string[]) => JSON.parse((await exec(process.execPath, [cli, "--project", "test-project", ...args, "--output", "json"], { cwd: f.root, env })).stdout);
  const raw = async (...args: string[]) => (await exec(process.execPath, [cli, "--project", "test-project", ...args], { cwd: f.root, env })).stdout;
  return { f, call, raw };
}

test("real graph CLI and Continue save a positioned draft, export and submit the same Artifact", { timeout: 90000 }, async t => {
  const { f, call } = await schemaCliFixture(t);
  const file = join(f.directory, "schema.yaml");
  await writeFile(file, `!procedure\nsyntax: memsphere-20261027-stable\nmode: graph\nname: schema-cli\ndefines: [Report]\nactions:\n  - !action\n    id: report\n    description: Report\n    dependencies: [!dependency {from: START}]\n    artifact:\n      name: Report\n      model:\n        definedBy: memsphere/schema.json\n        definition: |\n          !schema\n          syntax: memsphere-20261027-stable\n          type: object\n          fields: [summary]\n      payload: {contentType: application/json}\n`);
  const started = await call("run", "start", "--file", file, "--name", "Schema CLI");
  const run = started.runId;
  const snapshot = await call("run", "show", "--run", run); const step = snapshot.steps[0].id;
  const initial = await call("continue", "enter-schema");
  const saved = await call("continue", "schema", "report", "--position", initial.position, "--artifact", '{"summary":"draft"}');
  assert.equal(saved.draft.id, initial.draft.id); assert.equal(saved.phase, "awaiting_finalization");
  await assert.rejects(call("run", "schema", "report", "--run", run, "--step", step, "--position", initial.position, "--artifact", '{"summary":"late"}'), /Writing position changed/);
  const copy = join(f.directory, "copy.json");
  await call("continue", "artifact", "export", "--file", copy);
  assert.deepEqual(JSON.parse(await readFile(copy, "utf8")), { summary: "draft" });
  await writeFile(copy, '{"summary":"final"}');
  const submitted = await call("continue", "report", "--artifact-file", copy);
  assert.equal(submitted.artifactId, initial.draft.id); assert.equal(submitted.status, "done");
});

test("Schema native entry and Continue retain all rule scopes, input links and Human responsibility", { timeout: 90000 }, async t => {
  const { f, call, raw } = await schemaCliFixture(t);
  const { serializeMemoryYaml } = await import("../src/memory/serializer.js");
  const source = { tag: "!procedure", syntax: "memsphere-20261027-stable", mode: "graph", names: ["schema-context"], defines: ["Report"], asserts: ["Workflow rule"], actions: [
    { tag: "!action", id: "input", description: "Prepare", dependencies: [{ tag: "!dependency", from: "START" }], artifact: { name: "Input", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/plain" } } },
    { tag: "!action", id: "report", actor: "human", description: "Write the report", asserts: ["Action rule"], dependencies: [{ tag: "!dependency", from: "input" }], artifact: { name: "Report", asserts: ["Artifact rule"], model: { definedBy: "memsphere/schema.json", definition: "!schema\nsyntax: memsphere-20261027-stable\ntype: object\nfields: [summary]\n" }, payload: { contentType: "application/json" } } }
  ] };
  const file = join(f.directory, "context.yaml"); await writeFile(file, serializeMemoryYaml(source as import("../src/memory/ast.js").GraphProcedureMemory));
  const started = await call("run", "start", "--file", file, "--name", "Context");
  const delivered = await call("continue", "report", "--artifact", "Upstream source");
  const snapshot = await call("run", "show", "--run", started.runId);
  const step = snapshot.steps.find((s: any) => s.source.actionId === "report").id;
  const native = await raw("run", "step", "enter", "--run", started.runId, "--step", step);
  for (const prompt of [delivered.prompt, native]) {
    for (const requirement of ["Workflow rule", "Action rule", "Artifact rule", delivered.artifactId, "run artifact show", "summary", "Human", "enter-schema"]) assert.ok(prompt.includes(requirement), requirement);
  }
});
