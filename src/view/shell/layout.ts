export interface ViewShellMarkupOptions {
  readonly loading: string;
  readonly initial?: {
    readonly locale: string;
    readonly pathname: string;
    readonly projectName: string;
    readonly homeLabel: string;
    readonly memoryLabel: string;
    readonly runLabel: string;
    readonly settingsLabel: string;
    readonly settingsHref: string;
    readonly healthyLabel: string;
    readonly accountLabel: string;
    readonly homeTitle: string;
    readonly attentionLabel: string;
    readonly attentionEmpty: string;
    readonly continueLabel: string;
    readonly continueEmpty: string;
    readonly modulesLabel: string;
    readonly navigation: readonly { label: string; icon: string; href: string }[];
    readonly modules: readonly { title: string; summary: string; icon: string; href: string }[];
  };
}

/**
 * Stable DOM owned by ViewHost. Module Mounts receive only the main content node;
 * they never replace the Shell or depend on its private class names.
 */
export function renderViewShellMarkup(options: ViewShellMarkupOptions): string {
  const initial = options.initial;
  const navigation = initial ? renderInitialNavigation(initial) : "";
  const footer = initial ? `<a class="view-shell-settings" href="${escapeHtml(initial.settingsHref)}"><img class="view-shell-icon" src="/assets/system-icons/gear-six.svg" alt="" aria-hidden="true" /><span>${escapeHtml(initial.settingsLabel)}</span></a>` : "";
  const header = initial?.pathname === "/" ? `<div class="view-shell-heading"><h1>${escapeHtml(initial.homeLabel)}</h1><p>${escapeHtml(initial.projectName)}</p></div>` : "";
  const account = initial ? `<div class="view-shell-account" aria-label="${escapeHtml(initial.accountLabel)}"><span class="view-shell-account-avatar">${escapeHtml(initial.accountLabel)}</span></div>` : "";
  const main = initial?.pathname === "/" ? renderInitialHome(initial) : renderInitialLoading(options.loading);
  const isHome = initial?.pathname === "/";
  const hasInitialContentList = !initial?.pathname.startsWith("/settings/");
  const chinese = initial?.locale === "zh-CN";
  const projectHomeLabel = chinese ? `返回 ${initial?.projectName ?? "Project"} 主页` : `Return to ${initial?.projectName ?? "Project"} Home`;
  const switchProjectLabel = chinese ? "切换 Project" : "Switch Project";
  return `<div class="view-shell" data-view-shell data-view-layout="${isHome ? "home" : "module"}" data-view-content-list="${hasInitialContentList}">
    <aside class="view-shell-sidebar" aria-label="Primary navigation">
      <label class="view-shell-project-label" id="view-shell-project-label" for="view-shell-project-trigger"></label>
      <div class="view-shell-project-select-wrap">
        <a class="view-shell-project-home" href="/" aria-label="${escapeHtml(projectHomeLabel)}">
          <span class="view-shell-project-mark"><img class="view-shell-project-icon" src="/assets/system-icons/cube-fill.svg" alt="" aria-hidden="true" /></span>
          <span class="view-shell-project-value">${escapeHtml(initial?.projectName ?? "")}</span>
        </a>
        <button class="view-shell-project-trigger" id="view-shell-project-trigger" data-view-project-menu-trigger type="button" aria-haspopup="menu" aria-expanded="false" aria-label="${escapeHtml(switchProjectLabel)}" disabled>
          <span class="view-shell-project-trigger-value">${escapeHtml(initial?.projectName ?? "")}</span>
          <img class="view-shell-project-caret" src="/assets/system-icons/caret-down.svg" alt="" aria-hidden="true" />
        </button>
        <div class="view-shell-project-menu" id="view-shell-project-menu" role="menu" aria-labelledby="view-shell-project-label" hidden></div>
      </div>
      <button class="view-shell-search-trigger" data-view-search-trigger type="button" aria-haspopup="dialog" aria-controls="view-shell-search-overlay" aria-expanded="false">
        <img src="/assets/system-icons/magnifying-glass.svg" alt="" aria-hidden="true" />
        <span>${chinese ? "搜索" : "Search"}</span>
      </button>
      <div class="view-shell-rail-divider" aria-hidden="true"></div>
      <nav data-view-slot="navigation.primary">${navigation}</nav>
      <div class="view-shell-rail-spacer"></div>
      <div class="view-shell-footer" data-view-slot="sidebar.footer">${footer}</div>
      <button class="view-shell-add-module" type="button" aria-label="${chinese ? "新增 Module" : "Add Module"}" title="${chinese ? "新增 Module" : "Add Module"}">
        <img src="/assets/system-icons/plus.svg" alt="" aria-hidden="true" />
      </button>
      <div class="view-shell-account-slot" data-view-slot="header.account">${account}</div>
    </aside>
    <section class="view-shell-workspace">
      <aside class="view-shell-secondary-panel" aria-label="Secondary navigation">
        <div class="view-shell-secondary-slot" data-view-slot="navigation.secondary"></div>
        ${renderPanelResizer("secondary", "Resize secondary navigation", 176, 360, 218)}
      </aside>
      <section class="view-shell-list-panel" aria-label="Content list">
        <div class="view-shell-list-slot" data-view-slot="content.list"></div>
        ${renderPanelResizer("content-list", "Resize content list", 260, 520, 326)}
      </section>
      <section class="view-shell-detail-panel">
        <header class="view-shell-header">
          <div data-view-slot="header.title">${header}</div>
          <div data-view-slot="header.actions"></div>
        </header>
        <main id="memsphere-view-root" class="${isHome ? "" : "view-shell-detail-loading"}" aria-live="polite">${main}</main>
      </section>
    </section>
    <div class="view-shell-page-portals" data-view-page-portals></div>
    ${renderSearchOverlay(chinese)}
    ${renderProjectDetailsOverlay(chinese)}
    <div data-view-slot="overlay"></div>
  </div>`;
}

function renderProjectDetailsOverlay(chinese: boolean): string {
  const labels = chinese
    ? { title: "项目详情", close: "关闭", name: "项目名称", root: "项目目录", store: "存储类型", revision: "版本", memory: "Memory 目录" }
    : { title: "Project details", close: "Close", name: "Project name", root: "Project root", store: "Store type", revision: "Revision", memory: "Memory root" };
  const row = (key: string, label: string) => `<div class="view-shell-project-detail-row"><dt>${label}</dt><dd data-project-detail="${key}">—</dd></div>`;
  return `<div class="view-shell-project-details-overlay" data-view-project-details hidden>
    <section class="view-shell-project-details-card" role="dialog" aria-modal="true" aria-labelledby="view-shell-project-details-title">
      <header><h2 id="view-shell-project-details-title">${labels.title}</h2><button type="button" data-view-project-details-close aria-label="${labels.close}"><img src="/assets/system-icons/x.svg" alt="" /></button></header>
      <dl>${row("name", labels.name)}${row("root", labels.root)}${row("store", labels.store)}${row("revision", labels.revision)}${row("memory", labels.memory)}</dl>
    </section>
  </div>`;
}

function renderPanelResizer(name: string, label: string, min: number, max: number, value: number): string {
  return `<div class="view-shell-panel-resizer" data-view-resizer="${name}" role="separator" aria-label="${label}" aria-orientation="vertical" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}" tabindex="0" title="Drag to resize; double-click to reset"><span></span></div>`;
}

