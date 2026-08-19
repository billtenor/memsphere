import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultMemoryCatalog, MemoryAmbiguityError } from "../src/memory/catalog.js";
import { ProjectMemoryProvider } from "../src/memory/project-provider.js";
import { currentStep, startRun } from "../src/run/store.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

const memory = (name: string) => withCurrentMemorySyntax(`!concept\nnames: [${name}]\ndefines: [${name} definition]\n`);

test("Project Memory provider annotates sources and rejects cross-Project ambiguity", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-project-provider-"));
  try {
    const primary = join(root, "primary");
    const mounted = join(root, "mounted");
    await mkdir(join(primary, "concepts"), { recursive: true });
    await mkdir(join(mounted, "concepts"), { recursive: true });
    await writeFile(join(primary, "concepts", "shared.yaml"), memory("Shared"));
    await writeFile(join(primary, "concepts", "local.yaml"), memory("Local"));
    await writeFile(join(mounted, "concepts", "shared.yaml"), memory("Shared"));
    const catalog = new DefaultMemoryCatalog(new ProjectMemoryProvider([
      { name: "primary", memoryRoot: primary, revision: "aaa" },
      { name: "career", memoryRoot: mounted, revision: "bbb" }
    ]));
    const listed = await catalog.list({ kind: "concepts" });
    assert.deepEqual(listed.memories.map((item) => item.project_name), ["primary", "career", "primary"]);
    assert.equal((await catalog.read("Local")).names[0], "Local");
    await assert.rejects(catalog.read("Shared"), (error) => {
      assert(error instanceof MemoryAmbiguityError);
      assert.match(error.message, /primary:concepts\/Shared/);
      assert.match(error.message, /career:concepts\/Shared/);
      assert.match(error.message, /--project/);
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run freezes the selected Project and resolves dependencies inside that Project", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-project-run-"));
  try {
    const primary = join(root, "primary");
    const mounted = join(root, "mounted");
    const runsRoot = join(root, "runs");
    for (const memoryRoot of [primary, mounted]) {
      await mkdir(join(memoryRoot, "procedures"), { recursive: true });
      await mkdir(join(memoryRoot, "schemas"), { recursive: true });
    }
    await writeFile(join(primary, "schemas", "delivery.yaml"), withCurrentMemorySyntax(`!schema
names: [delivery]
fields: [primary-only]
`));
    await writeFile(join(mounted, "schemas", "delivery.yaml"), withCurrentMemorySyntax(`!schema
names: [delivery]
fields: [mounted-only]
`));
    await writeFile(join(mounted, "procedures", "deliver.yaml"), withCurrentMemorySyntax(`!procedure
names: [deliver]
flow:
  - !action
    action: Deliver from mounted memory.
    artifact: !artifact
      name: result
      type: object
      format:
        name: markdown
        layout: outline
      schema: delivery
`));
    const sources = [
      { name: "primary", memoryRoot: primary, revision: "aaa" },
      { name: "career", memoryRoot: mounted, revision: "bbb" }
    ];
    const combined = new DefaultMemoryCatalog(new ProjectMemoryProvider(sources));
    const scoped = Object.fromEntries(sources.map((source) => [
      source.name,
      new DefaultMemoryCatalog(new ProjectMemoryProvider([source]))
    ]));
    const run = await startRun({
      name: "Project-scoped delivery",
      memoryRoot: primary,
      runsRoot,
      procedureName: "deliver",
      memoryCatalog: combined,
      projectMemoryCatalogs: scoped,
      memoryProjects: {
        primary: { name: "primary", revision: "aaa" },
        mounted: [{ name: "career", revision: "bbb" }]
      }
    });
    const fields = currentStep(run)?.schema?.node?.fields;
    assert.deepEqual(fields, ["mounted-only"]);
    await writeFile(join(mounted, "schemas", "delivery.yaml"), withCurrentMemorySyntax(`!schema
names: [delivery]
fields: [changed-after-start]
`));
    assert.deepEqual(currentStep(run)?.schema?.node?.fields, ["mounted-only"]);
    assert.deepEqual(run.memoryProjects?.mounted, [{ name: "career", revision: "bbb" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
