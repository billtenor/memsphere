import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  createHostRouteActivation,
  createHostRouteProjection,
  createHostRouteTarget,
  defineSlot,
  defineViewPlugin,
  isActionDescriptor,
  isHeaderActionDescriptor,
  isContentListDescriptor,
  isHeaderAccountDescriptor,
  isHeaderTitleDescriptor,
  isIconRef,
  isFeedbackDescriptor,
  isTabsDescriptor,
  isSegmentedControlDescriptor,
  isTextFieldDescriptor,
  isCheckboxFieldDescriptor,
  isComboboxDescriptor,
  isConfirmationDescriptor,
  isContainerDescriptor,
  isDisclosureDescriptor,
  isProgressDescriptor,
  isSelectDescriptor,
  isHomeAttentionItemDescriptor,
  isHomeContinueItemDescriptor,
  isHomeModuleItemDescriptor,
  isNavigationItemDescriptor,
  isOverlayMountDescriptor,
  isRouteActivation,
  isRouteProjection,
  isRouteTarget,
  isSearchProviderDescriptor,
  isSearchResultDescriptor,
  isSecondaryNavigationDescriptor,
  isSidePanelDescriptor,
  isSidebarFooterDescriptor,
  isSlotToken,
  slots,
  viewThemeCssVariables,
  type ViewMount,
  type ViewRenderContext
} from "../src/view/view-sdk.js";
import { normalizeSystemIconName, systemIconNames } from "../src/view/system-icon.js";
import { viewThemeLightTokens } from "../src/view/theme.js";

const theme = Object.freeze({
  version: 1 as const,
  mode: "light" as const,
  tokens: viewThemeLightTokens,
  subscribe: () => () => undefined
});

test("defineViewPlugin preserves the Plugin object used as the Bundle default export", () => {
  const plugin = {
    name: "example",
    apiVersion: 1 as const,
    inject: ["slots"] as const,
    apply() {}
  };

  assert.equal(defineViewPlugin(plugin), plugin);
});

test("main.view Token carries one stable keyed Mount contract", () => {
  assert.equal(isSlotToken(slots.mainView), true);
  assert.deepEqual(
    {
      name: slots.mainView.definition.name,
      version: slots.mainView.definition.version,
      kind: slots.mainView.definition.kind,
      scope: slots.mainView.definition.scope,
      render: slots.mainView.definition.render
    },
    {
      name: "main.view",
      version: 1,
      kind: "keyed",
      scope: "shell",
      render: "mount"
    }
  );
  assert.equal(slots.mainView.definition.validate({ mount() {} }), true);
  assert.equal(slots.mainView.definition.validate({}), false);
});

test("ViewRenderContext exposes the Host-resolved readonly Route location", () => {
  const context: ViewRenderContext = {
    module: { projectId: "p", moduleId: "org.test.module", moduleVersion: "1.0.0", instanceId: "one" },
    route: {
      pathname: "/items/example",
      search: "",
      hash: "",
      params: { id: "example" },
      query: { section: "recent" },
      routeKey: "org.test.module@1.0.0:one:route:detail"
    },
    theme
  };
  assert.equal(context.route.params.id, "example");
  assert.equal(context.theme, theme);
});

test("Theme v1 publishes a complete stable CSS-variable mapping", () => {
  assert.equal(Object.keys(viewThemeCssVariables).length, 56);
  assert.deepEqual(Object.keys(viewThemeCssVariables), Object.keys(viewThemeLightTokens));
  assert.equal(viewThemeCssVariables["color.textMuted"], "--mem-view-color-text-muted");
  assert.equal(viewThemeLightTokens["layout.contentMax"], "960px");
  assert.equal(Object.isFrozen(viewThemeCssVariables), true);
  assert.equal(Object.isFrozen(viewThemeLightTokens), true);
});

