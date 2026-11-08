import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browserScope } from './helpers/browser.js';
async function fixture(mode: 'normal' | 'resource-failure' | 'layout-failure' = 'normal') {
    const source = fileURLToPath(new URL('../modules/shared/view/procedure-graph.ts', import.meta.url));
    const layout = fileURLToPath(new URL('../modules/shared/view/graph-layout.ts', import.meta.url));
    const [ui, engine] = await Promise.all([build({ stdin: { contents: `import {createProcedureGraph} from ${JSON.stringify(source)}; const p={actions:[{id:'a',description:'保留业务原文',actor:'agent',dependencies:[{from:'START'}],artifact:{name:'真实产物'}},{id:'b',description:'第二项',dependencies:[{from:'a',when:'artifacts.a.ok = true'},{from:'a'}],collect:['a']}]}; document.body.append(createProcedureGraph(p,{locale:new URLSearchParams(location.search).get('locale')||'zh-CN'}).element);`, resolveDir: process.cwd() }, bundle: true, format: 'esm', write: false }), build({ entryPoints: [layout], bundle: true, format: 'esm', write: false })]);
    let fail = mode !== 'normal';
    const server = createServer((req, res) => {
        const path = new URL(req.url!, 'http://local').pathname;
        if (path === '/recover') {
            fail = false;
            res.end('ok');
            return;
        }
        if (path === '/assets/procedure-graph-layout.js' && fail) {
            res.setHeader('content-type', 'text/javascript');
            if (mode === 'resource-failure') {
                res.statusCode = 503;
                res.end('unavailable');
            }
            else
                res.end('export async function layoutGraph(){throw Error("Controlled layout failure")}');
            return;
        }
        res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : 'text/html');
        res.end(path === '/ui.js' ? ui.outputFiles[0].text : path === '/assets/procedure-graph-layout.js' ? engine.outputFiles[0].text : '<html><body><script type="module" src="/ui.js"></script></body></html>');
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>(r => server.close(() => r())) };
}
test('canvas exposes definitions and raw conditions through the keyboard in either locale', async () => {
    const f = await fixture(), browser = await browserScope();
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        for (const locale of ['zh-CN', 'en']) {
            await page.goto(`${f.url}/?locale=${locale}`);
            await page.locator('.pg-edge').first().waitFor();
            assert.equal(await page.locator('.pg-tools button').count(), 0);
            const viewport = page.locator('.pg-viewport');
            const box = (await viewport.boundingBox())!;
            await page.mouse.move(box.x + Math.min(280, box.width - 20), box.y + box.height - 30);
            await page.mouse.down();
            await page.mouse.move(box.x + Math.min(280, box.width - 20) - 100, box.y + box.height - 30);
            await page.mouse.up();
            assert.ok(await viewport.evaluate(el => el.scrollLeft) > 0);
            assert.equal(await viewport.evaluate(el => getComputedStyle(el).cursor), 'grab');
            assert.equal(await page.locator('.pg-node[data-action-id=a] strong').innerText(), '真实产物');
            assert.equal(await page.locator('.pg-node[data-action-id=a] .pg-node-caption').innerText(), '保留业务原文');
            assert.equal(await page.locator('.pg-node small').count(), 0);
            await page.getByRole('button', { name: locale === 'en' ? 'Zoom out' : '缩小', exact: true }).click();
            assert.equal(await page.locator('.pg-world').evaluate(e => e.style.transform), 'scale(0.9)');
            await page.getByRole('button', { name: '100%', exact: true }).click();
            assert.equal(await page.locator('.pg-world').evaluate(e => e.style.transform), 'scale(1)');
            const action = page.locator('.pg-node[data-action-id=a]');
            await action.focus();
            await page.keyboard.press('Enter');
            assert.equal(await page.locator('.pg-dialog h3').innerText(), '保留业务原文');
            await page.keyboard.press('Escape');
            assert.equal(await action.evaluate(e => e === document.activeElement), true);
            await page.locator('.pg-condition').focus();
            await page.keyboard.press('Enter');
            const body = await page.locator('.pg-dialog').innerText();
            assert.ok(body.includes('artifacts.a.ok = true'));
            assert.ok(body.includes(locale === 'en' ? 'Condition' : '条件'));
            await page.keyboard.press('Escape');
            await page.locator('.pg-hit').first().dispatchEvent('pointerenter');
            assert.equal(await page.locator('.pg-hit').first().evaluate(e => getComputedStyle(e).stroke), 'rgba(0, 0, 0, 0)');
        }
    }
    finally {
        await browser.close();
        await f.close();
    }
});
for (const mode of ['resource-failure', 'layout-failure'] as const)
    test(`failed ${mode} keeps all nodes and relations keyboard-accessible`, async () => {
        const f = await fixture(mode), browser = await browserScope();
        try {
            const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
            await page.goto(f.url);
            await page.locator('.pg[data-layout-state=failed]').waitFor();
            assert.equal(await page.locator('.pg-node:visible').count(), 2);
            assert.equal(await page.locator('.pg-fallback-relations button').count(), 4);
            for (const id of ['a', 'b']) {
                await page.locator(`.pg-node[data-action-id=${id}]`).focus();
                await page.keyboard.press('Enter');
                await page.locator('.pg-dialog[open]').waitFor();
                await page.keyboard.press('Escape');
            }
            await page.locator('.pg-fallback-relations button[data-edge="b:0:a"]').focus();
            await page.keyboard.press('Enter');
            assert.ok((await page.locator('.pg-dialog').innerText()).includes('artifacts.a.ok = true'));
            await page.keyboard.press('Escape');
            if (mode === 'resource-failure') {
                await page.request.get(`${f.url}/recover`);
                await page.getByRole('button', { name: '重试', exact: true }).click();
                await page.locator('.pg-edge').first().waitFor();
                assert.equal(await page.locator('.pg-fallback-relations').count(), 0);
            }
        }
        finally {
            await browser.close();
            await f.close();
        }
    });
