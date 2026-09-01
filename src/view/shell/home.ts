import type {
  Disposer,
  HomeAttentionItemDescriptor,
  HomeContinueItemDescriptor,
  HomeModuleItemDescriptor,
  RouteTarget,
  IconRef,
  TextRef,
  ViewMount,
  ViewMountTarget
} from "../view-sdk.js";

export interface HomeSnapshot {
  readonly attention: readonly HomeAttentionItemDescriptor[];
  readonly continueItems: readonly HomeContinueItemDescriptor[];
  readonly modules: readonly HomeModuleItemDescriptor[];
}

export interface HomeSnapshotReader {
  snapshot(): HomeSnapshot;
  subscribe(listener: () => void): Disposer;
  navigate(target: RouteTarget): Promise<void>;
}

export function createHomeMount(reader: HomeSnapshotReader, messages: Readonly<Record<string, unknown>>): ViewMount {
  return Object.freeze({
    mount({ element }: ViewMountTarget) {
      element.className = "view-home";
      const render = () => {
        const snapshot = reader.snapshot();
        const content = document.createElement("div");
        content.className = "view-home-content";
        const heading = document.createElement("h1");
        heading.className = "view-home-title";
        heading.textContent = message(messages, "home.title");
        content.append(
          heading,
          renderAttention(snapshot.attention, reader, messages),
          renderContinue(snapshot.continueItems, reader, messages),
          renderModules(snapshot.modules, reader, messages)
        );
        element.replaceChildren(content);
      };
      render();
      const unsubscribe = reader.subscribe(render);
      return () => {
        void unsubscribe();
        element.replaceChildren();
      };
    }
  });
}

function renderAttention(items: readonly HomeAttentionItemDescriptor[], reader: HomeSnapshotReader, messages: Readonly<Record<string, unknown>>): HTMLElement {
  const section = homeSection(message(messages, "home.attention"), "attention");
  section.querySelector("h2")?.append(countBadge(items.length));
  const body = section.querySelector<HTMLElement>(".view-home-section-body")!;
  if (items.length === 0) body.append(empty(message(messages, "home.attention.empty")));
  else for (const item of items) body.append(attentionRow(item));
  return section;

  function attentionRow(item: HomeAttentionItemDescriptor): HTMLElement {
    const row = document.createElement("article");
    row.className = "view-home-row view-home-attention-row";
    row.dataset.status = item.status;
    row.append(homeIcon(item.icon, item.status));
    const copy = document.createElement("div");
    copy.className = "view-home-row-copy view-home-row-identity";
    if (item.source) {
      const source = document.createElement("small");
      source.textContent = textValue(item.source, messages);
      copy.append(source);
    }
    const title = document.createElement("strong");
    title.textContent = textValue(item.title, messages);
    const meta = document.createElement("span");
    meta.textContent = item.summary ? textValue(item.summary, messages) : "";
    copy.append(title, meta);
    const context = document.createElement("div");
    context.className = "view-home-row-copy view-home-row-context";
    const state = document.createElement("strong");
    state.textContent = attentionState(item, messages);
    context.append(state);
    const time = document.createElement("time");
    time.dateTime = item.updatedAt ?? "";
    time.textContent = relativeTime(item.updatedAt, messages);
    const action = document.createElement("button");
    action.type = "button";
    action.className = `view-home-button${isPrimaryAttention(item, messages) ? " primary" : ""}`;
    action.textContent = textValue(item.action.label, messages);
    action.disabled = item.action.disabled === true;
    action.addEventListener("click", () => runAction(action, item.action.run));
    row.append(copy, context, time, action);
    return row;
  }
}

function renderContinue(items: readonly HomeContinueItemDescriptor[], reader: HomeSnapshotReader, messages: Readonly<Record<string, unknown>>): HTMLElement {
  const section = homeSection(message(messages, "home.continue"), "continue");
  const body = section.querySelector<HTMLElement>(".view-home-section-body")!;
  if (items.length === 0) body.append(empty(message(messages, "home.continue.empty")));
  else for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "view-home-row view-home-continue-row";
    button.append(homeIcon(item.icon, "info", true));
    const copy = document.createElement("span");
    copy.className = "view-home-row-copy";
    const title = document.createElement("strong");
    title.textContent = textValue(item.title, messages);
    const meta = document.createElement("span");
    meta.textContent = [item.summary && textValue(item.summary, messages), item.updatedAt].filter(Boolean).join(" · ");
    copy.append(title, meta);
    const time = document.createElement("small");
    time.className = "view-home-updated-at";
    time.textContent = relativeTime(item.updatedAt, messages);
    const arrow = document.createElement("img");
    arrow.className = "view-home-arrow";
    arrow.src = "/assets/system-icons/arrow-right.svg";
    arrow.alt = "";
    arrow.setAttribute("aria-hidden", "true");
    button.append(copy, time, arrow);
    button.addEventListener("click", () => void reader.navigate(item.route));
    body.append(button);
  }
  return section;
}

