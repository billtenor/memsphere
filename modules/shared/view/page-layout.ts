/** Internal default layout used by the official page.presentation implementations. */
export function createPageLayout(className: string): HTMLElement {
  const main = document.createElement("main");
  main.className = className;
  main.dataset.memPageLayout = "";
  return main;
}

/** Public style hooks, shared through styles.global without adding a renderer Slot. */
export const pageLayoutStyles = `
  :where([data-mem-page-layout]) {
    --mem-page-layout-inset:var(--mem-view-layout-page-padding,24px);
    box-sizing:border-box;
    width:100%;
    min-width:0;
    max-width:none;
    margin:0;
    overflow-wrap:anywhere;
    padding:var(--mem-page-layout-inset) var(--mem-page-layout-inset) calc(2 * var(--mem-view-space-5,24px));
    container:mem-page-layout / inline-size;
  }
  :where([data-mem-page-layout]) :where([data-mem-page-layout-edge]) {
    margin-inline-end:calc(-1 * var(--mem-page-layout-inset));
  }
  @container mem-page-layout (max-width:560px) {
    :where([data-mem-page-layout-edge]) { margin-inline-end:0; }
  }
  @media(max-width:820px) {
    :where([data-mem-page-layout]) {
      --mem-page-layout-inset:var(--mem-view-space-3,12px);
      padding-block:var(--mem-view-space-4,16px) calc(3 * var(--mem-view-space-3,12px));
    }
    :where([data-mem-page-layout]) :where([data-mem-page-layout-edge]) { margin-inline-end:0; }
  }
`;
