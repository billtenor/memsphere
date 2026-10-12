import { browserScope } from "./helpers/browser.js";
import { managedProjectFixture } from "./helpers/project.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Page } from "playwright";
import test from "node:test";
import { readProjectConfig } from "../src/config.js";
import { createViewServer } from "../src/commands/view.js";
import { createViewMemoryChange } from "../src/memory/changeset.js";
import { currentMemorySyntax } from "../src/memory/syntax.js";
import { runGit } from "../src/git.js";

const references = ["concepts/layout-concept", "statements/layout-statement", "schemas/layout-schema", "procedures/layout-procedure"];

async function withLayoutProject(run: (fixture: { home: string; root: string; changeId: string; launch: () => Promise<{ origin: string; close: () => Promise<void> }> }) => Promise<void>) {
  const temporary = await mkdtemp(join(tmpdir(), "memsphere-page-layout-"));
  const previousHome = process.env.MEMSPHERE_HOME;
  const home = join(temporary, "home");
  process.env.MEMSPHERE_HOME = home;
  try {
    await managedProjectFixture("layout");
    const root = join(home, "projects", "layout");
    const memoryRoot = join(root, "memory");
    await writeFile(join(memoryRoot, "procedures", "layout-procedure.yaml"), `!procedure\nsyntax: ${currentMemorySyntax}\nnames: [layout-procedure, Layout Procedure]\ndefines: [A user-owned layout example.]\nflow:\n  - !action\n    action: Inspect a result.\n    actor: human\n    asserts: [Keep the result readable.]\n    artifact: !artifact\n      name: Result\n      format: markdown\n`);
    for (const [kind, name, tag, body] of [
      ["concepts", "layout-concept", "concept", "defines: [A concept with a long reference " + "path-".repeat(60) + ".]"],
      ["statements", "layout-statement", "statement", "defines: [Layout statement.]\nasserts: [Keep details readable.]\nsections:\n  - !statement\n    names: [Nested section]\n    asserts: [A nested rule.]"],
      ["schemas", "layout-schema", "schema", "defines: [Layout schema.]\nfields:\n  - !schema\n    names: [Long structured field name]\n    fields: [Summary, Evidence]"]
    ]) await writeFile(join(memoryRoot, kind!, name + ".yaml"), `!${tag}\nsyntax: ${currentMemorySyntax}\nnames: [${name}]\n${body}\n`);
    await runGit(["add", "."], { cwd: memoryRoot });
    await runGit(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "User-owned layout example"], { cwd: memoryRoot });
    const projectConfig = JSON.parse(await readFile(join(root, "config.json"), "utf8"));
    projectConfig.store.published_revision = (await runGit(["rev-parse", "HEAD"], { cwd: memoryRoot })).stdout.trim();
    await writeFile(join(root, "config.json"), JSON.stringify(projectConfig));
    const runDir = join(root, "runs", "run-layout");
    await mkdir(join(runDir, "artifacts"), { recursive: true });
    await writeFile(join(runDir, "artifacts", "report.md"), "# Result\n\nCompleted result with a long reference: " + "long-reference-".repeat(60));
    await writeFile(join(runDir, "run-layout.json"), JSON.stringify({
      contractVersion: 2, memorySyntax: currentMemorySyntax, id: "run-layout", name: "Layout Run", status: "done", procedureName: "Layout Procedure",
      memoryRoot: join(root, "memory"), createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z", stack: [],
      plan: [{ id: "flow[1]", kind: "action", instruction: "Inspect a long result " + "instruction-".repeat(40), artifact: "report", type: "string", format: { name: "markdown", options: {} }, final: true }],
      events: [{ at: "2026-10-12T00:00:00.000Z", frame: "procedure", stepId: "flow[1]", artifact: { name: "report", type: "string", format: { name: "markdown", options: {} }, storage: "file", path: "run-layout/artifacts/report.md", final: true } }]
    }));
    // Construct the ChangeSet through its Store API; layout tests do not submit comments.
    const change = await createViewMemoryChange({ home, project: "layout", reference: "procedures/layout-procedure", actor: { kind: "human", id: "layout-test", name: "Layout test" } });
    const servers = new Set<ReturnType<typeof createViewServer>>();
    const launch = async () => {
      const config = await readProjectConfig("layout");
      const server = createViewServer(config);
      servers.add(server);
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); servers.delete(server); } };
    };
    try { await run({ home, root, changeId: change.id, launch }); }
    finally { await Promise.all([...servers].map(server => new Promise<void>(resolve => server.close(() => resolve())))); }
  } finally {
    if (previousHome === undefined) delete process.env.MEMSPHERE_HOME; else process.env.MEMSPHERE_HOME = previousHome;
    await rm(temporary, { recursive: true, force: true });
  }
}

