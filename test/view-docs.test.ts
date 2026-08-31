import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bilingualDocuments = [
  "architecture",
  "view-plugin-design",
  "view-plugin-api",
  "view-plugin-guide",
  "view-slots",
] as const;

test("View architecture documentation matches the wired Module and Slot runtime", async () => {
  for (const name of bilingualDocuments) {
    const [chinese, english] = await Promise.all([
      readFile(`docs/${name}.md`, "utf8"),
      readFile(`docs/${name}.en.md`, "utf8"),
    ]);
    assert.equal(headingCount(chinese), headingCount(english), `${name} bilingual heading structure`);
  }

  const [api, guide, slots, architecture, design] = await Promise.all([
    readFile("docs/view-plugin-api.md", "utf8"),
    readFile("docs/view-plugin-guide.md", "utf8"),
    readFile("docs/view-slots.md", "utf8"),
    readFile("docs/architecture.md", "utf8"),
    readFile("docs/view-plugin-design.md", "utf8"),
  ]);
  const current = [api, guide, slots, architecture, design].join("\n");

  for (const moduleId of ["org.memsphere.memory", "org.memsphere.run", "org.memsphere.settings"]) {
    assert.match(current, new RegExp(moduleId.replaceAll(".", "\\.")));
  }
  for (const slot of [
    "navigation.primary", "header.title", "header.actions", "header.account", "sidebar.footer",
    "home.attention", "home.continue", "home.modules", "main.view", "overlay"
  ]) {
    assert.match(api, new RegExp(slot.replaceAll(".", "\\.")));
    assert.match(slots, new RegExp(slot.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(api, /内置 Legacy View 已使用这条链路/);
  assert.doesNotMatch(guide, /当前可运行 Plugin 只能声明 `inject: \["slots"\]`/);
  assert.doesNotMatch(slots, /当前 Runtime 已接线 `main\.view`。其余 9 个 Slot/);
});

function headingCount(markdown: string): number {
  return markdown.split("\n").filter(line => /^#{1,6} /.test(line)).length;
}
