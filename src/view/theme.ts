import {
  viewThemeCssVariables,
  type Disposer,
  type ViewLifecycle,
  type ViewTheme,
  type ViewThemeContribution,
  type ViewThemeMode,
  type ViewThemePalette,
  type ViewThemeRegistry,
  type ViewThemeToken
} from "./view-sdk.js";

export const VIEW_THEME_PROJECT_LAYER = 100;
export const VIEW_THEME_HOME_LAYER = 500;
export const VIEW_THEME_SYSTEM_LAYER = 1000;

export const viewThemeLightTokens: Readonly<Record<ViewThemeToken, string>> = Object.freeze({
  "color.canvas": "#f7f9f8", "color.surface": "#ffffff", "color.subtle": "#f1f5f3",
  "color.text": "#202826", "color.textMuted": "#697572", "color.border": "#dfe6e3",
  "color.accent": "#28766e", "color.accentHover": "#195c56", "color.accentSoft": "#deefec",
  "color.info": "#2563a6", "color.infoSoft": "#edf5ff", "color.onInfo": "#ffffff",
  "color.success": "#28766e", "color.successSoft": "#deefec", "color.onSuccess": "#ffffff",
  "color.warning": "#946200", "color.warningSoft": "#fff7db", "color.onWarning": "#241900",
  "color.danger": "#a14436", "color.dangerSoft": "#fff4f1", "color.onDanger": "#ffffff",
  "color.focusRing": "rgba(40,118,110,.28)",
  "color.onAccent": "#ffffff", "color.overlay": "rgba(24,29,26,.38)",
  "color.badge": "#e65b5b", "color.account": "#8b6a4f", "color.borderStrong": "#adc8c3",
  "font.sans": "Inter,\"PingFang SC\",\"Microsoft YaHei\",system-ui,sans-serif",
  "font.mono": "ui-monospace,SFMono-Regular,Consolas,monospace",
  "font.sizeXs": "10px", "font.sizeSm": "12px", "font.sizeBase": "14px", "font.sizeMd": "16px",
  "font.sizeLg": "18px", "font.sizeXl": "22px", "font.sizeDisplay": "48px",
  "line.compact": "1.35", "line.body": "1.55", "line.heading": "1.2",
  "space.1": "4px", "space.2": "8px", "space.3": "12px", "space.4": "16px",
  "space.5": "24px", "space.6": "32px",
  "radius.sm": "6px", "radius.md": "10px", "radius.lg": "12px", "radius.pill": "999px",
  "shadow.card": "0 1px 2px rgba(20,47,42,.08)",
  "shadow.popover": "0 14px 40px rgba(31,46,43,.17)",
  "shadow.overlay": "0 24px 70px rgba(22,44,40,.22)", "motion.fast": "120ms ease",
  "z.overlay": "100",
  "layout.contentMax": "960px", "layout.pagePadding": "32px"
});

export const viewThemeDarkTokens: Readonly<Record<ViewThemeToken, string>> = Object.freeze({
  ...viewThemeLightTokens,
  "color.canvas": "#282a36", "color.surface": "#30323e", "color.subtle": "#383a46",
  "color.text": "#f8f8f2", "color.textMuted": "#b5b6c3", "color.border": "#444653",
  "color.accent": "#62b9ae", "color.accentHover": "#83d0c6", "color.accentSoft": "#30433f",
  "color.info": "#8be9fd", "color.infoSoft": "#293e49", "color.onInfo": "#282a36",
  "color.success": "#7ddba3", "color.successSoft": "#2c4038", "color.onSuccess": "#282a36",
  "color.warning": "#f1fa8c", "color.warningSoft": "#414132", "color.onWarning": "#282a36",
  "color.danger": "#ff8585", "color.dangerSoft": "#48343e", "color.onDanger": "#15161c",
  "color.focusRing": "rgba(98,185,174,.38)",
  "color.onAccent": "#15161c", "color.overlay": "rgba(15,16,23,.68)",
  "color.badge": "#ff8585", "color.account": "#bd93f9", "color.borderStrong": "#626575",
  "shadow.card": "0 1px 2px rgba(0,0,0,.24)",
  "shadow.popover": "0 14px 40px rgba(0,0,0,.40)",
  "shadow.overlay": "0 24px 70px rgba(0,0,0,.50)"
});

const lightThemeCss = (
  Object.entries(viewThemeCssVariables) as Array<[ViewThemeToken, string]>
).map(([token, variable]) => `${variable}: ${viewThemeLightTokens[token]};`).join(" ");
const darkThemeCss = (
  Object.entries(viewThemeCssVariables) as Array<[ViewThemeToken, string]>
).map(([token, variable]) => `${variable}: ${viewThemeDarkTokens[token]};`).join(" ");

