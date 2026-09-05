import type { RouteLocation, RouteTarget, RouteToken, ViewMount } from "@memsphere/view-sdk";
import type { SettingsViewConfig } from "./index.js";

type JsonObject = Record<string, any>;
type ScopeName = "global" | "project";
type SectionName = "overview" | "general" | "view" | "appearance" | "packages" | "composition" | "providers" | "project" | "participants";

interface SettingsViewOptions {
  readonly config: SettingsViewConfig;
  readonly route: RouteToken;
  readonly navigate: (target: RouteTarget) => Promise<void>;
  readonly onRoute?: (route: RouteLocation) => void;
}

interface ScopeState {
  data: JsonObject | null;
  draft: JsonObject | null;
  errors: JsonObject[];
  confirmation: JsonObject | null;
  notice: string;
}

const tokenKey = "memsphere.settingsToken.v1";
const detectionKey = "memsphere.settings.acp-provider-detection";
const sections: Record<SectionName, { scope: ScopeName; module: string }> = {
  overview: { scope: "global", module: "general" },
  general: { scope: "global", module: "general" },
  view: { scope: "global", module: "view" },
  appearance: { scope: "global", module: "appearance" },
  packages: { scope: "global", module: "appearance" },
  composition: { scope: "global", module: "appearance" },
  providers: { scope: "global", module: "providers" },
  project: { scope: "project", module: "overview" },
  participants: { scope: "project", module: "participants" }
};

export function createSettingsViews(options: SettingsViewOptions): Readonly<{ list: ViewMount; detail: ViewMount; dispose(): void }> {
  const scopes: Record<ScopeName, ScopeState> = {
    global: { data: null, draft: null, errors: [], confirmation: null, notice: "" },
    project: { data: null, draft: null, errors: [], confirmation: null, notice: "" }
  };
  const controller = new AbortController();
  let scratch: HTMLElement | undefined;
  let app: SettingsApplication | undefined;
  let start: Promise<void> | undefined;
  let lastRoute = "";
  let update: Promise<void> | undefined;
  const ensure = (route: RouteLocation) => {
    scratch ??= document.createElement("div");
    if (!app) {
      app = new SettingsApplication(scratch, options, controller.signal, scopes, route);
      lastRoute = `${route.pathname}${route.search}${route.hash}`;
      options.onRoute?.(route);
    }
    start ??= app.start();
    return start;
  };
  const updateRoute = async (route: RouteLocation) => {
    options.onRoute?.(route);
    await ensure(route);
    const key = `${route.pathname}${route.search}${route.hash}`;
    if (key === lastRoute) return update;
    lastRoute = key;
    update = app!.updateRoute(route).finally(() => { update = undefined; });
    return update;
  };
  const surface = (kind: "list" | "detail"): ViewMount => ({
    async mount({ element }, context) {
      await ensure(context.route);
      app![kind === "list" ? "attachList" : "attachDetail"](element);
      await updateRoute(context.route);
      return () => {
        app?.[kind === "list" ? "detachList" : "detachDetail"](element);
        element.replaceChildren();
      };
    },
    update: context => updateRoute(context.route)
  });
  return {
    list: surface("list"),
    detail: surface("detail"),
    dispose() { controller.abort(); app = undefined; }
  };
}

class SettingsApplication {
  readonly #root: HTMLElement;
  #listRoot: HTMLElement | null = null;
  #detailRoot: HTMLElement | null = null;
  readonly #options: SettingsViewOptions;
  readonly #signal: AbortSignal;
  readonly #config: SettingsViewConfig;
  #scope: ScopeName;
  #module: string;
  #meta: JsonObject | null = null;
  #projects: JsonObject[] = [];
  #currentProject = "";
  #loading = true;
  #token = sessionStorage.getItem(tokenKey) ?? "";
  #tokenError = "";
  #operatorTokenDraft = "";
  #operatorTokenError = "";
  #providerDetection: JsonObject = {};
  #detecting = false;
  #expandedProviders = new Set<string>();
  #expandedParticipants = new Set<string>();
  #viewPackages: JsonObject = { installed: [], instances: [], diagnostics: [] };
  #packagePathDraft = "";
  readonly #scopes: Record<ScopeName, ScopeState>;

  constructor(root: HTMLElement, options: SettingsViewOptions, signal: AbortSignal, scopes: Record<ScopeName, ScopeState>, route: Readonly<RouteLocation>) {
    this.#root = root;
    this.#options = options;
    this.#signal = signal;
    this.#config = options.config;
    this.#scopes = scopes;
    const destination = destinationFromPath(route.pathname);
    this.#scope = destination.scope;
    this.#module = destination.module;
  }

