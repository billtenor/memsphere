# Memsphere View UI Primitives Handbook

[简体中文](./view-ui-primitives.md) | English

This copy-first handbook is for Module authors building Memsphere pages and prototypes. It explains where to inspect shared controls, when to use them, and how to start from minimal code. Use [View Plugin API](./view-plugin-api.en.md) for exact types, [View Slot List](./view-slots.en.md) for shared regions, and [View Plugin Guide](./view-plugin-guide.en.md) for the complete Plugin workflow.

## Start with the runnable reference page

Build and restart View:

```bash
npm run build
node dist/cli.js view restart
```

Open “Prototype / Component reference” in the production Shell, or visit `/reference`.

Reference is a real Module, not a separate port or static mock. It demonstrates every UI v1 primitive, the standard Shell, Content List states, the side panel, Dialog, Drawer, and a relationship canvas owned entirely by the Module.

- Runnable source: [`modules/org.memsphere.reference/adapter/view/index.ts`](../modules/org.memsphere.reference/adapter/view/index.ts)
- Public types: [`src/view/view-sdk.ts`](../src/view/view-sdk.ts)
- Memory migration: [`modules/org.memsphere.memory/adapter/view/index.ts`](../modules/org.memsphere.memory/adapter/view/index.ts)
- Run migration: [`modules/org.memsphere.run/adapter/view/index.ts`](../modules/org.memsphere.run/adapter/view/index.ts)

## One-minute selection guide

| What you are building | Use |
| --- | --- |
| Primary/secondary navigation, object list, Header, side panel, overlay | The matching public Slot Descriptor |
| Buttons, confirmation, status, forms, disclosure, and cards | `ctx.ui` primitives |
| Domain canvases, Memory bodies, Run trees, and other unique content | Module-owned DOM in `main.view` |
| Color, typography, spacing, radius, shadow, and responsive geometry | Theme v1 `--mem-view-*` tokens |

The Shell owns shared placement and geometry, Theme owns shared visuals, primitives own common interaction states, and the Module owns business data and custom content.

## Minimal integration

Declare both service injection and supported versions:

```ts
export default defineViewPlugin({
  name: "example-view",
  apiVersion: 1,
  inject: ["slots", "router", "theme", "ui"],
  themeVersion: 1,
  uiVersion: 1,

  apply(ctx) {
    if (!ctx.router || !ctx.theme || !ctx.ui) throw new Error("required View services are unavailable");
    // Register routes, shared Slot descriptors, and Module-owned ViewMounts here.
  },
});
```

Examples below use `t("中文", "English")` as the Module's bilingual text helper. Fixed UI copy must provide both `zh-CN` and `en`; user data and technical identities may use `{ text: value }`.

## Shared Shell and Slots

Submit data descriptors to shared Slots rather than rebuilding their DOM:

```ts
ctx.slots.register(slots.headerTitle, {
  id: "example.header",
  when: route.activation,
  value: {
    title: t("客户详情", "Customer details"),
    subtitle: t("最近更新", "Recently updated"),
    breadcrumbs: [
      { label: t("客户", "Customers"), route: route.to() },
      { label: t("当前客户", "Current customers") },
    ],
  },
});

ctx.slots.register(slots.headerActions, {
  id: "example.refresh",
  when: route.activation,
  value: {
    label: t("刷新客户", "Refresh customers"),
    icon: { kind: "system", name: "arrows-clockwise" },
    async run() { await refreshCustomers(); },
  },
});
```

The side panel is hidden by default. Host owns its trigger, width, close action, focus return, and narrow-screen presentation:

```ts
ctx.slots.register(slots.sidePanel, {
  id: "example.inspector",
  when: route.activation,
  value: {
    label: t("查看属性", "View properties"),
    icon: { kind: "system", name: "sidebar-simple" },
    defaultOpen: false,
    mount: inspectorMount,
  },
});
```

Use the `overlay` Slot for temporary tasks: `dialog` for compact centered work and `drawer` for longer work that preserves page context. Do not rebuild masks, focus traps, or closing behavior inside `main.view`.

## Standard Content List

Use `ctx.ui.contentList()` for object-list columns. It owns the eyebrow/title header, filtering, sections, three text levels, badges, selection, trailing actions, expandable details, and loading/empty/error states.

```ts
let query = "";
const list = ctx.ui.contentList((context) => ({
  label: t("客户列表", "Customer list"),
  header: {
    eyebrow: t("客户", "Customers"),
    title: t("当前客户", "Current customers"),
    action: {
      label: t("刷新列表", "Refresh list"),
      icon: { kind: "system", name: "arrows-clockwise" },
      async run() { await list.update?.(context); },
    },
  },
  filter: {
    label: t("筛选客户", "Filter customers"),
    value: query,
    onInput(value) { query = value; },
  },
  empty: { title: t("没有匹配客户", "No matching customers") },
  sections: [{
    id: "active",
    items: customers.map(customer => ({
      id: customer.id,
      title: { text: customer.name },
      meta: { text: customer.role },
      description: { text: customer.summary },
      selected: context.route.params.id === customer.id,
      route: detailRoute.to({ id: customer.id }),
    })),
  }],
}));
```

Return explicit `state: "loading"` or `state: "error"` descriptors for asynchronous reads. Use `expanded`, `toggle`, and `details` only when an item genuinely needs inline child content.

## Buttons, icon buttons, and confirmation