export const viewThemeStyles = `:root { color-scheme: light; ${lightThemeCss} }
:root[data-view-theme-mode="dark"] { color-scheme: dark; ${darkThemeCss} }
@media (prefers-color-scheme: dark) { :root:not([data-view-theme-mode="light"]):not([data-view-theme-mode="dark"]) { color-scheme: dark; ${darkThemeCss} } }
:where([data-view-theme-mode="light"]) { color-scheme: light; }
:where([data-view-theme-mode="dark"]) { color-scheme: dark; }
:where(*) {
  scrollbar-width: thin;
  scrollbar-color: var(--mem-view-color-border-strong) transparent;
}
/* Older WebKit engines use pseudo-elements instead of the standard properties. */
@supports not (scrollbar-color: auto) {
  :where(*)::-webkit-scrollbar { width: 8px; height: 8px; }
  :where(*)::-webkit-scrollbar-track,
  :where(*)::-webkit-scrollbar-corner { background: transparent; }
  :where(*)::-webkit-scrollbar-thumb {
    background: var(--mem-view-color-border-strong);
    border: 2px solid transparent;
    background-clip: padding-box;
    border-radius: var(--mem-view-radius-pill);
  }
  :where(*)::-webkit-scrollbar-thumb:hover { background-color: var(--mem-view-color-text-muted); }
}
@media (forced-colors: active) {
  :where(*) { scrollbar-width: auto; scrollbar-color: auto; }
}`;

type ThemeLayer = {
  readonly sources: Map<string, ViewThemePalette>;
  selected?: string;
};

export class RuntimeThemeStore {
  readonly #listeners = new Set<() => void>();
  readonly #layers = new Map<number, ThemeLayer>();
  #requestedMode: ViewThemeMode | "system";
  #systemDark: boolean;

  constructor(mode: ViewThemeMode | "system" = "light") {
    this.#requestedMode = mode;
    this.#systemDark = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    this.#layers.set(VIEW_THEME_SYSTEM_LAYER, {
      sources: new Map([["org.memsphere.system", { light: viewThemeLightTokens, dark: viewThemeDarkTokens }]]),
      selected: "org.memsphere.system"
    });
    const query = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    query?.addEventListener?.("change", event => {
      this.#systemDark = event.matches;
      if (this.#requestedMode === "system") this.#notify();
    });
  }

  get mode(): ViewThemeMode {
    return this.#requestedMode === "system" ? (this.#systemDark ? "dark" : "light") : this.#requestedMode;
  }

  get tokens(): Readonly<Record<ViewThemeToken, string>> {
    const mode = this.mode;
    const resolved = { ...(mode === "dark" ? viewThemeDarkTokens : viewThemeLightTokens) };
    const layers = [...this.#layers.entries()].sort(([left], [right]) => left - right);
    for (const token of Object.keys(resolved) as ViewThemeToken[]) {
      for (const [, layer] of layers) {
        if (!layer.selected) continue;
        const source = layer.sources.get(layer.selected);
        if (!source) continue;
        const value = source[mode][token];
        if (value !== undefined) resolved[token] = value;
        break;
      }
    }
    return Object.freeze(resolved);
  }

  setMode(mode: ViewThemeMode | "system"): void {
    if (!(["light", "dark", "system"] as const).includes(mode)) throw new Error(`unsupported Theme mode: ${mode}`);
    if (this.#requestedMode === mode) return;
    this.#requestedMode = mode;
    this.#notify();
  }

  registry(lifecycle: ViewLifecycle, layer = VIEW_THEME_PROJECT_LAYER): ViewThemeRegistry {
    const store = this;
    return Object.freeze({
      version: 1 as const,
      registerTheme(contribution: ViewThemeContribution): Disposer {
        validateContribution(contribution);
        const themeLayer = store.#layers.get(layer) ?? { sources: new Map<string, ViewThemePalette>() };
        store.#layers.set(layer, themeLayer);
        themeLayer.sources.set(contribution.sourceId, freezePalette(contribution.tokens));
        store.#notify();
        return ownOnce(lifecycle, () => {
          themeLayer.sources.delete(contribution.sourceId);
          if (themeLayer.selected === contribution.sourceId) themeLayer.selected = undefined;
          if (!themeLayer.sources.size) store.#layers.delete(layer);
          store.#notify();
        });
      },
      selectTheme(sourceId?: string): Disposer {
        const themeLayer = store.#layers.get(layer) ?? { sources: new Map<string, ViewThemePalette>() };
        if (sourceId !== undefined && !themeLayer.sources.has(sourceId)) {
          throw new Error(`Theme source is not registered in this layer: ${sourceId}`);
        }
        store.#layers.set(layer, themeLayer);
        const previous = themeLayer.selected;
        themeLayer.selected = sourceId;
        store.#notify();
        return ownOnce(lifecycle, () => {
          themeLayer.selected = previous;
          store.#notify();
        });
      },
      overrideTokens(sourceId: string, tokens: ViewThemePalette): Disposer {
        const unregister = this.registerTheme({ sourceId, tokens });
        const unselect = this.selectTheme(sourceId);
        return ownOnce(lifecycle, async () => { await unselect(); await unregister(); });
      }
    });
  }

  scoped(lifecycle: ViewLifecycle): ViewTheme {
    const store = this;
    return Object.freeze({
      version: 1 as const,
      get mode() { return store.mode; },
      get tokens() { return store.tokens; },
      subscribe(listener: () => void): Disposer {
        if (typeof listener !== "function") throw new TypeError("Theme subscriber must be a function");
        store.#listeners.add(listener);
        let active = true;
        const dispose = () => {
          if (!active) return;
          active = false;
          store.#listeners.delete(listener);
        };
        lifecycle.own(dispose);
        return dispose;
      }
    });
  }

  diagnostics(): Readonly<{
    mode: ViewThemeMode;
    layers: readonly { priority: number; selected?: string; sources: readonly string[] }[];
  }> {
    return Object.freeze({
      mode: this.mode,
      layers: Object.freeze([...this.#layers.entries()].sort(([left], [right]) => left - right).map(([priority, layer]) => Object.freeze({
        priority,
        ...(layer.selected ? { selected: layer.selected } : {}),
        sources: Object.freeze([...layer.sources.keys()].sort())
      })))
    });
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}

