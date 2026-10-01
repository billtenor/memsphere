import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bilingualDocuments = [
  "architecture",
  "view-plugin-design",
  "view-plugin-api",
  "view-plugin-guide",
  "view-slots",
  "view-ui-primitives",
] as const;

test("View architecture documentation matches the wired Module and Slot runtime", async () => {
  for (const name of bilingualDocuments) {
    const [chinese, english] = await Promise.all([
      readFile(`docs/${name}.md`, "utf8"),
      readFile(`docs/${name}.en.md`, "utf8"),
    ]);
    assert.equal(headingCount(chinese), headingCount(english), `${name} bilingual heading structure`);
  }

  const [api, guide, slots, architecture, design, primitives] = await Promise.all([
    readFile("docs/view-plugin-api.md", "utf8"),
    readFile("docs/view-plugin-guide.md", "utf8"),
    readFile("docs/view-slots.md", "utf8"),
    readFile("docs/architecture.md", "utf8"),
    readFile("docs/view-plugin-design.md", "utf8"),
    readFile("docs/view-ui-primitives.md", "utf8"),
  ]);
  const current = [api, guide, slots, architecture, design].join("\n");

  for (const moduleId of ["org.memsphere.memory", "org.memsphere.run", "org.memsphere.settings"]) {
    assert.match(current, new RegExp(moduleId.replaceAll(".", "\\.")));
  }
  for (const slot of [
    "navigation.primary", "header.title", "header.actions", "header.account", "sidebar.footer",
    "home.attention", "home.continue", "home.modules", "main.view", "overlay"
  ]) {
    assert.match(slots, new RegExp(slot.replaceAll(".", "\\.")));
  }
  for (const document of [api, guide, architecture, design]) {
    assert.match(document, /\[Memsphere View Slot List\]|\[View Slot List\]/);
    assert.match(document, /\.\/view-slots\.md/);
  }
  assert.match(api, /slots\.headerTitle/);
  assert.match(guide, /\.\/view-ui-primitives\.md/);
  for (const primitive of [
    "contentList", "confirmButton", "iconButton", "feedback", "tabs", "segmentedControl",
    "disclosure", "textField", "searchField", "textareaField", "checkboxField", "select",
    "combobox", "progress", "card", "section",
  ]) {
    assert.match(primitives, new RegExp(`\\b${primitive}\\b`));
  }
  assert.doesNotMatch(api, /内置 Legacy View 已使用这条链路/);
  assert.doesNotMatch(guide, /当前可运行 Plugin 只能声明 `inject: \["slots"\]`/);
  assert.doesNotMatch(slots, /当前 Runtime 已接线 `main\.view`。其余 9 个 Slot/);
});

function headingCount(markdown: string): number {
  return markdown.split("\n").filter(line => /^#{1,6} /.test(line)).length;
}
