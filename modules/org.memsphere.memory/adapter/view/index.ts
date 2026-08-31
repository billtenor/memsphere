import {
  defineViewPlugin,
  slots,
  type RouteLocation,
  type RouteTarget,
  type TextRef,
  type ViewMount,
  type ViewPluginContext
} from "@memsphere/view-sdk";

type JsonRecord = Record<string, unknown>;
type MemorySummary = JsonRecord & {
  id: string;
  kind: string;
  path: string;
  names?: string[];
  system?: boolean;
  error?: unknown;
  entity?: JsonRecord;
};
type ChangeSummary = JsonRecord & {
  id: string;
  status?: string;
  memoryPaths?: string[];
  updatedAt?: string;
  error?: unknown;
};
type MemoryConfig = {
  locale?: string;
  messages?: Readonly<Record<string, unknown>>;
};
type MemoryRouteName = "home" | "index" | "market" | "memory-detail" | "project-index"
  | "project-memory-detail" | "project-market" | "change-detail";

const kindOrder = ["procedures", "schemas", "concepts", "statements"] as const;
const hideSystemMemoriesKey = "memsphere.hideSystemMemories.v1";
const changeActorSelectionKey = "memsphere.changeActorSelection.v1";
const changeBrowserIdentityKey = "memsphere.changeBrowserIdentity.v1";
const changeCommentsCollapsedKey = "memsphere.changeCommentsCollapsed.v1";

const fallbackMessages: Readonly<Record<string, string>> = Object.freeze({
  "navigation.memory": "记忆",
  "navigation.run": "运行",
  "navigation.settings": "设置",
  "navigation.currentProject": "当前项目",
  "navigation.memoryMarket": "记忆市场",
  "navigation.backToMemory": "返回记忆",
  "common.loading": "加载中…",
  "common.retry": "重试",
  "common.archive": "归档",
  "common.abandon": "废弃",
  "memory.search": "搜索记忆",
  "memory.visibleCount": "共 {count} 条",
  "memory.marketItemCount": "共 {count} 项",
  "memory.empty": "没有可展示的记忆。",
  "memory.select": "选择一条记忆查看详情。",
  "memory.edit": "修改",
  "memory.editConfirm": "创建一个 ChangeSet 来修改这条记忆？",
  "memory.invalidYaml": "记忆 YAML 无效",
  "memory.hideSystem": "隐藏系统记忆",
  "memory.otherChangeSets": "其他 ChangeSet（{count}）",
  "memory.relatedChangeSets": "修改中（{count}）",
  "market.empty": "记忆市场中没有可用内容。",
  "market.import": "导入",
  "market.reimport": "重新导入",
  "market.notImported": "未导入",
  "market.importing": "导入中",
  "market.consistent": "已同步",
  "market.different": "有更新",
  "market.nameConflict": "名称冲突",
  "market.viewChangeSet": "查看 ChangeSet",
  "change.title": "ChangeSet",
  "change.select": "选择一个 ChangeSet。",
  "change.empty": "没有 ChangeSet。",
  "change.comments": "评论",
  "change.noComments": "还没有评论。",
  "change.addComment": "添加评论",
  "change.addMemory": "加入记忆",
  "change.validationDiagnostics": "校验诊断",
  "change.sourceUnavailable": "来源工作区不可用",
  "change.draftPreview": "草稿预览",
  "change.store": "存储：{value}",
  "change.validationFailed": "校验失败",
  "change.comment.pending": "待处理",
  "change.comment.processing": "处理中",
  "change.comment.completed": "已完成",
  "change.comment.abandoned": "已废弃",
  "change.comment.ended": "已结束",
  "fatal.title": "无法加载 Memsphere",
  "procedures": "流程",
  "schemas": "图式",
  "concepts": "概念",
  "statements": "命题",
  "type": "类型",
  "optional": "可选",
  "fields": "字段",
  "item": "元素",
  "items": "候选元素",
  "layout": "布局",
  "min": "最少",
  "max": "最多",
  "string": "短文本",
  "boolean": "判断结果",
  "number": "数字",
  "markdown": "文档",
  "effectiveRuleCount": "条生效规则",
  "referenceNotFound": "引用不存在",
  "names": "名称",
  "defines": "定义",
  "asserts": "必须遵守",
  "suggests": "建议遵守",
  "goals": "目标",
  "flow": "执行流程",
  "format": "格式",
  "repeat": "重复结构",
  "unbounded": "不限",
  "sections": "章节",
  "call": "调用",
  "if": "如果",
  "while": "循环",
  "else": "否则",
  "step": "步骤",
  "artifact": "产物",
  "final": "最终产物",
  "inlineSchema": "内联图式",
  "review": "评审"
});

const englishFallbackMessages: Readonly<Record<string, string>> = Object.freeze({
  "memory.visibleCount": "{count} total", "memory.marketItemCount": "{count} items",
  type: "Type", optional: "Optional", fields: "Fields", item: "Item", items: "Candidates",
  layout: "Layout", min: "Minimum", max: "Maximum", string: "Short text", boolean: "Boolean",
  number: "Number", markdown: "Document", effectiveRuleCount: "effective rules",
  referenceNotFound: "Reference not found", "change.sourceUnavailable": "Source workspace unavailable",
  "memory.invalidYaml": "Invalid Memory YAML", "change.draftPreview": "Draft preview",
  "change.store": "Store: {value}", "change.validationFailed": "Validation failed",
  names: "Names", defines: "Defines", asserts: "Required rules", suggests: "Suggested rules",
  goals: "Goals", flow: "Flow", format: "Format", repeat: "Repeat", unbounded: "Unbounded",
  sections: "Sections", call: "Call", if: "If", while: "While", else: "Else", step: "Step",
  artifact: "Artifact", final: "Final", inlineSchema: "Inline schema", review: "Review"
});

