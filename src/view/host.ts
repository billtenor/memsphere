import { formatViewMessage, resolveViewLocale, viewMessages, type ViewLocale } from "./locales/index.js";
import { renderViewShellMarkup, viewShellStyles } from "./shell/layout.js";

export const viewSdkBundlePath = "/assets/view-sdk.js";
export const viewRuntimeBundlePath = "/assets/view-runtime.js";

export interface ViewHostBootInstance {
  readonly pluginPath: string;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly routeBasePath?: string;
  readonly routeGrants?: readonly {
    readonly id: string;
    readonly path: string;
    readonly aliases?: readonly string[];
  }[];
  readonly module: {
    readonly projectId: string;
    readonly moduleId: string;
    readonly moduleVersion: string;
    readonly instanceId: string;
  };
}

export function renderViewHostHtml(
  locale: ViewLocale | unknown = "zh-CN",
  instances?: readonly ViewHostBootInstance[],
): string {
  const resolved = resolveViewLocale(locale);
  const resolvedInstances = instances ?? [];
  const boot = serializeForHtml({
    locale: resolved,
    messages: viewMessages(resolved),
    loading: formatViewMessage(resolved, "common.loading"),
    failureTitle: formatViewMessage(resolved, "fatal.title"),
    coreShell: resolved === "zh-CN" ? {
      project: "项目", settings: "⚙ 设置", healthy: "服务状态：正常",
      switchConfirm: "当前设置页面可能有未保存修改。确认切换项目？"
    } : {
      project: "Project", settings: "⚙ Settings", healthy: "Service status: healthy",
      switchConfirm: "The current settings page may contain unsaved changes. Switch Project?"
    },
    runtimePath: viewRuntimeBundlePath,
    instances: resolvedInstances.map(instance => ({
      ...instance,
      config: { locale: resolved, messages: viewMessages(resolved), ...(instance.config ?? {}) }
    }))
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
    ${viewShellStyles}
  </style>
</head>
<body>
  ${renderViewShellMarkup({ loading: formatViewMessage(resolved, "common.loading") })}
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
      const runtimeModule = await import(boot.runtimePath);
      if (typeof runtimeModule.startViewHost !== "function") {
        throw new Error("View runtime does not export startViewHost()");
      }
      const instances = await Promise.all(boot.instances.map(async instance => {
        try {
          const pluginModule = await import(instance.pluginPath);
          return { ...instance, plugin: pluginModule.default };
        } catch (error) {
          return { ...instance, plugin: { __viewBundleLoadError: error } };
        }
      }));
      root.className = "";
      root.replaceChildren();
      const activeHost = await runtimeModule.startViewHost({
        instances,
        root,
        mainViewKey: boot.mainViewKey
      });
      const shell = root.closest("[data-view-shell]");
      const projectLabel = shell?.querySelector(".view-shell-project-label");
      const projectSelectWrap = shell?.querySelector(".view-shell-project-select-wrap");
      const projectTrigger = shell?.querySelector("#view-shell-project-trigger");
      const projectValue = shell?.querySelector(".view-shell-project-value");
      const projectMenu = shell?.querySelector("#view-shell-project-menu");
      const settings = shell?.querySelector("[data-view-core-settings]");
      const serviceStatus = shell?.querySelector("[data-view-core-status]");
      if (projectLabel) projectLabel.textContent = boot.coreShell.project;
      if (settings) {
        settings.textContent = boot.coreShell.settings;
        settings.addEventListener("click", () => {
          history.pushState({}, "", "/settings/overview");
          window.dispatchEvent(new PopStateEvent("popstate"));
        });
      }
      if (serviceStatus) serviceStatus.textContent = boot.coreShell.healthy;
      if (projectTrigger && projectValue && projectMenu && projectSelectWrap) {
        const closeProjectMenu = (restoreFocus = false) => {
          projectTrigger.setAttribute("aria-expanded", "false");
          projectMenu.hidden = true;
          if (restoreFocus) projectTrigger.focus();
        };
        const openProjectMenu = (focusSelected = false) => {
          if (projectTrigger.disabled) return;
          projectTrigger.setAttribute("aria-expanded", "true");
          projectMenu.hidden = false;
          if (focusSelected) {
            const selected = projectMenu.querySelector('[aria-selected="true"]')
              || projectMenu.querySelector(".view-shell-project-option");
            selected?.focus();
          }
        };
        const showCurrentProject = name => {
          projectValue.textContent = name || boot.coreShell.project;
          projectTrigger.title = name || boot.coreShell.project;
          for (const option of projectMenu.querySelectorAll(".view-shell-project-option")) {
            option.setAttribute("aria-selected", String(option.dataset.projectName === name));
          }
        };
        const switchProject = async (name, current) => {
          if (!name || name === current) {
            closeProjectMenu();
            return;
          }
          if (location.pathname.startsWith("/settings/") && !confirm(boot.coreShell.switchConfirm)) {
            showCurrentProject(current || "");
            closeProjectMenu();
            return;
          }
          closeProjectMenu();
          projectTrigger.disabled = true;
          const response = await fetch("/api/projects/select", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ name })
          });
          if (!response.ok) throw new Error(await response.text());
          const landing = location.pathname.startsWith("/tasks/") ? "/tasks"
            : location.pathname.startsWith("/settings/") ? location.pathname
            : location.pathname === "/market" || location.pathname === "/memory-market" ? "/market"
            : location.pathname === "/" ? "/"
            : "/memories";
          location.replace(landing);
        };
        projectTrigger.addEventListener("click", () => {
          if (projectTrigger.getAttribute("aria-expanded") === "true") closeProjectMenu();
          else openProjectMenu();
        });
        projectTrigger.addEventListener("keydown", event => {
          if (event.key === "Escape") {
            event.preventDefault();
            closeProjectMenu();
            return;
          }
          if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
          event.preventDefault();
          openProjectMenu(true);
        });
        projectMenu.addEventListener("keydown", event => {
          if (event.key === "Escape") {
            event.preventDefault();
            closeProjectMenu(true);
            return;
          }
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const options = [...projectMenu.querySelectorAll(".view-shell-project-option")];
          const currentIndex = options.indexOf(document.activeElement);
          const nextIndex = event.key === "Home" ? 0
            : event.key === "End" ? options.length - 1
            : event.key === "ArrowDown" ? Math.min(options.length - 1, currentIndex + 1)
            : Math.max(0, currentIndex - 1);
          options[nextIndex]?.focus();
        });
        document.addEventListener("click", event => {
          if (!(event.target instanceof Element) || !event.target.closest(".view-shell-project-select-wrap")) {
            closeProjectMenu();
          }
        });
        fetch("/api/projects").then(response => {
          if (!response.ok) throw new Error(String(response.status));
          return response.json();
        }).then(payload => {
          projectMenu.replaceChildren();
          for (const project of payload.projects || []) {
            const menuOption = document.createElement("button");
            menuOption.type = "button";
            menuOption.className = "view-shell-project-option";
            menuOption.setAttribute("role", "option");
            menuOption.setAttribute("aria-selected", String(project.name === payload.current));
            menuOption.dataset.projectName = project.name;
            menuOption.textContent = project.name;
            menuOption.title = project.name;
            menuOption.addEventListener("click", () => {
              void switchProject(project.name, payload.current).catch(error => {
                projectTrigger.disabled = false;
                projectTrigger.title = error instanceof Error ? error.message : String(error);
              });
            });
            projectMenu.append(menuOption);
          }
          projectTrigger.disabled = projectMenu.children.length === 0;
          showCurrentProject(payload.current || "");
        }).catch(error => {
          projectTrigger.title = error instanceof Error ? error.message : String(error);
        });
      }
      window.addEventListener("pagehide", () => {
        void activeHost.dispose().catch(error => console.error("View Plugin cleanup failed", error));
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