function renderSearchOverlay(chinese: boolean): string {
  const label = chinese ? "全局搜索" : "Global search";
  const placeholder = chinese ? "搜索当前 Project 的全部内容" : "Search everything in the current Project";
  return `<section class="view-shell-search-overlay" id="view-shell-search-overlay" data-view-search-overlay role="dialog" aria-modal="true" aria-label="${label}" hidden>
    <header class="view-shell-search-command">
      <img src="/assets/system-icons/magnifying-glass.svg" alt="" aria-hidden="true" />
      <input data-view-search-input type="search" autocomplete="off" placeholder="${placeholder}" />
      <kbd>ESC</kbd>
      <button data-view-search-close type="button" aria-label="${chinese ? "关闭搜索" : "Close search"}"><img src="/assets/system-icons/x.svg" alt="" aria-hidden="true" /></button>
    </header>
    <div class="view-shell-search-providers" data-view-slot="search.providers" role="tablist" aria-label="${chinese ? "搜索分类" : "Search categories"}"></div>
    <div class="view-shell-search-body">
      <div class="view-shell-search-empty" data-view-search-empty>
        <span class="view-shell-search-empty-icon"><img src="/assets/system-icons/magnifying-glass.svg" alt="" aria-hidden="true" /></span>
        <h2>${chinese ? "跨 Module 搜索" : "Search across Modules"}</h2>
        <p>${chinese ? "输入关键词，搜索当前 Project 中的内容。" : "Enter a keyword to search the current Project."}</p>
      </div>
      <div class="view-shell-search-results" data-view-search-results hidden></div>
      <p class="view-shell-search-status" data-view-search-status role="status" aria-live="polite"></p>
    </div>
    <footer class="view-shell-search-footer"><span>↑↓ ${chinese ? "移动" : "Move"}</span><span>↵ ${chinese ? "打开" : "Open"}</span><span>esc ${chinese ? "退出搜索" : "Exit search"}</span></footer>
  </section>`;
}

function renderInitialNavigation(initial: NonNullable<ViewShellMarkupOptions["initial"]>): string {
  return initial.navigation.map(item => {
    const active = item.href !== "/" && initial.pathname.startsWith(item.href);
    return `<a class="view-shell-navigation-item${active ? " active" : ""}" href="${escapeHtml(item.href)}" aria-current="${active ? "page" : "false"}" title="${escapeHtml(item.label)}">
      <span class="view-shell-module-icon"><img class="view-shell-icon" src="/assets/system-icons/${initialIconName(item.icon)}${active ? "-fill" : ""}.svg" alt="" aria-hidden="true" /></span>
      <span>${escapeHtml(item.label)}</span>
    </a>`;
  }).join("");
}

function renderInitialHome(initial: NonNullable<ViewShellMarkupOptions["initial"]>): string {
  const modules = initial.modules.map(item => {
    const icon = initialIconName(item.icon);
    return `<a class="view-home-module-card" data-status="ready" data-icon="${icon}" href="${escapeHtml(item.href)}">
      <span class="view-home-module-icon-tile"><img class="view-home-module-icon" src="/assets/system-icons/${icon}.svg" alt="" aria-hidden="true" /></span>
      <span class="view-home-row-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.summary)}</span></span>
      <img class="view-home-arrow" src="/assets/system-icons/arrow-right.svg" alt="" aria-hidden="true" />
    </a>`;
  }).join("");
  return `<div class="view-home"><div class="view-home-content">
    <h1 class="view-home-title">${escapeHtml(initial.homeTitle)}</h1>
    ${initialHomeSection(initial.attentionLabel, initial.attentionEmpty, true)}
    ${initialHomeSection(initial.continueLabel, initial.continueEmpty)}
    <section class="view-home-section" data-home-section="modules"><h2>${escapeHtml(initial.modulesLabel)}</h2><div class="view-home-section-body view-home-module-grid">${modules}</div></section>
  </div></div>`;
}

function renderInitialLoading(label: string): string {
  return `<div class="view-shell-loading-skeleton" aria-label="${escapeHtml(label)}" role="status">
    <span class="view-shell-loading-line title"></span>
    <span class="view-shell-loading-line"></span>
    <span class="view-shell-loading-line short"></span>
    <span class="view-shell-loading-card"></span>
  </div>`;
}

function initialHomeSection(title: string, emptyLabel: string, count = false): string {
  return `<section class="view-home-section"><h2>${escapeHtml(title)}${count ? '<span class="view-home-count">0</span>' : ""}</h2><div class="view-home-section-body"><p class="view-home-empty">${escapeHtml(emptyLabel)}</p></div></section>`;
}

function initialIconName(name: string): string {
  if (name === "memory") return "brain";
  if (name === "play") return "play-circle";
  if (name === "gear") return "gear-six";
  return name;
}

