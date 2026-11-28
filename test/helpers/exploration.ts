import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ContextControl } from "../../src/context_control/service.js";
import { readProjectConfig, type MemsphereConfig } from "../../src/config.js";
import { openContextControl } from "../../src/project/context-control.js";
import type { ProjectConfigFile } from "../../src/project/model.js";
import { invokeCliModule } from "./cli-module.js";
import { cliModuleProcess } from "./cli-module-process.js";
import { initializedContextFixture } from "./initialized-context.js";
import { withCurrentMemorySyntax } from "./memory.js";
import { ownTestProcess } from "./owned-process.js";

const exec = promisify(execFile);
export const explorationTestCli = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
export async function explorationFixture(t: TestContext, options: {
  store?: "embedded" | "managed";
  isolatedCli?: boolean;
} = {}) {
  const f = await initializedContextFixture(t);
  const managed = options.store === "managed";
  const memory = join(f.root, "memory");
  const repository = managed ? memory : f.root;
  const cwd = managed ? f.cwd : f.root;
  const git = (...args: string[]) => {
    t.signal.throwIfAborted();
    const result = exec("git", args, { cwd: repository, timeout: 20_000, killSignal: "SIGKILL", windowsHide: true });
    ownTestProcess(result.child, t.signal, f.beforeCleanup);
    return result;
  };
  await git("init", "-b", "master");
  const commit = () => git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "Memory fixture");
  const configuration = join(f.root, "config.json");
  const configureStore = async (store: ProjectConfigFile["store"]) => {
    const project = JSON.parse(await readFile(configuration, "utf8"));
    await writeFile(configuration, JSON.stringify({ ...project, store }), { signal: t.signal });
  };
  const publishMemory = async () => {
    if (!managed) return;
    await git("add", "--", "schemas", "statements");
    await commit();
    const { stdout: revision } = await git("rev-parse", "HEAD");
    await configureStore({ type: "managed", branch: "master", published_revision: revision.trim() });
  };
  if (!managed) {
    await commit();
    await configureStore({ type: "embedded", repository_path: f.root, memory_path: "memory" });
  }
  await mkdir(join(memory, "schemas"), { recursive: true });
  await mkdir(join(memory, "statements"), { recursive: true });
  const statement = join(memory, "statements", "fact.yaml");
  await writeFile(statement, withCurrentMemorySyntax("!statement\nnames: [fact]\nasserts: [Check original fact]\nsuggests: [Explain the finding]\n"));
  const schema = join(memory, "schemas", "report.yaml");
  await writeFile(schema, withCurrentMemorySyntax("!schema\nnames: [report]\ntype: object\nformat: {layout: outline}\nfields:\n  - !schema {name: Notes, optional: true}\n  - !schema {name: Count, type: number}\n"));
  await publishMemory();
  const config = await readProjectConfig("test-project", f.home);
  await writeFile(join(f.home, "config.json"), JSON.stringify({ runner_agents: { codex: { identity_enabled: true, async_enabled: false } } }));
  const service = (await openContextControl(f.root))!;
  const cliEnv = () => ({ ...process.env, MEMSPHERE_HOME: f.home, CODEX_THREAD_ID: "free-schema-review", TRAECLI_THREAD_ID: "" });
  const worker = options.isolatedCli ? cliModuleProcess({
    cwd, env: cliEnv(), entrypoint: explorationTestCli, signal: t.signal, timeout: 20_000, beforeCleanup: f.beforeCleanup
  }) : undefined;
  let invoking: Promise<unknown> | undefined;
  f.beforeCleanup(async () => { await invoking?.catch(() => undefined); });
  const invoke = (...args: string[]) => {
    const command = ["--project", "test-project", ...args];
    if (worker) return worker.invoke(command);
    const result = invokeCliModule(command, cwd, cliEnv(), explorationTestCli, t.signal);
    invoking = result;
    return result;
  };
  const call = async (...args: string[]) => JSON.parse((await invoke(...args, "--output", "json")).stdout);
  return { ...f, config, service, invoke, call, statement, schema, publishMemory };
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
