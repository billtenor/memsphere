import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "playwright";
import { startProjectModelView } from "./fixtures/project-model-view.js";

type Fixture = Awaited<ReturnType<typeof startProjectModelView>>;
async function withView(run: (page: Page, fixture: Fixture) => Promise<void>) {
  const fixture = await startProjectModelView();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await run(page, fixture);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await fixture.close(); }
}
async function showStructure(page: Page) {
  await page.getByRole("radio", { name: /^(模型结构|Model structure)$/ }).click();
}
async function order(page: Page, fixture: Fixture) {
  await page.goto(`${fixture.origin}/projects/alpha/models?model=sales%2Forder.json`);
  await page.getByRole("heading", { name: "订单 Alpha", exact: true }).waitFor();
  await showStructure(page);
}
async function settings(page: Page, fixture: Fixture) {
  await page.goto(`${fixture.origin}/projects/alpha/settings/models`);
  const directory = page.getByRole("textbox", { name: "模型目录", exact: true });
  await directory.waitFor();
  return directory;
}

async function unavailable(page: Page, fixture: Fixture, id: string, message: RegExp = /Unsupported|not supported|must be an object|plain object|reference/i) {
  const response = await page.request.get(`${fixture.origin}/api/projects/alpha/models/definition?model=${encodeURIComponent(id)}`);
  assert.equal(response.status(), 422);
  const body = await response.json();
  assert.match(body.error, message);
  assert.equal(Object.hasOwn(body, "definition"), false);
  const catalog = await (await page.request.get(`${fixture.origin}/api/projects/alpha/models`)).json();
  assert.equal(catalog.models.find((model: { id: string }) => model.id === id).status, "unavailable");
  await page.goto(`${fixture.origin}/projects/alpha/models?model=${encodeURIComponent(id)}`);
  await page.getByText(/^(读取模型失败|Could not read model)$/).waitFor();
  assert.equal(await page.locator(".model-definition-table, .model-browser-code").count(), 0);
}

test("model structure omits generated reading hints while preserving authored descriptions, actual rules and full source", async () => withView(async (page, fixture) => {
  const source = JSON.stringify({ title: "无冗余提示", description: "模型作者的说明", type: "object",
    properties: {
      score: { type: "number", minimum: 0, maximum: 100, description: "字段作者的说明" },
      values: { type: "array", items: { type: "string" } },
      name: { type: "string", minLength: 2 }
    }, required: ["score"] }, null, 2);
  await writeFile(join(fixture.root, "models/json-schema/draft-07/no-hints.json"), source);
  await page.goto(`${fixture.origin}/projects/alpha/models?model=no-hints.json`);
  await page.getByRole("heading", { name: "无冗余提示", exact: true }).waitFor();
  await showStructure(page);
  const structure = page.locator(".model-definition-structure");
  assert.equal(await structure.locator(":scope > p").count(), 0, "no root summary or explanatory spacer remains");
  assert.doesNotMatch(await structure.innerText(), /整体定义|详见原始定义|请查看原始定义|值结构见下方/);
  const table = structure.locator("table");
  const score = table.locator("tbody tr").filter({ has: page.getByText("score", { exact: true }) });
  assert.equal(await score.locator("td").nth(3).innerText(), "必填 · 最小值: 0 · 最大值: 100");
  assert.equal(await score.locator("td").nth(4).innerText(), "字段作者的说明");
  assert.equal(await page.locator(".model-browser-description").innerText(), "模型作者的说明");
  await page.getByRole("button", { name: "全部展开", exact: true }).click();
  assert.equal(await table.locator('tr[data-definition-kind="branch"]').count(), 0);
  await page.getByRole("radio", { name: "原始定义", exact: true }).click();
  assert.equal(await page.locator(".model-browser-code").textContent(), source);
}));

