import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { Page } from "playwright";
import { browserScope } from "./helpers/browser.js";
import { startProjectModelView } from "./fixtures/project-model-view.js";

const exampleRoot = new URL("../examples/view-packages/model-definition/", import.meta.url);
const examplePath = "/projects/alpha/modules/model-definition/targets";
const rendererCell = "org.memsphere.models.definition.renderer@1:definition";

async function exampleFixture(options: { locale?: "en" | "zh-CN"; renderer?: string } = {}) {
  return startProjectModelView(async config => {
    const packageRoot = join(config.homeRoot!, "example");
    await cp(exampleRoot, packageRoot, { recursive: true });
    const installed = [{ path: packageRoot }];
    const packages: Record<string, unknown>[] = [{ id: "org.example.model-definition", version: "1.0.0", instance_id: "model-definition", enabled: true }];
    if (options.renderer) {
      const rendererRoot = join(config.homeRoot!, "renderer");
      await mkdir(rendererRoot);
      await writeFile(join(rendererRoot, "module.json"), JSON.stringify({ schemaVersion: 1, id: "org.example.renderer", version: "1.0.0",
        view: { entry: "./index.js", sdk: "^1.0.0", contributions: [{ id: "custom", cell: rendererCell, priority: 100 }] } }));
      await writeFile(join(rendererRoot, "index.js"), options.renderer);
      installed.push({ path: rendererRoot });
      packages.push({ id: "org.example.renderer", version: "1.0.0", enabled: true });
    }
    config.language = options.locale ?? "zh-CN";
    config.viewPackages = { installed };
    config.viewComposition = { packages, slots: options.renderer ? { [rendererCell]: "org.example.renderer:org.example.renderer:custom" } : {} } as any;
    await writeFile(join(config.homeRoot!, "config.json"), JSON.stringify({ language: config.language,
      view_packages: config.viewPackages, view_composition: config.viewComposition }));
  });
}

async function withExample(options: { locale?: "en" | "zh-CN"; renderer?: string; withoutModels?: boolean },
  run: (page: Page, fixture: Awaited<ReturnType<typeof exampleFixture>>) => Promise<void>) {
  const fixture = await exampleFixture(options);
  const browser = await browserScope();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    if (options.withoutModels) {
      // Keep the real service, APIs and generated Host; omit only the official boot instance.
      await page.route("**/*", async route => {
        if (!route.request().isNavigationRequest()) return route.continue();
        const response = await route.fetch();
        const body = await response.text();
        const filtered = body.replace(/(<script id="memsphere-view-boot" type="application\/json">)([\s\S]*?)(<\/script>)/,
          (_match, start, source, end) => {
            const boot = JSON.parse(source);
            boot.instances = boot.instances.filter((instance: any) => instance.module.moduleId !== "org.memsphere.models");
            return start + JSON.stringify(boot).replaceAll("<", "\\u003c") + end;
          });
        await route.fulfill({ response, body: filtered });
      });
    }
    try { await run(page, fixture); }
    catch (error) {
      console.error("Component page failure", JSON.stringify({ url: page.url(), errors,
        body: await page.locator("body").innerText().catch(() => "unavailable"),
        diagnostics: await page.evaluate(() => (window as any).__memsphereViewDiagnostics?.()).catch(() => undefined) }));
      throw error;
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await fixture.close(); }
}

const first = (page: Page) => page.locator('[data-example-instance="first"]');
const second = (page: Page) => page.locator('[data-example-instance="second"]');
async function tableStyles(page: Page, selector: string) {
  return page.locator(selector).evaluate(table => {
    const style = getComputedStyle(table), cell = getComputedStyle(table.querySelector("td")!);
    return { background: style.backgroundColor, font: style.fontFamily, size: style.fontSize,
      borderCollapse: style.borderCollapse, minWidth: style.minWidth, padding: cell.padding, border: cell.borderBottom };
  });
}

test("an independent business page renders the same default model data and theme as the official model page", async () => {
  await withExample({}, async (page, fixture) => {
    await page.goto(fixture.origin + "/projects/alpha/models?model=sales%2Forder.json");
    await page.getByRole("radio", { name: "模型结构", exact: true }).click();
    await page.locator(".model-definition-table").waitFor();
    const content = await page.locator(".model-definition-table").innerText();
    const styles = await tableStyles(page, ".model-definition-table");
    await page.goto(fixture.origin + examplePath + "?model=sales%2Forder.json");
    await first(page).locator("table").waitFor();
    assert.equal(await first(page).locator("table").innerText(), content);
    assert.deepEqual(await tableStyles(page, '[data-example-instance="first"] table'), styles);
    assert.equal(await page.locator('[data-example-instance="source"] pre').textContent(), fixture.source);
    assert.equal(await page.locator("[data-crawl-rules] table").count(), 0);
    await page.goto(fixture.origin + examplePath + "?model=bad.json");
    await page.getByText("读取模型失败", { exact: true }).waitFor();
    assert.equal(await page.locator(".model-definition-table").count(), 0);
  });
});

