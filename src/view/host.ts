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
    readonly query?: readonly string[];
  }[];
  readonly home?: {
    readonly title: string;
    readonly summary: string;
    readonly icon: string;
    readonly routeId: string;
    readonly routeParams?: Readonly<Record<string, string>>;
  };
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
  pathname?: string,
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
      switchConfirm: "当前设置页面可能有未保存修改。确认切换项目？",
      projectDetails: "项目详情", currentProject: "当前 Project", switchProject: "切换 Project", close: "关闭", projectRoot: "项目目录",
      storeType: "存储类型", revision: "版本", memoryRoot: "Memory 目录", unavailable: "未设置"
    } : {
      project: "Project", settings: "⚙ Settings", healthy: "Service status: healthy",
      switchConfirm: "The current settings page may contain unsaved changes. Switch Project?",
      projectDetails: "Project details", currentProject: "Current Project", switchProject: "Switch Project", close: "Close", projectRoot: "Project root",
      storeType: "Store type", revision: "Revision", memoryRoot: "Memory root", unavailable: "Not set"
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
  const initial = pathname ? initialShellState(resolved, resolvedInstances, pathname) : undefined;

  return `<!doctype html>
<html lang="${resolved}" data-view-host-state="loading">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23286c67'/%3E%3Cpath d='M32 14 48 23v18L32 50 16 41V23z' fill='none' stroke='white' stroke-width='4'/%3E%3Cpath d='m16 23 16 9 16-9M32 32v18' fill='none' stroke='white' stroke-width='4'/%3E%3C/svg%3E" />
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
  ${renderViewShellMarkup({ loading: formatViewMessage(resolved, "common.loading"), ...(initial ? { initial } : {}) })}
  <script id="memsphere-view-boot" type="application/json">${boot}</script>
  <script type="importmap">${importMap}</script>
  <script type="module">
    const root = document.getElementById("memsphere-view-root");
    const bootNode = document.getElementById("memsphere-view-boot");
    const boot = JSON.parse(bootNode.textContent || "{}");
    const shell = root.closest("[data-view-shell]");
    const setupShellResizers = shellElement => {
      if (!shellElement) return () => {};
      const storageKey = "memsphere.view.shell-widths.v1";
      const definitions = {
        secondary: { property: "--view-secondary-width", min: 176, max: 360, defaultValue: 218 },
        "content-list": { property: "--view-list-width", min: 260, max: 520, defaultValue: 326 }
      };
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch {}
      const widths = {};
      const clamp = (value, definition) => Math.min(definition.max, Math.max(definition.min, Number(value) || definition.defaultValue));
      const apply = (name, value, persist = false) => {
        const definition = definitions[name];
        widths[name] = clamp(value, definition);
        shellElement.style.setProperty(definition.property, widths[name] + "px");
        const separator = shellElement.querySelector('[data-view-resizer="' + name + '"]');
        separator?.setAttribute("aria-valuenow", String(widths[name]));
        if (persist) {
          try { localStorage.setItem(storageKey, JSON.stringify(widths)); } catch {}
        }
      };
      for (const [name, definition] of Object.entries(definitions)) apply(name, saved[name] ?? definition.defaultValue);
      const cleanups = [];
      let activeDragCleanup = () => {};
      for (const separator of shellElement.querySelectorAll("[data-view-resizer]")) {
        const name = separator.dataset.viewResizer;
        const definition = definitions[name];
        if (!definition) continue;
        const onPointerDown = event => {
          if (event.button !== 0) return;
          separator.focus();
          event.preventDefault();
          activeDragCleanup();
          const startX = event.clientX;
          const startWidth = widths[name];
          let nextWidth = startWidth;
          let animationFrame = 0;
          shellElement.dataset.viewResizing = name;
          const flush = () => {
            animationFrame = 0;
            apply(name, nextWidth);
          };
          const onMove = moveEvent => {
            nextWidth = startWidth + moveEvent.clientX - startX;
            if (!animationFrame) animationFrame = requestAnimationFrame(flush);
          };
          const cleanupDrag = persist => {
            if (animationFrame) {
              cancelAnimationFrame(animationFrame);
              animationFrame = 0;
              apply(name, nextWidth);
            }
            delete shellElement.dataset.viewResizing;
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onEnd);
            window.removeEventListener("pointercancel", onEnd);
            if (persist) apply(name, widths[name], true);
            activeDragCleanup = () => {};
          };
          const onEnd = () => cleanupDrag(true);
          activeDragCleanup = () => cleanupDrag(false);
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onEnd, { once: true });
          window.addEventListener("pointercancel", onEnd, { once: true });
        };
        const onKeyDown = event => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const step = event.shiftKey ? 48 : 12;
          apply(name, widths[name] + (event.key === "ArrowRight" ? step : -step), true);
        };
        const onDoubleClick = () => apply(name, definition.defaultValue, true);
        separator.addEventListener("pointerdown", onPointerDown);
        separator.addEventListener("keydown", onKeyDown);
        separator.addEventListener("dblclick", onDoubleClick);
        cleanups.push(() => {
          separator.removeEventListener("pointerdown", onPointerDown);
          separator.removeEventListener("keydown", onKeyDown);
          separator.removeEventListener("dblclick", onDoubleClick);
        });
      }
      const narrow = matchMedia("(max-width: 820px)");
      const syncSeparatorFocus = () => {
        for (const separator of shellElement.querySelectorAll("[data-view-resizer]")) separator.tabIndex = narrow.matches ? -1 : 0;
      };
      syncSeparatorFocus();
      narrow.addEventListener?.("change", syncSeparatorFocus);
      cleanups.push(() => narrow.removeEventListener?.("change", syncSeparatorFocus));
      return () => {
        activeDragCleanup();
        cleanups.splice(0).forEach(cleanup => cleanup());
      };
    };
    const disposeShellResizers = setupShellResizers(shell);
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
      const activeHost = await runtimeModule.startViewHost({
        instances,
        root,
        mainViewKey: boot.mainViewKey,
        coreConfig: { locale: boot.locale, messages: boot.messages }
      });
      const projectHome = shell?.querySelector(".view-shell-project-home");
      const projectLabel = shell?.querySelector(".view-shell-project-label");
      const projectSelectWrap = shell?.querySelector(".view-shell-project-select-wrap");
      const projectTrigger = shell?.querySelector("#view-shell-project-trigger");
      const projectTriggerValue = shell?.querySelector(".view-shell-project-trigger-value");
      const projectValue = shell?.querySelector(".view-shell-project-value");
      const projectMenu = shell?.querySelector("#view-shell-project-menu");
      const projectDetails = shell?.querySelector("[data-view-project-details]");
      const projectDetailsClose = shell?.querySelector("[data-view-project-details-close]");
      const settings = shell?.querySelector("[data-view-core-settings]");
      const serviceStatus = shell?.querySelector("[data-view-core-status]");
      projectHome?.addEventListener("click", event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        history.pushState({}, "", "/");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      if (projectLabel) projectLabel.textContent = boot.coreShell.project;
      if (settings) {
        settings.textContent = boot.coreShell.settings;
        settings.addEventListener("click", () => {
          history.pushState({}, "", "/settings/general");
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
            const selected = projectMenu.querySelector(".view-shell-project-current")
              || projectMenu.querySelector(".view-shell-project-option");
            selected?.focus();
          }
        };
        const showCurrentProject = name => {
          projectValue.textContent = name || boot.coreShell.project;
          if (projectTriggerValue) projectTriggerValue.textContent = name || boot.coreShell.project;
          projectTrigger.title = name || boot.coreShell.project;
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
          const options = [...projectMenu.querySelectorAll(".view-shell-project-current, .view-shell-project-option")];
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
          const title = document.createElement("div");
          title.className = "view-shell-project-menu-title";
          title.textContent = boot.coreShell.currentProject;
          projectMenu.append(title);
          const openDetails = () => {
            closeProjectMenu();
            if (!projectDetails) return;
            const detail = payload.currentProject || {};
            const set = (name, value) => {
              const node = projectDetails.querySelector('[data-project-detail="' + name + '"]');
              if (node) node.textContent = value || boot.coreShell.unavailable;
            };
            set("name", detail.name || payload.current);
            set("root", detail.root);
            set("store", detail.storeType);
            set("revision", detail.revision);
            set("memory", detail.memoryRoot);
            projectDetails.hidden = false;
            projectDetailsClose?.focus();
          };
          if (payload.current) {
            const current = document.createElement("button");
            current.type = "button";
            current.className = "view-shell-project-current";
            current.setAttribute("role", "menuitem");
            current.setAttribute("aria-label", payload.current + " · " + boot.coreShell.projectDetails);
            const avatar = document.createElement("span");
            avatar.className = "view-shell-project-avatar";
            avatar.textContent = payload.current.slice(0, 1);
            const copy = document.createElement("span");
            copy.className = "view-shell-project-current-copy";
            const name = document.createElement("strong");
            name.className = "view-shell-project-current-name";
            name.textContent = payload.current;
            const detailLabel = document.createElement("small");
            detailLabel.textContent = boot.coreShell.projectDetails;
            copy.append(name, detailLabel);
            const caret = document.createElement("img");
            caret.className = "view-shell-project-details-caret";
            caret.src = "/assets/system-icons/caret-down.svg";
            caret.alt = "";
            current.append(avatar, copy, caret);
            current.addEventListener("click", openDetails);
            projectMenu.append(current);
          }
          const otherProjects = (payload.projects || []).filter(project => project.name !== payload.current);
          if (otherProjects.length) {
            const switchLabel = document.createElement("div");
            switchLabel.className = "view-shell-project-switch-label";
            switchLabel.textContent = boot.coreShell.switchProject;
            projectMenu.append(switchLabel);
          }
          for (const project of otherProjects) {
            const menuOption = document.createElement("button");
            menuOption.type = "button";
            menuOption.className = "view-shell-project-option";
            menuOption.setAttribute("role", "menuitem");
            menuOption.setAttribute("aria-label", project.name);
            menuOption.dataset.projectName = project.name;
            menuOption.title = project.name;
            const avatar = document.createElement("span");
            avatar.className = "view-shell-project-avatar";
            avatar.textContent = project.name.slice(0, 1);
            const name = document.createElement("span");
            name.className = "view-shell-project-option-name";
            name.textContent = project.name;
            menuOption.append(avatar, name);
            menuOption.addEventListener("click", () => {
              void switchProject(project.name, payload.current).catch(error => {
                projectTrigger.disabled = false;
                projectTrigger.title = error instanceof Error ? error.message : String(error);
              });
            });
            projectMenu.append(menuOption);
          }
          projectTrigger.disabled = !payload.current && otherProjects.length === 0;
          showCurrentProject(payload.current || "");
        }).catch(error => {
          projectTrigger.title = error instanceof Error ? error.message : String(error);
        });
      }
      const closeProjectDetails = () => {
        if (!projectDetails || projectDetails.hidden) return;
        projectDetails.hidden = true;
        projectTrigger?.focus();
      };
      projectDetailsClose?.addEventListener("click", closeProjectDetails);
      projectDetails?.addEventListener("click", event => {
        if (event.target === projectDetails) closeProjectDetails();
      });
      document.addEventListener("keydown", event => {
        if (event.key === "Escape" && projectDetails && !projectDetails.hidden) closeProjectDetails();
      });
      window.addEventListener("pagehide", () => {
        disposeShellResizers();
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

function initialShellState(locale: ViewLocale, instances: readonly ViewHostBootInstance[], pathname: string) {
  const projectName = instances[0]?.module.projectId ?? "memsphere";
  const moduleHref = (instance: ViewHostBootInstance): string => {
    const routeId = instance.home?.routeId;
    const grant = instance.routeGrants?.find(candidate => candidate.id === routeId);
    if (!grant) return "/";
    return grant.path.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => encodeURIComponent(String(instance.home?.routeParams?.[name] ?? "")));
  };
  const memory = instances.find(instance => instance.module.moduleId === "org.memsphere.memory");
  const run = instances.find(instance => instance.module.moduleId === "org.memsphere.run");
  const settings = instances.find(instance => instance.module.moduleId === "org.memsphere.settings");
  const navigation = [
    ...(memory ? [{ label: formatViewMessage(locale, "navigation.memory"), icon: "brain", href: moduleHref(memory) }] : []),
    ...(run ? [{ label: formatViewMessage(locale, "navigation.run"), icon: "play-circle", href: moduleHref(run) }] : [])
  ];
  return {
    locale,
    pathname,
    projectName,
    homeLabel: formatViewMessage(locale, "navigation.home"),
    memoryLabel: formatViewMessage(locale, "navigation.memory"),
    runLabel: formatViewMessage(locale, "navigation.run"),
    settingsLabel: formatViewMessage(locale, "common.settings"),
    settingsHref: settings ? moduleHref(settings) : "/settings/general",
    healthyLabel: formatViewMessage(locale, "service.healthy"),
    accountLabel: formatViewMessage(locale, "account.avatar"),
    homeTitle: formatViewMessage(locale, "home.title"),
    attentionLabel: formatViewMessage(locale, "home.attention"),
    attentionEmpty: formatViewMessage(locale, "home.attention.empty"),
    continueLabel: formatViewMessage(locale, "home.continue"),
    continueEmpty: formatViewMessage(locale, "home.continue.empty"),
    modulesLabel: formatViewMessage(locale, "home.modules"),
    navigation,
    modules: instances.flatMap(instance => instance.home ? [{
      title: instance.home.title,
      summary: instance.home.summary,
      icon: instance.home.icon,
      href: moduleHref(instance)
    }] : [])
  };
}

function serializeForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
