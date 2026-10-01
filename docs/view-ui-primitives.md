# Memsphere View 公共控件使用手册

简体中文 | [English](./view-ui-primitives.en.md)

本文面向需要快速搭建 Memsphere 页面或原型的 Module 开发者，回答三个问题：公共控件在哪里看、应该在什么位置使用、怎样复制最小代码。精确类型以 [View Plugin API](./view-plugin-api.md) 为准；页面公共区域以 [View Slot List](./view-slots.md) 为准；完整 Plugin 创建流程见 [View Plugin Guide](./view-plugin-guide.md)。

## 先看可运行参考页

构建并重启 View：

```bash
npm run build
node dist/cli.js view restart
```

然后打开正式 View 的“原型 / 组件参考”，或直接访问 `/reference`。

Reference 是一个真实 Module，不是独立端口或静态稿。它展示本期所有公共控件、标准 Shell、内容列表状态、右侧栏、Dialog、Drawer，以及一块完全由 Module 自己实现的关系画布。

- 可运行源码：[`modules/org.memsphere.reference/adapter/view/index.ts`](../modules/org.memsphere.reference/adapter/view/index.ts)
- 公共类型：[`src/view/view-sdk.ts`](../src/view/view-sdk.ts)
- Memory 实际迁移：[`modules/org.memsphere.memory/adapter/view/index.ts`](../modules/org.memsphere.memory/adapter/view/index.ts)
- Run 实际迁移：[`modules/org.memsphere.run/adapter/view/index.ts`](../modules/org.memsphere.run/adapter/view/index.ts)

## 一分钟选择方法

| 你要实现的内容 | 应该使用 |
| --- | --- |
| 一级菜单、二级菜单、对象列表栏、Header、右侧栏、浮层 | 对应的公开 Slot Descriptor |
| 按钮、确认、状态、表单、折叠、卡片等通用交互 | `ctx.ui` 公共控件 |
| 关系画布、Memory 正文、Run 流程树等领域界面 | `main.view` 中的 Module 自定义 DOM |
| 颜色、字号、间距、圆角、阴影、响应式尺寸 | Theme v1 的 `--mem-view-*` Token |

判断原则是：Shell 管公共位置与布局，Theme 管共享视觉，公共控件管通用状态和交互，Module 只管理业务数据与自由正文。不要为了复用而把领域界面硬塞进公共控件，也不要在 Module 中重写按钮、表单或列表栏。

## 最小接入

公共控件和 Theme 必须同时声明注入及版本：

```ts
import { defineViewPlugin, slots, type ViewMount } from "@memsphere/view-sdk";

export default defineViewPlugin({
  name: "example-view",
  apiVersion: 1,
  inject: ["slots", "router", "theme", "ui"],
  themeVersion: 1,
  uiVersion: 1,

  apply(ctx) {
    if (!ctx.router || !ctx.theme || !ctx.ui) {
      throw new Error("example-view requires router, theme and ui");
    }

    const route = ctx.router.register({ id: "index", path: "/example" });
    const page: ViewMount = {
      mount({ element }) {
        element.textContent = "这里是 Module 自己负责的业务正文";
        return () => element.replaceChildren();
      },
    };

    ctx.slots.register(slots.mainView, {
      id: "example.page",
      key: route.key,
      when: route.activation,
      value: page,
    });
  },
});
```

下面示例使用 `t("中文", "English")` 代表 Module 的双语文本函数。固定界面文案必须同时提供 `zh-CN` 和 `en`；用户数据、路径和技术标识可以直接使用 `{ text: value }`。

## 公共壳与 Slot

一个常规页面由 Module 向公共 Slot 提交描述数据：

```ts
ctx.slots.register(slots.navigationSecondary, {
  id: "example.secondary",
  when: route.activation,
  value: {
    title: t("客户", "Customers"),
    icon: { kind: "system", name: "user" },
    items: [{
      id: "active",
      label: t("当前客户", "Current customers"),
      icon: { kind: "system", name: "folder" },
      selected: true,
      route: route.to(),
    }],
  },
});

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

右侧栏默认隐藏，由 Host 在 Header 增加打开按钮，并负责宽度、关闭、焦点返回和窄屏覆盖：

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

临时任务使用 `overlay`：`dialog` 适合居中确认或短表单，`drawer` 适合保留页面上下文的较长内容。不要在 `main.view` 自己实现全屏遮罩、焦点陷阱或关闭逻辑。

## 标准 Content List

对象列表栏优先使用 `ctx.ui.contentList()`。它统一负责上上级/上级标题、搜索、分组、三行信息、Badge、选中态、尾部动作、展开内容和 loading/empty/error 状态。

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
    placeholder: t("输入名称…", "Type a name…"),
    value: query,
    onInput(value) { query = value; },
  },
  empty: {
    title: t("没有匹配客户", "No matching customers"),
    description: t("换一个关键词再试试。", "Try another keyword."),
  },
  sections: [{
    id: "active",
    label: t("进行中", "Active"),
    items: customers
      .filter(customer => customer.name.includes(query))
      .map(customer => ({
        id: customer.id,
        title: { text: customer.name },
        meta: { text: customer.role },
        description: { text: customer.summary },
        icon: { kind: "system", name: "user" },
        badges: [{ label: t("已同步", "Synced"), tone: "success" }],
        selected: context.route.params.id === customer.id,
        route: detailRoute.to({ id: customer.id }),
      })),
  }],
}));
```