test("standard content list descriptors reject duplicate ids and ambiguous actions", () => {
  const route = createHostRouteTarget();
  const descriptor = {
    label: { text: "Items" },
    header: { eyebrow: { text: "Memory" }, title: { text: "Current project" }, action: { label: { text: "Refresh" }, run() {} } },
    empty: { title: { text: "Empty" } },
    sections: [{ id: "main", items: [{ id: "one", title: { text: "One" }, route }] }]
  };
  assert.equal(isContentListDescriptor(descriptor), true);
  assert.equal(isContentListDescriptor({ ...descriptor, header: { ...descriptor.header, html: "unsafe" } }), false);
  assert.equal(isContentListDescriptor({ ...descriptor, sections: [descriptor.sections[0], descriptor.sections[0]] }), false);
  assert.equal(isContentListDescriptor({
    ...descriptor,
    sections: [{ id: "main", items: [{ id: "one", title: { text: "One" }, route, action: { label: { text: "Open" }, run() {} } }] }]
  }), false);
  const action = { label: { text: "Open" }, run() {} };
  assert.equal(isActionDescriptor(action), true);
  assert.equal(isActionDescriptor({ ...action, tone: "success" }), false);
  assert.equal(isContentListDescriptor({
    ...descriptor,
    sections: [{ id: "main", items: [{ id: "one", title: { text: "One" }, action }] }]
  }), true);
});

test("system icon aliases share one canonical mapping", () => {
  assert.equal(normalizeSystemIconName("settings"), "gear-six");
  assert.equal(normalizeSystemIconName("run"), "play-circle");
  assert.equal(normalizeSystemIconName("memory"), "brain");
  assert.equal(normalizeSystemIconName("unknown"), "stack");
  assert.equal(isIconRef({ kind: "system", name: "trash" }), true);
  assert.equal(isIconRef({ kind: "system", name: "unknown" }), false);
});

