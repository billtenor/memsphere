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
      "statements/memsphere-repository-development-rules"
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