test("referenced fields show actual types and expandable target structure without altering source", async () => withView(async (page, fixture) => {
  const schema = { title: "引用结构", type: "object", properties: {
    address: { $ref: "#/definitions/alias" }, addresses: { type: "array", items: { $ref: "#/definitions/address" } },
    code: { $ref: "#/definitions/code" }
  }, required: ["address"], definitions: { alias: { $ref: "#/definitions/address" },
    address: { type: "object", properties: { city: { type: "string", description: "城市" } }, required: ["city"] },
    code: { type: "string", enum: ["A", "B"], description: "代码" } } };
  const source = JSON.stringify(schema, null, 2);
  const path = join(fixture.root, "models/json-schema/draft-07/references.json");
  await writeFile(path, source);
  await page.goto(`${fixture.origin}/projects/alpha/models?model=references.json`);
  await page.getByRole("heading", { name: "引用结构", exact: true }).waitFor();
  await showStructure(page);
  const table = page.locator(".model-definition-table");
  const named = (name: string) => table.locator("tbody tr").filter({ has: page.getByText(name, { exact: true }) });
  assert.equal(await named("address").locator("td").nth(1).innerText(), "对象");
  assert.equal(await named("address").locator("td").nth(3).innerText(), "必填 · 引用: #/definitions/alias → #/definitions/address");
  await page.getByRole("button", { name: "展开 address", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("button", { name: "收起 address", exact: true }).evaluate(button => button === document.activeElement), true);
  assert.equal(await named("city").locator("td").nth(3).innerText(), "必填");
  assert.equal(await named("city").locator("td").nth(4).innerText(), "城市");
  assert.equal(await named("code").locator("td").nth(1).innerText(), "文本枚举");
  assert.equal(await named("code").locator("td").nth(2).innerText(), '可选值: "A", "B"');
  assert.equal(await named("code").locator("td").nth(4).innerText(), "代码");
  await page.getByRole("button", { name: "全部展开", exact: true }).click();
  assert.equal(await named("city").count(), 2);
  assert.equal(await named("[元素结构]").locator("td").nth(1).innerText(), "对象");
  await page.getByRole("button", { name: "全部收起", exact: true }).click();
  assert.equal(await named("city").count(), 0);
  await page.getByRole("radio", { name: "原始定义", exact: true }).click();
  assert.equal(await page.locator("pre").innerText(), source);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("radio", { name: "模型结构", exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(await readFile(path, "utf8"), source);
}));

test("invalid local and cross-model references make the entire model unavailable", async () => withView(async (page, fixture) => {
  const cases = [
    ["missing-ref.json", { type: "object", properties: { missing: { $ref: "#/definitions/missing" } } }],
    ["external-ref.json", { type: "object", properties: { external: { $ref: "other.json" }, valid: { type: "integer" } } }],
    ["alias-cycle.json", { $ref: "#/definitions/alias", definitions: { alias: { $ref: "#/definitions/alias" } } }]
  ] as const;
  for (const [id, schema] of cases) {
    const source = JSON.stringify(schema);
    const path = join(fixture.root, "models/json-schema/draft-07", id);
    await writeFile(path, source);
    await unavailable(page, fixture, id);
    assert.equal(await readFile(path, "utf8"), source);
  }
  await order(page, fixture);
}));

test("recursive references expand on demand but bulk expansion stays finite and collapse retains identity", async () => withView(async (page, fixture) => {
  await writeFile(join(fixture.root, "models/json-schema/draft-07/recursive.json"), JSON.stringify({ title: "递归结构", type: "object", properties: {
    name: { type: "string" }, children: { type: "array", items: { $ref: "#" } }
  } }));
  await page.goto(`${fixture.origin}/projects/alpha/models?model=recursive.json`);
  await page.getByRole("heading", { name: "递归结构", exact: true }).waitFor();
  await showStructure(page);
  await page.getByRole("button", { name: "全部展开", exact: true }).click();
  const table = page.locator(".model-definition-table");
  const initial = await table.locator("tbody tr").count();
  await page.getByRole("button", { name: "全部展开", exact: true }).click();
  assert.equal(await table.locator("tbody tr").count(), initial);
  assert.match(await table.innerText(), /递归引用，可继续展开/);
  const recursive = page.getByRole("button", { name: "展开 [元素结构]", exact: true }).first();
  await recursive.focus(); await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("button", { name: "收起 [元素结构]", exact: true }).evaluate(button => button === document.activeElement), true);
  const next = await table.locator("tbody tr").count();
  assert.ok(next > initial);
  const names = table.locator(".model-definition-name").filter({ hasText: /^name$/ });
  assert.equal(await names.count(), 2);
  await page.getByRole("button", { name: "收起 [元素结构]", exact: true }).click();
  await page.getByRole("button", { name: "展开 [元素结构]", exact: true }).first().click();
  assert.equal(await table.locator("tbody tr").count(), next);
  await page.getByRole("button", { name: "全部收起", exact: true }).click();
  assert.equal(await table.locator("tbody tr").count(), 2);
}));

test("model tree exposes array-element fields and local required flags with keyboard expansion", async () => withView(async (page, fixture) => {
  await order(page, fixture);
  const table = page.getByRole("table", { name: "模型字段", exact: true });
  assert.equal(await table.locator("tbody tr").count(), 2);
  assert.deepEqual(await table.locator(".model-definition-name").allTextContents(), ["orderNo", "items"]);
  assert.equal(await page.getByRole("button", { name: "展开 items", exact: true }).locator(".model-definition-arrow").innerText(), "+");
  await page.getByRole("button", { name: "展开 items", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("button", { name: "收起 items", exact: true }).evaluate(button => button === document.activeElement), true);
  assert.equal(await page.getByRole("button", { name: "收起 items", exact: true }).locator(".model-definition-arrow").innerText(), "−");
  await page.getByRole("button", { name: "展开 [元素结构]", exact: true }).click();
  assert.equal(await table.locator("tbody tr").filter({ hasText: "productId" }).locator("td").nth(3).innerText(), "—");
  assert.equal(await table.locator("tbody tr").filter({ hasText: "quantity" }).locator("td").nth(3).innerText(), "必填 · 最小值: 1");
  await page.getByRole("button", { name: "全部收起", exact: true }).click();
  assert.equal(await table.locator("tbody tr").count(), 2);
  await page.getByRole("button", { name: "全部展开", exact: true }).click();
  assert.equal(await table.locator("tbody tr").count(), 5);
}));

test("tree bulk actions are right-aligned text buttons without instructions and retain keyboard operation", async () => withView(async (page, fixture) => {
  for (const path of ["models", "model-prototype"]) {
    await page.goto(`${fixture.origin}/projects/alpha/${path}?model=sales%2Forder.json`);
    await showStructure(page);
    const expand = page.getByRole("button", { name: "全部展开", exact: true });
    const collapse = page.getByRole("button", { name: "全部收起", exact: true });
    await expand.waitFor();
    const structure = page.locator(".model-definition-structure");
    assert.equal(await structure.locator(":scope > p").count(), 0, "no generic instructions or empty paragraph remains");
    const initial = await structure.locator("tbody tr").count();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await collapse.evaluate(button => {
        const bounds = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        const parent = button.parentElement!;
        return { right: bounds.right, toolbarRight: parent.getBoundingClientRect().right,
          alignment: getComputedStyle(parent).justifyContent, border: style.borderTopWidth, background: style.backgroundColor };
      });
      assert.equal(layout.alignment, "flex-end");
      assert.ok(Math.abs(layout.right - layout.toolbarRight) < 1, "last text action aligns to the right");
      assert.equal(layout.border, "0px");
      assert.equal(layout.background, "rgba(0, 0, 0, 0)");
      await expand.focus();
      await page.keyboard.press("Enter");
      assert.ok(await structure.locator("tbody tr").count() > initial);
      assert.equal(await expand.evaluate(button => button === document.activeElement), true);
      assert.equal(await expand.evaluate(button => getComputedStyle(button).outlineStyle), "solid");
      await collapse.focus();
      await page.keyboard.press("Space");
      assert.equal(await structure.locator("tbody tr").count(), initial);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
}));

test("expanded fields align their labels at each depth and distinguish array structure from fields", async () => withView(async (page, fixture) => {
  await writeFile(join(fixture.root, "models/json-schema/draft-07/geometry.json"), JSON.stringify({
    title: "对齐与层级", type: "object", properties: {
      name: { type: "string" },
      customer: { type: "object", properties: { address: { type: "object", properties: { city: { type: "string" } } }, id: { type: "string" } } },
      items: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } }
    }
  }));
  await page.goto(`${fixture.origin}/projects/alpha/models?model=geometry.json`);
  await showStructure(page);
  await page.getByRole("button", { name: "全部展开", exact: true }).click();
  const geometry = await page.locator(".model-definition-table tbody tr").evaluateAll(rows => rows.map(row => {
    const label = row.querySelector(".model-definition-name")!;
    const bounds = label.getBoundingClientRect();
    return { name: label.textContent, depth: Number((row as HTMLElement).dataset.definitionDepth), kind: (row as HTMLElement).dataset.definitionKind, x: bounds.x, y: bounds.y - row.getBoundingClientRect().y };
  }));
  for (const depth of new Set(geometry.map(row => row.depth))) {
    const peers = geometry.filter(row => row.depth === depth);
    assert.ok(peers.every(row => Math.abs(row.x - peers[0].x) < 0.5), `depth ${depth} labels align`);
    assert.ok(peers.every(row => Math.abs(row.y - peers[0].y) < 0.5), `depth ${depth} baselines align`);
  }
  assert.ok(geometry.find(row => row.name === "city")!.x > geometry.find(row => row.name === "address")!.x);
  assert.equal(geometry.some(row => row.kind === "root"), false);
  const element = page.locator('tr[data-definition-kind="element"]');
  assert.equal(await element.locator(".model-definition-name").innerText(), "[元素结构]");
  assert.equal(await element.locator(".model-definition-node-label").count(), 0);
  assert.equal(await element.locator("td").nth(3).innerText(), "—");
  assert.equal(await page.locator(".model-definition-joint, .model-definition-joint-last, .model-definition-continuation").count(), 0);
  const dimensions = await page.locator('.model-definition-table tbody tr[data-definition-kind="field"]').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
  assert.ok(dimensions.every(height => height <= 40), "short field rows retain the compact table layout");
  await page.getByRole("button", { name: "全部收起", exact: true }).click();
  assert.deepEqual(await page.locator(".model-definition-name").allTextContents(), ["name", "customer", "items"]);
}));

test("object roots omit their container while array roots distinguish the model from its element structure", async () => withView(async (page, fixture) => {
  const directory = join(fixture.root, "models/json-schema/draft-07");
  await writeFile(join(directory, "array.json"), JSON.stringify({ title: "根数组", type: "array", items: { type: "object", properties: { value: { type: "integer" } } }, minItems: 1 }));
  await writeFile(join(directory, "empty.json"), JSON.stringify({ title: "空对象", type: "object", properties: {}, additionalProperties: false }));
  await page.goto(`${fixture.origin}/projects/alpha/models?model=array.json`);
  await showStructure(page);
  await page.getByText("最少元素: 1", { exact: true }).waitFor();
  assert.deepEqual(await page.locator(".model-definition-name").allTextContents(), ["[根结构]", "[元素结构]"]);
  assert.equal(await page.locator('tr[data-definition-kind="root"] td').nth(1).innerText(), "数组");
  assert.equal(await page.locator('tr[data-definition-kind="root"] .model-definition-node-label').count(), 0);
  assert.equal(await page.locator('tr[data-definition-kind="element"] td').nth(1).innerText(), "对象");
  await page.getByRole("button", { name: "展开 [元素结构]", exact: true }).click();
  assert.deepEqual(await page.locator(".model-definition-name").allTextContents(), ["[根结构]", "[元素结构]", "value"]);
  await page.getByRole("button", { name: "全部收起", exact: true }).click();
  assert.deepEqual(await page.locator(".model-definition-name").allTextContents(), ["[根结构]"]);
  await page.getByRole("button", { name: "展开 [根结构]", exact: true }).click();
  assert.deepEqual(await page.locator(".model-definition-name").allTextContents(), ["[根结构]", "[元素结构]"]);
  await page.goto(`${fixture.origin}/projects/alpha/models?model=empty.json`);
  await showStructure(page);
  await page.getByText("未直接声明字段或元素结构。", { exact: true }).waitFor();
  assert.equal(await page.locator(".model-definition-table tbody td").getAttribute("colspan"), "5");
  assert.equal(await page.locator(".model-definition-structure > p").count(), 0);
  assert.equal(await page.locator(".model-definition-name").count(), 0);
  await page.goto(`${fixture.origin}/projects/beta/models?model=sales%2Forder.json`);
  await page.getByRole("heading", { name: "订单 Beta", exact: true }).waitFor();
  await showStructure(page);
  assert.deepEqual(await page.locator(".model-definition-name").allTextContents(), ["[根结构]"]);
  assert.equal(await page.locator('tr[data-definition-kind="root"] td').nth(1).innerText(), "数字");
  assert.equal(await page.locator(".model-definition-node-label").count(), 0);
}));

test("model source remains complete without a copy action or an intervening action row", async () => withView(async (page, fixture) => {
  await order(page, fixture);
  assert.equal(await page.getByRole("button", { name: "复制定义", exact: true }).count(), 0);
  assert.equal(await page.locator(".model-browser-description").evaluate(description => !!description.nextElementSibling?.querySelector('[role="radiogroup"]')), true);
  await page.getByRole("radio", { name: "原始定义", exact: true }).click();
  assert.equal(await page.locator(".model-browser-code").textContent(), fixture.source);
  assert.equal(await page.getByRole("button", { name: "复制定义", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "模型存储", exact: true }).count(), 0);
}));

test("model prototype keeps source viewing without a copy action or its empty header", async () => withView(async (page, fixture) => {
  await page.goto(`${fixture.origin}/projects/alpha/model-prototype?model=sales%2Forder.json`);
  await page.getByRole("heading", { name: "订单", exact: true }).waitFor();
  assert.deepEqual(await page.locator(".model-definition-table th").allTextContents(), ["字段 / 结构", "类型", "格式", "规则", "说明"]);
  assert.equal(await page.getByRole("button", { name: "复制定义", exact: true }).count(), 0);
  assert.equal(await page.locator(".model-prototype-code-header").count(), 0);
  assert.equal(await page.locator(".model-prototype-meta").evaluate(meta => !!meta.nextElementSibling?.querySelector('[role="radiogroup"]')), true);
  await page.getByRole("radio", { name: "原始定义", exact: true }).click();
  const source = JSON.parse(await page.locator(".model-prototype-code").innerText());
  assert.equal(source.title, "Order");
  assert.equal(source.properties.items.items.properties.productId.type, "string");
  assert.equal(await page.getByRole("button", { name: "复制定义", exact: true }).count(), 0);
}));

test("unsupported format and contentEncoding keywords are unavailable without altering their saved source", async () => withView(async (page, fixture) => {
  for (const [id, schema] of [
    ["format-root.json", { type: "string", format: "uuid" }],
    ["format-field.json", { type: "object", properties: { email: { type: "string", format: "email" } } }],
    ["custom-format.json", { type: "string", format: "<b>custom</b>" }],
    ["encoded.json", { type: "string", contentEncoding: "base64" }]
  ] as const) {
    const source = JSON.stringify(schema, null, 2);
    const path = join(fixture.root, "models/json-schema/draft-07", id);
    await writeFile(path, source);
    await unavailable(page, fixture, id);
    assert.equal(await readFile(path, "utf8"), source);
  }
  await order(page, fixture);
  assert.equal(await page.getByRole("columnheader", { name: "格式", exact: true }).count(), 1);
  assert.deepEqual(await page.locator(".model-definition-table tbody td:nth-child(3)").allTextContents(), ["—", "—"]);
}));

test("dynamic fields align with named fields and expand their values with local required flags", async () => withView(async (page, fixture) => {
  const source = JSON.stringify({ title: "字典结构", type: "object", properties: {
    labels: { type: "object", additionalProperties: { type: "string" } },
    products: { type: "object", properties: { count: { type: "integer" } }, additionalProperties: {
      type: "array", items: { type: "object", properties: { name: { type: "string" }, stock: { type: "integer" } }, required: ["name"] }
    } }
  }, required: ["labels"] });
  await writeFile(join(fixture.root, "models/json-schema/draft-07/dictionary.json"), source);
  await page.goto(`${fixture.origin}/projects/alpha/models?model=dictionary.json`);
  await page.getByRole("heading", { name: "字典结构", exact: true }).waitFor();
  await showStructure(page);
  const table = page.locator(".model-definition-table");
  assert.deepEqual(await table.locator(".model-definition-name").allTextContents(), ["labels", "products"]);
  assert.equal(await table.locator('tr[data-definition-kind="field"] td').nth(3).innerText(), "必填 · 键名可自定义，每个值都是文本。");
  await page.getByRole("button", { name: "展开 labels", exact: true }).focus();
  await page.keyboard.press("Enter");
  const scalar = table.locator('tr[data-definition-kind="dynamic-field"]');
  assert.deepEqual(await scalar.locator("td").allTextContents(), ["[动态字段]", "文本", "—", "—", "—"]);
  assert.equal(await page.getByRole("button", { name: "收起 labels", exact: true }).evaluate(button => button === document.activeElement), true);
  await page.getByRole("button", { name: "全部展开", exact: true }).click();
  assert.deepEqual(await table.locator(".model-definition-name").allTextContents(), ["labels", "[动态字段]", "products", "count", "[动态字段]", "[元素结构]", "name", "stock"]);
  const dynamicFields = table.locator('tr[data-definition-kind="dynamic-field"]');
  assert.equal(await dynamicFields.nth(1).getAttribute("data-definition-depth"), await table.locator("tbody tr").filter({ has: page.getByText("count", { exact: true }) }).getAttribute("data-definition-depth"));
  assert.equal(await dynamicFields.nth(1).getAttribute("data-definition-depth"), "1");
  assert.equal(await dynamicFields.nth(1).locator("td").nth(1).innerText(), "数组");
  assert.equal(await page.getByText("[字典值结构]", { exact: true }).count(), 0);
  assert.equal(await table.locator("tbody tr").filter({ hasText: "name" }).locator("td").nth(3).innerText(), "必填");
  assert.equal(await table.locator("tbody tr").filter({ hasText: "stock" }).locator("td").nth(3).innerText(), "—");
  assert.match(await table.innerText(), /键名可自定义，每个值都是文本/);
  assert.match(await table.innerText(), /未声明的键名可自定义，每个值都是数组/);
  assert.doesNotMatch(await table.innerText(), /additionalProperties|详见原始定义/);
  await page.getByRole("button", { name: "全部收起", exact: true }).click();
  assert.deepEqual(await table.locator(".model-definition-name").allTextContents(), ["labels", "products"]);
  await page.getByRole("radio", { name: "原始定义", exact: true }).click();
  assert.equal(await page.locator(".model-browser-code").textContent(), source);
}));

test("dictionary roots and boolean value schemas describe permitted dynamic keys without fabricating fields", async () => withView(async (page, fixture) => {
  const directory = join(fixture.root, "models/json-schema/draft-07");
  await writeFile(join(directory, "dictionary-root.json"), JSON.stringify({ title: "根字典", type: "object", additionalProperties: { type: "number" } }));
  await page.goto(`${fixture.origin}/projects/alpha/models?model=dictionary-root.json`);
  await page.getByRole("heading", { name: "根字典", exact: true }).waitFor();
  await showStructure(page);
  assert.deepEqual(await page.locator(".model-definition-name").allTextContents(), ["[动态字段]"]);
  assert.equal(await page.locator('tr[data-definition-kind="dynamic-field"] td').nth(1).innerText(), "数字");
  assert.equal(await page.locator(".model-definition-structure > p").count(), 0);
  await writeFile(join(directory, "open.json"), JSON.stringify({ title: "开放字典", type: "object", properties: {
    open: { type: "object", additionalProperties: true },
    closed: { type: "object", additionalProperties: false },
    typed: { type: "object", additionalProperties: { type: "integer" } }
  } }));
  await page.goto(`${fixture.origin}/projects/alpha/models?model=open.json`);
  await page.getByRole("heading", { name: "开放字典", exact: true }).waitFor();
  await showStructure(page);
  await page.getByRole("button", { name: "全部展开", exact: true }).click();
  const table = page.locator(".model-definition-table");
  assert.equal(await table.locator('tr[data-definition-kind="dynamic-field"]').count(), 2);
  assert.equal(await table.locator('tr[data-definition-kind="dynamic-field"] td').nth(1).innerText(), "—");
  assert.match(await table.innerText(), /键名可自定义，值不限类型/);
  assert.match(await table.innerText(), /不允许未声明的字段/);
  assert.match(await table.innerText(), /键名可自定义，每个值都是整数/);
  assert.equal(await table.getByText("^tag", { exact: true }).count(), 0);
  assert.doesNotMatch(await table.innerText(), /patternProperties: 详见原始定义/);
}));

test("boolean property, items and root schemas are unavailable under the same Runtime rules", async () => withView(async (page, fixture) => {
  for (const [id, schema] of [
    ["allow-root.json", true], ["deny-root.json", false],
    ["allow-property.json", { type: "object", properties: { allowed: true } }],
    ["deny-property.json", { type: "object", properties: { forbidden: false } }],
    ["deny-items.json", { type: "array", items: false }]
  ] as const) {
    await writeFile(join(fixture.root, "models/json-schema/draft-07", id), JSON.stringify(schema));
    await unavailable(page, fixture, id);
  }
}));

test("rules stay separate from author descriptions and optional fields remain unmarked", async () => withView(async (page, fixture) => {
  const schema = { title: "规则与说明", type: "object", properties: {
    optional: { type: "string", description: "<b>作者说明</b>" },
    bounded: { type: "number", minimum: 0, maximum: 10, description: "金额说明" },
    fixed: { type: "string", const: "card", description: "支付说明" },
    instanceBoolean: { type: "boolean", description: "真正的布尔值" }
  }, required: ["bounded"] };
  const source = JSON.stringify(schema, null, 2);
  await writeFile(join(fixture.root, "models/json-schema/draft-07/rules.json"), source);
  await page.goto(`${fixture.origin}/projects/alpha/models?model=rules.json`);
  await page.getByRole("heading", { name: "规则与说明", exact: true }).waitFor();
  await showStructure(page);
  const table = page.locator(".model-definition-table");
  assert.deepEqual(await table.locator("th").allTextContents(), ["字段 / 结构", "类型", "格式", "规则", "说明"]);
  for (const [name, rules, description] of [
    ["optional", "—", "<b>作者说明</b>"],
    ["bounded", "必填 · 最小值: 0 · 最大值: 10", "金额说明"],
    ["fixed", '固定值: "card"', "支付说明"],
    ["instanceBoolean", "—", "真正的布尔值"]
  ]) {
    const row = table.locator("tbody tr").filter({ has: page.getByText(name, { exact: true }) });
    assert.equal(await row.locator("td").nth(3).innerText(), rules);
    assert.equal(await row.locator("td").nth(4).innerText(), description);
  }
  assert.equal(await table.locator("td:last-child b").count(), 0);
  assert.equal(await table.getByText("可选", { exact: true }).count(), 0);
  assert.equal(await table.locator("td.model-definition-rules").first().evaluate(cell => {
    const style = getComputedStyle(cell);
    return parseFloat(style.minWidth) >= 8 * parseFloat(style.fontSize);
  }), true, "rules retain enough width for readable labels");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole("radio", { name: "原始定义", exact: true }).click();
  assert.equal(await page.locator(".model-browser-code").textContent(), source);
}));

test("enum types and candidate values remain visible with their authored descriptions", async () => withView(async (page, fixture) => {
  const schema = { title: "枚举展示", type: "object", properties: {
    text: { type: "string", enum: ["personal", "company"] },
    number: { type: "number", enum: [1.5, 2.5] },
    integer: { type: "integer", enum: [1, 2] },
    boolean: { type: "boolean", enum: [true] },
    formatted: { type: "string", enum: ["one@example.com", "two@example.com"], description: "业务说明" },
    literal: { type: "string", enum: ["<b>red</b>", "line\nbreak"] }
  } };
  const directory = join(fixture.root, "models/json-schema/draft-07");
  const source = JSON.stringify(schema, null, 2);
  await writeFile(join(directory, "enums.json"), source);
  await page.goto(`${fixture.origin}/projects/alpha/models?model=enums.json`);
  await page.getByRole("heading", { name: "枚举展示", exact: true }).waitFor();
  await showStructure(page);
  const table = page.locator(".model-definition-table");
  for (const [name, type, format, description] of [
    ["text", "文本枚举", '可选值: "personal", "company"', "—"],
    ["number", "数字枚举", "可选值: 1.5, 2.5", "—"],
    ["integer", "整数枚举", "可选值: 1, 2", "—"],
    ["boolean", "布尔枚举", "可选值: true", "—"],
    ["formatted", "文本枚举", '可选值: "one@example.com", "two@example.com"', "业务说明"],
  ]) {
    const row = table.locator("tbody tr").filter({ has: page.getByText(name, { exact: true }) });
    assert.equal(await row.locator("td").nth(1).innerText(), type);
    assert.equal(await row.locator("td").nth(2).textContent(), format);
    assert.equal(await row.locator("td").nth(4).innerText(), description);
  }
  assert.equal(await table.locator("td.model-definition-format b").count(), 0);
  assert.match(await table.innerText(), /<b>red<\/b>/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole("radio", { name: "原始定义", exact: true }).click();
  assert.equal(await page.locator(".model-browser-code").textContent(), source);
  await writeFile(join(directory, "enum-root.json"), '{"title":"根枚举","type":"number","enum":[1.5,2.5]}');
  await page.goto(`${fixture.origin}/projects/alpha/models?model=enum-root.json`);
  await page.getByRole("heading", { name: "根枚举", exact: true }).waitFor();
  await showStructure(page);
  assert.deepEqual(await page.locator('tr[data-definition-kind="root"] td').allTextContents(), ["[根结构]", "数字枚举", "可选值: 1.5, 2.5", "—", "—"]);
}));

test("model list filtering keeps a model without description readable and shows unmatched state", async () => withView(async (page, fixture) => {
  await order(page, fixture);
  const filter = page.getByRole("searchbox", { name: "搜索模型", exact: true });
  await filter.fill("sales/order");
  await page.locator('.mem-view-list-item[data-item-id="advanced.json"]').waitFor({ state: "detached" });
  assert.equal(await page.getByRole("button", { name: "订单 Alpha", exact: true }).count(), 1);
  await filter.fill("no matching id");
  await page.getByLabel("模型列表", { exact: true }).getByText("没有匹配的模型", { exact: true }).waitFor();
  await page.locator(".model-browser-body").getByText("没有匹配的模型", { exact: true }).waitFor();
  await filter.fill("");
  await page.getByRole("button", { name: "advanced.json", exact: true }).waitFor();
}));

test("a corrupt model remains selectable without preventing other definitions from opening", async () => withView(async (page, fixture) => {
  await order(page, fixture);
  await page.getByRole("button", { name: "bad.json", exact: true }).click();
  await page.getByText("读取模型失败", { exact: true }).waitFor();
  await page.getByRole("button", { name: "订单 Alpha", exact: true }).click();
  await page.getByRole("heading", { name: "订单 Alpha", exact: true }).waitFor();
  await showStructure(page);
}));

test("unsupported union roots remain listed as unavailable and cannot open a normal definition", async () => withView(async (page, fixture) => {
  await unavailable(page, fixture, "advanced.json", /anyOf/);
}));

test("union type arrays, anyOf and oneOf each fail the normal model read", async () => withView(async (page, fixture) => {
  for (const [id, field] of [
    ["nullable.json", { type: ["string", "null"] }],
    ["any-of.json", { anyOf: [{ type: "string" }, { type: "integer" }] }],
    ["one-of.json", { oneOf: [{ type: "string" }, { type: "integer" }] }]
  ] as const) {
    await writeFile(join(fixture.root, "models/json-schema/draft-07", id), JSON.stringify({ type: "object", properties: { value: field } }));
    await unavailable(page, fixture, id);
  }
}));

test("nested unsupported rules are not hidden by a supported parent schema", async () => withView(async (page, fixture) => {
  for (const [id, schema] of [
    ["nested-union.json", { type: "array", items: { oneOf: [{ type: "string" }, { type: "integer" }] } }],
    ["conditional.json", { type: "object", if: { type: "object" }, then: { type: "object" } }],
    ["all-of.json", { type: "number", allOf: [{ type: "number", minimum: 0 }] }],
    ["patterned.json", { type: "object", patternProperties: { "^tag": { type: "string" } } }]
  ] as const) {
    await writeFile(join(fixture.root, "models/json-schema/draft-07", id), JSON.stringify(schema));
    await unavailable(page, fixture, id);
  }
}));

test("built-in raw models show whole-content semantics without pretending to declare object fields", async () => withView(async (page, fixture) => {
  await page.goto(`${fixture.origin}/projects/alpha/models?model=memsphere%2Frun%2Fartifact.json`);
  await showStructure(page);
  await page.getByText("原始内容模型", { exact: true }).waitFor();
  assert.equal(await page.locator(".model-definition-table").count(), 0);
}));

test("model deep links preserve the selected Project and reload the correct definition", async () => withView(async (page, fixture) => {
  await page.goto(`${fixture.origin}/projects/beta/models?model=sales%2Forder.json`);
  await page.getByRole("heading", { name: "订单 Beta", exact: true }).waitFor();
  await showStructure(page);
  await order(page, fixture);
  await page.reload();
  await page.getByRole("heading", { name: "订单 Alpha", exact: true }).waitFor();
  await showStructure(page);
}));

test("leaving models removes its page marker and returning remounts a usable model view", async () => withView(async (page, fixture) => {
  await order(page, fixture);
  await page.getByRole("button", { name: "记忆", exact: true }).click();
  await page.waitForURL("**/memories");
  await page.locator("[data-models]").waitFor({ state: "detached" });
  await page.locator("[data-models-list]").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "模型", exact: true }).click();
  await page.getByRole("button", { name: "订单 Alpha", exact: true }).click();
  await page.getByRole("heading", { name: "订单 Alpha", exact: true }).waitFor();
  await showStructure(page);
}));

test("narrow model pages keep horizontal scrolling inside the field table", async () => withView(async (page, fixture) => {
  await order(page, fixture);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator(".model-definition-table-scroll").evaluate(element => element.scrollWidth > element.clientWidth), true);
}));

