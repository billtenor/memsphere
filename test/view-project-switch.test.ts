import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import type { MemsphereConfig } from "../src/config.js";
import { createViewServer } from "../src/commands/view.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

test("View keeps Project selection in the URL and isolates concurrent Project requests", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-view-projects-"));
  const home = join(fixture, "home");
  const previousHome = process.env.MEMSPHERE_HOME;
  try {
    process.env.MEMSPHERE_HOME = home;
    const roots = { alpha: join(home, "projects", "alpha"), beta: join(home, "projects", "beta") };
    for (const [name, root] of Object.entries(roots)) {
      await mkdir(join(root, "memory", "concepts"), { recursive: true });
      for (const directory of ["changes", "runs", "archives", ".runtime"]) {
        await mkdir(join(root, directory), { recursive: true });
      }
      await writeFile(join(root, "project.json"), `${JSON.stringify({
        format_version: 1,
        name,
        created_at: "2026-08-17T00:00:00.000Z"
      }, null, 2)}\n`);
      await writeFile(join(root, "config.json"), `${JSON.stringify({
        store: { type: "managed", branch: "master", published_revision: `${name}-revision` }
      }, null, 2)}\n`);
      await writeFile(
        join(root, "memory", "concepts", `${name}.yaml`),
        withCurrentMemorySyntax(`!concept\nnames: [${name}-memory]\ndefines: [${name}]\n`)
      );
    }
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "registry.json"), `${JSON.stringify({
      format_version: 1,
      projects: {
        alpha: { root: roots.alpha },
        beta: { root: roots.beta }
      },
      workspaces: {}
    }, null, 2)}\n`);
    await writeFile(join(home, "config.json"), "{}\n");

    const server = createViewServer(projectConfig(home, "alpha", roots.alpha));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const browser = await chromium.launch({ headless: true });
    try {
      assert.deepEqual(await memoryNames(origin, "alpha"), ["alpha-memory"]);
      assert.deepEqual(await memoryNames(origin, "beta"), ["beta-memory"]);
      const [page, betaPage] = await Promise.all([browser.newPage(), browser.newPage()]);
      await Promise.all([
        page.goto(`${origin}/projects/alpha/memories`, { waitUntil: "networkidle" }),
        betaPage.goto(`${origin}/projects/beta/memories`, { waitUntil: "networkidle" })
      ]);
      await Promise.all([
        page.getByRole("button", { name: /alpha-memory/ }).waitFor(),
        betaPage.getByRole("button", { name: /beta-memory/ }).waitFor()
      ]);
      await page.locator("#view-shell-project-trigger").click();
      await page.locator("#view-shell-project-menu").getByRole("menuitem", { name: "beta", exact: true }).click();
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: /beta-memory/ }).waitFor();
      assert.equal(new URL(page.url()).pathname, "/projects/beta/memories");
      assert.equal(new URL(betaPage.url()).pathname, "/projects/beta/memories");

      const interleaved = await Promise.all(Array.from({ length: 12 }, (_, index) => (
        memoryNames(origin, index % 2 === 0 ? "alpha" : "beta")
      )));
      assert.deepEqual(interleaved, Array.from({ length: 12 }, (_, index) => (
        [`${index % 2 === 0 ? "alpha" : "beta"}-memory`]
      )));

      const legacyWrite = await fetch(`${origin}/api/projects/select`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "alpha" })
      });
      assert.equal(legacyWrite.status, 400);
      assert.equal((await legacyWrite.json() as { code: string }).code, "project_scope_required");
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    if (previousHome === undefined) delete process.env.MEMSPHERE_HOME;
    else process.env.MEMSPHERE_HOME = previousHome;
    await rm(fixture, { recursive: true, force: true });
  }
});

function projectConfig(home: string, name: string, root: string): MemsphereConfig {
  return {
    configPath: join(root, "config.json"),
    scopeRoot: root,
    homeRoot: home,
    language: "zh-CN",
    memoryRoot: join(root, "memory"),
    runsRoot: join(root, "runs"),
    archiveRoot: join(root, "archives"),
    debug: { agentReview: false, root: join(home, ".runtime", "debug") },
    view: { host: "127.0.0.1", port: 0 },
    project: {
      name,
      store: { type: "managed", branch: "master", published_revision: `${name}-revision` },
      mounted: []
    }
  };
}

async function memoryNames(origin: string, projectId: string): Promise<string[]> {
  const response = await fetch(`${origin}/api/projects/${encodeURIComponent(projectId)}/memories`);
  const payload = await response.json() as { memories: Array<{ entity?: { names?: string[] } }> };
  assert.equal(response.status, 200);
  return payload.memories.flatMap((memory) => memory.entity?.names?.slice(0, 1) ?? []);
}
