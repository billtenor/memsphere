import assert from "node:assert/strict";
import test from "node:test";
import {
  RuntimeThemeStore,
  VIEW_THEME_HOME_LAYER,
  VIEW_THEME_PROJECT_LAYER,
  viewThemeDarkTokens,
  viewThemeLightTokens
} from "../src/view/theme.js";
import type { Disposer, ViewLifecycle } from "../src/view/view-sdk.js";

class Lifecycle implements ViewLifecycle {
  readonly owned: Disposer[] = [];
  disposed = false;
  own(disposer: Disposer): Disposer { this.owned.push(disposer); return disposer; }
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const disposer of this.owned.reverse()) await disposer();
  }
}

test("Theme Registry resolves system, Home, and Project layers and restores on disposal", async () => {
  const store = new RuntimeThemeStore("dark");
  const home = new Lifecycle();
  const project = new Lifecycle();
  const observed: string[] = [];
  store.scoped(project).subscribe(() => observed.push(store.tokens["color.accent"]));

  const homeRegistry = store.registry(home, VIEW_THEME_HOME_LAYER);
  homeRegistry.registerTheme({
    sourceId: "org.example.home",
    tokens: { light: { "color.accent": "#111111" }, dark: { "color.accent": "#222222" } }
  });
  homeRegistry.selectTheme("org.example.home");
  const projectRegistry = store.registry(project, VIEW_THEME_PROJECT_LAYER);
  projectRegistry.registerTheme({
    sourceId: "org.example.project",
    tokens: { light: { "color.accent": "#333333" }, dark: { "color.accent": "#444444" } }
  });
  projectRegistry.selectTheme("org.example.project");
  assert.equal(store.tokens["color.accent"], "#444444");
  assert.equal(store.tokens["color.text"], viewThemeDarkTokens["color.text"]);

  await project.dispose();
  assert.equal(store.tokens["color.accent"], "#222222");
  await home.dispose();
  assert.equal(store.tokens["color.accent"], viewThemeDarkTokens["color.accent"]);
  store.setMode("light");
  assert.equal(store.tokens["color.text"], viewThemeLightTokens["color.text"]);
  assert(observed.length >= 3);
});

test("complete Theme registrations require every token in both modes", () => {
  const store = new RuntimeThemeStore("light");
  const lifecycle = new Lifecycle();
  assert.throws(() => store.registry(lifecycle).registerTheme({
    sourceId: "org.example.incomplete",
    complete: true,
    tokens: { light: { "color.accent": "red" }, dark: { "color.accent": "blue" } }
  }), /missing light token/);
});

test("partial Theme overrides require the same known tokens in light and dark", () => {
  const store = new RuntimeThemeStore("light");
  const lifecycle = new Lifecycle();
  assert.throws(() => store.registry(lifecycle).registerTheme({
    sourceId: "org.example.mismatched",
    tokens: { light: { "color.accent": "red" }, dark: { "color.text": "white" } }
  }), /same keys/);
  assert.throws(() => store.registry(lifecycle).registerTheme({
    sourceId: "org.example.unknown",
    tokens: { light: { unknown: "red" }, dark: { unknown: "blue" } } as any
  }), /Unknown Theme token/);
});
