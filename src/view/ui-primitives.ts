import {
  isContentListDescriptor,
  type ActionDescriptor,
  type ContentListDescriptor,
  type ContentListEmptyDescriptor,
  type ContentListProvider,
  type ConfirmationDescriptor,
  type IconRef,
  type RouteTarget,
  type TextRef,
  type ViewMount,
  type ViewRenderContext,
  type ViewUi
} from "./view-sdk.js";
import { normalizeSystemIconName } from "./system-icon.js";

type UiNavigation = (target: RouteTarget) => Promise<void>;

export function createViewUi(navigate: UiNavigation): ViewUi {
  const ui: ViewUi = {
    version: 1 as const,
    contentList(source: ContentListDescriptor | ContentListProvider): ViewMount {
      if (typeof source !== "function") assertContentListDescriptor(source);
      let target: HTMLElement | undefined;
      let current: ViewRenderContext | undefined;
      let epoch = 0;

      const render = async (context: ViewRenderContext) => {
        current = context;
        const renderEpoch = ++epoch;
        const descriptor = typeof source === "function" ? await source(context) : source;
        assertContentListDescriptor(descriptor);
        if (!target || renderEpoch !== epoch) return;
        const existing = target.firstElementChild instanceof HTMLElement
          && target.firstElementChild.classList.contains("mem-view-content-list")
          ? target.firstElementChild
          : undefined;
        const rendered = renderContentList(descriptor, navigate, async () => {
          if (current) await render(current);
        }, existing);
        if (!existing) target.replaceChildren(rendered);
      };

      const mount: ViewMount = {
        async mount({ element }, context) {
          target = element;
          element.classList.add("mem-view-content-list-root");
          await render(context);
          return () => {
            epoch += 1;
            target = undefined;
            current = undefined;
            element.classList.remove("mem-view-content-list-root");
            element.replaceChildren();
          };
        },
        async update(context) {
          await render(context);
        }
      };
      return Object.freeze(mount);
    },
    button(action, options) {
      return createPrimitiveButton(action, options?.tone ?? "default");
    },
    confirmButton(action, confirmation, options) {
      let button: HTMLButtonElement;
      button = createPrimitiveButton({
        ...action,
        run: () => openConfirmation(button, action, confirmation)
      }, options?.tone ?? "default");
      return button;
    },
    iconButton(action) {
      const button = createPrimitiveButton(action, "icon");
      button.setAttribute("aria-label", textValue(action.label));
      return button;
    },
    badge(label) {
      return createPrimitiveBadge(label);
    },
    emptyState(empty) {
      return createPrimitiveEmptyState(empty);
    }
  };
  return Object.freeze(ui);
}

export function createPrimitiveButton(
  action: ActionDescriptor,
  tone: "default" | "primary" | "danger" | "icon" = "default",
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mem-view-button";
  button.dataset.tone = tone;
  button.disabled = action.disabled === true;
  button.setAttribute("aria-label", textValue(action.label));
  if (action.icon) button.append(renderPrimitiveIcon(action.icon));
  if (tone !== "icon") {
    const label = document.createElement("span");
    label.textContent = textValue(action.label);
    button.append(label);
  }
  bindButtonAction(button, action);
  return button;
}

