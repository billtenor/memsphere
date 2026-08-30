import { formatViewMessage, resolveViewLocale, viewMessages, type ViewLocale } from "./locales/index.js";

export const legacyViewBundlePath = "/assets/legacy-view.js";
export const viewSdkBundlePath = "/assets/view-sdk.js";
export const viewRuntimeBundlePath = "/assets/view-runtime.js";

export function renderViewHostHtml(locale: ViewLocale | unknown = "zh-CN"): string {
  const resolved = resolveViewLocale(locale);
  const boot = serializeForHtml({
    locale: resolved,
    messages: viewMessages(resolved),
    loading: formatViewMessage(resolved, "common.loading"),
    failureTitle: formatViewMessage(resolved, "fatal.title"),
    pluginPath: legacyViewBundlePath,
    runtimePath: viewRuntimeBundlePath,
    mainViewKey: "legacy",
    module: {
      projectId: "memsphere",
      moduleId: "org.memsphere.legacy-view",
      moduleVersion: "0.1.2",
      instanceId: "legacy"
    }
  });
  const importMap = serializeForHtml({
    imports: { "@memsphere/view-sdk": viewSdkBundlePath }
  });

  return `<!doctype html>
<html lang="${resolved}" data-view-host-state="loading">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>memsphere</title>
  <style>
    body { margin: 0; background: #f6f7f4; color: #222629; font: 14px/1.45 ui-sans-serif, system-ui, sans-serif; }
    .view-host-status { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .view-host-error { width: min(680px, 100%); border: 1px solid #e8c7bd; border-left: 4px solid #a14436; border-radius: 8px; background: #fffdfb; padding: 18px; box-sizing: border-box; }
    .view-host-error h1 { margin: 0 0 8px; color: #a14436; font-size: 18px; }
    .view-host-error p { margin: 0; color: #6c7379; white-space: pre-wrap; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main id="memsphere-view-root" class="view-host-status" aria-live="polite">${escapeHtml(formatViewMessage(resolved, "common.loading"))}</main>
  <script id="memsphere-view-boot" type="application/json">${boot}</script>
  <script type="importmap">${importMap}</script>
  <script type="module">
    const root = document.getElementById("memsphere-view-root");
    const bootNode = document.getElementById("memsphere-view-boot");
    const boot = JSON.parse(bootNode.textContent || "{}");
    const fail = reason => {
      document.documentElement.dataset.viewHostState = "failed";
      const panel = document.createElement("section");
      panel.className = "view-host-error";
      panel.id = "view-host-error";
      const title = document.createElement("h1");
      title.textContent = boot.failureTitle || "Memsphere View failed to load";
      const detail = document.createElement("p");
      detail.textContent = reason instanceof Error ? reason.message : String(reason);
      panel.append(title, detail);
      root.className = "view-host-status";
      root.replaceChildren(panel);
    };

    try {
      const [runtimeModule, pluginModule] = await Promise.all([
        import(boot.runtimePath),
        import(boot.pluginPath)
      ]);
      if (typeof runtimeModule.startViewPlugin !== "function") {
        throw new Error("View runtime does not export startViewPlugin()");
      }
      root.className = "";
      const activePlugin = await runtimeModule.startViewPlugin({
        plugin: pluginModule.default,
        config: { locale: boot.locale, messages: boot.messages },
        module: boot.module,
        root,
        mainViewKey: boot.mainViewKey
      });
      window.addEventListener("pagehide", () => {
        void activePlugin.dispose().catch(error => console.error("View Plugin cleanup failed", error));
      }, { once: true });
      document.documentElement.dataset.viewHostState = "ready";
    } catch (error) {
      fail(error);
    }
  </script>
</body>
</html>`;
}

function serializeForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
