import assert from "node:assert/strict";
import test from "node:test";
import { renderViewHostHtml, type ViewHostBootInstance } from "../src/view/host.js";

const instances: ViewHostBootInstance[] = [
  instance("org.memsphere.memory", "memory", "memory", "/memories", "Memory", "brain"),
  instance("org.memsphere.run", "run", "tasks", "/tasks", "Run", "play-circle"),
  instance("org.memsphere.settings", "settings", "settings", "/settings/:module", "Settings", "gear-six", { module: "general" })
];

test("View Shell exposes the four-column Slot and search surfaces", () => {
  const html = renderViewHostHtml("zh-CN", instances, "/memories");

  assert.match(html, /data-view-layout="module"/);
  assert.match(html, /data-view-slot="navigation\.primary"/);
  assert.match(html, /data-view-slot="navigation\.secondary"/);
  assert.match(html, /data-view-slot="content\.list"/);
  assert.match(html, /id="memsphere-view-root"/);
  assert.match(html, /data-view-search-trigger/);
  assert.match(html, /data-view-search-overlay[^>]*hidden/);
  assert.match(html, /data-view-slot="search\.providers"/);
  assert.match(html, /data-view-search-empty/);
  assert.match(html, /data-view-search-results/);
  assert.match(html, /data-view-search-status/);
  assert.match(html, /data-view-project-details[^>]*hidden/);
  assert.match(html, /data-project-detail="root"/);
  assert.match(html, /data-project-detail="store"/);
});

test("Project Home and Project switching are separate keyboard controls", () => {
  const html = renderViewHostHtml("en", instances, "/");

  assert.match(html, /data-view-layout="home"/);
  assert.match(html, /class="view-shell-project-home" href="\/"/);
  assert.match(html, /data-view-project-menu-trigger/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /projectHome\?\.addEventListener\("click"/);
  assert.match(html, /view-shell-project-current/);
  assert.match(html, /boot\.coreShell\.projectDetails/);
});

test("Shell resizers provide pointer, keyboard, reset, and persistence behavior", () => {
  const html = renderViewHostHtml("en", instances, "/tasks");

  assert.match(html, /data-view-resizer="secondary"/);
  assert.match(html, /data-view-resizer="content-list"/);
  assert.match(html, /aria-valuemin="176" aria-valuemax="360"/);
  assert.match(html, /aria-valuemin="260" aria-valuemax="520"/);
  assert.match(html, /memsphere\.view\.shell-widths\.v1/);
  assert.match(html, /event\.key !== "ArrowLeft" && event\.key !== "ArrowRight"/);
  assert.match(html, /requestAnimationFrame\(flush\)/);
  assert.match(html, /event\.shiftKey \? 48 : 12/);
  assert.match(html, /cancelAnimationFrame\(animationFrame\)/);
  assert.match(html, /addEventListener\("dblclick"/);
  assert.match(html, /max-width: 820px/);
});

test("Non-Home SSR uses a local detail skeleton instead of a centered page loader", () => {
  const html = renderViewHostHtml("zh-CN", instances, "/memories");
  const main = html.match(/<main id="memsphere-view-root"[\s\S]*?<\/main>/)?.[0] ?? "";

  assert.match(main, /class="view-shell-detail-loading"/);
  assert.match(main, /view-shell-loading-skeleton/);
  assert.doesNotMatch(main, />加载中\.\.\.<\/main>/);
});

function instance(
  moduleId: string,
  instanceId: string,
  routeId: string,
  path: string,
  title: string,
  icon: string,
  routeParams?: Readonly<Record<string, string>>,
): ViewHostBootInstance {
  return {
    pluginPath: `/assets/modules/${moduleId}/index.js`,
    routeBasePath: "/",
    routeGrants: [{ id: routeId, path }],
    home: { title, summary: title, icon, routeId, ...(routeParams ? { routeParams } : {}) },
    module: { projectId: "memsphere", moduleId, moduleVersion: "1.0.0", instanceId }
  };
}