```ts
const save = ctx.ui.button(
  { label: t("保存", "Save"), icon: { kind: "system", name: "check" }, run: saveRecord },
  { tone: "primary" },
);

const remove = ctx.ui.confirmButton(
  { label: t("删除", "Delete"), icon: { kind: "system", name: "trash" }, run: deleteRecord },
  {
    title: t("删除这条记录？", "Delete this record?"),
    confirmLabel: t("确认删除", "Delete"),
    cancelLabel: t("取消", "Cancel"),
    closeLabel: t("关闭", "Close"),
    tone: "danger",
  },
  { tone: "danger" },
);

const refresh = ctx.ui.iconButton({
  label: t("刷新", "Refresh"),
  icon: { kind: "system", name: "arrows-clockwise" },
  run: refreshRecords,
});
```

`button` is the normal labeled action. `iconButton` requires a label that becomes its accessible name and hover hint. `confirmButton` is for destructive or irreversible work, while `confirm` supports custom triggers. Use `disabled: true`; do not imitate disabled styling in Module CSS.

## Badges, feedback, and progress

Badge represents short noninteractive state or counts. Feedback represents `loading`, `empty`, `error`, `success`, or `read-only` regions:

```ts
ctx.ui.badge({ label: t("成功", "Success"), tone: "success", icon: { kind: "system", name: "check" } });

ctx.ui.feedback({
  state: "error",
  title: t("加载失败", "Load failed"),
  action: { label: t("重试", "Retry"), run: retry },
});

ctx.ui.progress({
  label: t("评审进度", "Review progress"),
  value: 2,
  max: 3,
  description: t("2 / 3 已完成", "2 / 3 complete"),
});
```

Omit `value/max` for indeterminate progress.

## Tabs and Segmented Control

Use Tabs for separate pages or content regions. Use Segmented Control for a small set of mutually exclusive views of the same content:

```ts
ctx.ui.tabs({
  label: t("客户页面", "Customer pages"),
  selectedId: "overview",
  items: [
    { id: "overview", label: t("概览", "Overview"), route: overviewRoute.to() },
    { id: "activity", label: t("动态", "Activity"), route: activityRoute.to() },
  ],
});

ctx.ui.segmentedControl({
  label: t("内容模式", "Content mode"),
  selectedId: "diff",
  items: [
    { id: "diff", label: t("差异", "Diff") },
    { id: "full", label: t("完整内容", "Full content") },
  ],
  onSelect(id) { renderMode(id); },
});
```

Do not use Segmented Control as primary navigation or Tabs as a form radio group.

## Form controls

Form primitives share labels, descriptions, required/error states, disabled/read-only behavior, and focus visuals. They are controlled: the Module stores state and updates the Descriptor through the returned handle.

```ts
let name = "";
let field: ReturnType<typeof ctx.ui.textField>;
const descriptor = () => ({
  label: t("名称", "Name"),
  value: name,
  required: true,
  error: name ? undefined : t("请输入名称", "Enter a name"),
  onInput(value: string) { name = value; field.update(descriptor()); },
});
field = ctx.ui.textField(descriptor());
```

The same pattern applies to `searchField`, `textareaField`, `checkboxField`, and `select`. Use Select for a small fixed set and Combobox for searchable options. Combobox must store the selected value separately from the current query and call `updateDescriptor()` after either changes. It mounts with the Host-provided `portal`; do not implement popup positioning or z-index yourself. See the Reference source for the complete mount example.

## Disclosure, Card, and Section

Disclosure owns its indicator, expanded state, keyboard behavior, and accessibility:

```ts
const details = ctx.ui.disclosure({
  title: t("详情", "Details"),
  description: t("点击标题展开或收起", "Select the heading to expand or collapse"),
  expanded: true,
  content: detailsElement,
});
```

Card is a bounded visual container; Section is a semantic page region:

```ts
const card = ctx.ui.card({ title: t("客户资料", "Customer profile"), tone: "info", content });
const section = ctx.ui.section({ title: t("最近活动", "Recent activity"), content: activityMount });
```

These factories return `ViewMount`. Mount them inside the parent and invoke every child disposer from the parent cleanup function.

## Theme and custom content

Primitives do not constrain Module-owned content. Scope custom CSS to the Module's own root and consume public Theme tokens:

```css
[data-customer-canvas] {
  padding: var(--mem-view-space-5);
  color: var(--mem-view-color-text);
  background: var(--mem-view-color-canvas);
}
```

Never target `.view-shell-*`, `.mem-view-*`, or `[data-view-slot]`; declare or override `--mem-view-*`; rebuild typography with arbitrary pixels; use `!important` against Host styles; or access DOM outside the assigned container.

System icons use `{ kind: "system", name: "..." }`; `systemIconNames` is authoritative. The control owns on-color, sizing, and hover behavior.

## What should not become a primitive

Memory Statement/Procedure/Schema bodies, ChangeSet diff and anchored comments, Run trees, graphs, timelines, editors, and canvases are domain expressions and belong in `main.view`. They should consume Theme tokens and may compose shared controls internally, but the framework must not interpret their business data.

## Pre-delivery checklist

- Are shared page regions registered through Slots?
- Do common actions, status, forms, disclosure, and containers use `ctx.ui`?
- Does every icon-only action have an accurate label and hover/focus explanation?
- Are hover, focus, disabled, loading, empty, error, and read-only states covered?
- Do Select and Combobox look expandable, and does Combobox restore all options when reopened?
- Do controlled updates preserve value, focus, selection, and IME input?
- Are all child ViewMounts disposed by their parent?
- Is custom CSS scoped and limited to `--mem-view-*` tokens?
- Were zh-CN/en, desktop, and narrow layouts checked?
- Was the result compared with `/reference` and real Memory/Run usage?

## Further reading

- Build a Module from scratch: [View Plugin Guide](./view-plugin-guide.en.md)
- Look up Descriptor fields: [View Plugin API](./view-plugin-api.en.md)
- Select a shared page region: [View Slot List](./view-slots.en.md)
- Understand framework boundaries: [View Plugin Design](./view-plugin-design.en.md)
