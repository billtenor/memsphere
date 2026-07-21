import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { memoryKinds, type MemoryKind } from "../src/memory/kinds.js";
import { listMemoryFiles } from "../src/memory/store.js";
import { validateMemoryStore } from "../src/validation.js";
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

test("validateMemoryStore reports kind-scoped canonical and alias conflicts", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "config.json");
    const memoryRoot = join(dir, "memory");
    await mkdir(join(dir, "reviews"));
    await mkdir(join(dir, "runs"));
    for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
    await writeFile(configPath, `${JSON.stringify({ memoryRoot: "memory", reviewsRoot: "reviews", runsRoot: "runs" })}\n`);
    await writeFile(join(memoryRoot, "concepts", "one.yaml"), withCurrentMemorySyntax("!concept\nnames: [Memory, shared]\ndefines: []\n"));
    await writeFile(join(memoryRoot, "concepts", "two.yaml"), withCurrentMemorySyntax("!concept\nnames: [Other, shared]\ndefines: []\n"));
    await writeFile(join(memoryRoot, "concepts", "three.yaml"), withCurrentMemorySyntax("!concept\nnames: [Memory]\ndefines: []\n"));
    await writeFile(join(memoryRoot, "statements", "same-name.yaml"), withCurrentMemorySyntax("!statement\nnames: [Memory]\nasserts: [valid]\n"));

    const result = await validateMemoryStore(configPath);
    assert(result.issues.some((issue) => issue.message.includes('memory name "shared" conflicts within concepts')));
    assert(result.issues.some((issue) => issue.message.includes('memory name "Memory" conflicts within concepts')));
    assert(!result.issues.some((issue) => issue.message.includes("conflicts within statements")));
  });
});

test("validateMemoryStore reports normalized empty and repeated names with parse errors", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "config.json");
    const memoryRoot = join(dir, "memory");
    await mkdir(join(dir, "reviews"));
    await mkdir(join(dir, "runs"));
    for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
    await writeFile(configPath, `${JSON.stringify({ memoryRoot: "memory", reviewsRoot: "reviews", runsRoot: "runs" })}\n`);
    await writeFile(join(memoryRoot, "concepts", "names.yaml"), withCurrentMemorySyntax("!concept\nnames: [' Memory ', Memory, ' ']\ndefines: []\n"));
    await writeFile(join(memoryRoot, "schemas", "broken.yaml"), withCurrentMemorySyntax("!schema\nnames: [Broken\n"));

    const result = await validateMemoryStore(configPath);
    assert(result.issues.some((issue) => issue.message.includes('repeats the normalized name "Memory"')));
    assert(result.issues.some((issue) => issue.message.includes("alias at names[2] is empty")));
    assert(result.issues.some((issue) => issue.path.endsWith("broken.yaml")));
  });
});

for (const missingKind of memoryKinds) {
  test(`validateMemoryStore still reports missing ${missingKind} directory`, async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "config.json");
      const memoryRoot = join(dir, "memory");
      await mkdir(memoryRoot);
      await mkdir(join(dir, "reviews"));
      await mkdir(join(dir, "runs"));

      for (const kind of memoryKinds) {
        if (kind !== missingKind) {
          await mkdir(join(memoryRoot, kind));
        }
      }

      await writeFile(configPath, `${JSON.stringify({ memoryRoot: "memory", reviewsRoot: "reviews", runsRoot: "runs" })}\n`);

      const result = await validateMemoryStore(configPath);
      assert(result.issues.some((issue) =>
        issue.path === join(memoryRoot, missingKind as MemoryKind) &&
        issue.message === "memory kind directory does not exist"
      ));
    });
  });
}

test("validateMemoryStore reports precise control_plane config paths", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      memoryRoot: "memory",
      control_plane: {
        identities: {},
        roles: {
          runner: {
            name: "Runner",
            permissions: ["artifact.delete"]
          }
        }
      }
    }));

    const result = await validateMemoryStore(configPath);
    assert(result.issues.some((issue) =>
      issue.path === `${configPath}#control_plane.roles.runner.permissions[0]` &&
      issue.message.includes("Unknown Permission")
    ));
  });
});

test("validateMemoryStore joins Procedure and Artifact governance with control_plane", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "config.json");
    const memoryRoot = join(dir, "memory");
    await mkdir(join(dir, "reviews"));
    await mkdir(join(dir, "runs"));
    for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      memoryRoot: "memory",
      reviewsRoot: "reviews",
      runsRoot: "runs",
      control_plane: {
        identities: { human: { kind: "human", name: "Human" } },
        roles: {
          runner: { name: "Runner", permissions: ["artifact.submit"] },
          reviewer: { name: "Reviewer", permissions: ["artifact.read"] }
        }
      }
    }));
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
      role_bindings:
        reviewer: missing-identity
      permission_grants:
        runner: [decision.decide]
`));

    const result = await validateMemoryStore(configPath);
    assert(result.issues.some((issue) => issue.path.endsWith("#root.role_bindings.missing-role") && issue.message === "unknown Role id"));
    assert(result.issues.some((issue) => issue.path.endsWith("#flow[0].artifact.role_bindings.reviewer[0]") && issue.message.includes("missing-identity")));
    assert(result.issues.some((issue) => issue.path.endsWith("#flow[0].artifact.permission_grants.runner[0]") && issue.message.includes("exceeds grantable_permissions")));
  });
});

test("validateMemoryStore requires control_plane only when governance syntax is used", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "config.json");
    const memoryRoot = join(dir, "memory");
    await mkdir(join(dir, "reviews"));
    await mkdir(join(dir, "runs"));
    for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
    await writeFile(configPath, JSON.stringify({ memoryRoot: "memory", reviewsRoot: "reviews", runsRoot: "runs" }));
    await writeFile(join(memoryRoot, "procedures", "governed.yaml"), withCurrentMemorySyntax(`!procedure
name: governed
role_bindings: { reviewer: human }
flow: []
`));

    const result = await validateMemoryStore(configPath);
    assert(result.issues.some((issue) =>
      issue.path.endsWith("governed.yaml#root") && issue.message.includes("control_plane config is required")
    ));
  });
});
