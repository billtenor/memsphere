import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "playwright";
import { startProjectModelView } from "./fixtures/project-model-view.js";

const pageCell = "org.memsphere.models.page.presentation@1:page";
const definitionCell = "org.memsphere.models.definition.renderer@1:definition";

async function withPackage(cell: string, source: string, run: (page: Page, origin: string) => Promise<void>, selected = true, language: "en" | "zh-CN" = "zh-CN") {
  const fixture = await startProjectModelView(async config => {
    const packageRoot = join(config.homeRoot!, "custom-models");
    await mkdir(packageRoot);
    await writeFile(join(packageRoot, "module.json"), JSON.stringify({ schemaVersion: 1,
      id: "org.example.models", version: "1.0.0", view: { entry: "./index.js", sdk: "^1.0.0",
        contributions: [{ id: "custom", cell, priority: 100 }] } }));
    await writeFile(join(packageRoot, "index.js"), source);
    config.language = language;
    config.viewPackages = { installed: [{ path: packageRoot }] };
    config.viewComposition = { packages: [{ id: "org.example.models", version: "1.0.0", enabled: true }],
      slots: { [cell]: selected ? "org.example.models:org.example.models:custom" : null } };
    await writeFile(join(config.homeRoot!, "config.json"), JSON.stringify({ language,
      view_packages: config.viewPackages, view_composition: config.viewComposition }));
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await run(page, fixture.origin);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await fixture.close(); }
}

const definitionPackage = `
  import { portableSlots } from "@memsphere/view-sdk";
  export default { apiVersion: 1, inject: ["slots"], apply(context) {
    context.slots.register(portableSlots.modelDefinitionRenderer, { id: "custom", key: "definition", value: {
      render(input) {
        window.__modelRendererInputs ??= [];
        window.__modelRendererInputs.push({ id: input.model.id, view: input.view, frozen: Object.isFrozen(input) && Object.isFrozen(input.model) && Object.isFrozen(input.model.definition) });
        const wrapper = document.createElement("section"); wrapper.dataset.customDefinition = input.view;
        wrapper.append(input.defaultRender()); return wrapper;
      }
    }});
  }};
`;

test("selected definition renderer receives frozen model data and can wrap the official tree and source without replacing navigation", async () => {
  await withPackage(definitionCell, definitionPackage, async (page, origin) => {
    await page.goto(`${origin}/projects/alpha/models?model=sales%2Forder.json`);
    await page.getByRole("radio", { name: "模型结构", exact: true }).click();
    await page.locator('[data-custom-definition="structure"] .model-definition-table').waitFor();
    await page.getByRole("button", { name: "展开 items", exact: true }).click();
    await page.getByText("[元素结构]", { exact: true }).waitFor();
    await page.getByRole("radio", { name: "原始定义", exact: true }).click();
    await page.locator('[data-custom-definition="source"] .model-browser-code').waitFor();
    assert.equal(JSON.parse(await page.locator(".model-browser-code").innerText()).title, "订单 Alpha");
    await page.getByRole("radio", { name: "模型结构", exact: true }).click();
    await page.getByRole("button", { name: "收起 items", exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => (window as any).__modelRendererInputs), [
      { id: "sales/order.json", view: "structure", frozen: true },
      { id: "sales/order.json", view: "source", frozen: true }
    ]);
    await page.goto(`${origin}/projects/alpha/models?model=memsphere%2Frun%2Fartifact.json`);
    await page.getByRole("radio", { name: "模型结构", exact: true }).click();
    await page.locator('[data-custom-definition="structure"]').waitFor();
    await page.getByText("原始内容模型", { exact: true }).waitFor();
    assert.equal(await page.locator(".model-definition-table").count(), 0);
  });
});

test("selected Models page uses the official presentation service for definitions, navigation and project isolation", async () => {
  const source = `
    import { portableSlots } from "@memsphere/view-sdk";
    export default { apiVersion: 1, inject: ["slots", "presentation"], apply(context) {
      let element;
      async function render() {
        const data = await context.presentation.modelsPage();
        const model = await data.getDefinition(data.selectedModelId);
        window.__modelsPageContract = { frozen: Object.isFrozen(data) && Object.isFrozen(data.models) && Object.isFrozen(data.models[0]) && Object.isFrozen(model.definition), id: model.id, count: data.models.length };
        const heading = document.createElement("h2"); heading.textContent = model.title ?? model.registration?.name ?? model.id; heading.dataset.customModelPage = "true";
        const next = document.createElement("button"); next.textContent = "Open raw model"; next.onclick = () => data.openModel("memsphere/run/artifact.json");
        const refresh = document.createElement("button"); refresh.textContent = "Refresh models"; refresh.onclick = async () => { window.__modelsRefreshed = (await data.refresh()).models.length; };
        element.replaceChildren(heading, next, refresh);
      }
      context.slots.register(portableSlots.modelsPagePresentation, { id: "custom", key: "page", value: {
        async mount(target) { element = target.element; await render(); return () => { window.__modelsPageDisposed = (window.__modelsPageDisposed ?? 0) + 1; }; },
        update: render
      }});
    }};
  `;
  await withPackage(pageCell, source, async (page, origin) => {
    await page.goto(`${origin}/projects/alpha/models?model=sales%2Forder.json`);
    await page.locator("[data-custom-model-page]").waitFor();
    assert.equal(await page.locator("[data-custom-model-page]").innerText(), "订单 Alpha");
    await page.getByRole("button", { name: "订单 Alpha", exact: false }).waitFor();
    assert.equal(await page.locator(".model-definition-table").count(), 0);
    assert.equal(await page.evaluate(() => (window as any).__modelsPageContract.frozen), true);
    await page.getByRole("button", { name: "Refresh models", exact: true }).click();
    await page.waitForFunction(() => (window as any).__modelsRefreshed > 0);
    await page.getByRole("button", { name: "Open raw model", exact: true }).click();
    await page.waitForURL(url => url.pathname.endsWith("/models") && url.searchParams.get("model") === "memsphere/run/artifact.json");
    await page.getByRole("heading", { name: "运行产物", exact: true }).waitFor();
    await page.getByRole("button", { name: "记忆", exact: true }).click();
    await page.waitForURL("**/memories");
    await page.locator("[data-custom-model-page]").waitFor({ state: "detached" });
    assert.equal(await page.locator("[data-custom-model-page]").count(), 0);
    assert.equal(await page.evaluate(() => (window as any).__modelsPageDisposed), 1);
    await page.goto(`${origin}/projects/beta/models?model=sales%2Forder.json`);
    await page.getByRole("heading", { name: "订单 Beta", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).__modelsPageContract.id), "sales/order.json");
  });
});