function openConfirmation(
  trigger: HTMLButtonElement,
  action: ActionDescriptor,
  confirmation: ConfirmationDescriptor,
): Promise<void> {
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.className = "mem-view-confirm";
    dialog.setAttribute("aria-label", textValue(confirmation.title));
    const surface = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = textValue(confirmation.title);
    surface.append(heading);
    if (confirmation.description) {
      const description = document.createElement("p");
      description.textContent = textValue(confirmation.description);
      surface.append(description);
    }
    const status = document.createElement("p");
    status.className = "mem-view-confirm-status";
    status.setAttribute("role", "alert");
    const footer = document.createElement("footer");
    const cancel = createPrimitiveButton({ label: confirmation.cancelLabel, run: () => close() });
    const confirm = createPrimitiveButton({
      label: confirmation.confirmLabel,
      ...(action.icon ? { icon: action.icon } : {}),
      async run() {
        status.textContent = "";
        try {
          await action.run();
          close();
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : String(error);
          throw error;
        }
      }
    }, confirmation.tone ?? "primary");
    footer.append(cancel, confirm);
    surface.append(status, footer);
    dialog.append(surface);
    const close = () => {
      dialog.close();
      dialog.remove();
      resolve();
      queueMicrotask(() => trigger.focus());
    };
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    (trigger.closest("[data-view-theme-root]") ?? document.body).append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

export function createPrimitiveBadge(label: TextRef): HTMLElement {
  const badge = document.createElement("span");
  badge.className = "mem-view-badge";
  badge.textContent = textValue(label);
  return badge;
}

export function createPrimitiveEmptyState(empty: ContentListEmptyDescriptor): HTMLElement {
  const container = document.createElement("div");
  container.className = "mem-view-empty-state";
  const title = document.createElement("strong");
  title.textContent = textValue(empty.title);
  container.append(title);
  if (empty.description) {
    const description = document.createElement("p");
    description.textContent = textValue(empty.description);
    container.append(description);
  }
  return container;
}

export function renderPrimitiveIcon(icon: IconRef): HTMLImageElement {
  const image = document.createElement("img");
  image.className = "mem-view-icon";
  if (icon.kind === "asset") {
    image.src = icon.url;
    image.alt = textValue(icon.alt);
  } else {
    image.src = `/assets/system-icons/${normalizeSystemIconName(icon.name)}.svg`;
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
  }
  return image;
}

function renderContentList(
  descriptor: ContentListDescriptor,
  navigate: UiNavigation,
  rerender: () => Promise<void>,
  existing?: HTMLElement,
): HTMLElement {
  const container = existing ?? document.createElement("section");
  if (!existing) container.className = "mem-view-content-list";
  container.setAttribute("aria-label", textValue(descriptor.label));

  if (descriptor.header) {
    const header = container.querySelector<HTMLElement>(":scope > .mem-view-list-header") ?? document.createElement("header");
    header.className = "mem-view-list-header";
    const copy = document.createElement("div");
    const eyebrow = document.createElement("small");
    eyebrow.textContent = textValue(descriptor.header.eyebrow);
    const title = document.createElement("strong");
    title.textContent = textValue(descriptor.header.title);
    copy.append(eyebrow, title);
    header.replaceChildren(copy);
    if (descriptor.header.action) header.append(createPrimitiveButton(descriptor.header.action, "icon"));
    if (container.firstElementChild !== header) container.prepend(header);
  } else {
    container.querySelector(":scope > .mem-view-list-header")?.remove();
  }

  if (descriptor.filter) {
    const filter = container.querySelector<HTMLElement>(":scope > .mem-view-list-filter") ?? document.createElement("label");
    filter.className = "mem-view-list-filter";
    const label = filter.querySelector<HTMLElement>(":scope > span") ?? document.createElement("span");
    label.textContent = textValue(descriptor.filter.label);
    const input = filter.querySelector<HTMLInputElement>(":scope > input") ?? document.createElement("input");
    input.type = "search";
    if (document.activeElement !== input) input.value = descriptor.filter.value ?? "";
    input.placeholder = descriptor.filter.placeholder ? textValue(descriptor.filter.placeholder) : "";
    input.oninput = async () => {
      await descriptor.filter!.onInput(input.value);
      await rerender();
    };
    if (!label.isConnected || !input.isConnected) filter.replaceChildren(label, input);
    const header = container.querySelector<HTMLElement>(":scope > .mem-view-list-header");
    if (header && header.nextElementSibling !== filter) header.after(filter);
    else if (filter.parentElement !== container) container.prepend(filter);
  } else {
    container.querySelector(":scope > .mem-view-list-filter")?.remove();
  }

  const content = container.querySelector<HTMLElement>(":scope > .mem-view-list-content") ?? document.createElement("div");
  content.className = "mem-view-list-content";
  content.replaceChildren();
  container.append(content);

  if (descriptor.state === "loading") {
    const loading = document.createElement("div");
    loading.className = "mem-view-list-loading";
    loading.setAttribute("role", "status");
    loading.setAttribute("aria-label", textValue(descriptor.label));
    for (let index = 0; index < 4; index += 1) loading.append(document.createElement("span"));
    content.append(loading);
    return container;
  }

  const itemCount = descriptor.sections.reduce((count, section) => count + section.items.length, 0);
  if (itemCount === 0) {
    content.append(createPrimitiveEmptyState(descriptor.empty));
    return container;
  }

  for (const section of descriptor.sections) {
    const group = document.createElement("section");
    group.className = "mem-view-list-section";
    if (section.label) {
      const heading = document.createElement("h2");
      heading.textContent = textValue(section.label);
      group.append(heading);
    }
    const list = document.createElement("div");
    list.className = "mem-view-list-items";
    for (const item of section.items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mem-view-list-item";
      button.dataset.itemId = item.id;
      if (item.selected) {
        button.classList.add("active");
        button.setAttribute("aria-current", "page");
      }
      if (item.icon) button.append(renderPrimitiveIcon(item.icon));
      const copy = document.createElement("span");
      copy.className = "mem-view-list-item-copy";
      const title = document.createElement("strong");
      title.textContent = textValue(item.title);
      copy.append(title);
      if (item.meta) {
        const meta = document.createElement("small");
        meta.textContent = textValue(item.meta);
        copy.append(meta);
      }
      button.append(copy);
      if (item.badge) button.append(createPrimitiveBadge(item.badge));
      bindButtonAction(button, item.action ?? {
        label: item.title,
        run: () => navigate(item.route!)
      });
      list.append(button);
    }
    group.append(list);
    content.append(group);
  }
  return container;
}

function bindButtonAction(button: HTMLButtonElement, action: ActionDescriptor): void {
  button.disabled = action.disabled === true;
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.removeAttribute("data-view-action-error");
    button.removeAttribute("title");
    try {
      await action.run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      button.dataset.viewActionError = message;
      button.title = message;
    } finally {
      button.removeAttribute("aria-busy");
      button.disabled = action.disabled === true;
    }
  });
}