const memoryStyles = `
  .memory-module { --bg:#f6f7f4; --surface:#fff; --soft:#eef1ed; --line:#d9ded8; --text:#222629; --muted:#6c7379; --accent:#286c67; --accent-soft:#dfeeea; --danger:#a14436; min-height:calc(100vh - 82px); background:var(--bg); color:var(--text); font:14px/1.45 ui-sans-serif,system-ui,sans-serif; }
  .memory-module * { box-sizing:border-box; }
  .memory-module button,.memory-module input,.memory-module textarea { font:inherit; }
  .memory-module button { cursor:pointer; }
  .memory-layout { display:grid; grid-template-columns:300px minmax(0,1fr); min-height:calc(100vh - 82px); }
  .memory-sidebar { position:sticky; top:0; height:calc(100vh - 82px); overflow:auto; padding:16px; border-right:1px solid var(--line); background:#fbfbf8; }
  .memory-brand,.memory-toolbar,.memory-toolbar-actions,.memory-comment-actions { display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .memory-brand h1,.memory-title { margin:0; }
  .memory-brand h1 { font-size:18px; }
  .memory-top-nav { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; margin-top:14px; }
  .memory-top-nav a,.memory-source-tab { border:1px solid var(--line); border-radius:6px; background:var(--surface); color:var(--muted); padding:7px 8px; text-align:center; text-decoration:none; }
  .memory-top-nav a.active,.memory-source-tab.active { border-color:#b8cbc7; background:var(--accent-soft); color:#173f3c; font-weight:700; }
  .memory-source-tabs { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:3px; margin-top:8px; padding:3px; border:1px solid var(--line); border-radius:6px; background:var(--soft); }
  .memory-source-tab { min-height:28px; border:0; padding:4px 7px; font-size:11px; }
  .memory-search,.memory-module textarea { width:100%; border:1px solid var(--line); border-radius:6px; background:var(--surface); outline:none; }
  .memory-search { margin:14px 0 10px; padding:9px 10px; }
  .memory-module textarea { min-height:88px; padding:10px; resize:vertical; }
  .memory-search:focus,.memory-module textarea:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(40,108,103,.12); }
  .memory-count,.memory-muted,.memory-subtitle { color:var(--muted); }
  .memory-kind { margin:14px 0 6px; color:var(--muted); font-size:11px; font-weight:700; letter-spacing:.08em; }
  .memory-list,.memory-comment-list,.memory-flow { display:grid; gap:8px; }
  .memory-button { width:100%; border:0; border-radius:6px; background:transparent; color:var(--text); padding:8px 9px; text-align:left; overflow-wrap:anywhere; }
  .memory-change-wrap { border-radius:6px; }
  .memory-change-wrap:hover { background:#eceee8; }
  .memory-change-wrap:hover .memory-button { background:transparent; }
  .memory-button.active { background:var(--accent-soft); color:#173f3c; font-weight:700; }
  .memory-change-wrap.active { border-radius:6px; background:var(--accent-soft); }
  .memory-change-wrap.active .memory-button { background:transparent; }
  .memory-related { margin:-4px 9px 5px; color:var(--accent); font-size:12px; }
  .memory-related-list { display:grid; gap:3px; margin:0 9px 7px; }
  .memory-related-list button { border:0; background:transparent; color:var(--muted); padding:2px 0; text-align:left; font:11px/1.35 ui-monospace,monospace; }
  .memory-options { margin-top:16px; padding-top:12px; border-top:1px solid var(--line); }
  .memory-change-wrap > .memory-options { margin-top:0; padding-top:0; border-top:0; }
  .memory-option { display:flex; align-items:center; gap:8px; color:var(--muted); }
  .memory-workspace { min-width:0; padding:22px 28px 48px; }
  .memory-toolbar { align-items:flex-start; margin-bottom:18px; }
  .memory-title { font-size:26px; line-height:1.2; overflow-wrap:anywhere; }
  .memory-subtitle { margin-top:7px; font-size:13px; overflow-wrap:anywhere; }
  .memory-toolbar-actions,.memory-comment-actions { justify-content:flex-start; flex-wrap:wrap; }
  .memory-btn { border:1px solid var(--line); border-radius:6px; background:var(--surface); color:var(--text); padding:7px 10px; }
  .memory-btn.primary { border-color:var(--accent); background:var(--accent); color:#fff; }
  .memory-btn.danger { color:var(--danger); }
  .memory-btn:disabled { opacity:.55; cursor:not-allowed; }
  .memory-empty,.memory-panel,.memory-error { border:1px solid var(--line); border-radius:8px; background:var(--surface); padding:16px; box-shadow:0 1px 2px rgba(25,30,35,.08); }
  .memory-error { border-color:#e8c7bd; border-left:4px solid var(--danger); background:#fffdfb; }
  .memory-error h3 { color:var(--danger); }
  .memory-panel { margin:12px 0; }
  .memory-panel>h3 { margin:0 0 10px; }
  .memory-meta { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0 12px; }
  .memory-pill { display:inline-flex; border:1px solid var(--line); border-radius:999px; background:var(--soft); color:var(--muted); padding:2px 8px; font-size:11px; }
  .memory-market-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center; }
  .memory-market-status { border:1px solid var(--line); border-radius:999px; background:var(--surface); color:var(--muted); padding:1px 6px; font-size:11px; white-space:nowrap; }
  .memory-market-status[data-status=consistent],.memory-market-status[data-status=importing] { border-color:#b8cbc7; color:var(--accent); }
  .memory-market-status[data-status=name_conflict] { color:var(--danger); }
  .memory-node { position:relative; margin:8px 0; padding:10px 12px; border-left:3px solid #c6d4d1; background:#fafbf8; }
  .memory-node h3,.memory-node h4 { margin:0 0 8px; }
  .node-badges { display:inline-flex; flex-wrap:wrap; gap:6px; margin-left:8px; }
  .rule-reference-summary { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .memory-ref-link,.rule-reference-toggle { border:0; border-radius:999px; background:var(--soft); color:var(--accent); padding:3px 9px; }
  .memory-ref-link.missing { color:var(--danger); text-decoration:line-through; }
  .rule-reference-toggle:disabled { opacity:.55; cursor:not-allowed; }
  .effective-rule-inline { margin:8px 0 2px 14px; padding-left:12px; border-left:2px solid var(--line); }
  .effective-rule-inline[hidden] { display:none; }
  .memory-node ul { margin:6px 0; padding-left:22px; }
  .memory-document { display:grid; gap:14px; }
  .memory-section { position:relative; margin:10px 0; overflow:hidden; border:1px solid var(--line); border-radius:8px; background:var(--surface); box-shadow:0 1px 2px rgba(25,30,35,.07); }
  .memory-section.memory-node { padding:0; border-left:1px solid var(--line); background:var(--surface); }
  .memory-section-header { display:grid; grid-template-columns:22px minmax(0,1fr) auto; align-items:center; gap:8px; width:100%; border:0; background:transparent; color:var(--text); padding:12px 14px; text-align:left; }
  .memory-section-header:hover { background:#f7f8f5; }
  .memory-chevron { color:var(--muted); font-size:22px; line-height:1; transform:rotate(0); transition:transform .12s ease; }
  .memory-section.open>.memory-section-header .memory-chevron { transform:rotate(90deg); }
  .memory-node-title { min-width:0; font-size:15px; font-weight:700; overflow-wrap:anywhere; }
  .memory-section-body { display:none; padding:4px 16px 16px 44px; border-top:1px solid var(--line); }
  .memory-section.open>.memory-section-body { display:block; }
  .memory-block-title { margin:14px 0 6px; color:var(--muted); font-size:11px; font-weight:800; letter-spacing:.07em; text-transform:uppercase; }
  .text-list { display:grid; gap:6px; margin:0; padding-left:20px; }
  .text-list>li { padding:2px 4px; white-space:pre-wrap; overflow-wrap:anywhere; }
  .memory-child-stack { display:grid; gap:8px; }
  .memory-schema-field { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:12px; min-height:38px; padding:8px 12px; border:1px solid var(--line); border-radius:6px; background:#fafbf8; }
  .memory-schema-field-name { font-weight:650; overflow-wrap:anywhere; }
  .schema-field-type { color:var(--muted); font-size:12px; }
  .memory-flow { gap:10px; }
  .memory-flow-item { position:relative; overflow:hidden; border:1px solid var(--line); border-left:4px solid #9cbab5; border-radius:7px; background:var(--surface); }
  .memory-flow-item.call { border-left-color:#8799b1; }
  .memory-flow-item.branch { border-left-color:#c3a269; }
  .memory-flow-head { display:flex; align-items:flex-start; gap:10px; flex-wrap:wrap; padding:11px 13px; }
  .memory-flow-label { flex:0 0 auto; border-radius:999px; background:var(--accent-soft); color:#173f3c; padding:2px 8px; font-size:11px; font-weight:800; }
  .memory-flow-action { min-width:0; flex:1 1 240px; font-weight:650; white-space:pre-wrap; overflow-wrap:anywhere; }
  .memory-flow-branch { border-top:1px solid var(--line); background:#fafbf8; padding:9px 12px 12px 24px; }
  .memory-flow-condition { margin-bottom:7px; color:var(--muted); font-size:11px; font-weight:800; }
  .memory-flow-children { display:grid; gap:8px; }
  .memory-artifact-row { display:flex; align-items:center; gap:5px; flex-wrap:wrap; margin-left:auto; }
  .memory-artifact-label { color:var(--muted); font-size:11px; }
  .memory-pill.strong { border-color:#b8cbc7; background:var(--accent-soft); color:#173f3c; font-weight:700; }
  .memory-pill.done { border-color:#b5ccb8; background:#e7f3e7; color:#27612e; }
  .action-contracts { margin:0 13px 10px; padding:9px 12px; border:1px solid var(--line); border-radius:6px; background:#fafbf8; }
  .memory-kv { display:grid; grid-template-columns:minmax(90px,auto) minmax(0,1fr); gap:6px 12px; padding:4px 0; }
  .memory-kv>dt { color:var(--muted); font-weight:700; }
  .memory-kv>dd { margin:0; overflow-wrap:anywhere; }
  .memory-commentable { position:relative; }
  .memory-inline-plus { position:absolute; top:4px; right:4px; display:none; width:25px; height:25px; border:1px solid var(--line); border-radius:50%; background:var(--surface); color:var(--accent); }
  .memory-commentable:hover>.memory-inline-plus,.memory-inline-plus:focus { display:block; }
  .memory-change-layout { display:grid; grid-template-columns:minmax(0,1fr) minmax(260px,320px); gap:16px; align-items:start; }
  .memory-change-layout.comments-collapsed { grid-template-columns:minmax(0,1fr); }
  .memory-change-layout.comments-collapsed .memory-comments { display:none; }
  .memory-comments { position:sticky; top:16px; max-height:calc(100vh - 32px); overflow:auto; }
  .memory-comment { border-top:1px solid var(--line); padding:10px 0; }
  .memory-comment:first-child { border-top:0; }
  .memory-comment-head { display:flex; justify-content:space-between; gap:8px; color:var(--muted); font-size:12px; }
  .memory-comment-body { white-space:pre-wrap; overflow-wrap:anywhere; }
  .memory-comment-target { color:var(--accent); font:11px/1.35 ui-monospace,monospace; }
  @media(max-width:820px){.memory-layout{display:block}.memory-sidebar{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}.memory-workspace{padding:18px 14px 36px}.memory-change-layout{display:block}.memory-comments{position:static;max-height:none}.memory-section-body{padding:4px 12px 14px}.memory-flow-head{display:grid}.memory-artifact-row{margin-left:0}}
`;

export default defineViewPlugin<MemoryConfig>({
  name: "memsphere-memory-view",
  apiVersion: 1,
  inject: ["slots", "router"],
  apply(ctx, config) {
    if (!ctx.router) throw new Error("Memory View requires the router service");
    const routes = {
      home: ctx.router.register({ id: "home", path: "/" }),
      index: ctx.router.register({ id: "index", path: "/memories" }),
      market: ctx.router.register({ id: "market", path: "/market" }),
      memoryDetail: ctx.router.register({ id: "memory-detail", path: "/memories/:kind/:name" }),
      projectIndex: ctx.router.register({ id: "project-index", path: "/projects/:projectId/memories" }),
      projectMemoryDetail: ctx.router.register({ id: "project-memory-detail", path: "/projects/:projectId/memories/:kind/:name" }),
      projectMarket: ctx.router.register({ id: "project-market", path: "/projects/:projectId/market" }),
      changeDetail: ctx.router.register({ id: "change-detail", path: "/projects/:projectId/changes/:changeId" })
    };

    registerPage(ctx, routes.home, "home", config, routes);
    registerPage(ctx, routes.index, "index", config, routes);
    registerPage(ctx, routes.market, "market", config, routes);
    registerPage(ctx, routes.memoryDetail, "memory-detail", config, routes);
    registerPage(ctx, routes.projectIndex, "project-index", config, routes);
    registerPage(ctx, routes.projectMemoryDetail, "project-memory-detail", config, routes);
    registerPage(ctx, routes.projectMarket, "project-market", config, routes);
    registerPage(ctx, routes.changeDetail, "change-detail", config, routes);

    ctx.slots.register(slots.navigationPrimary, {
      id: "memory.navigation",
      order: 100,
      value: {
        label: text(message(config, "navigation.memory")),
        icon: { kind: "system", name: "memory" },
        route: routes.index.to()
      }
    });
  }
});

