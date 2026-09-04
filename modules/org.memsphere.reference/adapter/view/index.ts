import {
  defineViewPlugin,
  slots,
  type ContentListDescriptor,
  type ViewMount
} from "@memsphere/view-sdk";

type ReferenceConfig = {
  locale?: string;
};

const referenceStyles = `
  [data-reference-module] { min-height:100%; padding:var(--mem-view-space-6); background:var(--mem-view-color-canvas); color:var(--mem-view-color-text); font:var(--mem-view-font-size-base)/var(--mem-view-line-body) var(--mem-view-font-sans); }
  [data-reference-module] .reference-hero { max-width:var(--mem-view-layout-content-max); margin:0 auto var(--mem-view-space-5); }
  [data-reference-module] .reference-eyebrow { color:var(--mem-view-color-accent); font-size:var(--mem-view-font-size-sm); font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
  [data-reference-module] h2 { margin:var(--mem-view-space-2) 0; font-size:var(--mem-view-font-size-xl); line-height:var(--mem-view-line-heading); }
  [data-reference-module] p { color:var(--mem-view-color-text-muted); }
  [data-reference-module] .reference-lab { display:grid; max-width:var(--mem-view-layout-content-max); grid-template-columns:minmax(0,1.3fr) minmax(240px,.7fr); gap:var(--mem-view-space-4); margin:0 auto; }
  [data-reference-module] .reference-canvas, [data-reference-module] .reference-inspector { border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-lg); background:var(--mem-view-color-surface); box-shadow:var(--mem-view-shadow-card); }
  [data-reference-module] .reference-canvas { position:relative; min-height:360px; overflow:hidden; padding:var(--mem-view-space-5); background-image:radial-gradient(var(--mem-view-color-border) 1px, transparent 1px); background-size:20px 20px; }
  [data-reference-module] .reference-node { position:absolute; display:grid; width:150px; min-height:82px; place-content:center; border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-md); background:var(--mem-view-color-surface); color:var(--mem-view-color-text); text-align:center; }
  [data-reference-module] .reference-node:first-of-type { top:72px; left:54px; }
  [data-reference-module] .reference-node:last-of-type { right:54px; bottom:72px; border-color:var(--mem-view-color-accent); background:var(--mem-view-color-accent-soft); }
  [data-reference-module] .reference-line { position:absolute; top:50%; left:30%; width:42%; height:2px; background:var(--mem-view-color-accent); transform:rotate(18deg); transform-origin:left; }
  [data-reference-module] .reference-inspector { padding:var(--mem-view-space-5); }
  [data-reference-module] .reference-count { display:block; margin:var(--mem-view-space-5) 0; color:var(--mem-view-color-accent); font-size:var(--mem-view-font-size-display); font-weight:700; }
  [data-reference-module] .reference-components { display:grid; max-width:var(--mem-view-layout-content-max); grid-template-columns:repeat(3,minmax(0,1fr)); align-items:start; gap:var(--mem-view-space-3); margin:0 auto var(--mem-view-space-4); }
  [data-reference-module] .reference-component-column { display:grid; min-width:0; align-content:start; gap:var(--mem-view-space-3); }
  [data-reference-module] .reference-component-card { min-width:0; border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-lg); background:var(--mem-view-color-surface); padding:var(--mem-view-space-4); box-shadow:var(--mem-view-shadow-card); }
  [data-reference-module] .reference-component-card > strong { display:block; margin-bottom:var(--mem-view-space-3); font-size:var(--mem-view-font-size-md); }
  [data-reference-module] .reference-component-row { display:flex; flex-wrap:wrap; align-items:center; gap:var(--mem-view-space-2); }
  [data-reference-module] .reference-component-card .mem-view-empty-state { min-height:120px; padding:var(--mem-view-space-3); }
  [data-reference-panel] { display:grid; gap:var(--mem-view-space-4); padding:var(--mem-view-space-4); color:var(--mem-view-color-text); font:var(--mem-view-font-size-base)/var(--mem-view-line-body) var(--mem-view-font-sans); }
  [data-reference-panel] section { display:grid; gap:var(--mem-view-space-3); border-bottom:1px solid var(--mem-view-color-border); padding-bottom:var(--mem-view-space-4); }
  [data-reference-panel] p { margin:0; color:var(--mem-view-color-text-muted); }
  [data-reference-overlay] { display:grid; min-height:100%; place-content:center; justify-items:center; gap:var(--mem-view-space-3); padding:var(--mem-view-space-6); color:var(--mem-view-color-text); text-align:center; }
  @media (max-width:900px) {
    [data-reference-module] { padding:var(--mem-view-space-4); }
    [data-reference-module] .reference-lab { grid-template-columns:1fr; }
    [data-reference-module] .reference-components { grid-template-columns:1fr; }
  }
`;

