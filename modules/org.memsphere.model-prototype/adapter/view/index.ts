import { defineViewPlugin, slots, type ContentListDescriptor, type Disposer, type ViewMount, type ViewRenderContext } from "@memsphere/view-sdk";
import { definitionTable } from "./definition-tree.js";

const modelPrototypeStyles = `
  [data-model-prototype] { min-width:0; min-height:100%; padding:var(--mem-view-space-6); color:var(--mem-view-color-text); background:var(--mem-view-color-canvas); font:var(--mem-view-font-size-base)/var(--mem-view-line-body) var(--mem-view-font-sans); }
  [data-model-prototype] .model-prototype-body { max-width:var(--mem-view-layout-content-max); margin:0 auto; display:grid; min-width:0; gap:var(--mem-view-space-5); }
  [data-model-prototype] .model-prototype-heading { margin:0; font-size:var(--mem-view-font-size-xl); line-height:var(--mem-view-line-heading); overflow-wrap:anywhere; }
  [data-model-prototype] .model-prototype-description { margin:0; color:var(--mem-view-color-text-muted); }
  [data-model-prototype] .model-prototype-meta { display:grid; grid-template-columns:160px minmax(0,1fr); gap:var(--mem-view-space-2) var(--mem-view-space-4); margin:0; }
  [data-model-prototype] .model-prototype-meta dt { color:var(--mem-view-color-text-muted); }
  [data-model-prototype] .model-prototype-meta dd { margin:0; overflow-wrap:anywhere; font-family:var(--mem-view-font-mono); }
  [data-model-prototype] .model-prototype-code { min-width:0; max-width:100%; overflow:auto; white-space:pre; padding:var(--mem-view-space-4); margin:0; background:var(--mem-view-color-surface); border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-md); font:var(--mem-view-font-size-sm)/var(--mem-view-line-body) var(--mem-view-font-mono); }
  [data-model-prototype] .model-prototype-actions { display:flex; flex-wrap:wrap; gap:var(--mem-view-space-2); }
  [data-model-prototype] .model-prototype-form { display:grid; gap:var(--mem-view-space-4); max-width:720px; }
  [data-model-prototype] .model-definition-structure { display:grid; gap:var(--mem-view-space-3); min-width:0; }
  [data-model-prototype] .model-definition-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:var(--mem-view-space-4); }
  [data-model-prototype] .model-definition-text-action { min-height:var(--mem-view-space-6); border:0; background:transparent; padding:0; color:var(--mem-view-color-accent); font:400 var(--mem-view-font-size-sm)/var(--mem-view-line-compact) var(--mem-view-font-sans); cursor:pointer; }
  [data-model-prototype] .model-definition-text-action:hover:not(:disabled) { background:transparent; color:var(--mem-view-color-accent-hover); text-decoration:underline; }
  [data-model-prototype] .model-definition-text-action:focus-visible { outline:2px solid var(--mem-view-color-accent); outline-offset:2px; box-shadow:0 0 0 3px var(--mem-view-color-focus-ring); }
  [data-model-prototype] .model-prototype-definition-panel { min-width:0; }
  [data-model-prototype] .model-definition-table-scroll { max-width:100%; overflow:auto; border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-md); }
  [data-model-prototype] .model-definition-table { width:100%; min-width:560px; border-collapse:collapse; background:var(--mem-view-color-surface); font-size:var(--mem-view-font-size-sm); }
  [data-model-prototype] .model-definition-table th { text-align:left; background:var(--mem-view-color-canvas); color:var(--mem-view-color-text-muted); font-size:var(--mem-view-font-size-sm); }
  [data-model-prototype] .model-definition-table th, [data-model-prototype] .model-definition-table td { padding:var(--mem-view-space-2) var(--mem-view-space-3); border-bottom:1px solid var(--mem-view-color-border); vertical-align:top; }
  [data-model-prototype] .model-definition-table th { white-space:nowrap; }
  [data-model-prototype] .model-definition-table td:first-child { white-space:nowrap; }
  [data-model-prototype] .model-definition-table td:nth-child(2), [data-model-prototype] .model-definition-table td:nth-child(3), [data-model-prototype] .model-definition-table td:nth-child(4) { white-space:nowrap; }
  [data-model-prototype] .model-definition-table th:last-child { width:40%; }
  [data-model-prototype] .model-definition-table tr:last-child td { border-bottom:0; }
  [data-model-prototype] .model-definition-field { display:flex; align-items:stretch; min-height:1.5em; }
  [data-model-prototype] .model-definition-toggle, [data-model-prototype] .model-definition-leaf { display:inline-flex; align-items:center; gap:var(--mem-view-space-1); }
  [data-model-prototype] .model-definition-toggle { border:0; padding:0; background:transparent; color:var(--mem-view-color-text); font:inherit; cursor:pointer; }
  [data-model-prototype] .model-definition-toggle:hover { color:var(--mem-view-color-accent); }
  [data-model-prototype] .model-definition-arrow { display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box; width:var(--mem-view-space-4); height:var(--mem-view-space-4); flex:0 0 var(--mem-view-space-4); line-height:1; }
  [data-model-prototype] .model-definition-toggle .model-definition-arrow { border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-sm); background:var(--mem-view-color-canvas); color:var(--mem-view-color-text-muted); }
  [data-model-prototype] .model-definition-name { font-family:var(--mem-view-font-mono); }
  [data-model-prototype] .model-definition-indent { display:flex; flex-shrink:0; }
  [data-model-prototype] .model-definition-indent-step { width:var(--mem-view-space-4); flex:0 0 var(--mem-view-space-4); }
  [data-model-prototype] .model-definition-field-title, [data-model-prototype] .model-definition-node-label { align-self:center; margin-left:var(--mem-view-space-2); color:var(--mem-view-color-text-muted); font-size:var(--mem-view-font-size-sm); }
  [data-model-prototype] .model-definition-node-label { border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-sm); padding:0 var(--mem-view-space-1); }
  [data-model-prototype] .model-definition-table tr:is([data-definition-kind="element"], [data-definition-kind="dynamic-field"], [data-definition-kind="branch"]) td { background:var(--mem-view-color-canvas); color:var(--mem-view-color-text-muted); }
  [data-model-prototype] .model-definition-table tr:is([data-definition-kind="element"], [data-definition-kind="dynamic-field"], [data-definition-kind="branch"]) .model-definition-name { font-family:var(--mem-view-font-sans); }
  [data-model-prototype] .model-definition-table td.model-definition-format { min-width:8em; white-space:pre-line; overflow-wrap:anywhere; }
  [data-model-prototype] .model-definition-table td.model-definition-rules { min-width:8em; white-space:normal; overflow-wrap:anywhere; }
  @media (max-width:700px) {
    [data-model-prototype] { padding:var(--mem-view-space-4); }
    [data-model-prototype] .model-prototype-meta { grid-template-columns:1fr; }
    [data-model-prototype] .model-prototype-meta dd { margin-bottom:var(--mem-view-space-2); }
  }
`;

