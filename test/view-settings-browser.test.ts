import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { readConfigAt } from "../src/config.js";
import { createViewServer } from "../src/commands/view.js";

test("Settings browser preserves omitted sections and stays responsive", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-settings-browser-"));
  const configPath = join(dir, "config.json");
  await writeFile(configPath, `${JSON.stringify({ memoryRoot: "memory" }, null, 2)}\n`);
  await Promise.all([
    mkdir(join(dir, "memory", "procedures"), { recursive: true }),
    mkdir(join(dir, "memory", "schemas"), { recursive: true }),
    mkdir(join(dir, "memory", "concepts"), { recursive: true }),
    mkdir(join(dir, "memory", "statements"), { recursive: true }),
    mkdir(join(dir, "reviews"), { recursive: true }),
    mkdir(join(dir, "runs"), { recursive: true })
  ]);

  const config = await readConfigAt(configPath);
  const server = createViewServer(config);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
    await page.click("#settings-tab");

    await page.getByRole("button", { name: "View 服务", exact: true }).click();
    assert.equal(await page.getByText("当前运行地址").count(), 0);
    assert.equal(await page.getByText("保存并重启后地址").count(), 0);
    await page.getByRole("button", { name: "参与者配置", exact: true }).click();
    await page.getByRole("button", { name: "概览", exact: true }).click();
    const overview = page.locator(".settings-section").last();
    assert.equal(await overview.getByText("配置文件", { exact: true }).count(), 1);
    assert.equal(await overview.getByText("配置作用域", { exact: true }).count(), 1);
    assert.equal(await overview.getByText("当前可管理配置", { exact: true }).count(), 0);
    assert.equal(await overview.getByText("Memory", { exact: true }).count(), 0);
    assert.equal(await overview.getByText("Reviews", { exact: true }).count(), 0);
    assert.equal(await overview.getByText("Runs", { exact: true }).count(), 0);
    assert.equal(await overview.getByText("Archives", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "存储", exact: true }).click();
    assert.equal(await page.getByRole("checkbox", { name: "使用默认值" }).count(), 4);
    await page.getByRole("button", { name: "概览", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "重新读取", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "保存", exact: true }).count(), 0);
    await page.getByRole("button", { name: "存储", exact: true }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click();

    await page.getByRole("heading", { name: "确认配置变更" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "确认保存" }).isDisabled(), true);
    assert.equal(await page.locator(".settings-change-list").textContent(), "没有配置变化。");
    await page.getByRole("button", { name: "返回编辑" }).click();
    assert.match(await page.locator("#settings-status").textContent() ?? "", /没有未保存修改/);
    assert.match(await page.locator("#settings-status").textContent() ?? "", /错误 0/);

    await page.getByRole("button", { name: "参与者配置", exact: true }).click();
    await page.getByRole("button", { name: "启用参与者配置" }).click();
    assert.equal(await page.getByText("执行者", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Runner", { exact: true }).count(), 0);
    let runnerParticipant = page.locator(".settings-participant").first();
    await runnerParticipant.locator("summary").click();
    await runnerParticipant.getByRole("checkbox", { name: "artifact.read", exact: true }).check();
    runnerParticipant = page.locator(".settings-participant").first();
    assert.equal(
      await runnerParticipant.getByRole("checkbox", { name: "artifact.read", exact: true }).isChecked(),
      true
    );
    assert.equal(await runnerParticipant.getByRole("button", { name: "删除", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "添加参与者" }).click();
    let participant = page.locator(".settings-participant").last();
    const editableId = participant.getByLabel("ID", { exact: true });
    await editableId.click();
    await editableId.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await editableId.pressSequentially("traex-new");
    assert.equal(await editableId.inputValue(), "traex-new");
    assert.equal(await editableId.evaluate(element => document.activeElement === element), true);
    await editableId.press("Tab");
    participant = page.locator(".settings-participant").last();
    assert.equal(await participant.getByLabel("ID", { exact: true }).inputValue(), "traex-new");
    await participant.getByRole("combobox", { name: "类型", exact: true }).click();
    await participant.getByRole("option", { name: "Agent", exact: true }).click();
    participant = page.locator(".settings-participant").last();
    assert.equal(await participant.getByText("ACP Provider", { exact: true }).count(), 1);
    assert.equal(await participant.getByText("Model", { exact: true }).count(), 1);
    assert.equal(await participant.getByText("Prompt version", { exact: true }).count(), 0);
    assert.equal(await participant.getByText("Command", { exact: true }).count(), 0);
    assert.equal(await participant.getByText("Args（每行一个）", { exact: true }).count(), 0);
    const provider = participant.getByRole("combobox", { name: "ACP Provider", exact: true });
    assert.equal((await provider.textContent())?.trim(), "traex · Traex · 待检测⌄");
    await provider.click();
    const providerMenu = participant.getByRole("listbox", { name: "ACP Provider", exact: true });
    const providerBox = await provider.boundingBox();
    const providerMenuBox = await providerMenu.boundingBox();
    assert.ok(providerBox && providerMenuBox);
    assert.ok(providerMenuBox.y >= providerBox.y + providerBox.height);
    assert.ok(Math.abs(providerMenuBox.width - providerBox.width) < 2);
    await page.keyboard.press("Escape");
    assert.match(await page.locator("#settings-status").textContent() ?? "", /未保存修改/);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const idBox = await participant.getByLabel("ID", { exact: true }).boundingBox();
    const typeBox = await participant.getByRole("combobox", { name: "类型", exact: true }).boundingBox();
    const nameBox = await participant.getByLabel("名称", { exact: true }).boundingBox();
    const promptBox = await participant.getByLabel("System prompt", { exact: true }).boundingBox();
    assert.ok(idBox && typeBox && nameBox && idBox.width <= 360);
    assert.ok(Math.abs(idBox.y - typeBox.y) < 2);
    assert.ok(Math.abs(idBox.y - nameBox.y) < 2);
    assert.ok(promptBox && promptBox.width > idBox.width * 2);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.getByRole("button", { name: "ACP Provider", exact: true }).click();
    let traexProvider = page.locator(".settings-provider").filter({ hasText: "traex" }).first();
    await traexProvider.locator("summary").click();
    assert.equal(await page.getByRole("button", { name: "添加 Provider", exact: true }).count(), 0);
    assert.equal(await traexProvider.getByLabel("ID", { exact: true }).count(), 0);
    assert.equal(await traexProvider.getByRole("combobox", { name: "类型", exact: true }).count(), 0);
    const providerCommand = traexProvider.getByLabel("Command", { exact: true });
    assert.equal(await providerCommand.inputValue(), "traex");
    assert.equal(await providerCommand.isDisabled(), true);
    await traexProvider.getByLabel("Args（每行一个）", { exact: true }).fill("--verbose");
    traexProvider = page.locator(".settings-provider").filter({ hasText: "traex" }).first();
    const resetProvider = traexProvider.getByRole("button", { name: "恢复默认值", exact: true });
    assert.equal(await resetProvider.isDisabled(), false);
    assert.match(await traexProvider.locator("summary").textContent() ?? "", /待重新检测/);
    await page.getByRole("button", { name: "自动检测", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "自动检测", exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "重新检测", exact: true }).count(), 0);
    assert.equal(
      await traexProvider.locator(".settings-provider-preview").textContent(),
      "实际启动：traex --sandbox workspace-write --ask-for-approval never -c 'model=\"<参与者模型>\"' --verbose acp serve"
    );
    await resetProvider.click();
    traexProvider = page.locator(".settings-provider").filter({ hasText: "traex" }).first();
    assert.equal(await traexProvider.evaluate(element => (element as HTMLDetailsElement).open), true);
    assert.equal(await traexProvider.getByRole("button", { name: "恢复默认值", exact: true }).isDisabled(), true);
    assert.match(await traexProvider.locator("summary").textContent() ?? "", /待重新检测/);

    const codexProvider = page.locator(".settings-provider").filter({ hasText: "codex" }).first();
    await codexProvider.locator("summary").click();
    assert.equal(
      await codexProvider.locator(".settings-provider-preview").textContent(),
      "实际启动：'CODEX_CONFIG={\"model\":\"<参与者模型>\"}' NO_BROWSER=1 "
        + "INITIAL_AGENT_MODE=read-only codex-acp"
    );

    await page.getByRole("button", { name: "View 服务", exact: true }).click();
    const portInputBox = await page.getByLabel("Port", { exact: true }).boundingBox();
    const defaultViewBox = await page.getByText("使用默认 View 配置", { exact: true }).boundingBox();
    assert.ok(portInputBox && defaultViewBox);
    assert.ok(defaultViewBox.y >= portInputBox.y + portInputBox.height + 12);
    await page.getByText("使用默认 View 配置", { exact: true }).click();
    await page.locator(".settings-field").filter({ hasText: "Port" }).locator("input").fill("-1");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#settings-status")?.textContent?.includes("错误 0"));
    assert.doesNotMatch(await page.locator("#settings-status").textContent() ?? "", /错误 0/);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(await page.evaluate(() => ({
      body: document.body.scrollWidth - document.body.clientWidth,
      detail: document.querySelector<HTMLElement>("#detail")!.scrollWidth
        - document.querySelector<HTMLElement>("#detail")!.clientWidth
    })), { body: 0, detail: 0 });
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("Settings browser shows an inline error for an invalid operator token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-settings-token-browser-"));
  const configPath = join(dir, "config.json");
  await writeFile(configPath, `${JSON.stringify({
    memoryRoot: "memory",
    view: { host: "0.0.0.0", port: 30002 }
  }, null, 2)}\n`);
  await Promise.all([
    mkdir(join(dir, "memory", "procedures"), { recursive: true }),
    mkdir(join(dir, "memory", "schemas"), { recursive: true }),
    mkdir(join(dir, "memory", "concepts"), { recursive: true }),
    mkdir(join(dir, "memory", "statements"), { recursive: true }),
    mkdir(join(dir, "reviews"), { recursive: true }),
    mkdir(join(dir, "runs"), { recursive: true })
  ]);

  const config = await readConfigAt(configPath);
  const settingsToken = "correct-settings-token";
  const server = createViewServer(config, { settingsToken });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
    await page.click("#settings-tab");

    let tokenInput = page.getByLabel("操作令牌", { exact: true });
    await page.reload({ waitUntil: "domcontentloaded" });
    tokenInput = page.getByLabel("操作令牌", { exact: true });
    await tokenInput.waitFor();
    assert.equal(await page.getByText("配置尚未加载。", { exact: true }).count(), 0);
    assert.equal(await page.getByText("操作令牌不正确，请检查后重试。", { exact: true }).count(), 0);
    await page.getByText("memsphere view status", { exact: true }).waitFor();
    assert.equal(await page.getByText("node dist/cli.js view status", { exact: true }).count(), 0);

    await tokenInput.fill("wrong-token");
    await page.getByRole("button", { name: "进入配置中心", exact: true }).click();
    const error = page.getByText("操作令牌不正确，请检查后重试。", { exact: true });
    await error.waitFor();
    assert.equal(await error.getAttribute("role"), "alert");
    assert.equal(await tokenInput.getAttribute("aria-invalid"), "true");

    await tokenInput.fill(settingsToken);
    assert.equal(await error.count(), 0);
    assert.equal(await tokenInput.getAttribute("aria-invalid"), null);
    assert.equal(await tokenInput.getAttribute("aria-describedby"), null);
    await page.getByRole("button", { name: "进入配置中心", exact: true }).click();
    await page.getByText("磁盘配置", { exact: false }).first().waitFor();
    assert.equal(await page.getByText("操作令牌不正确，请检查后重试。", { exact: true }).count(), 0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("磁盘配置", { exact: false }).first().waitFor();
    assert.equal(await page.getByLabel("操作令牌", { exact: true }).count(), 0);
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
