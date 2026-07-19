import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";
import { parse } from "yaml";
import { parseMemoryYaml } from "../src/memory/yaml.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(projectRoot, "src", "cli.ts");
const tsxLoaderPath = join(projectRoot, "node_modules", "tsx", "dist", "loader.mjs");

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

async function withScope(fn: (scope: { root: string; nested: string; memoryRoot: string }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "memsphere-cli-test-"));
  const scopeRoot = join(root, ".memsphere");
  const memoryRoot = join(scopeRoot, "memory");
  const nested = join(root, "work", "nested");
  try {
    await mkdir(nested, { recursive: true });
    await mkdir(join(scopeRoot, "reviews"), { recursive: true });
    await mkdir(join(scopeRoot, "runs"), { recursive: true });
    for (const kind of ["concepts", "statements", "schemas", "procedures"]) {
      await mkdir(join(memoryRoot, kind), { recursive: true });
    }
    await writeFile(join(scopeRoot, "config.json"), `${JSON.stringify({ memoryRoot: "memory" })}\n`);
    await fn({ root, nested, memoryRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runCli(cwd: string, args: string[], home?: string): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ["--import", tsxLoaderPath, cliPath, ...args], {
      cwd,
      env: { ...process.env, ...(home ? { HOME: home } : {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolveResult({ code, stdout, stderr }));
  });
}

test("memory CLI lists and reads from a nested scope without exposing file paths", async () => {
  await withScope(async ({ nested, memoryRoot }) => {
    await writeFile(
      join(memoryRoot, "concepts", "random-95f2.yaml"),
      "!concept\nnames: [Memory, 记忆]\ndefines:\n  - A managed memory.\n  - !statement\n    asserts: [Read the complete memory.]\n"
    );
    await writeFile(
      join(memoryRoot, "schemas", "another-random-name.yaml"),
      "!schema\nnames: [Record]\ndefines: []\n"
    );

    const list = await runCli(nested, ["memory", "list"]);
    assert.equal(list.code, 0);
    assert.equal(list.stderr, "");
    const page = parse(list.stdout);
    assert.deepEqual(page.memories.map((item: { reference: string }) => item.reference), ["concepts/Memory", "schemas/Record"]);
    const memorySummary = page.memories.find((item: { reference: string }) => item.reference === "concepts/Memory");
    assert.deepEqual(memorySummary.defines, ["A managed memory."]);
    assert.deepEqual(memorySummary.structured_defines, { statement: 1 });
    assert(!list.stdout.includes("Read the complete memory."));
    assert.equal(page.next_cursor, null);
    assert(!list.stdout.includes("random-95f2"));
    assert(!list.stdout.includes(memoryRoot));

    const filtered = await runCli(nested, ["memory", "list", "--kind", "concepts", "--query", "记忆", "--output", "json"]);
    assert.equal(filtered.code, 0);
    const filteredPage = JSON.parse(filtered.stdout);
    assert.deepEqual(filteredPage.memories.map((item: { reference: string }) => item.reference), ["concepts/Memory"]);
    assert.deepEqual(filteredPage.memories[0].defines, ["A managed memory."]);
    assert.deepEqual(filteredPage.memories[0].structured_defines, { statement: 1 });

    for (const reference of ["concepts/Memory", "Memory", "记忆"]) {
      const read = await runCli(nested, ["memory", "read", reference]);
      assert.equal(read.code, 0, read.stderr);
      assert.equal(read.stderr, "");
      assert.deepEqual(parseMemoryYaml(read.stdout), {
        tag: "!concept",
        syntax: "start",
        names: ["Memory", "记忆"],
        defines: [
          "A managed memory.",
          {
            tag: "!statement",
            names: [],
            defines: [],
            asserts: ["Read the complete memory."]
          }
        ]
      });
    }
  });
});

test("memory CLI reads recursive Statement sections without flattening them", async () => {
  await withScope(async ({ nested, memoryRoot }) => {
    await writeFile(join(memoryRoot, "statements", "repository-rules.yaml"), `!statement
names: [Repository rules]
asserts: [All changes require review.]
sections:
  - !statement
    names: [Testing]
    suggests: [Prefer focused tests.]
    sections:
      - !statement
        names: [Core logic]
        asserts: [Core logic changes require tests.]
`);

    const read = await runCli(nested, ["memory", "read", "Repository rules"]);
    assert.equal(read.code, 0, read.stderr);
    assert.equal(read.stderr, "");
    const statement = parseMemoryYaml(read.stdout);
    assert.equal(statement.tag, "!statement");
    assert.deepEqual(statement.asserts, ["All changes require review."]);
    assert.equal(statement.sections[0].tag, "!statement");
    assert.equal(statement.sections[0].names[0], "Testing");
    assert.equal(statement.sections[0].sections[0].names[0], "Core logic");
    assert.deepEqual(statement.sections[0].sections[0].asserts, ["Core logic changes require tests."]);
  });
});

test("memory CLI lists and reads internal nodes across Memory kinds", async () => {
  await withScope(async ({ nested, memoryRoot }) => {
    await writeFile(join(memoryRoot, "concepts", "memory.yaml"), "!concept\nnames: [Memory]\ndefines: [A memory.]\n");
    await writeFile(join(memoryRoot, "statements", "rules.yaml"), `!statement
names: [Rules]
asserts: [All sections apply.]
sections:
  - !statement
    names: [Testing]
    asserts: [Run tests.]
`);
    await writeFile(join(memoryRoot, "schemas", "report.yaml"), `!schema
names: [Report]
fields:
  - Title
  - !repeat
    limit: { min: 1, max: 2 }
    body:
      - !schema
        names: [Item]
        fields: [Value]
`);
    await writeFile(join(memoryRoot, "procedures", "workflow.yaml"), `!procedure
names: [Workflow]
goals: [Finish.]
flow:
  - !if
    condition: !action
      action: Decide whether to continue.
      artifact: !artifact
        name: Continue
        type: boolean
    then:
      - !action
        action: Produce the result.
        artifact: !artifact
          name: Result
          type: string
          format: markdown
`);

    const concept = await runCli(nested, ["memory", "list", "Memory", "--output", "json"]);
    assert.equal(concept.code, 0, concept.stderr);
    assert.deepEqual(JSON.parse(concept.stdout).nodes, []);

    const statement = await runCli(nested, ["memory", "list", "Rules", "--output", "json"]);
    assert.equal(statement.code, 0, statement.stderr);
    assert.equal(JSON.parse(statement.stdout).nodes[0].node_ref, "statement:Testing");

    const statementRead = await runCli(nested, [
      "memory", "read", "Rules", "--node", "statement:Testing", "--output", "json"
    ]);
    assert.equal(statementRead.code, 0, statementRead.stderr);
    assert.deepEqual(JSON.parse(statementRead.stdout).context.root.asserts, ["All sections apply."]);

    const schema = await runCli(nested, ["memory", "list", "Report", "--output", "json"]);
    assert.equal(schema.code, 0, schema.stderr);
    assert.deepEqual(JSON.parse(schema.stdout).nodes.map((node: { node_ref: string }) => node.node_ref), [
      "string:Title",
      "repeat[1]/schema:Item"
    ]);

    const schemaRead = await runCli(nested, [
      "memory", "read", "Report", "--node", "repeat[1]/schema:Item/string:Value", "--output", "json"
    ]);
    assert.equal(schemaRead.code, 0, schemaRead.stderr);
    assert.equal(JSON.parse(schemaRead.stdout).context.ancestors[0].type, "Repeat");

    const procedure = await runCli(nested, ["memory", "list", "Workflow", "--output", "text"]);
    assert.equal(procedure.code, 0, procedure.stderr);
    assert.equal(procedure.stdout, "if:Continue\n");

    const branch = await runCli(nested, [
      "memory", "list", "Workflow", "--node", "if:Continue", "--output", "json"
    ]);
    assert.equal(branch.code, 0, branch.stderr);
    const branchNode = JSON.parse(branch.stdout).nodes[0];
    assert.equal(branchNode.node_ref, "if:Continue/then/action:Result");
    assert.equal(branchNode.artifact, "Result");

    const procedureRead = await runCli(nested, [
      "memory", "read", "Workflow", "--node", "if:Continue/then/action:Result", "--output", "json"
    ]);
    assert.equal(procedureRead.code, 0, procedureRead.stderr);
    const procedureResult = JSON.parse(procedureRead.stdout);
    assert.equal(procedureResult.context.ancestors[0].relation, "then");
    assert.equal(procedureResult.fragment.artifact.name, "Result");

    const missing = await runCli(nested, ["memory", "read", "Workflow", "--node", "action:Missing"]);
    assert.notEqual(missing.code, 0);
    assert.equal(missing.stdout, "");
    assert.match(missing.stderr, /memsphere memory list "procedures\/Workflow"/);

    const invalidCombination = await runCli(nested, ["memory", "list", "Workflow", "--query", "Workflow"]);
    assert.notEqual(invalidCombination.code, 0);
    assert.equal(invalidCombination.stdout, "");
    assert.match(invalidCombination.stderr, /cannot be used with a memory reference/);
  });
});

test("memory CLI reports ambiguity and other failures only on stderr", async () => {
  await withScope(async ({ nested, memoryRoot }) => {
    await writeFile(join(memoryRoot, "concepts", "one.yaml"), "!concept\nnames: [Shared]\ndefines: []\n");
    await writeFile(join(memoryRoot, "statements", "two.yaml"), "!statement\nnames: [Shared]\nasserts: [valid]\n");

    const ambiguous = await runCli(nested, ["memory", "read", "Shared"]);
    assert.notEqual(ambiguous.code, 0);
    assert.equal(ambiguous.stdout, "");
    assert.match(ambiguous.stderr, /concepts\/Shared, statements\/Shared/);

    const resolved = await runCli(nested, ["memory", "read", "Shared", "--kind", "concepts", "--output", "json"]);
    assert.equal(resolved.code, 0, resolved.stderr);
    assert.equal(JSON.parse(resolved.stdout).tag, "!concept");

    const missing = await runCli(nested, ["memory", "read", "Missing"]);
    assert.notEqual(missing.code, 0);
    assert.equal(missing.stdout, "");
    assert.match(missing.stderr, /memsphere memory list/);

    const invalidOutput = await runCli(nested, ["memory", "read", "Shared", "--output", "text"]);
    assert.notEqual(invalidOutput.code, 0);
    assert.equal(invalidOutput.stdout, "");
    assert.match(invalidOutput.stderr, /Allowed choices are yaml, json/);
  });
});

test("memory CLI rejects malformed stores, uninitialized scopes, and the removed top-level list", async () => {
  await withScope(async ({ nested, memoryRoot }) => {
    await writeFile(join(memoryRoot, "schemas", "broken.yaml"), "!schema\nnames: [Broken\n");

    const broken = await runCli(nested, ["memory", "list"]);
    assert.notEqual(broken.code, 0);
    assert.equal(broken.stdout, "");
    assert.match(broken.stderr, /Run memsphere validate/);
    assert(!broken.stderr.includes("broken.yaml"));

    const removed = await runCli(nested, ["list"]);
    assert.notEqual(removed.code, 0);
    assert.equal(removed.stdout, "");

    const isolatedRoot = await mkdtemp(join(tmpdir(), "memsphere-uninitialized-test-"));
    try {
      const isolatedHome = join(isolatedRoot, "home");
      const outside = join(isolatedRoot, "outside");
      await mkdir(isolatedHome);
      await mkdir(outside);
      const uninitialized = await runCli(outside, ["memory", "list"], isolatedHome);
      assert.notEqual(uninitialized.code, 0);
      assert.equal(uninitialized.stdout, "");
      assert.match(uninitialized.stderr, /Run memsphere init/);
    } finally {
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });
});
