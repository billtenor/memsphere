import assert from "node:assert/strict";
import test from "node:test";
import { projectConfigSchema } from "../src/project/model.js";


test("Embedded Project config requires an absolute repository and relative Memory path", () => {
  assert.equal(projectConfigSchema.safeParse({
    store: { type: "embedded", repository_path: "/repo", memory_path: ".memsphere/memory" }
  }).success, true);
  assert.equal(projectConfigSchema.safeParse({
    store: { type: "embedded", memory_path: "/repo/.memsphere/memory" }
  }).success, false);
  for (const memoryPath of ["/absolute", "../escape", "nested/../memory", "nested\\memory"]) {
    assert.equal(projectConfigSchema.safeParse({
      store: { type: "embedded", repository_path: "/repo", memory_path: memoryPath }
    }).success, false, memoryPath);
  }
});