test("a late model definition response cannot replace the newer selected model", async () => withView(async (page, fixture) => {
  await order(page, fixture);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pattern = "**/api/projects/alpha/models/definition?model=advanced.json";
  await page.route(pattern, async route => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response }).catch(() => {}); // The superseded fetch may already be aborted.
  });
  try {
    const pending = page.waitForRequest(request => request.url().endsWith("definition?model=advanced.json"));
    await page.getByRole("button", { name: "advanced.json", exact: true }).click();
    await pending;
    await page.getByRole("button", { name: "订单 Alpha", exact: true }).click();
    await page.waitForURL(url => url.pathname.endsWith("/models") && url.searchParams.get("model") === "sales/order.json");
    release();
    await page.getByRole("heading", { name: "订单 Alpha", exact: true }).waitFor();
  await showStructure(page);
    assert.equal(await page.getByRole("heading", { name: "advanced.json", exact: true }).count(), 0);
  } finally { release(); await page.unroute(pattern); }
}));

test("saved Home language applies to the actual model browser and model storage settings", async () => withView(async (page, fixture) => {
  await page.goto(`${fixture.origin}/projects/alpha/settings/general`);
  await page.getByRole("combobox", { name: "工作语言", exact: true }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("heading", { name: "确认配置变更", exact: true }).waitFor();
  await page.getByRole("button", { name: "确认保存", exact: true }).click();
  await page.getByText("已保存", { exact: true }).waitFor();
  await order(page, fixture);
  assert.equal(await page.getByRole("button", { name: "Copy definition", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Expand all", exact: true }).click();
  assert.equal(await page.locator('tr[data-definition-kind="element"] .model-definition-name').innerText(), "[Item structure]");
  assert.equal(await page.locator('tr[data-definition-kind="element"] .model-definition-node-label').count(), 0);
  assert.equal(await page.getByRole("columnheader", { name: "Rules", exact: true }).count(), 1);
  assert.equal(await page.getByRole("columnheader", { name: "Format", exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Models", exact: true }).count(), 1);
  const html = await (await page.request.get(`${fixture.origin}/projects/alpha`)).text();
  assert.match(html, /"title":"Models","summary":"Browse project model definitions"/);
  await page.goto(`${fixture.origin}/projects/beta/models?model=sales%2Forder.json`);
  await page.getByRole("heading", { name: "订单 Beta", exact: true }).waitFor();
  await showStructure(page);
  assert.deepEqual(await page.locator(".model-definition-name").allTextContents(), ["[Root structure]"]);
  assert.equal(await page.locator('tr[data-definition-kind="root"] td').nth(1).innerText(), "Number");
  await writeFile(join(fixture.root, "models/json-schema/draft-07/dictionary-en.json"), JSON.stringify({ title: "Dictionary", type: "object", additionalProperties: { type: "string" } }));
  await page.goto(`${fixture.origin}/projects/alpha/models?model=dictionary-en.json`);
  await page.getByRole("heading", { name: "Dictionary", exact: true }).waitFor();
  await showStructure(page);
  assert.deepEqual(await page.locator(".model-definition-name").allTextContents(), ["[Dynamic field]"]);
  assert.equal(await page.locator(".model-definition-structure > p").count(), 0);
  await unavailable(page, fixture, "advanced.json", /anyOf/);
  await writeFile(join(fixture.root, "models/json-schema/draft-07/rules-en.json"), JSON.stringify({ title: "English rules", type: "object", properties: {
    status: { type: "string", enum: ["open", "closed"] },
    referenced: { $ref: "#/definitions/text" }, recursive: { $ref: "#" }
  }, definitions: { text: { type: "string" } } }));
  await page.goto(`${fixture.origin}/projects/alpha/models?model=rules-en.json`);
  await page.getByRole("heading", { name: "English rules", exact: true }).waitFor();
  await showStructure(page);
  const englishRow = (name: string) => page.locator(".model-definition-table tbody tr").filter({ has: page.getByText(name, { exact: true }) });
  assert.equal(await englishRow("referenced").locator("td").nth(1).innerText(), "String");
  assert.equal(await englishRow("referenced").locator("td").nth(2).innerText(), "—");
  assert.equal(await englishRow("referenced").locator("td").nth(3).innerText(), "Reference: #/definitions/text");
  assert.match(await englishRow("recursive").locator("td").nth(3).innerText(), /Recursive reference, expand to continue/);
  assert.equal(await page.locator(".model-definition-combination").count(), 0);
  assert.equal(await englishRow("status").locator("td").nth(1).innerText(), "String enum");
  assert.equal(await englishRow("status").locator("td").nth(2).innerText(), 'Allowed values: "open", "closed"');
  await page.goto(`${fixture.origin}/projects/alpha/settings/models`);
  await page.getByRole("textbox", { name: "Model directory", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Discard changes", exact: true }).count(), 1);
}));

test("Project model settings discard restores the saved directory without writing configuration", async () => withView(async (page, fixture) => {
  const directory = await settings(page, fixture);
  assert.equal(await directory.inputValue(), "models/json-schema/draft-07");
  assert.deepEqual(await page.locator(".settings-section").filter({ has: directory }).locator("dl dd").allTextContents(), [
    fixture.root,
    join(fixture.root, "models/json-schema/draft-07"),
  ]);
  await directory.fill("discarded");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  assert.equal(await directory.inputValue(), "models/json-schema/draft-07");
  assert.equal(JSON.parse(await readFile(join(fixture.root, "config.json"), "utf8")).modelsDirectory, undefined);
}));

test("Project model settings reject an empty directory before save confirmation", async () => withView(async (page, fixture) => {
  const directory = await settings(page, fixture);
  await directory.fill("");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.locator(".settings-error").waitFor();
  assert.equal(await page.getByRole("button", { name: "确认保存", exact: true }).count(), 0);
}));

test("confirmed model directory save switches the next refresh without migration or changes to other scopes", async () => withView(async (page, fixture) => {
  const directory = await settings(page, fixture);
  await directory.fill("custom");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("heading", { name: "确认配置变更", exact: true }).waitFor();
  await page.getByRole("button", { name: "确认保存", exact: true }).click();
  await page.getByText("已保存", { exact: true }).waitFor();
  await page.reload();
  await directory.waitFor();
  assert.equal(await directory.inputValue(), "custom");
  await page.getByRole("button", { name: "模型", exact: true }).click();
  await page.getByRole("button", { name: "新目录模型", exact: true }).click();
  await page.getByRole("heading", { name: "新目录模型", exact: true }).waitFor();
  await showStructure(page);
  assert.equal(await page.locator('.mem-view-list-item[data-item-id="sales/order.json"]').count(), 0);
  assert.equal(await readFile(join(fixture.root, "models/json-schema/draft-07/sales/order.json"), "utf8"), fixture.source);
  assert.equal(JSON.parse(await readFile(join(fixture.home, "config.json"), "utf8")).language, "zh-CN");
  assert.equal(JSON.parse(await readFile(join(fixture.home, "projects/beta/config.json"), "utf8")).modelsDirectory, undefined);
}));


test("model information is the default tab and orders identity, standard, tags and storage fields", async () => withView(async (page, fixture) => {
  await page.goto(`${fixture.origin}/projects/alpha/models?model=sales%2Forder.json`);
  const table = page.locator(".model-information-table");
  await table.waitFor();
  assert.deepEqual(await table.locator("th").allTextContents(), ["名称", "说明", "所属包", "模型 ID", "定义标准", "标签", "存储方式", "存储 ID"]);
  assert.deepEqual((await table.locator("td").allTextContents()).slice(3), ["sales/order.json", "json-schema/draft-07.json", "—", "持久化存储", "models/json-schema/draft-07"]);
  assert.equal(await page.getByRole("radio", { name: "模型信息", exact: true }).getAttribute("aria-checked"), "true");
  assert.equal(await page.locator(".model-definition-table").count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.goto(`${fixture.origin}/projects/alpha/models?scope=memsphere.builtin&model=memsphere%2Fmodel-registration.json`);
  await table.waitFor();
  const row = (label: string) => table.locator("tr").filter({ has: page.getByRole("rowheader", { name: label, exact: true }) }).locator("td");
  assert.equal(await row("模型 ID").innerText(), "memsphere/model-registration.json");
  assert.equal(await row("存储方式").innerText(), "持久化存储");
  assert.equal(await row("存储 ID").innerText(), "models/system/json-schema/draft-07");
  await showStructure(page);
  assert.deepEqual(await page.locator(".model-definition-name").allTextContents(), ["modelRef", "name", "description", "package", "package_name", "tags", "storage", "store_id"]);
}));
