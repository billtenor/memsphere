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
  [data-reference-module] .reference-components { display:grid; max-width:var(--mem-view-layout-content-max); grid-template-columns:repeat(3,minmax(0,1fr)); gap:var(--mem-view-space-3); margin:0 auto var(--mem-view-space-4); }
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
    const english = config.locale === "en";
    const t = (zh: string, en: string) => ({ text: english ? en : zh } as const);
    const items = [
      { id: "canvas", title: t("关系画布", "Relationship canvas"), meta: t("自由业务正文", "Custom business body"), badge: t("自定义", "Custom"), icon: { kind: "system", name: "sparkle" } as const },
      { id: "notes", title: t("研究笔记", "Research notes"), meta: t("标准内容示例", "Standard content example"), badge: t("12", "12"), icon: { kind: "system", name: "file-text" } as const },
      { id: "very-long", title: t("这是一个用于验证长文本截断和列表几何稳定性的特别长条目名称", "A deliberately long item title for truncation and stable list geometry"), meta: t("辅助信息同样会安全截断", "Metadata truncates safely as well"), icon: { kind: "system", name: "stack" } as const }
    ];
    const list = ctx.ui.contentList((context): ContentListDescriptor => ({
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
        onInput(value) { filter = value; }
      },
      empty: { title: t("没有匹配对象", "No matching objects"), description: t("换一个关键词再试试。", "Try another keyword.") },
      sections: [{
        id: "examples",
        label: t("示例", "Examples"),
        items: items.filter(item => item.title.text.toLowerCase().includes(filter.toLowerCase())).map(item => ({
          ...item,
          selected: (context.route.query.item ?? "canvas") === item.id,
          route: route.to({}, { query: { item: item.id } })
        }))
      }]
    }));
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
      mount({ element }) {
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
            { title: t("删除这个示例？", "Delete this example?"), description: t("这是标准确认弹窗的演示，不会真的删除数据。", "This standard confirmation demo does not delete real data."), confirmLabel: t("确认删除", "Delete"), cancelLabel: t("取消", "Cancel"), tone: "danger" },
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
        components.append(actionsCard, statusCard, overlayCard);
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
        return () => { delete element.dataset.referenceModule; element.replaceChildren(); };
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
    ctx.slots.register(slots.overlay, { id: "reference.dialog", key: dialogRoute.key, when: dialogRoute.activation, value: { label: t("Dialog 示例", "Dialog example"), presentation: "dialog", background: dialogBackground, mount: overlayMount(t("Dialog 示例", "Dialog example"), t("这是由 Host 管理的居中浮层。", "This centered overlay is managed by the Host.")) } });
    ctx.slots.register(slots.overlay, { id: "reference.drawer", key: drawerRoute.key, when: drawerRoute.activation, value: { label: t("Drawer 示例", "Drawer example"), presentation: "drawer", background: drawerBackground, mount: overlayMount(t("Drawer 示例", "Drawer example"), t("这是由 Host 管理的抽屉浮层。", "This drawer overlay is managed by the Host.")) } });
    ctx.slots.register(slots.sidebarFooter, { id: "reference.ui-status", order: 5, value: { kind: "status", label: t("UI v1", "UI v1"), status: "healthy" } });
  }
});
