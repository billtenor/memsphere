import { defineViewPlugin, slots, portableSlots, type ContentListDescriptor, type ViewMount, type ViewRenderContext, type ModelPresentationSummary, type ModelPresentationDefinition, type ModelDefinitionPresentationContext } from "@memsphere/view-sdk";
import { definitionTable } from "../../../shared/model-definition.js";
import { modelStyles } from "./styles.js";

type ModelSummary = ModelPresentationSummary;
type ModelDefinition = ModelPresentationDefinition;

export default defineViewPlugin<{ locale?: string; projectApiBase?: string }>({
  name: "memsphere-models", apiVersion: 1, inject: ["slots", "router", "theme", "ui"], themeVersion: 1, uiVersion: 1,
  apply(ctx, config) {
    if (!ctx.router || !ctx.ui || !ctx.theme) throw new Error("Models require router, theme and ui");
    const ui = ctx.ui;
    ctx.slots.register(portableSlots.modelDefinitionRenderer, {
      id: "models.definition.official", key: "definition", priority: 1000,
      value: { render(input) { return input.defaultRender(); } }
    });
    const index = ctx.router.register({ id: "index", path: "/models", query: ["model"] });
    const text = (zh: string, en: string) => config.locale === "en" ? en : zh;
    const t = (zh: string, en: string) => ({ text: text(zh, en) });
    let models: ModelSummary[] | undefined;
    let query = "";
    let loading = true;
    let loadError: string | undefined;
    let listContext: ViewRenderContext | undefined;
    let pageContext: ViewRenderContext | undefined;
    let element: HTMLElement | undefined;
    let listController = new AbortController();
    let detailController = new AbortController();
    let listGeneration = 0;
    let detailGeneration = 0;
    ctx.lifecycle.own(() => { listController.abort(); detailController.abort(); });
    const request = async <T,>(path: string, signal: AbortSignal): Promise<T> => {
      const response = await fetch(`${config.projectApiBase ?? "/api"}${path}`, { signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      return payload as T;
    };
    const listContent = ui.contentList((context): ContentListDescriptor => {
      listContext = context;
      const shared = {
        label: t("模型列表", "Models"),
        header: { eyebrow: { text: ctx.module.projectId }, title: t("全部模型", "All models") },
        filter: { label: t("按模型 ID 或名称筛选", "Filter by model ID or name"), value: query,
          placeholder: t("查找模型…", "Find a model…"), onInput(value: string) { query = value; } },
        empty: { title: t("没有匹配的模型", "No matching models"), description: t("将 JSON 定义放入项目模型目录后刷新，或调整筛选条件。", "Add JSON definitions to the project model directory and refresh, or change the filter.") }
      };
      if (loading) return { ...shared, state: "loading", sections: [] };
      if (loadError) return { ...shared, state: "error", sections: [], error: { state: "error",
        title: t("模型列表加载失败", "Could not load models"), description: { text: loadError },
        action: { label: t("重试", "Retry"), run: refresh } } };
      const selected = context.route.query.model ?? models?.[0]?.id;
      return { ...shared, sections: [{ id: "models", items: (models ?? [])
        .filter(model => `${model.id} ${model.title ?? ""}`.toLowerCase().includes(query.toLowerCase()))
        .map(model => ({ id: model.id, title: { text: model.title || model.id }, meta: { text: model.id },
          ...(model.description ? { description: { text: model.description } } : {}), selected: model.id === selected,
          icon: { kind: "system", name: "file-text" }, route: index.to({}, { query: { model: model.id } }),
          badges: [{ label: { text: model.metaModel }, tone: "default" },
            ...(model.builtin ? [{ label: t("内置", "Built-in"), tone: "info" as const }] : []),
            ...(model.status === "unavailable" ? [{ label: t("不可用", "Unavailable"), tone: "warning" as const }] : [])] })) }] };
    });
    const list: ViewMount = {
      async mount(target, context) {
        const dispose = await listContent.mount(target, context);
        if (models === undefined) await refresh();
        return () => {
          listGeneration++; listController.abort(); listContext = undefined;
          dispose?.();
        };
      },
      update: context => listContent.update?.(context)
    };
    async function refresh() {
      const generation = ++listGeneration;
      listController.abort(); listController = new AbortController();
      loading = true; loadError = undefined;
      if (listContext) await list.update?.(listContext);
      try {
        const payload = await request<{ models: ModelSummary[] }>("/models", listController.signal);
        if (generation !== listGeneration) return;
        models = payload.models;
      } catch (error) {
        if (generation !== listGeneration || listController.signal.aborted) return;
        loadError = error instanceof Error ? error.message : String(error);
      }
      if (generation !== listGeneration) return;
      loading = false;
      if (listContext) await list.update?.(listContext);
      if (pageContext) await render(pageContext);
    }
    async function render(context: ViewRenderContext) {
      if (!element) return;
      pageContext = context;
      const generation = ++detailGeneration;
      detailController.abort(); detailController = new AbortController();
      const style = document.createElement("style"); style.textContent = modelStyles;
      const body = document.createElement("div"); body.className = "model-browser-body";
      element.dataset.models = ""; element.replaceChildren(style, body);
      if (loading) { body.append(ui.feedback({ state: "loading", title: t("正在加载模型", "Loading models") })); return; }
      if (loadError) { body.append(ui.feedback({ state: "error", title: t("模型列表加载失败", "Could not load models"), description: { text: loadError }, action: { label: t("重试", "Retry"), run: refresh } })); return; }
      const id = context.route.query.model ?? models?.[0]?.id;
      if (!id) { body.append(ui.feedback({ state: "empty", title: t("没有模型", "No models") })); return; }
      body.append(ui.feedback({ state: "loading", title: t("正在读取定义", "Loading definition") }));
      try {
        const model = await request<ModelDefinition>(`/models/definition?model=${encodeURIComponent(id)}`, detailController.signal);
        if (generation !== detailGeneration || !element) return;
        body.replaceChildren();
        const heading = document.createElement("h2"); heading.className = "model-browser-heading"; heading.textContent = model.title ?? model.id;
        const description = document.createElement("p"); description.className = "model-browser-description"; description.textContent = model.description ?? "";
        const meta = document.createElement("dl"); meta.className = "model-browser-meta";
        for (const [label, value] of [[text("模型 ID", "Model ID"), model.id], [text("模型定义标准", "Definition standard"), model.metaModel],
          [text("来源", "Source"), model.builtin ? text("项目内置", "Project built-in") : text("模型定义存储", "Model definition store")]]) {
          const dt = document.createElement("dt"); dt.textContent = label;
          const dd = document.createElement("dd"); dd.textContent = value; meta.append(dt, dd);
        }
        body.append(heading, description, meta);
        const snapshot = freezeDefinition(model);
        let source: HTMLElement | undefined;
        let tree: HTMLElement | undefined;
        const defaultRender = (view: "structure" | "source") => {
          if (view === "source") {
            if (!source) { source = document.createElement("pre"); source.className = "model-browser-code"; source.textContent = model.source; }
            return source;
          }
          return tree ??= model.metaModel === "raw" ? ui.feedback({ state: "read-only", title: t("原始内容模型", "Raw content model"),
          description: t("此模型不声明成员字段，内容作为整体字节值管理。", "This model declares no member fields; its content is managed as a whole byte value.") })
          : definitionTable(ui, model.definition, text);
        };
        const rendered = new Map<"structure" | "source", HTMLElement>();
        const switcher = document.createElement("div");
        const panel = document.createElement("div"); panel.className = "model-browser-definition-panel";
        function select(selectedId: string) {
          const view = selectedId === "source" ? "source" : "structure";
          switcher.replaceChildren(ui.segmentedControl({ label: t("模型定义展示方式", "Model definition view"), selectedId,
            items: [{ id: "structure", label: t("模型结构", "Model structure") }, { id: "source", label: t("原始定义", "Source definition") }], onSelect: select }));
          let content = rendered.get(view);
          if (!content) {
            const input: ModelDefinitionPresentationContext = Object.freeze({ model: snapshot, view, defaultRender: () => defaultRender(view) });
            content = ctx.slots.render(portableSlots.modelDefinitionRenderer, "definition", input) ?? defaultRender(view);
            rendered.set(view, content);
          }
          panel.replaceChildren(content);
        }
        select("structure"); body.append(switcher, panel);
      } catch (error) {
        if (generation !== detailGeneration || detailController.signal.aborted || !element) return;
        body.replaceChildren(ui.feedback({ state: "error", title: t("读取模型定义失败", "Could not read the definition"),
          description: { text: error instanceof Error ? error.message : String(error) }, action: { label: t("重试", "Retry"), run: () => render(context) } }));
      }
    }
    const page: ViewMount = {
      async mount(target, context) {
        element = target.element; pageContext = context;
        await render(context);
        if (models === undefined || loading) await refresh();
        return () => {
          detailGeneration++; listGeneration++; detailController.abort(); listController.abort();
          delete target.element.dataset.models;
          element = undefined; pageContext = undefined; listContext = undefined;
        };
      },
      update: render
    };
    ctx.slots.register(slots.navigationPrimary, { id: "models.navigation", order: 150, value: { label: t("模型", "Models"), icon: { kind: "system", name: "stack" }, route: index.to() } });
    ctx.slots.register(slots.navigationSecondary, { id: "models.secondary", when: index.activation,
      value: { title: t("模型", "Models"), icon: { kind: "system", name: "stack" }, items: [{ id: "all", label: t("全部模型", "All models"), icon: { kind: "system", name: "stack" }, selected: true, route: index.to() }] } });
    ctx.slots.register(slots.headerTitle, { id: "models.header", when: index.activation, value: { title: t("模型", "Models"), subtitle: { text: ctx.module.projectId } } });
    ctx.slots.register(slots.headerActions, { id: "models.refresh", when: index.activation, value: { label: t("刷新模型", "Refresh models"), icon: { kind: "system", name: "arrows-clockwise" }, run: refresh } });
    ctx.slots.register(slots.contentList, { id: "models.list", when: index.activation, value: list });
    ctx.slots.register(slots.mainView, { id: "models.page", key: index.key, when: index.activation, value: page });
    ctx.slots.register(portableSlots.modelsPagePresentation, { id: "models.presentation", key: "page", priority: 1000, when: index.activation, value: page });
  }
});

function freezeDefinition<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDefinition(child);
  return Object.freeze(value);
}