for (const [cell, token, key] of [[pageCell, "modelsPagePresentation", "page"], [definitionCell, "modelDefinitionRenderer", "definition"]] as const) {
  test(`a failed ${key} replacement falls back to the official Models presentation`, async () => {
    const source = `import { portableSlots } from "@memsphere/view-sdk";
      export default { apiVersion: 1, inject: ["slots"], apply(context) {
        context.slots.register(portableSlots.${token}, { id: "custom", key: "${key}", value: {
          ${key === "page" ? "mount" : "render"}() { window.__modelsFailed = (window.__modelsFailed ?? 0) + 1; throw new Error("replacement failed"); }
        }});
      }};`;
    await withPackage(cell, source, async (page, origin) => {
      await page.goto(`${origin}/projects/alpha/models?model=sales%2Forder.json`);
      await page.getByRole("radio", { name: "模型结构", exact: true }).click();
      await page.locator(".model-definition-table").waitFor();
      assert.equal(await page.locator(".model-browser-heading").innerText(), "订单 Alpha");
      assert.equal(await page.evaluate(() => (window as any).__modelsFailed), 1);
      assert.equal(await page.locator("html").getAttribute("data-view-host-state"), "ready");
      await page.getByRole("radio", { name: "原始定义", exact: true }).click();
      await page.locator(".model-browser-code").waitFor();
    });
  });
}

test("explicit system-default selection suppresses an installed Models definition contribution", async () => {
  await withPackage(definitionCell, definitionPackage, async (page, origin) => {
    await page.goto(`${origin}/projects/alpha/models?model=sales%2Forder.json`);
    await page.getByRole("radio", { name: "模型结构", exact: true }).click();
    await page.locator(".model-definition-table").waitFor();
    assert.equal(await page.locator("[data-custom-definition]").count(), 0);
    assert.equal(await page.evaluate(() => (window as any).__modelRendererInputs), undefined);
  }, false);
});

for (const [language, labels] of [["zh-CN", ["模型模块 / 整体页面", "模型模块 / 定义正文"]], ["en", ["Models module / Whole page", "Models module / Definition body"]]] as const) {
  test(`Settings exposes both Models slots with ${language} labels and a selectable installed contribution`, async () => {
    await withPackage(definitionCell, definitionPackage, async (page, origin) => {
      await page.goto(`${origin}/projects/alpha/settings/appearance`);
      for (const label of labels) await page.getByText(label, { exact: true }).waitFor();
      const control = page.locator(`[data-select-field="view_composition.slot.${definitionCell}"]`);
      await control.waitFor();
      assert.match(await control.innerText(), /org.example.models/);
    }, true, language);
  });
}