export function applyViewThemeRoots(theme: ViewTheme, ...roots: HTMLElement[]): Disposer {
  const apply = () => {
    for (const root of roots) {
      root.dataset.viewThemeRoot = "";
      root.dataset.viewThemeVersion = String(theme.version);
      root.dataset.viewThemeMode = theme.mode;
      for (const [token, variable] of Object.entries(viewThemeCssVariables) as Array<[ViewThemeToken, string]>) {
        root.style.setProperty(variable, theme.tokens[token]);
      }
    }
  };
  apply();
  const unsubscribe = theme.subscribe(apply);
  return () => {
    unsubscribe();
    for (const root of roots) {
      delete root.dataset.viewThemeRoot;
      delete root.dataset.viewThemeVersion;
      delete root.dataset.viewThemeMode;
      for (const variable of Object.values(viewThemeCssVariables)) root.style.removeProperty(variable);
    }
  };
}

export function compareViewThemeLayer(left: number, right: number): number {
  return left - right;
}

function validateContribution(contribution: ViewThemeContribution): void {
  if (!contribution.sourceId?.trim()) throw new Error("Theme sourceId must be non-empty");
  validateViewThemePalette(contribution.tokens, contribution.complete === true);
}

export function validateViewThemePalette(tokens: ViewThemePalette, complete = false): void {
  if (!tokens || typeof tokens !== "object" || !tokens.light || typeof tokens.light !== "object" || !tokens.dark || typeof tokens.dark !== "object") {
    throw new Error("Theme must provide light and dark token maps");
  }
  for (const mode of ["light", "dark"] as const) {
    for (const [token, value] of Object.entries(tokens[mode])) {
      if (!(token in viewThemeCssVariables)) throw new Error(`Unknown Theme token: ${token}`);
      if (typeof value !== "string" || !value.trim()) throw new Error(`Theme token must be non-empty: ${token}`);
    }
  }
  const lightKeys = Object.keys(tokens.light).sort();
  const darkKeys = Object.keys(tokens.dark).sort();
  if (lightKeys.join("\0") !== darkKeys.join("\0")) {
    throw new Error("Theme light and dark token maps must declare the same keys");
  }
  if (complete) {
    for (const mode of ["light", "dark"] as const) {
      for (const token of Object.keys(viewThemeCssVariables) as ViewThemeToken[]) {
        if (tokens[mode][token] === undefined) {
          throw new Error(`Complete Theme is missing ${mode} token: ${token}`);
        }
      }
    }
  }
}

function freezePalette(palette: ViewThemePalette): ViewThemePalette {
  return Object.freeze({
    light: Object.freeze({ ...palette.light }),
    dark: Object.freeze({ ...palette.dark })
  });
}

function ownOnce(lifecycle: ViewLifecycle, disposer: Disposer): Disposer {
  let active = true;
  return lifecycle.own(() => {
    if (!active) return;
    active = false;
    return disposer();
  });
}
