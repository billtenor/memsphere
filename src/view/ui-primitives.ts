import {
  isActionDescriptor,
  isBadgeDescriptor,
  isCheckboxFieldDescriptor,
  isComboboxDescriptor,
  isConfirmationDescriptor,
  isContainerDescriptor,
  isContentListDescriptor,
  isContentListEmptyDescriptor,
  isDisclosureDescriptor,
  isFeedbackDescriptor,
  isIconRef,
  isProgressDescriptor,
  isSegmentedControlDescriptor,
  isSelectDescriptor,
  isTabsDescriptor,
  isTextFieldDescriptor,
  isTextRef,
  type ActionDescriptor,
  type BadgeDescriptor,
  type CheckboxFieldDescriptor,
  type ComboboxDescriptor,
  type ComboboxHandle,
  type ContentListDescriptor,
  type ContentListEmptyDescriptor,
  type ContentListProvider,
  type ContainerDescriptor,
  type ConfirmationDescriptor,
  type DisclosureDescriptor,
  type FeedbackDescriptor,
  type FieldDescriptor,
  type FieldHandle,
  type IconRef,
  type ProgressDescriptor,
  type RouteTarget,
  type SegmentedControlDescriptor,
  type SelectDescriptor,
  type TabsDescriptor,
  type TextRef,
  type TextFieldDescriptor,
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
        const rendered = await renderContentList(descriptor, navigate, async () => {
          if (current) await render(current);
        }, context, existing);
        if (!existing) target.replaceChildren(rendered);
      };

      const mount: ViewMount = {
        async mount({ element }, context) {
          target = element;
          element.classList.add("mem-view-content-list-root");
          await render(context);
          return async () => {
            epoch += 1;
            target = undefined;
            current = undefined;
            const content = element.querySelector<HTMLElement>(".mem-view-list-content");
            if (content) {
              await Promise.all((contentListDisposers.get(content) ?? []).map(dispose => dispose()));
              contentListDisposers.delete(content);
            }
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
      assertDescriptor(action, isActionDescriptor, "ActionDescriptor");
      return createPrimitiveButton(action, options?.tone ?? "default");
    },
    confirmButton(action, confirmation, options) {
      assertDescriptor(action, isActionDescriptor, "ActionDescriptor");
      assertDescriptor(confirmation, isConfirmationDescriptor, "ConfirmationDescriptor");
      let button: HTMLButtonElement;
      button = createPrimitiveButton({
        ...action,
        async run() { await openConfirmation(button, action, confirmation); }
      }, options?.tone ?? "default");
      return button;
    },
    iconButton(action) {
      assertDescriptor(action, isActionDescriptor, "ActionDescriptor");
      const button = createPrimitiveButton(action, "icon");
      button.setAttribute("aria-label", textValue(action.label));
      return button;
    },
    badge(label) {
      if (!isTextRef(label) && !isBadgeDescriptor(label)) throw new TypeError("Invalid BadgeDescriptor");
      return createPrimitiveBadge(label);
    },
    emptyState(empty) {
      assertDescriptor(empty, isContentListEmptyDescriptor, "ContentListEmptyDescriptor");
      return createPrimitiveEmptyState(empty);
    },
    feedback(descriptor) {
      assertDescriptor(descriptor, isFeedbackDescriptor, "FeedbackDescriptor");
      return createPrimitiveFeedback(descriptor);
    },
    tabs(descriptor) {
      assertDescriptor(descriptor, isTabsDescriptor, "TabsDescriptor");
      return createPrimitiveTabs(descriptor, navigate);
    },
    segmentedControl(descriptor) {
      assertDescriptor(descriptor, isSegmentedControlDescriptor, "SegmentedControlDescriptor");
      return createPrimitiveSegmentedControl(descriptor);
    },
    disclosure(descriptor) {
      assertDescriptor(descriptor, isDisclosureDescriptor, "DisclosureDescriptor");
      return createDisclosureMount(descriptor);
    },
    textField(descriptor) {
      assertDescriptor(descriptor, isTextFieldDescriptor, "TextFieldDescriptor");
      return createTextField(descriptor, "text");
    },
    searchField(descriptor) {
      assertDescriptor(descriptor, isTextFieldDescriptor, "TextFieldDescriptor");
      return createTextField(descriptor, "search");
    },
    textareaField(descriptor) {
      assertDescriptor(descriptor, isTextFieldDescriptor, "TextFieldDescriptor");
      return createTextareaField(descriptor);
    },
    checkboxField(descriptor) {
      assertDescriptor(descriptor, isCheckboxFieldDescriptor, "CheckboxFieldDescriptor");
      return createCheckboxField(descriptor);
    },
    select(descriptor) {
      assertDescriptor(descriptor, isSelectDescriptor, "SelectDescriptor");
      return createSelectField(descriptor);
    },
    combobox(descriptor) {
      assertDescriptor(descriptor, isComboboxDescriptor, "ComboboxDescriptor");
      return createComboboxMount(descriptor);
    },
    progress(descriptor) {
      assertDescriptor(descriptor, isProgressDescriptor, "ProgressDescriptor");
      return createPrimitiveProgress(descriptor);
    },
    card(descriptor) {
      assertDescriptor(descriptor, isContainerDescriptor, "ContainerDescriptor");
      return createContainerMount(descriptor, "card");
    },
    section(descriptor) {
      assertDescriptor(descriptor, isContainerDescriptor, "ContainerDescriptor");
      return createContainerMount(descriptor, "section");
    },
    confirm(confirmation) {
      assertDescriptor(confirmation, isConfirmationDescriptor, "ConfirmationDescriptor");
      const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      return openConfirmation(trigger, undefined, confirmation);
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
  if (tone === "icon") {
    button.title = textValue(action.label);
    button.dataset.tooltip = textValue(action.label);
  }
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
  trigger: HTMLElement | undefined,
  action: ActionDescriptor | undefined,
  confirmation: ConfirmationDescriptor,
): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.className = "mem-view-confirm";
    dialog.setAttribute("aria-label", textValue(confirmation.title));
    const surface = document.createElement("section");
    const header = document.createElement("header");
    const heading = document.createElement("h2");
    heading.textContent = textValue(confirmation.title);
    const closeButton = createPrimitiveButton({ label: confirmation.closeLabel ?? confirmation.cancelLabel, icon: { kind: "system", name: "x" }, run: () => close(false) }, "icon");
    closeButton.classList.add("mem-view-confirm-close");
    header.append(heading, closeButton);
    surface.append(header);
    if (confirmation.description) {
      const description = document.createElement("p");
      description.textContent = textValue(confirmation.description);
      surface.append(description);
    }
    const status = document.createElement("p");
    status.className = "mem-view-confirm-status";
    status.setAttribute("role", "alert");
    const footer = document.createElement("footer");
    const cancel = createPrimitiveButton({ label: confirmation.cancelLabel, run: () => close(false) });
    const confirm = createPrimitiveButton({
      label: confirmation.confirmLabel,
      ...(action?.icon ? { icon: action.icon } : {}),
      async run() {
        status.textContent = "";
        cancel.disabled = true;
        closeButton.disabled = true;
        try {
          await action?.run();
          close(true);
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : String(error);
        } finally {
          if (!closed) {
            cancel.disabled = false;
            closeButton.disabled = false;
          }
        }
      }
    }, confirmation.tone ?? "primary");
    footer.append(cancel, confirm);
    surface.append(status, footer);
    dialog.append(surface);
    let closed = false;
    const close = (confirmed: boolean) => {
      if (closed) return;
      closed = true;
      dialog.close();
      dialog.remove();
      resolve(confirmed);
      if (trigger) queueMicrotask(() => queueMicrotask(() => trigger.focus()));
    };
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(false); });
    (trigger?.closest("[data-view-theme-root]") ?? document.body).append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