export default defineViewPlugin<{ locale?: string }>({
  name: "model-product-prototype",
  apiVersion: 1,
  inject: ["slots", "router", "theme", "ui"],
  themeVersion: 1,
  uiVersion: 1,
  apply(ctx, config) {
    if (!ctx.router || !ctx.theme || !ctx.ui) throw new Error("Model prototype requires router, theme and ui");
    const router = ctx.router;
    const ui = ctx.ui;
    const english = config.locale === "en";
    const text = (zh: string, en: string) => english ? en : zh;
    const t = (zh: string, en: string) => ({ text: text(zh, en) });
    const index = router.register({ id: "index", path: "/model-prototype", query: ["model"] });
    const storage = router.register({ id: "storage", path: "/model-prototype/storage" });
    const samples = [
      {
        id: "sales/order.json", title: text("订单", "Order"), description: text("订单编号、金额与订单明细的定义。", "Defines an order number, amount, and line items."), metaModel: "json-schema/draft-07.json", builtin: false,
        definition: { $schema: "http://json-schema.org/draft-07/schema#", title: "Order", type: "object", properties: { orderNo: { title: text("订单编号", "Order number"), type: "string", description: text("订单的唯一编号", "Unique order number") }, amount: { title: text("订单金额", "Order amount"), type: "number", minimum: 0 }, items: { title: text("订单明细", "Line items"), type: "array", items: { type: "object", properties: { productId: { title: text("商品编号", "Product ID"), type: "string" }, quantity: { title: text("数量", "Quantity"), type: "number", minimum: 1 } }, required: ["productId", "quantity"] } } }, required: ["orderNo", "amount", "items"] }
      },
      {
        id: "memsphere/run-status.json", title: text("运行状态", "Run status"), description: text("示例：运行的身份、名称与状态。", "Example: a run's identity, name and status."), metaModel: "json-schema/draft-07.json", builtin: false,
        definition: { $schema: "http://json-schema.org/draft-07/schema#", title: "Run status", type: "object", properties: { id: { type: "string" }, name: { type: "string" }, status: { type: "string", enum: ["running", "done", "abandoned"] } }, required: ["id", "name", "status"] }
      },
      {
        id: "memsphere/run/artifact.json", title: text("运行产物", "Run artifact"), description: text("项目装配的内置 raw 模型，展示原始内容的领域身份。", "A project-assembled raw model for managed Run content."), metaModel: "raw.json", builtin: true, definition: {}
      },
      {
        id: "broken-schema.json", title: text("无法读取的定义", "Unavailable definition"), description: text("用于评审单个模型失败时的展示。", "Demonstrates a failure isolated to one model."), metaModel: "json-schema/draft-07.json", builtin: false, definition: null
      }
    ];
    let query = "";
    let demoState: "ready" | "empty" | "loading" | "error" = "ready";
    let directory = "models/json-schema/draft-07";
    let savedDirectory = directory;
    let lastContext: ViewRenderContext | undefined;
    const list = ui.contentList((context): ContentListDescriptor => {
      lastContext = context;
      const shared = {
        label: t("模型列表", "Models"),
        header: { eyebrow: { text: ctx.module.projectId }, title: t("全部模型", "All models") },
        filter: { label: t("按模型 ID 或名称筛选", "Filter by model ID or name"), placeholder: t("查找模型…", "Find a model…"), value: query, onInput(value: string) { query = value; } },
        empty: { title: t("没有模型", "No models"), description: t("将模型定义放入项目配置的存储目录后刷新。", "Add definitions to the configured project directory and refresh.") }
      };
      if (demoState === "loading") return { ...shared, state: "loading", sections: [] };
      if (demoState === "error") return { ...shared, state: "error", sections: [], error: { state: "error", title: t("模型列表加载失败", "Could not load models"), description: t("检查项目存储配置后重试。", "Check the project's storage configuration and retry."), action: { label: t("重试", "Retry"), async run() { demoState = "ready"; await list.update?.(context); } } } };
      return { ...shared, sections: [{ id: "models", items: (demoState === "empty" ? [] : samples).filter(model => `${model.id} ${model.title}`.toLowerCase().includes(query.toLowerCase())).map(model => ({
        id: model.id, title: { text: model.title }, meta: { text: model.id }, description: { text: model.description }, icon: { kind: "system", name: "file-text" },
        badges: [{ label: { text: model.metaModel }, tone: "default" }, ...(model.builtin ? [{ label: t("内置", "Built-in"), tone: "info" as const }] : []), ...(model.definition === null ? [{ label: t("不可用", "Unavailable"), tone: "warning" as const }] : [])],
        selected: (context.route.query.model ?? samples[0].id) === model.id,
        route: index.to({}, { query: { model: model.id } })
      })) }] };
    });

    function metadata(entries: readonly (readonly [string, string])[]) {
      const dl = document.createElement("dl"); dl.className = "model-prototype-meta";
      for (const [label, value] of entries) {
        const dt = document.createElement("dt"); dt.textContent = label;
        const dd = document.createElement("dd"); dd.textContent = value;
        dl.append(dt, dd);
      }
      return dl;
    }
    function page(isStorage: boolean): ViewMount {
      let target: Parameters<ViewMount["mount"]>[0] | undefined;
      let disposers: Disposer[] = [];
      async function render(context: ViewRenderContext) {
        if (!target) return;
        for (const dispose of disposers.splice(0)) await dispose();
        const { element, portal } = target;
        element.dataset.modelPrototype = "";
        const style = document.createElement("style"); style.textContent = modelPrototypeStyles;
        const body = document.createElement("div"); body.className = "model-prototype-body";
        body.append(ui.feedback({ state: "read-only", title: t("产品原型 · 示例数据", "Product prototype · sample data"), description: t("用于确认页面交互；模型与配置尚未接入真实存储。", "For reviewing interactions; models and configuration are not connected to real storage yet.") }));
        element.replaceChildren(style, body);
        const heading = document.createElement("h2"); heading.className = "model-prototype-heading";
        if (isStorage) {
          heading.textContent = text("项目设置：模型存储", "Project settings: model storage"); body.append(heading);
          body.append(metadata([[text("当前项目", "Project"), ctx.module.projectId], [text("模型定义标准", "Definition standard"), "json-schema/draft-07.json"], [text("存储实现", "Storage implementation"), "memsphere/filesystem"]]));
          const form = document.createElement("div"); form.className = "model-prototype-form";
          let field: ReturnType<typeof ui.textField>;
          const descriptor = () => ({ label: t("存储目录", "Storage directory"), value: directory, required: true, description: t("相对路径以登记的 Project 根目录为基准，不是 Git 或 Memory 目录；也可填写绝对路径。更改目录只切换读取位置，不搬运原文件。", "Relative paths use the registered Project root, not the Git or Memory directory. Absolute paths are also accepted. Changing the directory switches the location without moving files."), error: directory.trim() ? undefined : t("请填写存储目录", "Enter a storage directory"), onInput(value: string) { directory = value; field.update(descriptor()); } });
          field = ui.textField(descriptor()); form.append(field.root);
          const actions = document.createElement("div"); actions.className = "model-prototype-actions";
          const status = document.createElement("div"); status.setAttribute("aria-live", "polite");
          actions.append(ui.button({ label: t("保存预览", "Preview save"), run() { field.update(descriptor()); if (!directory.trim()) { field.control.focus(); return; } savedDirectory = directory; status.replaceChildren(ui.feedback({ state: "success", title: t("原型会话已保存", "Saved in the prototype session"), description: t("真实项目配置未修改。", "The real project configuration has not changed.") })); } }, { tone: "primary" }), ui.button({ label: t("放弃修改", "Discard changes"), run() { directory = savedDirectory; field.update(descriptor()); status.replaceChildren(); } }));
          form.append(actions, status); body.append(form);
          return;
        }
        const id = context.route.query.model ?? samples[0].id;
        const model = samples.find(sample => sample.id === id);
        if (!model) { body.append(ui.feedback({ state: "empty", title: t("模型不存在", "Model not found"), description: { text: id } })); return; }
        heading.textContent = model.title;
        const description = document.createElement("p"); description.className = "model-prototype-description"; description.textContent = model.description;
        body.append(heading, description, metadata([[text("模型 ID", "Model ID"), model.id], [text("模型定义标准", "Definition standard"), model.metaModel], [text("来源", "Source"), model.builtin ? text("项目内置", "Project built-in") : text("模型定义存储", "Model definition store")]]));
        if (model.definition === null) { body.append(ui.feedback({ state: "error", title: t("读取模型定义失败", "Could not read the definition"), description: t("示例文件包含无效 JSON。其他模型仍可查看。", "The sample file contains invalid JSON. Other models remain available.") })); return; }
        const definition = JSON.stringify(model.definition, null, 2);
        const code = document.createElement("pre"); code.className = "model-prototype-code"; code.textContent = definition;
        const structure = model.metaModel === "raw.json"
          ? ui.feedback({ state: "read-only", title: t("原始内容模型", "Raw content model"), description: t("此模型不声明成员字段；内容可以是文件、图片等原始载荷。", "This model does not declare member fields. Its content may be a file, image or another raw payload.") })
          : definitionTable(ui, model.definition, text);
        const panel = document.createElement("div");
        panel.className = "model-prototype-definition-panel";
        const switcher = document.createElement("div");
        function selectView(selectedId: string) {
          switcher.replaceChildren(ui.segmentedControl({
            label: t("模型定义展示方式", "Model definition view"), selectedId,
            items: [{ id: "structure", label: t("模型结构", "Model structure") }, { id: "source", label: t("原始定义", "Source definition") }],
            onSelect: selectView
          }));
          panel.replaceChildren(selectedId === "structure" ? structure : code);
        }
        selectView("structure");
        body.append(switcher, panel);
        const demo = document.createElement("div");
        demo.append(ui.select({ label: t("原型演示：列表状态", "Prototype demo: list state"), value: demoState, options: [{ value: "ready", label: t("正常", "Ready") }, { value: "empty", label: t("空项目", "Empty project") }, { value: "loading", label: t("加载中", "Loading") }, { value: "error", label: t("加载失败", "Load failed") }], async onChange(value) { demoState = value as typeof demoState; if (lastContext) await list.update?.(lastContext); } }).root);
        const section = ui.section({ title: t("产品评审辅助", "Product review controls"), content: demo });
        const sectionRoot = document.createElement("div"); body.append(sectionRoot);
        const dispose = await section.mount({ element: sectionRoot, portal }, context);
        if (typeof dispose === "function") disposers.push(dispose);
      }
      return { async mount(value, context) { target = value; await render(context); return async () => { for (const dispose of disposers.splice(0)) await dispose(); delete value.element.dataset.modelPrototype; value.element.replaceChildren(); target = undefined; }; }, update: render };
    }
    const detailPage = page(false);
    const storagePage = page(true);
    // The accepted prototype remains addressable; the production Models module owns primary navigation.
    for (const [route, settings] of [[index, false], [storage, true]] as const) {
      const routeId = settings ? "storage" : "index";
      ctx.slots.register(slots.navigationSecondary, { id: `model-prototype.secondary.${routeId}`, when: route.activation, value: { title: t("模型", "Models"), icon: { kind: "system", name: "stack" }, items: [{ id: "models", label: t("全部模型", "All models"), icon: { kind: "system", name: "stack" }, selected: !settings, route: index.to() }, { id: "storage", label: t("存储设置预览", "Storage settings preview"), icon: { kind: "system", name: "gear-six" }, selected: settings, route: storage.to() }], footer: t("产品设计原型", "Product design prototype") } });
      ctx.slots.register(slots.headerTitle, { id: `model-prototype.header.${routeId}`, when: route.activation, value: { title: settings ? t("模型存储", "Model storage") : t("模型", "Models"), subtitle: { text: ctx.module.projectId }, breadcrumbs: [{ label: t("模型", "Models"), route: index.to() }, { label: settings ? t("设置预览", "Settings preview") : t("模型定义", "Definitions") }] } });
      ctx.slots.register(slots.mainView, { id: `model-prototype.main.${routeId}`, key: route.key, when: route.activation, value: settings ? storagePage : detailPage });
    }
    ctx.slots.register(slots.contentList, { id: "model-prototype.list", when: index.activation, value: list });
    ctx.slots.register(slots.headerActions, { id: "model-prototype.refresh", when: index.activation, value: { label: t("刷新模型", "Refresh models"), icon: { kind: "system", name: "arrows-clockwise" }, async run() { demoState = "ready"; if (lastContext) await list.update?.(lastContext); } } });
  }
});