for (const locale of ["zh-CN", "en"] as const) {
  test(`without a Models instance static definitions, raw and unsupported feedback work in Host language ${locale}`, async () => {
    await withExample({ locale, withoutModels: true }, async (page, fixture) => {
      const requests: string[] = [];
      page.on("request", request => requests.push(request.url()));
      await page.goto(fixture.origin + examplePath + "?mode=static");
      await first(page).locator("table").waitFor();
      assert.equal(await first(page).locator("th").first().innerText(), locale === "en" ? "Field / structure" : "字段 / 结构");
      const diagnostics = await page.evaluate(() => (window as any).__memsphereViewDiagnostics());
      assert.equal(diagnostics.instances.some((instance: any) => instance.module.moduleId === "org.memsphere.models"), false);
      assert.equal(requests.some(url => url.includes("/assets/modules/org.memsphere.models/") || url.includes("/api/projects/alpha/models")), false);
      assert.equal(await first(page).locator("table").evaluate(table => getComputedStyle(table).minWidth), "560px");
      const override = locale === "en" ? "zh-CN" : "en";
      await page.goto(fixture.origin + examplePath + "?mode=static&locale=" + override);
      await first(page).locator("table").waitFor();
      assert.equal(await first(page).locator("th").first().innerText(), override === "en" ? "Field / structure" : "字段 / 结构");
      for (const [mode, feedback] of [["raw", locale === "en" ? "Raw content model" : "原始内容模型"],
        ["unsupported", locale === "en" ? "Structure view is not supported for this model" : "暂不支持此模型的结构展示"],
        ["invalid", locale === "en" ? "Model definition unavailable" : "模型定义不可用"]]) {
        await page.goto(fixture.origin + examplePath + "?mode=" + mode);
        await first(page).getByText(feedback, { exact: true }).waitFor();
        assert.equal(await first(page).locator("table").count(), 0);
        assert.match(await page.locator('[data-example-instance="source"] pre').innerText(), /"url"/);
      }
    });
  });
}

test("embedded instances isolate expansion, preserve keyboard focus, follow theme, scroll on narrow screens and remount cleanly", async () => {
  await withExample({ withoutModels: true }, async (page, fixture) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(fixture.origin + examplePath + "?mode=static");
    const toggle = first(page).getByRole("button", { name: "展开 options", exact: true });
    await toggle.waitFor();
    const light = await first(page).locator("table").evaluate(table => getComputedStyle(table).backgroundColor);
    await toggle.focus();
    await page.keyboard.press("Enter");
    await first(page).getByRole("button", { name: "收起 options", exact: true }).waitFor();
    assert.equal(await first(page).locator('.model-definition-name').filter({ hasText: /^limit$/ }).count(), 1);
    assert.equal(await second(page).locator('.model-definition-name').filter({ hasText: /^limit$/ }).count(), 0);
    assert.equal(await first(page).getByRole("button", { name: "收起 options", exact: true }).evaluate(button => button === document.activeElement), true);
    await first(page).getByRole("button", { name: "全部收起", exact: true }).click();
    assert.equal(await first(page).locator('.model-definition-name').filter({ hasText: /^limit$/ }).count(), 0);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(color => {
      const table = document.querySelector('[data-example-instance="first"] table');
      return table && getComputedStyle(table).backgroundColor !== color;
    }, light);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await first(page).locator(".model-definition-table-scroll").evaluate(element => element.scrollWidth > element.clientWidth), true);
    await page.goto(fixture.origin + "/projects/alpha/models");
    await page.locator("[data-model-definition-example]").waitFor({ state: "detached" });
    await page.goto(fixture.origin + examplePath + "?mode=static");
    await first(page).getByRole("button", { name: "展开 options", exact: true }).waitFor();
    assert.equal(await page.locator("[data-example-instance]").count(), 3);
  });
});

for (const behavior of ["wrap", "throw", "invalid"] as const) {
  const source = `import { portableSlots } from "@memsphere/view-sdk";
    export default { apiVersion: 1, inject: ["slots"], apply(ctx) {
      ctx.slots.register(portableSlots.modelDefinitionRenderer, { id: "custom", key: "definition", value: { render(input) {
        window.__modelInputs ??= [];
        window.__modelInputs.push({ view: input.view, frozen: Object.isFrozen(input) && Object.isFrozen(input.model) && Object.isFrozen(input.model.definition.properties) });
        ${behavior === "throw" ? 'throw Error("renderer failure");' : behavior === "invalid" ? 'return "invalid";' : 'const wrapper = document.createElement("section"); wrapper.dataset.wrappedModel = input.view; wrapper.append(input.defaultRender()); return wrapper;'}
      } } });
    } };`;
  test(`without an official renderer the public factory ${behavior === "wrap" ? "provides a frozen context and defaultRender" : "falls back after renderer " + behavior}`, async () => {
    await withExample({ withoutModels: true, renderer: source }, async (page, fixture) => {
      await page.goto(fixture.origin + examplePath + "?mode=static");
      await first(page).locator("table").waitFor();
      assert.equal(await page.locator('[data-example-instance="source"] pre').count(), 1);
      assert.equal(await page.locator("[data-wrapped-model]").count(), behavior === "wrap" ? 3 : 0);
      const inputs = await page.evaluate(() => (window as any).__modelInputs);
      assert.ok(inputs.length >= 1);
      assert.ok(inputs.every((input: any) => input.frozen));
      await first(page).getByRole("button", { name: "展开 options", exact: true }).click();
      await first(page).getByText("limit", { exact: true }).waitFor();
    });
  });
}