type MemoryRoutes = {
  home: ReturnType<NonNullable<ViewPluginContext["router"]>["register"]>;
  index: ReturnType<NonNullable<ViewPluginContext["router"]>["register"]>;
  market: ReturnType<NonNullable<ViewPluginContext["router"]>["register"]>;
  memoryDetail: ReturnType<NonNullable<ViewPluginContext["router"]>["register"]>;
  projectIndex: ReturnType<NonNullable<ViewPluginContext["router"]>["register"]>;
  projectMemoryDetail: ReturnType<NonNullable<ViewPluginContext["router"]>["register"]>;
  projectMarket: ReturnType<NonNullable<ViewPluginContext["router"]>["register"]>;
  changeDetail: ReturnType<NonNullable<ViewPluginContext["router"]>["register"]>;
};

function registerPage(
  ctx: ViewPluginContext,
  route: MemoryRoutes[keyof MemoryRoutes],
  name: MemoryRouteName,
  config: Readonly<MemoryConfig>,
  routes: MemoryRoutes
): void {
  ctx.slots.register(slots.headerTitle, {
    id: `memory.header.${name}`,
    when: route.activation,
    value: { title: text(name.includes("market") ? message(config, "navigation.memoryMarket") : message(config, name === "change-detail" ? "change.title" : "navigation.memory")) }
  });
  ctx.slots.register(slots.mainView, {
    id: `memory.page.${name}`,
    key: route.key,
    when: route.activation,
      value: createMemoryMount(config, routes, target => ctx.router!.navigate(target))
  });
}

function createMemoryMount(config: Readonly<MemoryConfig>, routes: MemoryRoutes, navigate: (target: RouteTarget) => Promise<void>): ViewMount {
  return {
    async mount({ element, portal }, context) {
      const controller = new AbortController();
      const style = document.createElement("style");
      style.dataset.memsphereMemoryStyles = "true";
      style.textContent = memoryStyles;
      element.append(style);
      const app = new MemoryApplication(element, portal, controller, config, routes, context.route, navigate);
      await app.start();
      return () => {
        controller.abort();
        app.dispose();
        element.replaceChildren();
        portal.replaceChildren();
      };
    }
  };
}

class MemoryApplication {
  readonly #root: HTMLElement;
  readonly #portal: HTMLElement;
  readonly #controller: AbortController;
  readonly #config: Readonly<MemoryConfig>;
  readonly #routes: MemoryRoutes;
  readonly #location: Readonly<RouteLocation>;
  readonly #navigate: (target: RouteTarget) => Promise<void>;
  #memories: MemorySummary[] = [];
  #changes: ChangeSummary[] = [];
  #market: JsonRecord[] = [];
  #memoryDetail: MemorySummary | null = null;
  #changeDetail: JsonRecord | null = null;
  #selectedId = "";
  #selectedMarket = "";
  #query = "";
  #hideSystem = localStorage.getItem(hideSystemMemoriesKey) !== "false";
  #commentsCollapsed = localStorage.getItem(changeCommentsCollapsedKey) === "true";
  #currentProject = "";
  #actorKinds: Record<string, string> = {};
  #generation = 0;

  constructor(root: HTMLElement, portal: HTMLElement, controller: AbortController, config: Readonly<MemoryConfig>, routes: MemoryRoutes, location: Readonly<RouteLocation>, navigate: (target: RouteTarget) => Promise<void>) {
    this.#root = root;
    this.#portal = portal;
    this.#controller = controller;
    this.#config = config;
    this.#routes = routes;
    this.#location = location;
    this.#currentProject = projectFromLocation(location);
    this.#navigate = navigate;
  }

  async start(): Promise<void> {
    this.renderLoading();
    await this.load();
  }

  dispose(): void {
    this.#generation += 1;
  }

