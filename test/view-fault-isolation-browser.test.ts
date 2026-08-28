import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { chromium, type Page } from "playwright";
import { renderBrowserHtml } from "../src/view/browser.js";

test("View keeps Memory usable until an unavailable ChangeSet is selected", async () => {
  await withFaultIsolationView(async ({ page, origin }) => {
    await page.goto(`${origin}/memories`);
    await page.getByRole("button", { name: "demo-memory", exact: true }).waitFor();
    assert.equal(await page.getByText("invalid persisted ChangeSet", { exact: false }).count(), 0);
    assert.equal(await page.getByText("Failed to load Memsphere", { exact: true }).count(), 0);
    const summaries = await page.locator("summary").allTextContents();
    assert.ok(summaries.some((summary) => summary.includes("Other ChangeSet")), JSON.stringify(summaries));
    await page.locator("summary").filter({ hasText: "Other ChangeSet" }).click();
    await page.getByRole("button", { name: /change-invalid.*ChangeSet unavailable/ }).click();
    await page.locator("#detail.error-panel").waitFor();
    assert.equal(new URL(page.url()).pathname, "/projects/demo/changes/change-invalid");
    assert.match(await page.locator("#detail").textContent() ?? "", /invalid persisted ChangeSet/);
  });
});

test("View keeps Running usable when one Run detail is invalid", async () => {
  await withFaultIsolationView(async ({ page, origin }) => {
    await page.goto(`${origin}/tasks`);
    await page.getByRole("button", { name: /Invalid historical Run/ }).waitFor();
    await page.locator("#detail.error-panel").waitFor();
    assert.match(await page.locator("#detail").textContent() ?? "", /invalid persisted Run detail/);
    assert.equal(await page.getByText("Failed to load Memsphere", { exact: true }).count(), 0);
  });
});

async function withFaultIsolationView(
  run: (fixture: { page: Page; origin: string }) => Promise<void>
): Promise<void> {
  const runId = "run-invalid-detail";
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/api/projects") {
      sendJson(response, 200, { current: "demo", projects: [{ name: "demo", root: "/demo", missing: false }] });
      return;
    }
    if (url.pathname === "/api/memories") {
      sendJson(response, 200, {
        memoryRoot: "/demo/memory",
        memories: [{
          id: "concepts/demo-memory",
          kind: "concepts",
          path: "concepts/demo-memory.yaml",
          system: false,
          names: ["demo-memory"]
        }]
      });
      return;
    }
    if (url.pathname === "/api/memories/concepts/demo-memory") {
      sendJson(response, 200, {
        memory: {
          id: "concepts/demo-memory",
          kind: "concepts",
          path: "concepts/demo-memory.yaml",
          system: false,
          entity: { names: ["demo-memory"], defines: ["A valid Memory remains visible."] }
        }
      });
      return;
    }
    if (url.pathname === "/api/changes") {
      sendJson(response, 200, {
        changes: [{
          id: "change-invalid",
          status: "unavailable",
          active: false,
          memoryPaths: [],
          error: "invalid persisted ChangeSet"
        }]
      });
      return;
    }
    if (url.pathname === "/api/runs" && url.searchParams.get("representation") === "summary") {
      sendJson(response, 200, {
        runs: [{
          id: runId,
          name: "Invalid historical Run",
          status: "running",
          procedureName: "legacy-procedure",
          createdAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T00:00:00.000Z",
          readOnly: false,
          eventCount: 1
        }]
      });
      return;
    }
    if (url.pathname === `/api/runs/${runId}`) {
      sendJson(response, 500, { error: "invalid persisted Run detail" });
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(renderBrowserHtml("en"));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await run({ page, origin: `http://127.0.0.1:${port}` });
  } finally {
    await browser.close();
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    });
  }
}

function sendJson(response: import("node:http").ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