export function createPrimitiveBadge(value: TextRef | BadgeDescriptor): HTMLElement {
  const descriptor: BadgeDescriptor = "label" in value ? value : { label: value };
  const badge = document.createElement("span");
  badge.className = "mem-view-badge";
  badge.dataset.tone = descriptor.tone ?? "default";
  if (descriptor.icon) badge.append(renderPrimitiveIcon(descriptor.icon));
  const label = document.createElement("span");
  label.textContent = textValue(descriptor.label);
  badge.append(label);
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

export function createPrimitiveFeedback(descriptor: FeedbackDescriptor): HTMLElement {
  const container = document.createElement("div");
  container.className = "mem-view-feedback";
  container.dataset.state = descriptor.state;
  container.setAttribute("role", descriptor.state === "error" ? "alert" : "status");
  if (descriptor.state === "read-only") container.setAttribute("aria-readonly", "true");
  if (descriptor.state === "loading") container.setAttribute("aria-busy", "true");
  if (descriptor.icon) container.append(renderPrimitiveIcon(descriptor.icon));
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = textValue(descriptor.title);
  copy.append(title);
  if (descriptor.description) {
    const description = document.createElement("p");
    description.textContent = textValue(descriptor.description);
    copy.append(description);
  }
  container.append(copy);
  if (descriptor.action) container.append(createPrimitiveButton(descriptor.action));
  return container;
}

function createPrimitiveTabs(descriptor: TabsDescriptor, navigate: UiNavigation): HTMLElement {
  const root = document.createElement("div");
  root.className = "mem-view-tabs";
  root.setAttribute("role", "tablist");
  root.setAttribute("aria-label", textValue(descriptor.label));
  const buttons: HTMLButtonElement[] = descriptor.items.map(item => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.dataset.itemId = item.id;
    button.disabled = item.disabled === true;
    button.tabIndex = item.id === descriptor.selectedId ? 0 : -1;
    button.setAttribute("aria-selected", String(item.id === descriptor.selectedId));
    if (item.panelId) button.setAttribute("aria-controls", item.panelId);
    if (item.icon) button.append(renderPrimitiveIcon(item.icon));
    const label = document.createElement("span");
    label.textContent = textValue(item.label);
    button.append(label);
    const action = item.action ?? { label: item.label, run: () => navigate(item.route!) };
    bindButtonAction(button, { ...action, run: async () => {
      await action.run();
      for (const candidate of buttons) {
        const selected = candidate === button;
        candidate.tabIndex = selected ? 0 : -1;
        candidate.setAttribute("aria-selected", String(selected));
      }
    }});
    root.append(button);
    return button;
  });
  bindRovingKeys(root, buttons, "horizontal", true);
  return root;
}

function createPrimitiveSegmentedControl(descriptor: SegmentedControlDescriptor): HTMLElement {
  const root = document.createElement("div");
  root.className = "mem-view-segmented";
  root.setAttribute("role", "radiogroup");
  root.setAttribute("aria-label", textValue(descriptor.label));
  const buttons: HTMLButtonElement[] = descriptor.items.map(item => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "radio";
    button.dataset.itemId = item.id;
    button.disabled = item.disabled === true;
    button.tabIndex = item.id === descriptor.selectedId ? 0 : -1;
    button.setAttribute("aria-checked", String(item.id === descriptor.selectedId));
    if (item.icon) button.append(renderPrimitiveIcon(item.icon));
    const label = document.createElement("span");
    label.textContent = textValue(item.label);
    button.append(label);
    bindButtonAction(button, { label: item.label, run: async () => {
      await descriptor.onSelect(item.id);
      for (const candidate of buttons) {
        const selected = candidate === button;
        candidate.tabIndex = selected ? 0 : -1;
        candidate.setAttribute("aria-checked", String(selected));
      }
    }});
    root.append(button);
    return button;
  });
  bindRovingKeys(root, buttons, "horizontal", true);
  return root;
}

function bindRovingKeys(root: HTMLElement, buttons: HTMLButtonElement[], orientation: "horizontal" | "vertical", activate: boolean): void {
  root.addEventListener("keydown", event => {
    const enabled = buttons.filter(button => !button.disabled);
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    let next = current;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = enabled.length - 1;
    else if ((orientation === "horizontal" && event.key === "ArrowRight") || (orientation === "vertical" && event.key === "ArrowDown")) next = (current + 1) % enabled.length;
    else if ((orientation === "horizontal" && event.key === "ArrowLeft") || (orientation === "vertical" && event.key === "ArrowUp")) next = (current - 1 + enabled.length) % enabled.length;
    else return;
    event.preventDefault();
    enabled[next]?.focus();
    if (activate) enabled[next]?.click();
  });
}

function createDisclosureMount(descriptor: DisclosureDescriptor): ViewMount {
  return {
    async mount({ element }, context) {
      const root = document.createElement("section");
      root.className = "mem-view-disclosure";
      const contentId = `mem-view-disclosure-${nextPrimitiveId++}`;
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.disabled = descriptor.disabled === true;
      trigger.setAttribute("aria-expanded", String(descriptor.expanded ?? false));
      trigger.setAttribute("aria-controls", contentId);
      if (descriptor.icon) trigger.append(renderPrimitiveIcon(descriptor.icon));
      const copy = document.createElement("span");
      copy.className = "mem-view-disclosure-copy";
      const title = document.createElement("strong");
      title.textContent = textValue(descriptor.title);
      copy.append(title);
      if (descriptor.description) {
        const description = document.createElement("small");
        description.textContent = textValue(descriptor.description);
        copy.append(description);
      }
      trigger.append(copy);
      if (descriptor.meta) {
        const meta = document.createElement("small");
        meta.textContent = textValue(descriptor.meta);
        trigger.append(meta);
      }
      const caret = renderPrimitiveIcon({ kind: "system", name: "caret-down" });
      caret.classList.add("mem-view-disclosure-caret");
      trigger.append(caret);
      const content = document.createElement("div");
      content.id = contentId;
      content.hidden = !(descriptor.expanded ?? false);
      let dispose: void | (() => void | Promise<void>);
      if (descriptor.content instanceof HTMLElement) content.append(descriptor.content);
      else dispose = await descriptor.content.mount({ element: content, portal: content }, context);
      trigger.addEventListener("click", async () => {
        const expanded = trigger.getAttribute("aria-expanded") !== "true";
        trigger.setAttribute("aria-expanded", String(expanded));
        content.hidden = !expanded;
        await descriptor.onToggle?.(expanded);
      });
      root.append(trigger, content);
      element.replaceChildren(root);
      return async () => { await dispose?.(); root.remove(); };
    }
  };
}

let nextPrimitiveId = 1;

function applyFieldState(root: HTMLElement, control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, descriptor: FieldDescriptor): void {
  root.dataset.invalid = String(Boolean(descriptor.error));
  control.setAttribute("aria-invalid", String(Boolean(descriptor.error)));
  control.disabled = descriptor.disabled === true;
  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) control.readOnly = descriptor.readOnly === true;
  control.required = descriptor.required === true;
  const description = root.querySelector<HTMLElement>("[data-field-description]");
  if (description) {
    description.setAttribute("role", descriptor.error ? "alert" : "status");
    description.textContent = descriptor.error ? textValue(descriptor.error) : descriptor.description ? textValue(descriptor.description) : "";
  }
}

