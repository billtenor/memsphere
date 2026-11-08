import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { projectConfigSchema } from "../src/project/model.js";


test("validateMemoryStore reports precise control_plane config paths", async () => {
  const result = projectConfigSchema.safeParse({
    store: { type: "embedded", repository_path: "/repo", memory_path: "memory" },
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
