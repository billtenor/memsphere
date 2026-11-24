import { runGit } from "../../src/git.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { readProjectConfig } from "../../src/config.js";
import { openContextControl } from "../../src/project/context-control.js";
import { invokeCliModule } from "./cli-module.js";
import { initializedContextFixture } from "./initialized-context.js";
import { withCurrentMemorySyntax } from "./memory.js";

export const explorationTestCli = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
export async function explorationFixture(t: TestContext) {
  const f = await initializedContextFixture(t);
  await runGit(["init", "-b", "master"], { cwd: f.root });
  await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "Embedded fixture"], { cwd: f.root });
  const configuration = join(f.root, "config.json");
  const project = JSON.parse(await readFile(configuration, "utf8"));
  await writeFile(configuration, JSON.stringify({ ...project, store: { type: "embedded", repository_path: f.root, memory_path: "memory" } }));
  const config = await readProjectConfig("test-project", f.home);
  await mkdir(join(config.memoryRoot, "schemas"), { recursive: true });
  await mkdir(join(config.memoryRoot, "statements"), { recursive: true });
  const statement = join(config.memoryRoot, "statements", "fact.yaml");
  await writeFile(statement, withCurrentMemorySyntax("!statement\nnames: [fact]\nasserts: [Check original fact]\nsuggests: [Explain the finding]\n"));
  const schema = join(config.memoryRoot, "schemas", "report.yaml");
  await writeFile(schema, withCurrentMemorySyntax("!schema\nnames: [report]\ntype: object\nformat: {layout: outline}\nfields:\n  - !schema {name: Notes, optional: true}\n  - !schema {name: Count, type: number}\n"));
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
  return { ...f, config, service, invoke, call, statement, schema };
}