function fieldShell(descriptor: FieldDescriptor): { root: HTMLLabelElement; body: HTMLElement } {
  const id = `mem-view-field-${nextPrimitiveId++}`;
  const root = document.createElement("label");
  root.className = "mem-view-field";
  const label = document.createElement("span");
  label.id = `${id}-label`;
  label.textContent = textValue(descriptor.label);
  const body = document.createElement("span");
  body.className = "mem-view-field-control";
  const description = document.createElement("small");
  description.id = `${id}-description`;
  description.dataset.fieldDescription = "";
  description.setAttribute("role", descriptor.error ? "alert" : "status");
  root.append(label, body, description);
  return { root, body };
}

function attachFieldControl(root: HTMLLabelElement, body: HTMLElement, control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
  const label = root.querySelector<HTMLElement>(":scope > span:first-child")!;
  const description = root.querySelector<HTMLElement>("[data-field-description]")!;
  control.setAttribute("aria-labelledby", label.id);
  control.setAttribute("aria-describedby", description.id);
  body.append(control);
}

function createTextField(descriptor: TextFieldDescriptor, type: "text" | "search"): FieldHandle<HTMLInputElement, TextFieldDescriptor> {
  const { root, body } = fieldShell(descriptor);
  const control = document.createElement("input");
  control.type = type;
  attachFieldControl(root, body, control);
  let current = descriptor;
  let composing = false;
  control.addEventListener("compositionstart", () => { composing = true; });
  control.addEventListener("compositionend", () => { composing = false; void current.onInput(control.value); });
  control.addEventListener("input", () => { if (!composing) void current.onInput(control.value); });
  const update = (next: TextFieldDescriptor) => {
    current = next;
    if (!composing && document.activeElement !== control) control.value = next.value;
    control.placeholder = next.placeholder ? textValue(next.placeholder) : "";
    applyFieldState(root, control, next);
  };
  update(descriptor);
  return { root, control, update };
}

function createTextareaField(descriptor: TextFieldDescriptor): FieldHandle<HTMLTextAreaElement, TextFieldDescriptor> {
  const { root, body } = fieldShell(descriptor);
  const control = document.createElement("textarea");
  attachFieldControl(root, body, control);
  let current = descriptor;
  let composing = false;
  control.addEventListener("compositionstart", () => { composing = true; });
  control.addEventListener("compositionend", () => { composing = false; void current.onInput(control.value); });
  control.addEventListener("input", () => { if (!composing) void current.onInput(control.value); });
  const update = (next: TextFieldDescriptor) => {
    current = next;
    if (!composing && document.activeElement !== control) control.value = next.value;
    control.placeholder = next.placeholder ? textValue(next.placeholder) : "";
    applyFieldState(root, control, next);
  };
  update(descriptor);
  return { root, control, update };
}

function createCheckboxField(descriptor: CheckboxFieldDescriptor): FieldHandle<HTMLInputElement, CheckboxFieldDescriptor> {
  const { root, body } = fieldShell(descriptor);
  root.classList.add("mem-view-field-checkbox");
  const control = document.createElement("input");
  control.type = "checkbox";
  attachFieldControl(root, body, control);
  root.prepend(body);
  let current = descriptor;
  control.addEventListener("change", () => { void current.onChange(control.checked); });
  const update = (next: CheckboxFieldDescriptor) => {
    current = next;
    control.checked = next.checked;
    control.indeterminate = next.indeterminate === true;
    applyFieldState(root, control, next);
  };
  update(descriptor);
  return { root, control, update };
}

function createSelectField(descriptor: SelectDescriptor): FieldHandle<HTMLSelectElement, SelectDescriptor> {
  const { root, body } = fieldShell(descriptor);
  const control = document.createElement("select");
  control.className = "mem-view-select-control";
  attachFieldControl(root, body, control);
  const caret = renderPrimitiveIcon({ kind: "system", name: "caret-down" });
  caret.classList.add("mem-view-select-caret");
  body.append(caret);
  const listId = `mem-view-select-listbox-${nextPrimitiveId++}`;
  const list = document.createElement("div");
  list.id = listId;
  list.className = "mem-view-listbox mem-view-select-listbox";
  list.role = "listbox";
  list.setAttribute("aria-labelledby", control.getAttribute("aria-labelledby")!);
  list.hidden = true;
  control.setAttribute("aria-controls", listId);
  control.setAttribute("aria-expanded", "false");
  let current = descriptor;
  let active = -1;
  let positionFrame = 0;
  let pendingPositionFrames = 0;
  let connectionObserver: MutationObserver | undefined;
  let resizeObserver: ResizeObserver | undefined;
  const enabledOptions = () => current.options.filter(option => !option.disabled);
  const render = () => {
    list.replaceChildren();
    const options = current.options;
    if (active < 0) active = Math.max(0, options.findIndex(option => option.value === current.value));
    active = Math.min(active, options.length - 1);
    options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.role = "option";
      button.id = `${listId}-${index}`;
      button.disabled = option.disabled === true;
      button.dataset.active = String(index === active);
      button.setAttribute("aria-selected", String(option.value === current.value));
      button.textContent = textValue(option.label);
      button.addEventListener("click", () => { void choose(option); });
      list.append(button);
    });
    if (active >= 0) {
      control.setAttribute("aria-activedescendant", `${listId}-${active}`);
      if (!list.hidden) (list.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
    }
  };
  const position = () => {
    if (list.hidden || !control.isConnected) return;
    const rect = control.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) { close(); return; }
    const gap = 4;
    const edge = 8;
    const desiredHeight = Math.min(list.scrollHeight, 240);
    const below = window.innerHeight - rect.bottom - edge;
    const above = rect.top - edge;
    const openAbove = below < desiredHeight + gap && above > below;
    const available = Math.max(80, openAbove ? above - gap : below - gap);
    list.style.maxHeight = `${Math.min(240, available)}px`;
    list.style.width = `${rect.width}px`;
    list.style.left = `${Math.max(edge, Math.min(rect.left, window.innerWidth - rect.width - edge))}px`;
    list.style.top = `${openAbove ? Math.max(edge, rect.top - Math.min(desiredHeight, available) - gap) : rect.bottom + gap}px`;
    list.dataset.placement = openAbove ? "top" : "bottom";
  };
  const runScheduledPosition = () => {
    positionFrame = 0;
    if (list.hidden) { pendingPositionFrames = 0; return; }
    position();
    pendingPositionFrames -= 1;
    if (pendingPositionFrames > 0) positionFrame = window.requestAnimationFrame(runScheduledPosition);
  };
  const schedulePosition = () => {
    if (list.hidden) return;
    pendingPositionFrames = 3;
    if (positionFrame === 0) positionFrame = window.requestAnimationFrame(runScheduledPosition);
  };
  const stopPosition = () => {
    if (positionFrame !== 0) window.cancelAnimationFrame(positionFrame);
    positionFrame = 0;
    pendingPositionFrames = 0;
  };
  const outside = (event: PointerEvent) => {
    if (!root.contains(event.target as Node) && !list.contains(event.target as Node)) close();
  };
  const close = () => {
    if (list.hidden) return;
    list.hidden = true;
    list.remove();
    stopPosition();
    connectionObserver?.disconnect();
    resizeObserver?.disconnect();
    connectionObserver = undefined;
    resizeObserver = undefined;
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("scroll", schedulePosition, true);
    window.removeEventListener("resize", schedulePosition);
    control.setAttribute("aria-expanded", "false");
    control.removeAttribute("aria-activedescendant");
  };
  const open = () => {
    if (control.disabled || !list.hidden) return;
    active = Math.max(0, current.options.findIndex(option => option.value === current.value));
    list.hidden = false;
    document.body.append(list);
    render();
    control.setAttribute("aria-expanded", "true");
    position();
    schedulePosition();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", schedulePosition, true);
    window.addEventListener("resize", schedulePosition);
    resizeObserver = new ResizeObserver(schedulePosition);
    resizeObserver.observe(control);
    connectionObserver = new MutationObserver(() => { if (!root.isConnected) close(); });
    connectionObserver.observe(document.documentElement, { childList: true, subtree: true });
  };
  const choose = async (option: SelectDescriptor["options"][number]) => {
    if (option.disabled) return;
    control.value = option.value;
    await current.onChange(option.value);
    close();
    control.focus();
  };
  control.addEventListener("change", () => { void current.onChange(control.value); });
  control.addEventListener("pointerdown", event => {
    if (control.disabled) return;
    event.preventDefault();
    control.focus();
    if (list.hidden) open(); else close();
  });
  control.addEventListener("keydown", event => {
    const enabled = enabledOptions();
    const activeValue = current.options[active]?.value;
    let enabledIndex = enabled.findIndex(option => option.value === activeValue);
    if (event.key === "Escape" || event.key === "Tab") { close(); return; }
    if ((event.key === "Enter" || event.key === " ") && !list.hidden) {
      event.preventDefault();
      const option = current.options[active];
      if (option) void choose(option);
      return;
    }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    open();
    if (event.key === "Home") enabledIndex = 0;
    else if (event.key === "End") enabledIndex = enabled.length - 1;
    else if (event.key === "ArrowDown") enabledIndex = Math.min(enabled.length - 1, Math.max(0, enabledIndex + 1));
    else enabledIndex = Math.max(0, enabledIndex < 0 ? enabled.length - 1 : enabledIndex - 1);
    const option = enabled[enabledIndex];
    active = option ? current.options.indexOf(option) : -1;
    render();
  });
  const update = (next: SelectDescriptor) => {
    current = next;
    control.replaceChildren();
    if (next.placeholder) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = textValue(next.placeholder);
      placeholder.disabled = true;
      control.append(placeholder);
    }
    for (const item of next.options) {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = textValue(item.label);
      option.disabled = item.disabled === true;
      control.append(option);
    }
    control.value = next.value;
    applyFieldState(root, control, next);
    if (!list.hidden) { render(); schedulePosition(); }
  };
  update(descriptor);
  return { root, control, update };
}

