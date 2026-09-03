import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { validateModuleStyleBoundary, validateShellThemeStyles } from "../src/view/style-contract.js";
import { viewShellStyles } from "../src/view/shell/layout.js";

test("Reference Module styles use public tokens and stay inside the Feature root", async () => {
  const source = await readFile(new URL("../modules/org.memsphere.reference/adapter/view/index.ts", import.meta.url), "utf8");
  assert.doesNotThrow(() => validateModuleStyleBoundary(source, "reference", {
    scope: ["[data-reference-module]", "[data-reference-panel]", "[data-reference-overlay]"],
  }));
});

test("Module style boundary rejects public token declarations and Host internals", () => {
  assert.throws(() => validateModuleStyleBoundary("const css = `:root { --mem-view-color-text: red; }`;", "token"), /must not declare/);
  assert.throws(() => validateModuleStyleBoundary("const css = `.feature { color: var(--view-ink); }`;", "private-token"), /Host-private/);
  assert.throws(() => validateModuleStyleBoundary("const css = `.view-shell-header { display:none; }`;", "shell"), /Shell selectors/);
  assert.throws(() => validateModuleStyleBoundary("const css = `[data-view-slot=\"header.title\"] { display:none; }`;", "slot"), /Shell selectors/);
  assert.throws(() => validateModuleStyleBoundary("const css = `.feature { color:red !important; }`;", "important"), /important/);
});

test("Feature scope rejects global selectors but allows custom local geometry", () => {
  assert.throws(() => validateModuleStyleBoundary("const css = `.card { display:grid; }`;", "global", { scope: "[data-feature]" }), /must scope selector/);
  assert.doesNotThrow(() => validateModuleStyleBoundary("const css = `[data-feature] .canvas { display:grid; grid-template-columns:2fr 1fr; color:var(--mem-view-color-text); }`;", "local", { scope: "[data-feature]" }));
  assert.throws(() => validateModuleStyleBoundary("const sheet = `.global { display:grid; }`;", "renamed", { scope: "[data-feature]" }), /must scope selector/);
  assert.doesNotThrow(() => validateModuleStyleBoundary("const sheet = `[data-feature] .card:not(.x, .y) { display:grid; }`;", "functional-comma", { scope: "[data-feature]" }));
});

test("Feature scope rejects CSS forms the static scope check cannot inspect", () => {
  assert.throws(
    () => validateModuleStyleBoundary("const styles = [`.card { color:red; }`].join('');", "joined", { scope: "[data-feature]" }),
    /inspectable style\/css template literal/,
  );
  assert.throws(
    () => validateModuleStyleBoundary("import './feature.css';", "imported", { scope: "[data-feature]" }),
    /inspectable style\/css template literal/,
  );
});

test("Shell public visuals use Theme tokens while private variables stay geometric", () => {
  assert.doesNotThrow(() => validateShellThemeStyles(viewShellStyles));
  assert.throws(() => validateShellThemeStyles(".shell { color:#fff; }"), /literal colors/);
  assert.throws(() => validateShellThemeStyles(":root { --view-brand:red; }"), /private visual variables/);
  assert.throws(() => validateShellThemeStyles(".shell { font-size:12px; border-radius:8px; }"), /font-size tokens/);
  assert.throws(() => validateShellThemeStyles(".shell { color:hsl(120, 60%, 30%); }"), /literal colors/);
  assert.throws(() => validateShellThemeStyles(".shell { color:red; }"), /literal colors/);
  assert.throws(() => validateShellThemeStyles(".shell { font-size:1rem; }"), /font-size tokens/);
  assert.throws(() => validateShellThemeStyles(".shell { border-radius:1em; }"), /radius tokens/);
  assert.doesNotThrow(() => validateModuleStyleBoundary("/* never use !important here */ const css = `[data-feature] { color:var(--mem-view-color-text); }`;", "comment", { scope: "[data-feature]" }));
});