async function geometry(page: Page) {
  return page.locator("[data-mem-page-layout]").evaluate(node => {
    const root = node.getBoundingClientRect();
    const content = node.firstElementChild!.getBoundingClientRect();
    const style = getComputedStyle(node);
    return { width: root.width, left: content.left - root.left, right: root.right - content.right, padding: parseFloat(style.paddingLeft), overflow: node.scrollWidth > node.clientWidth + 1,
      hostOverflow: document.querySelector("#memsphere-view-root")!.scrollWidth > document.querySelector("#memsphere-view-root")!.clientWidth + 1 };
  });
}

test("official Memory, ChangeSet and Run pages use fluid symmetric gutters across themes and breakpoint boundaries", async () => {
  await withLayoutProject(async ({ home, changeId, launch }) => {
    const themeRoot = join(home, "layout-theme");
    await mkdir(themeRoot);
    await writeFile(join(themeRoot, "module.json"), JSON.stringify({ schemaVersion:1, id:"org.example.layout-theme", version:"1.0.0", source:{type:"local"}, view:{entry:"./index.js",sdk:"^1.0.0",capabilities:["theme.override"],themes:[{id:"gutter",file:"./gutter.json"}]} }));
    await writeFile(join(themeRoot, "index.js"), "export default {apiVersion:1,inject:[],apply(){}};");
    await writeFile(join(themeRoot, "gutter.json"), JSON.stringify({light:{"layout.pagePadding":"40px"},dark:{"layout.pagePadding":"48px"}}));
    const browser = await browserScope();
    try {
      for (const [locale, mode] of [["en", "light"], ["zh-CN", "dark"]] as const) {
        await writeFile(join(home, "config.json"), JSON.stringify({ language: locale, view: { host: "127.0.0.1", port: 0 }, view_packages:{installed:[{path:themeRoot}]}, view_theme: { mode, selected_source:"org.example.layout-theme:gutter" } }));
        const active = await launch();
        const page = await browser.newPage({ viewport: { width: 2560, height: 1000 } });
        for (const path of [...references.map(ref => `memories/${ref}`), "tasks/run-layout?status=done"]) {
          await page.goto(`${active.origin}/projects/layout/${path}`);
          await page.locator("[data-mem-content-canvas]").waitFor();
          assert.equal(await page.locator(".memory-error, .run-error").count(), 0);
          for (const width of [2560, 1920, 1280, 821, 820, 500]) {
            await page.setViewportSize({ width, height: 1000 });
            const box = await geometry(page);
            assert.ok(Math.abs(box.left - box.right) < 1, `${locale} ${path} has symmetric gutters at ${width}`);
            assert.equal(box.padding, width <= 820 ? 12 : mode === "light" ? 40 : 48, "the shared layout consumes the selected Theme padding Token");
            assert.equal(box.overflow || box.hostOverflow, false, `${path} fits at ${width}`);
            if (width === 2560) assert.ok(box.width > 1400, "the page uses the available desktop width");
          }
        }
        await page.setViewportSize({ width: 2560, height: 1000 });
        await page.goto(`${active.origin}/projects/layout/changes/${changeId}`);
        const collapse = page.locator('[data-view-slot="header.actions"]').getByRole("button", { name: locale === "en" ? "Collapse comments" : "收起意见", exact: true });
        await collapse.click();
        const main = page.locator(".memory-change-main");
        const wide = await main.evaluate(node => node.getBoundingClientRect().width);
        const gutters = await geometry(page);
        assert.ok(Math.abs(gutters.left - gutters.right) < 1);
        await page.getByRole("radio", { name: locale === "en" ? "Full content" : "完整内容", exact: true }).click();
        await page.getByRole("radio", { name: locale === "en" ? "Diff" : "差异", exact: true }).click();
        await page.getByRole("button", { name: locale === "en" ? "Expand comments" : "展开意见", exact: true }).click();
        assert.ok(await main.evaluate(node => node.getBoundingClientRect().width) < wide);
        for (const width of [1280, 821, 820, 500]) {
          await page.setViewportSize({ width, height: 1000 });
          const box = await geometry(page);
          assert.equal(box.overflow || box.hostOverflow, false, `expanded comments fit at ${width}`);
          if (width <= 821) {
            const stacked = await page.locator(".memory-comments").evaluate(node => node.getBoundingClientRect().top >= document.querySelector(".memory-change-main")!.getBoundingClientRect().bottom);
            assert.equal(stacked, true, "comments stack when the detail area is tight");
          }
        }
        await page.close(); await active.close();
      }
    } finally { await browser.close(); }
  });
});

