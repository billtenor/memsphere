import { invokeCliModule } from "./cli-module.js";
import assert from "node:assert/strict";
import type test from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import crossSpawn from "cross-spawn";
import { createAgentReviewCliRuntime } from "../../src/acp/cli-runtime.js";
import { reviewNodeFixture } from "./review-nodes.js";
export async function reviewCliFixture(t: test.TestContext) {
  // Assertions read current persisted records through one validated service.
  // Each CLI invocation still opens its own service in a separate process.
  const f = await reviewNodeFixture(t, true, false, { reuseService: true });
  const runtime = await createAgentReviewCliRuntime({ nodeExecutable: process.execPath, cliEntrypoint: fileURLToPath(new URL("../../dist/cli.js", import.meta.url)) });
  t.after(() => runtime.cleanup());
  const env = { ...process.env, MEMSPHERE_HOME: f.home, MEMSPHERE_CONFIG_PATH: join(f.root, "config.json"), MEMSPHERE_WORKSPACE_ROOT: f.cwd, MEMSPHERE_REVIEW_RUN_ID: f.runId, MEMSPHERE_REVIEW_ASSIGNMENT_ID: f.claimed.assignment.id!, MEMSPHERE_REVIEW_ATTEMPT_ID: f.bound.attemptId };
  const cli = (args: string[], ok = true) => {
    const r = crossSpawn.sync(runtime.launcherPath, args, { cwd: f.cwd, env, encoding: "utf8" });
    if (ok) assert.equal(r.status, 0, r.stderr + r.stdout); else assert.notEqual(r.status, 0, r.stdout);
    return ok ? JSON.parse(r.stdout) : r.stderr + r.stdout;
  };
  const moduleCli = async (args: string[], ok = true) => {
    let result;
    try { result = await invokeCliModule(args, f.cwd, env, runtime.descriptor.cliEntrypoint); }
    catch (error) {
      if (ok) throw error;
      const failure = error as Error & { stderr?: string; stdout?: string };
      return (failure.stderr ?? failure.message) + (failure.stdout ?? "");
    }
    assert.equal(ok, true, "command unexpectedly accepted invalid content");
    return JSON.parse(result.stdout);
  };
  return { ...f, cli, moduleCli, env };
}
