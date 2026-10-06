import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { startProjectModelView } from './fixtures/project-model-view.js';
import { initializeProjectModelRegistrations, createModelRegistrationStore, type ModelRegistration } from '../src/project/model-registration.js';
async function fixture(run: (page: import('playwright').Page, origin: string) => Promise<void>, requireToken = false) {
    const view = await startProjectModelView(async (config) => {
        if (requireToken) config.view = { host: '0.0.0.0', port: 0, operatorToken: 'fixture-token' };
        await rm(join(config.scopeRoot, 'models/json-schema/draft-07/bad.json'));
        const result = await initializeProjectModelRegistrations({}, { root: config.scopeRoot });
        const file = JSON.parse(await readFile(config.configPath, 'utf8'));
        await writeFile(config.configPath, JSON.stringify({ ...file, modelRegistration: result.config }));
        const store = await createModelRegistrationStore({}, 'memsphere/model-registrations/project', join(config.scopeRoot, 'models/registrations/project'));
        for (const item of (await store.list({})).items) {
            const record = await store.get({}, item.id);
            const r = record?.value as ModelRegistration;
            if (r.modelRef === 'sales/order.json')
                await store.update({}, item.id, { ...r, name: '订单 Alpha', description: '订购与支付', package: 'project.orders', package_name: '订单管理', tags: ['订单', '交易', '示例'] });
        }
    });
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    if (requireToken) await page.addInitScript(() => sessionStorage.setItem('memsphere.settingsToken.v1', 'fixture-token'));
    try {
        await run(page, view.origin);
    }
    finally {
        await browser.close();
        await view.close();
    }
}
test('Models combine package scope, exact tags and managed search and restore search from URL', async () => fixture(async (page, origin) => {
    await page.goto(`${origin}/projects/alpha/models?scope=project:project.orders&model=sales%2Forder.json`);
    await page.getByRole('heading', { name: '订单 Alpha', exact: true }).waitFor();
    const search = page.getByRole('searchbox', { name: '搜索模型', exact: true });
    await search.fill('支付');
    await page.waitForURL(url => url.searchParams.get('q') === '支付');
    await page.getByRole('combobox', { name: '标签筛选', exact: true }).selectOption('订单');
    await page.waitForURL(url => url.searchParams.get('tag') === '订单');
    await page.reload();
    await page.getByRole('heading', { name: '订单 Alpha', exact: true }).waitFor();
    assert.equal(await search.inputValue(), '支付');
    assert.equal(await page.getByRole('combobox', { name: '标签筛选' }).inputValue(), '订单');
    await search.fill('不存在');
    await page.getByText('没有匹配的模型', { exact: true }).first().waitFor();
    assert.equal(await search.evaluate(el => el === document.activeElement), true, 'search keeps focus through route rendering');
    await search.fill('');
    await page.getByRole('heading', { name: '订单 Alpha', exact: true }).waitFor();
}));
test('Model list shows only two tags plus accessible overflow, and information defaults to the agreed field order', async () => fixture(async (page, origin) => {
    await page.goto(`${origin}/projects/alpha/models?scope=project:project.orders&model=sales%2Forder.json`);
    await page.getByRole('heading', { name: '订单 Alpha', exact: true }).waitFor();
    assert.deepEqual(await page.locator('.model-information-table th').allTextContents(), ['名称', '说明', '所属包', '模型 ID', '定义标准', '标签', '存储方式', '存储 ID']);
    const list = page.getByRole('region', { name: '模型列表', exact: true });
    assert.deepEqual(await list.locator('.mem-view-badge').allTextContents(), ['订单', '交易', '+1']);
    assert.equal(await list.locator('.mem-view-badge').last().getAttribute('title'), '示例');
    await page.getByRole('combobox', { name: '标签筛选', exact: true }).click();
    await page.getByRole('listbox').waitFor();
    await page.getByRole('listbox').getByRole('option', { name: '交易', exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('tag') === '交易');
    assert.doesNotMatch(await list.innerText(), /json-schema\/draft-07/);
    await page.getByRole('radio', { name: '模型结构', exact: true }).click();
    await page.locator('.model-definition-table').waitFor();
    await page.getByRole('radio', { name: '模型信息', exact: true }).click();
    await page.locator('.model-information-table').waitFor();
}));
test('The market supplies one example package with the order use case and keeps discovery separate from installed packages', async () => fixture(async (page, origin) => {
    await page.goto(`${origin}/projects/alpha/models/market`);
    await page.getByRole('heading', { name: '示例模型', exact: true }).waitFor();
    assert.equal(await page.locator('.model-market-card').count(), 1);
    assert.equal(await page.getByRole('heading', { name: '订单示例', exact: true }).count(), 0);
    const secondary = page.getByRole('complementary', { name: 'Secondary navigation', exact: true });
    assert.equal(await secondary.getByRole('navigation').getByRole('separator').count(), 1, 'market is separated from package groups');
    assert.equal(await secondary.getByRole('button', { name: '模型市场', exact: true }).evaluate(button => button.previousElementSibling?.textContent), '发现');
    const examples = page.locator('.model-market-card');
    await examples.getByRole('button', { name: '预览', exact: true }).click();
    await examples.getByRole('heading', { name: '用例 02 · 订单与深层嵌套', exact: true }).waitFor();
    const models = await (await page.request.get(`${origin}/api/projects/alpha/models`)).json();
    assert.equal(models.models.some((model: { origin: string }) => model.origin === 'market'), false, 'preview does not import market models');
}));

test('The eight examples remain previewable, while unsupported package import reports failure and publishes none', async () => fixture(async (page, origin) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/projects/alpha/models/market`);
    const examples = page.locator('.model-market-card').filter({ has: page.getByRole('heading', { name: '示例模型', exact: true }) });
    await examples.getByRole('button', { name: '预览', exact: true }).click();
    await examples.locator('.model-definition-table').last().waitFor();
    assert.equal(await examples.getByRole('heading', { level: 4 }).count(), 8);
    assert.equal(await examples.locator('.model-definition-table').count(), 8);
    const before = await (await page.request.get(`${origin}/api/projects/alpha/models`)).json();
    for (let attempt = 0; attempt < 2; attempt++) {
        const response = page.waitForResponse(response => response.url().endsWith('/models/market/import'));
        await examples.getByRole('button', { name: '导入', exact: true }).click();
        const result = await response;
        assert.equal(result.status(), 422);
        assert.equal((await result.json()).code, 'MODEL_RUNTIME_UNSUPPORTED');
        await page.getByRole('status').filter({ hasText: /Unsupported|Runtime|unsupported/ }).waitFor();
        const after = await (await page.request.get(`${origin}/api/projects/alpha/models`)).json();
        assert.deepEqual(after.models, before.models);
        assert.equal(after.models.some((model: { origin: string }) => model.origin === 'market'), false);
    }
    assert.deepEqual(errors, []);
}, true));