test("one selected styles.global contribution styles all official pages while page.presentation replaces one module", async () => {
  await withLayoutProject(async ({ home, changeId, launch }) => {
    const packageRoot = join(home, "layout-package");
    await mkdir(packageRoot);
    const id = "org.example.page-layout";
    await writeFile(join(packageRoot, "module.json"), JSON.stringify({ schemaVersion: 1, id, version: "1.0.0", source: { type: "local" }, view: {
      entry: "./index.js", sdk: "^1.0.0", capabilities: ["styles.global"], styles: [{ id: "shared", file: "./shared.css", scope: "global" }],
      contributions: [{ id: "memory", cell: "org.memsphere.memory.page.presentation@1:page", priority: 100 }, { id: "run", cell: "org.memsphere.run.page.presentation@1:page", priority: 100 }]
    } }));
    await writeFile(join(packageRoot, "shared.css"), "[data-mem-page-layout] { --mem-page-layout-inset:20px; background:var(--mem-view-color-accent-soft); }");
    await writeFile(join(packageRoot, "index.js"), `import { portableSlots } from '@memsphere/view-sdk';
      export default { apiVersion:1, inject:['slots'], apply(ctx) {
        for (const [kind, slot] of [['memory',portableSlots.memoryPagePresentation],['run',portableSlots.runPagePresentation]]) {
          ctx.slots.register(slot,{id:kind,key:'page',priority:100,value:{mount({element}){element.dataset.layoutReplacement=kind;element.textContent='Custom '+kind+' layout';return ()=>{delete element.dataset.layoutReplacement;element.replaceChildren();};}}});
        }
      }};`);
    const slots: Record<string, string | string[] | null> = { "styles.global@1": [`${id}:${id}:shared`], "org.memsphere.memory.page.presentation@1:page": null, "org.memsphere.run.page.presentation@1:page": null };
    const save = async () => writeFile(join(home, "config.json"), JSON.stringify({ language: "en", view: { host: "127.0.0.1", port: 0 }, view_packages: { installed: [{ path: packageRoot }] }, view_composition: { packages: [{ id, version: "1.0.0", enabled: true }], slots } }));
    await save();
    const browser = await browserScope();
    try {
      let active = await launch();
      const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
      const memoryPath = "/projects/layout/memories/concepts/layout-concept";
      const runPath = "/projects/layout/tasks/run-layout?status=done";
      for (const path of [memoryPath, `/projects/layout/changes/${changeId}`, runPath]) {
        await page.goto(active.origin + path);
        await page.locator("[data-mem-page-layout]").waitFor();
        assert.equal((await geometry(page)).padding, 20, "one selected global stylesheet overrides the shared gutter");
        assert.equal(await page.locator("[data-layout-replacement]").count(), 0, "unselected page contributions remain inactive");
      }
      await active.close();
      for (const kind of ["memory", "run"] as const) {
        slots["org.memsphere.memory.page.presentation@1:page"] = null;
        slots["org.memsphere.run.page.presentation@1:page"] = null;
        slots[`org.memsphere.${kind}.page.presentation@1:page`] = `${id}:${id}:${kind}`;
        await save(); active = await launch();
        for (const [path, module] of [[memoryPath, "memory"], [`/projects/layout/changes/${changeId}`, "memory"], [runPath, "run"]]) {
          await page.goto(active.origin + path);
          if (module === kind) await page.locator(`[data-layout-replacement="${kind}"]`).waitFor();
          else { await page.locator("[data-mem-page-layout]").waitFor(); assert.equal((await geometry(page)).padding, 20); }
          assert.equal(await page.locator(".mem-view-content-list-root").count() > 0, true, "the official list is independent of page presentation");
        }
        await active.close();
      }
      assert.deepEqual(JSON.parse(await readFile(join(home, "config.json"), "utf8")).view_composition.slots["styles.global@1"], [`${id}:${id}:shared`]);
    } finally { await browser.close(); }
  });
});
