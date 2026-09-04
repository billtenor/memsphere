import {
  viewThemeCssVariables,
  type Disposer,
  type ViewLifecycle,
  type ViewTheme,
  type ViewThemeToken
} from "./view-sdk.js";

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

export const viewThemeStyles = `:root { ${(
  Object.entries(viewThemeCssVariables) as Array<[ViewThemeToken, string]>
).map(([token, variable]) => `${variable}: ${viewThemeLightTokens[token]};`).join(" ")} }`;

export class RuntimeThemeStore {
  readonly tokens = viewThemeLightTokens;
  readonly #listeners = new Set<() => void>();

  scoped(lifecycle: ViewLifecycle): ViewTheme {
    const store = this;
    return Object.freeze({
      version: 1 as const,
      mode: "light" as const,
      tokens: store.tokens,
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
}

export function applyViewThemeRoots(theme: ViewTheme, ...roots: HTMLElement[]): Disposer {
  for (const root of roots) {
    root.dataset.viewThemeRoot = "";
    root.dataset.viewThemeVersion = String(theme.version);
    root.dataset.viewThemeMode = theme.mode;
    for (const [token, variable] of Object.entries(viewThemeCssVariables) as Array<[ViewThemeToken, string]>) {
      root.style.setProperty(variable, theme.tokens[token]);
    }
  }
  return () => {
    for (const root of roots) {
      delete root.dataset.viewThemeRoot;
      delete root.dataset.viewThemeVersion;
      delete root.dataset.viewThemeMode;
      for (const variable of Object.values(viewThemeCssVariables)) root.style.removeProperty(variable);
    }
  };
}