function createComboboxMount(descriptor: ComboboxDescriptor): ComboboxHandle {
  let current = descriptor;
  let updateMounted: ((next: ComboboxDescriptor) => void) | undefined;
  return {
    updateDescriptor(next) {
      assertDescriptor(next, isComboboxDescriptor, "ComboboxDescriptor");
      current = next;
      updateMounted?.(next);
    },
    mount({ element, portal }) {
      const onInput = (query: string) => current.onInput(query);
      const field = createTextField({ ...current, value: current.query, onInput }, "text");
      const control = field.control;
      field.root.classList.add("mem-view-field-combobox");
      const caret = renderPrimitiveIcon({ kind: "system", name: "caret-down" });
      caret.classList.add("mem-view-combobox-caret");
      field.root.querySelector(".mem-view-field-control")?.append(caret);
      const listId = `mem-view-listbox-${nextPrimitiveId++}`;
      const list = document.createElement("div");
      list.id = listId;
      list.className = "mem-view-listbox";
      list.role = "listbox";
      list.setAttribute("aria-labelledby", control.getAttribute("aria-labelledby")!);
      list.hidden = true;
      control.setAttribute("role", "combobox");
      control.setAttribute("aria-autocomplete", "list");
      control.setAttribute("aria-controls", listId);
      control.setAttribute("aria-expanded", "false");
      let active = -1;
      let filterQuery = "";
      let positionFrame = 0;
      let pendingPositionFrames = 0;
      const visibleOptions = () => current.options.filter(option => textValue(option.label).toLocaleLowerCase().includes(filterQuery.toLocaleLowerCase()));
      const render = () => {
        list.replaceChildren();
        const options = visibleOptions();
        active = Math.min(active, options.length - 1);
        options.forEach((option, index) => {
          const button = document.createElement("button");
          button.type = "button";
          button.role = "option";
          button.id = `${listId}-${index}`;
          button.dataset.value = option.value;
          button.disabled = option.disabled === true;
          button.setAttribute("aria-selected", String(option.value === current.value));
          button.textContent = textValue(option.label);
          button.addEventListener("click", () => { void select(option); });
          list.append(button);
        });
        if (active >= 0) control.setAttribute("aria-activedescendant", `${listId}-${active}`);
        else control.removeAttribute("aria-activedescendant");
        if (active >= 0 && !list.hidden) (list.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
      };
      const position = () => {
        if (list.hidden) return;
        const rect = control.getBoundingClientRect();
        list.style.left = `${rect.left}px`;
        list.style.top = `${rect.bottom + 4}px`;
        list.style.width = `${rect.width}px`;
      };
      const runScheduledPosition = () => {
        positionFrame = 0;
        if (list.hidden) { pendingPositionFrames = 0; return; }
        position();
        pendingPositionFrames -= 1;
        if (pendingPositionFrames > 0) positionFrame = window.requestAnimationFrame(runScheduledPosition);
      };
      const schedulePosition = () => {
        if (list.hidden) return;
        pendingPositionFrames = 3;
        if (positionFrame === 0) positionFrame = window.requestAnimationFrame(runScheduledPosition);
      };
      const cancelScheduledPosition = () => {
        if (positionFrame !== 0) window.cancelAnimationFrame(positionFrame);
        positionFrame = 0;
        pendingPositionFrames = 0;
      };
      const open = (resetFilter = false) => {
        if (resetFilter) filterQuery = "";
        render();
        list.hidden = false;
        control.setAttribute("aria-expanded", "true");
        position();
        schedulePosition();
      };
      const close = () => {
        list.hidden = true;
        cancelScheduledPosition();
        control.setAttribute("aria-expanded", "false");
        control.removeAttribute("aria-activedescendant");
      };
      const select = async (option: ComboboxDescriptor["options"][number]) => {
        const label = textValue(option.label);
        control.value = label;
        await current.onInput(label);
        await current.onChange(option.value);
        close();
      };
      control.addEventListener("focus", () => open(true));
      control.addEventListener("input", () => { filterQuery = control.value; open(); });
      control.addEventListener("keydown", event => {
        const options = visibleOptions();
        if (event.key === "Escape") { event.preventDefault(); close(); control.focus(); return; }
        if (event.key === "Home") active = 0;
        else if (event.key === "End") active = options.length - 1;
        else if (event.key === "PageDown") active = Math.min(options.length - 1, active + 10);
        else if (event.key === "PageUp") active = Math.max(0, active - 10);
        else if (event.key === "ArrowDown") active = Math.min(options.length - 1, active + 1);
        else if (event.key === "ArrowUp") active = Math.max(0, active - 1);
        else if (event.key === "Enter" && active >= 0 && options[active]) { event.preventDefault(); void select(options[active]); return; }
        else return;
        event.preventDefault(); render();
      });
      const outside = (event: PointerEvent) => { if (!field.root.contains(event.target as Node) && !list.contains(event.target as Node)) close(); };
      const resizeObserver = new ResizeObserver(schedulePosition);
      resizeObserver.observe(control);
      document.addEventListener("pointerdown", outside);
      document.addEventListener("scroll", schedulePosition, true);
      window.addEventListener("resize", schedulePosition);
      element.replaceChildren(field.root);
      portal.append(list);
      updateMounted = next => { field.update({ ...next, value: next.query, onInput }); if (!list.hidden) render(); };
      return () => { updateMounted = undefined; cancelScheduledPosition(); resizeObserver.disconnect(); document.removeEventListener("pointerdown", outside); document.removeEventListener("scroll", schedulePosition, true); window.removeEventListener("resize", schedulePosition); list.remove(); field.root.remove(); };
    }
  };
}

function createPrimitiveProgress(descriptor: ProgressDescriptor): HTMLElement {
  const root = document.createElement("div");
  root.className = "mem-view-progress";
  root.dataset.state = descriptor.state ?? "default";
  const label = document.createElement("span");
  label.textContent = textValue(descriptor.label);
  const progress = document.createElement("div");
  progress.className = "mem-view-progress-track";
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-label", textValue(descriptor.label));
  const indicator = document.createElement("span");
  const max = descriptor.max ?? 100;
  if (descriptor.value !== undefined) {
    const value = Math.max(0, Math.min(descriptor.value, max));
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", String(max));
    progress.setAttribute("aria-valuenow", String(value));
    indicator.style.width = `${max > 0 ? (value / max) * 100 : 0}%`;
  } else {
    root.dataset.indeterminate = "true";
  }
  progress.append(indicator);
  root.append(label, progress);
  if (descriptor.description) {
    const description = document.createElement("small");
    description.textContent = textValue(descriptor.description);
    root.append(description);
  }
  return root;
}

function createContainerMount(descriptor: ContainerDescriptor, kind: "card" | "section"): ViewMount {
  return {
    async mount({ element, portal }, context) {
      const root = document.createElement("section");
      root.className = `mem-view-${kind}`;
      root.dataset.tone = descriptor.tone ?? "default";
      if (descriptor.title || descriptor.description || descriptor.actions?.length) {
        const header = document.createElement("header");
        const copy = document.createElement("div");
        if (descriptor.title) {
          const title = document.createElement("h2");
          title.textContent = textValue(descriptor.title);
          copy.append(title);
        }
        if (descriptor.description) {
          const description = document.createElement("p");
          description.textContent = textValue(descriptor.description);
          copy.append(description);
        }
        header.append(copy);
        if (descriptor.actions?.length) {
          const actions = document.createElement("div");
          actions.className = "mem-view-container-actions";
          for (const action of descriptor.actions) actions.append(createPrimitiveButton(action));
          header.append(actions);
        }
        root.append(header);
      }
      const content = document.createElement("div");
      content.className = "mem-view-container-content";
      let dispose: void | (() => void | Promise<void>);
      if (descriptor.content instanceof HTMLElement) content.append(descriptor.content);
      else dispose = await descriptor.content.mount({ element: content, portal }, context);
      root.append(content);
      element.replaceChildren(root);
      return async () => { await dispose?.(); root.remove(); };
    }
  };
}

export function renderPrimitiveIcon(icon: IconRef): HTMLElement {
  assertDescriptor(icon, isIconRef, "IconRef");
  if (icon.kind === "asset") {
    const image = document.createElement("img");
    image.className = "mem-view-icon";
    image.src = icon.url;
    image.alt = textValue(icon.alt);
    return image;
  }
  const glyph = document.createElement("span");
  glyph.className = "mem-view-icon mem-view-system-icon";
  glyph.style.setProperty("--mem-view-icon-url", `url(/assets/system-icons/${normalizeSystemIconName(icon.name)}.svg)`);
  glyph.setAttribute("aria-hidden", "true");
  return glyph;
}

const contentListDisposers = new WeakMap<HTMLElement, Array<() => void | Promise<void>>>();

async function renderContentList(
  descriptor: ContentListDescriptor,
  navigate: UiNavigation,
  rerender: () => Promise<void>,
  context: ViewRenderContext,
  existing?: HTMLElement,
): Promise<HTMLElement> {
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
  const previousDisposers = contentListDisposers.get(content) ?? [];
  await Promise.all(previousDisposers.map(dispose => dispose()));
  const nestedDisposers: Array<() => void | Promise<void>> = [];
  contentListDisposers.set(content, nestedDisposers);
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

  if (descriptor.state === "error") {
    content.append(createPrimitiveFeedback(descriptor.error));
    return container;
  }

  const itemCount = descriptor.sections.reduce((count, section) => count + section.items.length, 0);
  if (itemCount === 0) {
    if (descriptor.empty) content.append(createPrimitiveEmptyState(descriptor.empty));
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
      const row = document.createElement("div");
      row.className = "mem-view-list-item-row";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mem-view-list-item";
      button.dataset.itemId = item.id;
      button.setAttribute("aria-label", textValue(item.action?.label ?? item.title));
      button.disabled = item.disabled === true;
      if (item.disabled) button.setAttribute("aria-disabled", "true");
      if (item.selected) {
        button.classList.add("active");
        button.setAttribute("aria-current", "page");
      }
      if (item.icon) button.append(renderPrimitiveIcon(item.icon));
      const copy = document.createElement("span");
      copy.className = "mem-view-list-item-copy";
      const heading = document.createElement("span");
      heading.className = "mem-view-list-item-heading";
      const title = document.createElement("strong");
      title.textContent = textValue(item.title);
      heading.append(title);
      if (item.badge) heading.append(createPrimitiveBadge(item.badge));
      copy.append(heading);
      if (item.meta) {
        const meta = document.createElement("small");
        meta.textContent = textValue(item.meta);
        copy.append(meta);
      }
      if (item.description) {
        const description = document.createElement("small");
        description.className = "mem-view-list-item-description";
        description.textContent = textValue(item.description);
        copy.append(description);
      }
      if (item.badges?.length) {
        const badges = document.createElement("span");
        badges.className = "mem-view-list-item-badges";
        for (const badge of item.badges) badges.append(createPrimitiveBadge(badge));
        copy.append(badges);
      }
      button.append(copy);
      bindButtonAction(button, { ...(item.action ?? {
        label: item.title,
        run: () => navigate(item.route!)
      }), disabled: item.disabled === true });
      row.append(button);
      if (item.trailingActions?.length || item.toggle) {
        const actions = document.createElement("div");
        actions.className = "mem-view-list-item-actions";
        for (const action of item.trailingActions ?? []) actions.append(createPrimitiveButton(action, "icon"));
        if (item.toggle) {
          const toggle = createPrimitiveButton(item.toggle, "icon");
          toggle.setAttribute("aria-expanded", String(item.expanded === true));
          actions.append(toggle);
        }
        row.append(actions);
      }
      list.append(row);
      if (item.expanded && item.details) {
        const details = document.createElement("div");
        details.className = "mem-view-list-item-details";
        list.append(details);
        const dispose = await item.details.mount({ element: details, portal: details }, context);
        if (dispose) nestedDisposers.push(dispose);
      }
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
    if (button.dataset.tone === "icon") button.title = button.getAttribute("aria-label") ?? "";
    button.querySelector(".mem-view-button-error")?.remove();
    try {
      await action.run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      button.dataset.viewActionError = message;
      button.title = message;
      const status = document.createElement("span");
      status.className = "mem-view-button-error";
      status.setAttribute("role", "alert");
      status.textContent = message;
      button.append(status);
    } finally {
      button.removeAttribute("aria-busy");
      button.disabled = action.disabled === true;
    }
  });
}