异步读取时返回明确状态，不要塞入占满整列的自定义错误卡：

```ts
return { ...shared, state: "loading", sections: [] };

return {
  ...shared,
  state: "error",
  error: {
    state: "error",
    title: t("列表加载失败", "List failed to load"),
    action: { label: t("重试", "Retry"), run: retry },
  },
  sections: [],
};
```

仅当对象行确实需要就地展示子内容时，才使用 `expanded`、`toggle` 和 `details`。关联对象跳转通常应使用文本链接或标准 route，而不是伪装成大按钮。

## 按钮、图标按钮与确认

```ts
const save = ctx.ui.button(
  {
    label: t("保存", "Save"),
    icon: { kind: "system", name: "check" },
    async run() { await saveRecord(); },
  },
  { tone: "primary" },
);

const remove = ctx.ui.confirmButton(
  {
    label: t("删除", "Delete"),
    icon: { kind: "system", name: "trash" },
    async run() { await deleteRecord(); },
  },
  {
    title: t("删除这条记录？", "Delete this record?"),
    description: t("删除后不能恢复。", "This cannot be undone."),
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

- `button`：有明确文字的普通动作；`tone` 可选 `default`、`primary`、`danger`。
- `iconButton`：空间紧张且图标含义稳定的动作；`label` 必填，并自动用于无障碍名称和悬停提示。
- `confirmButton`：删除、废弃、覆盖等执行前必须二次确认的动作。
- `confirm`：已有自定义触发器时，以 `await ctx.ui.confirm(...)` 获取布尔结果。
- 禁用动作使用 `disabled: true`，不要靠浅色 CSS 假装禁用。

## Badge、反馈与进度

Badge 只表示短状态或数量，不承载点击行为。Feedback 表示页面或局部区域的异步结果：

```ts
ctx.ui.badge({
  label: t("成功", "Success"),
  tone: "success",
  icon: { kind: "system", name: "check" },
});

ctx.ui.feedback({
  state: "error",
  title: t("加载失败", "Load failed"),
  description: t("请检查网络后重试。", "Check the network and retry."),
  action: { label: t("重试", "Retry"), run: retry },
});

ctx.ui.progress({
  label: t("评审进度", "Review progress"),
  value: 2,
  max: 3,
  description: t("2 / 3 已完成", "2 / 3 complete"),
});
```

Feedback 的 `state` 支持 `loading`、`empty`、`error`、`success`、`read-only`。未知完成比例的进度省略 `value/max`。

## Tabs 与 Segmented Control

`tabs` 用于切换不同页面或内容区域；`segmentedControl` 用于同一内容的少量互斥视图，例如“差异 / 完整内容”：

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

不要用 Segmented Control 代替主导航，也不要用 Tabs 表达表单中的单选值。

## 表单控件

公共表单控件统一提供 label、说明、必填、错误、禁用、只读和焦点视觉。它们是受控组件：状态由 Module 保存，变化后用句柄更新 Descriptor。建议把 Descriptor 写成函数，避免更新时遗漏回调：

```ts
let name = "";
let nameField: ReturnType<typeof ctx.ui.textField>;

const nameDescriptor = () => ({
  label: t("名称", "Name"),
  value: name,
  placeholder: t("输入名称…", "Type a name…"),
  required: true,
  error: name ? undefined : t("请输入名称", "Enter a name"),
  onInput(value: string) {
    name = value;
    nameField.update(nameDescriptor());
  },
});

nameField = ctx.ui.textField(nameDescriptor());
```

同一模式适用于 `searchField`、`textareaField`、`checkboxField` 和 `select`。Select 适合固定、小规模、不需要搜索的选项；Combobox 适合需要搜索或过滤的较长列表。

Combobox 必须分别保存“已选值”和“当前查询”。选择后再次展开时不要拿已选文案永久过滤掉其他选项：

```ts
let reviewerValue = "architecture";
let reviewerQuery = "";
let reviewer: ReturnType<typeof ctx.ui.combobox>;

