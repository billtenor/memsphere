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
        <div class="view-shell-detail-body">
          <main id="memsphere-view-root" class="${isHome ? "" : "view-shell-detail-loading"}" aria-live="polite">${main}</main>
          <aside class="view-shell-side-panel" data-view-side-panel-container aria-label="${chinese ? "辅助面板" : "Side panel"}" hidden>
            <header><strong data-view-side-panel-title></strong><button type="button" data-view-side-panel-close aria-label="${chinese ? "关闭辅助面板" : "Close side panel"}"><img src="/assets/system-icons/x.svg" alt="" aria-hidden="true" /></button></header>
            <div class="view-shell-side-panel-slot" data-view-slot="side.panel"></div>
          </aside>
        </div>
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
    const icon = initialIconName(item.icon);
    const weightedIcon = active && ["brain", "circle", "cube", "gear-six", "house", "play-circle", "seal-check", "stack"].includes(icon)
      ? `${icon}-fill`
      : icon;
    return `<a class="view-shell-navigation-item${active ? " active" : ""}" href="${escapeHtml(item.href)}" aria-current="${active ? "page" : "false"}" title="${escapeHtml(item.label)}">
      <span class="view-shell-module-icon"><img class="view-shell-icon" src="/assets/system-icons/${weightedIcon}.svg" alt="" aria-hidden="true" /></span>
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
  * { box-sizing: border-box; }
  .view-shell, .view-shell button, .view-shell input { font-family:var(--mem-view-font-sans); font-synthesis:none; -webkit-font-smoothing:antialiased; }
  .view-shell-project-trigger, .view-shell-project-option, .view-shell-navigation-item, .view-shell-action, .view-home-row, .view-home-button, .view-home-module-card { font:inherit; }
  a.view-shell-navigation-item, a.view-shell-settings, a.view-home-module-card { text-decoration:none; }
  .view-host-module-error { margin:var(--mem-view-space-5); border:1px solid var(--mem-view-color-danger); border-left-width:4px; border-radius:var(--mem-view-radius-md); background:var(--mem-view-color-danger-soft); padding:var(--mem-view-space-4); }
  .view-host-module-error h2 { margin:0 0 var(--mem-view-space-2); color:var(--mem-view-color-danger); font-size:var(--mem-view-font-size-lg); }
  .view-host-module-error p { color:var(--mem-view-color-text-muted); white-space:pre-wrap; overflow-wrap:anywhere; }
  .view-host-module-error button { border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-sm); background:var(--mem-view-color-surface); padding:7px 10px; }
  .view-home-content { width: min(1060px, calc(100% - 88px)); margin: 0 auto; padding: 8px 0 70px; }
  .view-home-title { margin: 3px 0 48px; font:700 var(--mem-view-font-size-display)/var(--mem-view-line-heading) var(--mem-view-font-sans); letter-spacing:-2px; }
  .view-home-section { margin-bottom: 44px; }
  .view-home-section > h2 { height: 44px; margin: 0; border-bottom: 1px solid var(--mem-view-color-border); font:600 var(--mem-view-font-size-xl)/var(--mem-view-line-heading) var(--mem-view-font-sans); }
  .view-home-count { display: inline-grid; min-width: 22px; height: 22px; margin-left: 7px; place-items: center; border-radius: var(--mem-view-radius-md); background: var(--mem-view-color-subtle); color: var(--mem-view-color-text-muted); font:var(--mem-view-font-size-sm) var(--mem-view-font-sans); vertical-align: 2px; }
  .view-home-section-body { border-bottom: 1px solid var(--mem-view-color-border); }
  .view-home-row { width: 100%; min-width: 0; border: 0; border-bottom: 1px solid var(--mem-view-color-border); background: transparent; color: inherit; text-align: left; }
  .view-home-row:last-child { border-bottom: 0; }
  button.view-home-row { cursor: pointer; }
  button.view-home-row:hover { background: var(--mem-view-color-subtle); }
  .view-home-attention-row { display: grid; min-height: 104px; grid-template-columns: 58px minmax(260px, 1.25fr) minmax(180px, .85fr) 90px 122px; align-items: center; gap: 18px; padding: 18px 4px 18px 0; }
  .view-home-continue-row { display: grid; min-height: 86px; grid-template-columns: 50px minmax(0, 1fr) 180px 20px; align-items: center; gap: 18px; padding: 14px 12px 14px 0; }
  .view-home-row-copy { display: grid; min-width: 0; gap: 5px; }
  .view-home-row-copy strong { overflow: hidden; color: var(--mem-view-color-text); font-size: var(--mem-view-font-size-md); text-overflow: ellipsis; white-space: nowrap; }
  .view-home-row-copy span { overflow: hidden; color: var(--mem-view-color-text-muted); font-size: var(--mem-view-font-size-sm); text-overflow: ellipsis; white-space: nowrap; }
  .view-home-row-identity small { color: var(--mem-view-color-accent); font-size: var(--mem-view-font-size-sm); font-weight: 600; }
  .view-home-row-context strong { font-size: var(--mem-view-font-size-base); font-weight: 500; }
  .view-home-attention-row time, .view-home-updated-at { color: var(--mem-view-color-text-muted); font-size: var(--mem-view-font-size-sm); font-style: normal; }
  .view-home-icon-tile { display: grid; width: 54px; height: 54px; place-items: center; border-radius: 50%; }
  .view-home-icon-tile.small { width: 46px; height: 46px; border-radius: var(--mem-view-radius-md); }
  .view-home-icon-tile img { width: 26px; height: 26px; }
  .view-home-icon-tile.small img { width: 23px; height: 23px; }
  .view-home-icon-tile[data-tone="green"] { background: var(--mem-view-color-subtle); }
  .view-home-icon-tile[data-tone="green"] img { filter: invert(25%) sepia(23%) saturate(1140%) hue-rotate(113deg) brightness(87%) contrast(91%); }
  .view-home-icon-tile[data-tone="blue"], .view-home-icon-tile[data-tone="orange"] { background: var(--mem-view-color-subtle); }
  .view-home-icon-tile[data-tone="blue"] img, .view-home-icon-tile[data-tone="orange"] img { filter: invert(25%) sepia(23%) saturate(1140%) hue-rotate(113deg) brightness(87%) contrast(91%); }
  .view-home-icon-tile[data-tone="error"] { background: var(--mem-view-color-danger-soft); }
  .view-home-icon-tile[data-tone="error"] img { filter: invert(34%) sepia(36%) saturate(1218%) hue-rotate(321deg) brightness(82%) contrast(92%); }
  .view-home-button { min-height: 42px; border: 1px solid var(--mem-view-color-accent-hover); border-radius: var(--mem-view-radius-sm); padding: 0 16px; background: transparent; color: var(--mem-view-color-accent-hover); cursor: pointer; }
  .view-home-button.primary { border-color: var(--mem-view-color-accent); background: var(--mem-view-color-accent); color: var(--mem-view-color-on-accent); }
  .view-home-arrow { width: 17px; height: 17px; opacity: .64; }
  .view-home-module-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .view-home-module-card { display: grid; min-width: 0; grid-template-columns: 46px minmax(0, 1fr) 18px; align-items: center; gap: 15px; border: 0; border-right: 1px solid var(--mem-view-color-border); background: transparent; padding: 20px; color: inherit; text-align: left; cursor: pointer; }
  .view-home-module-card:first-child { padding-left: 0; }
  .view-home-module-card:last-child { border-right: 0; }
  .view-home-module-card:hover strong { color: var(--mem-view-color-accent); }
  .view-home-module-icon-tile { display: grid; width: 46px; height: 46px; place-items: center; border-radius: var(--mem-view-radius-md); background: var(--mem-view-color-subtle); }
  .view-home-module-icon { width: 23px; height: 23px; }
  .view-home-module-card[data-icon="brain"] .view-home-module-icon { filter: invert(25%) sepia(23%) saturate(1140%) hue-rotate(113deg) brightness(87%) contrast(91%); }
  .view-home-module-card[data-icon="play-circle"] .view-home-module-icon-tile, .view-home-module-card[data-icon="gear-six"] .view-home-module-icon-tile { background: var(--mem-view-color-subtle); }
  .view-home-module-card[data-icon="play-circle"] .view-home-module-icon, .view-home-module-card[data-icon="gear-six"] .view-home-module-icon { filter: invert(25%) sepia(23%) saturate(1140%) hue-rotate(113deg) brightness(87%) contrast(91%); }
  .view-home-empty { min-height: 100px; margin: 0; display: grid; place-items: center; color: var(--mem-view-color-text-muted); }
  [data-view-page-portals]:empty { display: none; }
  [data-view-page-portals] { position: relative; z-index: 95; }
  [data-view-slot="overlay"]:empty { display: none; }
  [data-view-slot="overlay"] { position: relative; z-index: 100; }
  .view-overlay-layer { position: fixed; inset: 0; display: flex; background: var(--mem-view-color-overlay); }
  .view-overlay-dialog { align-items: center; justify-content: center; padding: 24px; }
  .view-overlay-drawer { justify-content: flex-end; }
  .view-overlay-surface { position: relative; width: min(90vw, calc(100% - 48px)); height: min(90dvh, calc(100vh - 48px)); max-height: none; overflow: hidden; border-radius: var(--mem-view-radius-lg); background: var(--mem-view-color-canvas); box-shadow: var(--mem-view-shadow-overlay); }
  .view-overlay-drawer .view-overlay-surface { width: min(720px, 100%); height: 100%; max-height: none; border-radius: 0; }
  .view-overlay-dialog[data-size="compact"] .view-overlay-surface { width: min(560px, calc(100% - 48px)); height:auto; min-height:280px; max-height:min(640px, calc(100% - 48px)); }
  .view-overlay-dialog[data-size="compact"] .view-overlay-mount { min-height:280px; }
  .view-overlay-drawer[data-size="compact"] .view-overlay-surface { width: min(440px, 100%); }
  .view-overlay-close { position: absolute; z-index: 4; top: 16px; right: 16px; display: grid; place-items: center; width: 36px; height: 36px; padding: 9px; border: 0; border-radius: 50%; background: var(--mem-view-color-subtle); color: var(--mem-view-color-text); cursor: pointer; }
  .view-overlay-close .view-shell-icon { width: 18px; height: 18px; }
  .view-overlay-mount { width: 100%; height: 100%; min-width: 0; }
  .view-overlay-nested-portal:empty { display: none; }

  @media (max-width:760px) {
    .view-overlay-dialog { padding:0; }
    .view-overlay-surface { width:100%; height:100dvh; max-height:100vh; border-radius:0; }
  }
  /* Feishu-like four-column Shell. Module-specific content remains owned by its Mount. */
  :root {
    --view-rail-width: 84px;
    --view-secondary-width: 218px;
    --view-list-width: 326px;
  }
  .view-shell, .view-shell button, .view-shell input {
    font-family: var(--mem-view-font-sans);
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
    background: var(--mem-view-color-canvas);
    color: var(--mem-view-color-text);
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
    border-right: 1px solid var(--mem-view-color-border);
    background: var(--mem-view-color-subtle);
  }
  .view-shell-project-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .view-shell-project-select-wrap { position: relative; width: 54px; height: 54px; margin: 0; }
  .view-shell-project-home { position: absolute; inset: 0; display: block; border-radius: var(--mem-view-radius-lg); text-decoration: none; }
  .view-shell-project-mark {
    display: grid;
    width: 46px;
    height: 46px;
    margin: 0 auto;
    place-items: center;
    border-radius: var(--mem-view-radius-lg);
    background: var(--mem-view-color-accent);
    box-shadow: var(--mem-view-shadow-card);
  }
  .view-shell-project-home:hover .view-shell-project-mark { background: var(--mem-view-color-accent-hover); }
  .view-shell-project-home:focus-visible { outline: 2px solid var(--mem-view-color-accent); outline-offset: 3px; }
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
    border: 2px solid var(--mem-view-color-subtle);
    border-radius: 50%;
    background: var(--mem-view-color-surface);
    padding: 0;
    color: var(--mem-view-color-accent);
    cursor: pointer;
  }
  .view-shell-project-trigger:disabled { cursor: default; opacity: .72; }
  .view-shell-project-trigger:not(:disabled):hover, .view-shell-project-trigger[aria-expanded="true"] { background: var(--mem-view-color-accent-soft); }
  .view-shell-project-trigger:focus-visible { outline: 2px solid var(--mem-view-color-accent); outline-offset: 2px; box-shadow: none; }
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
    border: 1px solid var(--mem-view-color-border);
    border-radius: var(--mem-view-radius-lg);
    background: var(--mem-view-color-surface);
    box-shadow: var(--mem-view-shadow-popover);
    padding: 14px;
  }
  .view-shell-project-menu[hidden] { display: none; }
  .view-shell-project-menu-title, .view-shell-project-switch-label { color: var(--mem-view-color-text-muted); font-size: var(--mem-view-font-size-xs); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .view-shell-project-menu-title { margin: 2px 8px 10px; }
  .view-shell-project-switch-label { margin: 12px 8px 5px; }
  .view-shell-project-option, .view-shell-project-current { display: grid; width: 100%; min-height: 58px; grid-template-columns: 40px minmax(0,1fr) auto; align-items: center; gap: 12px; border: 0; border-radius: var(--mem-view-radius-md); background: transparent; padding: 8px 10px; color: var(--mem-view-color-text); cursor: pointer; font: inherit; text-align: left; }
  .view-shell-project-option:hover, .view-shell-project-option:focus-visible { background: var(--mem-view-color-subtle); outline: none; }
  .view-shell-project-current { background: var(--mem-view-color-accent-soft); }
  .view-shell-project-current:hover, .view-shell-project-current:focus-visible { background: var(--mem-view-color-accent-soft); outline: none; }
  .view-shell-project-avatar { display: grid; width: 40px; height: 40px; place-items: center; border-radius: var(--mem-view-radius-md); background: var(--mem-view-color-accent); color: var(--mem-view-color-on-accent); font-size: var(--mem-view-font-size-md); font-weight: 700; text-transform: uppercase; }
  .view-shell-project-option-name, .view-shell-project-current-name { min-width: 0; overflow: hidden; font-size: var(--mem-view-font-size-lg); text-overflow: ellipsis; white-space: nowrap; }
  .view-shell-project-current-copy { display: grid; min-width: 0; gap: 2px; }
  .view-shell-project-current-copy small { color: var(--mem-view-color-text-muted); font-size: var(--mem-view-font-size-xs); font-weight: 600; }
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
    border: 1px solid var(--mem-view-color-border);
    border-radius: var(--mem-view-radius-md);
    background: color-mix(in srgb, var(--mem-view-color-surface) 70%, transparent);
    color: var(--mem-view-color-text-muted);
    cursor: pointer;
  }
  .view-shell-search-trigger:hover, .view-shell-search-trigger[aria-expanded="true"] { background: var(--mem-view-color-surface); color: var(--mem-view-color-accent-hover); }
  .view-shell-search-trigger:focus-visible { outline: 2px solid var(--mem-view-color-accent); outline-offset: 2px; }
  .view-shell-search-trigger img { width: 21px; height: 21px; }
  .view-shell-search-trigger span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .view-shell-rail-divider { width: 44px; height: 1px; flex: 0 0 1px; margin: 4px 0; background: var(--mem-view-color-border); }
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
    border-radius: var(--mem-view-radius-md);
    background: transparent;
    padding: 6px 2px;
    color: var(--mem-view-color-text-muted);
    cursor: pointer;
    font-size: var(--mem-view-font-size-xs);
    line-height: 1.2;
    text-align: center;
    text-decoration: none;
  }
  .view-shell-navigation-item:hover { background: color-mix(in srgb, var(--mem-view-color-surface) 72%, transparent); color: var(--mem-view-color-accent-hover); }
  .view-shell-navigation-item.active { border: 0; background: var(--mem-view-color-surface); color: var(--mem-view-color-accent-hover); box-shadow: var(--mem-view-shadow-card); font-weight: 650; }
  .view-shell-module-icon { display:grid; width:34px; height:34px; place-items:center; border-radius:var(--mem-view-radius-md); background:var(--mem-view-color-subtle); }
  .view-shell-navigation-item .view-shell-icon { width:22px; height:22px; }
  .view-shell-navigation-item img.view-shell-icon { filter:invert(37%) sepia(18%) saturate(1485%) hue-rotate(123deg) brightness(89%) contrast(86%); }
  .view-shell-navigation-item .mem-view-system-icon { color:var(--mem-view-color-accent-hover); filter:none; }
  .view-shell-navigation-item[data-view-entry*="org.memsphere.run"] .view-shell-module-icon, .view-shell-navigation-item[data-view-entry*="org.memsphere.settings"] .view-shell-module-icon { background:var(--mem-view-color-subtle); }
  .view-shell-navigation-item[data-view-entry*="org.memsphere.run"] img.view-shell-icon, .view-shell-navigation-item[data-view-entry*="org.memsphere.settings"] img.view-shell-icon { filter:invert(37%) sepia(18%) saturate(1485%) hue-rotate(123deg) brightness(89%) contrast(86%); }
  .view-shell-navigation-item.active .view-shell-module-icon { background:var(--mem-view-color-accent); }
  .view-shell-navigation-item.active img.view-shell-icon { filter:invert(1); }
  .view-shell-navigation-item.active .mem-view-system-icon { color:var(--mem-view-color-on-accent); filter:none; }
  .view-shell-navigation-item[data-view-entry*="org.memsphere.run"].active .view-shell-module-icon, .view-shell-navigation-item[data-view-entry*="org.memsphere.settings"].active .view-shell-module-icon { background:var(--mem-view-color-accent); }
  .view-shell-navigation-badge { position: absolute; transform: translate(21px, -19px); min-width: 16px; height: 16px; border-radius: var(--mem-view-radius-sm); background: var(--mem-view-color-badge); padding: 0 4px; color: var(--mem-view-color-on-accent); font-size: var(--mem-view-font-size-xs); line-height: 16px; }
  .view-shell-rail-spacer { min-height: 4px; flex: 1; }
  .view-shell-account-slot { min-height: 36px; }
  .view-shell-add-module { display: grid; width: 36px; height: 36px; flex: 0 0 auto; place-items: center; border: 0; border-radius: var(--mem-view-radius-sm); background: transparent; color: var(--mem-view-color-text-muted); cursor: pointer; }
  .view-shell-add-module:hover { background: var(--mem-view-color-subtle); color: var(--mem-view-color-accent-hover); }
  .view-shell-add-module img { width: 20px; height: 20px; opacity: .72; }
  .view-shell-account { display: grid; width: 36px; min-width: 36px; height: 36px; min-height: 36px; place-items: center; border: 0; border-radius: var(--mem-view-radius-md); background: var(--mem-view-color-account); padding: 0; }
  .view-shell-account-avatar { width: auto; height: auto; border-radius: 0; background: transparent; color: var(--mem-view-color-on-accent); font:700 var(--mem-view-font-size-sm)/1 var(--mem-view-font-sans); }
  .view-shell-account-user-icon, .view-shell-account-caret { display: none; }
  .view-shell-footer { display: grid; width: 100%; flex: 0 0 auto; gap: 4px; margin: 0; padding: 0; border: 0; }
  .view-shell-footer:empty { display: none; }
  .view-shell-footer .view-shell-settings { display: flex; width: 100%; height: 48px; min-height: 48px; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border-radius: var(--mem-view-radius-md); padding: 3px; font-size: var(--mem-view-font-size-xs); text-align: center; }
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
    border-right: 1px solid var(--mem-view-color-border);
    background: var(--mem-view-color-canvas);
  }
  .view-shell-list-panel {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    overflow: visible;
    border-right: 1px solid var(--mem-view-color-border);
    background: var(--mem-view-color-surface);
  }
  .view-shell-secondary-slot, .view-shell-list-slot { width: 100%; height: 100%; min-height: 0; overflow: hidden; }
  .view-shell-secondary-navigation { display: flex; width: 100%; height: 100%; min-height: 0; flex-direction: column; padding: 19px 12px 14px; }
  .view-shell-secondary-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 0 6px 17px; }
  .view-shell-secondary-header > div { min-width: 0; }
  .view-shell-secondary-header small { display: block; margin-bottom: 4px; color: var(--mem-view-color-text-muted); font-size: var(--mem-view-font-size-xs); font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
  .view-shell-secondary-header h1, .view-shell-secondary-header h2 { overflow: hidden; margin: 0; font-size: var(--mem-view-font-size-xl); line-height: 1.25; letter-spacing: -.02em; text-overflow: ellipsis; white-space: nowrap; }
  .view-shell-secondary-settings { display: grid; width: 36px; height: 36px; flex: 0 0 auto; place-items: center; border: 0; border-radius: var(--mem-view-radius-sm); background: transparent; color: var(--mem-view-color-text-muted); cursor: pointer; }
  .view-shell-secondary-settings:hover { background: var(--mem-view-color-subtle); color: var(--mem-view-color-accent-hover); }
  .view-shell-secondary-settings .view-shell-icon { width: 18px; height: 18px; }
  .view-shell-secondary-items { display: grid; gap: 3px; }
  .view-shell-secondary-item { display: grid; width: 100%; height: 41px; grid-template-columns: 23px minmax(0, 1fr) auto; align-items: center; gap: 7px; border: 0; border-radius: var(--mem-view-radius-sm); background: transparent; padding: 0 10px; color: var(--mem-view-color-text-muted); cursor: pointer; text-align: left; }
  .view-shell-secondary-item:hover { background: var(--mem-view-color-subtle); }
  .view-shell-secondary-item.active { background: var(--mem-view-color-accent-soft); color: var(--mem-view-color-accent-hover); font-weight: 650; }
  .view-shell-secondary-item .view-shell-icon { width: 18px; height: 18px; }
  .view-shell-secondary-badge { display: grid; min-width: 20px; height: 20px; place-items: center; border-radius: var(--mem-view-radius-md); background: color-mix(in srgb, var(--mem-view-color-surface) 72%, transparent); padding: 0 6px; color: var(--mem-view-color-text-muted); font-size: var(--mem-view-font-size-xs); }
  .view-shell-secondary-item.active .view-shell-secondary-badge { background: var(--mem-view-color-accent-soft); color: var(--mem-view-color-accent); }
  .view-shell-secondary-footer { display: flex; align-items: flex-start; gap: 7px; margin-top: auto; border-top: 1px solid var(--mem-view-color-border); padding: 14px 7px 2px; color: var(--mem-view-color-text-muted); font-size: var(--mem-view-font-size-xs); line-height: 1.55; }
  .view-host-list-mount { width: 100%; height: 100%; min-height: 0; overflow-x: hidden; overflow-y: auto; }
  .view-shell-detail-panel { display: flex; flex-direction: column; overflow: hidden; background: var(--mem-view-color-canvas); }
  .view-shell-detail-body { position:relative; display:flex; min-width:0; min-height:0; flex:1; overflow:hidden; }
  .view-shell-header {
    display: flex;
    height: 100px;
    min-height: 100px;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 18px 25px 15px;
    border: 0;
    border-bottom: 1px solid var(--mem-view-color-border);
    background: color-mix(in srgb, var(--mem-view-color-surface) 93%, transparent);
  }
  .view-shell-header [data-view-slot="header.title"] { min-width: 0; flex: 1; }
  .view-shell-header [data-view-slot="header.actions"] { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; border: 0; padding: 9px 0 0; }
  .view-shell-heading { display: block; }
  .view-shell-heading h1 { margin: 0 0 5px; color: var(--mem-view-color-text); font-size: var(--mem-view-font-size-xl); font-weight: 650; line-height: 1.3; letter-spacing: -.025em; }
  .view-shell-heading h1.memory-title, .view-shell-heading h1.run-title { font-size: var(--mem-view-font-size-xl); font-weight: 700; }
  .view-shell-heading p, .view-shell-breadcrumbs { margin: 0 0 4px; color: var(--mem-view-color-text-muted); font-size: var(--mem-view-font-size-xs); }
  .view-shell-breadcrumbs { display:flex; min-width:0; align-items:center; gap:var(--mem-view-space-1); line-height:var(--mem-view-line-compact); }
  .view-shell-breadcrumbs button { min-width:0; overflow:hidden; border:0; background:transparent; padding:0; color:inherit; font:inherit; line-height:inherit; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; }
  .view-shell-breadcrumbs button:hover { color:var(--mem-view-color-accent); text-decoration:underline; text-underline-offset:2px; }
  .view-shell-breadcrumbs button:focus-visible { border-radius:var(--mem-view-radius-sm); outline:2px solid var(--mem-view-color-accent); outline-offset:2px; }
  .view-shell-breadcrumb-separator { flex:0 0 auto; color:var(--mem-view-color-text-muted); opacity:.7; }
  .view-shell-action { display:inline-flex; min-height:34px; align-items:center; justify-content:center; gap:7px; border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-sm); background:var(--mem-view-color-surface); padding:0 12px; color:var(--mem-view-color-text); font-size:var(--mem-view-font-size-sm); font-weight:600; line-height:var(--mem-view-line-compact); cursor:pointer; }
  .view-shell-action .view-shell-icon { width:16px; height:16px; flex:0 0 auto; }
  .view-shell-action:not(:disabled):hover { border-color: var(--mem-view-color-border-strong); background: var(--mem-view-color-subtle); }
  .view-shell-action[data-tone="success"] { min-height:30px; border:0; border-radius:var(--mem-view-radius-pill); background:var(--mem-view-color-accent-soft); padding:0 10px; color:var(--mem-view-color-accent-hover); font-size:var(--mem-view-font-size-xs); font-weight:650; }
  .view-shell-action[data-tone="success"] .view-shell-icon { width:14px; height:14px; }
  .view-shell-action[data-tone="success"] img.view-shell-icon { filter:brightness(0) saturate(100%) invert(34%) sepia(19%) saturate(1391%) hue-rotate(126deg) brightness(91%) contrast(87%); }
  .view-shell-action[data-tone="success"]:not(:disabled):hover { border:0; background:var(--mem-view-color-accent-soft); }
  .view-shell-header [data-view-slot="header.actions"] .view-shell-action:last-child:not(:disabled) { border-color: var(--mem-view-color-accent); background: var(--mem-view-color-accent); color: var(--mem-view-color-on-accent); }
  .view-shell-header [data-view-slot="header.actions"] .view-shell-action:last-child:not(:disabled) img.view-shell-icon { filter:brightness(0) saturate(100%) invert(1); }
  .view-shell-header [data-view-slot="header.actions"] .view-shell-action:last-child:not(:disabled):hover { border-color: var(--mem-view-color-accent-hover); background: var(--mem-view-color-accent-hover); }
  #memsphere-view-root { min-width: 0; min-height: 0; flex: 1; overflow-x: hidden; overflow-y: auto; }
  .view-shell-side-panel { display:flex; width:min(300px, 38vw); min-width:260px; min-height:0; flex:0 0 auto; flex-direction:column; overflow:hidden; border-left:1px solid var(--mem-view-color-border); background:var(--mem-view-color-surface); box-shadow:-8px 0 24px color-mix(in srgb, var(--mem-view-color-text) 5%, transparent); }
  .view-shell-side-panel[hidden] { display:none; }
  .view-shell-side-panel > header { display:flex; min-height:58px; align-items:center; justify-content:space-between; gap:12px; padding:0 var(--mem-view-space-4); border-bottom:1px solid var(--mem-view-color-border); }
  .view-shell-side-panel > header strong { min-width:0; overflow:hidden; font-size:var(--mem-view-font-size-md); text-overflow:ellipsis; white-space:nowrap; }
  .view-shell-side-panel > header button { display:grid; width:34px; height:34px; flex:0 0 auto; place-items:center; border:0; border-radius:var(--mem-view-radius-sm); background:transparent; cursor:pointer; }
  .view-shell-side-panel > header button:hover { background:var(--mem-view-color-subtle); }
  .view-shell-side-panel > header img { width:16px; height:16px; }
  .view-shell-side-panel-slot, .view-host-side-panel-mount { width:100%; min-height:0; flex:1; overflow:auto; }
  #memsphere-view-root.view-host-status { min-height: 0; }
  #memsphere-view-root.view-shell-detail-loading { display: block; padding: 24px 26px; }
  .view-shell-loading-skeleton { display: grid; max-width: 920px; gap: 12px; margin: 0 auto; }
  .view-shell-loading-line, .view-shell-loading-card { display: block; border-radius: var(--mem-view-radius-sm); background: var(--mem-view-color-subtle); animation: view-shell-loading-pulse 1.1s ease-in-out infinite alternate; }
  .view-shell-loading-line { width: 72%; height: 14px; }
  .view-shell-loading-line.title { width: 46%; height: 24px; margin-bottom: 8px; }
  .view-shell-loading-line.short { width: 58%; }
  .view-shell-loading-card { height: 190px; margin-top: 12px; border: 1px solid var(--mem-view-color-border); background: var(--mem-view-color-subtle); }
  @keyframes view-shell-loading-pulse { from { opacity: .54; } to { opacity: .9; } }
  .view-shell-panel-resizer { position: absolute; z-index: 12; top: 0; right: -5px; bottom: 0; width: 10px; cursor: col-resize; touch-action: none; outline: none; }
  .view-shell-panel-resizer::before { content: ""; position: absolute; top: 0; bottom: 0; left: 4px; width: 2px; background: transparent; transition: background-color var(--mem-view-motion-fast); }
  .view-shell-panel-resizer > span { position: absolute; top: 50%; left: 2px; width: 6px; height: 38px; border-radius: var(--mem-view-radius-sm); background: transparent; transform: translateY(-50%); transition: background-color var(--mem-view-motion-fast), box-shadow var(--mem-view-motion-fast); }
  .view-shell-panel-resizer:hover::before, .view-shell-panel-resizer:focus-visible::before, .view-shell[data-view-resizing] .view-shell-panel-resizer::before { background: var(--mem-view-color-accent); }
  .view-shell-panel-resizer:hover > span, .view-shell-panel-resizer:focus-visible > span, .view-shell[data-view-resizing] .view-shell-panel-resizer > span { background: var(--mem-view-color-subtle); box-shadow: inset 0 0 0 1px var(--mem-view-color-border-strong); }
  .view-shell[data-view-resizing] { cursor: col-resize; user-select: none; }
  .view-shell[data-view-layout="home"] .view-shell-workspace { grid-template-columns: minmax(0, 1fr); }
  .view-shell[data-view-layout="home"] .view-shell-secondary-panel, .view-shell[data-view-layout="home"] .view-shell-list-panel { display: none; }
  .view-shell[data-view-layout="home"] .view-shell-detail-panel { grid-column: 1 / -1; }
  .view-shell[data-view-layout="home"] .view-shell-header { background: var(--mem-view-color-canvas); }
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
    border: 1px solid var(--mem-view-color-border);
    border-radius: var(--mem-view-radius-lg);
    background: color-mix(in srgb, var(--mem-view-color-surface) 98%, transparent);
    box-shadow: var(--mem-view-shadow-overlay);
    backdrop-filter: blur(18px);
  }
  .view-shell-search-overlay[hidden] { display: none; }
  .view-shell-search-command { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto 36px; align-items: center; gap: 10px; padding: 13px 20px; border-bottom: 1px solid var(--mem-view-color-border); background: var(--mem-view-color-surface); color: var(--mem-view-color-text-muted); }
  .view-shell-search-command > img { width: 24px; height: 24px; }
  .view-shell-search-command input { min-width: 0; border: 0; outline: 0; background: transparent; color: var(--mem-view-color-text); font-size: var(--mem-view-font-size-xl); }
  .view-shell-search-command input::placeholder { color: var(--mem-view-color-text-muted); }
  .view-shell-search-command kbd { border: 1px solid var(--mem-view-color-border); border-radius: var(--mem-view-radius-sm); background: var(--mem-view-color-subtle); padding: 3px 6px; color: var(--mem-view-color-text-muted); font:var(--mem-view-font-size-xs)/var(--mem-view-line-compact) inherit; }
  .view-shell-search-command button { display: grid; width: 36px; height: 36px; place-items: center; border: 0; border-radius: var(--mem-view-radius-sm); background: transparent; cursor: pointer; }
  .view-shell-search-command button:hover { background: var(--mem-view-color-subtle); }
  .view-shell-search-command button img { width: 22px; height: 22px; }
  .view-shell-search-providers { display: flex; align-items: center; gap: 8px; overflow-x: auto; padding: 8px 20px; border-bottom: 1px solid var(--mem-view-color-border); background: var(--mem-view-color-surface); }
  .view-shell-search-providers button { height: 32px; flex: 0 0 auto; border: 0; border-radius: var(--mem-view-radius-lg); background: var(--mem-view-color-subtle); padding: 0 15px; cursor: pointer; font-size: var(--mem-view-font-size-sm); }
  .view-shell-search-providers button:hover, .view-shell-search-providers button[aria-selected="true"] { background: var(--mem-view-color-accent-soft); color: var(--mem-view-color-accent-hover); font-weight: 650; }
  .view-shell-search-body { position: relative; min-height: 0; overflow: auto; }
  .view-shell-search-empty { display: grid; width: 100%; height: 100%; place-content: center; justify-items: center; color: var(--mem-view-color-text-muted); text-align: center; }
  .view-shell-search-empty[hidden], .view-shell-search-results[hidden] { display: none; }
  .view-shell-search-empty-icon { display: grid; width: 78px; height: 78px; margin-bottom: 17px; place-items: center; border-radius: var(--mem-view-radius-lg); background: var(--mem-view-color-accent-soft); }
  .view-shell-search-empty-icon img { width: 34px; height: 34px; filter: invert(40%) sepia(18%) saturate(1288%) hue-rotate(123deg) brightness(91%) contrast(87%); }
  .view-shell-search-empty h2 { margin: 0 0 7px; font-size: var(--mem-view-font-size-lg); }
  .view-shell-search-empty p { margin: 0; color: var(--mem-view-color-text-muted); font-size: var(--mem-view-font-size-sm); }
  .view-shell-search-results { width: min(760px, calc(100% - 48px)); margin: 24px auto; }
  .view-shell-search-status { position: absolute; top: 0; left: 50%; margin: 8px 0 0; color: var(--mem-view-color-text-muted); font-size: var(--mem-view-font-size-xs); transform: translateX(-50%); }
  .view-shell-search-status:empty { display: none; }
  .view-shell-search-footer { display: flex; align-items: center; justify-content: flex-end; gap: 18px; border-top: 1px solid var(--mem-view-color-border); background: var(--mem-view-color-surface); padding: 0 20px; color: var(--mem-view-color-text-muted); font-size: var(--mem-view-font-size-xs); }
  .view-shell-project-details-overlay { position: fixed; inset: 0; z-index: 130; display: grid; place-items: center; padding: 24px; background: var(--mem-view-color-overlay); }
  .view-shell-project-details-overlay[hidden] { display: none; }
  .view-shell-project-details-card { width: min(560px, 100%); overflow: hidden; border: 1px solid var(--mem-view-color-border); border-radius: var(--mem-view-radius-lg); background: var(--mem-view-color-surface); box-shadow: var(--mem-view-shadow-overlay); }
  .view-shell-project-details-card > header { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 14px; border-bottom: 1px solid var(--mem-view-color-border); }
  .view-shell-project-details-card h2 { margin: 0; font-size: var(--mem-view-font-size-lg); }
  .view-shell-project-details-card header button { display: grid; width: 32px; height: 32px; place-items: center; border: 0; border-radius: var(--mem-view-radius-sm); background: transparent; cursor: pointer; }
  .view-shell-project-details-card header button:hover { background: var(--mem-view-color-subtle); }
  .view-shell-project-details-card header img { width: 18px; height: 18px; }
  .view-shell-project-details-card dl { display: grid; margin: 0; padding: 8px 20px 20px; }
  .view-shell-project-detail-row { display: grid; grid-template-columns: 110px minmax(0,1fr); gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--mem-view-color-subtle); }
  .view-shell-project-detail-row:last-child { border-bottom: 0; }
  .view-shell-project-detail-row dt { color: var(--mem-view-color-text-muted); }
  .view-shell-project-detail-row dd { min-width: 0; margin: 0; color: var(--mem-view-color-text); overflow-wrap: anywhere; }

  @media (max-width: 1240px) and (min-width: 821px) {
    :root { --view-rail-width: 74px; --view-secondary-width: 198px; --view-list-width: 292px; }
  }
  @media (max-width: 820px) {
    :root { --view-rail-width: 72px; --view-secondary-width: 112px; --view-list-width: 28vh; }
    .view-shell {
      display: block;
      width: 100%;
      height: 100dvh;
      min-height: 0;
      overflow: hidden;
      padding-bottom: var(--view-rail-width);
    }
    .view-shell-sidebar {
      position: fixed;
      inset: auto 0 0;
      z-index: 24;
      display: flex;
      width: 100%;
      min-width: 0;
      height: var(--view-rail-width);
      min-height: var(--view-rail-width);
      flex-direction: row;
      align-items: center;
      gap: 4px;
      overflow: visible;
      padding: 7px 8px;
      border: 0;
      border-top: 1px solid var(--mem-view-color-border);
    }
    .view-shell-project-select-wrap { display: block; width: 48px; height: 48px; flex: 0 0 48px; }
    .view-shell-project-mark { width: 42px; height: 42px; }
    .view-shell-project-trigger { right: 0; bottom: 0; }
    .view-shell-project-icon { width: 20px; height: 20px; }
    .view-shell-project-caret { display: block; }
    .view-shell-project-menu { inset: auto auto 56px 0; width: min(304px, calc(100vw - 16px)); }
    .view-shell-search-trigger { width: 44px; height: 44px; flex: 0 0 44px; margin: 0; }
    .view-shell-rail-divider, .view-shell-rail-spacer, .view-shell-add-module, .view-shell-account-slot { display: none; }
    .view-shell-sidebar [data-view-slot="navigation.primary"] { display: grid; width: auto; height: 56px; min-width: 0; flex: 1; grid-template-columns: repeat(auto-fit, minmax(52px, 1fr)); gap: 3px; overflow-x: auto; }
    .view-shell-navigation-item { width: auto; height: 56px; min-height: 56px; gap: 2px; padding: 3px 2px; }
    .view-shell-module-icon { width: 30px; height: 30px; }
    .view-shell-navigation-item .view-shell-icon { width: 19px; height: 19px; }
    .view-shell-footer { width: 54px; flex: 0 0 54px; }
    .view-shell-footer .view-shell-settings { width: 54px; height: 48px; min-height: 48px; }
    .view-shell-workspace {
      grid-column: auto;
      width: 100%;
      height: calc(100dvh - var(--view-rail-width));
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: 112px minmax(260px, 36vh) minmax(0, 1fr);
    }
    .view-shell-secondary-panel { border-right: 0; border-bottom: 1px solid var(--mem-view-color-border); overflow: hidden; }
    .view-shell-list-panel { border-right: 0; border-bottom: 1px solid var(--mem-view-color-border); overflow: hidden; }
    .view-shell-detail-panel { min-height: 0; }
    .view-shell-side-panel { position:absolute; z-index:20; inset:0 0 0 auto; width:min(360px, 92vw); min-width:0; box-shadow:var(--mem-view-shadow-overlay); }
    .view-shell-panel-resizer { display: none; }
    .view-shell-secondary-navigation { flex-direction: row; align-items: center; gap: 10px; padding: 10px 12px; }
    .view-shell-secondary-header { width: 124px; flex: 0 0 124px; padding: 0; }
    .view-shell-secondary-header small { margin-bottom: 2px; }
    .view-shell-secondary-header h1, .view-shell-secondary-header h2 { font-size: var(--mem-view-font-size-md); }
    .view-shell-secondary-settings, .view-shell-secondary-footer { display: none; }
    .view-shell-secondary-items { display: flex; min-width: 0; flex: 1; gap: 4px; overflow-x: auto; }
    .view-shell-secondary-item { width: auto; min-width: max-content; padding: 0 12px; }
    .view-shell[data-view-layout="home"] .view-shell-workspace { grid-template-rows: minmax(0, 1fr); }
    .view-shell[data-view-layout="module"][data-view-content-list="false"] .view-shell-workspace { grid-template-columns: minmax(0, 1fr); grid-template-rows: 112px minmax(0, 1fr); }
    .view-shell-header { height: 84px; min-height: 84px; padding: 14px 16px 11px; }
    .view-shell-heading h1 { font-size: var(--mem-view-font-size-xl); }
    .view-shell-heading p, .view-shell-breadcrumbs { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .view-shell-header [data-view-slot="header.actions"] { padding-right: 0; }
    body:has(.view-overlay-layer) .view-shell { width: 100%; }
    body:has(.view-overlay-layer) .view-shell-workspace { grid-template-columns: minmax(0, 1fr); }
    body:has(.view-overlay-layer) .view-shell-secondary-panel,
    body:has(.view-overlay-layer) .view-shell-list-panel { display: none; }
  }
  @media (max-width: 480px) {
    .view-shell-header .view-shell-action { width:36px; padding:0; }
    .view-shell-header .view-shell-action-label { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
    .view-shell-heading p, .view-shell-breadcrumbs { display:none; }
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