function assertContentListDescriptor(value: unknown): asserts value is ContentListDescriptor {
  if (!isContentListDescriptor(value)) throw new TypeError("View UI content list descriptor is invalid");
}

function assertDescriptor<T>(value: unknown, validate: (candidate: unknown) => candidate is T, name: string): asserts value is T {
  if (!validate(value)) {
    const keys = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort().join(",") : typeof value;
    throw new TypeError(`View UI ${name} is invalid (received: ${keys || "no fields"})`);
  }
}

function textValue(value: TextRef): string {
  if ("text" in value) return value.text;
  return value.key.replace(/\{([A-Za-z0-9_]+)\}/g, (_, name: string) => String(value.params?.[name] ?? `{${name}}`));
}

export const viewUiStyles = `
  .mem-view-button { position:relative; display:inline-flex; min-height:34px; align-items:center; justify-content:center; gap:7px; border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-sm); background:var(--mem-view-color-surface); padding:0 var(--mem-view-space-3); color:var(--mem-view-color-text); font:600 var(--mem-view-font-size-sm)/var(--mem-view-line-compact) var(--mem-view-font-sans); cursor:pointer; }
  .mem-view-button:hover:not(:disabled) { border-color:var(--mem-view-color-accent); background:var(--mem-view-color-subtle); }
  .mem-view-button[data-tone="primary"] { border-color:var(--mem-view-color-accent); background:var(--mem-view-color-accent); color:var(--mem-view-color-on-accent); }
  .mem-view-button[data-tone="primary"]:hover:not(:disabled) { border-color:var(--mem-view-color-accent-hover); background:var(--mem-view-color-accent-hover); color:var(--mem-view-color-on-accent); }
  .mem-view-button[data-tone="danger"] { border-color:var(--mem-view-color-danger); background:var(--mem-view-color-danger); color:var(--mem-view-color-on-accent); }
  .mem-view-button[data-tone="danger"]:hover:not(:disabled) { border-color:color-mix(in srgb,var(--mem-view-color-danger) 86%,var(--mem-view-color-text)); background:color-mix(in srgb,var(--mem-view-color-danger) 86%,var(--mem-view-color-text)); color:var(--mem-view-color-on-accent); }
  .mem-view-button[data-tone="icon"] { width:34px; min-width:34px; height:34px; min-height:34px; flex:0 0 34px; padding:0; }
  .mem-view-button[data-tone="icon"][data-tooltip]::after { content:attr(data-tooltip); position:absolute; z-index:var(--mem-view-z-overlay); top:calc(100% + var(--mem-view-space-2)); right:0; width:max-content; max-width:240px; visibility:hidden; border:1px solid var(--mem-view-color-border-strong); border-radius:var(--mem-view-radius-sm); background:var(--mem-view-color-text); padding:var(--mem-view-space-1) var(--mem-view-space-2); color:var(--mem-view-color-surface); box-shadow:var(--mem-view-shadow-popover); font:500 var(--mem-view-font-size-xs)/var(--mem-view-line-compact) var(--mem-view-font-sans); opacity:0; pointer-events:none; text-align:left; white-space:normal; transform:translateY(-2px); transition:opacity var(--mem-view-motion-fast),transform var(--mem-view-motion-fast),visibility var(--mem-view-motion-fast); }
  .mem-view-button[data-tone="icon"][data-tooltip]:hover::after, .mem-view-button[data-tone="icon"][data-tooltip]:focus-visible::after { visibility:visible; opacity:1; transform:translateY(0); }
  .mem-view-button:disabled { border-color:color-mix(in srgb,var(--mem-view-color-border) 58%,transparent); background:color-mix(in srgb,var(--mem-view-color-subtle) 58%,var(--mem-view-color-surface)); color:color-mix(in srgb,var(--mem-view-color-text-muted) 58%,transparent); cursor:not-allowed; box-shadow:none; opacity:.68; }
  .mem-view-button:disabled .mem-view-icon { opacity:.42; }
  .mem-view-button:focus-visible, .mem-view-list-item:focus-visible, .mem-view-list-filter input:focus-visible { outline:2px solid var(--mem-view-color-accent); outline-offset:2px; box-shadow:0 0 0 3px var(--mem-view-color-focus-ring); }
  .mem-view-button[aria-busy="true"] { cursor:wait; opacity:.7; }
  .mem-view-button[data-view-action-error] { border-color:var(--mem-view-color-danger); color:var(--mem-view-color-danger); }
  .mem-view-button-error { position:absolute; top:calc(100% + var(--mem-view-space-1)); right:0; z-index:var(--mem-view-z-overlay); width:max-content; max-width:280px; border:1px solid var(--mem-view-color-danger); border-radius:var(--mem-view-radius-sm); background:var(--mem-view-color-danger-soft); padding:var(--mem-view-space-2); color:var(--mem-view-color-danger); box-shadow:var(--mem-view-shadow-popover); font-weight:400; }
  .mem-view-icon { width:18px; height:18px; flex:0 0 auto; object-fit:contain; }
  .mem-view-system-icon { display:inline-block; background:currentColor; -webkit-mask:var(--mem-view-icon-url) center/contain no-repeat; mask:var(--mem-view-icon-url) center/contain no-repeat; }
  .mem-view-badge { display:inline-flex; min-width:20px; min-height:20px; align-items:center; justify-content:center; gap:var(--mem-view-space-1); border-radius:var(--mem-view-radius-pill); background:var(--mem-view-color-accent-soft); padding:0 var(--mem-view-space-2); color:var(--mem-view-color-accent-hover); font:600 var(--mem-view-font-size-sm)/var(--mem-view-line-compact) var(--mem-view-font-sans); }
  .mem-view-badge .mem-view-icon { width:14px; height:14px; }
  .mem-view-content-list-root { width:100%; height:100%; min-height:0; overflow:hidden; }
  .mem-view-content-list { width:100%; height:100%; overflow:auto; background:var(--mem-view-color-surface); color:var(--mem-view-color-text); font:var(--mem-view-font-size-base)/var(--mem-view-line-body) var(--mem-view-font-sans); }
  .mem-view-list-header { display:flex; min-height:104px; align-items:center; justify-content:space-between; gap:var(--mem-view-space-3); padding:var(--mem-view-space-4); border-bottom:1px solid var(--mem-view-color-border); background:var(--mem-view-color-surface); }
  .mem-view-list-header > div { display:grid; min-width:0; flex:1 1 auto; gap:var(--mem-view-space-1); }
  .mem-view-list-header > .mem-view-button[data-tone="icon"] { flex:0 0 34px; }
  .mem-view-list-header small { overflow:hidden; color:var(--mem-view-color-text-muted); font-size:var(--mem-view-font-size-sm); text-overflow:ellipsis; white-space:nowrap; }
  .mem-view-list-header strong { overflow:hidden; font-size:var(--mem-view-font-size-xl); line-height:var(--mem-view-line-heading); text-overflow:ellipsis; white-space:nowrap; }
  .mem-view-list-filter { position:sticky; z-index:2; top:0; display:block; padding:var(--mem-view-space-3); border-bottom:1px solid var(--mem-view-color-border); background:var(--mem-view-color-surface); }
  .mem-view-list-filter > span { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
  .mem-view-list-filter input { width:100%; height:36px; border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-md); background:var(--mem-view-color-subtle); padding:0 var(--mem-view-space-3); color:var(--mem-view-color-text); font:inherit; outline:0; }
  .mem-view-list-section > h2 { margin:0; padding:var(--mem-view-space-3) var(--mem-view-space-4) var(--mem-view-space-2); color:var(--mem-view-color-text-muted); font-size:var(--mem-view-font-size-sm); text-transform:uppercase; letter-spacing:.06em; }
  .mem-view-list-items { display:grid; }
  .mem-view-list-item-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:stretch; border-bottom:1px solid var(--mem-view-color-border); transition:background 120ms ease; }
  .mem-view-list-item-row:hover { background:var(--mem-view-color-subtle); }
  .mem-view-list-item-row:has(.mem-view-list-item.active) { background:var(--mem-view-color-accent-soft); }
  .mem-view-list-item { display:grid; width:100%; min-height:66px; grid-template-columns:auto minmax(0,1fr); align-items:center; gap:var(--mem-view-space-3); border:0; background:transparent; padding:var(--mem-view-space-3) var(--mem-view-space-4); color:inherit; font:inherit; text-align:left; cursor:pointer; }
  .mem-view-list-item:hover, .mem-view-list-item.active { background:transparent; }
  .mem-view-list-item-copy { display:grid; min-width:0; gap:2px; }
  .mem-view-list-item-heading { display:flex; min-width:0; align-items:center; gap:var(--mem-view-space-2); }
  .mem-view-list-item-heading > strong { min-width:0; flex:1; }
  .mem-view-list-item-heading > .mem-view-badge { flex:0 0 auto; }
  .mem-view-list-item-copy strong, .mem-view-list-item-copy small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .mem-view-list-item-copy small { color:var(--mem-view-color-text-muted); font-size:var(--mem-view-font-size-sm); }
  .mem-view-list-item-description { opacity:.82; }
  .mem-view-list-item-badges, .mem-view-list-item-actions { display:flex; align-items:center; gap:var(--mem-view-space-1); }
  .mem-view-list-item-badges { min-width:0; flex-wrap:wrap; margin-top:var(--mem-view-space-1); }
  .mem-view-list-item-actions { padding-right:var(--mem-view-space-3); }
  .mem-view-list-item-actions .mem-view-button[data-tone="icon"] { width:30px; min-height:30px; border-color:transparent; background:transparent; color:var(--mem-view-color-text-muted); }
  .mem-view-list-item-actions .mem-view-button[data-tone="icon"]:hover:not(:disabled) { border-color:transparent; background:color-mix(in srgb,var(--mem-view-color-surface) 72%,transparent); color:var(--mem-view-color-accent); }
  .mem-view-list-item-actions .mem-view-button[aria-expanded="true"] .mem-view-icon { transform:rotate(180deg); }
  .mem-view-list-item-row:has(.mem-view-list-item-actions) .mem-view-list-item { gap:var(--mem-view-space-2); padding-right:var(--mem-view-space-2); }
  .mem-view-list-item-details { border-bottom:1px solid var(--mem-view-color-border); background:var(--mem-view-color-subtle); padding:var(--mem-view-space-3) var(--mem-view-space-4); }
  .mem-view-empty-state { display:grid; min-height:220px; place-content:center; justify-items:center; padding:var(--mem-view-space-5); color:var(--mem-view-color-text-muted); text-align:center; }
  .mem-view-empty-state strong { color:var(--mem-view-color-text); font-size:var(--mem-view-font-size-lg); }
  .mem-view-empty-state p { max-width:30ch; margin:var(--mem-view-space-2) 0 0; }
  .mem-view-confirm { width:min(440px,calc(100vw - 32px)); max-width:none; border:0; border-radius:var(--mem-view-radius-lg); background:transparent; padding:0; color:var(--mem-view-color-text); box-shadow:var(--mem-view-shadow-overlay); }
  .mem-view-confirm::backdrop { background:var(--mem-view-color-overlay); }
  .mem-view-confirm > section { display:grid; gap:var(--mem-view-space-3); border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-lg); background:var(--mem-view-color-surface); padding:var(--mem-view-space-5); }
  .mem-view-confirm header { display:flex; align-items:flex-start; justify-content:space-between; gap:var(--mem-view-space-3); }
  .mem-view-confirm h2 { margin:0; font-size:var(--mem-view-font-size-lg); line-height:var(--mem-view-line-heading); }
  .mem-view-confirm-close { flex:0 0 auto; min-height:30px; width:30px; padding:0; }
  .mem-view-confirm p { margin:0; color:var(--mem-view-color-text-muted); }
  .mem-view-confirm-status:empty { display:none; }
  .mem-view-confirm-status:not(:empty) { color:var(--mem-view-color-danger); }
  .mem-view-confirm footer { display:flex; justify-content:flex-end; gap:var(--mem-view-space-2); padding-top:var(--mem-view-space-2); }
  .mem-view-list-loading { display:grid; gap:var(--mem-view-space-3); padding:var(--mem-view-space-4); }
  .mem-view-list-loading span { height:58px; border-radius:var(--mem-view-radius-md); background:var(--mem-view-color-subtle); animation:mem-view-pulse 1.1s ease-in-out infinite alternate; }
  .mem-view-list-content > .mem-view-feedback { min-height:96px; margin:var(--mem-view-space-3); }
  .mem-view-feedback { display:grid; min-height:96px; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:var(--mem-view-space-3); border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-md); background:var(--mem-view-color-subtle); padding:var(--mem-view-space-4); color:var(--mem-view-color-text-muted); }
  .mem-view-feedback:not(:has(> .mem-view-icon)) { grid-template-columns:minmax(0,1fr) auto; }
  .mem-view-feedback > div { min-width:0; }
  .mem-view-feedback > .mem-view-button { justify-self:end; }
  .mem-view-feedback[data-state="error"] { border-color:var(--mem-view-color-danger); background:var(--mem-view-color-danger-soft); color:var(--mem-view-color-danger); }
  .mem-view-feedback[data-state="success"] { border-color:var(--mem-view-color-success); background:var(--mem-view-color-success-soft); color:var(--mem-view-color-success); }
  .mem-view-feedback[data-state="read-only"] { border-color:var(--mem-view-color-info); background:var(--mem-view-color-info-soft); color:var(--mem-view-color-info); }
  .mem-view-feedback strong { display:block; color:var(--mem-view-color-text); }
  .mem-view-feedback p { margin:var(--mem-view-space-1) 0 0; }
  .mem-view-tabs, .mem-view-segmented { display:inline-flex; gap:var(--mem-view-space-1); border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-md); background:var(--mem-view-color-subtle); padding:var(--mem-view-space-1); }
  .mem-view-tabs > button, .mem-view-segmented > button { display:inline-flex; min-height:32px; align-items:center; justify-content:center; gap:var(--mem-view-space-2); border:0; border-radius:var(--mem-view-radius-sm); background:transparent; padding:0 var(--mem-view-space-3); color:var(--mem-view-color-text-muted); font:600 var(--mem-view-font-size-sm)/var(--mem-view-line-compact) var(--mem-view-font-sans); cursor:pointer; }
  .mem-view-tabs > button[aria-selected="true"], .mem-view-segmented > button[aria-checked="true"] { background:var(--mem-view-color-surface); color:var(--mem-view-color-accent); box-shadow:var(--mem-view-shadow-card); }
  .mem-view-tabs > button:focus-visible, .mem-view-segmented > button:focus-visible { outline:2px solid var(--mem-view-color-accent); outline-offset:2px; }
  .mem-view-disclosure { overflow:hidden; border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-md); background:var(--mem-view-color-surface); }
  .mem-view-disclosure > button { display:flex; width:100%; align-items:center; gap:var(--mem-view-space-3); border:0; background:transparent; padding:var(--mem-view-space-3) var(--mem-view-space-4); color:var(--mem-view-color-text); text-align:left; cursor:pointer; }
  .mem-view-disclosure > button:hover:not(:disabled) { background:var(--mem-view-color-subtle); }
  .mem-view-disclosure > button[aria-expanded="true"] { background:var(--mem-view-color-accent-soft); }
  .mem-view-disclosure-copy { display:grid; min-width:0; flex:1; gap:2px; }
  .mem-view-disclosure > button small { color:var(--mem-view-color-text-muted); }
  .mem-view-disclosure-caret { width:16px; height:16px; margin-left:auto; color:var(--mem-view-color-text-muted); transform:rotate(-90deg); transition:transform var(--mem-view-motion-fast); }
  .mem-view-disclosure > button[aria-expanded="true"] .mem-view-disclosure-caret { color:var(--mem-view-color-accent); transform:rotate(0); }
  .mem-view-disclosure > div { border-top:1px solid var(--mem-view-color-border); padding:var(--mem-view-space-4); }
  .mem-view-field { display:grid; gap:var(--mem-view-space-2); color:var(--mem-view-color-text); font:600 var(--mem-view-font-size-sm)/var(--mem-view-line-compact) var(--mem-view-font-sans); }
  .mem-view-field-control { position:relative; display:flex; min-width:0; }
  .mem-view-field input:not([type="checkbox"]), .mem-view-field textarea, .mem-view-field select { width:100%; min-height:36px; border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-sm); background:var(--mem-view-color-surface); padding:var(--mem-view-space-2) var(--mem-view-space-3); color:var(--mem-view-color-text); font:400 var(--mem-view-font-size-base)/var(--mem-view-line-body) var(--mem-view-font-sans); }
  .mem-view-field input:not([type="checkbox"]):focus-visible, .mem-view-field textarea:focus-visible, .mem-view-field select:focus-visible { outline:2px solid var(--mem-view-color-accent); outline-offset:1px; box-shadow:0 0 0 3px var(--mem-view-color-focus-ring); }
  .mem-view-field select.mem-view-select-control { appearance:none; padding-right:36px; cursor:pointer; }
  .mem-view-select-caret { position:absolute; top:50%; right:var(--mem-view-space-3); width:16px; height:16px; pointer-events:none; transform:translateY(-50%); }
  .mem-view-field select.mem-view-select-control:disabled + .mem-view-select-caret { opacity:.42; }
  .mem-view-field-combobox input[role="combobox"] { padding-right:36px; }
  .mem-view-combobox-caret { position:absolute; top:50%; right:var(--mem-view-space-3); width:16px; height:16px; pointer-events:none; color:var(--mem-view-color-text-muted); transform:translateY(-50%); transition:transform var(--mem-view-motion-fast); }
  .mem-view-field-combobox input[role="combobox"][aria-expanded="true"] + .mem-view-combobox-caret { color:var(--mem-view-color-accent); transform:translateY(-50%) rotate(180deg); }
  .mem-view-field textarea { min-height:96px; resize:vertical; }
  .mem-view-field[data-invalid="true"] input, .mem-view-field[data-invalid="true"] textarea, .mem-view-field[data-invalid="true"] select { border-color:var(--mem-view-color-danger); }
  .mem-view-field > small { min-height:1em; color:var(--mem-view-color-text-muted); font-weight:400; }
  .mem-view-field[data-invalid="true"] > small { color:var(--mem-view-color-danger); }
  .mem-view-field-checkbox { grid-template-columns:auto minmax(0,1fr); align-items:center; column-gap:var(--mem-view-space-2); }
  .mem-view-field-checkbox .mem-view-field-control { align-items:center; }
  .mem-view-field-checkbox > small { grid-column:2; }
  .mem-view-field-checkbox input { width:18px; height:18px; margin:0; accent-color:var(--mem-view-color-accent); }
  .mem-view-listbox { position:fixed; z-index:var(--mem-view-z-overlay); display:grid; max-height:240px; overflow:auto; border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-md); background:var(--mem-view-color-surface); padding:var(--mem-view-space-1); box-shadow:var(--mem-view-shadow-popover); }
  .mem-view-listbox[hidden] { display:none; }
  .mem-view-listbox > button { border:0; border-radius:var(--mem-view-radius-sm); background:transparent; padding:var(--mem-view-space-2) var(--mem-view-space-3); color:var(--mem-view-color-text); text-align:left; cursor:pointer; }
  .mem-view-listbox > button:hover, .mem-view-listbox > button[aria-selected="true"], .mem-view-listbox > button[data-active="true"] { background:var(--mem-view-color-accent-soft); }
  .mem-view-listbox > button:focus-visible { outline:2px solid var(--mem-view-color-accent); outline-offset:-2px; }
  .mem-view-progress { display:grid; gap:var(--mem-view-space-2); color:var(--mem-view-color-text); }
  .mem-view-progress-track { position:relative; width:100%; height:6px; overflow:hidden; border-radius:var(--mem-view-radius-pill); background:var(--mem-view-color-subtle); }
  .mem-view-progress-track > span { position:absolute; inset:0 auto 0 0; border-radius:var(--mem-view-radius-pill); background:var(--mem-view-color-accent); }
  .mem-view-progress[data-indeterminate="true"] .mem-view-progress-track > span { left:-35%; width:35%; animation:mem-view-progress 1.1s ease-in-out infinite; }
  .mem-view-progress[data-state="success"] .mem-view-progress-track > span { background:var(--mem-view-color-success); }
  .mem-view-progress[data-state="error"] .mem-view-progress-track > span { background:var(--mem-view-color-danger); }
  .mem-view-progress small { color:var(--mem-view-color-text-muted); }
  .mem-view-card, .mem-view-section { border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-lg); background:var(--mem-view-color-surface); color:var(--mem-view-color-text); }
  .mem-view-card { box-shadow:var(--mem-view-shadow-card); }
  .mem-view-card > header, .mem-view-section > header { display:flex; align-items:flex-start; justify-content:space-between; gap:var(--mem-view-space-3); border-bottom:1px solid var(--mem-view-color-border); padding:var(--mem-view-space-4); }
  .mem-view-card h2, .mem-view-section h2 { margin:0; font-size:var(--mem-view-font-size-lg); }
  .mem-view-card header p, .mem-view-section header p { margin:var(--mem-view-space-1) 0 0; color:var(--mem-view-color-text-muted); }
  .mem-view-container-actions { display:flex; gap:var(--mem-view-space-2); }
  .mem-view-container-content { padding:var(--mem-view-space-4); }
  .mem-view-badge[data-tone="info"] { background:var(--mem-view-color-info-soft); color:var(--mem-view-color-info); }
  .mem-view-badge[data-tone="success"] { background:var(--mem-view-color-success-soft); color:var(--mem-view-color-success); }
  .mem-view-badge[data-tone="warning"] { background:var(--mem-view-color-warning-soft); color:var(--mem-view-color-warning); }
  .mem-view-badge[data-tone="danger"] { background:var(--mem-view-color-danger-soft); color:var(--mem-view-color-danger); }
  @keyframes mem-view-pulse { from { opacity:.55; } to { opacity:1; } }
  @keyframes mem-view-progress { from { transform:translateX(0); } to { transform:translateX(390%); } }
  @media (prefers-reduced-motion:reduce) { .mem-view-list-loading span,.mem-view-progress[data-indeterminate="true"] .mem-view-progress-track > span { animation:none; transition:none; transform:translateX(190%); } }
`;
