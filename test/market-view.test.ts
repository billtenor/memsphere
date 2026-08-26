import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readProjectConfig } from "../src/config.js";
import { projectCreateCommand } from "../src/commands/project.js";
import { createViewServer } from "../src/commands/view.js";
import { runGit } from "../src/git.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";

test("Memory Market View API creates one active ChangeSet, exposes importing, and rejects name conflicts", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-market-view-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const gitConfig = join(fixture, "gitconfig");
  const previous = {
    cwd: process.cwd(),
    home: process.env.MEMSPHERE_HOME,
    project: process.env.MEMSPHERE_PROJECT,
    gitConfig: process.env.GIT_CONFIG_GLOBAL
  };
  try {
    await mkdir(workspace);
    await writeFile(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    process.env.MEMSPHERE_HOME = home;
    process.env.MEMSPHERE_PROJECT = "market-view";
    await runGit(["init", "-b", "master"], { cwd: workspace });
    process.chdir(workspace);
    await projectCreateCommand("market-view", { bind: true });
    const config = await readProjectConfig("market-view", home);
    const server = createViewServer(config);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const initial = await marketPayload(origin);
      assert(initial.memories.some((item) => item.reference === "statements/memsphere-general-testing-rules" && item.status === "not_imported"));

      const first = await importMarket(origin, "statements", "memsphere-general-testing-rules");
      assert.equal(first.response.status, 201);
      const second = await importMarket(origin, "statements", "memsphere-general-delivery-rules");
      assert.equal(second.response.status, 201);
      assert.equal(second.payload.change.id, first.payload.change.id);

      const importing = await marketPayload(origin);
      for (const reference of [
        "statements/memsphere-general-testing-rules",
        "statements/memsphere-general-delivery-rules"
      ]) {
        const item = importing.memories.find((candidate) => candidate.reference === reference);
        assert.equal(item?.status, "importing");
        assert.equal(item?.changeId, first.payload.change.id);
      }
      const ordinary = await fetch(`${origin}/api/memories`).then((response) => response.json()) as {
        memories: Array<{ id: string }>;
      };
      assert.equal(ordinary.memories.some((memory) => memory.id === "statements/memsphere-general-testing-rules"), false);

      await writeFile(
        join(config.memoryRoot, "statements", "personalized-conflict.yaml"),
        `!statement\nsyntax: ${currentMemorySyntax}\nnames:\n  - personalized-conflict\n  - memsphere-general-development-rules\nasserts:\n  - Personalized.\n`
      );
      const conflict = await importMarket(origin, "statements", "memsphere-general-development-rules");
      assert.equal(conflict.response.status, 409);
      assert.equal(conflict.payload.code, "market_name_conflict");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previous.home;
    if (previous.project === undefined) delete process.env.MEMSPHERE_PROJECT;
    else process.env.MEMSPHERE_PROJECT = previous.project;
    if (previous.gitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous.gitConfig;
    await rm(fixture, { recursive: true, force: true });
  }
});

async function marketPayload(origin: string): Promise<{
  memories: Array<{ reference: string; status: string; changeId?: string }>;
}> {
  const response = await fetch(`${origin}/api/market/memories`);
  if (response.status !== 200) assert.fail(await response.text());
  return response.json() as Promise<{
    memories: Array<{ reference: string; status: string; changeId?: string }>;
  }>;
}

async function importMarket(origin: string, kind: string, name: string): Promise<{
  response: Response;
  payload: { change: { id: string }; code?: string };
}> {
  const response = await fetch(`${origin}/api/market/memories/${kind}/${name}/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operator: { kind: "browser", id: "00000000-0000-4000-8000-000000000001" } })
  });
  return {
    response,
    payload: await response.json() as { change: { id: string }; code?: string }
  };
}
