import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readConfigAt } from "../src/config.js";
import { projectConfigSchema } from "../src/project/model.js";

test("legacy Scope config and split roots are not accepted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-config-test-"));
  try {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      memoryRoot: "memory",
      reviewsRoot: "reviews",
      runsRoot: "runs",
      archiveRoot: "archives"
    }));

    await assert.rejects(readConfigAt(configPath), /legacy Scope config is not supported/);
    assert.equal(projectConfigSchema.safeParse(JSON.parse(await readFile(configPath, "utf8"))).success, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
