import { gitOutput, runGit } from "../../src/git.js";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import type { ContextControl } from "../../src/context_control/service.js";
import { readProjectConfig, type MemsphereConfig } from "../../src/config.js";
import { openContextControl } from "../../src/project/context-control.js";
import { invokeCliModule } from "./cli-module.js";
import { initializedContextFixture } from "./initialized-context.js";
import { withCurrentMemorySyntax } from "./memory.js";

export const explorationTestCli = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
export async function explorationFixture(t: TestContext) {
  const f = await initializedContextFixture(t);
  const configuration = join(f.root, "config.json");
  const memoryRoot = join(f.root, "memory");
  await mkdir(join(memoryRoot, "schemas"), { recursive: true });
  await mkdir(join(memoryRoot, "statements"), { recursive: true });
  await runGit(["init", "-b", "master"], { cwd: memoryRoot });
  const statement = join(memoryRoot, "statements", "fact.yaml");
  await writeFile(statement, withCurrentMemorySyntax("!statement\nnames: [fact]\nasserts: [Check original fact]\nsuggests: [Explain the finding]\n"));
  const schema = join(memoryRoot, "schemas", "report.yaml");
  await writeFile(schema, withCurrentMemorySyntax("!schema\nnames: [report]\ntype: object\nformat: {layout: outline}\nfields:\n  - !schema {name: Notes, optional: true}\n  - !schema {name: Count, type: number}\n"));
  // These tests exercise exploration with published Memory. Embedded worktree
  // resolution and binding validation have their own integration coverage.
  const publishMemory = async () => {
    await runGit(["add", "--", "schemas", "statements"], { cwd: memoryRoot });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "Publish fixture Memory"], { cwd: memoryRoot });
    const revision = await gitOutput(["rev-parse", "HEAD"], memoryRoot);
    const current = JSON.parse(await readFile(configuration, "utf8"));
    await writeFile(configuration, JSON.stringify({ ...current, store: { type: "managed", branch: "master", published_revision: revision } }));
    return readProjectConfig("test-project", f.home);
  };
  const config = await publishMemory();
  const writePublishedMemory = async (path: string, content: string) => {
    await writeFile(path, content);
    Object.assign(config, await publishMemory());
  };
  await writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: { codex: { identity_enabled: true, async_enabled: false } } }));
  const service = (await openContextControl(f.root))!;
  let invoking: Promise<unknown> | undefined;
  f.beforeCleanup(async () => { await invoking?.catch(() => undefined); });
  const invoke = (...args: string[]) => {
    const command = invokeCliModule(["--project", "test-project", ...args], f.root,
      { ...process.env, MEMSPHERE_HOME: f.home, CODEX_THREAD_ID: "free-schema-review", TRAECLI_THREAD_ID: "" }, explorationTestCli, t.signal);
    invoking = command;
    return command;
  };
  const call = async (...args: string[]) => JSON.parse((await invoke(...args, "--output", "json")).stdout);
  return { ...f, config, service, invoke, call, statement, schema, writePublishedMemory };
}

export function delegatedReviewConfig(config: MemsphereConfig, env: Record<string, string> = {}, mode = "approve"): MemsphereConfig {
  return { ...config, controlPlane: { runner: { permissions: ["artifact.read", "decision.decide"] }, actors: {
    reader: { kind: "agent", name: "Reader", permissions: ["artifact.read", "decision.assess"], agent: {
      provider: "test", providerType: "codex", command: process.execPath,
      args: [fileURLToPath(new URL("../fixtures/fake-acp-reviewer.mjs", import.meta.url)), mode],
      env, startupTimeoutMs: 10000, idleTimeoutMs: 20000, maxRuntimeMs: null
    } }
  }, acpProviders: {} } };
}

export async function writeFixtureSchema(service: ContextControl, draft: Awaited<ReturnType<ContextControl["enterExplorationSchema"]>>) {
  const title = await service.writeExplorationSchema(draft.runId, draft.stepId, "report", draft.position, "# Report");
  const notes = await service.writeExplorationSchema(draft.runId, draft.stepId, "skip", title.position);
  const written = await service.writeExplorationSchema(draft.runId, draft.stepId, "report", notes.position, "42");
  assert.equal(written.phase, "awaiting_finalization");
}