  async start(): Promise<void> {
    window.addEventListener("memsphere:view-diagnostics-ready", () => this.render(), { signal: this.#signal });
    this.#root.innerHTML = `<div class="memsphere-settings"><style>${styles}</style><div class="settings-loading">${escapeHtml(this.t("settings.loading", "正在加载配置……"))}</div></div>`;
    await this.load();
  }

  attachList(root: HTMLElement): void { this.#listRoot = root; this.render(); }
  detachList(root: HTMLElement): void { if (this.#listRoot === root) this.#listRoot = null; }
  attachDetail(root: HTMLElement): void { this.#detailRoot = root; this.render(); }
  detachDetail(root: HTMLElement): void { if (this.#detailRoot === root) this.#detailRoot = null; }

  async updateRoute(route: Readonly<RouteLocation>): Promise<void> {
    const destination = destinationFromPath(route.pathname);
    this.#scope = destination.scope;
    this.#module = destination.module;
    if (this.state.data || this.#meta) {
      this.#loading = false;
      this.render();
      return;
    }
    await this.load();
  }

  async load(force?: ScopeName): Promise<void> {
    this.#loading = true;
    this.render();
    try {
      const [metaResponse, projectResponse, packageResponse] = await Promise.all([
        fetch("/api/settings/meta", { signal: this.#signal }),
        fetch("/api/projects", { signal: this.#signal }),
        this.settingsFetch("/api/settings/view-packages")
      ]);
      if (!metaResponse.ok) throw new Error(await metaResponse.text());
      this.#meta = await metaResponse.json() as JsonObject;
      if (packageResponse.ok && packageResponse.headers.get("content-type")?.includes("application/json")) {
        this.#viewPackages = await packageResponse.json() as JsonObject;
      }
      if (projectResponse.ok) {
        const payload = await projectResponse.json() as JsonObject;
        this.#projects = payload.projects ?? [];
        this.#currentProject = payload.current ?? "";
      }

      const globalState = this.#scopes.global;
      if (!globalState.data || force === "global") {
        const response = await this.settingsFetch("/api/settings/global");
        if (response.status === 401) {
          globalState.data = null;
          globalState.draft = null;
          this.#scopes.project.data = null;
          this.#scopes.project.draft = null;
          this.#tokenError = this.#token ? this.t("settings.tokenInvalid", "操作令牌不正确，请检查后重试。") : "";
          sessionStorage.removeItem(tokenKey);
          return;
        }
        if (!response.ok) throw new Error(await response.text());
        globalState.data = await response.json() as JsonObject;
        globalState.draft = clone(globalState.data.config);
        globalState.errors = [];
        globalState.confirmation = null;
        globalState.notice = "";
        this.restoreDetection();
      }

      const projectState = this.#scopes.project;
      if (!this.#currentProject) {
        Object.assign(projectState, { data: null, draft: null, errors: [], confirmation: null, notice: "" });
      } else if (!projectState.data || projectState.data.projectName !== this.#currentProject || force === "project") {
        const response = await this.settingsFetch("/api/settings/project");
        if (response.status === 404) {
          Object.assign(projectState, { data: null, draft: null, errors: [], confirmation: null, notice: "" });
        } else {
          if (!response.ok) throw new Error(await response.text());
          projectState.data = await response.json() as JsonObject;
          projectState.draft = clone(projectState.data.config);
          projectState.errors = [];
          projectState.confirmation = null;
          projectState.notice = "";
        }
      }
      this.#tokenError = "";
      if (this.#token) sessionStorage.setItem(tokenKey, this.#token);
    } finally {
      this.#loading = false;
      this.render();
    }
  }

  render(): void {
    if (this.#signal.aborted) return;
    const scope = this.state;
    const title = this.#module === "appearance"
      ? this.t("settings.appearance", "界面与主题")
      : this.#scope === "global"
      ? this.t("navigation.settingsLabel", "Memsphere 设置", { name: "Memsphere" })
      : this.t("navigation.projectSettingsLabel", `${this.#currentProject || "项目"} 项目设置`, { name: this.#currentProject || this.t("navigation.project", "项目") });
    const subtitle = this.#module === "appearance"
      ? this.t("settings.appearanceHelp", "安装和管理界面扩展包，并配置主题、页面、组件和样式。")
      : this.#scope === "global"
        ? this.t("navigation.globalSettingsSubtitle", "管理 Memsphere 全局配置。")
        : this.t("navigation.projectSettingsSubtitle", "管理当前项目配置。");
    const detail = `<section class="settings-content"><header class="settings-page-header"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></header>
      <div id="detail">${this.#loading ? empty(this.t("settings.loading", "正在加载配置……")) : this.contentHtml(scope)}</div></section>`;
    if (this.#listRoot || this.#detailRoot) {
      if (this.#listRoot) this.#listRoot.innerHTML = `<div class="memsphere-settings settings-list-surface"><style>${styles}</style><aside class="settings-sidebar">${this.listHtml()}</aside></div>`;
      if (this.#detailRoot) this.#detailRoot.innerHTML = `<div class="memsphere-settings settings-detail-surface"><style>${styles}</style>${detail}</div>`;
      this.bind();
      return;
    }
    this.#root.innerHTML = `<div class="memsphere-settings"><style>${styles}</style>
      <aside class="settings-sidebar">${this.navHtml()}</aside>
      ${detail}</div>`;
    this.bind();
  }

  get state(): ScopeState {
    return this.#scopes[this.#scope];
  }

  navHtml(): string {
    const groups: Array<[ScopeName, string, Array<[SectionName, string]>]> = [
      ["global", "Memsphere", [
        ["overview", this.t("settings.overview", "概览")],
        ["general", this.t("settings.general", "常规")],
        ["view", this.t("settings.viewService", "界面服务")],
        ["appearance", this.t("settings.appearance", "界面与主题")],
        ["providers", this.t("settings.providers", "ACP 提供方")]
      ]],
      ["project", `${this.t("navigation.project", "项目")} · ${this.#currentProject}`, [
        ["project", this.t("settings.overview", "概览")],
        ["participants", this.t("settings.participants", "参与者配置")]
      ]]
    ];
    return groups.filter(([scope]) => scope === "global" || this.#currentProject).map(([scope, label, entries]) => `
      <div class="settings-nav-group${scope === this.#scope ? " active" : ""}" role="group" aria-label="${escapeAttr(label)}">
        <div class="settings-nav-heading">${escapeHtml(label)}</div>
        <div class="settings-nav-items">${entries.map(([section, name]) => {
          const target = sections[section];
          const active = target.scope === this.#scope && target.module === this.#module;
          return `<button type="button" class="settings-nav-item${active ? " active" : ""}" data-section="${section}"${active ? ' aria-current="page"' : ""}>${escapeHtml(name)}</button>`;
        }).join("")}</div>
      </div>`).join("");
  }

  listHtml(): string {
    const names: Record<string, string> = {
      overview: this.t("settings.overview", "设置概览"),
      general: this.t("settings.general", "通用设置"),
      view: this.t("settings.viewService", "界面服务"),
      appearance: this.t("settings.appearance", "界面与主题"),
      providers: this.t("settings.providers", "模型提供商"),
      project: this.t("navigation.project", "当前项目"),
      participants: this.t("settings.participants", "参与者")
    };
    const section = this.#scope === "project" && this.#module === "overview" ? "project" : this.#module;
    const title = names[section] ?? names.overview;
    const records = section === "providers"
      ? ((this.#scopes.global.data?.acpProviderCatalog ?? []) as JsonObject[]).slice(0, 8).map(provider => [String(provider.name ?? provider.id ?? "Provider"), this.t("settings.providers", "模型提供商"), String(provider.description ?? provider.command ?? "")])
      : section === "participants"
        ? [[this.t("settings.participants", "参与者"), this.#currentProject || "Project", this.t("navigation.projectSettingsSubtitle", "管理当前项目的参与者配置。")]]
        : section === "project"
          ? [[this.#currentProject || this.t("navigation.project", "当前项目"), "Project", this.t("navigation.projectSettingsSubtitle", "管理当前项目配置。")], [this.t("settings.store", "存储"), "Persistence", this.t("settings.storageLocation", "存储位置")]]
          : section === "view"
            ? [[this.t("settings.viewService", "界面服务"), "ViewHost", this.t("navigation.globalSettingsSubtitle", "管理 Memsphere 全局配置。")], [this.t("settings.scope", "作用范围"), "Memsphere", this.t("settings.scope.global", "全局配置")]]
            : section === "general"
              ? [[this.t("settings.language", "工作语言"), this.#config.locale ?? "zh-CN", this.t("settings.languageHelp", "影响 View 的显示语言")], [this.t("settings.scope", "作用范围"), "Memsphere", this.t("settings.scope.global", "全局配置")]]
              : [[this.t("settings.language", "工作语言"), this.#config.locale ?? "zh-CN", this.t("settings.languageHelp", "影响 View 的显示语言")], [this.t("navigation.project", "当前项目"), this.#currentProject || "-", this.t("navigation.projectSettingsSubtitle", "Project 级设置与数据边界")], [this.t("settings.status", "服务状态"), this.t("service.healthy", "运行正常"), "ViewHost"]];
    const cards = records.length ? records : [[title, this.t("common.settings", "设置"), this.t("settings.notLoaded", "配置尚未加载。")]];
    return `<header class="settings-list-header"><div><small>${escapeHtml(this.t("common.settings", "设置"))}</small><h2>${escapeHtml(title)}</h2></div><button type="button" data-action="reload" aria-label="${escapeAttr(this.t("settings.reload", "重新读取"))}"><img src="/assets/system-icons/arrows-clockwise.svg" alt=""></button></header>
      <label class="settings-local-search"><img src="/assets/system-icons/magnifying-glass.svg" alt=""><input type="search" placeholder="${escapeAttr(this.t("settings.search", `搜索${title}`))}" aria-label="${escapeAttr(this.t("settings.search", `搜索${title}`))}"></label>
      <div class="settings-record-list">${cards.map(([name, meta, summary], index) => `<article class="settings-record${index === 0 ? " active" : ""}"><span class="settings-record-icon"><img src="/assets/system-icons/gear-six.svg" alt=""></span><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(meta)}</small><p>${escapeHtml(summary)}</p></span><img class="settings-record-caret" src="/assets/system-icons/caret-down.svg" alt=""></article>`).join("")}</div>
      <footer class="settings-list-footer">${cards.length} ${escapeHtml(this.t("settings.results", "条结果"))}</footer>`;
  }

  contentHtml(scope: ScopeState): string {
    if (this.#meta?.requiresToken && !this.#scopes.global.data) return this.tokenHtml();
    if (!scope.data || !scope.draft) return empty(this.#scope === "project"
      ? this.t("settings.projectUnavailable", "当前没有可管理的项目，但仍可管理 Memsphere 全局设置。")
      : this.t("settings.notLoaded", "配置尚未加载。"));
    if (this.#module === "appearance") return this.appearanceHtml();
    if (scope.confirmation) return this.confirmationHtml(scope);
    const status = this.statusHtml(scope);
    const notice = scope.notice ? `<div class="settings-notice" role="status">${escapeHtml(scope.notice)}</div>` : "";
    const panel = this.#module === "general" ? this.generalHtml(scope)
      : this.#module === "view" ? this.viewHtml(scope)
      : this.#module === "providers" ? this.providersHtml(scope)
      : this.#module === "participants" ? this.participantsHtml(scope)
      : this.overviewHtml(scope);
    const actions = ["general", "view", "providers", "participants"].includes(this.#module)
      ? `<div class="settings-actions"><button class="btn" data-action="reload">${escapeHtml(this.t("settings.reload", "重新读取"))}</button><button class="btn primary" data-action="validate">${escapeHtml(this.t("common.save", "保存"))}</button></div>` : "";
    return `<div class="settings-layout">${status}${notice}${panel}${actions}</div>`;
  }

  tokenHtml(): string {
    return `<section class="settings-section settings-token"><h3>${escapeHtml(this.t("settings.validatePermission", "验证配置操作权限"))}</h3>
      <div class="settings-field"><label for="settings-token">${escapeHtml(this.t("settings.token", "操作令牌"))}</label>
      <input id="settings-token" class="settings-input" type="password" value="${escapeAttr(this.#token)}"${this.#tokenError ? ' aria-invalid="true" aria-describedby="settings-token-error"' : ""}>
      ${this.#tokenError ? `<div id="settings-token-error" class="settings-error" role="alert">${escapeHtml(this.#tokenError)}</div>` : ""}
      <div class="settings-help">${escapeHtml(this.t("settings.tokenHelpPrefix", "不知道令牌？请在启动界面的工作区执行："))}<code>memsphere view status</code>${escapeHtml(this.t("settings.tokenHelpSuffix", "。"))}</div></div>
      <button class="btn primary" data-action="token">${escapeHtml(this.t("settings.enter", "进入配置中心"))}</button></section>`;
  }

  statusHtml(scope: ScopeState, scopeName: ScopeName = this.#scope): string {
    const dirty = JSON.stringify(scope.draft) !== JSON.stringify(scope.data?.config);
    const id = this.#module === "appearance" ? `settings-status-${scopeName}` : "settings-status";
    return `<div id="${id}" data-settings-status="${scopeName}" class="settings-status">
      ${pill(dirty
        ? this.t("settings.unsaved", "有未保存修改")
        : this.t(scope.data?.restartRequired || scope.data?.restartPending ? "settings.restartPending" : "settings.saved", scope.data?.restartRequired || scope.data?.restartPending ? "已保存，重启后生效" : "已保存"), dirty || scope.data?.restartRequired || scope.data?.restartPending ? "warn" : "done")}
      ${scope.errors.length ? pill(this.t("settings.errorCount", `有 ${scope.errors.length} 项需要修改`, { count: scope.errors.length }), "warn") : ""}
    </div>`;
  }

  overviewHtml(scope: ScopeState): string {
    const data = scope.data!;
    const rows = this.#scope === "global" ? [
      [this.t("settings.scope", "范围"), "Memsphere Home"],
      [this.t("settings.scope.global", "全局配置"), data.configPath],
      [this.t("settings.registeredProjects", "已注册项目"), String(this.#projects.length)],
      [this.t("settings.providerCount", "ACP 提供方"), String(data.acpProviderCatalog?.length ?? 0)]
    ] : [
      [this.t("navigation.project", "项目"), data.projectName ?? "-"],
      [this.t("settings.scope.project", "项目配置"), data.configPath],
      [this.t("settings.storeType", "存储类型"), data.store?.type ?? "-"],
      [this.t("settings.store", "存储"), JSON.stringify(data.store ?? {})]
    ];
    const paths = this.#scope === "project" ? `<h4>${escapeHtml(this.t("settings.storageLocation", "存储位置"))}</h4><div class="settings-grid">${[
      ["memoryRoot", this.t("settings.memoryRoot", "Memory 根目录")], ["runsRoot", this.t("settings.runsRoot", "Run 根目录")], ["archiveRoot", this.t("settings.archiveRoot", "归档根目录")]
    ].map(([key, label]) => readOnly(label, data.resolvedPaths?.[key] ?? "-")).join("")}</div>` : "";
    return `<section class="settings-section"><h3>${escapeHtml(this.t("settings.overview", "概览"))}</h3><div class="settings-grid">${rows.map(([label, value]) => readOnly(label, value)).join("")}</div>${paths}</section>`;
  }

  generalHtml(scope: ScopeState): string {
    return `<section class="settings-section"><h3>${escapeHtml(this.t("settings.general", "常规"))}</h3><div class="settings-grid">
      ${selectField("language", this.t("settings.workingLanguage", "工作语言"), scope.draft?.language ?? "zh-CN", [["zh-CN", "中文"], ["en", "English"]])}
    </div><div class="settings-token-management"><div class="settings-section-head"><div><h4>${escapeHtml(this.t("settings.operatorTokenTitle", "操作令牌"))}</h4><p class="settings-section-subtitle">${escapeHtml(scope.data?.operatorTokenConfigured
      ? this.t("settings.operatorTokenConfigured", "已设置固定令牌；Memsphere 重启后继续使用它。")
      : this.t("settings.operatorTokenRandom", "未设置固定令牌；每次启动会生成新的随机令牌。"))}</p></div>${pill(scope.data?.operatorTokenConfigured
      ? this.t("settings.configured", "已设置")
      : this.t("settings.randomEachStart", "每次随机"), scope.data?.operatorTokenConfigured ? "done" : "")}</div>
      <div class="settings-token-editor"><div class="settings-field"><label for="settings-operator-token">${escapeHtml(this.t("settings.newOperatorToken", "新操作令牌"))}</label><input id="settings-operator-token" class="settings-input" data-operator-token type="password" autocomplete="new-password" value="${escapeAttr(this.#operatorTokenDraft)}" placeholder="${escapeAttr(this.t("settings.operatorTokenPlaceholder", "输入任意令牌"))}"${this.#operatorTokenError ? ' aria-invalid="true" aria-describedby="settings-operator-token-error"' : ""}></div>
      <div class="settings-token-buttons"><button class="btn primary" data-action="save-operator-token">${escapeHtml(this.t("settings.saveOperatorToken", "设置固定令牌"))}</button>${scope.data?.operatorTokenConfigured ? `<button class="btn" data-action="clear-operator-token">${escapeHtml(this.t("settings.clearOperatorToken", "恢复每次随机"))}</button>` : ""}</div></div>
      ${this.#operatorTokenError ? `<div id="settings-operator-token-error" class="settings-error" role="alert">${escapeHtml(this.#operatorTokenError)}</div>` : ""}
      <p class="settings-help">${escapeHtml(this.t("settings.operatorTokenHelp", "令牌不会在页面中回显。修改后请重启 View；当前会话仍使用旧令牌。"))}</p></div>${this.errorsHtml(scope)}</section>`;
  }

  viewHtml(scope: ScopeState): string {
    const explicit = Boolean(scope.draft?.view);
    const view = scope.draft?.view ?? scope.data?.defaults?.view ?? { host: "127.0.0.1", port: 3000 };
    return `<section class="settings-section"><h3>${escapeHtml(this.t("settings.viewService", "界面服务"))}</h3><div class="settings-grid">
      ${inputField("view.host", this.t("settings.host", "主机"), view.host ?? "", { disabled: !explicit })}
      ${inputField("view.port", this.t("settings.port", "端口"), String(view.port ?? ""), { type: "number", disabled: !explicit, min: "0", max: "65535" })}
      </div><label class="settings-check settings-default-toggle"><input data-field="view.default" type="checkbox"${explicit ? "" : " checked"}><span>${escapeHtml(this.t("settings.useDefaultView", "使用默认界面配置"))}</span></label>
      <p class="settings-help">${escapeHtml(this.t("settings.viewRestartHelp", "保存后执行 memsphere view restart，使主机与端口配置生效。"))}</p>${this.errorsHtml(scope)}</section>`;
  }

  appearanceHtml(): string {
    const global = this.#scopes.global;
    const notices = [...new Set([global.notice].filter(Boolean))];
    return `<div class="settings-layout settings-appearance">
      ${this.appearanceStatusHtml()}${notices.map(notice => `<div class="settings-notice" role="status">${escapeHtml(notice)}</div>`).join("")}${this.packagesHtml(global)}${this.compositionHtml(global)}
      <div class="settings-actions"><button class="btn" data-action="reload-appearance">${escapeHtml(this.t("settings.reload", "重新读取"))}</button><button class="btn primary" data-action="save-appearance">${escapeHtml(this.t("common.save", "保存"))}</button></div>
    </div>`;
  }

  appearanceStatusHtml(): string {
    const scopes = [this.#scopes.global];
    const dirty = scopes.some(scope => JSON.stringify(scope.draft) !== JSON.stringify(scope.data?.config));
    const restart = scopes.some(scope => scope.data?.restartRequired || scope.data?.restartPending);
    const errors = scopes.reduce((count, scope) => count + scope.errors.length, 0);
    return `<div id="settings-status-appearance" class="settings-status">${pill(dirty ? this.t("settings.unsaved", "有未保存修改") : restart ? this.t("settings.restartPending", "已保存，重启后生效") : this.t("settings.saved", "已保存"), dirty || restart ? "warn" : "done")}${errors ? pill(this.t("settings.errorCount", `有 ${errors} 项需要修改`, { count: errors }), "warn") : ""}</div>`;
  }

  confirmationPanelHtml(scopeName: ScopeName, scope: ScopeState): string {
    const confirmation = scope.confirmation!;
    const changes = confirmation.changes ?? [];
    return `<section class="settings-section"><h3>${escapeHtml(this.t("settings.confirmChanges", "确认配置变更"))}</h3><ul class="settings-change-list">${changes.length ? changes.map((change: JsonObject) => `<li>${escapeHtml(`${change.path} · ${change.kind} · ${compact(change.before)} → ${compact(change.after)}`)}</li>`).join("") : `<li>${escapeHtml(this.t("settings.noChanges", "没有配置变化。"))}</li>`}</ul><div class="settings-actions"><button class="btn" data-action="back-${scopeName}">${escapeHtml(this.t("settings.backToEdit", "返回编辑"))}</button><button class="btn primary" data-action="save-${scopeName}"${changes.length ? "" : " disabled"}>${escapeHtml(this.t("settings.confirmSave", "确认保存"))}</button></div></section>`;
  }

  packagesHtml(scope: ScopeState): string {
    const records = scope.draft?.view_packages?.installed ?? [];
    const resolved = new Map((this.#viewPackages.installed ?? []).map((item: JsonObject) => [item.path, item]));
    const diagnostics = this.#viewPackages.diagnostics ?? [];
    const themeOptions: Array<[string, string]> = [["", "系统默认主题"], ...(this.#viewPackages.installed ?? []).flatMap((item: JsonObject) => (item.themes ?? []).map((theme: JsonObject) => [`${item.id}:${theme.id}`, `${item.id} · ${theme.id}`] as [string, string]))];
    const cards = records.map((record: JsonObject, index: number) => {
      const item = resolved.get(record.path) as JsonObject | undefined;
      const diagnostic = diagnostics.find((entry: JsonObject) => entry.path === record.path);
      const content = item ? [`${(item.themes ?? []).length} 个主题`, `${(item.contributions ?? []).length} 个界面扩展`, `${(item.styles ?? []).length} 个样式`].join(" · ") : "保存并重启后读取扩展包内容";
      const packageStatus = diagnostic?.message ? pill("读取失败", "warn") : item ? pill("已安装", "done") : pill("待保存并重启", "warn");
      return `<article class="settings-provider settings-view-package"><div class="settings-section-head"><div><div class="settings-package-title"><strong>${escapeHtml(item ? `${item.id}@${item.version}` : record.path)}</strong>${packageStatus}</div><p class="settings-package-path"><span>本地路径</span><code class="mono">${escapeHtml(record.path)}</code></p></div><button class="btn danger" data-remove-view-package="${index}">卸载</button></div>
        <div class="settings-package-summary"><span>${escapeHtml(content)}</span>${item ? `<button class="btn" data-apply-view-package="${escapeAttr(`${item.id}@${item.version}`)}">一键应用全部</button>` : ""}</div>
        ${diagnostic?.message ? `<div class="settings-error">${escapeHtml(diagnostic.message)}</div>` : ""}</article>`;
    }).join("");
    return `<section class="settings-section"><div class="settings-section-head"><div><h3>安装新扩展包</h3><p class="settings-section-subtitle">选择包含 module.json 的本地扩展包文件夹。</p></div></div>
      <div class="settings-token-editor"><div class="settings-field"><label for="settings-package-path">扩展包文件夹</label><input id="settings-package-path" class="settings-input mono" value="${escapeAttr(this.#packagePathDraft)}" placeholder="/absolute/path/to/package"></div><button class="btn" data-action="add-view-package">安装</button></div>${this.errorsHtml(scope)}</section>
      <section class="settings-section"><div class="settings-section-head"><div><h3>已安装扩展包（${records.length}）</h3><p class="settings-section-subtitle">查看包内内容或卸载扩展包。</p></div></div>
      <div class="settings-providers settings-installed-packages">${cards || empty("尚未安装界面扩展包。")}</div></section>
      <section class="settings-section"><div class="settings-section-head"><div><h3>主题配置</h3><p class="settings-section-subtitle">选择主题和明暗模式。</p></div></div><div class="settings-grid">${selectField("view_theme.mode", "明暗模式", scope.draft?.view_theme?.mode ?? "system", [["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]])}${selectField("view_theme.selected_source", "主题", scope.draft?.view_theme?.selected_source ?? "", themeOptions)}</div></section>`;
  }

  compositionHtml(scope: ScopeState): string {
    const view = scope.draft?.view_composition ?? { packages: [] };
    const selected = view.packages ?? [];
    const installed = this.#viewPackages.installed ?? [];
    const slotDefinitions: JsonObject[] = this.#viewPackages.configurableSlots ?? [];
    const slotFields = slotDefinitions.map(slot => {
      const cell = String(slot.id);
      const [label, help] = viewSlotLabel(cell);
      const candidates: Array<{ identity: string; label: string; packageIdentity: string }> = [];
      for (const item of installed) {
        const record = selected.find((entry: JsonObject) => entry.id === item.id && entry.version === item.version);
        const instanceId = record?.instance_id ?? item.id;
        if (cell === "styles.global@1") {
          for (const style of item.styles ?? []) if (style.scope === "global") candidates.push({ identity: `${item.id}:${instanceId}:${style.id}`, label: `${item.id} · ${style.id}`, packageIdentity: `${item.id}@${item.version}` });
        } else {
          for (const contribution of item.contributions ?? []) if (contribution.slotId === cell) candidates.push({ identity: `${item.id}:${instanceId}:${contribution.id}`, label: `${item.id} · ${contribution.id}`, packageIdentity: `${item.id}@${item.version}` });
        }
      }
      const legacy = selected.filter((entry: JsonObject) => entry.enabled !== false).flatMap((record: JsonObject) => {
        const item = installed.find((entry: JsonObject) => entry.id === record.id && entry.version === record.version);
        return (item?.contributions ?? []).filter((entry: JsonObject) => entry.slotId === cell).sort((left: JsonObject, right: JsonObject) => left.priority - right.priority).map((entry: JsonObject) => `${item.id}:${record.instance_id ?? item.id}:${entry.id}`);
      })[0] ?? "";
      if (slot.kind === "list") {
        const configured = view.slots?.[cell];
        const defaults = cell === "styles.global@1" && view.styles
          ? candidates.filter(candidate => view.styles[candidate.identity]).map(candidate => candidate.identity)
          : candidates.filter(candidate => selected.some((record: JsonObject) => record.enabled !== false && candidate.identity.startsWith(`${record.id}:${record.instance_id ?? record.id}:`))).map(candidate => candidate.identity);
        const active = new Set(Array.isArray(configured) ? configured : configured ? [configured] : configured === undefined ? defaults : []);
        return `<tr><td><strong>${escapeHtml(label)}</strong><small>${escapeHtml(help)}</small></td><td>可多选</td><td>${multiSelectField(cell, `选择${label}使用的内容`, candidates, active)}</td></tr>`;
      }
      const options: Array<[string, string]> = [["", "使用系统默认"], ...candidates.map(candidate => [candidate.identity, candidate.label] as [string, string])];
      const configured = view.slots?.[cell];
      const current = Object.prototype.hasOwnProperty.call(view.slots ?? {}, cell) ? (typeof configured === "string" ? configured : "") : legacy;
      return `<tr><td><strong>${escapeHtml(label)}</strong><small>${escapeHtml(help)}</small></td><td>单选</td><td>${selectField(`view_composition.slot.${cell}`, `选择${label}使用的内容`, current, options)}</td></tr>`;
    }).join("");
    return `<section class="settings-section"><div class="settings-section-head"><div><h3>界面配置</h3><p class="settings-section-subtitle">为每个界面位置选择系统默认内容，或选用任意已安装扩展包提供的页面、组件和样式。</p></div></div><div class="settings-table-wrap"><table class="settings-config-table"><thead><tr><th>界面位置</th><th>类型</th><th>使用内容</th></tr></thead><tbody>${slotFields}</tbody></table></div>${this.errorsHtml(scope)}</section>`;
  }

  participantsHtml(scope: ScopeState): string {
    const draft = scope.draft!;
    if (!draft.control_plane) return `<section class="settings-section"><h3>${escapeHtml(this.t("settings.participants", "参与者配置"))}</h3><p class="muted">${escapeHtml(this.t("settings.participantDisabled", "当前未启用参与者控制平面。"))}</p><button class="btn" data-action="enable-participants">${escapeHtml(this.t("settings.enableParticipants", "启用参与者配置"))}</button></section>`;
    const runner = this.participantHtml("runner", draft.control_plane.runner ?? { permissions: [] }, true, scope);
    const actors = Object.entries(draft.control_plane.actors ?? {}).map(([id, actor]) => this.participantHtml(id, actor as JsonObject, false, scope)).join("");
    return `<section class="settings-section"><div class="settings-section-head"><div><h3>${escapeHtml(this.t("settings.participants", "参与者配置"))}</h3><p class="settings-section-subtitle">${escapeHtml(this.t("settings.participantHelp", "按参与者展开编辑权限；Agent 只选择 ACP 提供方与模型。"))}</p></div><button class="btn" data-action="add-participant">${escapeHtml(this.t("settings.addParticipant", "添加参与者"))}</button></div><div class="settings-participants">${runner}${actors}</div>${this.errorsHtml(scope)}</section>`;
  }

  participantHtml(id: string, actor: JsonObject, runner: boolean, scope: ScopeState): string {
    const open = this.#expandedParticipants.has(id);
    const permissionCatalog = scope.data?.permissionCatalog ?? [];
    const known = new Set(permissionCatalog.map((item: JsonObject) => item.id));
    const count = (actor.permissions ?? []).filter((permission: string) => known.has(permission)).length;
    const permissions = permissionCatalog.map((definition: JsonObject) => `<div class="settings-permission"><label class="settings-check"><input type="checkbox" data-permission="${escapeAttr(definition.id)}" data-actor="${escapeAttr(id)}"${(actor.permissions ?? []).includes(definition.id) ? " checked" : ""}><span>${escapeHtml(definition.id)}</span></label><p>${escapeHtml(definition.descriptions?.[this.#config.locale ?? "zh-CN"] ?? definition.id)}</p></div>`).join("");
    const basic = runner ? "" : `<div class="settings-grid settings-compact-grid settings-participant-basic">
      ${inputField(`actor.${id}.id`, "ID", id, { commit: true })}
      ${selectField(`actor.${id}.kind`, this.t("settings.type", "类型"), actor.kind ?? "human", [["human", this.t("settings.human", "Human")], ["agent", this.t("settings.agent", "Agent")]])}
      ${inputField(`actor.${id}.name`, this.t("settings.name", "名称"), actor.name ?? "")}
      ${textAreaField(`actor.${id}.system_prompt`, this.t("settings.systemPrompt", "系统提示词"), actor.system_prompt ?? "")}
    </div>`;
    const runtime = !runner && actor.kind === "agent" ? `<div><h4>${escapeHtml(this.t("settings.agentRuntime", "Agent 运行"))}</h4><div class="settings-grid settings-compact-grid">
      ${selectField(`actor.${id}.provider`, this.t("settings.providers", "ACP 提供方"), actor.agent?.provider ?? "traex", this.providerEntries().map(entry => [entry.id, `${entry.id} · ${entry.definition.name} · ${this.providerStatus(entry.id)}`]))}
      ${inputField(`actor.${id}.model`, this.t("settings.model", "模型"), actor.agent?.model ?? "")}
    </div></div>` : "";
    return `<details class="settings-participant" data-participant="${escapeAttr(id)}"${open ? " open" : ""}><summary class="settings-participant-summary"><div><strong>${escapeHtml(runner ? this.t("runner", "执行者") : actor.name || id)}</strong> ${pill(runner ? "runner" : actor.kind)}<div class="settings-participant-summary-meta">${escapeHtml(this.t("settings.permissionCount", `${count} 项权限`, { count }))}</div></div></summary><div class="settings-participant-body"><div class="settings-participant-actions"><button class="btn danger" data-remove-participant="${escapeAttr(id)}"${runner ? " disabled" : ""}>${escapeHtml(this.t("common.delete", "删除"))}</button></div>${basic}<h4>${escapeHtml(this.t("settings.permissions", "权限"))}</h4><div class="settings-permissions">${permissions}</div>${runtime}</div></details>`;
  }

  providersHtml(scope: ScopeState): string {
    const entries = this.providerEntries().map(entry => this.providerHtml(entry)).join("");
    return `<section class="settings-section"><div class="settings-section-head"><div><h3>${escapeHtml(this.t("settings.providers", "ACP 提供方"))}</h3><p class="settings-section-subtitle">${escapeHtml(this.t("settings.providerHelp", "管理 Agent CLI、启动参数与安装检测；认证仍由各提供方自身管理。"))}</p></div><button class="btn" data-action="detect"${this.#detecting ? " disabled" : ""}>${escapeHtml(this.t(this.#detecting ? "settings.detecting" : "settings.autoDetect", this.#detecting ? "检测中……" : "自动检测"))}</button></div><div class="settings-providers">${entries}</div>${this.errorsHtml(scope)}</section>`;
  }

  providerHtml(entry: JsonObject): string {
    const provider = entry.value;
    const references = this.providerReferences(entry.id);
    const detection = this.#providerDetection[entry.id];
    const open = this.#expandedProviders.has(entry.id);
    const disabled = references.length > 0 || !entry.explicit;
    const title = references.length ? this.t("settings.referencedBy", `以下参与者仍在引用：${references.join("、")}`, { references: references.join("、") }) : !entry.explicit ? this.t("settings.defaultInUse", "当前正在使用系统默认值") : "";
    return `<details class="settings-provider settings-participant" data-provider-id="${escapeAttr(entry.id)}"${open ? " open" : ""}><summary class="settings-participant-summary"><div><strong>${escapeHtml(entry.id)}</strong> ${pill(entry.definition.name)} ${pill(this.providerStatus(entry.id), detection?.status === "installed" ? "done" : detection?.status === "missing" || detection?.status === "failed" ? "warn" : "", "settings-provider-detection")}<div class="settings-participant-summary-meta">${escapeHtml([detection?.path, detection?.version || detection?.reason || this.t("settings.notDetected", "未检测"), this.t("settings.participantReferences", `${references.length} 个参与者引用`, { count: references.length })].filter(Boolean).join(" · "))}</div></div></summary><div class="settings-participant-body"><div class="settings-participant-actions"><button class="btn" data-reset-provider="${escapeAttr(entry.id)}"${disabled ? " disabled" : ""} title="${escapeAttr(title)}">${escapeHtml(this.t("settings.restoreDefaults", "恢复默认值"))}</button></div>
      ${detection && ["missing", "failed"].includes(detection.status) ? `<div class="settings-error" role="alert">${escapeHtml([detection.reason, detection.installHelp].filter(Boolean).join(" "))}</div>` : ""}
      <div class="settings-grid">${inputField(`provider.${entry.id}.command`, this.t("settings.command", "命令"), provider.command ?? entry.definition.defaultCommand, { disabled: true })}</div>
      <div class="settings-grid settings-participant-basic">${inputField(`provider.${entry.id}.startup_timeout_ms`, this.t("settings.startupTimeout", "启动超时（毫秒）"), String(provider.startup_timeout_ms ?? 60000), { type: "number", min: "1" })}${inputField(`provider.${entry.id}.idle_timeout_ms`, this.t("settings.idleTimeout", "空闲超时（毫秒）"), String(provider.idle_timeout_ms ?? 120000), { type: "number", min: "1" })}${inputField(`provider.${entry.id}.max_runtime_ms`, this.t("settings.maxRuntime", "最长运行时间（毫秒）"), provider.max_runtime_ms == null ? "" : String(provider.max_runtime_ms), { type: "number", min: "1" })}</div>
      ${textAreaField(`provider.${entry.id}.args`, this.t("settings.args", "参数（每行一个）"), (provider.args ?? []).join("\n"))}${textAreaField(`provider.${entry.id}.env`, this.t("settings.env", "环境变量（每行 KEY=VALUE；禁止凭据）"), Object.entries(provider.env ?? {}).map(([key, value]) => `${key}=${String(value)}`).join("\n"))}
      <div class="settings-provider-preview mono">${escapeHtml(this.t("settings.actualLaunch", `实际启动：${this.providerPreview(provider)}`, { command: this.providerPreview(provider) }))}</div></div></details>`;
  }

  confirmationHtml(scope: ScopeState): string {
    const confirmation = scope.confirmation!;
    const changes = confirmation.changes ?? [];
    return `<div class="settings-layout">${this.statusHtml(scope)}<section class="settings-section"><h3>${escapeHtml(this.t("settings.confirmChanges", "确认配置变更"))}</h3><ul class="settings-change-list">${changes.length ? changes.map((change: JsonObject) => `<li>${escapeHtml(`${change.path} · ${change.kind} · ${compact(change.before)} → ${compact(change.after)}`)}</li>`).join("") : `<li>${escapeHtml(this.t("settings.noChanges", "没有配置变化。"))}</li>`}</ul><h4>${escapeHtml(this.t("settings.jsonDiff", "JSON diff"))}</h4><pre class="settings-code mono">${escapeHtml(confirmation.normalizedJson ?? JSON.stringify(scope.draft, null, 2))}</pre><div class="settings-actions"><button class="btn" data-action="back">${escapeHtml(this.t("settings.backToEdit", "返回编辑"))}</button><button class="btn primary" data-action="save"${changes.length ? "" : " disabled"}>${escapeHtml(this.t("settings.confirmSave", "确认保存"))}</button></div></section></div>`;
  }

  errorsHtml(scope: ScopeState): string {
    if (!scope.errors.length) return "";
    return `<div class="settings-errors" role="alert">${scope.errors.map(error => `<div class="settings-error">${escapeHtml([error.path, error.message].filter(Boolean).join(" · "))}</div>`).join("")}</div>`;
  }

  bind(): void {
    for (const root of this.surfaceRoots()) this.bindRoot(root);
  }

  private bindRoot(root: HTMLElement): void {
    root.querySelectorAll<HTMLDetailsElement>("details[data-provider-id]").forEach(item => item.addEventListener("toggle", () => toggleSet(this.#expandedProviders, item.dataset.providerId!, item.open), { signal: this.#signal }));
    root.querySelectorAll<HTMLDetailsElement>("details[data-participant]").forEach(item => item.addEventListener("toggle", () => toggleSet(this.#expandedParticipants, item.dataset.participant!, item.open), { signal: this.#signal }));
    root.querySelectorAll<HTMLButtonElement>("[data-section]").forEach(button => button.addEventListener("click", () => void this.activate(button.dataset.section as SectionName), { signal: this.#signal }));
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[data-field]").forEach(field => {
      const event = field.dataset.commit === "true" ? "change" : field instanceof HTMLSelectElement || field.type === "checkbox" ? "change" : "input";
      field.addEventListener(event, () => this.updateField(field, field.closest<HTMLElement>("[data-settings-scope]")?.dataset.settingsScope as ScopeName | undefined), { signal: this.#signal });
    });
    root.querySelectorAll<HTMLButtonElement>("[data-select-field]").forEach(trigger => {
      trigger.addEventListener("click", () => {
        const menu = trigger.nextElementSibling as HTMLElement;
        const open = menu.hidden;
        root.querySelectorAll<HTMLElement>(".settings-select-menu:not([hidden])").forEach(other => {
          other.hidden = true;
          other.previousElementSibling?.setAttribute("aria-expanded", "false");
        });
        menu.hidden = !open;
        trigger.setAttribute("aria-expanded", String(open));
      }, { signal: this.#signal });
      trigger.addEventListener("keydown", event => {
        const menu = trigger.nextElementSibling as HTMLElement;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          menu.hidden = false;
          trigger.setAttribute("aria-expanded", "true");
          menu.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
        } else if (event.key === "Escape") {
          menu.hidden = true;
          trigger.setAttribute("aria-expanded", "false");
        }
      }, { signal: this.#signal });
    });
    root.querySelectorAll<HTMLButtonElement>("[data-select-option]").forEach(option => {
      option.addEventListener("click", () => this.updateNamedField(option.dataset.selectOption!, option.dataset.value!, true, undefined, option.closest<HTMLElement>("[data-settings-scope]")?.dataset.settingsScope as ScopeName | undefined), { signal: this.#signal });
    });
    root.querySelector<HTMLInputElement>("#settings-token")?.addEventListener("input", event => {
      this.#token = (event.currentTarget as HTMLInputElement).value.trim();
      this.#tokenError = "";
      root.querySelector("#settings-token-error")?.remove();
      (event.currentTarget as HTMLInputElement).removeAttribute("aria-invalid");
      (event.currentTarget as HTMLInputElement).removeAttribute("aria-describedby");
    }, { signal: this.#signal });
    root.querySelector<HTMLInputElement>("[data-operator-token]")?.addEventListener("input", event => {
      this.#operatorTokenDraft = (event.currentTarget as HTMLInputElement).value;
      this.#operatorTokenError = "";
      (event.currentTarget as HTMLInputElement).removeAttribute("aria-invalid");
      (event.currentTarget as HTMLInputElement).removeAttribute("aria-describedby");
      root.querySelector("#settings-operator-token-error")?.remove();
    }, { signal: this.#signal });
    root.querySelectorAll<HTMLInputElement>("[data-permission]").forEach(input => input.addEventListener("change", () => this.updatePermission(input), { signal: this.#signal }));
    root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach(button => button.addEventListener("click", () => void this.action(button.dataset.action!), { signal: this.#signal }));
    root.querySelectorAll<HTMLButtonElement>("[data-remove-participant]").forEach(button => button.addEventListener("click", () => this.removeParticipant(button.dataset.removeParticipant!), { signal: this.#signal }));
    root.querySelectorAll<HTMLButtonElement>("[data-reset-provider]").forEach(button => button.addEventListener("click", () => this.resetProvider(button.dataset.resetProvider!), { signal: this.#signal }));
    root.querySelector<HTMLInputElement>("#settings-package-path")?.addEventListener("input", event => { this.#packagePathDraft = (event.currentTarget as HTMLInputElement).value; }, { signal: this.#signal });
    root.querySelectorAll<HTMLButtonElement>("[data-remove-view-package]").forEach(button => button.addEventListener("click", () => this.removeViewPackage(Number(button.dataset.removeViewPackage)), { signal: this.#signal }));
    root.querySelectorAll<HTMLButtonElement>("[data-apply-view-package]").forEach(button => button.addEventListener("click", () => this.applyViewPackage(button.dataset.applyViewPackage!), { signal: this.#signal }));
    root.querySelectorAll<HTMLInputElement>("[data-project-view-slot-list]").forEach(input => input.addEventListener("change", () => this.updateProjectViewSlotList(input), { signal: this.#signal }));
    root.querySelectorAll<HTMLInputElement>("[data-project-view-slot-list]").forEach(input => input.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      const details = input.closest<HTMLDetailsElement>("[data-multiselect-field]");
      if (!details) return;
      details.open = false;
      details.querySelector<HTMLElement>("summary")?.focus();
    }, { signal: this.#signal }));
  }

  private surfaceRoots(): readonly HTMLElement[] { return [this.#listRoot, this.#detailRoot].filter((root): root is HTMLElement => Boolean(root)).concat(this.#listRoot || this.#detailRoot ? [] : [this.#root]); }
  private detailRoot(): HTMLElement { return this.#detailRoot ?? this.#root; }

  async activate(sectionName: SectionName): Promise<void> {
    const destination = sections[sectionName];
    this.#scope = destination.scope;
    this.#module = destination.module;
    await this.#options.navigate(this.#options.route.to({ module: sectionName }));
    this.render();
  }

  async action(name: string): Promise<void> {
    try {
      if (name === "token") {
        this.#token = this.detailRoot().querySelector<HTMLInputElement>("#settings-token")?.value.trim() ?? "";
        await this.load();
      } else if (name === "reload") await this.load(this.#scope);
      else if (name === "reload-global") await this.load("global");
      else if (name === "reload-project") await this.load("project");
      else if (name === "reload-appearance") { await this.load("global"); await this.load("project"); }
      else if (name === "validate") await this.validate();
      else if (name === "validate-global") await this.validateScope("global");
      else if (name === "validate-project") await this.validateScope("project");
      else if (name === "save") await this.save();
      else if (name === "save-global") await this.saveScope("global");
      else if (name === "save-project") await this.saveScope("project");
      else if (name === "save-appearance") await this.saveAppearance();
      else if (name === "back") { this.state.confirmation = null; this.render(); }
      else if (name === "back-global") { this.#scopes.global.confirmation = null; this.render(); }
      else if (name === "back-project") { this.#scopes.project.confirmation = null; this.render(); }
      else if (name === "detect") await this.detectProviders();
      else if (name === "save-operator-token") await this.saveOperatorToken(false);
      else if (name === "clear-operator-token") await this.saveOperatorToken(true);
      else if (name === "add-view-package") this.addViewPackage();
      else if (name === "enable-participants") {
        this.state.draft!.control_plane = { runner: { permissions: [] }, actors: {} };
        this.render();
      } else if (name === "add-participant") this.addParticipant();
    } catch (error) { this.fail(error); }
  }

  updateField(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, scopeName?: ScopeName): void {
    this.updateNamedField(field.dataset.field!, field.value, field instanceof HTMLSelectElement || field.dataset.commit === "true", field, scopeName);
  }

  updateNamedField(
    path: string,
    value: string,
    structural: boolean,
    field?: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    scopeName: ScopeName = this.#scope
  ): void {
    const scope = this.#scopes[scopeName];
    const draft = scope.draft!;
    if (path === "language") draft.language = value;
    else if (path === "view_theme.mode") (draft.view_theme ??= { mode: "system" }).mode = value;
    else if (path === "view_theme.selected_source") {
      draft.view_theme ??= { mode: "system" };
      setOptional(draft.view_theme, "selected_source", value);
    } else if (path.startsWith("view_composition.slot.")) {
      const cell = path.slice("view_composition.slot.".length);
      const view = (draft.view_composition ??= { packages: [] });
      (view.slots ??= {})[cell] = value || null;
      if (value) this.ensureViewPackage(value.split(":")[0]!);
    }
    else if (path === "view.default") {
      if ((field as HTMLInputElement).checked) delete draft.view;
      else draft.view = clone(scope.data!.defaults.view);
      this.render();
      return;
    } else if (path === "view.host") draft.view.host = value;
    else if (path === "view.port") draft.view.port = Number(value);
    else if (path.startsWith("actor.")) this.updateActorField(path, value);
    else if (path.startsWith("provider.")) this.updateProviderField(path, value);
    scope.confirmation = null;
    if (structural) this.render();
    else {
      this.refreshStatus(scopeName);
      if (path.startsWith("provider.")) {
        const id = path.split(".")[1]!;
        const preview = this.detailRoot().querySelector<HTMLElement>(`[data-provider-id="${CSS.escape(id)}"] .settings-provider-preview`);
        const provider = this.providerEntries().find(entry => entry.id === id)?.value;
        if (preview && provider) preview.textContent = this.t("settings.actualLaunch", `实际启动：${this.providerPreview(provider)}`, { command: this.providerPreview(provider) });
        const detection = this.detailRoot().querySelector<HTMLElement>(`[data-provider-id="${CSS.escape(id)}"] .settings-provider-detection`);
        if (detection) detection.textContent = this.t("settings.pendingDetection", "待重新检测");
        const reset = this.detailRoot().querySelector<HTMLButtonElement>(`[data-reset-provider="${CSS.escape(id)}"]`);
        if (reset && this.providerReferences(id).length === 0) { reset.disabled = false; reset.title = ""; }
      }
    }
  }

  refreshStatus(scopeName: ScopeName = this.#scope): void {
    const current = this.detailRoot().querySelector(`[data-settings-status="${scopeName}"]`);
    if (!current) return;
    const template = document.createElement("template");
    template.innerHTML = this.statusHtml(this.#scopes[scopeName], scopeName);
    current.replaceWith(template.content.firstElementChild!);
  }

  refreshAppearanceStatus(): void {
    const current = this.detailRoot().querySelector("#settings-status-appearance");
    if (!current) return;
    const template = document.createElement("template");
    template.innerHTML = this.appearanceStatusHtml();
    current.replaceWith(template.content.firstElementChild!);
  }

  updateActorField(path: string, value: string): void {
    const [, id, key] = path.split(".");
    const actors = this.state.draft!.control_plane.actors as JsonObject;
    const actor = actors[id];
    if (key === "id") {
      const next = value.trim();
      if (!next || next === id) return;
      if (actors[next]) { this.state.notice = this.t("settings.participantIdExists", `参与者 ID 已存在：${next}`, { id: next }); return; }
      actors[next] = actor;
      delete actors[id];
      this.#expandedParticipants.delete(id);
      this.#expandedParticipants.add(next);
    } else if (key === "kind") {
      actor.kind = value;
      if (value === "agent") actor.agent ??= { provider: "traex" };
      else delete actor.agent;
    } else if (key === "name") actor.name = value;
    else if (key === "system_prompt") setOptional(actor, "system_prompt", value);
    else if (key === "provider") { actor.agent ??= {}; actor.agent.provider = value; }
    else if (key === "model") { actor.agent ??= {}; setOptional(actor.agent, "model", value); }
  }

  updatePermission(input: HTMLInputElement): void {
    const id = input.dataset.actor!;
    const control = this.state.draft!.control_plane;
    const actor = id === "runner" ? control.runner : control.actors[id];
    const permissions = [...(actor.permissions ?? [])];
    const index = permissions.indexOf(input.dataset.permission!);
    if (input.checked && index < 0) permissions.push(input.dataset.permission!);
    if (!input.checked && index >= 0) permissions.splice(index, 1);
    actor.permissions = permissions;
    this.render();
  }

  updateProviderField(path: string, value: string): void {
    const [, id, key] = path.split(".");
    const provider = this.ensureProvider(id);
    if (key === "args") provider.args = value.split(/\r?\n/).filter(Boolean);
    else if (key === "env") provider.env = Object.fromEntries(value.split(/\r?\n/).filter(line => line.includes("=")).map(line => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1)]));
    else if (key === "max_runtime_ms") provider[key] = value.trim() ? Number(value) : null;
    else provider[key] = Number(value);
    this.#providerDetection[id] = { status: "pending_redetect" };
  }

  addParticipant(): void {
    const actors = this.state.draft!.control_plane.actors as JsonObject;
    let index = Object.keys(actors).length + 1;
    while (actors[`actor${index}`]) index += 1;
    const id = `actor${index}`;
    actors[id] = { kind: "human", name: this.t("settings.newParticipant", "新参与者"), permissions: [] };
    this.#expandedParticipants.add(id);
    this.render();
  }

  removeParticipant(id: string): void {
    delete this.state.draft!.control_plane.actors[id];
    this.#expandedParticipants.delete(id);
    this.render();
  }

  resetProvider(id: string): void {
    delete this.#scopes.global.draft!.acp_providers?.[id];
    this.#providerDetection[id] = { status: "pending_redetect" };
    this.#expandedProviders.add(id);
    this.render();
  }

  addViewPackage(): void {
    const scope = this.#scopes.global;
    const path = this.#packagePathDraft.trim();
    if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path)) {
      scope.errors = [{ path: "view_packages.installed", message: this.t("settings.absolutePathRequired", "请输入绝对路径。") }];
      this.render();
      return;
    }
    const installed = (scope.draft!.view_packages ??= { installed: [] }).installed as JsonObject[];
    if (!installed.some(entry => entry.path === path)) installed.push({ path });
    this.#packagePathDraft = "";
    scope.errors = [];
    this.render();
  }

  removeViewPackage(index: number): void {
    (this.#scopes.global.draft?.view_packages?.installed ?? []).splice(index, 1);
    this.render();
  }

  ensureViewPackage(packageId: string): JsonObject | undefined {
    const item = (this.#viewPackages.installed ?? []).find((entry: JsonObject) => entry.id === packageId);
    if (!item || !this.#scopes.global.draft) return undefined;
    const packages = (this.#scopes.global.draft.view_composition ??= { packages: [] }).packages as JsonObject[];
    let record = packages.find(entry => entry.id === item.id && entry.version === item.version);
    if (!record) {
      record = { id: item.id, version: item.version, enabled: true };
      packages.push(record);
    } else {
      record.enabled = true;
    }
    return record;
  }

  applyViewPackage(identity: string): void {
    const separator = identity.lastIndexOf("@");
    const packageId = separator > 0 ? identity.slice(0, separator) : identity;
    const version = separator > 0 ? identity.slice(separator + 1) : "";
    const item = (this.#viewPackages.installed ?? []).find((entry: JsonObject) => entry.id === packageId && entry.version === version);
    const global = this.#scopes.global;
    if (!item || !global.draft) return;
    const record = this.ensureViewPackage(packageId)!;
    const view = global.draft.view_composition;
    const instanceId = record.instance_id ?? item.id;
    if ((item.themes ?? []).length) {
      (this.#scopes.global.draft!.view_theme ??= { mode: "system" }).selected_source = `${item.id}:${item.themes[0].id}`;
    }
    view.slots ??= {};
    for (const contribution of item.contributions ?? []) {
      const identity = `${item.id}:${instanceId}:${contribution.id}`;
      const slot = (this.#viewPackages.configurableSlots ?? []).find((entry: JsonObject) => entry.id === contribution.slotId);
      if (slot?.kind === "list") view.slots[contribution.slotId] = [...new Set([...(Array.isArray(view.slots[contribution.slotId]) ? view.slots[contribution.slotId] : []), identity])];
      else view.slots[contribution.slotId ?? contribution.cell] = identity;
    }
    const globalStyles = (item.styles ?? []).filter((style: JsonObject) => style.scope === "global").map((style: JsonObject) => `${item.id}:${instanceId}:${style.id}`);
    if (globalStyles.length) view.slots["styles.global@1"] = [...new Set([...(Array.isArray(view.slots["styles.global@1"]) ? view.slots["styles.global@1"] : []), ...globalStyles])];
    delete view.styles;
    global.notice = `已选用 ${item.id} 提供的全部界面内容；你仍可在下方逐项调整，完成后点击页面底部的保存。`;
    this.render();
  }

  updateProjectViewSlotList(input: HTMLInputElement): void {
    const global = this.#scopes.global;
    if (!global.draft) return;
    const [packageId] = input.dataset.packageIdentity!.split("@");
    this.ensureViewPackage(packageId!);
    const view = (global.draft.view_composition ??= { packages: [] });
    const slotId = input.dataset.projectViewSlotList!;
    const current = Array.isArray(view.slots?.[slotId]) ? view.slots[slotId] as string[] : [];
    (view.slots ??= {})[slotId] = toggleValue(current, input.dataset.value!, input.checked);
    if (slotId === "styles.global@1") delete view.styles;
    const option = input.closest<HTMLElement>("[role=option]");
    option?.setAttribute("aria-selected", String(input.checked));
    const details = input.closest<HTMLDetailsElement>("[data-multiselect-field]");
    const selectedInputs = [...(details?.querySelectorAll<HTMLInputElement>("[data-project-view-slot-list]:checked") ?? [])];
    const labels = selectedInputs.map(candidate => candidate.dataset.label ?? candidate.value);
    const summary = details?.querySelector<HTMLElement>("[data-multiselect-summary]");
    if (summary) {
      summary.textContent = multiSelectSummary(labels);
      summary.title = labels.join("、");
    }
    this.refreshAppearanceStatus();
  }

  updateViewPreference(select: HTMLSelectElement): void {
    const cell = select.dataset.viewPreference!;
    for (const record of this.#scopes.project.draft!.view.packages as JsonObject[]) {
      if (!record.enabled) continue;
      record.preferences ??= {};
      if (select.value) record.preferences[cell] = select.value;
      else delete record.preferences[cell];
      if (!Object.keys(record.preferences).length) delete record.preferences;
    }
    this.refreshStatus("project");
  }

  async validate(): Promise<void> {
    await this.validateScope(this.#scope);
  }

  async validateScope(scopeName: ScopeName): Promise<void> {
    const scope = this.#scopes[scopeName];
    scope.errors = [];
    scope.notice = "";
    const response = await this.settingsFetch(`/api/settings/${scopeName}/validate`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: scope.data!.diskRevision, config: scope.draft })
    });
    const payload = await response.json() as JsonObject;
    if (response.status === 409) scope.notice = this.t("settings.configChanged", "配置文件已在磁盘上变化，请重新读取后再编辑。");
    else if (!response.ok || !payload.valid) scope.errors = payload.errors ?? [{ path: "", message: payload.error ?? this.t("settings.validationFailed", "配置校验失败") }];
    else scope.confirmation = payload;
    this.render();
  }

  async save(): Promise<void> {
    await this.saveScope(this.#scope);
  }

  async saveAppearance(): Promise<void> {
    const availableScopes: ScopeName[] = ["global"];
    const scopeNames = availableScopes.filter(scopeName => {
      const scope = this.#scopes[scopeName];
      return JSON.stringify(scope.draft) !== JSON.stringify(scope.data?.config);
    });
    if (!scopeNames.length) {
      this.#scopes.global.notice = this.t("settings.noChanges", "没有需要保存的修改。");
      this.render();
      return;
    }
    for (const scopeName of scopeNames) {
      await this.validateScope(scopeName);
      if (!this.#scopes[scopeName].confirmation) return;
    }
    for (const scopeName of scopeNames) await this.saveScope(scopeName);
  }

  async saveScope(scopeName: ScopeName): Promise<void> {
    const scope = this.#scopes[scopeName];
    const response = await this.settingsFetch(`/api/settings/${scopeName}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: scope.data!.diskRevision, config: scope.draft })
    });
    const payload = await response.json() as JsonObject;
    if (response.status === 409) { scope.confirmation = null; scope.notice = this.t("settings.saveConflict", "保存失败：配置已被其他进程修改，请先重新读取。"); }
    else if (!response.ok) { scope.confirmation = null; scope.errors = payload.errors ?? [{ path: "", message: payload.error ?? this.t("settings.saveFailed", "保存失败") }]; }
    else {
      scope.data = payload;
      scope.draft = clone(payload.config);
      if (payload.composition) this.#viewPackages.composition = payload.composition;
      scope.confirmation = null;
      scope.errors = [];
      scope.notice = payload.restartRequired
        ? this.t("settings.savedRestart", `配置已保存。请执行 memsphere view restart；重启后地址为 ${viewUrl(payload.config.view ?? payload.defaults.view)}。`, { url: viewUrl(payload.config.view ?? payload.defaults.view) })
        : payload.restartPending
          ? this.t("settings.savedCompositionRestart", "界面组合已保存，当前服务仍使用启动快照；请执行 memsphere view restart 后生效。")
          : this.t("settings.savedApplied", "配置已保存并应用。");
    }
    this.render();
  }

  async saveOperatorToken(clear: boolean): Promise<void> {
    const global = this.#scopes.global;
    const token = clear ? null : this.#operatorTokenDraft.trim();
    if (!clear && !token) {
      this.#operatorTokenError = this.t("settings.operatorTokenInvalid", "操作令牌不能为空。");
      this.render();
      return;
    }
    const response = await this.settingsFetch("/api/settings/global/operator-token", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: global.data!.diskRevision, token })
    });
    const payload = await response.json() as JsonObject;
    if (response.status === 409) {
      global.notice = this.t("settings.configChanged", "配置文件已在磁盘上变化，请重新读取后再编辑。");
    } else if (!response.ok) {
      this.#operatorTokenError = payload.error ?? this.t("settings.saveFailed", "保存失败");
    } else {
      global.data!.diskRevision = payload.diskRevision;
      global.data!.operatorTokenConfigured = payload.operatorTokenConfigured;
      global.data!.restartRequired = true;
      this.#operatorTokenDraft = "";
      global.notice = payload.operatorTokenConfigured
        ? this.t("settings.operatorTokenSaved", "固定令牌已保存，重启 View 后生效。")
        : this.t("settings.operatorTokenCleared", "固定令牌已清除；重启 View 后将恢复每次随机生成。");
    }
    this.render();
  }

  async detectProviders(): Promise<void> {
    this.#detecting = true;
    this.render();
    try {
      const global = this.#scopes.global;
      const response = await this.settingsFetch("/api/settings/global/acp-providers/detect", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: global.data!.diskRevision, config: global.draft })
      });
      const payload = await response.json() as JsonObject;
      if (!response.ok) this.state.errors = payload.errors ?? [{ path: "", message: payload.error ?? this.t("settings.providerDetectionFailed", "ACP 提供方检测失败") }];
      else {
        this.#providerDetection = Object.fromEntries((payload.results ?? []).map((result: JsonObject) => [result.id, result]));
        this.persistDetection();
        this.state.notice = this.t("settings.providerDetectionCompleted", "ACP 提供方检测完成。");
      }
    } finally { this.#detecting = false; this.render(); }
  }

  providerEntries(): JsonObject[] {
    const global = this.#scopes.global;
    const explicit = global.draft?.acp_providers ?? {};
    return (global.data?.acpProviderCatalog ?? []).map((definition: JsonObject) => ({
      id: definition.type, definition, explicit: Boolean(explicit[definition.type]),
      value: { ...this.defaultProvider(definition.type), ...(explicit[definition.type] ?? {}), type: definition.type, command: definition.defaultCommand }
    }));
  }

  defaultProvider(type: string): JsonObject {
    const definition = (this.#scopes.global.data?.acpProviderCatalog ?? []).find((candidate: JsonObject) => candidate.type === type);
    const value = definition?.defaultInstance ?? { type, command: definition?.defaultCommand ?? type, args: [], env: {}, startupTimeoutMs: 60000, idleTimeoutMs: 120000, maxRuntimeMs: null };
    return { type: value.type, command: value.command, args: [...(value.args ?? [])], env: { ...(value.env ?? {}) }, startup_timeout_ms: value.startupTimeoutMs ?? 60000, idle_timeout_ms: value.idleTimeoutMs ?? 120000, max_runtime_ms: value.maxRuntimeMs ?? null };
  }

  ensureProvider(id: string): JsonObject {
    const providers = this.#scopes.global.draft!.acp_providers ??= {};
    providers[id] ??= (() => { const value = this.defaultProvider(id); return { args: [...value.args], env: { ...value.env }, startup_timeout_ms: value.startup_timeout_ms, idle_timeout_ms: value.idle_timeout_ms, max_runtime_ms: value.max_runtime_ms }; })();
    return providers[id];
  }

  providerReferences(id: string): string[] {
    return (this.#scopes.global.data?.providerReferences?.[id] ?? []).map((reference: JsonObject) => `${reference.projectName} / ${reference.actorName || reference.actorId}`);
  }

  providerStatus(id: string): string {
    const status = this.#providerDetection[id]?.status;
    const labels: Record<string, string> = {
      installed: this.t("settings.provider.detection.installed", "已安装"), version_unknown: this.t("settings.provider.detection.versionUnknown", "已找到 · 版本未知"),
      missing: this.t("settings.provider.detection.notInstalled", "未安装"), failed: this.t("settings.provider.detection.failedLabel", "检测失败"), pending_redetect: this.t("settings.pendingDetection", "待重新检测")
    };
    return labels[status] ?? this.t("settings.provider.detection.pending", "待检测");
  }

  providerPreview(provider: JsonObject): string {
    const args = [provider.command];
    const model = `<${this.t("settings.participantModelPlaceholder", "参与者模型")}>`;
    if (provider.type === "traex") args.push("--sandbox", "workspace-write", "--ask-for-approval", "never", "-c", `model=\"${model}\"`);
    else if (provider.type === "qwen") args.push("--model", model, "--approval-mode=auto");
    else if (provider.type === "kimi") args.push("--model", model, "--auto");
    else if (provider.type === "codex") args.unshift(`CODEX_CONFIG={\"model\":\"${model}\"}`, "NO_BROWSER=1", "INITIAL_AGENT_MODE=read-only");
    args.push(...(provider.args ?? []));
    if (provider.type === "traex") args.push("acp", "serve");
    else if (provider.type === "qwen") args.push("--acp");
    else if (provider.type === "kimi") args.push("acp");
    return args.map(shellArgument).join(" ");
  }

  persistDetection(): void {
    const global = this.#scopes.global;
    localStorage.setItem(detectionKey, JSON.stringify({ diskRevision: global.data?.diskRevision, providerConfig: JSON.stringify(global.draft?.acp_providers ?? {}), detectedAt: Date.now(), results: this.#providerDetection }));
  }

  restoreDetection(): void {
    try {
      const cached = JSON.parse(localStorage.getItem(detectionKey) ?? "{}");
      const global = this.#scopes.global;
      if (cached.diskRevision === global.data?.diskRevision && cached.providerConfig === JSON.stringify(global.draft?.acp_providers ?? {}) && Date.now() - cached.detectedAt < 86_400_000) this.#providerDetection = cached.results ?? {};
      else this.#providerDetection = {};
    } catch { this.#providerDetection = {}; }
  }

  settingsFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.#token) headers.set("authorization", `Bearer ${this.#token}`);
    const scopedUrl = this.#config.projectApiBase && (url === "/api/settings/view-packages" || url === "/api/settings/project" || url.startsWith("/api/settings/project/"))
      ? `${this.#config.projectApiBase}${url.slice(4)}`
      : url;
    return fetch(scopedUrl, { ...init, headers, signal: this.#signal });
  }

  fail(error: unknown): void {
    if (this.#signal.aborted) return;
    this.state.notice = error instanceof Error ? error.message : String(error);
    this.#loading = false;
    this.render();
  }

  t(key: string, fallback: string, params: Readonly<Record<string, string | number>> = {}): string {
    const candidate = this.#config.messages?.[key];
    const template = typeof candidate === "string"
      ? candidate
      : isPluralMessage(candidate)
        ? candidate[new Intl.PluralRules(this.#config.locale === "en" ? "en" : "zh-CN").select(Number(params.count)) === "one" ? "one" : "other"]
        : fallback;
    return template.replace(/\{([^}]+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
  }
}

function destinationFromPath(pathname: string): { scope: ScopeName; module: string } {
  const parts = pathname.split("/").filter(Boolean);
  const settingsIndex = parts.indexOf("settings");
  const name = decodeURIComponent(parts[settingsIndex + 1] ?? "general") as SectionName;
  return sections[name] ?? sections.general;
}

function inputField(path: string, label: string, value: string, options: { type?: string; disabled?: boolean; min?: string; max?: string; commit?: boolean } = {}): string {
  const id = `settings-input-${safeId(path)}`;
  return `<div class="settings-field"><label for="${id}">${escapeHtml(label)}</label><input id="${id}" class="settings-input" data-field="${escapeAttr(path)}"${options.commit ? ' data-commit="true"' : ""} type="${options.type ?? "text"}" value="${escapeAttr(value)}"${options.disabled ? " disabled" : ""}${options.min ? ` min="${options.min}"` : ""}${options.max ? ` max="${options.max}"` : ""}></div>`;
}

function textAreaField(path: string, label: string, value: string): string {
  const id = `settings-textarea-${safeId(path)}`;
  return `<div class="settings-field wide"><label for="${id}">${escapeHtml(label)}</label><textarea id="${id}" data-field="${escapeAttr(path)}">${escapeHtml(value)}</textarea></div>`;
}

function selectField(path: string, label: string, value: string, options: Array<[string, string]>): string {
  const selected = options.find(([option]) => option === value)?.[1] ?? value;
  return `<div class="settings-field"><div class="settings-label">${escapeHtml(label)}</div><div class="settings-select-wrap">
    <button type="button" class="settings-select settings-select-trigger" role="combobox" aria-label="${escapeAttr(label)}" aria-haspopup="listbox" aria-expanded="false" data-select-field="${escapeAttr(path)}"><span>${escapeHtml(selected)}</span><span class="settings-select-caret" aria-hidden="true">⌄</span></button>
    <div class="settings-select-menu" role="listbox" aria-label="${escapeAttr(label)}" hidden>${options.map(([option, name]) => `<button type="button" class="settings-select-option" role="option" aria-selected="${String(option === value)}" data-select-option="${escapeAttr(path)}" data-value="${escapeAttr(option)}">${escapeHtml(name)}</button>`).join("")}</div>
  </div></div>`;
}

function multiSelectField(
  path: string,
  label: string,
  options: Array<{ identity: string; label: string; packageIdentity: string }>,
  selected: ReadonlySet<string>
): string {
  if (!options.length) return `<div class="settings-select settings-select-disabled muted">暂无扩展内容</div>`;
  const selectedLabels = options.filter(option => selected.has(option.identity)).map(option => option.label);
  return `<details class="settings-multiselect" data-multiselect-field="${escapeAttr(path)}"><summary class="settings-select settings-multiselect-trigger" aria-label="${escapeAttr(label)}"><span data-multiselect-summary title="${escapeAttr(selectedLabels.join("、"))}">${escapeHtml(multiSelectSummary(selectedLabels))}</span><span class="settings-select-caret" aria-hidden="true">⌄</span></summary><div class="settings-multiselect-menu" role="listbox" aria-label="${escapeAttr(label)}" aria-multiselectable="true">${options.map(option => `<label class="settings-multiselect-option" role="option" aria-selected="${String(selected.has(option.identity))}"><input type="checkbox" data-project-view-slot-list="${escapeAttr(path)}" data-value="${escapeAttr(option.identity)}" data-label="${escapeAttr(option.label)}" data-package-identity="${escapeAttr(option.packageIdentity)}"${selected.has(option.identity) ? " checked" : ""}><span>${escapeHtml(option.label)}</span></label>`).join("")}</div></details>`;
}

function multiSelectSummary(labels: readonly string[]): string {
  if (!labels.length) return "未选择";
  if (labels.length === 1) return labels[0]!;
  return `已选择 ${labels.length} 项`;
}

function readOnly(label: string, value: unknown): string { return `<div class="settings-field"><div class="settings-label">${escapeHtml(label)}</div><div class="mono">${escapeHtml(String(value ?? ""))}</div></div>`; }
function empty(message: string): string { return `<div class="empty">${escapeHtml(message)}</div>`; }
function pill(label: string, tone = "", extra = ""): string { return `<span class="pill ${escapeAttr(tone)} ${escapeAttr(extra)}">${escapeHtml(label)}</span>`; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function safeId(value: string): string { return value.replace(/[^A-Za-z0-9_-]/g, "-"); }
function compact(value: unknown): string { const text = value === undefined ? "未设置" : typeof value === "string" ? value : JSON.stringify(value); return text.length > 90 ? `${text.slice(0, 87)}...` : text; }
function viewUrl(view: JsonObject): string { return `http://${view?.host ?? "127.0.0.1"}:${Number(view?.port ?? 0)}`; }
function setOptional(target: JsonObject, key: string, value: string): void { if (value.trim()) target[key] = value; else delete target[key]; }
function toggleSet(set: Set<string>, value: string, enabled: boolean): void { if (enabled) set.add(value); else set.delete(value); }
function toggleValue(values: string[], value: string, enabled: boolean): string[] {
  const next = values.filter(candidate => candidate !== value);
  if (enabled) next.push(value);
  return next.sort();
}
function viewSlotLabel(slotId: string): [string, string] {
  return ({
    "navigation.primary@1": ["主导航", "左侧一级导航入口"],
    "navigation.secondary@1": ["次级导航", "当前模块的二级导航"],
    "content.list@1": ["内容列表", "页面左侧或列表区域"],
    "search.providers@1": ["全局搜索来源", "加入全局搜索的数据来源"],
    "header.title@1": ["页面标题", "标题、说明和面包屑"],
    "header.actions@1": ["页面操作", "标题栏右侧的操作按钮"],
    "side.panel@1": ["侧边面板", "页面辅助信息面板"],
    "header.account@1": ["账户区域", "顶部账户与身份区域"],
    "sidebar.footer@1": ["侧栏底部", "侧栏底部状态与入口"],
    "home.attention@1": ["首页待处理", "首页需要关注的事项"],
    "home.continue@1": ["首页继续处理", "首页可继续的工作"],
    "home.modules@1": ["首页模块", "首页模块入口"],
    "main.view@1": ["主内容区域", "路由对应的主要页面内容"],
    "overlay@1": ["浮层", "对话框与抽屉内容"],
    "styles.global@1": ["全局样式", "可同时使用多个扩展包提供的全局样式"],
    "org.memsphere.memory.page.presentation@1:page": ["记忆模块 / 整体页面", "整个记忆模块页面"],
    "org.memsphere.memory.detail.renderer@1:detail": ["记忆模块 / 详情正文", "单条记忆的内容区域"],
    "org.memsphere.run.page.presentation@1:page": ["运行模块 / 整体页面", "整个运行模块页面"],
    "org.memsphere.run.artifact.renderer@1:artifact": ["运行模块 / 产物正文", "运行产物的内容区域"]
  } as Record<string, [string, string]>)[slotId] ?? [slotId, "扩展包提供的界面位置"];
}
function shellArgument(value: unknown): string { const text = String(value); return /^[A-Za-z0-9_./:=+-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`; }
function isPluralMessage(value: unknown): value is { one: string; other: string } { return Boolean(value && typeof value === "object" && typeof (value as JsonObject).one === "string" && typeof (value as JsonObject).other === "string"); }
function escapeAttr(value: unknown): string { return escapeHtml(String(value)).replace(/`/g, "&#96;"); }
function escapeHtml(value: unknown): string { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }

const styles = `
  .memsphere-settings { --surface:#fff;--line:#dfe3dc;--soft:#f1f3ee;--text:#222629;--muted:#6c7379;--accent:#286c67;--accent-soft:#e7f1ee;--danger:#a14436;--shadow:0 2px 10px rgba(25,30,35,.06); display:grid;grid-template-columns:240px minmax(0,1fr);min-height:calc(100vh - 82px);background:#f6f7f4;color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,sans-serif;box-sizing:border-box }
  .memsphere-settings.settings-list-surface,.memsphere-settings.settings-detail-surface{display:block;min-height:100%;background:transparent}.settings-list-surface .settings-sidebar{min-height:100%;border-right:0;background:transparent;padding:0 8px 12px}.settings-detail-surface .settings-content{width:100%;max-width:980px;min-height:100%;margin:0 auto}.settings-detail-surface .settings-page-header{display:none}
  .memsphere-settings * { box-sizing:border-box } .settings-sidebar{padding:24px 16px;border-right:1px solid var(--line);background:#fafbf8}.settings-content{min-width:0;padding:22px 28px 48px}.settings-page-header h2{margin:0;font-size:24px}.settings-page-header p{margin:5px 0 22px;color:var(--muted)}
  .settings-list-header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:19px 10px 10px}.settings-list-header small{display:block;margin-bottom:4px;color:#82908d;font-size:10px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}.settings-list-header h2{margin:0;font-size:18px;line-height:1.3;letter-spacing:-.02em}.settings-list-header button{display:grid;width:32px;height:32px;place-items:center;border:0;border-radius:8px;background:transparent;cursor:pointer}.settings-list-header button:hover{background:#f0f4f2}.settings-list-header button img{width:17px;height:17px;opacity:.7}.settings-local-search{display:flex;height:36px;align-items:center;gap:7px;margin:0 6px 10px;border:1px solid #dce4e1;border-radius:9px;background:#f8faf9;padding:0 10px;color:#7a8784}.settings-local-search:focus-within{border-color:#8cb7b1;box-shadow:0 0 0 3px rgba(40,118,110,.08)}.settings-local-search img{width:16px;height:16px;opacity:.55}.settings-local-search input{width:100%;min-width:0;border:0;outline:0;background:transparent;font-size:12px;color:#2f3937}.settings-record-list{display:grid;gap:2px}.settings-record{display:grid;min-height:66px;grid-template-columns:34px minmax(0,1fr) 14px;align-items:start;gap:9px;border-radius:10px;padding:10px 9px}.settings-record:hover{background:#f2f6f5}.settings-record.active{background:#e1efed}.settings-record-icon{display:grid;width:34px;height:34px;place-items:center;border-radius:10px;background:#eef4f2}.settings-record.active .settings-record-icon{background:#fff}.settings-record-icon img{width:18px;height:18px;opacity:.72}.settings-record strong,.settings-record small,.settings-record p{display:block;overflow:hidden;margin:0;text-overflow:ellipsis;white-space:nowrap}.settings-record strong{font-size:13px;line-height:1.35}.settings-record small{margin-top:3px;color:#87928f;font-size:10px}.settings-record p{margin-top:5px;color:#697572;font-size:11px}.settings-record-caret{width:14px;height:14px;margin-top:8px;opacity:.55;transform:rotate(-90deg)}.settings-list-footer{margin-top:auto;border-top:1px solid #eef1f0;padding:10px 9px;color:#8a9592;font-size:10px}
  .settings-nav-group{overflow:hidden;margin-bottom:12px;border:1px solid var(--line);border-radius:7px;background:var(--surface)}.settings-nav-group.active{border-color:#b8cbc7}.settings-nav-heading{padding:9px 10px;background:var(--soft);color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase}.settings-nav-items{display:grid;gap:2px;padding:4px}.settings-nav-item{border:0;border-radius:4px;background:transparent;padding:8px 9px;text-align:left;font-weight:600;color:var(--text);cursor:pointer}.settings-nav-item:hover{background:var(--soft)}.settings-nav-item.active{background:var(--accent-soft);color:#173f3c}
  .settings-layout{display:grid;min-width:0;gap:14px;max-width:1120px}.settings-section{min-width:0;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:0 1px 2px rgba(20,47,42,.025);padding:21px 22px}.settings-section h3{margin:0 0 14px;font-size:17px}.settings-section h4{margin:18px 0 8px;font-size:14px}.settings-section-head{display:flex;gap:12px;align-items:center;justify-content:space-between;margin-bottom:14px}.settings-section-head h3{margin:0}.settings-section-subtitle{margin:4px 0 0;color:var(--muted);font-size:12px}
  .settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 16px}.settings-compact-grid{grid-template-columns:repeat(auto-fit,minmax(240px,360px));justify-content:start}.settings-participant-basic{grid-template-columns:repeat(3,minmax(0,1fr))}.settings-field{display:grid;gap:6px;min-width:0}.settings-field.wide{grid-column:1/-1}.settings-field>label,.settings-label{color:#4f5a5c;font-size:12px;font-weight:700}.settings-input,.settings-select,.settings-field textarea{width:100%;min-width:0;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--text);padding:8px 10px;outline:none}.settings-field textarea{min-height:92px;resize:vertical}.settings-input:focus,.settings-select:focus,.settings-field textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(40,108,103,.12)}.settings-input:disabled{border-style:dashed;background:var(--soft);color:var(--muted)}.settings-select-wrap{position:relative;min-width:0}.settings-select-trigger,.settings-multiselect-trigger{display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;cursor:pointer}.settings-select-caret{color:var(--muted)}.settings-select-disabled{cursor:not-allowed;background:var(--soft)}.settings-select-menu{position:absolute;top:calc(100% + 4px);right:0;left:0;z-index:40;display:grid;gap:2px;max-height:240px;overflow-y:auto;padding:4px;border:1px solid var(--line);border-radius:6px;background:var(--surface);box-shadow:0 10px 28px rgba(25,30,35,.16)}.settings-select-menu[hidden]{display:none}.settings-select-option{width:100%;border:0;border-radius:4px;background:transparent;color:var(--text);padding:7px 8px;text-align:left;cursor:pointer}.settings-select-option:hover,.settings-select-option:focus-visible{outline:0;background:var(--soft)}.settings-select-option[aria-selected="true"]{background:var(--accent-soft);color:#173f3c}.settings-multiselect{min-width:0}.settings-multiselect>summary{list-style:none}.settings-multiselect>summary::-webkit-details-marker{display:none}.settings-multiselect-menu{display:grid;gap:2px;max-height:220px;overflow-y:auto;margin-top:4px;padding:4px;border:1px solid var(--line);border-radius:6px;background:var(--surface);box-shadow:0 8px 20px rgba(25,30,35,.1)}.settings-multiselect-option{display:flex;align-items:flex-start;gap:8px;border-radius:4px;padding:8px;cursor:pointer}.settings-multiselect-option:hover,.settings-multiselect-option:focus-within,.settings-multiselect-option[aria-selected="true"]{background:var(--accent-soft)}.settings-multiselect-option input{width:16px;height:16px;margin:1px 0 0;accent-color:var(--accent)}
  .settings-status{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.pill{display:inline-flex;border:1px solid var(--line);border-radius:999px;background:#fff;padding:2px 8px;color:var(--muted);font-size:12px}.pill.done{border-color:#b9d6c7;background:#edf7f1;color:#226044}.pill.warn{border-color:#e2c99c;background:#fff8e8;color:#7a5714}.pill.strong{font-weight:700}.settings-actions,.settings-participant-actions{display:flex;gap:8px;justify-content:flex-end}.btn{border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--text);padding:8px 12px;cursor:pointer}.btn:hover{background:var(--soft)}.btn.primary{border-color:var(--accent);background:var(--accent);color:#fff}.btn.danger{color:var(--danger)}.btn:disabled{cursor:not-allowed;opacity:.5}
  .settings-check{display:flex;gap:8px;align-items:flex-start}.settings-check input{width:16px;height:16px;margin-top:2px;accent-color:var(--accent)}.settings-default-toggle{margin-top:14px}.settings-token-management{margin-top:28px;padding-top:24px;border-top:1px solid var(--line)}.settings-token-management h4{margin:0 0 6px;font-size:16px}.settings-token-editor{display:flex;align-items:end;gap:12px;margin-top:18px}.settings-token-editor .settings-field{flex:1;margin:0}.settings-token-buttons{display:flex;gap:8px;padding-bottom:1px;white-space:nowrap}.settings-help,.settings-error{font-size:12px;overflow-wrap:anywhere}.settings-help{color:var(--muted)}.settings-error{color:var(--danger)}.settings-notice{border-left:3px solid var(--accent);padding:10px 12px;background:var(--accent-soft)}.settings-token{max-width:520px}.settings-token .btn{margin-top:14px}.empty{padding:30px;border:1px dashed var(--line);border-radius:8px;color:var(--muted);text-align:center}.settings-installed-packages{border:1px solid var(--line);border-radius:8px;overflow:hidden}.settings-view-package{padding:16px}.settings-view-package+.settings-view-package{border-top:1px solid var(--line)}.settings-view-package .settings-section-head{align-items:flex-start;margin-bottom:0}.settings-view-package .settings-section-head>.btn{flex:none;white-space:nowrap}.settings-package-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.settings-package-path{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;margin:7px 0 0;color:var(--muted);font-size:12px}.settings-package-path span{white-space:nowrap}.settings-package-path code{min-width:0}.settings-package-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:14px 0 10px;color:var(--muted)}.settings-table-wrap{width:100%;min-width:0;overflow-x:auto;border:1px solid var(--line);border-radius:8px}.settings-config-table{width:100%;border-collapse:collapse;min-width:620px}.settings-config-table th,.settings-config-table td{padding:11px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}.settings-config-table th{background:var(--soft);color:var(--muted);font-size:12px;font-weight:600}.settings-config-table tbody tr:last-child td{border-bottom:0}.settings-config-table td:first-child{width:28%}.settings-config-table td:first-child small{display:block;margin-top:3px;color:var(--muted);font-weight:400}.settings-config-table td:nth-child(2){width:18%;color:var(--muted)}.settings-config-table .settings-field{margin:0}.settings-config-table .settings-label{display:none}
  .settings-participants,.settings-providers{border-top:1px solid var(--line)}.settings-participant{border-bottom:1px solid var(--line)}.settings-participant>summary{list-style:none}.settings-participant>summary::-webkit-details-marker{display:none}.settings-participant-summary{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;min-height:58px;padding:10px 4px;cursor:pointer}.settings-participant-summary:hover{background:#f7f8f5}.settings-participant-summary-meta{margin-top:5px;color:var(--muted);font-size:12px;overflow-wrap:anywhere}.settings-participant-body{padding:2px 4px 18px}.settings-permissions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 14px}.settings-permission{border-left:2px solid var(--line);padding-left:9px}.settings-permission p{margin:3px 0 0 24px;color:var(--muted);font-size:12px}.settings-provider-preview{margin:12px 0 0;padding:10px 12px;border:1px solid var(--line);border-radius:6px;background:#f3f5f0;overflow-wrap:anywhere}.settings-change-list{display:grid;gap:8px;padding:0;list-style:none}.settings-change-list li{border-left:3px solid var(--accent);padding:7px 10px;background:#f3f5f0}.settings-code{max-height:440px;overflow:auto;white-space:pre;background:#f3f5f0;border:1px solid var(--line);border-radius:6px;padding:12px}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.muted{color:var(--muted)}
  @media(max-width:760px){.memsphere-settings{grid-template-columns:1fr}.settings-sidebar{border-right:0;border-bottom:1px solid var(--line)}.settings-content{padding:18px 16px 36px}.settings-grid,.settings-compact-grid,.settings-participant-basic,.settings-permissions{grid-template-columns:minmax(0,1fr)}.settings-section{padding:14px}.settings-section-head{align-items:flex-start}.settings-token-editor,.settings-token-buttons{align-items:stretch;flex-direction:column}.settings-token-buttons .btn{width:100%}}
`;
