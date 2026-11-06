import { invokeCliModule } from "./cli-module.js";
import assert from "node:assert/strict";
import { after, type TestContext } from "node:test";
import type test from "node:test";
import { cp } from "node:fs/promises";
import { businessFixture } from "./business-data.js";
import { openContextControl } from "../../src/project/context-control.js";
import * as reviews from "../../src/context_control/review-repository.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import crossSpawn from "cross-spawn";
import { createAgentReviewCliRuntime } from "../../src/acp/cli-runtime.js";
import { reviewNodeFixture } from "./review-nodes.js";
// CLI content tests start with an already bound Reviewer. Build that state once
// through real APIs; each scenario owns independent model/data byte copies.
const cleanups: Array<() => unknown> = [];
after(async () => { for (const cleanup of cleanups) await cleanup(); });
let template: ReturnType<typeof reviewNodeFixture> | undefined;
async function preparedReview(t: TestContext) {
  template ??= reviewNodeFixture({ after: cleanup => { cleanups.push(cleanup); } } as TestContext, true, false, { reuseService: true });
  const base = await template;
  const f = await businessFixture(t, {});
  for (const entry of ["config.json", "models", "data"]) await cp(join(base.root, entry), join(f.root, entry), { recursive: true });
  const service = (await openContextControl(f.root))!;
  const input = { ...base.input, runsRoot: join(f.root, "runs"), service };
  const context = await reviews.readArtifactReviewForActor(input);
  const claimed = { ...context, attempt: context.assignment.attempts!.at(-1)! };
  return { ...f, runId: base.runId, input, claimed, bound: { ...input, attemptId: claimed.attempt.id }, controlPlane: base.controlPlane };
}
export async function reviewCliFixture(t: test.TestContext, project?: {
  fixture: Awaited<ReturnType<typeof businessFixture>>;
  service: NonNullable<Awaited<ReturnType<typeof openContextControl>>>;
}) {
  // Assertions read current persisted records through one validated service.
  // Each CLI invocation still opens its own service in a separate process.
  const f = project ? await reviewNodeFixture(t, true, false, { reuseService: true, project }) : await preparedReview(t);
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
    try {
      // The native launcher binds --assignment before invoking these handlers.
      // Module tests supply that established input explicitly; launcher binding
      // and rejection continue to be covered by the native scenarios.
      const boundArgs = args[0] === "run" && args[1] === "review" && !args.includes("--assignment")
        ? [...args, "--assignment", f.claimed.assignment.id!] : args;
      result = await invokeCliModule(boundArgs, f.cwd, env, runtime.descriptor.cliEntrypoint);
    }
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