export default defineViewPlugin<ReferenceConfig>({
  name: "memsphere-view-reference",
  apiVersion: 1,
  inject: ["slots", "router", "theme", "ui"],
  themeVersion: 1,
  uiVersion: 1,
  apply(ctx, config) {
    if (!ctx.router || !ctx.theme || !ctx.ui) throw new Error("Reference Module requires router, theme, and ui");
    const route = ctx.router.register({ id: "index", path: "/reference", query: ["item"] });
    const dialogRoute = ctx.router.register({ id: "dialog", path: "/reference/dialog" });
    const drawerRoute = ctx.router.register({ id: "drawer", path: "/reference/drawer" });
    const dialogBackground = ctx.router.project({ from: dialogRoute, to: route, params: {} });
    const drawerBackground = ctx.router.project({ from: drawerRoute, to: route, params: {} });
    let filter = "";
    let count = 2;
    let expandedListItem = true;
    let listDemoState: "ready" | "loading" | "error" = "ready";
    const english = config.locale === "en";
    const t = (zh: string, en: string) => ({ text: english ? en : zh } as const);
    const items = [
      { id: "canvas", title: t("关系画布", "Relationship canvas"), meta: t("自由业务正文", "Custom business body"), badge: t("自定义", "Custom"), icon: { kind: "system", name: "sparkle" } as const },
      { id: "notes", title: t("研究笔记", "Research notes"), meta: t("标准内容示例", "Standard content example"), badge: t("12", "12"), icon: { kind: "system", name: "file-text" } as const },
      { id: "very-long", title: t("这是一个用于验证长文本截断和列表几何稳定性的特别长条目名称", "A deliberately long item title for truncation and stable list geometry"), meta: t("辅助信息同样会安全截断", "Metadata truncates safely as well"), icon: { kind: "system", name: "stack" } as const }
    ];
    const list = ctx.ui.contentList((context): ContentListDescriptor => {
      const shared = {
        label: t("参考对象列表", "Reference objects"),
        header: {
        eyebrow: t("原型", "Prototype"),
        title: t("组件参考", "Component reference"),
        action: { label: t("刷新列表", "Refresh list"), icon: { kind: "system", name: "arrows-clockwise" }, run() {} }
        },
        filter: {
        label: t("筛选对象", "Filter objects"),
        placeholder: t("输入名称…", "Type a name…"),
        value: filter,
        onInput(value: string) { filter = value; }
        }
      } as const;
      if (listDemoState === "loading") return { ...shared, state: "loading", sections: [] };
      if (listDemoState === "error") return {
        ...shared,
        state: "error",
        error: { state: "error", title: t("列表加载失败", "List failed to load"), action: { label: t("重试列表", "Retry list"), run() {} } },
        sections: []
      };
      return {
        ...shared,
        empty: { title: t("没有匹配对象", "No matching objects"), description: t("换一个关键词再试试。", "Try another keyword.") },
        sections: [{
        id: "examples",
        label: t("示例", "Examples"),
        items: items.filter(item => item.title.text.toLowerCase().includes(filter.toLowerCase())).map(item => {
          const common = {
            ...item,
            selected: (context.route.query.item ?? "canvas") === item.id,
            route: route.to({}, { query: { item: item.id } })
          };
          if (item.id !== "canvas") return common;
          if (!common.selected) return common;
          return {
            ...common,
            description: t("第三行描述展示标准列表的信息层级", "A third line demonstrates the standard list hierarchy"),
            badges: [
              { label: t("已同步", "Synced"), tone: "success" as const },
              { label: t("画布", "Canvas"), tone: "info" as const }
            ],
            trailingActions: [{ label: t("标记收藏", "Bookmark"), icon: { kind: "system" as const, name: "check" }, run() {} }],
            expanded: expandedListItem,
            toggle: { label: t(expandedListItem ? "收起详情" : "展开详情", expandedListItem ? "Collapse details" : "Expand details"), icon: { kind: "system" as const, name: "caret-down" }, async run() { expandedListItem = !expandedListItem; await list.update?.(context); } },
            details: { mount({ element }) { element.textContent = english ? "Nested business details mounted and disposed by Content List." : "由 Content List 挂载并清理的嵌套业务详情。"; return () => element.replaceChildren(); } }
          };
        })
        }]
      };
    });
    const overlayMount = (title: ReturnType<typeof t>, description: ReturnType<typeof t>): ViewMount => ({
      mount({ element }) {
        element.dataset.referenceOverlay = "";
        const heading = document.createElement("h2");
        heading.textContent = title.text;
        const copy = document.createElement("p");
        copy.textContent = description.text;
        const badge = ctx.ui!.badge(t("Overlay Slot", "Overlay Slot"));
        element.append(badge, heading, copy);
        return () => { delete element.dataset.referenceOverlay; element.replaceChildren(); };
      }
    });
    const sidePanel: ViewMount = {
      mount({ element }) {
        element.dataset.referencePanel = "";
        const intro = document.createElement("section");
        const title = document.createElement("strong");
        title.textContent = english ? "Context without losing the page" : "不离开页面的上下文";
        const copy = document.createElement("p");
        copy.textContent = english
          ? "The Shell owns this panel's width, close control, focus target and responsive behavior."
          : "面板宽度、关闭按钮、焦点返回和响应式行为都由 Shell 负责。";
        intro.append(title, copy, ctx.ui!.badge(t("默认隐藏", "Hidden by default")));
        const actions = document.createElement("section");
        const actionTitle = document.createElement("strong");
        actionTitle.textContent = english ? "Reusable primitives" : "通用交互组件";
        const row = document.createElement("div");
        row.className = "reference-component-row";
        row.append(
          ctx.ui!.button({ label: t("保存", "Save"), icon: { kind: "system", name: "check" }, run() {} }, { tone: "primary" }),
          ctx.ui!.iconButton({ label: t("更多操作", "More actions"), icon: { kind: "system", name: "dots-three" }, run() {} })
        );
        actions.append(actionTitle, row);
        element.append(intro, actions, ctx.ui!.emptyState({ title: t("没有更多详情", "No more details"), description: t("空状态也使用框架组件。", "Empty states also come from the framework.") }));
        return () => { delete element.dataset.referencePanel; element.replaceChildren(); };
      }
    };
    const main: ViewMount = {
      async mount({ element, portal }, context) {
        element.dataset.referenceModule = "";
        const style = document.createElement("style");
        style.dataset.referenceStyles = "";
        style.textContent = referenceStyles;
        const hero = document.createElement("header");
        hero.className = "reference-hero";
        const eyebrow = document.createElement("span");
        eyebrow.className = "reference-eyebrow";
        eyebrow.textContent = "Reference Module";
        const heading = document.createElement("h2");
        heading.textContent = english ? "A standard shell with a free-form body" : "标准公共壳，自由业务正文";
        const description = document.createElement("p");
        description.textContent = english
          ? "Navigation, header and list come from framework descriptors. The canvas below belongs entirely to this Module."
          : "导航、Header 和列表由框架描述数据生成；下面的关系画布完全属于 Module。";
        hero.append(eyebrow, heading, description);
        const components = document.createElement("section");
        components.className = "reference-components";
        const card = (titleText: string) => {
          const container = document.createElement("article");
          container.className = "reference-component-card";
          const title = document.createElement("strong");
          title.textContent = titleText;
          container.append(title);
          return container;
        };
        const actionsCard = card(english ? "Buttons" : "按钮");
        const actionRow = document.createElement("div");
        actionRow.className = "reference-component-row";
        actionRow.append(
          ctx.ui!.button({ label: t("默认按钮", "Default"), run() {} }),
          ctx.ui!.button({ label: t("主要按钮", "Primary"), icon: { kind: "system", name: "plus" }, run() {} }, { tone: "primary" }),
          ctx.ui!.iconButton({ label: t("图标按钮", "Icon button"), icon: { kind: "system", name: "gear-six" }, run() {} }),
          ctx.ui!.button({ label: t("禁用", "Disabled"), disabled: true, run() {} }),
          ctx.ui!.confirmButton(
            { label: t("删除示例", "Delete example"), icon: { kind: "system", name: "trash" }, run() {} },
            { title: t("删除这个示例？", "Delete this example?"), description: t("这是标准确认弹窗的演示，不会真的删除数据。", "This standard confirmation demo does not delete real data."), confirmLabel: t("确认删除", "Delete"), cancelLabel: t("取消", "Cancel"), closeLabel: t("关闭", "Close"), tone: "danger" },
            { tone: "danger" }
          )
        );
        actionsCard.append(actionRow);
        const statusCard = card(english ? "Badges and status" : "徽标与状态");
        const statusRow = document.createElement("div");
        statusRow.className = "reference-component-row";
        statusRow.append(ctx.ui!.badge(t("就绪", "Ready")), ctx.ui!.badge(t("12 项", "12 items")), ctx.ui!.badge(t("UI v1", "UI v1")));
        statusCard.append(statusRow);
        const overlayCard = card(english ? "Page overlays" : "页面浮层");
        const overlayRow = document.createElement("div");
        overlayRow.className = "reference-component-row";
        overlayRow.append(
          ctx.ui!.button({ label: t("打开 Dialog", "Open dialog"), run: () => ctx.router!.navigate(dialogRoute.to()) }),
          ctx.ui!.button({ label: t("打开 Drawer", "Open drawer"), run: () => ctx.router!.navigate(drawerRoute.to()) })
        );
        overlayCard.append(overlayRow);
        const feedbackCard = card(english ? "Feedback" : "反馈状态");
        feedbackCard.append(
          ctx.ui!.feedback({ state: "loading", title: t("正在加载", "Loading"), description: t("异步内容正在准备。", "Preparing asynchronous content.") }),
          ctx.ui!.feedback({ state: "success", title: t("保存成功", "Saved"), description: t("状态反馈来自公共组件。", "Feedback comes from the shared UI.") }),
          ctx.ui!.feedback({ state: "error", title: t("加载失败", "Load failed"), action: { label: t("重试", "Retry"), run() {} } }),
          ctx.ui!.feedback({ state: "read-only", title: t("只读内容", "Read-only content"), description: t("当前内容不能编辑。", "This content cannot be edited.") })
        );
        const navigationCard = card(english ? "Tabs and segmented control" : "选项卡与分段选择");
        navigationCard.append(
          ctx.ui!.tabs({
            label: t("示例选项卡", "Example tabs"), selectedId: "overview",
            items: [
              { id: "overview", label: t("概览", "Overview"), route: route.to() },
              { id: "activity", label: t("动态", "Activity"), action: { label: t("动态", "Activity"), run() {} } }
            ]
          }),
          ctx.ui!.segmentedControl({
            label: t("内容模式", "Content mode"), selectedId: "diff",
            items: [{ id: "diff", label: t("差异", "Diff") }, { id: "full", label: t("完整内容", "Full content") }],
            onSelect() {}
          })
        );
        const formCard = card(english ? "Form fields" : "表单字段");
        const textField = ctx.ui!.textField({ label: t("名称", "Name"), value: "Memsphere", placeholder: t("输入名称…", "Type a name…"), onInput() {} });
        const searchField = ctx.ui!.searchField({ label: t("搜索", "Search"), value: "", placeholder: t("搜索组件…", "Search components…"), onInput() {} });
        const textarea = ctx.ui!.textareaField({ label: t("说明", "Description"), value: "", placeholder: t("输入详细说明…", "Add details…"), error: t("请填写说明", "Description is required"), onInput() {} });
        const checkbox = ctx.ui!.checkboxField({ label: t("启用通知", "Enable notifications"), checked: true, onChange() {} });
        const select = ctx.ui!.select({
          label: t("优先级", "Priority"), value: "normal",
          options: [{ value: "normal", label: t("普通", "Normal") }, { value: "high", label: t("高", "High") }], onChange() {}
        });
        const comboboxHost = document.createElement("div");
        let reviewerValue = "architecture";
        let reviewerQuery = "";
        const reviewerOptions = [
          { value: "architecture", label: t("架构师", "Architect") },
          { value: "development", label: t("研发工程师", "Developer") },
          { value: "testing", label: t("测试工程师", "Tester") }
        ];
        let comboboxMount: ReturnType<NonNullable<typeof ctx.ui>["combobox"]>;
        const comboboxDescriptor = () => ({
          label: t("评审人", "Reviewer"), value: reviewerValue, query: reviewerQuery, placeholder: t("选择或搜索评审人…", "Select or search reviewers…"), options: reviewerOptions,
          onInput(query: string) { reviewerQuery = query; comboboxMount.updateDescriptor(comboboxDescriptor()); },
          onChange(value: string) { reviewerValue = value; reviewerQuery = reviewerOptions.find(option => option.value === value)?.label.text ?? ""; comboboxMount.updateDescriptor(comboboxDescriptor()); }
        });
        comboboxMount = ctx.ui!.combobox(comboboxDescriptor());
        const disposeCombobox = await comboboxMount.mount({ element: comboboxHost, portal }, context);
        formCard.append(textField.root, searchField.root, textarea.root, checkbox.root, select.root, comboboxHost);
        const progressCard = card(english ? "Progress and badges" : "进度与徽标");
        const badgeRow = document.createElement("div");
        badgeRow.className = "reference-component-row";
        badgeRow.append(
          ctx.ui!.badge({ label: t("信息", "Info"), tone: "info" }),
          ctx.ui!.badge({ label: t("成功", "Success"), tone: "success", icon: { kind: "system", name: "check" } }),
          ctx.ui!.badge({ label: t("警告", "Warning"), tone: "warning" }),
          ctx.ui!.badge({ label: t("危险", "Danger"), tone: "danger" })
        );
        progressCard.append(badgeRow, ctx.ui!.progress({ label: t("评审进度", "Review progress"), value: 2, max: 3, description: t("2 / 3 已完成", "2 / 3 complete") }), ctx.ui!.progress({ label: t("后台处理中", "Processing"), description: t("不确定进度", "Indeterminate progress") }));
        const listStateCard = card(english ? "List panel states" : "列表栏状态");
        const listStateDescription = document.createElement("p");
        listStateDescription.textContent = english
          ? "Switch the real Content List on the left between its standard states."
          : "切换左侧真实内容列表的标准状态。";
        listStateCard.append(listStateDescription, ctx.ui!.segmentedControl({
          label: t("列表栏状态", "List panel state"),
          selectedId: listDemoState,
          items: [
            { id: "ready", label: t("正常", "Ready") },
            { id: "loading", label: t("加载", "Loading") },
            { id: "error", label: t("失败", "Failed") }
          ],
          async onSelect(id) {
            listDemoState = id as typeof listDemoState;
            await list.update?.(context);
          }
        }));
        const containerCard = card(english ? "Containers and disclosure" : "容器与折叠");
        const disclosureHost = document.createElement("div");
        const nestedCardHost = document.createElement("div");
        containerCard.append(disclosureHost, nestedCardHost);
        const disclosureContent = document.createElement("p");
        disclosureContent.textContent = english ? "Business content stays owned by the Module." : "业务内容仍然由 Module 自己负责。";
        const disclosureMount = ctx.ui!.disclosure({ title: t("详情", "Details"), description: t("点击标题展开或收起", "Select the heading to expand or collapse"), expanded: true, content: disclosureContent });
        const nestedContent = document.createElement("p");
        nestedContent.textContent = english ? "A reusable visual container." : "一个可复用的视觉容器。";
        const nestedCardMount = ctx.ui!.card({ title: t("标准卡片", "Standard card"), tone: "info", content: nestedContent });
        const disposeDisclosure = await disclosureMount.mount({ element: disclosureHost, portal }, context);
        const disposeCard = await nestedCardMount.mount({ element: nestedCardHost, portal }, context);
        const interactionColumn = document.createElement("div");
        interactionColumn.className = "reference-component-column";
        interactionColumn.append(actionsCard, feedbackCard, progressCard);
        const stateColumn = document.createElement("div");
        stateColumn.className = "reference-component-column";
        stateColumn.append(statusCard, navigationCard, listStateCard);
        const structureColumn = document.createElement("div");
        structureColumn.className = "reference-component-column";
        structureColumn.append(overlayCard, formCard, containerCard);
        components.append(interactionColumn, stateColumn, structureColumn);
        const lab = document.createElement("section");
        lab.className = "reference-lab";
        const canvas = document.createElement("div");
        canvas.className = "reference-canvas";
        const line = document.createElement("span");
        line.className = "reference-line";
        const agentNode = document.createElement("button");
        agentNode.className = "reference-node";
        agentNode.type = "button";
        agentNode.textContent = "Agent";
        const memoryNode = document.createElement("button");
        memoryNode.className = "reference-node";
        memoryNode.type = "button";
        memoryNode.textContent = "Memory";
        canvas.append(line, agentNode, memoryNode);
        const inspector = document.createElement("aside");
        inspector.className = "reference-inspector";
        const title = document.createElement("strong");
        title.textContent = english ? "Custom interaction" : "自定义交互";
        const value = document.createElement("output");
        value.className = "reference-count";
        value.textContent = String(count);
        const add = ctx.ui!.button({ label: t("添加节点", "Add node"), icon: { kind: "system", name: "plus" }, run() { count += 1; value.textContent = String(count); } }, { tone: "primary" });
        inspector.append(title, value, add);
        lab.append(canvas, inspector);
        element.append(style, hero, components, lab);
        return async () => {
          await disposeDisclosure?.();
          await disposeCard?.();
          await disposeCombobox?.();
          delete element.dataset.referenceModule;
          element.replaceChildren();
        };
      }
    };

    ctx.slots.register(slots.navigationPrimary, { id: "reference.navigation", order: 90, value: { label: t("原型", "Prototype"), icon: { kind: "system", name: "sparkle" }, route: route.to() } });
    ctx.slots.register(slots.navigationSecondary, { id: "reference.secondary", when: route.activation, value: { title: t("原型", "Prototype"), icon: { kind: "system", name: "sparkle" }, items: [{ id: "overview", label: t("组件参考", "Component reference"), icon: { kind: "system", name: "stack" }, selected: true, route: route.to() }], footer: t("公共壳由框架渲染", "Framework-rendered shell") } });
    ctx.slots.register(slots.headerTitle, { id: "reference.header", when: route.activation, value: { title: t("组件参考", "Component reference"), subtitle: t("真实 Module · 公共壳标准化演示", "Real Module · standardized shell demo"), breadcrumbs: [{ label: t("原型", "Prototype") }, { label: t("组件参考", "Component reference") }] } });
    ctx.slots.register(slots.headerActions, { id: "reference.status", order: 10, when: route.activation, value: { label: t("框架就绪", "Framework ready"), icon: { kind: "system", name: "check-circle" }, tone: "success", run() {} } });
    ctx.slots.register(slots.headerActions, { id: "reference.actions", order: 20, when: route.activation, value: { label: t("刷新原型", "Refresh prototype"), icon: { kind: "system", name: "arrows-clockwise" }, run() { globalThis.location?.reload(); } } });
    ctx.slots.register(slots.contentList, { id: "reference.list", when: route.activation, value: list });
    ctx.slots.register(slots.sidePanel, { id: "reference.inspector", when: route.activation, value: { label: t("组件检查器", "Component inspector"), icon: { kind: "system", name: "sidebar-simple" }, mount: sidePanel } });
    ctx.slots.register(slots.mainView, { id: "reference.main", key: route.key, when: route.activation, value: main });
    ctx.slots.register(slots.overlay, { id: "reference.dialog", key: dialogRoute.key, when: dialogRoute.activation, value: { label: t("Dialog 示例", "Dialog example"), presentation: "dialog", size: "compact", background: dialogBackground, mount: overlayMount(t("Dialog 示例", "Dialog example"), t("这是由 Host 管理的居中浮层。", "This centered overlay is managed by the Host.")) } });
    ctx.slots.register(slots.overlay, { id: "reference.drawer", key: drawerRoute.key, when: drawerRoute.activation, value: { label: t("Drawer 示例", "Drawer example"), presentation: "drawer", size: "compact", background: drawerBackground, mount: overlayMount(t("Drawer 示例", "Drawer example"), t("这是由 Host 管理的抽屉浮层。", "This drawer overlay is managed by the Host.")) } });
    ctx.slots.register(slots.sidebarFooter, { id: "reference.ui-status", order: 5, value: { kind: "status", label: t("UI v1", "UI v1"), status: "healthy" } });
  }
});
