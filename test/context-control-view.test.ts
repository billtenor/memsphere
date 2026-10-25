import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { businessFixture } from "./helpers/business-data.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";
import { openContextControl } from "../src/project/context-control.js";
import { textContent } from "../src/context_control/types.js";
import { readProjectConfig } from "../src/config.js";
import { createViewServer } from "../src/commands/view.js";
import { startRun, reportRun, readRun } from "../src/run/store.js";
import { archiveRun } from "../src/archive/store.js";

for (const archived of [false, true]) {
  test(`View rejects shared Run IDs for content and download when the legacy source is ${archived ? "archived" : "active"}`, async t => {
    const f = await businessFixture(t, {}); const config = await readProjectConfig("test-project", f.home);
    await mkdir(join(config.memoryRoot, "procedures"), { recursive: true });
    await writeFile(join(config.memoryRoot, "procedures", "source-check.yaml"), withCurrentMemorySyntax(`!procedure
name: source-check
flow:
  - !action
    action: Produce a result.
    artifact: !artifact
      name: result
      format: markdown
`));
    const legacy = await startRun({ name: "旧流程", memoryRoot: config.memoryRoot, runsRoot: config.runsRoot, procedureName: "source-check" });
    if (archived) {
      await reportRun({ runsRoot: config.runsRoot, runId: legacy.id, artifact: { kind: "inline", value: "旧来源正文" } });
      await archiveRun({ archiveRoot: config.archiveRoot, runsRoot: config.runsRoot, id: legacy.id });
    }
    const service = (await openContextControl(f.root, true))!;
    await service.stores.run.create({}, legacy.id, { id: legacy.id, name: "同ID新来源", status: "running", language: "zh-CN", createdAt: new Date().toISOString() });
    const artifact = (await service.report(legacy.id, { name: "产物", content: textContent("禁止泄露的新来源正文") })).artifact;
    const server = createViewServer(config);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/test-project/runs/${legacy.id}`;
    try {
      for (const suffix of ["", `/artifacts/${artifact.id}/content`, `/artifacts/${artifact.id}/content?download=1`]) {
        const response = await fetch(`${base}${suffix}`);
        assert.equal(response.status, 500);
        const body = await response.text(); assert.match(body, /both legacy and model Stores/);
        assert.doesNotMatch(body, /禁止泄露的新来源正文|旧来源正文/);
        assert.equal(response.headers.get("content-disposition"), null);
      }
      if (!archived) {
        const response = await fetch(`${base}/abandon`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        assert.equal(response.status, 500);
        assert.equal((await readRun(config.runsRoot, legacy.id)).status, "running");
      }
      // An unambiguous model source still previews and downloads its original bytes.
      const model = await service.start("无冲突新来源");
      const valid = (await service.report(model.id, { name: "正常正文", content: textContent("正常正文") })).artifact;
      const content = `${base.replace(legacy.id, model.id)}/artifacts/${valid.id}/content`;
      assert.equal((await (await fetch(content)).json()).content, "正常正文");
      const download = await fetch(`${content}?download=1`); assert.equal(download.status, 200);
      assert.equal(await download.text(), "正常正文"); assert.equal(download.headers.get("content-disposition"), "attachment");
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
}