test("every literal system icon used by production TypeScript exists in the canonical catalog", async () => {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && path.endsWith(".ts")) files.push(path);
    }
  };
  await visit(join(process.cwd(), "src"));
  await visit(join(process.cwd(), "modules"));
  const used = new Set<string>();
  for (const path of files) {
    const source = await readFile(path, "utf8");
    for (const match of source.matchAll(/kind:\s*["']system["'][^\n]*?name:\s*["']([a-z0-9-]+)["']/g)) used.add(match[1]);
  }
  const missing = [...used].filter(name => !systemIconNames.includes(name as never));
  assert.deepEqual(missing, []);
});

test("UI v1 validators enforce controlled fields, navigation activation, and feedback states", () => {
  const route = createHostRouteTarget();
  const action = { label: { text: "Choose" }, run() {} };
  assert.equal(isTextFieldDescriptor({ label: { text: "Name" }, value: "Ada", placeholder: { text: "Type" }, onInput() {} }), true);
  assert.equal(isTextFieldDescriptor({ label: { text: "Name" }, placeholder: { text: "Type" }, onInput() {} }), false);
  assert.equal(isCheckboxFieldDescriptor({ label: { text: "Enabled" }, checked: true, onChange() {} }), true);
  assert.equal(isCheckboxFieldDescriptor({ label: { text: "Enabled" }, onChange() {} }), false);
  assert.equal(isFeedbackDescriptor({ state: "error", title: { text: "Failed" }, action }), true);
  assert.equal(isFeedbackDescriptor({ state: "unknown", title: { text: "Failed" } }), false);
  assert.equal(isTabsDescriptor({
    label: { text: "Status" }, selectedId: "running",
    items: [
      { id: "running", label: { text: "Running" }, route },
      { id: "done", label: { text: "Done" }, action }
    ]
  }), true);
  assert.equal(isTabsDescriptor({
    label: { text: "Status" }, selectedId: "missing",
    items: [{ id: "running", label: { text: "Running" }, route }]
  }), false);
  assert.equal(isSegmentedControlDescriptor({
    label: { text: "View" }, selectedId: "diff", onSelect() {},
    items: [{ id: "diff", label: { text: "Diff" } }, { id: "full", label: { text: "Full" } }]
  }), true);
  assert.equal(isSelectDescriptor({ label: { text: "Role" }, value: "dev", options: [{ value: "dev", label: { text: "Developer" } }], onChange() {} }), true);
  assert.equal(isSelectDescriptor({ label: { text: "Role" }, value: "dev", options: [{ value: "dev", label: { text: "Developer" } }, { value: "dev", label: { text: "Duplicate" } }], onChange() {} }), false);
  assert.equal(isComboboxDescriptor({ label: { text: "Reviewer" }, value: "dev", query: "Dev", options: [{ value: "dev", label: { text: "Developer" } }], onInput() {}, onChange() {} }), true);
  assert.equal(isComboboxDescriptor({ label: { text: "Reviewer" }, value: "dev", options: [], onInput() {}, onChange() {} }), false);
  assert.equal(isDisclosureDescriptor({ title: { text: "Details" }, content: { mount() {} } }), true);
  assert.equal(isProgressDescriptor({ label: { text: "Progress" }, value: 2, max: 3 }), true);
  assert.equal(isProgressDescriptor({ label: { text: "Progress" }, value: 4, max: 3 }), false);
  assert.equal(isContainerDescriptor({ title: { text: "Card" }, content: { mount() {} } }), true);
  assert.equal(isConfirmationDescriptor({ title: { text: "Delete?" }, confirmLabel: { text: "Delete" }, cancelLabel: { text: "Cancel" }, tone: "danger" }), true);
});

test("content list state is a strict ready, loading, or retryable error union", () => {
  const base = { label: { text: "Items" }, sections: [] };
  assert.equal(isContentListDescriptor({ ...base, empty: { title: { text: "Empty" } } }), true);
  assert.equal(isContentListDescriptor({ ...base, state: "loading" }), true);
  assert.equal(isContentListDescriptor({ ...base, state: "error", error: { state: "error", title: { text: "Failed" }, action: { label: { text: "Retry" }, run() {} } } }), true);
  assert.equal(isContentListDescriptor({ ...base, state: "ready" }), false);
  assert.equal(isContentListDescriptor({ ...base, state: "error", empty: { title: { text: "Empty" } } }), false);
});

test("built-in Tokens expose the fourteen approved root Slot contracts", () => {
  assert.deepEqual(
    Object.values(slots).map(slot => ({
      name: slot.definition.name,
      kind: slot.definition.kind,
      scope: slot.definition.scope,
      render: slot.definition.render
    })),
    [
      { name: "navigation.primary", kind: "list", scope: "project", render: "descriptor" },
      { name: "navigation.secondary", kind: "single", scope: "page", render: "descriptor" },
      { name: "content.list", kind: "single", scope: "page", render: "mount" },
      { name: "search.providers", kind: "list", scope: "project", render: "descriptor" },
      { name: "header.title", kind: "single", scope: "page", render: "descriptor" },
      { name: "header.actions", kind: "list", scope: "page", render: "descriptor" },
      { name: "side.panel", kind: "single", scope: "page", render: "mount" },
      { name: "header.account", kind: "single", scope: "shell", render: "descriptor" },
      { name: "sidebar.footer", kind: "list", scope: "project", render: "descriptor" },
      { name: "home.attention", kind: "list", scope: "project", render: "descriptor" },
      { name: "home.continue", kind: "list", scope: "project", render: "descriptor" },
      { name: "home.modules", kind: "list", scope: "project", render: "descriptor" },
      { name: "main.view", kind: "keyed", scope: "shell", render: "mount" },
      { name: "overlay", kind: "keyed", scope: "page", render: "mount" }
    ]
  );
  for (const slot of Object.values(slots)) {
    assert.equal(isSlotToken(slot), true);
    assert.equal(Object.isFrozen(slot), true);
    assert.equal(Object.isFrozen(slot.definition), true);
  }
});

test("Route values are accepted only when created by the ViewHost bridge", () => {
  const activation = createHostRouteActivation();
  const target = createHostRouteTarget();
  assert.equal(isRouteActivation(activation), true);
  assert.equal(isRouteTarget(target), true);
  assert.equal(isRouteActivation({}), false);
  assert.equal(isRouteTarget({ path: "/memories" }), false);
  assert.equal(Object.isFrozen(activation), true);
  assert.equal(Object.isFrozen(target), true);
});

test("Descriptor validators accept standard data and reject HTML or forged Routes", () => {
  const route = createHostRouteTarget();
  const projection = createHostRouteProjection();
  const navigation = {
    label: { text: "Memory" },
    icon: { kind: "system", name: "memory" },
    route
  };
  const title = {
    title: { key: "memory.title" },
    subtitle: { text: "Project memories" },
    breadcrumbs: [{ label: { text: "Home" }, route }]
  };
  const action = { label: { text: "Refresh" }, run() {} };

  assert.equal(isNavigationItemDescriptor(navigation), true);
  assert.equal(slots.navigationPrimary.definition.validate(navigation), true);
  assert.equal(isHeaderTitleDescriptor(title), true);
  assert.equal(slots.headerTitle.definition.validate(title), true);
  assert.equal(isHeaderActionDescriptor(action), true);
  assert.equal(isHeaderActionDescriptor({ ...action, tone: "success" }), true);
  assert.equal(isHeaderActionDescriptor({ ...action, tone: "danger" }), false);
  assert.equal(slots.headerActions.definition.validate(action), true);
  assert.equal(slots.headerActions.definition.live, true);
  assert.equal(slots.navigationSecondary.definition.live, true);
  assert.equal(slots.headerTitle.definition.live, true);
  assert.equal(isNavigationItemDescriptor({ ...navigation, route: { path: "/memories" } }), false);
  assert.equal(isHeaderTitleDescriptor({ ...title, html: "<b>unsafe</b>" }), false);
  assert.equal(isHeaderActionDescriptor({ ...action, element: {} }), false);

  const account = { label: { text: "LY" }, status: { text: "Local Human" } };
  const footer = { kind: "status", label: { text: "Service" }, status: "healthy" };
  const attention = { title: { text: "Review" }, icon: navigation.icon, status: "warning", action };
  const continuation = { title: { text: "Run" }, icon: navigation.icon, route };
  const module = { title: { text: "Memory" }, icon: navigation.icon, route, status: "ready" };
  const overlay = {
    label: { text: "Artifact Review" },
    presentation: "dialog",
    background: projection,
    mount: { mount() {} }
  };
  const sidePanel = { label: { text: "Inspector" }, icon: navigation.icon, mount: { mount() {} } };
  assert.equal(isHeaderAccountDescriptor(account), true);
  assert.equal(isSidebarFooterDescriptor(footer), true);
  assert.equal(isHomeAttentionItemDescriptor(attention), true);
  assert.equal(isHomeContinueItemDescriptor(continuation), true);
  assert.equal(isHomeModuleItemDescriptor(module), true);
  assert.equal(isOverlayMountDescriptor(overlay), true);
  assert.equal(isOverlayMountDescriptor({ ...overlay, size: "compact" }), true);
  assert.equal(isOverlayMountDescriptor({ ...overlay, size: "fullscreen" }), false);
  assert.equal(isSidePanelDescriptor(sidePanel), true);
  assert.equal(slots.sidePanel.definition.validate(sidePanel), true);
  assert.equal(isSidePanelDescriptor({ ...sidePanel, defaultOpen: "yes" }), false);
  assert.equal(isRouteProjection(projection), true);
  assert.equal(isOverlayMountDescriptor({ ...overlay, background: {} }), false);
  assert.equal(isHomeAttentionItemDescriptor({ ...attention, html: "<b>unsafe</b>" }), false);
  assert.equal(isHomeContinueItemDescriptor({ ...continuation, icon: { kind: "html", value: "<b>unsafe</b>" } }), false);

  const secondary = {
    title: { text: "Memory" }, icon: navigation.icon,
    items: [
      { id: "current", label: { text: "Current" }, icon: navigation.icon, selected: true, route },
      { id: "refresh", label: { text: "Refresh" }, icon: navigation.icon, selected: false, action }
    ],
    footer: { text: "Project navigation" }
  };
  assert.equal(isSecondaryNavigationDescriptor(secondary), true);
  assert.equal(slots.navigationSecondary.definition.validate(secondary), true);
  assert.equal(isSecondaryNavigationDescriptor({ ...secondary, html: "<b>unsafe</b>" }), false);
  assert.equal(isSecondaryNavigationDescriptor({
    ...secondary,
    items: [{ ...secondary.items[0], action }]
  }), false);
  assert.equal(isSecondaryNavigationDescriptor({
    ...secondary,
    items: [...secondary.items, secondary.items[0]]
  }), false);

  const result = { title: { text: "Memory" }, type: { text: "Concept" }, route };
  const provider = { label: { text: "Memory" }, icon: navigation.icon, search() { return [result]; } };
  assert.equal(isSearchResultDescriptor(result), true);
  assert.equal(isSearchProviderDescriptor(provider), true);
  assert.equal(slots.searchProviders.definition.validate(provider), true);
  assert.equal(isSearchResultDescriptor({ ...result, route: { path: "/memories" } }), false);
  assert.equal(isSearchProviderDescriptor({ ...provider, element: {} }), false);
});

test("defineSlot creates branded immutable Tokens without accepting structural forgeries", () => {
  const token = defineSlot<ViewMount, string>()({
    name: "com.example/page",
    version: 1,
    kind: "keyed",
    scope: "page",
    render: "mount",
    validate: value => Boolean(value && typeof value === "object" && "mount" in value)
  });

  assert.equal(isSlotToken(token), true);
  assert.equal(isSlotToken({ definition: token.definition }), false);
  assert.equal(Object.isFrozen(token), true);
  assert.equal(Object.isFrozen(token.definition), true);
});