  private async load(): Promise<void> {
    const generation = ++this.#generation;
    this.#memoryDetail = null;
    this.#changeDetail = null;
    try {
      const route = parseLocation(this.#location);
      if (route.kind === "memory-detail") this.#selectedId = `${route.memoryKind}/${route.memoryName}`;
      const previewChangeId = route.kind === "change" ? "" : route.changeId;
      const [memoryPayload, changePayload, projectPayload] = await Promise.all([
        this.request<JsonRecord>(`/api/memories?${new URLSearchParams({ representation: "summary", ...(previewChangeId ? { change: previewChangeId } : {}) })}`),
        this.request<JsonRecord>("/api/changes").catch(error => ({ changes: [], _error: error })),
        this.request<JsonRecord>("/api/projects").catch((): JsonRecord => ({}))
      ]);
      if (generation !== this.#generation) return;
      this.#memories = array(memoryPayload.memories) as MemorySummary[];
      if (route.kind === "memory-detail") {
        this.#selectedId = this.#memories.find(memory => memoryReference(memory) === `${route.memoryKind}/${route.memoryName}`)?.id ?? this.#selectedId;
      }
      this.#changes = array(changePayload.changes) as ChangeSummary[];
      this.#currentProject = projectFromLocation(this.#location) || String(projectPayload.current ?? this.#currentProject);
      this.#actorKinds = asStringRecord(memoryPayload.actorKinds);

      if (route.changeId && route.kind !== "change") {
        this.#changeDetail = await this.request<JsonRecord>(`/api/changes/${encodeURIComponent(route.changeId)}`).catch(() => null) as JsonRecord | null;
        if (this.#changeDetail) this.#actorKinds = asStringRecord(this.#changeDetail.actorKinds);
      }

      if (route.kind === "market") {
        const payload = await this.request<JsonRecord>("/api/market/memories");
        if (generation !== this.#generation) return;
        this.#market = array(payload.memories);
        this.#selectedMarket ||= String(this.#market[0]?.reference ?? "");
      } else if (route.kind === "change") {
        try {
          this.#changeDetail = await this.request<JsonRecord>(`/api/changes/${encodeURIComponent(route.changeId)}`);
          this.#actorKinds = asStringRecord(this.#changeDetail.actorKinds);
          const targets = array(this.#changeDetail.targetMemories).map(item => {
            const target = item as JsonRecord;
            const memory = target.memory && typeof target.memory === "object"
              ? target.memory as MemorySummary
              : target as MemorySummary;
            return {
              ...memory,
              operation: target.operation ?? memory.operation,
              reference: target.reference ?? memory.reference
            } as MemorySummary;
          });
          if (targets.length) {
            this.#memories = targets;
            this.#selectedId = targets.some(item => item.id === this.#selectedId) ? this.#selectedId : targets[0]?.id ?? "";
          }
        } catch (error) {
          this.#changeDetail = { error: errorMessage(error), change: this.#changes.find(item => item.id === route.changeId) ?? { id: route.changeId, status: "unavailable" } };
        }
      } else {
        this.#selectedId ||= this.visibleMemories()[0]?.id ?? "";
        if (this.#selectedId) await this.loadMemoryDetail(this.#selectedId, route.changeId, generation);
      }
      if (generation === this.#generation) this.render();
    } catch (error) {
      if (!this.#controller.signal.aborted && generation === this.#generation) this.renderError(error, () => this.load());
    }
  }

  private async loadMemoryDetail(id: string, changeId = "", generation = this.#generation): Promise<void> {
    const summary = this.#memories.find(item => item.id === id);
    if (!summary) {
      const [kind, ...name] = id.split("/");
      this.#memoryDetail = { id, kind: kind ?? "", path: "", names: [name.join("/")], error: `Memory not found: ${id}` };
      return;
    }
    if (summary.error) { this.#memoryDetail = summary; return; }
    const [kind, ...name] = id.split("/");
    try {
      const canonical = memoryReference(summary);
      const [requestKind, ...requestName] = canonical.split("/");
      const query = new URLSearchParams({ effective: "true", ...(changeId ? { change: changeId } : {}) });
      const effectiveUrl = `/api/memories/${encodeURIComponent(requestKind ?? kind)}/${encodeURIComponent(requestName.join("/") || name.join("/"))}?${query}`;
      let payload: JsonRecord;
      try { payload = await this.request<JsonRecord>(effectiveUrl); }
      catch {
        const rawQuery = new URLSearchParams(changeId ? { change: changeId } : {});
        const suffix = rawQuery.size ? `?${rawQuery}` : "";
        payload = await this.request<JsonRecord>(`/api/memories/${encodeURIComponent(requestKind ?? kind)}/${encodeURIComponent(requestName.join("/") || name.join("/"))}${suffix}`);
      }
      if (generation === this.#generation) this.#memoryDetail = (payload.memory ?? payload) as MemorySummary;
    } catch (error) {
      if (generation === this.#generation) this.#memoryDetail = { ...summary, error: errorMessage(error) };
    }
  }

  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, signal: this.#controller.signal });
    if (!response.ok) throw new Error(await response.text() || `${response.status} ${response.statusText}`);
    return response.json() as Promise<T>;
  }

  private renderLoading(): void {
    this.#root.querySelector(".memory-module")?.remove();
    const node = el("section", "memory-module memory-empty", this.t("common.loading"));
    this.#root.append(node);
  }

  private render(): void {
    this.#root.querySelector(".memory-module")?.remove();
    const app = el("section", "memory-module");
    const layout = el("div", "memory-layout");
    layout.append(this.renderSidebar(), this.renderWorkspace());
    app.append(layout);
    this.#root.append(app);
  }

  private renderSidebar(): HTMLElement {
    const side = el("aside", "memory-sidebar");
    const source = el("div", "memory-source-tabs");
    const route = parseLocation(this.#location);
    const local = button(this.t("navigation.currentProject"), "memory-source-tab" + (route.kind !== "market" ? " active" : ""), () => this.navigate(this.#routes.index.to()));
    const market = button(this.t("navigation.memoryMarket"), "memory-source-tab" + (route.kind === "market" ? " active" : ""), () => this.navigate(this.#routes.market.to()));
    source.append(local, market);
    side.append(source);
    if (route.kind === "market") side.append(this.renderMarketNavigation());
    else if (route.kind === "change") side.append(this.renderChangeNavigation());
    else side.append(this.renderMemoryNavigation());
    return side;
  }

  private renderMemoryNavigation(): HTMLElement {
    const wrap = el("div");
    const search = input("search", this.t("memory.search"), this.#query, "memory-search");
    search.addEventListener("input", () => { this.#query = search.value; this.render(); });
    const visible = this.visibleMemories();
    wrap.append(search, el("div", "memory-count", this.format("memory.visibleCount", { count: visible.length })));
    for (const kind of kindOrder) {
      const group = visible.filter(memory => memory.kind === kind);
      if (!group.length) continue;
      wrap.append(el("div", "memory-kind", this.t(kind)));
      const list = el("div", "memory-list");
      for (const memory of group) {
        const box = el("div", "memory-change-wrap" + (memory.id === this.#selectedId ? " active" : ""));
        box.append(button(memoryName(memory), "memory-button" + (memory.id === this.#selectedId ? " active" : ""), async () => {
          const route = parseLocation(this.#location);
          if (route.changeId) {
            this.#selectedId = memory.id;
            await this.loadMemoryDetail(memory.id, route.changeId);
            this.render();
            return;
          }
          const [kindName, ...name] = memoryReference(memory).split("/");
          const projectId = projectFromLocation(this.#location);
          await this.navigate(projectId
            ? this.#routes.projectMemoryDetail.to({ projectId, kind: kindName, name: name.join("/") })
            : this.#routes.memoryDetail.to({ kind: kindName, name: name.join("/") }));
        }));
        const related = this.#changes.filter(change => (change.memoryPaths ?? []).includes(memory.path));
        if (related.length) box.append(this.changeLinks(this.format("memory.relatedChangeSets", { count: related.length }), related));
        list.append(box);
      }
      wrap.append(list);
    }
    const attached = new Set(this.#memories.map(memory => memory.path));
    const other = this.#changes.filter(change => !(change.memoryPaths ?? []).some(path => attached.has(path)));
    if (other.length) wrap.append(this.changeLinks(this.format("memory.otherChangeSets", { count: other.length }), other));
    const option = el("label", "memory-option");
    const checkbox = input("checkbox", "", ""); checkbox.checked = this.#hideSystem;
    checkbox.addEventListener("change", () => { this.#hideSystem = checkbox.checked; localStorage.setItem(hideSystemMemoriesKey, String(checkbox.checked)); this.render(); });
    option.append(checkbox, document.createTextNode(this.t("memory.hideSystem")));
    const options = el("div", "memory-options"); options.append(option); wrap.append(options);
    return wrap;
  }

  private renderMarketNavigation(): HTMLElement {
    const wrap = el("div");
    const search = input("search", this.t("memory.search"), this.#query, "memory-search");
    search.addEventListener("input", () => { this.#query = search.value; this.render(); });
    const query = this.#query.trim().toLowerCase();
    const visible = this.#market.filter(item => !query || `${item.reference ?? ""} ${memoryName(item as MemorySummary)}`.toLowerCase().includes(query));
    wrap.append(search, el("div", "memory-count", this.format("memory.marketItemCount", { count: visible.length })));
    for (const kind of kindOrder) {
      const group = visible.filter(item => item.kind === kind);
      if (!group.length) continue;
      wrap.append(el("div", "memory-kind", this.t(kind)));
      const list = el("div", "memory-list");
      for (const item of group) {
        const reference = String(item.reference ?? "");
        const row = button("", "memory-button memory-market-row" + (reference === this.#selectedMarket ? " active" : ""), () => {
          if (item.status === "importing" && item.changeId) { void this.openChange(String(item.changeId)); return; }
          this.#selectedMarket = reference; this.render();
        });
        row.append(el("span", "", memoryName((item.entity ?? item) as MemorySummary)), marketStatus(String(item.status ?? ""), this.marketStatusLabel(String(item.status ?? ""))));
        list.append(row);
      }
      wrap.append(list);
    }
    return wrap;
  }

  private renderChangeNavigation(): HTMLElement {
    const wrap = el("div");
    wrap.append(button(`← ${this.t("navigation.backToMemory")}`, "memory-button", () => this.navigate(this.#routes.index.to())));
    for (const kind of kindOrder) {
      const group = this.#memories.filter(memory => memory.kind === kind);
      if (!group.length) continue;
      wrap.append(el("div", "memory-kind", this.t(kind)));
      const list = el("div", "memory-list");
      for (const memory of group) list.append(button(memoryName(memory), "memory-button" + (memory.id === this.#selectedId ? " active" : ""), () => { this.#selectedId = memory.id; this.render(); }));
      wrap.append(list);
    }
    return wrap;
  }

  private renderWorkspace(): HTMLElement {
    const main = el("main", "memory-workspace");
    const route = parseLocation(this.#location);
    if (route.kind === "market") main.append(this.renderMarketDetail());
    else if (route.kind === "change") main.append(this.renderChangeDetail());
    else main.append(this.renderMemoryDetail());
    return main;
  }

  private renderMemoryDetail(): HTMLElement {
    const detail = this.#memoryDetail ?? this.#memories.find(item => item.id === this.#selectedId) ?? null;
    if (!detail) return emptyWorkspace(this.t(this.#memories.length ? "memory.select" : "memory.empty"));
    const context = this.renderChangePreviewContext();
    if (detail.error) {
      const diagnostic = [detail.path, errorMessage(detail.error)].filter(Boolean).join(": ");
      const error = errorWorkspace(this.t("memory.invalidYaml"), diagnostic);
      const wrap = el("div"); if (context) wrap.append(context); wrap.append(error); return wrap;
    }
    const entity = (detail.entity ?? detail) as JsonRecord;
    const workspace = el("div");
    const toolbar = el("header", "memory-toolbar");
    const title = el("div"); title.append(el("h2", "memory-title", memoryName(detail)), el("div", "memory-subtitle", detail.id));
    const actions = el("div", "memory-toolbar-actions");
    actions.append(button(this.t("memory.edit"), "memory-btn primary", () => void this.createChange(detail)));
    toolbar.append(title, actions);
    if (context) workspace.append(context);
    workspace.append(toolbar, renderMeta(detail), renderMemoryEntity(detail.kind, entity, this.t.bind(this), (target, snapshot, location) => void this.beginMemoryComment(detail, target, snapshot, location), this.renderOptions()));
    return workspace;
  }

  private renderChangePreviewContext(): HTMLElement | null {
    const change = this.#changeDetail?.change as ChangeSummary | undefined;
    if (!change || parseLocation(this.#location).kind === "change") return null;
    const panel = el("section", "memory-panel memory-change-context");
    panel.append(el("h3", "", this.t("change.draftPreview")));
    const meta = el("div", "memory-meta");
    const store = String((change as JsonRecord).storeType ?? (change as JsonRecord).store_type ?? "");
    if (store) meta.append(el("span", "memory-pill", this.format("change.store", { value: store })));
    const checkpoint = (change as JsonRecord).checkpoint as JsonRecord | undefined;
    if ((change as JsonRecord).valid === false || checkpoint?.valid === false) meta.append(el("span", "memory-pill", this.t("change.validationFailed")));
    if (meta.childElementCount) panel.append(meta);
    return panel;
  }

  private renderMarketDetail(): HTMLElement {
    const item = this.#market.find(candidate => candidate.reference === this.#selectedMarket);
    if (!item) return emptyWorkspace(this.t("market.empty"));
    const workspace = el("div");
    const toolbar = el("header", "memory-toolbar");
    const title = el("div"); title.append(el("h2", "memory-title", memoryName((item.entity ?? item) as MemorySummary)), el("div", "memory-subtitle", String(item.reference ?? "")));
    const actions = el("div", "memory-toolbar-actions");
    actions.append(marketStatus(String(item.status ?? ""), this.marketStatusLabel(String(item.status ?? ""))));
    if (item.status === "importing" && item.changeId) actions.append(button(this.t("market.viewChangeSet"), "memory-btn", () => void this.openChange(String(item.changeId))));
    else if (item.status !== "consistent" && item.status !== "name_conflict") actions.append(button(this.t(item.status === "different" ? "market.reimport" : "market.import"), "memory-btn primary", () => void this.importMarket(item)));
    toolbar.append(title, actions);
    workspace.append(toolbar, renderMemoryEntity(String(item.kind ?? ""), (item.entity ?? item) as JsonRecord, this.t.bind(this), undefined, this.renderOptions()));
    return workspace;
  }

  private renderChangeDetail(): HTMLElement {
    const payload = this.#changeDetail;
    if (!payload) return emptyWorkspace(this.t(this.#changes.length ? "change.select" : "change.empty"));
    const change = (payload.change ?? {}) as ChangeSummary;
    if (payload.error) return errorWorkspace(change.id || this.t("change.title"), String(payload.error));
    const workspace = el("div");
    const toolbar = el("header", "memory-toolbar");
    const title = el("div"); title.append(el("h2", "memory-title", change.id), el("div", "memory-subtitle", this.changeStatusLabel(String(change.status ?? ""))));
    const actions = el("div", "memory-toolbar-actions");
    if (change.status === "active") {
      const add = button(this.t("change.addMemory"), "memory-btn", () => void this.addMemory(change)); add.disabled = Boolean(change.claimed);
      actions.append(add, button(this.t("common.abandon"), "memory-btn danger", () => void this.abandonChange(change)));
    } else actions.append(button(this.t("common.archive"), "memory-btn", () => void this.archiveChange(change)));
    const toggle = button(this.t("change.comments"), "memory-btn", () => { this.#commentsCollapsed = !this.#commentsCollapsed; localStorage.setItem(changeCommentsCollapsedKey, String(this.#commentsCollapsed)); this.render(); });
    actions.append(toggle); toolbar.append(title, actions); workspace.append(toolbar);
    const sourceWorktree = change.sourceWorktree as JsonRecord | undefined;
    if (sourceWorktree && sourceWorktree.available === false) {
      const source = el("section", "memory-error memory-source-worktree");
      source.append(el("h3", "", this.t("change.sourceUnavailable")), el("p", "memory-muted", String(sourceWorktree.root ?? "")));
      workspace.append(source);
    }
    if (array(change.issues).length) workspace.append(renderIssues(array(change.issues), this.t("change.validationDiagnostics")));
    const layout = el("div", `memory-change-layout${this.#commentsCollapsed ? " comments-collapsed" : ""}`);
    const main = el("div");
    const selected = this.#memories.find(memory => memory.id === this.#selectedId);
    if (selected?.error) main.append(errorWorkspace(memoryName(selected), errorMessage(selected.error)));
    else if (selected) {
      const panel = el("section", "memory-panel"); panel.append(el("h3", "", memoryName(selected)), renderMeta(selected));
      panel.append(renderMemoryEntity(selected.kind, (selected.entity ?? selected) as JsonRecord, this.t.bind(this), (target, snapshot, location) => void this.composeComment(selected, target, snapshot, location), this.renderOptions()));
      main.append(panel);
    }
    layout.append(main, this.renderComments(array(payload.comments), selected));
    workspace.append(layout);
    return workspace;
  }

  private renderComments(comments: JsonRecord[], memory?: MemorySummary): HTMLElement {
    const section = el("aside", "memory-panel memory-comments");
    section.append(el("h3", "", `${this.t("change.comments")} · ${comments.length}`));
    if (!comments.length) section.append(el("p", "memory-muted", this.t("change.noComments")));
    for (const comment of comments) {
      const item = el("article", "memory-comment");
      const head = el("div", "memory-comment-head");
      head.append(el("span", "", actorLabel(comment.operator ?? comment.actor)), el("span", "memory-pill", this.commentStatus(String(comment.status ?? "pending"))));
      item.append(head);
      if (comment.target || comment.location) item.append(el("button", "memory-comment-target", String(comment.target ?? (comment.location as JsonRecord)?.anchor ?? "")));
      item.append(el("p", "memory-comment-body", String(comment.body ?? "")));
      if (comment.status === "pending" && isMine(comment, this.currentOperator())) {
        const actions = el("div", "memory-comment-actions");
        actions.append(button("编辑", "memory-btn", () => this.editComment(item, comment)), button("删除", "memory-btn danger", () => void this.deleteComment(String(comment.id))));
        item.append(actions);
      }
      section.append(item);
    }
    if (memory && this.canComment()) section.append(button(this.t("change.addComment"), "memory-btn primary", () => void this.composeComment(memory, "", "", undefined)));
    return section;
  }

  private async createChange(memory: MemorySummary): Promise<void> {
    if (!confirm(this.t("memory.editConfirm"))) return;
    const operator = await this.chooseOperator(); if (!operator) return;
    try {
      const response = await this.request<JsonRecord>("/api/changes", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memoryReference: memory.id, operator })
      });
      const change = response.change as ChangeSummary; await this.openChange(change.id);
    } catch (error) { this.showTransientError(error); }
  }

  private async beginMemoryComment(memory: MemorySummary, target: string, snapshot: string, location: unknown): Promise<void> {
    const body = prompt(target ? `评论 ${target}` : this.t("change.addComment"));
    if (!body?.trim()) return;
    const operator = await this.chooseOperator(); if (!operator) return;
    try {
      const created = await this.request<JsonRecord>("/api/changes", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memoryReference: memoryReference(memory), operator })
      });
      const change = created.change as ChangeSummary;
      await this.request(`/api/changes/${encodeURIComponent(change.id)}/comments`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operator, memoryReference: memoryReference(memory), path: memory.path, target: target || undefined, location, snapshot: snapshot || undefined, body: body.trim(), expectedUpdatedAt: change.updatedAt })
      });
      await this.openChange(change.id);
    } catch (error) { this.showTransientError(error); }
  }

  private async importMarket(item: JsonRecord): Promise<void> {
    const operator = await this.chooseOperator(); if (!operator) return;
    const parts = String(item.reference ?? "").split("/");
    try {
      const response = await this.request<JsonRecord>(`/api/market/memories/${encodeURIComponent(parts[0] ?? "")}/${encodeURIComponent(parts.slice(1).join("/"))}/import`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operator })
      });
      await this.openChange(String((response.change as JsonRecord)?.id ?? ""));
    } catch (error) { this.showTransientError(error); }
  }

  private async addMemory(change: ChangeSummary): Promise<void> {
    try {
      const payload = await this.request<JsonRecord>("/api/memories?representation=summary");
      const scoped = new Set(change.memoryPaths ?? []);
      const candidates = (array(payload.memories) as MemorySummary[]).filter(memory => !memory.error && !scoped.has(memory.path));
      if (!candidates.length) { alert("没有可以加入的记忆。"); return; }
      const references = candidates.map(memory => memory.id).sort();
      const selected = prompt(`请选择记忆：\n${references.join("\n")}`, references[0]);
      if (!selected || !references.includes(selected.trim())) return;
      await this.request(`/api/changes/${encodeURIComponent(change.id)}/memories`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memoryReference: selected.trim(), expectedUpdatedAt: change.updatedAt }) });
      await this.load();
    } catch (error) { this.showTransientError(error); }
  }

  private async abandonChange(change: ChangeSummary): Promise<void> {
    if (!confirm("确认废弃这个 ChangeSet？")) return;
    try { await this.request(`/api/changes/${encodeURIComponent(change.id)}/abandon`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedUpdatedAt: change.updatedAt }) }); await this.load(); }
    catch (error) { this.showTransientError(error); }
  }

  private async archiveChange(change: ChangeSummary): Promise<void> {
    if (!confirm("确认归档这个 ChangeSet？")) return;
    try { await this.request(`/api/archive/changes/${encodeURIComponent(change.id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedUpdatedAt: change.updatedAt }) }); await this.navigate(this.#routes.index.to()); }
    catch (error) { this.showTransientError(error); }
  }

  private async composeComment(memory: MemorySummary, target: string, snapshot: string, location: unknown): Promise<void> {
    if (!this.canComment()) return;
    const body = prompt(target ? `评论 ${target}` : this.t("change.addComment")); if (!body?.trim()) return;
    const operator = await this.chooseOperator(); if (!operator) return;
    const change = this.#changeDetail?.change as ChangeSummary | undefined;
    try {
      await this.request(`/api/changes/${encodeURIComponent(change?.id ?? "")}/comments`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operator, memoryReference: memory.id, path: memory.path, target: target || undefined, location, snapshot: snapshot || undefined, body: body.trim(), expectedUpdatedAt: change?.updatedAt })
      });
      await this.load();
    } catch (error) { this.showTransientError(error); }
  }

  private editComment(host: HTMLElement, comment: JsonRecord): void {
    const existing = host.querySelector("textarea"); if (existing) return;
    const textarea = document.createElement("textarea"); textarea.value = String(comment.body ?? "");
    const actions = el("div", "memory-comment-actions");
    actions.append(button("保存", "memory-btn primary", async () => {
      if (!textarea.value.trim()) return;
      const operator = await this.chooseOperator(); if (!operator) return;
      const change = this.#changeDetail?.change as ChangeSummary | undefined;
      try { await this.request(`/api/changes/${encodeURIComponent(change?.id ?? "")}/comments/${encodeURIComponent(String(comment.id))}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ operator, body: textarea.value.trim(), expectedUpdatedAt: change?.updatedAt }) }); await this.load(); }
      catch (error) { this.showTransientError(error); }
    }), button("取消", "memory-btn", () => { textarea.remove(); actions.remove(); }));
    host.append(textarea, actions); textarea.focus();
  }

  private async deleteComment(id: string): Promise<void> {
    const operator = await this.chooseOperator(); if (!operator) return;
    const change = this.#changeDetail?.change as ChangeSummary | undefined;
    try { await this.request(`/api/changes/${encodeURIComponent(change?.id ?? "")}/comments/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ operator, expectedUpdatedAt: change?.updatedAt }) }); await this.load(); }
    catch (error) { this.showTransientError(error); }
  }

  private changeLinks(label: string, changes: ChangeSummary[]): HTMLElement {
    const details = document.createElement("details"); details.className = "memory-options";
    const summary = document.createElement("summary"); summary.className = "memory-related"; summary.textContent = label;
    const list = el("div", "memory-related-list");
    for (const change of changes) list.append(button(`${change.id} · ${this.changeStatusLabel(String(change.status ?? ""))}`, "", () => void this.openChange(change.id)));
    details.append(summary, list); return details;
  }

  private async openChange(changeId: string): Promise<void> {
    if (!changeId) return;
    const projectId = this.#currentProject || projectFromLocation(this.#location) || "memsphere";
    await this.navigate(this.#routes.changeDetail.to({ projectId, changeId }));
  }

  private async navigate(target: RouteTarget): Promise<void> { await this.#navigate(target); }

  private visibleMemories(): MemorySummary[] {
    const query = this.#query.trim().toLowerCase();
    return this.#memories.filter(memory => (!this.#hideSystem || !memory.system) && (!query || `${memory.id} ${memory.path} ${(memory.names ?? []).join(" ")}`.toLowerCase().includes(query)));
  }

  private currentOperator(): JsonRecord | null {
    const humans = Object.keys(this.#actorKinds).filter(id => this.#actorKinds[id] === "human").sort();
    const project = this.#currentProject || projectFromLocation(this.#location) || "memsphere";
    try {
      const stored = JSON.parse(localStorage.getItem(changeActorSelectionKey) || "{}");
      if (typeof stored[project] === "string" && humans.includes(stored[project])) return { kind: "human", id: stored[project] };
    } catch { /* ignore corrupt project-local selection */ }
    if (humans.length === 1) return { kind: "human", id: humans[0] };
    if (humans.length > 1) return null;
    let id = localStorage.getItem(changeBrowserIdentityKey);
    if (!id) { id = crypto.randomUUID?.() ?? `00000000-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12, "0").slice(0, 12)}`; localStorage.setItem(changeBrowserIdentityKey, id); }
    return { kind: "browser", id };
  }

  private async chooseOperator(): Promise<JsonRecord | null> {
    const current = this.currentOperator(); if (current) return current;
    const humans = Object.entries(this.#actorKinds).filter(([, kind]) => kind === "human").map(([id]) => id).sort();
    if (!humans.length) return this.currentOperator();
    const id = humans.length === 1 ? humans[0] : prompt("请输入 Human Actor id", humans[0] ?? "");
    if (!id?.trim()) return null;
    const operator = { kind: "human", id: id.trim() };
    const project = this.#currentProject || projectFromLocation(this.#location) || "memsphere";
    let stored: JsonRecord = {}; try { stored = JSON.parse(localStorage.getItem(changeActorSelectionKey) || "{}"); } catch { /* reset corrupt local value */ }
    stored[project] = operator.id; localStorage.setItem(changeActorSelectionKey, JSON.stringify(stored)); return operator;
  }

  private canComment(): boolean { return (this.#changeDetail?.change as ChangeSummary | undefined)?.status === "active" && !Boolean((this.#changeDetail?.change as ChangeSummary | undefined)?.claimed); }
  private marketStatusLabel(status: string): string { return this.t(`market.${({ not_imported: "notImported", importing: "importing", consistent: "consistent", different: "different", name_conflict: "nameConflict" } as Record<string, string>)[status] ?? status}`); }
  private changeStatusLabel(status: string): string { return this.t(`change.status.${status}`) === `change.status.${status}` ? status : this.t(`change.status.${status}`); }
  private commentStatus(status: string): string { return this.t(`change.comment.${status}`); }
  private renderOptions(): RenderOptions {
    return {
      knownReferences: new Set(this.#memories.map(memoryReference)),
      openReference: target => {
        const memory = this.#memories.find(candidate => memoryReference(candidate) === target || candidate.names?.[0] === target);
        if (!memory) return;
        const [kind, ...name] = memory.id.split("/");
        void this.navigate(this.#routes.memoryDetail.to({ kind, name: name.join("/") }));
      }
    };
  }
  private t(key: string): string { return message(this.#config, key); }
  private format(key: string, params: Record<string, string | number>): string { return Object.entries(params).reduce((value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)), this.t(key)); }

  private renderError(error: unknown, retry: () => void): void {
    this.#root.querySelector(".memory-module")?.remove();
    const app = el("section", "memory-module memory-workspace");
    const panel = errorWorkspace(this.t("fatal.title"), errorMessage(error)); panel.append(button(this.t("common.retry"), "memory-btn", retry)); app.append(panel); this.#root.append(app);
  }

  private showTransientError(error: unknown): void {
    const panel = errorWorkspace(this.t("fatal.title"), errorMessage(error)); this.#portal.replaceChildren(panel);
    const timer = window.setTimeout(() => this.#portal.replaceChildren(), 6000);
    this.#controller.signal.addEventListener("abort", () => window.clearTimeout(timer), { once: true });
  }
}

function text(value: string): TextRef { return { text: value }; }
function message(config: Readonly<MemoryConfig>, key: string): string {
  const configured: unknown = config.messages?.[key];
  if (typeof configured === "string") return configured;
  if (config.locale?.toLowerCase().startsWith("en")) return englishFallbackMessages[key] ?? key;
  return fallbackMessages[key] ?? key;
}

function parseLocation(location: Pick<RouteLocation, "pathname" | "search">): { kind: "market" | "change" | "memory-detail" | "index"; changeId: string; memoryKind: string; memoryName: string } {
  const parts = location.pathname.split("/").filter(Boolean).map(part => { try { return decodeURIComponent(part); } catch { return part; } });
  const changeQuery = new URLSearchParams(location.search).get("change") ?? "";
  if (parts[0] === "market" || parts[0] === "memory-market" || parts[2] === "market") return { kind: "market", changeId: "", memoryKind: "", memoryName: "" };
  if (parts[0] === "projects" && parts[2] === "changes" && parts[3]) return { kind: "change", changeId: parts[3], memoryKind: "", memoryName: "" };
  const offset = parts[0] === "projects" ? 3 : 1;
  if ((parts[0] === "memories" || parts[2] === "memories") && parts[offset] && parts[offset + 1]) return { kind: "memory-detail", changeId: changeQuery, memoryKind: parts[offset], memoryName: parts.slice(offset + 1).join("/") };
  return { kind: "index", changeId: changeQuery, memoryKind: "", memoryName: "" };
}

function projectFromLocation(location: Pick<RouteLocation, "pathname">): string {
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts[0] === "projects" && parts[1]) { try { return decodeURIComponent(parts[1]); } catch { return parts[1]; } }
  return "";
}

type RenderOptions = {
  knownReferences?: ReadonlySet<string>;
  openReference?: (target: string) => void;
};

function renderMemoryEntity(kind: string, entity: JsonRecord, t: (key: string) => string, comment?: (target: string, snapshot: string, location: unknown) => void, options: RenderOptions = {}): HTMLElement {
  if (kind === "schemas") return renderSchema(entity, 0, memoryName(entity as MemorySummary), "schema", t, comment, options);
  if (kind === "statements") return renderStatement(entity, 0, memoryName(entity as MemorySummary), "statement", t, comment, options);
  if (kind === "procedures") return renderProcedure(entity, "procedure", t, comment, options);
  return renderGeneric(entity, "memory", t, comment, options);
}

function renderSchema(node: JsonRecord, depth: number, fallback: string, path: string, t: (key: string) => string, comment?: CommentCallback, options: RenderOptions = {}): HTMLElement {
  const title = depth === 0 ? "" : memoryName(node as MemorySummary) || fallback;
  const badges = ["!schema"];
  if (node.optional === true) badges.push(`${t("optional")}: true`);
  if (node.type !== undefined) badges.push(`${t("type")}: ${translatedScalar(node.type, t)}`);
  if (node.format !== undefined) badges.push(`${t("format")}: ${formatLabel(node.format)}`);
  const section = nodeSection(title, path, node, comment, badges, depth < 2);
  const body = sectionBody(section);
  if (depth === 0) appendStringList(body, "names", array(node.names), path, comment, t);
  for (const key of ["defines", "asserts", "suggests"] as const) appendStringList(body, key, array(node[key]), path, comment, t);
  const fields = array(node.fields);
  if (fields.length) {
    body.append(blockTitle(t("fields")));
    const children = el("div", "memory-child-stack");
    fields.forEach((field, index) => {
      const fieldPath = `${path}.fields[${index + 1}]`;
      if (typeof field === "string") children.append(renderSimpleSchemaField(field, fieldPath, t, comment));
      else if (isReference(field)) children.append(renderMemoryReference(field, options, t));
      else if (field && typeof field === "object" && (field as JsonRecord).tag === "!repeat") children.append(renderSchemaRepeat(field as JsonRecord, depth + 1, fieldPath, t, comment, options));
      else if (field && typeof field === "object") children.append(renderSchema(field as JsonRecord, depth + 1, t("schemas"), fieldPath, t, comment, options));
    });
    body.append(children);
  }
  if (node.item && typeof node.item === "object") {
    body.append(blockTitle(t("item")), isReference(node.item) ? renderMemoryReference(node.item, options, t) : renderSchema(node.item as JsonRecord, depth + 1, t("item"), `${path}.item`, t, comment, options));
  }
  const items = array(node.items);
  if (items.length) {
    body.append(blockTitle(t("items")));
    const children = el("div", "memory-child-stack");
    items.forEach((item, index) => { if (item && typeof item === "object") children.append(isReference(item) ? renderMemoryReference(item, options, t) : renderSchema(item, depth + 1, `${t("item")} ${index + 1}`, `${path}.items[${index + 1}]`, t, comment, options)); });
    body.append(children);
  }
  return section;
}

function renderSchemaRepeat(node: JsonRecord, depth: number, path: string, t: (key: string) => string, comment?: CommentCallback, options: RenderOptions = {}): HTMLElement {
  const limit = node.limit && typeof node.limit === "object" ? node.limit as JsonRecord : {};
  const badges = ["!repeat", `${t("min")}: ${String(limit.min ?? 0)}`, `${t("max")}: ${String(limit.max ?? t("unbounded"))}`];
  const section = nodeSection(t("repeat"), path, node, comment, badges, depth < 2);
  const body = sectionBody(section);
  const children = el("div", "memory-child-stack");
  array(node.body).forEach((field, index) => {
    const fieldPath = `${path}.body[${index + 1}]`;
    if (typeof field === "string") children.append(renderSimpleSchemaField(field, fieldPath, t, comment));
    else if (isReference(field)) children.append(renderMemoryReference(field, options, t));
    else if (field && typeof field === "object") children.append(renderSchema(field as JsonRecord, depth + 1, t("schemas"), fieldPath, t, comment, options));
  });
  body.append(children);
  return section;
}

function renderSimpleSchemaField(name: string, path: string, t: (key: string) => string, comment?: CommentCallback): HTMLElement {
  const item = el("div", "memory-schema-field memory-commentable");
  item.dataset.anchor = path;
  item.append(el("span", "memory-schema-field-name", name), el("span", "schema-field-type", t("string")));
  if (comment) item.append(plusButton(() => comment(path, name, { anchor: path })));
  return item;
}

function renderStatement(node: JsonRecord, depth: number, fallback: string, path: string, t: (key: string) => string, comment?: CommentCallback, options: RenderOptions = {}): HTMLElement {
  const title = depth === 0 ? "" : memoryName(node as MemorySummary) || fallback;
  const section = nodeSection(title, path, node, comment, ["!statement"], depth < 2);
  const body = sectionBody(section);
  if (depth === 0) appendStringList(body, "names", array(node.names), path, comment, t);
  appendStringList(body, "defines", array(node.defines), path, comment, t);
  for (const key of ["asserts", "suggests"] as const) appendRuleList(body, key, array(node[key]), node.effectiveRules as JsonRecord | undefined, path, t, comment, options);
  const sections = array(node.sections);
  if (sections.length) {
    body.append(blockTitle(t("sections")));
    const children = el("div", "memory-child-stack");
    sections.forEach((child, index) => { if (child && typeof child === "object") children.append(renderStatement(child as JsonRecord, depth + 1, t("statements"), `${path}.sections[${index + 1}]`, t, comment, options)); });
    body.append(children);
  }
  return section;
}

function renderProcedure(node: JsonRecord, path: string, t: (key: string) => string, comment?: CommentCallback, options: RenderOptions = {}): HTMLElement {
  const document = el("div", "memory-document");
  appendStringList(document, "names", array(node.names), path, comment, t);
  for (const key of ["defines", "goals"] as const) appendStringList(document, key, array(node[key]), path, comment, t);
  for (const key of ["asserts", "suggests"] as const) appendRuleList(document, key, array(node[key]), node.effectiveRules as JsonRecord | undefined, path, t, comment, options);
  const steps = array(node.flow);
  if (steps.length) {
    document.append(blockTitle(t("flow")));
    const flow = el("div", "memory-flow");
    steps.forEach((step, index) => flow.append(step && typeof step === "object" ? renderFlowNode(step as JsonRecord, `${path}.flow[${index + 1}]`, t, comment, options) : commentable(el("div", "memory-flow-item", String(step)), `${path}.flow[${index + 1}]`, step, comment)));
    document.append(flow);
  }
  return document;
}

function renderFlowNode(node: JsonRecord, path: string, t: (key: string) => string, comment?: CommentCallback, options: RenderOptions = {}): HTMLElement {
  const tag = String(node.tag ?? "!action");
  if (tag === "!call") {
    const item = el("div", "memory-flow-item call");
    const head = el("div", "memory-flow-head");
    head.append(el("span", "memory-flow-label", t("call")), renderMemoryReference({ tag: "!ref", target: String(node.target ?? "") }, options, t));
    item.append(commentable(head, path, node, comment));
    return item;
  }
  const branch = tag === "!if" || tag === "!while";
  const item = el("div", `memory-flow-item${branch ? " branch" : ""}`);
  const control = node.condition && typeof node.condition === "object" ? node.condition as JsonRecord : node;
  const action = String(control.action ?? node.action ?? node.condition ?? "");
  const head = el("div", "memory-flow-head");
  head.append(el("span", "memory-flow-label", t(tag === "!if" ? "if" : tag === "!while" ? "while" : "step")), commentable(el("span", "memory-flow-action", action), `${path}.action`, action, comment), renderArtifactMeta(control, t));
  item.append(head);
  for (const key of ["asserts", "suggests"] as const) appendRuleList(item, key, array(control[key]), control.effectiveRules as JsonRecord | undefined, path, t, comment, options, "action-contracts");
  if (control.schema && typeof control.schema === "object") item.append(renderSchema(control.schema as JsonRecord, 1, t("inlineSchema"), `${path}.schema`, t, comment, options));
  for (const key of ["then", "do", "else"] as const) {
    const children = array(node[key]);
    if (!children.length) continue;
    const branchWrap = el("div", "memory-flow-branch");
    branchWrap.append(el("div", "memory-flow-condition", key === "then" || key === "do" ? "" : t(key)));
    const stack = el("div", "memory-flow-children");
    children.forEach((child, index) => { if (child && typeof child === "object") stack.append(renderFlowNode(child as JsonRecord, `${path}.${key}[${index + 1}]`, t, comment, options)); });
    branchWrap.append(stack); item.append(branchWrap);
  }
  return item;
}

function renderArtifactMeta(step: JsonRecord, t: (key: string) => string): HTMLElement {
  const row = el("div", "memory-artifact-row");
  const artifact = step.artifact && typeof step.artifact === "object"
    ? step.artifact as JsonRecord
    : { name: step.artifact, type: step.type, format: step.format, schema: step.schema, final: step.final, review: step.reviewPolicy };
  const name = String(artifact.name ?? "");
  row.append(el("span", "memory-artifact-label", t("artifact")));
  if (name) row.append(el("span", "memory-pill strong", name));
  if (artifact.type) row.append(el("span", "memory-pill", String(artifact.type)));
  if (artifact.format) row.append(el("span", "memory-pill", formatLabel(artifact.format)));
  if (artifact.final) row.append(el("span", "memory-pill done", t("final")));
  const reviewers = Array.isArray(artifact.review) ? artifact.review : typeof artifact.review === "string" ? [artifact.review] : [];
  reviewers.forEach(value => row.append(el("span", "memory-pill", String(value))));
  return row;
}

function renderGeneric(node: JsonRecord, path: string, t: (key: string) => string, comment?: CommentCallback, options: RenderOptions = {}): HTMLElement {
  const document = el("div", "memory-document");
  appendStringList(document, "names", array(node.names), path, comment, t);
  for (const key of ["defines", "asserts", "suggests"] as const) appendStringList(document, key, array(node[key]), path, comment, t);
  const ignored = new Set(["tag", "syntax", "name", "names", "defines", "asserts", "suggests", "effectiveRules"]);
  const primitives = renderPrimitiveFields(node, [...ignored], t, path, comment);
  if (primitives.childElementCount) document.append(primitives);
  for (const [key, value] of Object.entries(node)) {
    if (ignored.has(key) || value == null || typeof value !== "object" || Array.isArray(value)) continue;
    document.append(blockTitle(translatedKey(key, t)), renderGeneric(value as JsonRecord, `${path}.${key}`, t, comment, options));
  }
  return document;
}

type CommentCallback = (target: string, snapshot: string, location: unknown) => void;
function nodeSection(title: string, path: string, snapshot: unknown, comment?: CommentCallback, badges: string[] = [], open = true): HTMLElement {
  const section = el("section", `memory-section memory-node memory-commentable${open ? " open" : ""}`); section.dataset.anchor = path;
  const header = button("", "memory-section-header", () => section.classList.toggle("open"));
  header.append(el("span", "memory-chevron", "›"), el("span", "memory-node-title", title));
  const badgeWrap = el("span", "node-badges"); badges.filter(Boolean).forEach(value => badgeWrap.append(el("span", "memory-pill", value))); header.append(badgeWrap);
  section.append(header, el("div", "memory-section-body"));
  if (comment) section.append(plusButton(() => comment(path, scalar(snapshot), { anchor: path })));
  return section;
}
function sectionBody(section: HTMLElement): HTMLElement { return section.querySelector<HTMLElement>(":scope > .memory-section-body")!; }
function blockTitle(value: string): HTMLElement { return el("div", "memory-block-title", value); }
function commentable(node: HTMLElement, target: string, snapshot: unknown, comment?: CommentCallback): HTMLElement {
  if (!comment) return node; node.classList.add("memory-commentable"); node.dataset.anchor = target; node.append(plusButton(() => comment(target, scalar(snapshot), { anchor: target }))); return node;
}
function plusButton(run: () => void): HTMLButtonElement { const plus = button("+", "memory-inline-plus", run); plus.title = "添加评论"; plus.setAttribute("aria-label", "添加评论"); return plus; }
function renderPrimitiveFields(node: JsonRecord, excluded: string[], t: (key: string) => string, path: string, comment?: CommentCallback): HTMLElement {
  const dl = document.createElement("dl"); dl.className = "memory-kv";
  for (const [key, value] of Object.entries(node)) if (!excluded.includes(key) && (value == null || typeof value !== "object")) {
    const dt = document.createElement("dt"); dt.textContent = translatedKey(key, t); const dd = document.createElement("dd"); dd.textContent = translatedScalar(value, t);
    if (key === "type") dd.classList.add("schema-field-type");
    dl.append(dt, commentable(dd, `${path}.${key}`, value, comment));
  }
  return dl;
}

function translatedKey(key: string, t: (key: string) => string): string {
  const translated = t(key);
  return translated === key ? key : translated;
}

function translatedScalar(value: unknown, t: (key: string) => string): string {
  if (typeof value !== "string") return scalar(value);
  const translated = t(value);
  return translated === value ? value : translated;
}

function isReference(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && (value as JsonRecord).tag === "!ref");
}

function renderMemoryReference(ref: JsonRecord, options: RenderOptions, t: (key: string) => string): HTMLButtonElement {
  const target = String(ref.target ?? "");
  const missing = Boolean(options.knownReferences && !options.knownReferences.has(target));
  const link = button(target || t("referenceNotFound"), `memory-ref-link${missing ? " missing" : ""}`, () => {
    if (!missing) options.openReference?.(target);
  });
  link.disabled = !target;
  link.title = missing ? t("referenceNotFound") : target;
  return link;
}

function appendRuleList(
  parent: HTMLElement,
  key: "asserts" | "suggests",
  values: unknown[],
  effectiveRules: JsonRecord | undefined,
  path: string,
  t: (key: string) => string,
  comment?: CommentCallback,
  options: RenderOptions = {},
  className = ""
): void {
  if (!values.length) return;
  const panel = el("section", className);
  panel.append(blockTitle(translatedKey(key, t)));
  const list = document.createElement("ul");
  list.className = "text-list";
  const effective = array(effectiveRules?.[key]);
  values.forEach((value, index) => {
    const item = document.createElement("li");
    const targetPath = `${path}.${key}[${index + 1}]`;
    if (isReference(value)) {
      const target = String(value.target ?? "");
      const projection = effective.find(entry => entry && typeof entry === "object" && String(entry.reference ?? entry.target ?? "") === target) as JsonRecord | undefined;
      const reference = renderRuleReference(value, projection, key, t, options);
      const body = el("div", "commentable-body"); body.dataset.commentSnapshot = target; body.append(reference);
      item.append(commentable(body, targetPath, target, comment));
    } else {
      const body = el("span", "commentable-body", scalar(value)); body.dataset.commentSnapshot = scalar(value);
      item.append(commentable(body, targetPath, value, comment));
    }
    list.append(item);
  });
  panel.append(list);
  parent.append(panel);
}

function renderRuleReference(ref: JsonRecord, effective: JsonRecord | undefined, channel: "asserts" | "suggests", t: (key: string) => string, options: RenderOptions): HTMLElement {
  const wrap = el("div", "rule-reference");
  const summary = el("div", "rule-reference-summary");
  summary.append(renderMemoryReference(ref, options, t));
  if (effective) {
    const count = countEffectiveRules(effective);
    const toggle = button(`${count} ${t("effectiveRuleCount")}`, "rule-reference-toggle", () => {
      body.hidden = !body.hidden;
      toggle.setAttribute("aria-expanded", String(!body.hidden));
    });
    toggle.setAttribute("aria-expanded", "false");
    const body = el("div", "effective-rule-inline"); body.hidden = true;
    appendEffectiveRules(body, effective, channel);
    summary.append(toggle); wrap.append(summary, body);
  } else wrap.append(summary);
  return wrap;
}

function effectiveEntries(node: JsonRecord, channel: "asserts" | "suggests"): unknown[] {
  const direct = node[channel];
  if (Array.isArray(direct)) return direct;
  if (Array.isArray(node.entries)) return node.entries;
  return [];
}

function countEffectiveRules(node: JsonRecord): number {
  let count = 0;
  for (const value of [...effectiveEntries(node, "asserts"), ...effectiveEntries(node, "suggests")]) {
    if (typeof value === "string" || (value && typeof value === "object" && (value as JsonRecord).kind === "rule")) count += 1;
    else if (value && typeof value === "object") count += countEffectiveRules(value as JsonRecord);
  }
  for (const section of array(node.sections)) count += countEffectiveRules(section);
  return count;
}

function appendEffectiveRules(parent: HTMLElement, node: JsonRecord, channel: "asserts" | "suggests"): void {
  const entries = effectiveEntries(node, channel);
  if (entries.length) {
    const list = document.createElement("ul"); list.className = "effective-rule-list";
    for (const entry of entries) {
      if (typeof entry === "string") list.append(el("li", "", entry));
      else if (entry && typeof entry === "object") {
        const record = entry as JsonRecord;
        if (record.kind === "rule") list.append(el("li", "", String(record.text ?? "")));
        else appendEffectiveRules(list, record, channel);
      }
    }
    parent.append(list);
  }
  for (const section of array(node.sections)) {
    const block = el("section", "memory-node");
    block.append(el("h4", "", String(section.name ?? "")));
    for (const definition of array(section.defines)) block.append(el("p", "", scalar(definition)));
    appendEffectiveRules(block, section, channel);
    parent.append(block);
  }
}
function appendStringList(parent: HTMLElement, key: string, values: unknown[], path: string, comment?: CommentCallback, t: (key: string) => string = value => value): void {
  if (!values.length) return;
  const block = el("section", "memory-list-block");
  block.append(blockTitle(translatedKey(key, t)));
  const list = document.createElement("ul"); list.className = "text-list";
  values.forEach((value, index) => { const li = document.createElement("li"); li.textContent = scalar(value); list.append(commentable(li, `${path}.${key}[${index + 1}]`, value, comment)); });
  block.append(list); parent.append(block);
}

function renderMeta(memory: MemorySummary): HTMLElement { const meta = el("div", "memory-meta"); for (const value of [memory.kind, memory.path, memory.system ? "system" : "user"]) if (value) meta.append(el("span", "memory-pill", String(value))); return meta; }
function renderIssues(issues: JsonRecord[], title: string): HTMLElement { const panel = el("section", "memory-error"); panel.append(el("h3", "", title)); const list = document.createElement("ul"); issues.forEach(issue => list.append(el("li", "", `${issue.path ?? ""}${issue.line ? `:${issue.line}` : ""}: ${issue.message ?? ""}`))); panel.append(list); return panel; }
function emptyWorkspace(value: string): HTMLElement { return el("section", "memory-empty", value); }
function errorWorkspace(title: string, detail: string): HTMLElement { const panel = el("section", "memory-error"); panel.append(el("h3", "", title), el("p", "", detail)); return panel; }
function marketStatus(status: string, label: string): HTMLElement { const node = el("span", "memory-market-status", label); node.dataset.status = status; return node; }
function button(label: string, className: string, run: () => void): HTMLButtonElement { const node = document.createElement("button"); node.type = "button"; node.className = className; node.textContent = label; node.addEventListener("click", run); return node; }
function input(type: string, placeholder: string, value: string, className = ""): HTMLInputElement { const node = document.createElement("input"); node.type = type; node.placeholder = placeholder; node.value = value; node.className = className; return node; }
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", value = ""): HTMLElementTagNameMap[K] { const node = document.createElement(tag); node.className = className; node.textContent = value; return node; }
function kv(key: string, value: string): HTMLElement { const dl = document.createElement("dl"); dl.className = "memory-kv"; dl.append(el("dt", "", key), el("dd", "", value)); return dl; }
function array(value: unknown): JsonRecord[] & unknown[] { return Array.isArray(value) ? value as JsonRecord[] & unknown[] : []; }
function memoryName(memory: MemorySummary): string {
  const entity = memory.entity ?? memory;
  const names = Array.isArray(entity.names) ? entity.names : memory.names;
  return String(names?.[1] ?? names?.[0] ?? entity.name ?? (basenameWithoutExtension(memory.path) || memory.id?.split("/").at(-1)) ?? "Memory");
}
function memoryReference(memory: MemorySummary): string {
  const entity = memory.entity ?? memory;
  const names = Array.isArray(entity.names) ? entity.names : memory.names;
  const name = String(names?.[0] ?? (basenameWithoutExtension(memory.path) || memory.id?.split("/").at(-1)) ?? "");
  return `${memory.kind}/${name}`;
}
function basenameWithoutExtension(path: unknown): string {
  const name = String(path ?? "").split(/[\\/]/).at(-1) ?? "";
  return name.replace(/\.(?:ya?ml|json)$/i, "");
}
function scalar(value: unknown): string { if (value === null) return "null"; if (value === undefined) return ""; return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value); }
function formatLabel(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return scalar(value);
  const record = value as JsonRecord;
  return typeof record.name === "string" ? record.name : Object.entries(record).map(([key, entry]) => `${key}: ${scalar(entry)}`).join(" · ");
}
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    const detail = JSON.stringify(error);
    return error && typeof error === "object" && Array.isArray((error as JsonRecord).issues) ? `YAML: ${detail}` : detail;
  } catch { return String(error); }
}
function actorLabel(value: unknown): string { if (!value || typeof value !== "object") return ""; const actor = value as JsonRecord; return String(actor.id ?? actor.name ?? actor.kind ?? ""); }
function isMine(comment: JsonRecord, operator: JsonRecord | null): boolean { if (!operator) return false; const actor = (comment.submitted_by ?? comment.operator ?? comment.actor) as JsonRecord | undefined; return actor?.id === operator.id && actor?.kind === operator.kind; }
function asStringRecord(value: unknown): Record<string, string> { if (!value || typeof value !== "object" || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")); }
