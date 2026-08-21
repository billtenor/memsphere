import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { memoryKinds, type MemoryKind } from "../src/memory/kinds.js";
import { listMemoryFiles, readMemoryFile, readMemoryFileSummary } from "../src/memory/store.js";
import { projectConfigSchema } from "../src/project/model.js";
import { validateMemoryRoot } from "../src/validation.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-test-"));

  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("listMemoryFiles treats any missing memory kind directory as empty", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    await mkdir(memoryRoot);

    for (const kind of memoryKinds) {
      assert.deepEqual(await listMemoryFiles(memoryRoot, kind), [], kind);
    }
  });
});

test("listMemoryFiles keeps yaml filtering and sorting for existing directories", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    const proceduresRoot = join(memoryRoot, "procedures");
    await mkdir(proceduresRoot, { recursive: true });
    await mkdir(join(proceduresRoot, "nested"));
    await writeFile(join(proceduresRoot, "b.yml"), withCurrentMemorySyntax("!procedure\nnames: [b]\nflow: []\n"));
    await writeFile(join(proceduresRoot, "a.yaml"), withCurrentMemorySyntax("!procedure\nnames: [a]\nflow: []\n"));
    await writeFile(join(proceduresRoot, "note.txt"), "not a memory\n");
    await writeFile(join(proceduresRoot, "nested", "c.yaml"), withCurrentMemorySyntax("!procedure\nnames: [c]\nflow: []\n"));

    assert.deepEqual(await listMemoryFiles(memoryRoot, "procedures"), [
      join(proceduresRoot, "a.yaml"),
      join(proceduresRoot, "b.yml")
    ]);
  });
});

test("readMemoryFileSummary falls back to full parsing for quoted name keys", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "quoted.yaml");
    await writeFile(path, withCurrentMemorySyntax(`!concept
"names": [quoted-memory, Quoted Memory]
defines: [valid]
`));

    assert.deepEqual((await readMemoryFile("concepts", path)).entity.names, ["quoted-memory", "Quoted Memory"]);
    assert.deepEqual((await readMemoryFileSummary("concepts", path)).names, ["quoted-memory", "Quoted Memory"]);
  });
});

test("readMemoryFileSummary validates the root tag and logical names without parsing the body", async () => {
  await withTempDir(async (dir) => {
    const wrongTag = join(dir, "wrong-tag.yaml");
    const invalidCanonical = join(dir, "invalid-canonical.yaml");
    const invalidAlias = join(dir, "invalid-alias.yaml");
    const brokenBody = join(dir, "broken-body.yaml");
    await writeFile(wrongTag, withCurrentMemorySyntax("!statement\nnames: [valid-name]\nasserts: [valid]\n"));
    await writeFile(invalidCanonical, withCurrentMemorySyntax("!concept\nnames: [InvalidName]\ndefines: [valid]\n"));
    await writeFile(invalidAlias, withCurrentMemorySyntax("!concept\nnames: [valid-name, ' bad ']\ndefines: [valid]\n"));
    await writeFile(brokenBody, withCurrentMemorySyntax("!concept\nnames: [valid-name, Valid name]\ndefines: [\n"));

    await assert.rejects(readMemoryFileSummary("concepts", wrongTag), /Expected !concept Memory tag/);
    await assert.rejects(readMemoryFileSummary("concepts", invalidCanonical), /lowercase ASCII kebab-case/);
    await assert.rejects(readMemoryFileSummary("concepts", invalidAlias), /leading or trailing whitespace/);
    assert.deepEqual((await readMemoryFileSummary("concepts", brokenBody)).names, ["valid-name", "Valid name"]);
  });
});