const reviewerDescriptor = () => ({
  label: t("评审人", "Reviewer"),
  value: reviewerValue,
  query: reviewerQuery,
  placeholder: t("选择或搜索评审人…", "Select or search reviewers…"),
  options: reviewerOptions,
  onInput(query: string) {
    reviewerQuery = query;
    reviewer.updateDescriptor(reviewerDescriptor());
  },
  onChange(value: string) {
    reviewerValue = value;
    reviewerQuery = "";
    reviewer.updateDescriptor(reviewerDescriptor());
  },
});

reviewer = ctx.ui.combobox(reviewerDescriptor());
```

Combobox 返回 `ViewMount` 风格句柄，需要挂载到 Host 分配的 `portal` 上下文；不要自己计算下拉层坐标或 z-index。完整挂载代码直接参考 Reference Module。

## Disclosure、Card 与 Section

Disclosure 用于“标题 + 可展开内容”，箭头、展开态、键盘操作和无障碍属性由公共控件负责：

```ts
const details = ctx.ui.disclosure({
  title: t("详情", "Details"),
  description: t("点击标题展开或收起", "Select the heading to expand or collapse"),
  expanded: true,
  content: detailsElement,
  onToggle(expanded) { rememberExpandedState(expanded); },
});
```

Card 是有边界的视觉容器，Section 是页面内语义分区：

```ts
const card = ctx.ui.card({
  title: t("客户资料", "Customer profile"),
  tone: "info",
  content: profileElement,
  actions: [{ label: t("编辑", "Edit"), run: editProfile }],
});

const section = ctx.ui.section({
  title: t("最近活动", "Recent activity"),
  content: activityMount,
});
```

这些工厂返回 `ViewMount`。在父 `mount()` 中挂载后，必须在父清理函数中调用子 disposer。

## Theme 与自定义正文

公共控件不限制 Module 正文长什么样。自定义 CSS 只能作用于自己挂载的容器，并消费公开 Theme Token：

```css
[data-customer-canvas] {
  padding: var(--mem-view-space-5);
  color: var(--mem-view-color-text);
  background: var(--mem-view-color-canvas);
  font: var(--mem-view-font-size-base) / var(--mem-view-line-body)
    var(--mem-view-font-sans);
}
```

不要：

- 修改 `.view-shell-*`、`.mem-view-*` 或 `[data-view-slot]` 内部结构；
- 声明或覆盖 `--mem-view-*`；
- 用固定像素重建一套排版，或用 `!important` 压过 Host；
- 从 Module 读取或操作其他 Slot、其他 Module 或容器外 DOM。

系统图标使用 `{ kind: "system", name: "..." }`。可用名称以 `systemIconNames` 为准；深色按钮的 on-color、尺寸和 hover 由控件处理，不要给 SVG 单独写颜色。

## 哪些场景不要标准化成控件

Memory 的 Statement/Procedure/Schema 正文、ChangeSet 的差异与定位评论、Run 执行树、关系图、时间线、编辑器和画布都属于领域表达，应留在 Module 的 `main.view`。它们仍应使用 Theme Token，并可在内部复用 Button、Badge、Feedback 等公共控件，但不应要求框架理解领域数据。

## 提交前检查清单

- 一级/二级菜单、Header、内容列表和右侧栏是否通过 Slot 注册？
- 通用按钮、确认、状态、表单、折叠和容器是否使用 `ctx.ui`？
- 纯图标按钮是否提供准确 `label`，悬停和键盘聚焦时是否可理解？
- 控件是否覆盖 hover、focus、disabled、loading、empty、error 和 read-only？
- Select 与 Combobox 的外观是否能让用户预期它会展开？重新展开是否仍有完整选项？
- 受控字段更新后是否保持值、焦点、选区和 IME 输入？
- 所有子 `ViewMount` 是否在父清理时 dispose？
- 自定义 CSS 是否只作用于 Module 容器并仅使用 `--mem-view-*`？
- 是否同时检查 zh-CN/en、桌面和窄屏？
- 是否在 `/reference` 对照同类控件，并查看 Memory/Run 的真实用法？

## 继续查阅

- 从零创建 Module：[View Plugin Guide](./view-plugin-guide.md)
- 查询 Descriptor 字段：[View Plugin API](./view-plugin-api.md)
- 选择公共页面位置：[View Slot List](./view-slots.md)
- 理解框架边界：[View Plugin Design](./view-plugin-design.md)
