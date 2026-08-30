import assert from "node:assert/strict";
import test from "node:test";
import { renderViewHostHtml } from "../src/view/host.js";
import { findUnlocalizedViewLiterals } from "../src/view/locales/lint.js";
import {
  formatViewMessage,
  localizeAcpProviderDetection,
  resolveViewLocale,
  serializeViewMessages,
  viewMessages
} from "../src/view/locales/index.js";

test("View locale resources have matching keys and resolve supported languages", () => {
  assert.equal(resolveViewLocale("en"), "en");
  assert.equal(resolveViewLocale("zh-CN"), "zh-CN");
  assert.equal(resolveViewLocale("unsupported"), "zh-CN");
  assert.deepEqual(Object.keys(viewMessages("en")).sort(), Object.keys(viewMessages("zh-CN")).sort());
  assert.equal(formatViewMessage("zh-CN", "memory.count", { count: 3 }), "3 条记忆");
  assert.equal(formatViewMessage("en", "memory.count", { count: 1 }), "1 memory");
  assert.equal(formatViewMessage("en", "memory.count", { count: 3 }), "3 memories");
  assert.equal(formatViewMessage("en", "run.count", { count: 1 }), "1 run");
  assert.equal(formatViewMessage("en", "run.artifactCount", { count: 2 }), "2 artifacts");
  assert.equal(formatViewMessage("en", "run.slotCount", { count: 1 }), "1 slot");
  assert.equal(formatViewMessage("en", "review.commentCount", { count: 2 }), "2 comments");
  assert.equal(formatViewMessage("zh-CN", "change.previewTitle"), "草稿预览");
  assert.equal(formatViewMessage("en", "change.previewTitle"), "Draft preview");
  assert.equal(formatViewMessage("zh-CN", "artifact.file", { path: "report.md" }), "文件产物：report.md");
  assert.equal(formatViewMessage("en", "artifact.fileReadFailed", { error: "EACCES" }), "Unable to read artifact file: EACCES");
});

test("View HTML injects one safe locale bundle and matching document language", () => {
  const zh = renderViewHostHtml("zh-CN", []);
  const en = renderViewHostHtml("en", []);
  assert.match(zh, /<html lang="zh-CN"/);
  assert.match(en, /<html lang="en"/);
  assert.match(zh, /"common\.refresh":"刷新"/);
  assert.match(en, /"common\.refresh":"Refresh"/);
  assert.match(en, /"memory\.count":\{"one":"\{count\} memory","other":"\{count\} memories"\}/);
  assert.doesNotMatch(serializeViewMessages("zh-CN"), /<\/script/i);
  const bootSource = en.match(/<script id="memsphere-view-boot" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  assert(bootSource);
  assert.equal(JSON.parse(bootSource).locale, "en");
});

test("ACP detection localizes explanatory text without changing technical fields", () => {
  const result = localizeAcpProviderDetection({
    id: "codex",
    type: "codex",
    command: "codex-acp",
    status: "missing",
    reason: "raw reason"
  }, "zh-CN");
  assert.equal(result.status, "missing");
  assert.equal(result.command, "codex-acp");
  assert.equal(result.reason, "未找到可执行文件：codex-acp");
  assert.match(result.installHelp ?? "", /安装/);
});

test("View locale lint still rejects fixed user-facing literals", () => {
  const counterexample = '<body>\n<h1>Memory Center</h1>'
    + '\n<script>\nbutton.textContent = "Refresh now";'
    + '\nbutton.setAttribute("aria-label", "Open settings");\nconfirm("Discard changes?");\npanel.innerHTML = "<span>Review now</span>";'
    + '\nbutton.textContent = `Refresh ${count} items`;\nbutton.setAttribute(`aria-label`, `Open settings`);'
    + '\nconfirm(`Discard ${count} changes?`);\npanel.innerHTML = `<span>Review ${count} items</span>`;'
    + '\nsettingsReadOnly(`Store ${count}`, value);';
  const violations = findUnlocalizedViewLiterals(counterexample);
  assert(violations.some(item => item.sink === "textContent" && item.value === "Refresh now"));
  assert(violations.some(item => item.sink === "static HTML" && item.value === "Memory Center"));
  assert(violations.some(item => item.sink === "aria-label" && item.value === "Open settings"));
  assert(violations.some(item => item.sink === "confirm" && item.value === "Discard changes?"));
  assert(violations.some(item => item.sink === "innerHTML" && item.value === "<span>Review now</span>"));
  assert(violations.some(item => item.sink === "textContent" && item.value === "Refresh ${count} items"));
  assert(violations.some(item => item.sink === "confirm" && item.value === "Discard ${count} changes?"));
  assert(violations.some(item => item.sink === "innerHTML" && item.value === "<span>Review ${count} items</span>"));
  assert(violations.some(item => item.sink === "settingsReadOnly" && item.value === "Store ${count}"));
});