test("validateMemoryStore reports kind-scoped canonical and alias conflicts", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
    await writeFile(join(memoryRoot, "concepts", "one.yaml"), withCurrentMemorySyntax("!concept\nnames: [memory, shared]\ndefines: []\n"));
    await writeFile(join(memoryRoot, "concepts", "two.yaml"), withCurrentMemorySyntax("!concept\nnames: [other, shared]\ndefines: []\n"));
    await writeFile(join(memoryRoot, "concepts", "three.yaml"), withCurrentMemorySyntax("!concept\nnames: [memory]\ndefines: []\n"));
    await writeFile(join(memoryRoot, "statements", "same-name.yaml"), withCurrentMemorySyntax("!statement\nnames: [memory]\nasserts: [valid]\n"));

    const result = await validateMemoryRoot(memoryRoot);
    assert(result.issues.some((issue) => issue.message.includes('memory name "shared" conflicts within concepts')));
    assert(result.issues.some((issue) => issue.message.includes('memory name "memory" conflicts within concepts')));
    assert(!result.issues.some((issue) => issue.message.includes("conflicts within statements")));
  });
});

test("validateMemoryStore rejects non-canonical names and malformed aliases with parse errors", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
    await writeFile(join(memoryRoot, "concepts", "names.yaml"), withCurrentMemorySyntax("!concept\nnames: [' Memory ', Memory, ' ']\ndefines: []\n"));
    await writeFile(join(memoryRoot, "schemas", "broken.yaml"), withCurrentMemorySyntax("!schema\nnames: [Broken\n"));

    const result = await validateMemoryRoot(memoryRoot);
    assert(result.issues.some((issue) => issue.message.includes("canonical Memory name must use lowercase ASCII kebab-case")));
    assert(result.issues.some((issue) => issue.message.includes("Memory alias must not contain leading or trailing whitespace")));
    assert(result.issues.some((issue) => issue.path.endsWith("broken.yaml")));
  });
});

for (const missingKind of memoryKinds) {
  test(`validateMemoryStore still reports missing ${missingKind} directory`, async () => {
    await withTempDir(async (dir) => {
      const memoryRoot = join(dir, "memory");
      await mkdir(memoryRoot);

      for (const kind of memoryKinds) {
        if (kind !== missingKind) {
          await mkdir(join(memoryRoot, kind));
        }
      }

      const result = await validateMemoryRoot(memoryRoot);
      assert(result.issues.some((issue) =>
        issue.path === join(memoryRoot, missingKind as MemoryKind) &&
        issue.message === "memory kind directory does not exist"
      ));
    });
  });
}

test("validateMemoryStore reports precise control_plane config paths", async () => {
  const result = projectConfigSchema.safeParse({
    store: { type: "embedded", memory_path: "memory" },
    control_plane: {
      runner: { permissions: ["artifact.delete"] },
      actors: {}
    }
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert(result.error.issues.some((issue) =>
      issue.path.join(".") === "control_plane.runner.permissions.0" &&
      issue.message.includes("Unknown Permission")
    ));
  }
});

test("validateMemoryStore rejects removed Procedure governance fields", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
    const procedurePath = join(memoryRoot, "procedures", "governed.yaml");
    await writeFile(procedurePath, withCurrentMemorySyntax(`!procedure
name: governed
role_bindings:
  missing-role: human
flow:
  - !action
    action: Produce a result.
    artifact: !artifact
      name: result
      review: [reviewer]
`));

    const result = await validateMemoryRoot(memoryRoot);
    assert(result.issues.some((issue) =>
      issue.path.endsWith("governed.yaml") && issue.message.includes("role_bindings")
    ));
  });
});

test("validateMemoryStore accepts Review Slots without control_plane", async () => {
  await withTempDir(async (dir) => {
    const memoryRoot = join(dir, "memory");
    for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
    await writeFile(join(memoryRoot, "procedures", "governed.yaml"), withCurrentMemorySyntax(`!procedure
name: governed
flow:
  - !action
    action: Produce.
    artifact: !artifact
      name: result
      review: [reviewer]
`));

    const result = await validateMemoryRoot(memoryRoot);
    assert.equal(result.issues.length, 0);
  });
});
