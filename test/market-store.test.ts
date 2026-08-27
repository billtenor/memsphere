import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { listMemoryMarket, planMemoryMarketImport } from "../src/market/store.js";
import { memoryKinds } from "../src/memory/kinds.js";
import { readBundledMarketMemories } from "../src/reserved/store.js";

async function withMemoryRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "memsphere-market-test-"));
  try {
    for (const kind of memoryKinds) await mkdir(join(root, kind), { recursive: true });
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("market import plans only the selected Memory when it has no explicit Memory references", async () => {
  await withMemoryRoot(async (root) => {
    const reference = "procedures/memsphere-agile-requirement-development";
    const emptyPlan = await planMemoryMarketImport(root, reference);
    assert.equal(emptyPlan.item.status, "not_imported");
    assert.deepEqual(emptyPlan.targets.map((target) => target.reference), [reference]);
  });
});

test("market import includes dependencies required by a selected Procedure", async () => {
  await withMemoryRoot(async (root) => {
    const plan = await planMemoryMarketImport(root, "procedures/code-branch-review-and-remediation");
    assert.deepEqual(plan.targets.map((target) => target.reference), [
      "procedures/code-branch-review-and-remediation",
      "statements/memsphere-repository-development-rules",
      "statements/memsphere-repository-testing-rules"
    ]);
  });
});

test("market state compares current canonical Memory by raw file bytes", async () => {
  await withMemoryRoot(async (root) => {
    const bundled = (await readBundledMarketMemories())[0];
    await writeFile(join(root, bundled.path), bundled.source);
    let item = (await listMemoryMarket(root)).find((candidate) => candidate.reference === bundled.reference);
    assert.equal(item?.status, "consistent");

    await writeFile(join(root, bundled.path), Buffer.concat([bundled.source, Buffer.from("\n")]));
    item = (await listMemoryMarket(root)).find((candidate) => candidate.reference === bundled.reference);
    assert.equal(item?.status, "different");
  });
});

test("renaming a market Memory detaches it from the market item", async () => {
  await withMemoryRoot(async (root) => {
    const bundled = (await readBundledMarketMemories())[0]!;
    const renamed = renameBundledMemory(bundled, []);
    await writeFile(join(root, bundled.kind, "personalized-market-memory.yaml"), renamed);
    const item = (await listMemoryMarket(root)).find((candidate) => candidate.reference === bundled.reference);
    assert.equal(item?.status, "not_imported");
  });
});

test("retaining a market canonical name as an alias reports a name conflict", async () => {
  await withMemoryRoot(async (root) => {
    const bundled = (await readBundledMarketMemories())[0]!;
    const renamed = renameBundledMemory(bundled, [bundled.names[0]!]);
    await writeFile(join(root, bundled.kind, "personalized-market-memory.yaml"), renamed);
    const item = (await listMemoryMarket(root)).find((candidate) => candidate.reference === bundled.reference);
    assert.equal(item?.status, "name_conflict");
  });
});

function renameBundledMemory(
  bundled: { source: Buffer; names: string[] },
  aliases: string[]
): string {
  return bundled.source.toString("utf8").replaceAll("\r\n", "\n").replace(
    /names:\n(?:  - .*\n)+/,
    ["names:", "  - personalized-market-memory", ...aliases.map((alias) => `  - ${alias}`), ""].join("\n")
  );
}

test("market import reuses an existing personalized dependency without overwriting it", async () => {
  await withMemoryRoot(async (root) => {
    const dependency = (await readBundledMarketMemories()).find(
      (item) => item.reference === "statements/memsphere-repository-development-rules"
    );
    assert(dependency);
    await writeFile(join(root, dependency.path), Buffer.concat([dependency.source, Buffer.from("\n# personalized\n")]));
    const plan = await planMemoryMarketImport(root, "procedures/code-branch-review-and-remediation");
    assert.deepEqual(plan.targets.map((target) => target.reference), [
      "procedures/code-branch-review-and-remediation",
      "statements/memsphere-repository-testing-rules"
    ]);
  });
});

test("unrelated invalid Memory does not block market listing or import planning", async () => {
  await withMemoryRoot(async (root) => {
    await writeFile(join(root, "concepts", "broken.yaml"), "!concept\nnames: [\n");

    const market = await listMemoryMarket(root);
    assert(market.length > 0);
    const plan = await planMemoryMarketImport(root, "procedures/memsphere-agile-requirement-development");
    assert.deepEqual(plan.targets.map((target) => target.reference), [
      "procedures/memsphere-agile-requirement-development"
    ]);

    const bundled = (await readBundledMarketMemories())[0]!;
    await writeFile(join(root, bundled.kind, "broken-conflict.yaml"), [
      `!${bundled.kind.slice(0, -1)}`,
      "names:",
      "  - broken-conflict",
      `  - ${bundled.names[0]}`,
      "defines: ["
    ].join("\n"));
    const conflicted = (await listMemoryMarket(root)).find((item) => item.reference === bundled.reference);
    assert.equal(conflicted?.status, "name_conflict");
  });
});