function assertContentListDescriptor(value: unknown): asserts value is ContentListDescriptor {
  if (!isContentListDescriptor(value)) throw new TypeError("View UI content list descriptor is invalid");
}

function textValue(value: TextRef): string {
  if ("text" in value) return value.text;
  return value.key.replace(/\{([A-Za-z0-9_]+)\}/g, (_, name: string) => String(value.params?.[name] ?? `{${name}}`));
}

export const viewUiStyles = `
  .mem-view-button { display:inline-flex; min-height:34px; align-items:center; justify-content:center; gap:7px; border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-sm); background:var(--mem-view-color-surface); padding:0 var(--mem-view-space-3); color:var(--mem-view-color-text); font:600 var(--mem-view-font-size-sm)/var(--mem-view-line-compact) var(--mem-view-font-sans); cursor:pointer; }
  .mem-view-button:hover:not(:disabled) { border-color:var(--mem-view-color-accent); background:var(--mem-view-color-subtle); }
  .mem-view-button[data-tone="primary"] { border-color:var(--mem-view-color-accent); background:var(--mem-view-color-accent); color:var(--mem-view-color-on-accent); }
  .mem-view-button[data-tone="primary"]:hover:not(:disabled) { border-color:var(--mem-view-color-accent-hover); background:var(--mem-view-color-accent-hover); color:var(--mem-view-color-on-accent); }
  .mem-view-button[data-tone="primary"] .mem-view-icon { filter:brightness(0) saturate(100%) invert(1); }
  .mem-view-button[data-tone="danger"] { border-color:var(--mem-view-color-danger); background:var(--mem-view-color-danger); color:var(--mem-view-color-on-accent); }
  .mem-view-button[data-tone="danger"]:hover:not(:disabled) { border-color:color-mix(in srgb,var(--mem-view-color-danger) 86%,var(--mem-view-color-text)); background:color-mix(in srgb,var(--mem-view-color-danger) 86%,var(--mem-view-color-text)); color:var(--mem-view-color-on-accent); }
  .mem-view-button[data-tone="danger"] .mem-view-icon { filter:brightness(0) saturate(100%) invert(1); }
  .mem-view-button[data-tone="icon"] { width:34px; padding:0; }
  .mem-view-button:disabled { border-color:color-mix(in srgb,var(--mem-view-color-border) 58%,transparent); background:color-mix(in srgb,var(--mem-view-color-subtle) 58%,var(--mem-view-color-surface)); color:color-mix(in srgb,var(--mem-view-color-text-muted) 58%,transparent); cursor:not-allowed; box-shadow:none; opacity:.68; }
  .mem-view-button:disabled .mem-view-icon { filter:none; opacity:.42; }
  .mem-view-button:focus-visible, .mem-view-list-item:focus-visible, .mem-view-list-filter input:focus-visible { outline:2px solid var(--mem-view-color-accent); outline-offset:2px; box-shadow:0 0 0 3px var(--mem-view-color-focus-ring); }
  .mem-view-button[aria-busy="true"] { cursor:wait; opacity:.7; }
  .mem-view-button[data-view-action-error] { border-color:var(--mem-view-color-danger); color:var(--mem-view-color-danger); }
  .mem-view-icon { width:18px; height:18px; flex:0 0 auto; object-fit:contain; }
  .mem-view-badge { display:inline-grid; min-width:20px; min-height:20px; place-items:center; border-radius:var(--mem-view-radius-pill); background:var(--mem-view-color-accent-soft); padding:0 var(--mem-view-space-2); color:var(--mem-view-color-accent-hover); font:600 var(--mem-view-font-size-sm)/var(--mem-view-line-compact) var(--mem-view-font-sans); }
  .mem-view-content-list-root { width:100%; height:100%; min-height:0; overflow:hidden; }
  .mem-view-content-list { width:100%; height:100%; overflow:auto; background:var(--mem-view-color-surface); color:var(--mem-view-color-text); font:var(--mem-view-font-size-base)/var(--mem-view-line-body) var(--mem-view-font-sans); }
  .mem-view-list-header { display:flex; min-height:104px; align-items:center; justify-content:space-between; gap:var(--mem-view-space-3); padding:var(--mem-view-space-4); border-bottom:1px solid var(--mem-view-color-border); background:var(--mem-view-color-surface); }
  .mem-view-list-header > div { display:grid; min-width:0; gap:var(--mem-view-space-1); }
  .mem-view-list-header small { overflow:hidden; color:var(--mem-view-color-text-muted); font-size:var(--mem-view-font-size-sm); text-overflow:ellipsis; white-space:nowrap; }
  .mem-view-list-header strong { overflow:hidden; font-size:var(--mem-view-font-size-xl); line-height:var(--mem-view-line-heading); text-overflow:ellipsis; white-space:nowrap; }
  .mem-view-list-filter { position:sticky; z-index:2; top:0; display:block; padding:var(--mem-view-space-3); border-bottom:1px solid var(--mem-view-color-border); background:var(--mem-view-color-surface); }
  .mem-view-list-filter > span { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
  .mem-view-list-filter input { width:100%; height:36px; border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-md); background:var(--mem-view-color-subtle); padding:0 var(--mem-view-space-3); color:var(--mem-view-color-text); font:inherit; outline:0; }
  .mem-view-list-section > h2 { margin:0; padding:var(--mem-view-space-3) var(--mem-view-space-4) var(--mem-view-space-2); color:var(--mem-view-color-text-muted); font-size:var(--mem-view-font-size-sm); text-transform:uppercase; letter-spacing:.06em; }
  .mem-view-list-items { display:grid; }
  .mem-view-list-item { display:grid; width:100%; min-height:66px; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:var(--mem-view-space-3); border:0; border-bottom:1px solid var(--mem-view-color-border); background:transparent; padding:var(--mem-view-space-3) var(--mem-view-space-4); color:inherit; font:inherit; text-align:left; cursor:pointer; }
  .mem-view-list-item:hover { background:var(--mem-view-color-subtle); }
  .mem-view-list-item.active { background:var(--mem-view-color-accent-soft); }
  .mem-view-list-item-copy { display:grid; min-width:0; gap:2px; }
  .mem-view-list-item-copy strong, .mem-view-list-item-copy small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .mem-view-list-item-copy small { color:var(--mem-view-color-text-muted); font-size:var(--mem-view-font-size-sm); }
  .mem-view-empty-state { display:grid; min-height:220px; place-content:center; justify-items:center; padding:var(--mem-view-space-5); color:var(--mem-view-color-text-muted); text-align:center; }
  .mem-view-empty-state strong { color:var(--mem-view-color-text); font-size:var(--mem-view-font-size-lg); }
  .mem-view-empty-state p { max-width:30ch; margin:var(--mem-view-space-2) 0 0; }
  .mem-view-confirm { width:min(440px,calc(100vw - 32px)); max-width:none; border:0; border-radius:var(--mem-view-radius-lg); background:transparent; padding:0; color:var(--mem-view-color-text); box-shadow:var(--mem-view-shadow-overlay); }
  .mem-view-confirm::backdrop { background:var(--mem-view-color-overlay); }
  .mem-view-confirm > section { display:grid; gap:var(--mem-view-space-3); border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-lg); background:var(--mem-view-color-surface); padding:var(--mem-view-space-5); }
  .mem-view-confirm h2 { margin:0; font-size:var(--mem-view-font-size-lg); line-height:var(--mem-view-line-heading); }
  .mem-view-confirm p { margin:0; color:var(--mem-view-color-text-muted); }
  .mem-view-confirm-status:empty { display:none; }
  .mem-view-confirm-status:not(:empty) { color:var(--mem-view-color-danger); }
  .mem-view-confirm footer { display:flex; justify-content:flex-end; gap:var(--mem-view-space-2); padding-top:var(--mem-view-space-2); }
  .mem-view-list-loading { display:grid; gap:var(--mem-view-space-3); padding:var(--mem-view-space-4); }
  .mem-view-list-loading span { height:58px; border-radius:var(--mem-view-radius-md); background:var(--mem-view-color-subtle); animation:mem-view-pulse 1.1s ease-in-out infinite alternate; }
  @keyframes mem-view-pulse { from { opacity:.55; } to { opacity:1; } }
  @media (prefers-reduced-motion:reduce) { .mem-view-list-loading span { animation:none; } }
`;
