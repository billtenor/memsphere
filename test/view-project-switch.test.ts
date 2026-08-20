import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import type { MemsphereConfig } from "../src/config.js";
import { createViewServer } from "../src/commands/view.js";
import { createReview } from "../src/review/store.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

test("View switches Projects without retaining the previous Project Memory data", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "memsphere-view-projects-"));
  const home = join(fixture, "home");
  const previousHome = process.env.MEMSPHERE_HOME;
  try {
    process.env.MEMSPHERE_HOME = home;
    const roots = {
      alpha: join(home, "projects", "alpha"),
      beta: join(home, "projects", "beta")
    };
    for (const [name, root] of Object.entries(roots)) {
      await mkdir(join(root, "memory", "concepts"), { recursive: true });
      for (const directory of ["changes", "runs", "reviews", "archives", ".runtime"]) {
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

    const alphaMemoryPath = join(roots.alpha, "memory", "concepts", "alpha.yaml");
    const review = await createReview({
      title: "Alpha review",
      source: "memory",
      target: {
        source: "memory",
        id: "concepts/alpha-memory",
        name: "alpha-memory",
        path: "concepts/alpha.yaml"
      },
      memoryRoot: join(roots.alpha, "memory"),
      reviewsRoot: join(roots.alpha, "reviews"),
      snapshotFiles: [{
        label: "concepts/alpha.yaml",
        path: alphaMemoryPath,
        kind: "memory"
      }]
    });

    const config = projectConfig(home, "alpha", roots.alpha);
    const server = createViewServer(config);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const projects = await (await fetch(`${origin}/api/projects`)).json() as {
        current: string;
        projects: Array<{ name: string }>;
      };
      assert.equal(projects.current, "alpha");
      assert.deepEqual(projects.projects.map((project) => project.name), ["alpha", "beta"]);
      assert.deepEqual(await memoryNames(origin), ["alpha-memory"]);
      assert.deepEqual(await memorySystemFlags(origin), [{ name: "alpha-memory", system: false }]);

      const selected = await fetch(`${origin}/api/projects/select`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "beta" })
      });
      assert.equal(selected.status, 200);
      assert.deepEqual(await memoryNames(origin), ["beta-memory"]);
      assert.deepEqual(await memorySystemFlags(origin), [{ name: "beta-memory", system: false }]);
      const settings = await (await fetch(`${origin}/api/settings/project`)).json() as {
        projectName: string;
        configPath: string;
      };
      assert.equal(settings.projectName, "beta");
      assert.equal(settings.configPath, await realpath(join(roots.beta, "config.json")));

      const canonicalPath = `/projects/alpha/memories/concepts/alpha-memory/reviews/${review.id}`;
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
        await page.goto(origin + canonicalPath);
        await page.waitForFunction(() => document.body.classList.contains("review-drawer-open"));
        assert.equal(new URL(page.url()).pathname, canonicalPath);
        assert.equal(await page.locator("#project-select-value").textContent(), "alpha");
        await page.getByRole("heading", { name: "alpha-memory", exact: true }).waitFor();

        await page.close();
      } finally {
        await browser.close();
      }
      assert.equal((await fetch(`${origin}/memory-reviews/${review.id}`)).status, 404);
    } finally {
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
    reviewsRoot: join(root, "reviews"),
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

async function memoryNames(origin: string): Promise<string[]> {
  const response = await fetch(`${origin}/api/memories`);
  const payload = await response.json() as {
    memories: Array<{ entity?: { names?: string[] } }>;
    error?: string;
  };
  assert.equal(response.status, 200, payload.error);
  return payload.memories.flatMap((memory) => memory.entity?.names?.slice(0, 1) ?? []);
}

async function memorySystemFlags(origin: string): Promise<Array<{ name: string; system: boolean }>> {
  const response = await fetch(`${origin}/api/memories`);
  const payload = await response.json() as {
    memories: Array<{ system: boolean; entity?: { names?: string[] } }>;
    error?: string;
  };
  assert.equal(response.status, 200, payload.error);
  return payload.memories.flatMap((memory) => {
    const name = memory.entity?.names?.[0];
    return name ? [{ name, system: memory.system }] : [];
  });
}
