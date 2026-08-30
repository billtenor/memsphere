export interface ViewShellMarkupOptions {
  readonly loading: string;
}

/**
 * Stable DOM owned by ViewHost. Module Mounts receive only the main content node;
 * they never replace the Shell or depend on its private class names.
 */
export function renderViewShellMarkup(options: ViewShellMarkupOptions): string {
  return `<div class="view-shell" data-view-shell>
    <aside class="view-shell-sidebar" aria-label="Primary navigation">
      <div class="view-shell-brand"><strong>memsphere</strong></div>
      <label class="view-shell-project-label" for="view-shell-project-select"></label>
      <select class="view-shell-project-select" id="view-shell-project-select" disabled></select>
      <nav data-view-slot="navigation.primary"></nav>
      <div class="view-shell-footer" data-view-slot="sidebar.footer">
        <button class="view-shell-settings" type="button" data-view-core-settings></button>
        <div class="view-shell-service-status" data-view-core-status></div>
      </div>
    </aside>
    <section class="view-shell-workspace">
      <header class="view-shell-header">
        <div data-view-slot="header.title"></div>
        <div data-view-slot="header.actions"></div>
        <div data-view-slot="header.account"></div>
      </header>
      <main id="memsphere-view-root" class="view-host-status" aria-live="polite">${escapeHtml(options.loading)}</main>
    </section>
    <div data-view-slot="overlay"></div>
  </div>`;
}

export const viewShellStyles = `
  .view-shell { display: grid; grid-template-columns: 248px minmax(0, 1fr); min-height: 100vh; }
  .view-shell-sidebar { position: sticky; top: 0; min-width: 0; height: 100vh; box-sizing: border-box; overflow-y: auto; padding: 18px 14px; border-right: 1px solid #d9ded8; background: #fbfbf8; }
  .view-shell-brand { margin: 0 8px 16px; font-size: 18px; }
  .view-shell-project-label { display: block; margin: 0 8px 5px; color: #6c7379; font-size: 11px; }
  .view-shell-project-select { width: calc(100% - 16px); min-height: 34px; margin: 0 8px 16px; border: 1px solid #d9ded8; border-radius: 6px; background: #fff; padding: 5px 8px; color: #222629; }
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
  .view-shell-service-status { margin: 9px 10px 0; color: #6c7379; font-size: 11px; }
  .view-shell-service-status::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 7px; border-radius: 50%; background: #37a45a; }
  .view-host-module-error { margin: 24px; border: 1px solid #e8c7bd; border-left: 4px solid #a14436; border-radius: 8px; background: #fffdfb; padding: 18px; }
  .view-host-module-error h2 { margin: 0 0 8px; color: #a14436; font-size: 18px; }
  .view-host-module-error p { color: #6c7379; white-space: pre-wrap; overflow-wrap: anywhere; }
  .view-host-module-error button { border: 1px solid #d9ded8; border-radius: 6px; background: #fff; padding: 7px 10px; }
  #memsphere-view-root { min-width: 0; }
  @media (max-width: 760px) {
    .view-shell { grid-template-columns: 1fr; }
    .view-shell-sidebar { position: static; height: auto; overflow: visible; border-right: 0; border-bottom: 1px solid #d9ded8; }
    .view-shell-sidebar [data-view-slot="navigation.primary"] { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
    .view-shell-header { padding: 14px 16px; }
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