export const viewShellStyles = `
  :root { --view-ink: #171b19; --view-muted: #747974; --view-line: #e3e2dc; --view-green: #175b45; --view-green-soft: #e9ede8; }
  * { box-sizing: border-box; }
  .view-shell-project-trigger, .view-shell-project-option, .view-shell-navigation-item, .view-shell-action, .view-home-row, .view-home-button, .view-home-module-card { font: inherit; }
  a.view-shell-navigation-item, a.view-shell-settings, a.view-home-module-card { text-decoration: none; }
  .view-shell { display: grid; grid-template-columns: 284px minmax(0, 1fr); min-height: 100vh; background: #fdfcf9; color: var(--view-ink); }
  .view-shell-sidebar { position: sticky; top: 0; min-width: 0; height: 100vh; box-sizing: border-box; overflow-y: auto; padding: 18px 14px; border-right: 1px solid #d9ded8; background: #fbfbf8; }
  .view-shell-brand { margin: 0 8px 16px; font-size: 18px; }
  .view-shell-project-label { display: block; margin: 0 8px 5px; color: #6c7379; font-size: 11px; }
  .view-shell-project-select-wrap { position: relative; min-width: 0; margin: 0 8px 16px; }
  .view-shell-project-trigger { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; width: 100%; min-width: 0; min-height: 34px; box-sizing: border-box; border: 1px solid #d9ded8; border-radius: 6px; background: #fff; padding: 5px 9px; color: #222629; font: inherit; text-align: left; }
  .view-shell-project-trigger:not(:disabled):hover { border-color: #b8cbc7; background: #f7f8f4; }
  .view-shell-project-trigger:focus-visible, .view-shell-project-trigger[aria-expanded="true"] { border-color: #286c67; outline: 0; box-shadow: 0 0 0 3px rgba(40, 108, 103, .12); }
  .view-shell-project-trigger:disabled { color: #8a9296; cursor: default; }
  .view-shell-project-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .view-shell-project-caret { width: 14px; height: 14px; transition: transform 120ms ease; }
  .view-shell-project-trigger[aria-expanded="true"] .view-shell-project-caret { transform: rotate(180deg); }
  .view-shell-project-menu { position: absolute; z-index: 30; top: calc(100% + 4px); right: 0; left: 0; max-height: min(240px, 45vh); overflow-y: auto; box-sizing: border-box; border: 1px solid #d9ded8; border-radius: 6px; background: #fff; box-shadow: 0 12px 30px rgba(32, 43, 41, .16); padding: 4px; }
  .view-shell-project-menu[hidden] { display: none; }
  .view-shell-project-option { display: block; width: 100%; border: 0; border-radius: 4px; background: transparent; color: #222629; padding: 8px; overflow: hidden; font: inherit; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
  .view-shell-project-option:hover, .view-shell-project-option:focus-visible { background: #eef1ed; outline: none; }
  .view-shell-project-option[aria-selected="true"] { background: #dfeeea; color: #173f3c; font-weight: 700; }
  .view-shell-sidebar [data-view-slot="navigation.primary"] { display: grid; gap: 6px; }
  .view-shell-navigation-item { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: 9px; width: 100%; min-height: 38px; border: 1px solid transparent; border-radius: 6px; padding: 8px 10px; background: transparent; color: #4f5a5c; text-align: left; }
  .view-shell-navigation-item:hover { background: #eef1ed; color: #222629; }
  .view-shell-navigation-item.active { border-color: #b8cbc7; background: #dfeeea; color: #173f3c; font-weight: 700; }
  .view-shell-navigation-badge { color: #6c7379; font-size: 12px; }
  .view-shell-icon { display: inline-grid; width: 18px; height: 18px; place-items: center; object-fit: contain; }
  .view-shell-icon[data-system-icon]::before { content: "\\2022"; font-size: 18px; line-height: 1; }
  .view-shell-workspace { min-width: 0; }
  .view-shell-header { display: flex; min-height: 82px; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 18px 24px 14px; border-bottom: 1px solid #d9ded8; background: #fff; }
  .view-shell-header [data-view-slot="header.title"] { min-width: 0; flex: 1; }
  .view-shell-header [data-view-slot="header.actions"] { display: flex; align-items: center; gap: 8px; }
  .view-shell-heading h1 { margin: 0; font-size: 24px; line-height: 1.25; }
  .view-shell-heading p { margin: 5px 0 0; color: #6c7379; }
  .view-shell-breadcrumbs { margin-bottom: 4px; color: #6c7379; font-size: 12px; }
  .view-shell-breadcrumbs button { border: 0; padding: 0; background: transparent; color: #286c67; }
  .view-shell-action { min-height: 34px; border: 1px solid #d9ded8; border-radius: 6px; padding: 6px 10px; background: #fff; color: #222629; }
  .view-shell-action:not(:disabled):hover { border-color: #286c67; }
  .view-shell-action[aria-busy="true"] { cursor: wait; opacity: .7; }
  .view-shell-action[data-view-action-error] { border-color: #a14436; color: #a14436; }
  .view-shell-navigation-error { align-self: center; color: #a14436; font-size: 12px; }
  .view-shell-sidebar { display: flex; flex-direction: column; }
  .view-shell-sidebar [data-view-slot="navigation.primary"] { flex: 0 0 auto; }
  .view-shell-footer { margin-top: auto; padding-top: 12px; border-top: 1px solid #d9ded8; }
  .view-shell-settings { width: 100%; min-height: 36px; box-sizing: border-box; border: 0; border-radius: 6px; padding: 8px 10px; background: transparent; color: #222629; text-align: left; text-decoration:none; }
  .view-shell-settings:hover { background: #eef1ed; }
  .view-shell-service-status { display: flex; align-items: center; gap: 7px; margin: 9px 10px 0; color: #6c7379; font-size: 11px; }
  .view-shell-status-icon { width: 7px; height: 7px; }
  .view-host-module-error { margin: 24px; border: 1px solid #e8c7bd; border-left: 4px solid #a14436; border-radius: 8px; background: #fffdfb; padding: 18px; }
  .view-host-module-error h2 { margin: 0 0 8px; color: #a14436; font-size: 18px; }
  .view-host-module-error p { color: #6c7379; white-space: pre-wrap; overflow-wrap: anywhere; }
  .view-host-module-error button { border: 1px solid #d9ded8; border-radius: 6px; background: #fff; padding: 7px 10px; }
  #memsphere-view-root { min-width: 0; }
  /* Prototype-aligned Stable Shell. These overrides deliberately leave Module-owned pages untouched. */
  .view-shell-sidebar { position: fixed; inset: 0 auto 0 0; z-index: 20; width: 284px; padding: 28px 18px 22px; border-color: var(--view-line); background: #faf9f5; color: var(--view-ink); font: 16px/normal Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; font-synthesis: none; -webkit-font-smoothing: antialiased; }
  .view-shell-sidebar button { color: inherit; }
  .view-shell-brand { display: flex; align-items: center; gap: 10px; margin: 0; padding: 0 8px 26px; color: #174f3e; font: 32px/1 Georgia, "Songti SC", serif; }
  .view-shell-brand strong { font-weight: 400; }
  .view-shell-brand img { width: 32px; height: 32px; filter: invert(25%) sepia(23%) saturate(1140%) hue-rotate(113deg) brightness(87%) contrast(91%); }
  .view-shell-project-label { height: 0; margin: 0; overflow: hidden; }
  .view-shell-project-select-wrap { margin: 0; }
  .view-shell-project-trigger { height: 54px; grid-template-columns: 22px minmax(0, 1fr) 18px; gap: 10px; border-color: #d7d6d0; border-radius: 10px; background: #fdfcf9; padding: 0 16px; cursor: pointer; }
  .view-shell-project-icon { width: 22px; height: 22px; filter: invert(20%) sepia(20%) saturate(1197%) hue-rotate(113deg) brightness(87%) contrast(89%); }
  .view-shell-project-menu { top: calc(100% + 8px); max-height: min(260px, 45vh); border-color: var(--view-line); border-radius: 12px; padding: 8px; box-shadow: 0 14px 36px rgba(25, 31, 27, .12); }
  .view-shell-project-option { border-radius: 7px; padding: 9px 10px; cursor: pointer; }
  .view-shell-sidebar [data-view-slot="navigation.primary"] { gap: 7px; margin-top: 34px; }
  .view-shell-navigation-item { grid-template-columns: 22px minmax(0, 1fr) auto; height: 50px; gap: 14px; border: 0; border-radius: 10px; padding: 0 13px; cursor: pointer; font-size: 16px; }
  .view-shell-navigation-item:hover { background: #f0f1ed; }
  .view-shell-navigation-item.active { background: var(--view-green-soft); color: #143f33; font-weight: 600; }
  .view-shell-navigation-item.active .view-shell-icon { filter: invert(20%) sepia(20%) saturate(1197%) hue-rotate(113deg) brightness(87%) contrast(89%); }
  .view-shell-icon { display: block; width: 22px; height: 22px; object-fit: contain; }
  .view-shell-icon[data-system-icon]::before { content: none; }
  .view-shell-workspace { grid-column: 2; min-width: 0; min-height: 100vh; }
  .view-shell-header { height: 88px; min-height: 88px; align-items: center; gap: 14px; padding: 0 44px; border-color: rgba(227, 226, 220, .72); background: #fdfcf9; color: #5b605c; font: 14px/normal Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; font-synthesis: none; -webkit-font-smoothing: antialiased; }
  .view-shell-heading { display: grid; gap: 3px; }
  .view-shell-header [data-view-slot="header.actions"] { padding-right: 14px; border-right: 1px solid var(--view-line); }
  .view-shell-heading h1 { order: 2; color: var(--view-ink); font-size: 17px; font-weight: 600; line-height: normal; }
  .view-shell-heading p { order: 1; margin: 0; color: #8b8f8b; font-size: 11px; line-height: normal; }
  .view-shell-action { display: inline-flex; min-height: 38px; align-items: center; gap: 7px; border-color: var(--view-line); border-radius: 8px; padding: 7px 12px; background: transparent; cursor: pointer; }
  .view-shell-action .view-shell-icon { width: 16px; height: 16px; }
  .view-shell-action[data-view-entry*="core.header.search"] { width: 38px; justify-content: center; padding: 0; }
  .view-shell-action[data-view-entry*="core.header.search"] .view-shell-action-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .view-shell-action[data-view-entry*="core.header.search"] .view-shell-icon { width: 19px; height: 19px; }
  .view-shell-action[data-view-entry*="core.header.market"] { border-color: var(--view-green); background: var(--view-green); color: #fff; padding: 0 14px; }
  .view-shell-action[data-view-entry*="core.header.market"] .view-shell-icon { filter: invert(1); }
  .view-shell-action[data-view-entry*="core.header.market"]:hover { border-color: #104d3a; background: #104d3a; }
  .view-shell-account { display: flex; min-width: 91px; min-height: 40px; align-items: center; gap: 8px; border: 0; background: transparent; color: #5b605c; padding: 1px 4px; }
  .view-shell-account-avatar { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 50%; background: var(--view-green); color: #fff; font: 18px Georgia, serif; }
  .view-shell-account-user-icon { width: 16px; height: 16px; }
  .view-shell-account-caret { width: 13px; height: 13px; }
  .view-shell-account-user-icon, .view-shell-account-caret { opacity: .72; }
  .view-shell-footer { border-top: 0; padding-top: 0; }
  .view-shell-settings { display: flex; min-height: 50px; align-items: center; gap: 14px; border-radius: 10px; padding: 0 13px; cursor: pointer; font-size: 16px; }
  .view-shell-settings:hover { background: #f0f1ed; }
  .view-shell-service-status { gap: 10px; margin: 10px 0 0; padding: 17px 16px 8px; border-top: 1px solid var(--view-line); color: #535954; font-size: 13px; }
  .view-shell-status-icon { width: 9px; height: 9px; border-radius: 50%; filter: invert(50%) sepia(57%) saturate(796%) hue-rotate(65deg) brightness(86%) contrast(86%); box-shadow: 0 0 0 4px #edf5e9; }
  .view-home { min-height: calc(100vh - 88px); }
  .view-home-content { width: min(1060px, calc(100% - 88px)); margin: 0 auto; padding: 8px 0 70px; }
  .view-home-title { margin: 3px 0 48px; font: 700 clamp(38px, 4vw, 56px)/1.15 "Songti SC", STSong, Georgia, serif; letter-spacing: -2px; }
  .view-home-section { margin-bottom: 44px; }
  .view-home-section > h2 { height: 44px; margin: 0; border-bottom: 1px solid var(--view-line); font: 600 21px/1.2 "PingFang SC", sans-serif; }
  .view-home-count { display: inline-grid; min-width: 22px; height: 22px; margin-left: 7px; place-items: center; border-radius: 11px; background: #eceeea; color: #626762; font: 12px Inter, sans-serif; vertical-align: 2px; }
  .view-home-section-body { border-bottom: 1px solid var(--view-line); }
  .view-home-row { width: 100%; min-width: 0; border: 0; border-bottom: 1px solid var(--view-line); background: transparent; color: inherit; text-align: left; }
  .view-home-row:last-child { border-bottom: 0; }
  button.view-home-row { cursor: pointer; }
  button.view-home-row:hover { background: #f8f8f4; }
  .view-home-attention-row { display: grid; min-height: 104px; grid-template-columns: 58px minmax(260px, 1.25fr) minmax(180px, .85fr) 90px 122px; align-items: center; gap: 18px; padding: 18px 4px 18px 0; }
  .view-home-continue-row { display: grid; min-height: 86px; grid-template-columns: 50px minmax(0, 1fr) 180px 20px; align-items: center; gap: 18px; padding: 14px 12px 14px 0; }
  .view-home-row-copy { display: grid; min-width: 0; gap: 5px; }
  .view-home-row-copy strong { overflow: hidden; color: var(--view-ink); font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
  .view-home-row-copy span { overflow: hidden; color: #858a85; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .view-home-row-identity small { color: var(--view-green); font-size: 12px; font-weight: 600; }
  .view-home-row-context strong { font-size: 14px; font-weight: 500; }
  .view-home-attention-row time, .view-home-updated-at { color: #686d69; font-size: 13px; font-style: normal; }
  .view-home-icon-tile { display: grid; width: 54px; height: 54px; place-items: center; border-radius: 50%; }
  .view-home-icon-tile.small { width: 46px; height: 46px; border-radius: 12px; }
  .view-home-icon-tile img { width: 26px; height: 26px; }
  .view-home-icon-tile.small img { width: 23px; height: 23px; }
  .view-home-icon-tile[data-tone="green"] { background: #edf2ee; }
  .view-home-icon-tile[data-tone="green"] img { filter: invert(25%) sepia(23%) saturate(1140%) hue-rotate(113deg) brightness(87%) contrast(91%); }
  .view-home-icon-tile[data-tone="blue"], .view-home-icon-tile[data-tone="orange"] { background: #edf2ee; }
  .view-home-icon-tile[data-tone="blue"] img, .view-home-icon-tile[data-tone="orange"] img { filter: invert(25%) sepia(23%) saturate(1140%) hue-rotate(113deg) brightness(87%) contrast(91%); }
  .view-home-icon-tile[data-tone="error"] { background: #fff0ec; }
  .view-home-icon-tile[data-tone="error"] img { filter: invert(34%) sepia(36%) saturate(1218%) hue-rotate(321deg) brightness(82%) contrast(92%); }
  .view-home-button { min-height: 42px; border: 1px solid #3c6d5e; border-radius: 8px; padding: 0 16px; background: transparent; color: #215544; cursor: pointer; }
  .view-home-button.primary { border-color: var(--view-green); background: var(--view-green); color: #fff; }
  .view-home-arrow { width: 17px; height: 17px; opacity: .64; }
  .view-home-module-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .view-home-module-card { display: grid; min-width: 0; grid-template-columns: 46px minmax(0, 1fr) 18px; align-items: center; gap: 15px; border: 0; border-right: 1px solid var(--view-line); background: transparent; padding: 20px; color: inherit; text-align: left; cursor: pointer; }
  .view-home-module-card:first-child { padding-left: 0; }
  .view-home-module-card:last-child { border-right: 0; }
  .view-home-module-card:hover strong { color: var(--view-green); }
  .view-home-module-icon-tile { display: grid; width: 46px; height: 46px; place-items: center; border-radius: 12px; background: #edf2ee; }
  .view-home-module-icon { width: 23px; height: 23px; }
  .view-home-module-card[data-icon="brain"] .view-home-module-icon { filter: invert(25%) sepia(23%) saturate(1140%) hue-rotate(113deg) brightness(87%) contrast(91%); }
  .view-home-module-card[data-icon="play-circle"] .view-home-module-icon-tile, .view-home-module-card[data-icon="gear-six"] .view-home-module-icon-tile { background: #edf2ee; }
  .view-home-module-card[data-icon="play-circle"] .view-home-module-icon, .view-home-module-card[data-icon="gear-six"] .view-home-module-icon { filter: invert(25%) sepia(23%) saturate(1140%) hue-rotate(113deg) brightness(87%) contrast(91%); }
  .view-home-empty { min-height: 100px; margin: 0; display: grid; place-items: center; color: var(--view-muted); }
  [data-view-page-portals]:empty { display: none; }
  [data-view-page-portals] { position: relative; z-index: 95; }
  [data-view-slot="overlay"]:empty { display: none; }
  [data-view-slot="overlay"] { position: relative; z-index: 100; }
  .view-overlay-layer { position: fixed; inset: 0; display: flex; background: rgba(24, 29, 26, .38); }
  .view-overlay-dialog { align-items: center; justify-content: center; padding: 24px; }
  .view-overlay-drawer { justify-content: flex-end; }
  .view-overlay-surface { position: relative; width: min(90vw, calc(100% - 48px)); height: min(90dvh, calc(100vh - 48px)); max-height: none; overflow: hidden; border-radius: 16px; background: #fdfcf9; box-shadow: 0 24px 70px rgba(25, 30, 27, .2); }
  .view-overlay-drawer .view-overlay-surface { width: min(720px, 100%); height: 100%; max-height: none; border-radius: 0; }
  .view-overlay-close { position: absolute; z-index: 4; top: 16px; right: 16px; display: grid; place-items: center; width: 36px; height: 36px; padding: 9px; border: 0; border-radius: 50%; background: #f0f1ed; color: var(--view-ink); cursor: pointer; }
  .view-overlay-close .view-shell-icon { width: 18px; height: 18px; }
  .view-overlay-mount { width: 100%; height: 100%; min-width: 0; }
  .view-overlay-nested-portal:empty { display: none; }
  @media (max-width: 760px) {
    .view-shell { display: block; padding-bottom: 74px; }
    .view-shell-sidebar { position: fixed; inset: auto 0 0; z-index: 90; display: flex; width: auto; height: 70px; flex-direction: row; overflow: visible; padding: 8px 14px; border: 0; border-top: 1px solid var(--view-line); }
    .view-shell-brand, .view-shell-project-label { display: none; }
    .view-shell-project-select-wrap { display: block; flex: 0 0 72px; margin: 0; }
    .view-shell-project-trigger { height: 54px; grid-template-columns: 1fr; justify-items: center; gap: 2px; border: 0; border-radius: 9px; background: transparent; padding: 3px 4px; font-size: 10px; text-align: center; }
    .view-shell-project-trigger:not(:disabled):hover, .view-shell-project-trigger[aria-expanded="true"] { background: #f0f1ed; }
    .view-shell-project-icon { width: 21px; height: 21px; }
    .view-shell-project-caret { display: none; }
    .view-shell-project-value { width: 100%; }
    .view-shell-project-menu { top: auto; right: auto; bottom: calc(100% + 8px); left: 0; width: min(260px, calc(100vw - 28px)); }
    .view-shell-sidebar [data-view-slot="navigation.primary"] { min-width: 0; height: 100%; flex: 1; margin: 0; grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: minmax(64px, 1fr); gap: 4px; overflow-x: auto; }
    .view-shell-navigation-item { height: 54px; grid-template-columns: 1fr; justify-items: center; gap: 3px; padding: 3px 8px; font-size: 11px; }
    .view-shell-navigation-item .view-shell-icon { width: 21px; height: 21px; }
    .view-shell-footer { display: block; flex: 0 0 64px; margin: 0; padding: 0; border: 0; }
    .view-shell-settings { display: grid; height: 54px; min-height: 54px; place-items: center; padding: 3px 6px; font-size: 11px; text-align: center; }
    .view-shell-service-status { display: none; }
    .view-shell-workspace { min-height: calc(100vh - 70px); }
    .view-shell-header { height: 66px; min-height: 66px; padding: 0 16px; }
    .view-shell-heading h1 { font-size: 15px; }
    .view-shell-heading p, .view-shell-breadcrumbs { display: none; }
    .view-shell-header [data-view-slot="header.actions"] { padding-right: 8px; }
    .view-home { min-height: calc(100vh - 136px); }
    .view-home-content { width: calc(100% - 32px); padding-top: 0; }
    .view-home-title { margin: 8px 0 34px; font-size: 36px; letter-spacing: -1px; }
    .view-home-attention-row { min-height: 120px; grid-template-columns: 46px minmax(0, 1fr); gap: 12px; padding: 15px 0; }
    .view-home-attention-row .view-home-row-context, .view-home-attention-row time { display: none; }
    .view-home-attention-row .view-home-button { grid-column: 2; justify-self: start; min-height: 34px; }
    .view-home-continue-row { grid-template-columns: 46px minmax(0, 1fr) 18px; }
    .view-home-continue-row .view-home-updated-at { display: none; }
    .view-home-module-grid { grid-template-columns: 1fr; }
    .view-home-module-card, .view-home-module-card:first-child { padding: 16px 0; border-right: 0; border-bottom: 1px solid var(--view-line); }
    .view-overlay-dialog { padding: 0; }
    .view-overlay-surface { width: 100%; height: 100dvh; max-height: 100vh; border-radius: 0; }
  }

  /* Feishu-like four-column Shell. Module-specific content remains owned by its Mount. */
  :root {
    --view-rail-width: 84px;
    --view-secondary-width: 218px;
    --view-list-width: 326px;
    --view-green: #28766e;
    --view-green-strong: #195c56;
    --view-green-soft: #deefec;
    --view-line: #dfe6e3;
    --view-muted: #697572;
    --view-canvas: #f7f9f8;
    --view-panel: #fff;
  }
  .view-shell, .view-shell button, .view-shell input {
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    font-synthesis: none;
    -webkit-font-smoothing: antialiased;
  }
  .view-shell {
    display: grid;
    width: 100%;
    height: 100vh;
    min-height: 0;
    grid-template-columns: var(--view-rail-width) minmax(0, 1fr);
    overflow: hidden;
    background: var(--view-canvas);
    color: #202726;
  }
  .view-shell-sidebar {
    position: relative;
    inset: auto;
    z-index: 24;
    display: flex;
    width: auto;
    min-width: 0;
    height: 100vh;
    min-height: 0;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    overflow: visible;
    padding: 14px 8px 12px;
    border: 0;
    border-right: 1px solid #d8e1e0;
    background: #eef3f4;
  }
  .view-shell-project-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .view-shell-project-select-wrap { position: relative; width: 54px; height: 54px; margin: 0; }
  .view-shell-project-home { position: absolute; inset: 0; display: block; border-radius: 14px; text-decoration: none; }
  .view-shell-project-mark {
    display: grid;
    width: 46px;
    height: 46px;
    margin: 0 auto;
    place-items: center;
    border-radius: 14px;
    background: var(--view-green);
    box-shadow: 0 6px 18px rgba(24, 91, 84, .22);
  }
  .view-shell-project-home:hover .view-shell-project-mark { background: var(--view-green-strong); }
  .view-shell-project-home:focus-visible { outline: 2px solid #69a79f; outline-offset: 3px; }
  .view-shell-project-icon { width: 21px; height: 21px; filter: invert(1); }
  .view-shell-project-value { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .view-shell-project-trigger {
    position: absolute;
    right: -2px;
    bottom: -1px;
    display: grid;
    width: 21px;
    min-width: 21px;
    height: 21px;
    min-height: 21px;
    grid-template-columns: 1fr;
    place-items: center;
    gap: 0;
    border: 2px solid #eef3f4;
    border-radius: 50%;
    background: #fff;
    padding: 0;
    color: var(--view-green);
    cursor: pointer;
  }
  .view-shell-project-trigger:disabled { cursor: default; opacity: .72; }
  .view-shell-project-trigger:not(:disabled):hover, .view-shell-project-trigger[aria-expanded="true"] { background: #e5f1ef; }
  .view-shell-project-trigger:focus-visible { outline: 2px solid #69a79f; outline-offset: 2px; box-shadow: none; }
  .view-shell-project-trigger-value { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .view-shell-project-caret { width: 11px; height: 11px; }
  .view-shell-project-trigger[aria-expanded="true"] .view-shell-project-caret { transform: rotate(180deg); }
  .view-shell-project-menu {
    position: absolute;
    z-index: 80;
    top: 2px;
    right: auto;
    left: 66px;
    width: 304px;
    max-height: min(300px, 60vh);
    overflow-y: auto;
    border: 1px solid var(--view-line);
    border-radius: 18px;
    background: #fff;
    box-shadow: 0 14px 40px rgba(31, 46, 43, .17);
    padding: 14px;
  }
  .view-shell-project-menu[hidden] { display: none; }
  .view-shell-project-menu-title, .view-shell-project-switch-label { color: #87928f; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .view-shell-project-menu-title { margin: 2px 8px 10px; }
  .view-shell-project-switch-label { margin: 12px 8px 5px; }
  .view-shell-project-option, .view-shell-project-current { display: grid; width: 100%; min-height: 58px; grid-template-columns: 40px minmax(0,1fr) auto; align-items: center; gap: 12px; border: 0; border-radius: 13px; background: transparent; padding: 8px 10px; color: #27312f; cursor: pointer; font: inherit; text-align: left; }
  .view-shell-project-option:hover, .view-shell-project-option:focus-visible { background: #f1f6f4; outline: none; }
  .view-shell-project-current { background: #e5f2ef; }
  .view-shell-project-current:hover, .view-shell-project-current:focus-visible { background: #dcece8; outline: none; }
  .view-shell-project-avatar { display: grid; width: 40px; height: 40px; place-items: center; border-radius: 11px; background: var(--view-green); color: #fff; font-size: 16px; font-weight: 700; text-transform: uppercase; }
  .view-shell-project-option-name, .view-shell-project-current-name { min-width: 0; overflow: hidden; font-size: 17px; text-overflow: ellipsis; white-space: nowrap; }
  .view-shell-project-current-copy { display: grid; min-width: 0; gap: 2px; }
  .view-shell-project-current-copy small { color: #6f7d79; font-size: 10px; font-weight: 600; }
  .view-shell-project-details-caret { width: 15px; height: 15px; opacity: .62; transform: rotate(-90deg); }
  .view-shell-search-trigger {
    display: flex;
    width: 46px;
    height: 42px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    margin-top: 5px;
    border: 1px solid #dde5e3;
    border-radius: 12px;
    background: rgba(255,255,255,.7);
    color: #667370;
    cursor: pointer;
  }
  .view-shell-search-trigger:hover, .view-shell-search-trigger[aria-expanded="true"] { background: #fff; color: #244d49; }
  .view-shell-search-trigger:focus-visible { outline: 2px solid #69a79f; outline-offset: 2px; }
  .view-shell-search-trigger img { width: 21px; height: 21px; }
  .view-shell-search-trigger span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .view-shell-rail-divider { width: 44px; height: 1px; flex: 0 0 1px; margin: 4px 0; background: #d8e0de; }
  .view-shell-sidebar [data-view-slot="navigation.primary"] { display: grid; width: 100%; gap: 6px; margin: 0; }
  .view-shell-navigation-item {
    display: flex;
    width: 100%;
    height: 66px;
    min-height: 66px;
    grid-template-columns: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    padding: 6px 2px;
    color: #596663;
    cursor: pointer;
    font-size: 11px;
    line-height: 1.2;
    text-align: center;
    text-decoration: none;
  }
  .view-shell-navigation-item:hover { background: rgba(255,255,255,.72); color: #244d49; }
  .view-shell-navigation-item.active { border: 0; background: #fff; color: #214b46; box-shadow: 0 1px 4px rgba(31,61,57,.08); font-weight: 650; }
  .view-shell-module-icon { display:grid; width:34px; height:34px; place-items:center; border-radius:10px; background:#e6efed; }
  .view-shell-navigation-item .view-shell-icon { width:22px; height:22px; filter:invert(37%) sepia(18%) saturate(1485%) hue-rotate(123deg) brightness(89%) contrast(86%); }
  .view-shell-navigation-item[data-view-entry*="org.memsphere.run"] .view-shell-module-icon, .view-shell-navigation-item[data-view-entry*="org.memsphere.settings"] .view-shell-module-icon { background:#e6efed; }
  .view-shell-navigation-item[data-view-entry*="org.memsphere.run"] .view-shell-icon, .view-shell-navigation-item[data-view-entry*="org.memsphere.settings"] .view-shell-icon { filter:invert(37%) sepia(18%) saturate(1485%) hue-rotate(123deg) brightness(89%) contrast(86%); }
  .view-shell-navigation-item.active .view-shell-module-icon { background:var(--view-green); }
  .view-shell-navigation-item.active .view-shell-icon { filter:invert(1); }
  .view-shell-navigation-item[data-view-entry*="org.memsphere.run"].active .view-shell-module-icon, .view-shell-navigation-item[data-view-entry*="org.memsphere.settings"].active .view-shell-module-icon { background:var(--view-green); }
  .view-shell-navigation-badge { position: absolute; transform: translate(21px, -19px); min-width: 16px; height: 16px; border-radius: 8px; background: #e65b5b; padding: 0 4px; color: #fff; font-size: 9px; line-height: 16px; }
  .view-shell-rail-spacer { min-height: 4px; flex: 1; }
  .view-shell-account-slot { min-height: 36px; }
  .view-shell-add-module { display: grid; width: 36px; height: 36px; flex: 0 0 auto; place-items: center; border: 0; border-radius: 9px; background: transparent; color: #667370; cursor: pointer; }
  .view-shell-add-module:hover { background: #e4ecea; color: #244d49; }
  .view-shell-add-module img { width: 20px; height: 20px; opacity: .72; }
  .view-shell-account { display: grid; width: 36px; min-width: 36px; height: 36px; min-height: 36px; place-items: center; border: 0; border-radius: 12px; background: #8b6a4f; padding: 0; }
  .view-shell-account-avatar { width: auto; height: auto; border-radius: 0; background: transparent; color: #fff; font: 700 12px/1 Inter, sans-serif; }
  .view-shell-account-user-icon, .view-shell-account-caret { display: none; }
  .view-shell-footer { display: grid; width: 100%; flex: 0 0 auto; gap: 4px; margin: 0; padding: 0; border: 0; }
  .view-shell-footer:empty { display: none; }
  .view-shell-footer .view-shell-settings { display: flex; width: 100%; height: 48px; min-height: 48px; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border-radius: 11px; padding: 3px; font-size: 10px; text-align: center; }
  .view-shell-footer .view-shell-settings .view-shell-icon { width: 20px; height: 20px; }
  .view-shell-service-status { display: none; }
  .view-shell-workspace {
    position: relative;
    grid-column: 2;
    display: grid;
    height: 100vh;
    min-width: 0;
    min-height: 0;
    grid-template-columns: var(--view-secondary-width) var(--view-list-width) minmax(0, 1fr);
    overflow: hidden;
  }
  .view-shell-secondary-panel, .view-shell-list-panel, .view-shell-detail-panel { min-width: 0; min-height: 0; }
  .view-shell-secondary-panel {
    position: relative;
    z-index: 3;
    display: flex;
    flex-direction: column;
    overflow: visible;
    border-right: 1px solid var(--view-line);
    background: #f4f7f6;
  }
  .view-shell-list-panel {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    overflow: visible;
    border-right: 1px solid var(--view-line);
    background: #fff;
  }
  .view-shell-secondary-slot, .view-shell-list-slot { width: 100%; height: 100%; min-height: 0; overflow: hidden; }
  .view-shell-secondary-navigation { display: flex; width: 100%; height: 100%; min-height: 0; flex-direction: column; padding: 19px 12px 14px; }
  .view-shell-secondary-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 0 6px 17px; }
  .view-shell-secondary-header > div { min-width: 0; }
  .view-shell-secondary-header small { display: block; margin-bottom: 4px; color: #82908d; font-size: 10px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
  .view-shell-secondary-header h1, .view-shell-secondary-header h2 { overflow: hidden; margin: 0; font-size: 20px; line-height: 1.25; letter-spacing: -.02em; text-overflow: ellipsis; white-space: nowrap; }
  .view-shell-secondary-settings { display: grid; width: 36px; height: 36px; flex: 0 0 auto; place-items: center; border: 0; border-radius: 9px; background: transparent; color: #667370; cursor: pointer; }
  .view-shell-secondary-settings:hover { background: #e4ecea; color: #244d49; }
  .view-shell-secondary-settings .view-shell-icon { width: 18px; height: 18px; }
  .view-shell-secondary-items { display: grid; gap: 3px; }
  .view-shell-secondary-item { display: grid; width: 100%; height: 41px; grid-template-columns: 23px minmax(0, 1fr) auto; align-items: center; gap: 7px; border: 0; border-radius: 9px; background: transparent; padding: 0 10px; color: #4c5956; cursor: pointer; text-align: left; }
  .view-shell-secondary-item:hover { background: #e9efed; }
  .view-shell-secondary-item.active { background: #dcece9; color: #185c55; font-weight: 650; }
  .view-shell-secondary-item .view-shell-icon { width: 18px; height: 18px; }
  .view-shell-secondary-badge { display: grid; min-width: 20px; height: 20px; place-items: center; border-radius: 10px; background: rgba(255,255,255,.72); padding: 0 6px; color: #64716e; font-size: 10px; }
  .view-shell-secondary-item.active .view-shell-secondary-badge { background: #eff8f6; color: var(--view-green); }
  .view-shell-secondary-footer { display: flex; align-items: flex-start; gap: 7px; margin-top: auto; border-top: 1px solid var(--view-line); padding: 14px 7px 2px; color: #788481; font-size: 11px; line-height: 1.55; }
  .view-host-list-mount { width: 100%; height: 100%; min-height: 0; overflow-x: hidden; overflow-y: auto; }
  .view-shell-detail-panel { display: flex; flex-direction: column; overflow: hidden; background: #fbfcfb; }
  .view-shell-header {
    display: flex;
    height: 100px;
    min-height: 100px;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 18px 25px 15px;
    border: 0;
    border-bottom: 1px solid var(--view-line);
    background: rgba(255,255,255,.93);
  }
  .view-shell-header [data-view-slot="header.title"] { min-width: 0; flex: 1; }
  .view-shell-header [data-view-slot="header.actions"] { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; border: 0; padding: 9px 0 0; }
  .view-shell-heading { display: block; }
  .view-shell-heading h1 { margin: 0 0 5px; color: #202726; font-size: 21px; font-weight: 650; line-height: 1.3; letter-spacing: -.025em; }
  .view-shell-heading h1.memory-title, .view-shell-heading h1.run-title { font-size: 23px; font-weight: 700; }
  .view-shell-heading p, .view-shell-breadcrumbs { margin: 0 0 4px; color: #7c8885; font-size: 11px; }
  .view-shell-action { min-height: 34px; border-color: #d5dfdc; border-radius: 8px; background: #fff; padding: 0 12px; color: #33403d; font-size: 12px; font-weight: 600; }
  .view-shell-action:not(:disabled):hover { border-color: #adc8c3; background: #f1f6f4; }
  .view-shell-header [data-view-slot="header.actions"] .view-shell-action:last-child:not(:disabled) { border-color: var(--view-green); background: var(--view-green); color: #fff; }
  .view-shell-header [data-view-slot="header.actions"] .view-shell-action:last-child:not(:disabled):hover { border-color: var(--view-green-strong); background: var(--view-green-strong); }
  #memsphere-view-root { min-width: 0; min-height: 0; flex: 1; overflow: auto; }
  #memsphere-view-root.view-host-status { min-height: 0; }
  #memsphere-view-root.view-shell-detail-loading { display: block; padding: 24px 26px; }
  .view-shell-loading-skeleton { display: grid; max-width: 920px; gap: 12px; margin: 0 auto; }
  .view-shell-loading-line, .view-shell-loading-card { display: block; border-radius: 9px; background: #edf1ef; animation: view-shell-loading-pulse 1.1s ease-in-out infinite alternate; }
  .view-shell-loading-line { width: 72%; height: 14px; }
  .view-shell-loading-line.title { width: 46%; height: 24px; margin-bottom: 8px; }
  .view-shell-loading-line.short { width: 58%; }
  .view-shell-loading-card { height: 190px; margin-top: 12px; border: 1px solid #e5eae8; background: #f3f6f5; }
  @keyframes view-shell-loading-pulse { from { opacity: .54; } to { opacity: .9; } }
  .view-shell-panel-resizer { position: absolute; z-index: 12; top: 0; right: -5px; bottom: 0; width: 10px; cursor: col-resize; touch-action: none; outline: none; }
  .view-shell-panel-resizer::before { content: ""; position: absolute; top: 0; bottom: 0; left: 4px; width: 2px; background: transparent; transition: background-color 120ms ease; }
  .view-shell-panel-resizer > span { position: absolute; top: 50%; left: 2px; width: 6px; height: 38px; border-radius: 6px; background: transparent; transform: translateY(-50%); transition: background-color 120ms ease, box-shadow 120ms ease; }
  .view-shell-panel-resizer:hover::before, .view-shell-panel-resizer:focus-visible::before, .view-shell[data-view-resizing] .view-shell-panel-resizer::before { background: #69a79f; }
  .view-shell-panel-resizer:hover > span, .view-shell-panel-resizer:focus-visible > span, .view-shell[data-view-resizing] .view-shell-panel-resizer > span { background: #f7fbfa; box-shadow: inset 0 0 0 1px #8ab7b1; }
  .view-shell[data-view-resizing] { cursor: col-resize; user-select: none; }
  .view-shell[data-view-layout="home"] .view-shell-workspace { grid-template-columns: minmax(0, 1fr); }
  .view-shell[data-view-layout="home"] .view-shell-secondary-panel, .view-shell[data-view-layout="home"] .view-shell-list-panel { display: none; }
  .view-shell[data-view-layout="home"] .view-shell-detail-panel { grid-column: 1 / -1; }
  .view-shell[data-view-layout="home"] .view-shell-header { background: var(--view-canvas); }
  .view-shell[data-view-layout="module"][data-view-content-list="false"] .view-shell-workspace { grid-template-columns: var(--view-secondary-width) minmax(0, 1fr); }
  .view-shell[data-view-layout="module"][data-view-content-list="false"] .view-shell-list-panel { display: none; }
  .view-home { min-height: 100%; }

  .view-shell-search-overlay {
    position: fixed;
    inset: 12px;
    z-index: 120;
    display: grid;
    grid-template-rows: 74px 54px minmax(0, 1fr) 38px;
    overflow: hidden;
    border: 1px solid #d8e0de;
    border-radius: 18px;
    background: rgba(249,251,250,.98);
    box-shadow: 0 24px 80px rgba(22,44,40,.24);
    backdrop-filter: blur(18px);
  }
  .view-shell-search-overlay[hidden] { display: none; }
  .view-shell-search-command { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto 36px; align-items: center; gap: 10px; padding: 13px 20px; border-bottom: 1px solid #edf0ef; background: #fff; color: #74817e; }
  .view-shell-search-command > img { width: 24px; height: 24px; }
  .view-shell-search-command input { min-width: 0; border: 0; outline: 0; background: transparent; color: #26312f; font-size: 20px; }
  .view-shell-search-command input::placeholder { color: #a1aaa8; }
  .view-shell-search-command kbd { border: 1px solid #dfe5e3; border-radius: 5px; background: #f4f6f5; padding: 3px 6px; color: #8b9592; font: 9px/1.2 inherit; }
  .view-shell-search-command button { display: grid; width: 36px; height: 36px; place-items: center; border: 0; border-radius: 8px; background: transparent; cursor: pointer; }
  .view-shell-search-command button:hover { background: #eef3f1; }
  .view-shell-search-command button img { width: 22px; height: 22px; }
  .view-shell-search-providers { display: flex; align-items: center; gap: 8px; overflow-x: auto; padding: 8px 20px; border-bottom: 1px solid #e6ebe9; background: #fff; }
  .view-shell-search-providers button { height: 32px; flex: 0 0 auto; border: 0; border-radius: 17px; background: #f1f4f3; padding: 0 15px; cursor: pointer; font-size: 12px; }
  .view-shell-search-providers button:hover, .view-shell-search-providers button[aria-selected="true"] { background: #dcece9; color: var(--view-green-strong); font-weight: 650; }
  .view-shell-search-body { position: relative; min-height: 0; overflow: auto; }
  .view-shell-search-empty { display: grid; width: 100%; height: 100%; place-content: center; justify-items: center; color: #65726f; text-align: center; }
  .view-shell-search-empty[hidden], .view-shell-search-results[hidden] { display: none; }
  .view-shell-search-empty-icon { display: grid; width: 78px; height: 78px; margin-bottom: 17px; place-items: center; border-radius: 25px; background: #e0f0ed; }
  .view-shell-search-empty-icon img { width: 34px; height: 34px; filter: invert(40%) sepia(18%) saturate(1288%) hue-rotate(123deg) brightness(91%) contrast(87%); }
  .view-shell-search-empty h2 { margin: 0 0 7px; font-size: 18px; }
  .view-shell-search-empty p { margin: 0; color: #8a9492; font-size: 12px; }
  .view-shell-search-results { width: min(760px, calc(100% - 48px)); margin: 24px auto; }
  .view-shell-search-status { position: absolute; top: 0; left: 50%; margin: 8px 0 0; color: #7c8885; font-size: 11px; transform: translateX(-50%); }
  .view-shell-search-status:empty { display: none; }
  .view-shell-search-footer { display: flex; align-items: center; justify-content: flex-end; gap: 18px; border-top: 1px solid #e2e8e6; background: #fff; padding: 0 20px; color: #8b9592; font-size: 10px; }
  .view-shell-project-details-overlay { position: fixed; inset: 0; z-index: 130; display: grid; place-items: center; padding: 24px; background: rgba(24,29,26,.38); }
  .view-shell-project-details-overlay[hidden] { display: none; }
  .view-shell-project-details-card { width: min(560px, 100%); overflow: hidden; border: 1px solid #d8e0de; border-radius: 16px; background: #fff; box-shadow: 0 24px 70px rgba(22,44,40,.22); }
  .view-shell-project-details-card > header { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 14px; border-bottom: 1px solid #e6ebe9; }
  .view-shell-project-details-card h2 { margin: 0; font-size: 19px; }
  .view-shell-project-details-card header button { display: grid; width: 32px; height: 32px; place-items: center; border: 0; border-radius: 8px; background: transparent; cursor: pointer; }
  .view-shell-project-details-card header button:hover { background: #eef3f1; }
  .view-shell-project-details-card header img { width: 18px; height: 18px; }
  .view-shell-project-details-card dl { display: grid; margin: 0; padding: 8px 20px 20px; }
  .view-shell-project-detail-row { display: grid; grid-template-columns: 110px minmax(0,1fr); gap: 16px; padding: 12px 0; border-bottom: 1px solid #edf1ef; }
  .view-shell-project-detail-row:last-child { border-bottom: 0; }
  .view-shell-project-detail-row dt { color: #7c8885; }
  .view-shell-project-detail-row dd { min-width: 0; margin: 0; color: #26312f; overflow-wrap: anywhere; }

  @media (max-width: 1240px) and (min-width: 821px) {
    :root { --view-rail-width: 74px; --view-secondary-width: 198px; --view-list-width: 292px; }
  }
  @media (max-width: 820px) {
    :root { --view-rail-width: 74px; --view-secondary-width: 198px; --view-list-width: 292px; }
    .view-shell {
      display: grid;
      width: max(100%, 1084px);
      height: 100vh;
      min-height: 0;
      grid-template-columns: var(--view-rail-width) minmax(0, 1fr);
      overflow: hidden;
      padding-bottom: 0;
    }
    .view-shell[data-view-content-list="false"] { width: max(100%, 812px); }
    .view-shell-sidebar {
      position: relative;
      inset: auto;
      z-index: 24;
      display: flex;
      width: auto;
      min-width: 0;
      height: 100vh;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      overflow: visible;
      padding: 14px 8px 12px;
      border: 0;
      border-right: 1px solid #d8e1e0;
    }
    .view-shell-project-select-wrap { display: block; width: 54px; height: 54px; flex: 0 0 auto; }
    .view-shell-project-trigger { position: absolute; right: -2px; bottom: -1px; display: grid; width: 21px; min-width: 21px; height: 21px; min-height: 21px; grid-template-columns: 1fr; padding: 0; }
    .view-shell-project-icon { width: 21px; height: 21px; }
    .view-shell-project-caret { display: block; }
    .view-shell-project-menu { top: 2px; right: auto; bottom: auto; left: 66px; width: 224px; }
    .view-shell-sidebar [data-view-slot="navigation.primary"] { display: grid; width: 100%; height: auto; min-width: 0; flex: 0 0 auto; grid-template-columns: none; grid-auto-flow: row; grid-auto-columns: auto; gap: 6px; overflow: visible; }
    .view-shell-navigation-item { display: flex; width: 100%; height: 66px; min-height: 66px; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 6px 2px; font-size: 11px; }
    .view-shell-navigation-item .view-shell-icon { width: 22px; height: 22px; }
    .view-shell-footer { display: grid; width: 100%; flex: 0 0 auto; margin: 0; padding: 0; }
    .view-shell-footer .view-shell-settings { display: flex; width: 100%; height: 48px; min-height: 48px; flex-direction: column; padding: 3px; font-size: 10px; }
    .view-shell-workspace { height: 100vh; min-height: 0; grid-template-columns: var(--view-secondary-width) var(--view-list-width) minmax(520px, 1fr); }
    .view-shell[data-view-content-list="false"] .view-shell-workspace { grid-template-columns: var(--view-secondary-width) minmax(540px, 1fr); }
    .view-shell-header { height: 100px; min-height: 100px; padding: 18px 25px 15px; }
    .view-shell-heading h1 { font-size: 21px; }
    .view-shell-heading p, .view-shell-breadcrumbs { display: block; }
    .view-shell-header [data-view-slot="header.actions"] { padding-right: 0; }
    body:has(.view-overlay-layer) .view-shell { width: 100%; }
    body:has(.view-overlay-layer) .view-shell-workspace { grid-template-columns: minmax(0, 1fr); }
    body:has(.view-overlay-layer) .view-shell-secondary-panel,
    body:has(.view-overlay-layer) .view-shell-list-panel { display: none; }
  }
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
