import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { partitionTests } from "../scripts/test-plan.mjs";

test("CI shards cover every test file exactly once, including unmeasured new tests", async () => {
  const files = (await readdir("test")).filter(file => file.endsWith(".test.ts"));
  const durations = JSON.parse(await readFile("scripts/test-durations.json", "utf8"));
  const input = [...files, "unmeasured-new-feature.test.ts"];
  const groups = partitionTests(input, durations, 4);
  const assigned = groups.flatMap(group => group.files);
  assert.deepEqual([...assigned].sort(), [...input].sort());
  assert.equal(new Set(assigned).size, input.length);
  assert.deepEqual(partitionTests([...input].reverse(), durations, 4), groups);
  const weights = groups.map(group => group.seconds);
  assert(Math.max(...weights) - Math.min(...weights) <= 2, "Historical workload is balanced");
});

test("Longest-first partitioning avoids putting every expensive file in one shard", () => {
  const groups = partitionTests(["a", "b", "c", "d", "new"], { a: 80, b: 70, c: 30, d: 20 }, 2);
  assert.deepEqual(groups.map(group => group.seconds), [102, 100]);
  assert.throws(() => partitionTests([], {}, 0), /positive integer/);
  assert.throws(() => partitionTests([], {}, 1.5), /positive integer/);
});
