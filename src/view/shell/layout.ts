export interface ViewShellMarkupOptions {
  readonly loading: string;
  readonly initial?: {
    readonly pathname: string;
    readonly projectName: string;
    readonly homeLabel: string;
    readonly memoryLabel: string;
    readonly runLabel: string;
    readonly settingsLabel: string;
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
  const footer = initial ? `<a class="view-shell-settings" href="/settings/overview">${escapeHtml(initial.settingsLabel)}</a>
        <div class="view-shell-service-status">${escapeHtml(initial.healthyLabel)}</div>` : "";
  const header = initial?.pathname === "/" ? `<div class="view-shell-heading"><h1>${escapeHtml(initial.homeLabel)}</h1><p>${escapeHtml(initial.projectName)}</p></div>` : "";
  const account = initial ? `<div class="view-shell-account" aria-label="${escapeHtml(initial.accountLabel)}"><span class="view-shell-account-avatar">${escapeHtml(initial.accountLabel)}</span></div>` : "";
  const main = initial?.pathname === "/" ? renderInitialHome(initial) : escapeHtml(options.loading);
  return `<div class="view-shell" data-view-shell>
    <aside class="view-shell-sidebar" aria-label="Primary navigation">
      <div class="view-shell-brand"><img src="/assets/system-icons/cube-duotone.svg" alt="" aria-hidden="true" /><strong>Memsphere</strong></div>
      <label class="view-shell-project-label" id="view-shell-project-label" for="view-shell-project-trigger"></label>
      <div class="view-shell-project-select-wrap">
        <button class="view-shell-project-trigger" id="view-shell-project-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" disabled>
          <img class="view-shell-project-icon" src="/assets/system-icons/stack-fill.svg" alt="" aria-hidden="true" />
          <span class="view-shell-project-value">${escapeHtml(initial?.projectName ?? "")}</span>
          <img class="view-shell-project-caret" src="/assets/system-icons/caret-down.svg" alt="" aria-hidden="true" />
        </button>
        <div class="view-shell-project-menu" id="view-shell-project-menu" role="listbox" aria-labelledby="view-shell-project-label" hidden></div>
      </div>
      <nav data-view-slot="navigation.primary">${navigation}</nav>
      <div class="view-shell-footer" data-view-slot="sidebar.footer">${footer}</div>
    </aside>
    <section class="view-shell-workspace">
      <header class="view-shell-header">
        <div data-view-slot="header.title">${header}</div>
        <div data-view-slot="header.actions"></div>
        <div data-view-slot="header.account">${account}</div>
      </header>
      <main id="memsphere-view-root" class="${initial?.pathname === "/" ? "" : "view-host-status"}" aria-live="polite">${main}</main>
    </section>
    <div class="view-shell-page-portals" data-view-page-portals></div>
    <div data-view-slot="overlay"></div>
  </div>`;
}

function renderInitialNavigation(initial: NonNullable<ViewShellMarkupOptions["initial"]>): string {
  return initial.navigation.map(item => {
    const active = item.href === "/" ? initial.pathname === "/" : initial.pathname.startsWith(item.href);
    return `<a class="view-shell-navigation-item${active ? " active" : ""}" href="${escapeHtml(item.href)}" aria-current="${active ? "page" : "false"}">
      <img class="view-shell-icon" src="/assets/system-icons/${initialIconName(item.icon)}${active ? "-fill" : ""}.svg" alt="" aria-hidden="true" />
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
  .view-shell-settings { width: 100%; min-height: 36px; box-sizing: border-box; border: 0; border-radius: 6px; padding: 8px 10px; background: transparent; color: #222629; text-align: left; }
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
  .view-home-icon-tile[data-tone="blue"] { background: #eef3fb; }
  .view-home-icon-tile[data-tone="blue"] img { filter: invert(38%) sepia(35%) saturate(1673%) hue-rotate(178deg) brightness(88%) contrast(91%); }
  .view-home-icon-tile[data-tone="orange"] { background: #fbf0e6; }
  .view-home-icon-tile[data-tone="orange"] img { filter: invert(47%) sepia(89%) saturate(1020%) hue-rotate(352deg) brightness(91%) contrast(91%); }
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
  .view-home-module-card[data-icon="play-circle"] .view-home-module-icon-tile { background: #eef3fb; }
  .view-home-module-card[data-icon="play-circle"] .view-home-module-icon { filter: invert(38%) sepia(35%) saturate(1673%) hue-rotate(178deg) brightness(88%) contrast(91%); }
  .view-home-module-card[data-icon="gear-six"] .view-home-module-icon-tile { background: #fbf0e6; }
  .view-home-module-card[data-icon="gear-six"] .view-home-module-icon { filter: invert(47%) sepia(89%) saturate(1020%) hue-rotate(352deg) brightness(91%) contrast(91%); }
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
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