function renderModules(items: readonly HomeModuleItemDescriptor[], reader: HomeSnapshotReader, messages: Readonly<Record<string, unknown>>): HTMLElement {
  const section = homeSection(message(messages, "home.modules"), "modules");
  const body = section.querySelector<HTMLElement>(".view-home-section-body")!;
  body.classList.add("view-home-module-grid");
  if (items.length === 0) body.append(empty(message(messages, "home.modules.empty")));
  else for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "view-home-module-card";
    button.dataset.status = item.status ?? "ready";
    const iconTile = document.createElement("span");
    iconTile.className = "view-home-module-icon-tile";
    const icon = document.createElement("img");
    icon.className = "view-home-module-icon";
    icon.src = item.icon.kind === "asset"
      ? item.icon.url
      : `/assets/system-icons/${homeSystemIconName(item.icon.name)}.svg`;
    icon.alt = item.icon.kind === "asset" ? textValue(item.icon.alt, messages) : "";
    button.dataset.icon = item.icon.kind === "system" ? homeSystemIconName(item.icon.name) : "asset";
    iconTile.append(icon);
    const copy = document.createElement("span");
    copy.className = "view-home-row-copy";
    const title = document.createElement("strong");
    title.textContent = textValue(item.title, messages);
    const summary = document.createElement("span");
    summary.textContent = item.summary ? textValue(item.summary, messages) : "";
    copy.append(title, summary);
    const arrow = document.createElement("img");
    arrow.className = "view-home-arrow";
    arrow.src = "/assets/system-icons/arrow-right.svg";
    arrow.alt = "";
    arrow.setAttribute("aria-hidden", "true");
    button.append(iconTile, copy, arrow);
    button.addEventListener("click", () => void reader.navigate(item.route));
    body.append(button);
  }
  return section;
}

function homeSystemIconName(name: string): string {
  if (name === "gear") return "gear-six";
  if (name === "play") return "play-circle";
  if (name === "code") return "code";
  if (name === "warning") return "warning-circle";
  return ["brain", "play-circle", "gear-six", "house", "file-text", "code", "warning-circle"].includes(name) ? name : "stack";
}

function homeIcon(icon: IconRef | undefined, status: HomeAttentionItemDescriptor["status"], small = false): HTMLSpanElement {
  const tile = document.createElement("span");
  tile.className = `view-home-icon-tile${small ? " small" : ""}`;
  tile.dataset.tone = status === "error" ? "error" : icon?.kind === "system" && homeSystemIconName(icon.name) === "play-circle" ? "blue" : icon?.kind === "system" && homeSystemIconName(icon.name) === "file-text" ? "orange" : "green";
  const image = document.createElement("img");
  image.src = icon?.kind === "asset" ? icon.url : `/assets/system-icons/${homeSystemIconName(icon?.kind === "system" ? icon.name : "stack")}.svg`;
  image.alt = icon?.kind === "asset" ? textValue(icon.alt, {}) : "";
  image.setAttribute("aria-hidden", "true");
  tile.append(image);
  return tile;
}

function countBadge(count: number): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = "view-home-count";
  badge.textContent = String(count);
  return badge;
}

function attentionState(item: HomeAttentionItemDescriptor, messages: Readonly<Record<string, unknown>>): string {
  const source = item.source ? textValue(item.source, messages).toLowerCase() : "";
  if (source.includes("review") || source.includes("评审")) return message(messages, "home.waitingReview");
  if (source.includes("changeset")) return message(messages, "home.newComments");
  if (item.status === "error") return message(messages, "home.needsAttention");
  return message(messages, "home.needsAttention");
}

function isPrimaryAttention(item: HomeAttentionItemDescriptor, messages: Readonly<Record<string, unknown>>): boolean {
  const source = item.source ? textValue(item.source, messages).toLowerCase() : "";
  return source.includes("review") || source.includes("评审");
}

function relativeTime(value: string | undefined, messages: Readonly<Record<string, unknown>>): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const delta = timestamp - Date.now();
  const locale = message(messages, "locale.code") === "en" ? "en" : "zh-CN";
  const units: readonly [Intl.RelativeTimeFormatUnit, number][] = [["day", 86_400_000], ["hour", 3_600_000], ["minute", 60_000]];
  const [unit, size] = units.find(([, candidate]) => Math.abs(delta) >= candidate) ?? ["minute", 60_000];
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(delta / size), unit);
}

function homeSection(title: string, kind: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "view-home-section";
  section.dataset.homeSection = kind;
  const heading = document.createElement("h2");
  heading.textContent = title;
  const body = document.createElement("div");
  body.className = "view-home-section-body";
  section.append(heading, body);
  return section;
}

function empty(label: string): HTMLElement {
  const value = document.createElement("p");
  value.className = "view-home-empty";
  value.textContent = label;
  return value;
}

function message(messages: Readonly<Record<string, unknown>>, key: string): string {
  const value = messages[key];
  return typeof value === "string" ? value : key;
}

function textValue(ref: TextRef, messages: Readonly<Record<string, unknown>>): string {
  if ("text" in ref) return ref.text;
  return message(messages, ref.key).replace(/\{([A-Za-z0-9_]+)\}/g, (_, name: string) => String(ref.params?.[name] ?? `{${name}}`));
}

async function runAction(button: HTMLButtonElement, run: () => unknown): Promise<void> {
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    await run();
  } catch (error) {
    button.dataset.viewActionError = error instanceof Error ? error.message : String(error);
    button.title = button.dataset.viewActionError;
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}
