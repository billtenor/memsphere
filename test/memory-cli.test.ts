import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";
import { parse } from "yaml";
import { parseMemoryYaml } from "../src/memory/yaml.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";
import { resolveWorkspaceIdentity } from "../src/project/workspace.js";
import { runGit } from "../src/git.js";

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
  const home = join(root, "home");
  const project = join(home, "projects", "test-project");
  const memoryRoot = join(root, "memory");
  const nested = join(root, "work", "nested");
  const previousHome = process.env.MEMSPHERE_HOME;
  try {
    await runGit(["init", "-b", "master"], { cwd: root });
    await mkdir(nested, { recursive: true });
    await mkdir(project, { recursive: true });
    await mkdir(join(project, "reviews"), { recursive: true });
    await mkdir(join(project, "runs"), { recursive: true });
    await mkdir(join(project, "archives"), { recursive: true });
    await mkdir(join(project, "changes"), { recursive: true });
    for (const kind of ["concepts", "statements", "schemas", "procedures"]) {
      await mkdir(join(memoryRoot, kind), { recursive: true });
    }
    await writeFile(join(project, "project.json"), `${JSON.stringify({ format_version: 1, name: "test-project", created_at: new Date().toISOString() })}\n`);
    await writeFile(join(project, "config.json"), `${JSON.stringify({
      store: { type: "embedded", repository_path: root, memory_path: "memory" }
    })}\n`);
    process.env.MEMSPHERE_HOME = home;
    const workspace = await resolveWorkspaceIdentity(nested);
    await writeFile(join(home, "registry.json"), `${JSON.stringify({
      format_version: 1,
      projects: { "test-project": { root: project } },
      workspaces: { [workspace.key]: { primary: "test-project", mounted: [] } }
    })}\n`);
    await fn({ root, nested, memoryRoot });
  } finally {
    if (previousHome === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
}

async function runCli(cwd: string, args: string[], home?: string): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [
      "--import",
      pathToFileURL(tsxLoaderPath).href,
      cliPath,
      ...args
    ], {
      cwd,
      env: { ...process.env, ...(home ? { MEMSPHERE_HOME: home } : {}) },
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

test("memory change validate checks the effective Store without expanding a sparse candidate", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-change-cli-test-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const gitConfig = join(root, "gitconfig");
  const previousGitConfig = process.env.GIT_CONFIG_GLOBAL;
  try {
    await mkdir(workspace);
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    const createdProject = await runCli(workspace, ["project", "create", "project", "--bind"], home);
    assert.equal(createdProject.code, 0, createdProject.stderr);

    const repairHelp = await runCli(workspace, ["project", "repair", "--help"], home);
    assert.equal(repairHelp.code, 0, repairHelp.stderr);
    assert.match(repairHelp.stdout, /only bundled System Memory/);
    assert.match(repairHelp.stdout, /user Memory is not\s+modified/);
    assert.match(repairHelp.stdout, /Embedded\s+repair validates the complete candidate/);
    assert.match(repairHelp.stdout, /without committing or pushing/);
    assert.match(repairHelp.stdout, /Mounted Projects remain read-only/);
    assert.match(repairHelp.stdout, /manifest v3 tombstone matches/);
    assert.match(repairHelp.stdout, /If there are no differences, nothing is written/);
    assert.match(repairHelp.stdout, /Explicit \[name\], then global --project, then the current Primary Project/);

    const repaired = await runCli(workspace, ["--project", "project", "project", "repair"], home);
    assert.equal(repaired.code, 0, repaired.stderr);
    assert.match(repaired.stdout, /^Project: project$/m);
    assert.match(repaired.stdout, /^Store: Managed$/m);
    assert.match(repaired.stdout, /^System Memory changes: 0 create, 0 update, 0 delete$/m);
    assert.match(repaired.stdout, /^Revision: [0-9a-f]{40,64}$/m);
    assert.doesNotMatch(repaired.stdout, /ChangeSet:|Candidate Root:|Validate:|Publish:/);

    const removedAlias = await runCli(workspace, ["project", "reinitialize"], home);
    assert.notEqual(removedAlias.code, 0);
    assert.match(removedAlias.stderr, /unknown command ['‘]?reinitialize/);

    const edited = await runCli(workspace, ["memory", "edit", "concepts/shared"], home);
    assert.equal(edited.code, 0, edited.stderr);
    const changeId = /^ChangeSet: (.+)$/m.exec(edited.stdout)?.[1];
    const candidateRoot = /^Candidate Root: (.+)$/m.exec(edited.stdout)?.[1];
    assert(changeId && candidateRoot);
    assert.match(edited.stdout, new RegExp(`Next: memsphere memory change validate ${changeId}`));
    assert.deepEqual(await readdir(candidateRoot), ["concepts"]);
    const candidate = join(candidateRoot, "concepts", "shared.yaml");
    await writeFile(candidate, (await readFile(candidate, "utf8")).replace("defines: []", "defines: [Shared concept]"));

    const deleted = await runCli(workspace, ["memory", "delete", "concepts/memsphere-memory"], home);
    assert.equal(deleted.code, 0, deleted.stderr);
    const deleteChangeId = /^ChangeSet: (.+)$/m.exec(deleted.stdout)?.[1];
    assert(deleteChangeId);
    assert.match(deleted.stdout, new RegExp(`Next: memsphere memory change validate ${deleteChangeId}`));

    const renamed = await runCli(workspace, [
      "memory", "rename", "concepts/memsphere-framework", "memsphere-framework-renamed"
    ], home);
    assert.equal(renamed.code, 0, renamed.stderr);
    const renameChangeId = /^ChangeSet: (.+)$/m.exec(renamed.stdout)?.[1];
    assert(renameChangeId);
    assert.match(renamed.stdout, new RegExp(`Next: memsphere memory change validate ${renameChangeId}`));

    const changeRoot = join(home, "projects", "project", "changes", changeId);
    const recoveryRoot = join(changeRoot, "memory");
    const changeBeforeStoreValidation = await readFile(join(changeRoot, "change.json"), "utf8");
    await assert.rejects(access(recoveryRoot), /ENOENT/);
    const storeValidation = await runCli(workspace, ["validate"], home);
    assert.equal(storeValidation.code, 0, storeValidation.stderr);
    assert.match(storeValidation.stdout, /Validation scope: current Project Store/);
    assert.match(storeValidation.stdout, /ChangeSet: not created or updated/);
    assert.match(storeValidation.stdout, /memsphere memory change validate \[change-id\]/);
    assert.equal(await readFile(join(changeRoot, "change.json"), "utf8"), changeBeforeStoreValidation);
    await assert.rejects(access(recoveryRoot), /ENOENT/);

    const textResult = await runCli(workspace, ["memory", "change", "validate", changeId], home);
    assert.equal(textResult.code, 0, textResult.stderr);
    assert.match(textResult.stdout, /ChangeSet validation passed/);
    assert.match(textResult.stdout, new RegExp(`ChangeSet: ${changeId}`));
    assert.match(
      textResult.stdout,
      new RegExp(`Preview: start memsphere View, then open /projects/project/changes/${changeId}`)
    );
    await access(recoveryRoot);
    assert.deepEqual(await readdir(candidateRoot), ["concepts"]);

    const jsonResult = await runCli(workspace, ["memory", "change", "validate", changeId, "--format", "json"], home);
    assert.equal(jsonResult.code, 0, jsonResult.stderr);
    const validPayload = JSON.parse(jsonResult.stdout);
    assert.equal(validPayload.valid, true);
    assert.equal(validPayload.changeId, changeId);
    assert.deepEqual(validPayload.issues, []);

    await writeFile(candidate, "!concept\nnames: [Broken\n");
    const invalidResult = await runCli(workspace, ["memory", "change", "validate", changeId, "--format", "json"], home);
    assert.equal(invalidResult.code, 1);
    assert.equal(invalidResult.stderr, "");
    const invalidPayload = JSON.parse(invalidResult.stdout);
    assert.equal(invalidPayload.valid, false);
    assert(invalidPayload.issues.some((issue: { path: string }) => issue.path === candidate));
  } finally {
    if (previousGitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previousGitConfig;
    await rm(root, { recursive: true, force: true });
  }
});

test("memory edit uses the current Embedded worktree without a ChangeSet", async () => {
  await withScope(async ({ nested, memoryRoot }) => {
    const created = await runCli(nested, ["memory", "edit", "concepts/new-memory"]);
    assert.equal(created.code, 0, created.stderr);
    assert.match(created.stdout, /Store: embedded/);
    assert.match(created.stdout, /Next: memsphere memory change validate/);
    assert(!created.stdout.includes("ChangeSet:"));
    assert.match(await readFile(join(memoryRoot, "concepts", "new-memory.yaml"), "utf8"), /new-memory/);

    const existing = await runCli(nested, ["memory", "edit", "concepts/new-memory"]);
    assert.equal(existing.code, 0, existing.stderr);
    assert.match(existing.stdout, /\tupdate\t/);

    const rejected = await runCli(nested, ["memory", "edit", "concepts/new-memory", "--change", "change-demo"]);
    assert.equal(rejected.code, 1);
    assert.match(rejected.stderr, /only available for a Managed Project/);
  });
});

test("validate distinguishes Project Store checks from stateless Memory root checks", async () => {
  await withScope(async ({ root, nested, memoryRoot }) => {
    const help = await runCli(nested, ["validate", "--help"]);
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /never creates\s+or updates a ChangeSet/);
    assert.match(help.stdout, /memsphere memory change validate \[change-id\]/);
    assert.match(help.stdout, /stateless --memory-root mode has no Project or ChangeSet context/);

    const textResult = await runCli(nested, ["validate"]);
    assert.equal(textResult.code, 0, textResult.stderr);
    assert.match(textResult.stdout, /Validation scope: current Project Store/);
    assert.match(textResult.stdout, /ChangeSet: not created or updated/);
    assert.match(textResult.stdout, /memsphere memory change validate \[change-id\]/);

    const jsonResult = await runCli(nested, ["validate", "--format", "json"]);
    assert.equal(jsonResult.code, 0, jsonResult.stderr);
    assert.deepEqual(
      (({ valid, validationScope, changeSetEffect, nextCommand }) => ({
        valid, validationScope, changeSetEffect, nextCommand
      }))(JSON.parse(jsonResult.stdout)),
      {
        valid: true,
        validationScope: "project-store",
        changeSetEffect: "none",
        nextCommand: "memsphere memory change validate [change-id]"
      }
    );

    const statelessHome = join(root, "missing-home");
    const statelessText = await runCli(nested, ["validate", "--memory-root", memoryRoot], statelessHome);
    assert.equal(statelessText.code, 0, statelessText.stderr);
    assert.match(statelessText.stdout, /Validation scope: stateless Memory root/);
    assert.match(statelessText.stdout, /ChangeSet: not applicable in --memory-root mode/);
    assert.doesNotMatch(statelessText.stdout, /For unpublished Memory changes/);

    const statelessJson = await runCli(
      nested,
      ["validate", "--memory-root", memoryRoot, "--format", "json"],
      statelessHome
    );
    assert.equal(statelessJson.code, 0, statelessJson.stderr);
    const payload = JSON.parse(statelessJson.stdout);
    assert.equal(payload.valid, true);
    assert.equal(payload.validationScope, "memory-root");
    assert.equal(payload.changeSetEffect, "none");
    assert.equal(Object.hasOwn(payload, "nextCommand"), false);
  });
});

test("validate suggests syntax migration only for outdated Memory YAML", async () => {
  await withScope(async ({ nested, memoryRoot }) => {
    await writeFile(
      join(memoryRoot, "schemas", "legacy.yaml"),
      "!schema\nnames: [legacy]\nelement_types: [string]\n"
    );

    const legacy = await runCli(nested, ["validate"]);
    assert.equal(legacy.code, 1);
    assert.match(legacy.stderr, /older YAML syntax with a registered migration path/);
    assert.match(legacy.stderr, /memsphere migrate syntax --check/);
    assert.match(legacy.stderr, /memsphere migrate syntax --write/);

    await writeFile(
      join(memoryRoot, "schemas", "legacy.yaml"),
      `!schema\nsyntax: ${currentMemorySyntax}\nnames: [current]\nunknown_key: true\n`
    );

    const current = await runCli(nested, ["validate"]);
    assert.equal(current.code, 1);
    assert.doesNotMatch(current.stderr, /memsphere migrate syntax/);

    await writeFile(
      join(memoryRoot, "schemas", "legacy.yaml"),
      "!schema\nsyntax: memsphere-20990101-stable\nnames: [future]\n"
    );

    const future = await runCli(nested, ["validate"]);
    assert.equal(future.code, 1);
    assert.match(future.stderr, /upgrade memsphere/i);
    assert.doesNotMatch(future.stderr, /memsphere migrate syntax/);

    await writeFile(join(memoryRoot, "schemas", "legacy.yaml"), "!schema\nnames: [Broken\n");
    const malformed = await runCli(nested, ["validate"]);
    assert.equal(malformed.code, 1);
    assert.doesNotMatch(malformed.stderr, /memsphere migrate syntax/);
  });
});

test("memory CLI lists and reads from a nested scope without exposing file paths", async () => {
  await withScope(async ({ nested, memoryRoot }) => {
    await writeFile(
      join(memoryRoot, "concepts", "random-95f2.yaml"),
      withCurrentMemorySyntax("!concept\nnames: [memory, 记忆]\ndefines:\n  - A managed memory.\n")
    );
    await writeFile(
      join(memoryRoot, "schemas", "another-random-name.yaml"),
      withCurrentMemorySyntax("!schema\nnames: [record]\ndefines: []\n")
    );

    const list = await runCli(nested, ["memory", "list"]);
    assert.equal(list.code, 0);
    assert.equal(list.stderr, "");
    const page = parse(list.stdout);
    assert.deepEqual(page.memories.map((item: { reference: string }) => item.reference), ["concepts/memory", "schemas/record"]);
    const memorySummary = page.memories.find((item: { reference: string }) => item.reference === "concepts/memory");
    assert.deepEqual(memorySummary.defines, ["A managed memory."]);
    assert.equal(memorySummary.structured_defines, undefined);
    assert.equal(page.next_cursor, null);
    assert(!list.stdout.includes("random-95f2"));
    assert(!list.stdout.includes(memoryRoot));

    const filtered = await runCli(nested, ["memory", "list", "--kind", "concepts", "--query", "记忆", "--output", "json"]);
    assert.equal(filtered.code, 0);
    const filteredPage = JSON.parse(filtered.stdout);
    assert.deepEqual(filteredPage.memories.map((item: { reference: string }) => item.reference), ["concepts/memory"]);
    assert.deepEqual(filteredPage.memories[0].defines, ["A managed memory."]);
    assert.equal(filteredPage.memories[0].structured_defines, undefined);

    for (const reference of ["concepts/memory", "memory", "记忆"]) {
      const read = await runCli(nested, ["memory", "read", reference]);
      assert.equal(read.code, 0, read.stderr);
      assert.equal(read.stderr, "");
      assert.deepEqual(parseMemoryYaml(read.stdout), {
        tag: "!concept",
        syntax: currentMemorySyntax,
        names: ["memory", "记忆"],
        defines: ["A managed memory."]
      });
    }
  });
});

test("validate checks Memory references by target kind and dependency cycles", async () => {
  await withScope(async ({ nested, memoryRoot }) => {
    await writeFile(
      join(memoryRoot, "schemas", "schema-b.yaml"),
      withCurrentMemorySyntax("!schema\nnames: [schema-b]\nfields:\n  - !ref\n    target: schemas/schema-a\n")
    );
    await writeFile(
      join(memoryRoot, "schemas", "schema.yaml"),
      withCurrentMemorySyntax("!schema\nnames: [schema-a, Schema Alias]\nfields:\n  - !ref\n    target: schemas/schema-b\n")
    );

    const cycle = await runCli(nested, ["validate"]);
    assert.equal(cycle.code, 1);
    assert.match(cycle.stderr, /Memory reference cycle detected/);

    await writeFile(
      join(memoryRoot, "schemas", "schema-b.yaml"),
      withCurrentMemorySyntax("!schema\nnames: [schema-b]\nfields: [value]\n")
    );
    await writeFile(
      join(memoryRoot, "schemas", "schema.yaml"),
      withCurrentMemorySyntax("!schema\nnames: [schema-a]\nfields:\n  - !ref\n    target: concepts/concept-a\n")
    );

    const wrongKind = await runCli(nested, ["validate"]);
    assert.equal(wrongKind.code, 1);
    assert.match(wrongKind.stderr, /expected schemas/);

    await writeFile(
      join(memoryRoot, "schemas", "schema.yaml"),
      withCurrentMemorySyntax("!schema\nnames: [schema-a]\nfields:\n  - !ref\n    target: schemas/missing\n")
    );

    const missing = await runCli(nested, ["validate"]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /schemas\/missing.*was not found/);

    await writeFile(
      join(memoryRoot, "schemas", "schema.yaml"),
      withCurrentMemorySyntax("!schema\nnames: [schema-a]\noptional: true\nfields: [summary]\n")
    );

    const invalidOptional = await runCli(nested, ["validate"]);
    assert.equal(invalidOptional.code, 1);
    assert.match(invalidOptional.stderr, /optional is only allowed on named Schema fields/);
  });
});

test("memory CLI reads recursive Statement sections without flattening them", async () => {
  await withScope(async ({ nested, memoryRoot }) => {
    await writeFile(join(memoryRoot, "statements", "repository-rules.yaml"), withCurrentMemorySyntax(`!statement
names: [repository-rules, Repository rules]
asserts: [All changes require review.]
sections:
  - !statement
    names: [Testing]
    suggests: [Prefer focused tests.]
    sections:
      - !statement
        names: [Core logic]
        asserts: [Core logic changes require tests.]
`));

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
    await writeFile(join(memoryRoot, "concepts", "memory.yaml"), withCurrentMemorySyntax("!concept\nnames: [memory, Memory]\ndefines: [A memory.]\n"));
    await writeFile(join(memoryRoot, "statements", "rules.yaml"), withCurrentMemorySyntax(`!statement
names: [rules, Rules]
asserts: [All sections apply.]
sections:
  - !statement
    names: [Testing]
    asserts: [Run tests.]
`));
    await writeFile(join(memoryRoot, "schemas", "report.yaml"), withCurrentMemorySyntax(`!schema
names: [report, Report]
fields:
  - Title
  - !repeat
    limit: { min: 1, max: 2 }
    body:
      - !schema
        names: [Item]
        fields: [Value]
`));
    await writeFile(join(memoryRoot, "procedures", "workflow.yaml"), withCurrentMemorySyntax(`!procedure
names: [workflow, Workflow]
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
`));

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
    assert.match(missing.stderr, /memsphere memory list "procedures\/workflow"/);

    const invalidCombination = await runCli(nested, ["memory", "list", "Workflow", "--query", "Workflow"]);
    assert.notEqual(invalidCombination.code, 0);
    assert.equal(invalidCombination.stdout, "");
    assert.match(invalidCombination.stderr, /cannot be used with a memory reference/);
  });
});

test("memory CLI reports ambiguity and other failures only on stderr", async () => {
  await withScope(async ({ nested, memoryRoot }) => {
    await writeFile(join(memoryRoot, "concepts", "one.yaml"), withCurrentMemorySyntax("!concept\nnames: [shared, Shared]\ndefines: []\n"));
    await writeFile(join(memoryRoot, "statements", "two.yaml"), withCurrentMemorySyntax("!statement\nnames: [shared, Shared]\nasserts: [valid]\n"));

    const ambiguous = await runCli(nested, ["memory", "read", "Shared"]);
    assert.notEqual(ambiguous.code, 0);
    assert.equal(ambiguous.stdout, "");
    assert.match(ambiguous.stderr, /test-project:concepts\/shared, test-project:statements\/shared/);

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
    await writeFile(join(memoryRoot, "schemas", "broken.yaml"), withCurrentMemorySyntax("!schema\nnames: [Broken\n"));

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
      assert.match(uninitialized.stderr, /not bound to a Primary Project/);
    } finally {
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });
});
