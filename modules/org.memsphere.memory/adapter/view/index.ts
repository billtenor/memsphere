import {
  defineViewPlugin,
  slots,
  type Disposer,
  type HeaderActionDescriptor,
  type HeaderTitleDescriptor,
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
  baseMemory?: MemorySummary;
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
  projectApiBase?: string;
};
type MemoryRouteName = "index" | "market" | "memory-detail" | "project-index"
  | "project-memory-detail" | "project-market" | "change-detail";

const kindOrder = ["procedures", "schemas", "concepts", "statements"] as const;
const hideSystemMemoriesKey = "memsphere.hideSystemMemories.v1";
const changeActorSelectionKey = "memsphere.changeActorSelection.v1";
const changeBrowserIdentityKey = "memsphere.changeBrowserIdentity.v1";
const changeCommentsCollapsedKey = "memsphere.changeCommentsCollapsed.v1";
const changeReviewedKeyPrefix = "memsphere.changeReviewed.v1";
const recentMemoriesKey = "memsphere.memory.recent.v1";
const recentMemoryLimit = 24;

const fallbackMessages: Readonly<Record<string, string>> = Object.freeze({
  "navigation.memory": "记忆",
  "navigation.run": "运行",
  "navigation.settings": "设置",
  "navigation.currentProject": "当前项目",
  "navigation.memoryMarket": "记忆市场",
  "common.loading": "加载中…",
  "common.retry": "重试",
  "common.archive": "归档",
  "common.abandon": "废弃",
  "memory.search": "搜索记忆",
  "memory.recent": "最近使用",
  "memory.recentSearch": "搜索最近使用",
  "memory.recentEmpty": "还没有最近使用的记忆。打开一条记忆后，它会出现在这里。",
  "memory.visibleCount": "共 {count} 条",
  "memory.marketItemCount": "共 {count} 项",
  "memory.empty": "没有可展示的记忆。",
  "memory.select": "选择一条记忆查看详情。",
  "memory.edit": "修改",
  "memory.createChange": "创建变更",
  "memory.active": "已生效",
  "memory.editConfirm": "创建一个记忆变更来修改这条记忆？",
  "memory.invalidYaml": "记忆 YAML 无效",
  "memory.hideSystem": "隐藏系统记忆",
  "memory.otherChangeSets": "其他记忆变更（{count}）",
  "memory.relatedChangeSets": "修改中（{count}）",
  "market.empty": "记忆市场中没有可用内容。",
  "market.search": "搜索记忆市场",
  "market.import": "导入",
  "market.reimport": "重新导入",
  "market.notImported": "未导入",
  "market.importing": "导入中",
  "market.consistent": "已同步",
  "market.different": "有更新",
  "market.nameConflict": "名称冲突",
  "market.viewChangeSet": "查看记忆变更",
  "change.title": "记忆变更",
  "change.select": "选择一个记忆变更。",
  "change.search": "搜索记忆变更",
  "change.empty": "没有记忆变更。",
  "change.comments": "修改意见",
  "change.collapseComments": "收起意见",
  "change.expandComments": "展开意见",
  "change.noComments": "暂无修改意见。",
  "change.addComment": "添加评论",
  "change.commentPlaceholder": "说明这里需要怎样调整…",
  "change.submitComment": "提交意见",
  "change.cancelComment": "取消",
  "change.addMemory": "加入记忆",
  "change.validationDiagnostics": "校验诊断",
  "change.sourceUnavailable": "来源工作区不可用",
  "change.draftPreview": "草稿预览",
  "change.diff": "差异",
  "change.candidateContent": "完整内容",
  "change.before": "修改前",
  "change.after": "修改后",
  "change.added": "新增",
  "change.deleted": "删除",
  "change.fieldChanges": "{count} 处字段变化",
  "change.validationPassed": "校验通过",
  "change.reviewProgress": "已查看 {reviewed} / {total}",
  "change.markReviewedTitle": "看完这条 Memory 了吗？",
  "change.markReviewedHint": "标记后会自动进入下一条待查看内容。",
  "change.markReviewed": "标记已查看并继续",
  "change.reviewed": "已查看",
  "change.operation.create": "新增", "change.operation.update": "修改", "change.operation.delete": "删除", "change.operation.rename": "重命名",
  "change.deletedCandidateTitle": "删除后不存在",
  "change.deletedCandidateHint": "候选版本中已删除这条 Memory。",
  "change.beforeFullContent": "删除前完整内容",
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
  "inlineSchema": "产物格式与结构",
  "review": "评审"
});

const englishFallbackMessages: Readonly<Record<string, string>> = Object.freeze({
  "memory.active": "Active",
  "memory.visibleCount": "{count} total", "memory.marketItemCount": "{count} items",
  type: "Type", optional: "Optional", fields: "Fields", item: "Item", items: "Candidates",
  layout: "Layout", min: "Minimum", max: "Maximum", string: "Short text", boolean: "Boolean",
  number: "Number", markdown: "Document", effectiveRuleCount: "effective rules",
  referenceNotFound: "Reference not found", "change.sourceUnavailable": "Source workspace unavailable",
  "memory.invalidYaml": "Invalid Memory YAML", "change.draftPreview": "Draft preview",
  "memory.recentSearch": "Search recently used", "memory.recentEmpty": "No recently used Memory yet. Open one and it will appear here.",
  "market.search": "Search Memory Market", "change.search": "Search ChangeSets",
  "change.diff": "Diff", "change.candidateContent": "Full content", "change.before": "Before", "change.after": "After",
  "change.added": "Added", "change.deleted": "Deleted",
  "change.collapseComments": "Collapse comments", "change.expandComments": "Expand comments",
  "change.addComment": "Add comment",
  "change.commentPlaceholder": "Describe what should change here…",
  "change.submitComment": "Submit comment", "change.cancelComment": "Cancel",
  "change.fieldChanges": "{count} field changes",
  "change.validationPassed": "Validation passed", "change.reviewProgress": "Reviewed {reviewed} / {total}",
  "change.markReviewedTitle": "Finished reviewing this Memory?", "change.markReviewedHint": "Continue to the next unreviewed Memory after marking it.",
  "change.markReviewed": "Mark reviewed and continue", "change.reviewed": "Reviewed",
  "change.operation.create": "Create", "change.operation.update": "Edit", "change.operation.delete": "Delete", "change.operation.rename": "Rename",
  "change.deletedCandidateTitle": "Not present after deletion", "change.deletedCandidateHint": "This Memory is absent from the candidate version.",
  "change.beforeFullContent": "Full content before deletion",
  "change.store": "Store: {value}", "change.validationFailed": "Validation failed",
  names: "Names", defines: "Defines", asserts: "Required rules", suggests: "Suggested rules",
  goals: "Goals", flow: "Flow", format: "Format", repeat: "Repeat", unbounded: "Unbounded",
  sections: "Sections", call: "Call", if: "If", while: "While", else: "Else", step: "Step",
  artifact: "Artifact", final: "Final", inlineSchema: "Artifact format & structure", review: "Review"
});

const memoryStyles = `
  .memory-module {
    --bg:#f6f7f4; --surface:#fff; --soft:#eef1ed; --line:#d9ded8; --text:#222629; --muted:#6c7379; --accent:#286c67; --accent-soft:#dfeeea; --danger:#a14436;
    /* Memory Page Slot standard. Renderers consume semantic tokens; change states only add tone and layout. */
    --memory-page-font-sans:ui-sans-serif,system-ui,sans-serif;
    --memory-page-font-mono:ui-monospace,SFMono-Regular,Consolas,monospace;
    --memory-page-text-card-title:15px;
    --memory-page-text-section-title:13px;
    --memory-page-text-body:13px;
    --memory-page-text-label:11px;
    --memory-page-text-meta:10px;
    --memory-page-line-body:1.65;
    --memory-page-line-compact:1.4;
    --memory-page-space-line:8px;
    --memory-page-space-section:16px;
    --memory-page-space-card:16px;
    --memory-page-padding:24px;
    --memory-page-card-padding:20px;
    --memory-page-radius-card:12px;
    --memory-page-radius-section:8px;
    min-height:calc(100vh - 82px); background:var(--bg); color:var(--text); font:14px/1.45 var(--memory-page-font-sans);
  }
  .memory-module * { box-sizing:border-box; }
  .memory-module button,.memory-module input,.memory-module textarea { font:inherit; }
  .memory-module button { cursor:pointer; }
  .memory-layout { display:grid; grid-template-columns:300px minmax(0,1fr); min-height:calc(100vh - 82px); }
  .memory-list-surface .memory-module,.memory-detail-surface .memory-module { min-height:100%; background:transparent; }
  .memory-list-surface .memory-sidebar { position:static; display:flex; width:100%; height:auto; min-height:100%; flex-direction:column; border-right:0; background:transparent; padding:0 8px 12px; }
  .memory-detail-surface .memory-workspace { min-height:100%; }
  .memory-sidebar { position:sticky; top:0; height:calc(100vh - 82px); overflow:auto; padding:16px; border-right:1px solid var(--line); background:#fbfbf8; }
  .memory-brand,.memory-toolbar,.memory-toolbar-actions,.memory-comment-actions { display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .memory-brand h1,.memory-title { margin:0; }
  .memory-brand h1 { font-size:18px; }
  .memory-top-nav { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; margin-top:14px; }
  .memory-top-nav a,.memory-source-tab { border:1px solid var(--line); border-radius:6px; background:var(--surface); color:var(--muted); padding:7px 8px; text-align:center; text-decoration:none; }
  .memory-top-nav a.active,.memory-source-tab.active { border-color:#b8cbc7; background:var(--accent-soft); color:#173f3c; font-weight:700; }
  .memory-source-tabs { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:3px; margin-top:8px; padding:3px; border:1px solid var(--line); border-radius:6px; background:var(--soft); }
  .memory-source-tab { min-height:28px; border:0; padding:4px 7px; font-size:var(--memory-page-text-label); line-height:var(--memory-page-line-compact); }
  .memory-search,.memory-module textarea { width:100%; border:1px solid var(--line); border-radius:6px; background:var(--surface); outline:none; }
  .memory-list-header { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; padding:19px 10px 10px; }
  .memory-list-header-copy { min-width:0; flex:1; }
  .memory-list-header-copy small { display:block; margin-bottom:4px; color:#82908d; font-size:10px; font-weight:700; letter-spacing:.09em; text-transform:uppercase; }
  .memory-list-header h2 { margin:0; font-size:18px; line-height:1.3; letter-spacing:-.02em; }
  .memory-list-header.compact { align-items:center; }
  .memory-list-header.compact h2 { overflow:hidden; font-size:14px; line-height:1.35; text-overflow:ellipsis; white-space:nowrap; }
  .memory-list-refresh { display:grid; width:32px; height:32px; place-items:center; border:0; border-radius:8px; background:transparent; color:var(--muted); font-size:18px; }
  .memory-list-refresh:hover { background:#f0f4f2; color:var(--accent); }
  .memory-list-refresh img { width:17px; height:17px; opacity:.7; }
  .memory-search { height:36px; margin:0 6px 10px; padding:0 10px; border-color:#dce4e1; border-radius:9px; background:#f8faf9; font-size:12px; }
  .memory-module textarea { min-height:88px; padding:10px; resize:vertical; }
  .memory-search:focus,.memory-module textarea:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(40,108,103,.12); }
  .memory-count,.memory-muted,.memory-subtitle { color:var(--muted); }
  .memory-count { margin:0 9px 8px; color:#87928f; font-size:10px; }
  .memory-list-footer { margin-top:auto; padding:12px 10px 0; border-top:1px solid var(--line); color:#87928f; font-size:10px; }
  .memory-review-progress { display:grid; gap:6px; margin:0 6px 10px; color:#71807d; font-size:10px; }
  .memory-review-progress-track { height:3px; overflow:hidden; border-radius:3px; background:#e4ebe8; }
  .memory-review-progress-track>span { display:block; height:100%; border-radius:inherit; background:var(--accent); }
  .memory-list-empty { margin:18px 10px; color:#87928f; font-size:12px; line-height:1.6; }
  .memory-navigation { display:flex; min-height:100%; flex-direction:column; }
  .memory-kind { margin:10px 9px 4px; color:#82908d; font-size:10px; font-weight:700; letter-spacing:.08em; }
  .memory-list,.memory-comment-list,.memory-flow { display:grid; gap:2px; }
  .memory-button { position:relative; display:grid; width:100%; min-height:58px; grid-template-columns:34px minmax(0,1fr) minmax(34px,auto); align-items:start; gap:9px; border:0; border-radius:10px; background:transparent; color:var(--text); padding:10px 7px 10px 9px; text-align:left; overflow-wrap:anywhere; }
  .memory-button:hover { background:#f2f6f5; }
  .memory-button-icon { display:grid; width:34px; height:34px; place-items:center; border-radius:10px; background:#eef4f2; color:#5c7773; font-size:16px; }
  .memory-button-icon img { width:18px; height:18px; opacity:.72; }
  .memory-button-copy { display:block; min-width:0; }
  .memory-button-copy strong,.memory-button-copy small,.memory-button-copy span { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .memory-button-copy strong { color:#27312f; font-size:13px; font-weight:650; line-height:1.35; }
  .memory-button-copy small { margin-top:3px; color:#87928f; font-size:10px; }
  .memory-button-copy span { margin-top:4px; color:#697572; font-size:11px; }
  .memory-button-caret { width:14px; height:14px; margin-top:8px; opacity:.55; transform:rotate(-90deg); }
  .memory-button-trailing { display:flex; min-width:0; flex-direction:column; align-items:flex-end; gap:6px; padding-top:1px; }
  .memory-review-state { min-width:34px; justify-self:end; color:var(--accent); font-size:10px; text-align:right; white-space:nowrap; }
  .memory-review-state.reviewed { display:grid; width:22px; min-width:22px; height:22px; place-items:center; border-radius:50%; background:#e1efed; font-size:13px; font-weight:800; }
  .memory-button-trailing .memory-button-caret { margin-top:0; }
  .memory-change-wrap { border-radius:6px; }
  .memory-change-wrap:hover { background:#eceee8; }
  .memory-change-wrap:hover .memory-button { background:transparent; }
  .memory-button.active { background:#e1efed; color:#173f3c; font-weight:700; }
  .memory-button.active .memory-button-icon { background:#fff; color:var(--accent); }
  .memory-change-wrap.active { border-radius:6px; background:var(--accent-soft); }
  .memory-change-wrap.active .memory-button { background:transparent; }
  .memory-related { margin:-4px 9px 5px; color:var(--accent); font-size:12px; }
  .memory-related-list { display:grid; gap:3px; margin:0 9px 7px; }
  .memory-related-list button { border:0; background:transparent; color:var(--muted); padding:2px 0; text-align:left; font:11px/1.35 ui-monospace,monospace; }
  .memory-options { margin-top:16px; padding-top:12px; border-top:1px solid var(--line); }
  .memory-change-wrap > .memory-options { margin-top:0; padding-top:0; border-top:0; }
  .memory-option { display:flex; align-items:center; gap:8px; color:var(--muted); }
  .memory-workspace { min-width:0; max-width:972px; margin:0 auto; padding:var(--memory-page-padding) var(--memory-page-padding) 48px; font-size:var(--memory-page-text-body); line-height:var(--memory-page-line-body); }
  .memory-workspace.memory-change-workspace { max-width:none; margin:0; padding-right:0; }
  .memory-workspace .memory-btn { font-size:var(--memory-page-text-label); line-height:var(--memory-page-line-compact); }
  .memory-toolbar { align-items:flex-start; justify-content:flex-start; margin:0 0 14px; border:1px solid var(--line); border-radius:12px; background:var(--surface); padding:19px 20px; box-shadow:0 1px 2px rgba(20,47,42,.025); }
  .memory-toolbar-icon { display:grid; width:46px; height:46px; flex:0 0 auto; place-items:center; border-radius:13px; background:var(--accent-soft); }
  .memory-toolbar-icon img { width:26px; height:26px; filter:invert(37%) sepia(18%) saturate(1485%) hue-rotate(123deg) brightness(89%) contrast(86%); }
  .memory-status-pill { display:inline-flex; margin-bottom:5px; border-radius:999px; background:#edf7f5; padding:3px 7px; color:var(--accent); font-size:10px; font-weight:650; }
  .memory-title { font-size:18px; line-height:1.3; overflow-wrap:anywhere; }
  .memory-subtitle { margin-top:4px; font-size:12px; overflow-wrap:anywhere; }
  .memory-toolbar-actions,.memory-comment-actions { justify-content:flex-start; flex-wrap:wrap; }
  .memory-btn { border:1px solid var(--line); border-radius:6px; background:var(--surface); color:var(--text); padding:7px 10px; }
  .memory-btn.primary { border-color:var(--accent); background:var(--accent); color:#fff; }
  .memory-btn.danger { color:var(--danger); }
  .memory-btn:disabled { opacity:.55; cursor:not-allowed; }
  .memory-empty,.memory-panel,.memory-error { border:1px solid var(--line); border-radius:var(--memory-page-radius-card); background:var(--surface); padding:var(--memory-page-card-padding); box-shadow:0 1px 2px rgba(25,30,35,.08); }
  .memory-error { border-color:#e8c7bd; border-left:4px solid var(--danger); background:#fffdfb; }
  .memory-error h3 { color:var(--danger); }
  .memory-panel { margin:var(--memory-page-space-card) 0; box-shadow:0 1px 2px rgba(20,47,42,.025); }
  .memory-panel>h3 { margin:0 0 var(--memory-page-space-section); font-size:var(--memory-page-text-card-title); line-height:var(--memory-page-line-compact); }
  .memory-panel p,.memory-panel li { font-size:var(--memory-page-text-body); line-height:var(--memory-page-line-body); }
  .memory-meta { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0 12px; }
  .memory-pill { display:inline-flex; border:1px solid var(--line); border-radius:999px; background:var(--soft); color:var(--muted); padding:2px 8px; font-size:var(--memory-page-text-label); line-height:var(--memory-page-line-compact); }
  .memory-market-row { align-items:start; }
  .memory-market-status { border:1px solid var(--line); border-radius:999px; background:var(--surface); color:var(--muted); padding:1px 6px; font-size:11px; white-space:nowrap; }
  .memory-market-status[data-status=consistent],.memory-market-status[data-status=importing] { border-color:#b8cbc7; color:var(--accent); }
  .memory-market-status[data-status=name_conflict] { color:var(--danger); }
  .memory-node { position:relative; margin:var(--memory-page-space-line) 0; padding:10px 12px; border-left:3px solid #c6d4d1; background:#fafbf8; }
  .memory-node h3,.memory-node h4 { margin:0 0 8px; }
  .node-badges { display:inline-flex; flex-wrap:wrap; gap:6px; margin-left:8px; }
  .rule-reference-summary { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .memory-ref-link,.rule-reference-toggle { border:0; border-radius:999px; background:var(--soft); color:var(--accent); padding:3px 9px; }
  .memory-ref-link.missing { color:var(--danger); text-decoration:line-through; }
  .rule-reference-toggle:disabled { opacity:.55; cursor:not-allowed; }
  .effective-rule-inline { margin:8px 0 2px 14px; padding-left:12px; border-left:2px solid var(--line); }
  .effective-rule-inline[hidden] { display:none; }
  .memory-node ul { margin:6px 0; padding-left:22px; }
  .memory-document { display:grid; gap:var(--memory-page-space-section); font-size:var(--memory-page-text-body); line-height:var(--memory-page-line-body); }
  .memory-section { position:relative; margin:var(--memory-page-space-line) 0; overflow:hidden; border:1px solid var(--line); border-radius:var(--memory-page-radius-section); background:var(--surface); box-shadow:0 1px 2px rgba(25,30,35,.07); }
  .memory-section.memory-node { padding:0; border-left:1px solid var(--line); background:var(--surface); }
  .memory-section-header { display:grid; grid-template-columns:22px minmax(0,1fr) auto; align-items:center; gap:8px; width:100%; border:0; background:transparent; color:var(--text); padding:12px 14px; text-align:left; }
  .memory-section-header:hover { background:#f7f8f5; }
  .memory-chevron { color:var(--muted); font-size:22px; line-height:1; transform:rotate(0); transition:transform .12s ease; }
  .memory-section.open>.memory-section-header .memory-chevron { transform:rotate(90deg); }
  .memory-node-title { min-width:0; font-size:var(--memory-page-text-section-title); font-weight:650; line-height:var(--memory-page-line-compact); overflow-wrap:anywhere; }
  .memory-section-body { display:none; padding:4px 16px 16px 44px; border-top:1px solid var(--line); }
  .memory-section.open>.memory-section-body { display:block; }
  .memory-block-title { margin:var(--memory-page-space-section) 0 var(--memory-page-space-line); color:var(--muted); font-size:var(--memory-page-text-section-title); font-weight:650; line-height:var(--memory-page-line-compact); letter-spacing:0; text-transform:none; }
  .text-list { display:grid; gap:var(--memory-page-space-line); margin:0; padding-left:20px; }
  .text-list>li { padding:2px 4px; white-space:pre-wrap; overflow-wrap:anywhere; }
  .memory-child-stack { display:grid; gap:var(--memory-page-space-line); }
  .memory-schema-field { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:12px; min-height:38px; padding:8px 12px; border:1px solid var(--line); border-radius:6px; background:#fafbf8; }
  .memory-schema-field-name { font-size:var(--memory-page-text-body); font-weight:400; line-height:var(--memory-page-line-body); overflow-wrap:anywhere; }
  .schema-field-type { color:var(--muted); font-size:var(--memory-page-text-label); line-height:var(--memory-page-line-compact); }
  .memory-flow { gap:12px; }
  .memory-flow-item { position:relative; overflow:hidden; border:1px solid var(--line); border-left:4px solid #9cbab5; border-radius:var(--memory-page-radius-section); background:var(--surface); }
  .memory-flow-item.call { border-left-color:#8799b1; }
  .memory-flow-item.branch { border-left-color:#c3a269; }
  .memory-flow-head { display:flex; align-items:flex-start; gap:10px; flex-wrap:wrap; padding:11px 13px; }
  .memory-flow-label { flex:0 0 auto; border-radius:999px; background:var(--accent-soft); color:#173f3c; padding:2px 8px; font-size:var(--memory-page-text-label); font-weight:650; line-height:var(--memory-page-line-compact); }
  .memory-flow-action { min-width:0; flex:1 1 240px; font-size:var(--memory-page-text-body); font-weight:650; line-height:var(--memory-page-line-body); white-space:pre-wrap; overflow-wrap:anywhere; }
  .memory-flow-branch { border-top:1px solid var(--line); background:#fafbf8; padding:9px 12px 12px 24px; }
  .memory-flow-condition { margin-bottom:7px; color:var(--muted); font-size:var(--memory-page-text-label); font-weight:650; line-height:var(--memory-page-line-compact); }
  .memory-flow-children { display:grid; gap:8px; }
  .memory-artifact-row { display:flex; align-items:center; gap:5px; flex-wrap:wrap; margin-left:auto; }
  .memory-artifact-label { color:var(--muted); font-size:var(--memory-page-text-label); line-height:var(--memory-page-line-compact); }
  .memory-pill.strong { border-color:#b8cbc7; background:var(--accent-soft); color:#173f3c; font-weight:700; }
  .memory-pill.done { border-color:#b5ccb8; background:#e7f3e7; color:#27612e; }
  .action-contracts { margin:0 13px 10px; padding:9px 12px; border:1px solid var(--line); border-radius:6px; background:#fafbf8; }
  .memory-flow-item>.memory-artifact-schema { margin:0 13px 10px; }
  .memory-kv { display:grid; grid-template-columns:minmax(90px,auto) minmax(0,1fr); gap:6px 12px; padding:4px 0; }
  .memory-kv>dt { color:var(--muted); font-size:var(--memory-page-text-label); font-weight:650; line-height:var(--memory-page-line-compact); }
  .memory-kv>dd { margin:0; font-size:var(--memory-page-text-body); line-height:var(--memory-page-line-body); overflow-wrap:anywhere; }
  .memory-commentable { position:relative; }
  .memory-inline-plus { position:absolute; top:4px; right:4px; display:none; width:25px; height:25px; border:1px solid var(--line); border-radius:50%; background:var(--surface); color:var(--accent); }
  .memory-commentable:hover>.memory-inline-plus,.memory-inline-plus:focus { display:block; }
  .memory-section.memory-commentable:hover>.memory-inline-plus { display:none; }
  .memory-section.memory-commentable>.memory-section-header:hover~.memory-inline-plus,.memory-section.memory-commentable>.memory-inline-plus:focus { display:block; }
  .text-list>li>.memory-commentable,.memory-inline-diff-content>.memory-commentable { display:inline; width:auto; }
  .text-list>li>.memory-commentable>.memory-inline-plus,.memory-inline-diff-content>.memory-commentable>.memory-inline-plus,.memory-artifact-row.memory-commentable>.memory-inline-plus,.memory-flow-action.memory-commentable>.memory-inline-plus { position:static; display:inline-grid; place-items:center; vertical-align:middle; margin:-2px 0 0 8px; opacity:0; pointer-events:none; }
  .memory-commentable:hover>.memory-inline-plus,.memory-commentable>.memory-inline-plus:focus,.text-list>li:not(.memory-inline-diff-item):hover>.memory-commentable>.memory-inline-plus,.memory-inline-diff-line:hover .memory-inline-diff-content>.memory-commentable>.memory-inline-plus,.memory-inline-diff-line:hover .memory-artifact-row.memory-commentable>.memory-inline-plus { opacity:1; pointer-events:auto; }
  .memory-flow-action.memory-commentable { display:inline; }
  .memory-artifact-row.memory-commentable { padding-left:3px; }
  .memory-inline-comment-editor { display:grid; gap:var(--memory-page-space-line); margin:8px 0 4px; border:1px solid #b8cbc7; border-radius:var(--memory-page-radius-section); background:#f7fbfa; padding:10px; box-shadow:0 1px 2px rgba(20,47,42,.05); list-style:none; }
  .memory-inline-comment-editor textarea { width:100%; min-height:72px; resize:vertical; border:1px solid var(--line); border-radius:7px; background:var(--surface); color:var(--text); padding:8px 9px; font-family:var(--memory-page-font-sans); font-size:var(--memory-page-text-body); line-height:var(--memory-page-line-body); }
  .memory-inline-comment-editor textarea:focus { outline:2px solid rgba(31,126,113,.16); border-color:#87aaa4; }
  .memory-inline-comment-actions { display:flex; justify-content:flex-end; gap:7px; }
  .memory-inline-comment-actions .memory-btn { padding:6px 9px; font-size:var(--memory-page-text-label); }
  .memory-inline-diff-pair>.memory-inline-comment-editor { margin-left:0; margin-right:0; }
  .memory-commentable.has-comment-draft .memory-inline-plus { display:none; }
  .memory-change-layout { display:grid; grid-template-columns:minmax(0,1fr) minmax(220px,260px); gap:14px; align-items:start; }
  .memory-change-main { width:min(100%,720px); justify-self:center; }
  .memory-diff-toolbar { display:inline-grid; grid-template-columns:repeat(2,minmax(84px,1fr)); gap:3px; margin:2px 0 14px; padding:3px; border:1px solid var(--line); border-radius:7px; background:var(--soft); }
  .memory-diff-toolbar .memory-source-tab { margin:0; }
  .memory-change-viewbar { display:flex; align-items:center; justify-content:flex-start; gap:14px; margin:0 0 12px; }
  .memory-change-viewbar .memory-diff-toolbar { flex:0 0 auto; margin:0; }
  .memory-change-revisions { display:flex; min-width:0; align-items:center; gap:9px; color:var(--muted); font-size:var(--memory-page-text-meta); line-height:var(--memory-page-line-compact); }
  .memory-change-revision { display:grid; gap:1px; }
  .memory-change-revision span { font-size:var(--memory-page-text-meta); letter-spacing:.03em; }
  .memory-change-revision code { color:var(--muted); font-family:var(--memory-page-font-mono); font-size:var(--memory-page-text-meta); line-height:var(--memory-page-line-compact); }
  .memory-change-revision-arrow { width:12px; height:12px; opacity:.62; transform:rotate(-90deg); }
  .memory-diff-summary { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:12px; border:1px solid var(--line); border-radius:var(--memory-page-radius-section); background:#fafbf8; padding:9px 11px; color:var(--muted); font-size:var(--memory-page-text-label); line-height:var(--memory-page-line-compact); }
  .memory-diff-summary strong { color:var(--text); }
  .memory-inline-diff-pair { display:grid; gap:4px; flex:1 1 320px; min-width:0; }
  .memory-inline-diff-line { padding:5px 7px; border-radius:6px; }
  .text-list>li.memory-inline-diff-item { display:list-item; padding:2px 4px; }
  .text-list>li.memory-inline-diff-item>.memory-inline-diff-line+.memory-inline-diff-line { margin-top:4px; }
  .memory-inline-diff-list-row { display:grid; grid-template-columns:42px minmax(0,1fr); align-items:start; gap:7px; }
  .memory-inline-diff-label { padding-top:1px; color:inherit; font-size:var(--memory-page-text-label); font-weight:650; line-height:var(--memory-page-line-compact); letter-spacing:0; opacity:.78; }
  .memory-inline-diff-content { min-width:0; font-size:var(--memory-page-text-body); line-height:var(--memory-page-line-body); white-space:pre-wrap; overflow-wrap:anywhere; }
  .memory-inline-diff-content>.memory-artifact-row { flex-wrap:nowrap; margin-left:0; overflow-x:auto; }
  .memory-inline-diff-content>.memory-artifact-row>* { flex:none; white-space:nowrap; }
  .memory-inline-old { background:#fbe9e7; color:#7e413b; }
  .memory-inline-new { background:#e3f2ee; color:#17564f; }
  li.memory-inline-marker-old::marker { color:#c94b40; }
  li.memory-inline-marker-new::marker { color:#198071; }
  .memory-inline-removed { margin:5px 0; }
  .memory-diff-empty { padding:18px 14px; color:var(--muted); font-size:var(--memory-page-text-body); line-height:var(--memory-page-line-body); text-align:center; }
  .memory-deleted-candidate { display:grid; gap:4px; margin:0 0 14px; border:1px dashed #d7b1ac; border-radius:var(--memory-page-radius-section); background:#fff8f7; padding:14px; color:#7e413b; }
  .memory-deleted-candidate strong { font-size:var(--memory-page-text-section-title); line-height:var(--memory-page-line-compact); }
  .memory-deleted-candidate span { font-size:var(--memory-page-text-label); line-height:var(--memory-page-line-compact); }
  .memory-before-full-content { display:grid; gap:10px; }
  .memory-before-full-content>h4 { margin:0; color:var(--muted); font-size:var(--memory-page-text-section-title); line-height:var(--memory-page-line-compact); }
  .memory-review-complete { display:flex; align-items:center; justify-content:flex-start; gap:14px; margin-top:14px; border:1px solid var(--line); border-radius:var(--memory-page-radius-section); background:var(--surface); padding:13px 15px; }
  .memory-review-complete strong,.memory-review-complete small { display:block; }
  .memory-review-complete strong { font-size:var(--memory-page-text-section-title); line-height:var(--memory-page-line-compact); }
  .memory-review-complete small { margin-top:3px; color:var(--muted); font-size:var(--memory-page-text-meta); line-height:var(--memory-page-line-compact); }
  .memory-review-complete .memory-btn { display:inline-flex; align-items:center; gap:6px; white-space:nowrap; }
  .memory-change-layout.comments-collapsed { grid-template-columns:minmax(0,1fr); }
  .memory-change-layout.comments-collapsed .memory-change-main { width:min(100%,960px); }
  .memory-change-layout.comments-collapsed .memory-comments { display:none; }
  .memory-comments { position:sticky; top:calc(-1 * var(--memory-page-padding)); display:grid; grid-template-rows:auto minmax(140px,1fr) auto; height:calc(100vh - 100px); max-height:calc(100vh - 100px); margin:calc(-1 * var(--memory-page-padding)) 0 0; overflow:hidden; border-width:0 0 0 1px; border-radius:0; background:#fbfcfa; padding:0; box-shadow:none; }
  .memory-comments-header { display:flex; min-height:54px; align-items:center; justify-content:space-between; gap:10px; border-bottom:1px solid var(--line); padding:13px 15px; }
  .memory-comments-title { display:flex; align-items:center; gap:8px; }
  .memory-comments-title h3 { margin:0; font-size:var(--memory-page-text-section-title); line-height:var(--memory-page-line-compact); }
  .memory-comments-count { display:inline-grid; min-width:22px; height:22px; place-items:center; border-radius:999px; background:var(--soft); color:var(--muted); font-size:var(--memory-page-text-label); }
  .memory-comments-close { display:grid; width:28px; height:28px; place-items:center; border:0; border-radius:6px; background:transparent; }
  .memory-comments-close:hover { background:var(--soft); }
  .memory-comments-close img { width:16px; height:16px; opacity:.62; }
  .memory-comments-body { min-height:0; overflow:auto; padding:12px 15px; }
  .memory-comments-body>p { margin:0; }
  .memory-comments p,.memory-comments li { font-size:var(--memory-page-text-body); line-height:var(--memory-page-line-body); }
  .memory-comment { margin-bottom:9px; border:1px solid var(--line); border-radius:var(--memory-page-radius-section); background:var(--surface); padding:10px 11px; box-shadow:0 1px 2px rgba(20,47,42,.025); }
  .memory-comment:last-child { margin-bottom:0; }
  .memory-comment-head { display:flex; min-height:22px; align-items:center; justify-content:space-between; gap:8px; color:var(--muted); font-size:var(--memory-page-text-meta); line-height:var(--memory-page-line-compact); }
  .memory-comment-head>.memory-pill { flex:none; padding:2px 7px; font-size:var(--memory-page-text-meta); }
  .memory-comment-target { display:block; max-width:100%; margin:7px 0 0; overflow:hidden; border:0; background:transparent; color:#568079; padding:0; font-family:var(--memory-page-font-mono); font-size:var(--memory-page-text-label); line-height:var(--memory-page-line-compact); text-align:left; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; }
  .memory-comment-target:hover { color:var(--accent); text-decoration:underline; text-underline-offset:2px; }
  .memory-comment-body { margin:8px 0 0; color:var(--text); font-size:var(--memory-page-text-body); line-height:var(--memory-page-line-body); white-space:pre-wrap; overflow-wrap:anywhere; }
  .memory-comment-actions { display:flex; justify-content:flex-end; gap:6px; margin-top:9px; padding-top:8px; border-top:1px solid #eef1ed; }
  .memory-comment-actions .memory-btn { min-height:27px; border-radius:6px; padding:4px 8px; font-size:var(--memory-page-text-label); }
  @media(max-width:820px){.memory-layout{display:block}.memory-sidebar{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}.memory-workspace,.memory-workspace.memory-change-workspace{padding:16px 14px 36px}.memory-change-layout{display:block}.memory-change-main{width:auto}.memory-change-viewbar{align-items:flex-start;flex-direction:column}.memory-comments{position:static;top:auto;height:auto;max-height:none;margin:14px 0 0;border:1px solid var(--line);border-radius:var(--memory-page-radius-section)}.memory-section-body{padding:4px 12px 14px}.memory-flow-head{display:grid}.memory-artifact-row{margin-left:0}}
`;

export default defineViewPlugin<MemoryConfig>({
  name: "memsphere-memory-view",
  apiVersion: 1,
  inject: ["slots", "router"],
  apply(ctx, config) {
    if (!ctx.router) throw new Error("Memory View requires the router service");
    const routes = {
      index: ctx.router.register({ id: "index", path: "/memories", query: ["section", "change"] }),
      market: ctx.router.register({ id: "market", path: "/market", query: ["item"] }),
      memoryDetail: ctx.router.register({ id: "memory-detail", path: "/memories/:kind/:name", query: ["section", "change"] }),
      projectIndex: ctx.router.register({ id: "project-index", path: "/projects/:projectId/memories", query: ["section", "change"] }),
      projectMemoryDetail: ctx.router.register({ id: "project-memory-detail", path: "/projects/:projectId/memories/:kind/:name", query: ["section", "change"] }),
      projectMarket: ctx.router.register({ id: "project-market", path: "/projects/:projectId/market", query: ["item"] }),
      changeDetail: ctx.router.register({ id: "change-detail", path: "/projects/:projectId/changes/:changeId", query: ["section"] })
    };
    const headerActions = createHeaderActionPublisher(ctx);
    const publishSecondary = createMemorySecondaryPublisher(ctx, config, routes);
    const page = createMemoryPageMounts(
      config,
      routes,
      target => ctx.router!.navigate(target),
      headerActions.replace,
      headerActions.clear,
      publishSecondary
    );
    ctx.lifecycle.own(page.dispose);

    registerPage(ctx, routes.index, "index", config, page);
    registerPage(ctx, routes.market, "market", config, page);
    registerPage(ctx, routes.memoryDetail, "memory-detail", config, page);
    registerPage(ctx, routes.projectIndex, "project-index", config, page);
    registerPage(ctx, routes.projectMemoryDetail, "project-memory-detail", config, page);
    registerPage(ctx, routes.projectMarket, "project-market", config, page);
    registerPage(ctx, routes.changeDetail, "change-detail", config, page);
    for (const route of Object.values(routes)) registerMemorySecondary(ctx, config, routes, route);
    ctx.slots.register(slots.searchProviders, {
      id: "memory.search",
      order: 100,
      value: {
        label: text(message(config, "navigation.memory")),
        icon: { kind: "system", name: "brain" },
        async search({ query, signal }) {
          const [memories, changes] = await Promise.all([
            fetch(projectApiUrl(config, "/api/memories?representation=summary"), { signal }).then(async response => {
              if (!response.ok) throw new Error(await response.text());
              return response.json() as Promise<{ memories?: MemorySummary[] }>;
            }),
            fetch(projectApiUrl(config, "/api/changes"), { signal }).then(response => response.ok ? response.json() as Promise<{ changes?: ChangeSummary[] }> : { changes: [] })
          ]);
          const needle = query.trim().toLowerCase();
          const memoryResults = (memories.memories ?? []).filter(memory => !needle || `${memoryName(memory)} ${memoryReference(memory)}`.toLowerCase().includes(needle)).slice(0, 24).map(memory => {
            const [kind, ...name] = memoryReference(memory).split("/");
            return {
              title: text(memoryName(memory)), summary: text(memoryReference(memory)), type: text(message(config, "navigation.memory")),
              icon: { kind: "system" as const, name: "brain" }, route: routes.projectMemoryDetail.to({ projectId: ctx.module.projectId, kind, name: name.join("/") })
            };
          });
          const changeResults = (changes.changes ?? []).filter(change => !needle || `${change.title ?? ""} ${change.id}`.toLowerCase().includes(needle)).slice(0, 12).map(change => ({
            title: text(String(change.title ?? change.id)), summary: text("ChangeSet"), type: text("ChangeSet"),
            icon: { kind: "system" as const, name: "code" }, route: routes.changeDetail.to({ projectId: ctx.module.projectId, changeId: change.id })
          }));
          return [...memoryResults, ...changeResults];
        }
      }
    });

    ctx.slots.register(slots.navigationPrimary, {
      id: "memory.navigation",
      order: 100,
      value: {
        label: text(message(config, "navigation.memory")),
        icon: { kind: "system", name: "brain" },
        route: routes.projectIndex.to({ projectId: ctx.module.projectId })
      }
    });
    startMemoryHome(ctx, config, routes);
  }
});

function startMemoryHome(ctx: ViewPluginContext, config: Readonly<MemoryConfig>, routes: MemoryRoutes): void {
  const leases = new Map<string, Disposer>();
  let controller = new AbortController();
  const replace = (key: string, create: () => Disposer) => {
    const previous = leases.get(key);
    const next = create();
    leases.set(key, next);
    void previous?.();
  };
  const withdrawMissing = (prefix: string, keep: ReadonlySet<string>) => {
    for (const [key, dispose] of [...leases]) {
      if (!key.startsWith(prefix) || keep.has(key)) continue;
      leases.delete(key);
      void dispose();
    }
  };
  const refresh = async () => {
    controller.abort();
    controller = new AbortController();
    try {
      const response = await fetch(projectApiUrl(config, "/api/changes"), { signal: controller.signal });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json() as { changes?: ChangeSummary[] };
      const changes = (payload.changes ?? []).filter(change => change.status === "active" && !change.error);
      const attentionKeep = new Set<string>();
      const continueKeep = new Set<string>();
      for (const change of changes.slice(0, 8)) {
        const counts = change.commentCounts as JsonRecord | undefined;
        const pending = Number(counts?.pending ?? 0) + Number(counts?.processing ?? 0);
        const target = routes.changeDetail.to({ projectId: ctx.module.projectId, changeId: change.id });
        if (pending > 0) {
          const key = `attention:${change.id}`; attentionKeep.add(key);
          replace(key, () => ctx.slots.upsert(slots.homeAttention, {
            id: `memory.change.${change.id}`,
            order: 100,
            value: {
              title: { text: String(change.title ?? change.id) },
              summary: { text: `${pending} ${message(config, "change.comments")}` },
              icon: { kind: "system", name: "code" },
              source: { text: "ChangeSet" }, status: "warning", updatedAt: change.updatedAt,
              action: { label: { text: message(config, "market.viewChangeSet") }, run: () => ctx.router!.navigate(target) }
            }
          }));
        } else {
          const key = `continue:${change.id}`; continueKeep.add(key);
          replace(key, () => ctx.slots.upsert(slots.homeContinue, {
            id: `memory.change.${change.id}`,
            order: 100,
            value: { title: { text: String(change.title ?? change.id) }, summary: { text: "ChangeSet" }, icon: { kind: "system", name: "code" }, updatedAt: change.updatedAt, route: target }
          }));
        }
      }
      withdrawMissing("attention:", attentionKeep);
      withdrawMissing("continue:", continueKeep);
      const errorLease = leases.get("attention:error");
      if (errorLease) { leases.delete("attention:error"); void errorLease(); }
    } catch (error) {
      if (controller.signal.aborted || ctx.lifecycle.disposed) return;
      replace("attention:error", () => ctx.slots.upsert(slots.homeAttention, {
        id: "memory.home.error", order: 190,
        value: {
          title: { text: message(config, "memory.loadFailed") },
          summary: { text: error instanceof Error ? error.message : String(error) },
          icon: { kind: "system", name: "warning" },
          status: "error",
          action: { label: { text: message(config, "common.retry") }, run: refresh }
        }
      }));
    }
  };
  void refresh();
  ctx.lifecycle.own(() => {
    controller.abort();
    for (const dispose of leases.values()) void dispose();
    leases.clear();
  });
}

type MemoryRoutes = {
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
  page: Readonly<{ list: ViewMount; detail: ViewMount }>
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
    value: page.detail
  });
  ctx.slots.register(slots.contentList, {
    id: `memory.list.${name}`,
    when: route.activation,
    value: page.list
  });
}

function memorySection(location: RouteLocation): "recent" | "project" | "market" | "changes" {
  if (location.pathname.includes("/market")) return "market";
  if (["recent", "project", "market", "changes"].includes(location.query.section ?? "")) {
    return location.query.section as "recent" | "project" | "market" | "changes";
  }
  if (location.pathname.includes("/changes/")) return "changes";
  return "project";
}

function registerMemorySecondary(ctx: ViewPluginContext, config: Readonly<MemoryConfig>, routes: MemoryRoutes, route: MemoryRoutes[keyof MemoryRoutes]): void {
  const selected = memorySection(ctx.router!.location);
  ctx.slots.register(slots.navigationSecondary, {
    id: `memory.secondary.${route.key}`,
    when: route.activation,
    value: memorySecondaryDescriptor(config, routes, ctx.module.projectId, selected)
  });
}

function createMemorySecondaryPublisher(ctx: ViewPluginContext, config: Readonly<MemoryConfig>, routes: MemoryRoutes): (location: RouteLocation, badges?: Readonly<Record<string, number>>, heading?: HeaderTitleDescriptor) => void {
  let lastKey = "";
  let dispose: Disposer | undefined;
  let titleDispose: Disposer | undefined;
  return (location, badges = {}, heading) => {
    const selected = memorySection(location);
    const route = routeForMemoryLocation(routes, location);
    const key = `${route.key}:${selected}:${JSON.stringify(badges)}:${JSON.stringify(heading ?? {})}`;
    if (key === lastKey) return;
    lastKey = key;
    const previous = dispose;
    dispose = ctx.slots.upsert(slots.navigationSecondary, {
      id: `memory.secondary.${route.key}`,
      when: route.activation,
      value: memorySecondaryDescriptor(config, routes, ctx.module.projectId, selected, badges)
    });
    void previous?.();
    const previousTitle = titleDispose;
    titleDispose = ctx.slots.upsert(slots.headerTitle, {
      id: `memory.header.${memoryRouteName(route, routes)}`,
      when: route.activation,
      value: heading ?? { title: text(memoryRouteHeading(config, location)) }
    });
    void previousTitle?.();
  };
}

function memoryRouteName(route: MemoryRoutes[keyof MemoryRoutes], routes: MemoryRoutes): MemoryRouteName {
  return route === routes.market ? "market"
    : route === routes.memoryDetail ? "memory-detail"
      : route === routes.projectIndex ? "project-index"
        : route === routes.projectMemoryDetail ? "project-memory-detail"
          : route === routes.projectMarket ? "project-market"
            : route === routes.changeDetail ? "change-detail"
              : "index";
}

function memoryRouteHeading(config: Readonly<MemoryConfig>, location: RouteLocation): string {
  if (location.pathname.includes("/market")) return message(config, "navigation.memoryMarket");
  if (location.pathname.includes("/changes/")) return message(config, "change.title");
  return message(config, "navigation.memory");
}

function routeForMemoryLocation(routes: MemoryRoutes, location: RouteLocation): MemoryRoutes[keyof MemoryRoutes] {
  const suffix = location.routeKey?.split(":").at(-1);
  return suffix === "market" ? routes.market
    : suffix === "memory-detail" ? routes.memoryDetail
      : suffix === "project-index" ? routes.projectIndex
        : suffix === "project-memory-detail" ? routes.projectMemoryDetail
          : suffix === "project-market" ? routes.projectMarket
            : suffix === "change-detail" ? routes.changeDetail
              : routes.index;
}

function memorySecondaryDescriptor(
  config: Readonly<MemoryConfig>,
  routes: MemoryRoutes,
  projectId: string,
  selected: "recent" | "project" | "market" | "changes",
  badges: Readonly<Record<string, number>> = {}
) {
  return {
    title: text(message(config, "navigation.memory")),
    icon: { kind: "system" as const, name: "brain" },
    items: [
      { id: "recent", label: text(message(config, "memory.recent")), icon: { kind: "system" as const, name: "clock-counter-clockwise" }, badge: badges.recent ? text(String(badges.recent)) : undefined, selected: selected === "recent", route: routes.projectIndex.to({ projectId }, { query: { section: "recent" } }) },
      { id: "project", label: text(message(config, "navigation.currentProject")), icon: { kind: "system" as const, name: "brain" }, badge: badges.project ? text(String(badges.project)) : undefined, selected: selected === "project", route: routes.projectIndex.to({ projectId }) },
      { id: "market", label: text(message(config, "navigation.memoryMarket")), icon: { kind: "system" as const, name: "storefront" }, badge: badges.market ? text(String(badges.market)) : undefined, selected: selected === "market", route: routes.projectMarket.to({ projectId }) },
      { id: "changes", label: text(config.locale?.toLowerCase().startsWith("en") ? "ChangeSets" : "记忆变更"), icon: { kind: "system" as const, name: "archive" }, badge: badges.changes ? text(String(badges.changes)) : undefined, selected: selected === "changes", route: routes.projectIndex.to({ projectId }, { query: { section: "changes" } }) }
    ],
    footer: text(config.locale?.toLowerCase().startsWith("en")
      ? "Rendered consistently by navigation.secondary."
      : "这里由 navigation.secondary 统一呈现。")
  };
}

type PublishedHeaderAction = {
  readonly id: string;
  readonly order?: number;
  readonly stateKey: string;
  readonly value: HeaderActionDescriptor;
};

function createHeaderActionPublisher(ctx: ViewPluginContext): {
  readonly replace: (actions: readonly PublishedHeaderAction[]) => void;
  readonly clear: () => void;
} {
  const leases = new Map<string, { readonly stateKey: string; readonly dispose: Disposer }>();
  const clear = () => {
    for (const lease of leases.values()) void lease.dispose();
    leases.clear();
  };
  ctx.lifecycle.own(clear);
  return {
    replace(actions) {
      const keep = new Set(actions.map(action => action.id));
      for (const [id, lease] of [...leases]) {
        if (keep.has(id)) continue;
        leases.delete(id);
        void lease.dispose();
      }
      for (const action of actions) {
        const previous = leases.get(action.id);
        if (previous?.stateKey === action.stateKey) continue;
        if (previous) {
          leases.delete(action.id);
          void previous.dispose();
        }
        const dispose = ctx.slots.upsert(slots.headerActions, {
          id: `memory.${action.id}`,
          order: action.order,
          value: action.value
        });
        leases.set(action.id, { stateKey: action.stateKey, dispose });
      }
    },
    clear
  };
}

function createMemoryPageMounts(
  config: Readonly<MemoryConfig>,
  routes: MemoryRoutes,
  navigate: (target: RouteTarget) => Promise<void>,
  publishHeaderActions: (actions: readonly PublishedHeaderAction[]) => void,
  clearHeaderActions: () => void,
  publishSecondary: (location: RouteLocation, badges?: Readonly<Record<string, number>>, heading?: HeaderTitleDescriptor) => void
): Readonly<{ list: ViewMount; detail: ViewMount; dispose: Disposer }> {
  const controller = new AbortController();
  let scratch: HTMLElement | undefined;
  let portal: HTMLElement | undefined;
  let app: MemoryApplication | undefined;
  let start: Promise<void> | undefined;
  let lastRoute = "";
  let update: Promise<void> | undefined;
  const ensure = (location: RouteLocation) => {
    scratch ??= document.createElement("div");
    portal ??= document.createElement("div");
    if (!app) {
      app = new MemoryApplication(scratch, portal, controller, config, routes, location, navigate, publishHeaderActions);
      lastRoute = `${location.pathname}${location.search}${location.hash}`;
    }
    start ??= app.start();
    return start;
  };
  const updateRoute = async (location: RouteLocation) => {
    await ensure(location);
    const key = `${location.pathname}${location.search}${location.hash}`;
    if (lastRoute === key) {
      await update;
      publishSecondary(location, app!.secondaryBadges(), app!.headerTitle());
      return;
    }
    lastRoute = key;
    update = app!.updateRoute(location).finally(() => { update = undefined; });
    await update;
    publishSecondary(location, app!.secondaryBadges(), app!.headerTitle());
  };
  const createSurface = (surface: "list" | "detail"): ViewMount => ({
    async mount({ element }, context) {
      const style = document.createElement("style");
      style.dataset.memsphereMemoryStyles = "true";
      style.textContent = memoryStyles;
      element.append(style);
      element.classList.add("memory-surface", `memory-${surface}-surface`);
      await ensure(context.route);
      app![surface === "list" ? "attachList" : "attachDetail"](element);
      await updateRoute(context.route);
      return () => {
        app?.[surface === "list" ? "detachList" : "detachDetail"](element);
        if (surface === "detail") clearHeaderActions();
        element.classList.remove("memory-surface", `memory-${surface}-surface`);
        element.replaceChildren();
      };
    },
    async update(context) {
      await updateRoute(context.route);
    }
  });
  return {
    list: createSurface("list"),
    detail: createSurface("detail"),
    dispose: () => {
      controller.abort();
      app?.dispose();
      app = undefined;
      clearHeaderActions();
      portal?.replaceChildren();
    }
  };
}

class MemoryApplication {
  readonly #root: HTMLElement;
  #listRoot: HTMLElement | null = null;
  #detailRoot: HTMLElement | null = null;
  readonly #portal: HTMLElement;
  readonly #controller: AbortController;
  readonly #config: Readonly<MemoryConfig>;
  readonly #routes: MemoryRoutes;
  #location: Readonly<RouteLocation>;
  readonly #navigate: (target: RouteTarget) => Promise<void>;
  readonly #publishHeaderActions: (actions: readonly PublishedHeaderAction[]) => void;
  #memories: MemorySummary[] = [];
  #changes: ChangeSummary[] = [];
  #market: JsonRecord[] = [];
  #marketCount = 0;
  #memoryDetail: MemorySummary | null = null;
  readonly #memoryDetailCache = new Map<string, MemorySummary>();
  #changeDetail: JsonRecord | null = null;
  #selectedId = "";
  #selectedMarket = "";
  #changeReturnTarget: RouteTarget | undefined;
  #query = "";
  #hideSystem = localStorage.getItem(hideSystemMemoriesKey) !== "false";
  #commentsCollapsed = localStorage.getItem(changeCommentsCollapsedKey) === "true";
  #commentDraft: { memoryId: string; target: string; snapshot: string; location: unknown } | null = null;
  #changeContentMode: "diff" | "candidate" = "diff";
  #reviewedMemoryIds = new Set<string>();
  #currentProject = "";
  #actorKinds: Record<string, string> = {};
  #generation = 0;
  #fatalError: unknown = null;

  constructor(root: HTMLElement, portal: HTMLElement, controller: AbortController, config: Readonly<MemoryConfig>, routes: MemoryRoutes, location: Readonly<RouteLocation>, navigate: (target: RouteTarget) => Promise<void>, publishHeaderActions: (actions: readonly PublishedHeaderAction[]) => void) {
    this.#root = root;
    this.#portal = portal;
    this.#controller = controller;
    this.#config = config;
    this.#routes = routes;
    this.#location = location;
    this.#currentProject = projectFromLocation(location);
    this.#navigate = navigate;
    this.#publishHeaderActions = publishHeaderActions;
  }

  async start(): Promise<void> {
    this.renderLoading();
    await this.load();
  }

  attachList(root: HTMLElement): void { this.#listRoot = root; this.render(); }
  detachList(root: HTMLElement): void { if (this.#listRoot === root) this.#listRoot = null; }
  attachDetail(root: HTMLElement): void { this.#detailRoot = root; this.render(); }
  detachDetail(root: HTMLElement): void { if (this.#detailRoot === root) this.#detailRoot = null; }

  secondaryBadges(): Readonly<Record<string, number>> {
    const projectMemories = this.#memories.filter(memory => !memory.system);
    const available = new Set(projectMemories.map(memory => memory.id));
    const recent = this.recentMemoryIds().filter(id => available.has(id)).length;
    return { recent, project: projectMemories.length, market: this.#market.length || this.#marketCount, changes: this.#changes.length };
  }

  headerTitle(): HeaderTitleDescriptor {
    const route = parseLocation(this.#location);
    const projectId = projectFromLocation(this.#location) || this.#currentProject || "memsphere";
    const memoryCrumb = { label: text(message(this.#config, "navigation.memory")), route: this.#routes.projectIndex.to({ projectId }) };
    const projectCrumb = { label: text(message(this.#config, "navigation.currentProject")), route: this.#routes.projectIndex.to({ projectId }) };
    if (route.kind === "memory-detail") {
      const detail = this.#memoryDetail;
      return {
        title: text(detail ? memoryName(detail) : route.memoryName),
        subtitle: text(detail
          ? `${this.t("memory.active")} · ${this.t(detail.kind)} · ${detail.id}`
          : `${this.t(route.memoryKind)} · ${route.memoryKind}/${route.memoryName}`),
        breadcrumbs: [memoryCrumb, projectCrumb]
      };
    }
    if (route.kind === "change") return {
      title: text(String((this.#changeDetail?.change as ChangeSummary | undefined)?.title ?? route.changeId ?? message(this.#config, "change.title"))),
      subtitle: text(this.#changeDetail?.change
        ? this.changeStatusLabel(String((this.#changeDetail.change as ChangeSummary).status ?? ""))
        : "ChangeSet"),
      breadcrumbs: [memoryCrumb, { label: text(this.#config.locale?.toLowerCase().startsWith("en") ? "ChangeSets" : "记忆变更"), route: this.#routes.projectIndex.to({ projectId }, { query: { section: "changes" } }) }]
    };
    if (route.kind === "market") {
      const item = this.#market.find(candidate => candidate.reference === this.#selectedMarket);
      return {
        title: text(item ? memoryName((item.entity ?? item) as MemorySummary) : message(this.#config, "navigation.memoryMarket")),
        subtitle: text(message(this.#config, "navigation.memoryMarket")),
        breadcrumbs: [memoryCrumb]
      };
    }
    if (this.#location.query.section === "recent") return {
      title: text(this.t("memory.recent")),
      breadcrumbs: [memoryCrumb]
    };
    if (this.#location.query.section === "changes") return {
      title: text(this.#config.locale?.toLowerCase().startsWith("en") ? "ChangeSets" : "记忆变更"),
      breadcrumbs: [memoryCrumb]
    };
    return { title: text(message(this.#config, "navigation.currentProject")), breadcrumbs: [memoryCrumb] };
  }

  async updateRoute(location: Readonly<RouteLocation>): Promise<void> {
    const previousProject = this.#currentProject;
    const previousRoute = parseLocation(this.#location);
    this.#location = location;
    this.#currentProject = projectFromLocation(location) || this.#currentProject;
    this.#selectedMarket = location.query.item ?? this.#selectedMarket;
    const route = parseLocation(location);
    if (!this.#memories.length || previousProject !== this.#currentProject || previousRoute.kind === "change" || route.kind === "change" || route.changeId) {
      await this.load();
      return;
    }
    const generation = ++this.#generation;
    this.#changeDetail = null;
    if (route.kind === "market") {
      if (!this.#market.length) {
        const payload = await this.request<JsonRecord>("/api/market/memories");
        if (generation !== this.#generation) return;
        this.#market = array(payload.memories);
        this.#marketCount = this.#market.length;
        this.#selectedMarket ||= String(this.#market[0]?.reference ?? "");
      }
      this.render();
      return;
    }
    if (route.kind === "memory-detail") {
      this.#selectedId = this.#memories.find(memory => memoryReference(memory) === `${route.memoryKind}/${route.memoryName}`)?.id
        ?? `${route.memoryKind}/${route.memoryName}`;
    } else {
      this.#selectedId = "";
      this.#memoryDetail = null;
      this.render();
      return;
    }
    const cached = this.#memoryDetailCache.get(this.#selectedId);
    if (cached) {
      this.#memoryDetail = cached;
      this.rememberRecentMemory(this.#selectedId);
    }
    else if (this.#selectedId) await this.loadMemoryDetail(this.#selectedId, "", generation);
    if (generation === this.#generation) this.render();
  }

  dispose(): void {
    this.#generation += 1;
  }

  private async load(): Promise<void> {
    const generation = ++this.#generation;
    this.#fatalError = null;
    this.#memoryDetail = null;
    this.#changeDetail = null;
    try {
      const route = parseLocation(this.#location);
      this.#selectedMarket = this.#location.query.item ?? this.#selectedMarket;
      if (route.kind === "memory-detail") this.#selectedId = `${route.memoryKind}/${route.memoryName}`;
      const previewChangeId = route.kind === "change" ? "" : route.changeId;
      const [memoryPayload, changePayload, projectPayload, marketCountPayload] = await Promise.all([
        this.request<JsonRecord>(`/api/memories?${new URLSearchParams({ representation: "summary", ...(previewChangeId ? { change: previewChangeId } : {}) })}`),
        this.request<JsonRecord>("/api/changes").catch(error => ({ changes: [], _error: error })),
        this.request<JsonRecord>("/api/projects").catch((): JsonRecord => ({})),
        this.request<JsonRecord>("/api/market/memories?representation=count").catch((): JsonRecord => ({ count: 0 }))
      ]);
      if (generation !== this.#generation) return;
      this.#memories = array(memoryPayload.memories) as MemorySummary[];
      if (route.kind === "memory-detail") {
        this.#selectedId = this.#memories.find(memory => memoryReference(memory) === `${route.memoryKind}/${route.memoryName}`)?.id ?? this.#selectedId;
      }
      this.#changes = array(changePayload.changes) as ChangeSummary[];
      this.#marketCount = Number(marketCountPayload.count) || 0;
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
        this.#marketCount = this.#market.length;
        this.#selectedMarket ||= String(this.#market[0]?.reference ?? "");
      } else if (route.kind === "change") {
        try {
          this.#changeDetail = await this.request<JsonRecord>(`/api/changes/${encodeURIComponent(route.changeId)}`);
          this.#actorKinds = asStringRecord(this.#changeDetail.actorKinds);
          const targets = array(this.#changeDetail.targetMemories).map(item => {
            const target = item as JsonRecord;
            const candidate = target.memory && typeof target.memory === "object"
              ? target.memory as MemorySummary
              : undefined;
            const base = target.baseMemory && typeof target.baseMemory === "object"
              ? target.baseMemory as MemorySummary
              : undefined;
            const memory = candidate ?? base ?? target as MemorySummary;
            return {
              ...memory,
              operation: target.operation ?? memory.operation,
              reference: target.reference ?? memory.reference,
              baseMemory: base
            } as MemorySummary;
          });
          if (targets.length) {
            this.#memories = targets;
            this.#selectedId = targets.some(item => item.id === this.#selectedId) ? this.#selectedId : targets[0]?.id ?? "";
            this.#reviewedMemoryIds = this.readReviewedMemories(route.changeId);
          }
        } catch (error) {
          this.#changeDetail = { error: errorMessage(error), change: this.#changes.find(item => item.id === route.changeId) ?? { id: route.changeId, status: "unavailable" } };
        }
      } else if (route.kind === "memory-detail" || route.changeId) {
        this.#selectedId ||= this.visibleMemories()[0]?.id ?? "";
        if (this.#selectedId) await this.loadMemoryDetail(this.#selectedId, route.changeId, generation);
      } else {
        this.#selectedId = "";
        this.#memoryDetail = null;
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
      if (generation === this.#generation) {
        this.#memoryDetail = (payload.memory ?? payload) as MemorySummary;
        this.#memoryDetailCache.set(id, this.#memoryDetail);
        this.rememberRecentMemory(id);
      }
    } catch (error) {
      if (generation === this.#generation) this.#memoryDetail = { ...summary, error: errorMessage(error) };
    }
  }

  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(projectApiUrl(this.#config, url), { ...init, signal: this.#controller.signal });
    if (!response.ok) throw new Error(await response.text() || `${response.status} ${response.statusText}`);
    return response.json() as Promise<T>;
  }

  private renderLoading(): void {
    this.#root.querySelector(".memory-module")?.remove();
    const node = el("section", "memory-module memory-empty", this.t("common.loading"));
    this.#root.append(node);
  }

  private render(): void {
    this.syncHeaderActions();
    if (this.#listRoot || this.#detailRoot) {
      if (this.#listRoot) {
        for (const child of [...this.#listRoot.children]) if (child.tagName !== "STYLE") child.remove();
        const app = el("section", "memory-module memory-list-module");
        if (this.#fatalError) app.append(errorWorkspace(this.t("fatal.title"), errorMessage(this.#fatalError)));
        else app.append(this.renderSidebar());
        this.#listRoot.append(app);
      }
      if (this.#detailRoot) {
        for (const child of [...this.#detailRoot.children]) if (child.tagName !== "STYLE") child.remove();
        const app = el("section", "memory-module memory-detail-module");
        if (this.#fatalError) {
          const panel = errorWorkspace(this.t("fatal.title"), errorMessage(this.#fatalError));
          panel.append(button(this.t("common.retry"), "memory-btn", () => void this.load()));
          app.append(panel);
        } else app.append(this.renderWorkspace());
        this.#detailRoot.append(app);
      }
      return;
    }
    this.#root.querySelector(".memory-module")?.remove();
    const app = el("section", "memory-module");
    const layout = el("div", "memory-layout");
    layout.append(this.renderSidebar(), this.renderWorkspace());
    app.append(layout);
    this.#root.append(app);
  }

  private syncHeaderActions(): void {
    const route = parseLocation(this.#location);
    const actions: PublishedHeaderAction[] = [];
    if (route.kind === "memory-detail" && this.#memoryDetail && !this.#memoryDetail.error) {
      actions.push({
        id: "edit",
        order: 100,
        stateKey: `edit:${this.#memoryDetail.id}`,
        value: {
          label: text(this.#config.locale?.toLowerCase().startsWith("en") ? "Create ChangeSet" : "创建变更"),
          run: () => this.#memoryDetail ? this.createChange(this.#memoryDetail) : undefined
        }
      });
    } else if (route.kind === "market") {
      const item = this.#market.find(candidate => candidate.reference === this.#selectedMarket);
      if (item?.status === "importing" && item.changeId) {
        actions.push({
          id: "market-change",
          order: 100,
          stateKey: `change:${String(item.changeId)}`,
          value: {
            label: text(this.t("market.viewChangeSet")),
            run: () => this.openChange(String(item.changeId))
          }
        });
      } else if (item && item.status !== "consistent" && item.status !== "name_conflict") {
        actions.push({
          id: "market-import",
          order: 100,
          stateKey: `import:${String(item.reference)}:${String(item.status)}`,
          value: {
            label: text(this.t(item.status === "different" ? "market.reimport" : "market.import")),
            run: () => this.importMarket(item)
          }
        });
      }
    } else if (route.kind === "change") {
      const change = this.#changeDetail?.change as ChangeSummary | undefined;
      if (change) {
        if (change.valid === true) actions.push({
          id: "change-valid",
          order: 80,
          stateKey: `valid:${change.id}:${String(change.digest)}`,
          value: { label: text(this.t("change.validationPassed")), icon: { kind: "system", name: "seal-check" }, tone: "success", run: () => undefined }
        });
        if (change.status === "active") {
          actions.push({
            id: "change-add",
            order: 100,
            stateKey: `add:${change.id}:${String(Boolean(change.claimed))}`,
            value: {
              label: text(this.t("change.addMemory")),
              disabled: Boolean(change.claimed),
              run: () => this.addMemory(change)
            }
          }, {
            id: "change-abandon",
            order: 110,
            stateKey: `abandon:${change.id}:${String(change.updatedAt)}`,
            value: { label: text(this.t("common.abandon")), run: () => this.abandonChange(change) }
          });
        } else {
          actions.push({
            id: "change-archive",
            order: 100,
            stateKey: `archive:${change.id}:${String(change.updatedAt)}`,
            value: { label: text(this.t("common.archive")), run: () => this.archiveChange(change) }
          });
        }
        actions.push({
          id: "change-comments",
          order: 120,
          stateKey: `comments:${change.id}:${String(this.#commentsCollapsed)}`,
          value: {
            label: text(this.t(this.#commentsCollapsed ? "change.expandComments" : "change.collapseComments")),
            run: () => this.setCommentsCollapsed(!this.#commentsCollapsed)
          }
        });
      }
    }
    this.#publishHeaderActions(actions);
  }

  private renderSidebar(): HTMLElement {
    const side = el("aside", "memory-sidebar");
    const route = parseLocation(this.#location);
    if (route.kind === "market") side.append(this.renderMarketNavigation());
    else if (route.kind === "change") side.append(this.renderChangeTargetNavigation());
    else if (this.#location.query.section === "changes") side.append(this.renderChangesIndexNavigation());
    else side.append(this.renderMemoryNavigation());
    return side;
  }

  private renderListHeader(title: string, refreshLabel: string, compact = false): HTMLElement {
    const header = el("header", `memory-list-header${compact ? " compact" : ""}`);
    const copy = el("div", "memory-list-header-copy");
    copy.append(el("small", "", this.t("navigation.memory")), el("h2", "", title));
    const refresh = button("", "memory-list-refresh", () => void this.load());
    const icon = document.createElement("img"); icon.src = "/assets/system-icons/arrows-clockwise.svg"; icon.alt = ""; refresh.append(icon);
    refresh.setAttribute("aria-label", refreshLabel);
    header.append(copy, refresh);
    return header;
  }

  private renderChangesIndexNavigation(): HTMLElement {
    const wrap = el("div", "memory-navigation");
    wrap.append(this.renderListHeader(this.#config.locale?.toLowerCase().startsWith("en") ? "ChangeSets" : "记忆变更", this.#config.locale?.toLowerCase().startsWith("en") ? "Refresh ChangeSets" : "刷新记忆变更"));
    const search = input("search", this.t("change.search"), this.#query, "memory-search");
    search.addEventListener("input", () => { this.#query = search.value; this.render(); });
    const needle = this.#query.trim().toLowerCase();
    const changes = this.#changes.filter(change => !needle || `${change.title ?? ""} ${change.id}`.toLowerCase().includes(needle));
    wrap.append(search);
    const list = el("div", "memory-list");
    const selectedChange = parseLocation(this.#location).changeId;
    for (const change of changes) {
      const row = button("", `memory-button${change.id === selectedChange ? " active" : ""}`, () => void this.openChange(change.id));
      row.setAttribute("aria-label", String(change.title ?? change.id));
      const icon = el("span", "memory-button-icon"); const iconImage = document.createElement("img"); iconImage.src = "/assets/system-icons/code.svg"; iconImage.alt = ""; icon.append(iconImage);
      const copy = el("span", "memory-button-copy");
      copy.append(el("strong", "", String(change.title ?? change.id)), el("small", "", this.changeStatusLabel(String(change.status ?? ""))));
      if (change.title) copy.append(el("span", "", change.id));
      const caret = document.createElement("img"); caret.className = "memory-button-caret"; caret.src = "/assets/system-icons/caret-down.svg"; caret.alt = "";
      row.append(icon, copy, caret); list.append(row);
    }
    if (!changes.length) list.append(el("div", "memory-list-empty", this.t("change.empty")));
    wrap.append(list, el("footer", "memory-list-footer", this.format("memory.visibleCount", { count: changes.length })));
    return wrap;
  }

  private renderChangeTargetNavigation(): HTMLElement {
    const wrap = el("div", "memory-navigation");
    const change = this.#changeDetail?.change as ChangeSummary | undefined;
    wrap.append(this.renderListHeader(String(change?.id ?? this.t("change.title")), this.#config.locale?.toLowerCase().startsWith("en") ? "Refresh ChangeSet" : "刷新记忆变更", true));
    const search = input("search", this.t("change.search"), this.#query, "memory-search");
    search.addEventListener("input", () => { this.#query = search.value; this.render(); });
    const needle = this.#query.trim().toLowerCase();
    const visible = this.#memories.filter(memory => !needle || `${memoryName(memory)} ${memoryReference(memory)} ${memorySummaryDescription(memory)}`.toLowerCase().includes(needle));
    wrap.append(search);
    const progress = el("div", "memory-review-progress");
    progress.append(el("span", "", this.t("change.reviewProgress").replace("{reviewed}", String(this.#reviewedMemoryIds.size)).replace("{total}", String(this.#memories.length))));
    const track = el("div", "memory-review-progress-track");
    const bar = el("span"); bar.style.width = `${this.#memories.length ? Math.min(100, this.#reviewedMemoryIds.size / this.#memories.length * 100) : 0}%`; track.append(bar); progress.append(track); wrap.append(progress);
    const list = el("div", "memory-list");
    for (const memory of visible) {
      const row = button("", `memory-button${memory.id === this.#selectedId ? " active" : ""}`, () => { this.#selectedId = memory.id; this.render(); });
      row.setAttribute("aria-label", memoryName(memory));
      const icon = el("span", "memory-button-icon"); const iconImage = document.createElement("img"); iconImage.src = "/assets/system-icons/file-text.svg"; iconImage.alt = ""; icon.append(iconImage);
      const copy = el("span", "memory-button-copy"); copy.append(el("strong", "", memoryName(memory)), el("small", "", this.t(memory.kind)));
      const summary = memorySummaryDescription(memory); if (summary) copy.append(el("span", "", summary));
      const reviewed = this.#reviewedMemoryIds.has(memory.id);
      const state = el("span", `memory-review-state${reviewed ? " reviewed" : ""}`, reviewed ? "✓" : this.operationLabel(String(memory.operation ?? "update")));
      row.append(icon, copy, state); list.append(row);
    }
    if (!visible.length) list.append(el("div", "memory-list-empty", this.t("change.empty")));
    wrap.append(list, el("footer", "memory-list-footer", `${visible.length} Memory`));
    return wrap;
  }

  private renderMemoryNavigation(): HTMLElement {
    const wrap = el("div", "memory-navigation");
    const recent = this.#location.query.section === "recent";
    const heading = recent ? this.t("memory.recent") : this.t("navigation.currentProject");
    const header = this.renderListHeader(heading, this.#config.locale?.toLowerCase().startsWith("en") ? "Refresh list" : "刷新列表");
    const search = input("search", recent ? this.t("memory.recentSearch") : (this.#config.locale?.toLowerCase().startsWith("en") ? "Search current project" : "搜索当前项目"), this.#query, "memory-search");
    search.addEventListener("input", () => { this.#query = search.value; this.render(); });
    const visible = this.visibleMemories();
    wrap.append(header, search);
    for (const kind of kindOrder) {
      const group = visible.filter(memory => memory.kind === kind);
      if (!group.length) continue;
      wrap.append(el("div", "memory-kind", this.t(kind)));
      const list = el("div", "memory-list");
      for (const memory of group) {
        const box = el("div", "memory-change-wrap" + (memory.id === this.#selectedId ? " active" : ""));
        const entry = button("", "memory-button" + (memory.id === this.#selectedId ? " active" : ""), async () => {
          const route = parseLocation(this.#location);
          if (route.changeId) {
            this.#selectedId = memory.id;
            await this.loadMemoryDetail(memory.id, route.changeId);
            this.render();
            return;
          }
          const [kindName, ...name] = memoryReference(memory).split("/");
          const projectId = projectFromLocation(this.#location);
          const query = this.#location.query.section ? { section: this.#location.query.section } : {};
          await this.navigate(projectId
            ? this.#routes.projectMemoryDetail.to({ projectId, kind: kindName, name: name.join("/") }, { query })
            : this.#routes.memoryDetail.to({ kind: kindName, name: name.join("/") }, { query }));
        });
        entry.setAttribute("aria-label", memoryName(memory));
        const icon = el("span", "memory-button-icon");
        const iconImage = document.createElement("img"); iconImage.src = "/assets/system-icons/file-text.svg"; iconImage.alt = ""; icon.append(iconImage);
        const copy = el("span", "memory-button-copy");
        copy.append(el("strong", "", memoryName(memory)), el("small", "", this.t(memory.kind)));
        const summary = memorySummaryDescription(memory) || memoryReference(memory);
        if (summary) copy.append(el("span", "", summary));
        const caret = document.createElement("img"); caret.className = "memory-button-caret"; caret.src = "/assets/system-icons/caret-down.svg"; caret.alt = "";
        entry.append(icon, copy, caret);
        box.append(entry);
        const related = this.#changes.filter(change => (change.memoryPaths ?? []).includes(memory.path));
        if (related.length) box.append(this.changeLinks(this.format("memory.relatedChangeSets", { count: related.length }), related));
        list.append(box);
      }
      wrap.append(list);
    }
    if (!visible.length) wrap.append(el("div", "memory-list-empty", recent ? this.t("memory.recentEmpty") : this.t("memory.empty")));
    if (!recent) {
      const attached = new Set(this.#memories.map(memory => memory.path));
      const other = this.#changes.filter(change => !(change.memoryPaths ?? []).some(path => attached.has(path)));
      if (other.length) wrap.append(this.changeLinks(this.format("memory.otherChangeSets", { count: other.length }), other));
    }
    const option = el("label", "memory-option");
    const checkbox = input("checkbox", "", ""); checkbox.checked = this.#hideSystem;
    checkbox.addEventListener("change", () => { this.#hideSystem = checkbox.checked; localStorage.setItem(hideSystemMemoriesKey, String(checkbox.checked)); this.render(); });
    option.append(checkbox, document.createTextNode(this.t("memory.hideSystem")));
    const options = el("div", "memory-options"); options.append(option); wrap.append(options);
    wrap.append(el("footer", "memory-list-footer", this.#config.locale?.toLowerCase().startsWith("en") ? `${visible.length} results` : `${visible.length} 条结果`));
    return wrap;
  }

  private renderMarketNavigation(): HTMLElement {
    const wrap = el("div", "memory-navigation");
    wrap.append(this.renderListHeader(this.t("navigation.memoryMarket"), this.#config.locale?.toLowerCase().startsWith("en") ? "Refresh Market" : "刷新记忆市场"));
    const search = input("search", this.t("market.search"), this.#query, "memory-search");
    search.addEventListener("input", () => { this.#query = search.value; this.render(); });
    const query = this.#query.trim().toLowerCase();
    const visible = this.#market.filter(item => !query || `${item.reference ?? ""} ${memoryName(item as MemorySummary)}`.toLowerCase().includes(query));
    wrap.append(search);
    for (const kind of kindOrder) {
      const group = visible.filter(item => item.kind === kind);
      if (!group.length) continue;
      wrap.append(el("div", "memory-kind", this.t(kind)));
      const list = el("div", "memory-list");
      for (const item of group) {
        const reference = String(item.reference ?? "");
        const row = button("", "memory-button memory-market-row" + (reference === this.#selectedMarket ? " active" : ""), () => {
          if (item.status === "importing" && item.changeId) { void this.openChange(String(item.changeId)); return; }
          void this.navigate(this.marketTarget(reference));
        });
        row.setAttribute("aria-label", `${memoryName((item.entity ?? item) as MemorySummary)} ${this.marketStatusLabel(String(item.status ?? ""))}`.trim());
        const icon = el("span", "memory-button-icon"); const iconImage = document.createElement("img"); iconImage.src = "/assets/system-icons/file-text.svg"; iconImage.alt = ""; icon.append(iconImage);
        const copy = el("span", "memory-button-copy");
        copy.append(el("strong", "", memoryName((item.entity ?? item) as MemorySummary)), el("small", "", this.t(String(item.kind ?? ""))), el("span", "", reference));
        const trailing = el("span", "memory-button-trailing");
        const caret = document.createElement("img"); caret.className = "memory-button-caret"; caret.src = "/assets/system-icons/caret-down.svg"; caret.alt = "";
        trailing.append(marketStatus(String(item.status ?? ""), this.marketStatusLabel(String(item.status ?? ""))), caret);
        row.append(icon, copy, trailing);
        list.append(row);
      }
      wrap.append(list);
    }
    if (!visible.length) wrap.append(el("div", "memory-list-empty", this.t("market.empty")));
    wrap.append(el("footer", "memory-list-footer", this.format("memory.marketItemCount", { count: visible.length })));
    return wrap;
  }

  private renderWorkspace(): HTMLElement {
    const route = parseLocation(this.#location);
    const main = el("main", `memory-workspace${route.kind === "change" ? " memory-change-workspace" : ""}`);
    if (route.kind === "market") main.append(this.renderMarketDetail());
    else if (route.kind === "change" || this.#location.query.section === "changes") main.append(this.renderChangeDetail());
    else main.append(this.renderMemoryDetail());
    return main;
  }

  private renderMemoryDetail(): HTMLElement {
    const detail = this.#memoryDetail;
    if (!detail) return emptyWorkspace(this.t(this.#memories.length ? "memory.select" : "memory.empty"));
    const context = this.renderChangePreviewContext();
    if (detail.error) {
      const diagnostic = [detail.path, errorMessage(detail.error)].filter(Boolean).join(": ");
      const error = errorWorkspace(this.t("memory.invalidYaml"), diagnostic);
      const wrap = el("div"); if (context) wrap.append(context); wrap.append(error); return wrap;
    }
    const entity = (detail.entity ?? detail) as JsonRecord;
    const workspace = el("div");
    const content = el("section", "memory-panel memory-content-card");
    content.append(renderMemoryEntity(detail.kind, entity, this.t.bind(this), (target, snapshot, location) => void this.beginMemoryComment(detail, target, snapshot, location), this.renderOptions()));
    if (context) workspace.append(context);
    workspace.append(content);
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
    const content = el("section", "memory-panel memory-content-card");
    content.append(renderMemoryEntity(String(item.kind ?? ""), (item.entity ?? item) as JsonRecord, this.t.bind(this), undefined, this.renderOptions()));
    workspace.append(content);
    return workspace;
  }

  private renderChangeDetail(): HTMLElement {
    const payload = this.#changeDetail;
    if (!payload) return emptyWorkspace(this.t(this.#changes.length ? "change.select" : "change.empty"));
    const change = (payload.change ?? {}) as ChangeSummary;
    if (payload.error) return errorWorkspace(change.id || this.t("change.title"), String(payload.error));
    const workspace = el("div");
    const sourceWorktree = change.sourceWorktree as JsonRecord | undefined;
    if (sourceWorktree && sourceWorktree.available === false) {
      const source = el("section", "memory-error memory-source-worktree");
      source.append(el("h3", "", this.t("change.sourceUnavailable")), el("p", "memory-muted", String(sourceWorktree.root ?? "")));
      workspace.append(source);
    }
    if (array(change.issues).length) workspace.append(renderIssues(array(change.issues), this.t("change.validationDiagnostics")));
    const layout = el("div", `memory-change-layout${this.#commentsCollapsed ? " comments-collapsed" : ""}`);
    const main = el("div", "memory-change-main");
    const selected = this.#memories.find(memory => memory.id === this.#selectedId);
    if (selected) {
      const viewbar = el("div", "memory-change-viewbar");
      const mode = el("div", "memory-diff-toolbar");
      const diffButton = button(this.t("change.diff"), `memory-source-tab${this.#changeContentMode === "diff" ? " active" : ""}`, () => { this.#changeContentMode = "diff"; this.render(); });
      const candidateButton = button(this.t("change.candidateContent"), `memory-source-tab${this.#changeContentMode === "candidate" ? " active" : ""}`, () => { this.#changeContentMode = "candidate"; this.render(); });
      mode.append(diffButton, candidateButton);
      const revisions = el("div", "memory-change-revisions");
      revisions.append(changeRevision("base", String(change.baseRevision ?? "")));
      const arrow = document.createElement("img");
      arrow.className = "memory-change-revision-arrow";
      arrow.src = "/assets/system-icons/caret-down.svg";
      arrow.alt = "";
      revisions.append(arrow, changeRevision("candidate", String(change.candidateRevision ?? change.digest ?? "")));
      viewbar.append(mode, revisions);
      main.append(viewbar);
    }
    if (selected?.error) main.append(errorWorkspace(memoryName(selected), errorMessage(selected.error)));
    else if (selected) {
      const panel = el("section", "memory-panel"); panel.append(el("h3", "", memoryName(selected)), renderMeta(selected));
      const comment = (target: string, snapshot: string, location: unknown) => void this.composeComment(selected, target, snapshot, location);
      const operation = String(selected.operation ?? "unchanged");
      if (this.#changeContentMode === "diff" && operation === "create") {
        panel.append(renderWholeMemoryChange(selected, "new", this.t.bind(this), comment, this.renderOptions()));
      } else if (this.#changeContentMode === "diff" && operation === "delete") {
        panel.append(renderWholeMemoryChange(selected, "old", this.t.bind(this), comment, this.renderOptions()));
      } else if (this.#changeContentMode === "diff" && selected.baseMemory) {
        panel.append(renderMemoryComparison(selected, selected.baseMemory, this.t.bind(this), comment, this.renderOptions(), this.#changeDetail?.change as ChangeSummary | undefined));
      } else if (this.#changeContentMode === "candidate" && operation === "delete") {
        const absent = el("div", "memory-deleted-candidate");
        absent.append(el("strong", "", this.t("change.deletedCandidateTitle")), el("span", "", this.t("change.deletedCandidateHint")));
        const before = el("div", "memory-before-full-content");
        before.append(el("h4", "", this.t("change.beforeFullContent")), renderMemoryEntity(selected.kind, (selected.entity ?? selected) as JsonRecord, this.t.bind(this), undefined, this.renderOptions()));
        panel.append(absent, before);
      } else {
        panel.append(renderMemoryEntity(selected.kind, (selected.entity ?? selected) as JsonRecord, this.t.bind(this), comment, this.renderOptions()));
      }
      main.append(panel);
      main.append(this.renderReviewCompletion(selected));
      this.mountInlineCommentComposer(main, selected);
    }
    layout.append(main, this.renderComments(array(payload.comments)));
    workspace.append(layout);
    return workspace;
  }

  private renderComments(comments: JsonRecord[]): HTMLElement {
    const section = el("aside", "memory-panel memory-comments");
    const header = el("header", "memory-comments-header");
    const title = el("div", "memory-comments-title");
    title.append(el("h3", "", this.t("change.comments")), el("span", "memory-comments-count", String(comments.length)));
    const close = button("", "memory-comments-close", () => this.setCommentsCollapsed(true));
    close.setAttribute("aria-label", this.t("change.collapseComments"));
    const closeIcon = document.createElement("img");
    closeIcon.src = "/assets/system-icons/x.svg";
    closeIcon.alt = "";
    close.append(closeIcon);
    header.append(title, close);
    const body = el("div", "memory-comments-body");
    if (!comments.length) body.append(el("p", "memory-muted", this.t("change.noComments")));
    for (const comment of comments) {
      const item = el("article", "memory-comment");
      const head = el("div", "memory-comment-head");
      head.append(el("span", "", actorLabel(comment.submittedBy ?? comment.submitted_by ?? comment.operator ?? comment.actor)), el("span", "memory-pill", this.commentStatus(String(comment.status ?? "pending"))));
      item.append(head);
      if (comment.target || comment.location) item.append(el("button", "memory-comment-target", String(comment.target ?? (comment.location as JsonRecord)?.anchor ?? "")));
      item.append(el("p", "memory-comment-body", String(comment.body ?? "")));
      if (comment.status === "pending" && isMine(comment, this.currentOperator())) {
        const actions = el("div", "memory-comment-actions");
        actions.append(button("编辑", "memory-btn", () => this.editComment(item, comment)), button("删除", "memory-btn danger", () => void this.deleteComment(String(comment.id))));
        item.append(actions);
      }
      body.append(item);
    }
    section.append(header, body);
    return section;
  }

  private mountInlineCommentComposer(main: HTMLElement, memory: MemorySummary): void {
    const draft = this.#commentDraft?.memoryId === memory.id ? this.#commentDraft : null;
    if (!draft?.target || !this.canComment()) return;
    const anchor = [...main.querySelectorAll<HTMLElement>("[data-anchor]")].find(node => node.dataset.anchor === draft.target);
    if (!anchor) return;
    const host = anchor.closest<HTMLElement>(".memory-inline-diff-line")
      ?? anchor.closest<HTMLElement>(".memory-flow-head")
      ?? anchor.closest<HTMLElement>("li, .memory-schema-field, .memory-commentable")
      ?? anchor;
    host.classList.add("has-comment-draft");
    const composer = el("div", "memory-inline-comment-editor");
    const textarea = document.createElement("textarea");
    textarea.placeholder = this.t("change.commentPlaceholder");
    textarea.setAttribute("aria-label", this.t("change.commentPlaceholder"));
    const actions = el("div", "memory-inline-comment-actions");
    const submit = button(this.t("change.submitComment"), "memory-btn primary", () => void this.submitComment(memory, draft, textarea.value));
    submit.disabled = true;
    textarea.addEventListener("input", () => { submit.disabled = !textarea.value.trim(); });
    actions.append(button(this.t("change.cancelComment"), "memory-btn", () => { this.#commentDraft = null; this.render(); }), submit);
    composer.append(textarea, actions);
    if (host.matches(".memory-inline-diff-line, .memory-flow-head")) host.after(composer);
    else host.append(composer);
    queueMicrotask(() => { textarea.focus({ preventScroll: true }); composer.scrollIntoView({ block: "nearest" }); });
  }

  private setCommentsCollapsed(collapsed: boolean): void {
    this.#commentsCollapsed = collapsed;
    localStorage.setItem(changeCommentsCollapsedKey, String(collapsed));
    this.render();
  }

  private renderReviewCompletion(memory: MemorySummary): HTMLElement {
    const reviewed = this.#reviewedMemoryIds.has(memory.id);
    const section = el("section", "memory-review-complete");
    const copy = el("div"); copy.append(el("strong", "", this.t("change.markReviewedTitle")), el("small", "", this.t("change.markReviewedHint")));
    const action = button(reviewed ? `✓ ${this.t("change.reviewed")}` : this.t("change.markReviewed"), "memory-btn primary", () => this.markMemoryReviewed(memory));
    section.append(action, copy);
    return section;
  }

  private markMemoryReviewed(memory: MemorySummary): void {
    this.#reviewedMemoryIds.add(memory.id);
    const changeId = String((this.#changeDetail?.change as ChangeSummary | undefined)?.id ?? "");
    if (changeId) localStorage.setItem(`${changeReviewedKeyPrefix}.${changeId}`, JSON.stringify([...this.#reviewedMemoryIds]));
    const next = this.#memories.find(candidate => !this.#reviewedMemoryIds.has(candidate.id));
    if (next) this.#selectedId = next.id;
    this.render();
  }

  private readReviewedMemories(changeId: string): Set<string> {
    try {
      const value = JSON.parse(localStorage.getItem(`${changeReviewedKeyPrefix}.${changeId}`) ?? "[]");
      return new Set(Array.isArray(value) ? value.filter(item => typeof item === "string") : []);
    } catch { return new Set(); }
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
    try { await this.request(`/api/archive/changes/${encodeURIComponent(change.id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedUpdatedAt: change.updatedAt }) }); await this.navigate(this.memoryIndexTarget()); }
    catch (error) { this.showTransientError(error); }
  }

  private composeComment(memory: MemorySummary, target: string, snapshot: string, location: unknown): void {
    if (!this.canComment() || !target) return;
    this.#commentDraft = { memoryId: memory.id, target, snapshot, location };
    this.render();
  }

  private async submitComment(memory: MemorySummary, draft: { target: string; snapshot: string; location: unknown }, body: string): Promise<void> {
    if (!body.trim() || !this.canComment()) return;
    const operator = await this.chooseOperator(); if (!operator) return;
    const change = this.#changeDetail?.change as ChangeSummary | undefined;
    try {
      await this.request(`/api/changes/${encodeURIComponent(change?.id ?? "")}/comments`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operator, memoryReference: memory.id, path: memory.path, target: draft.target || undefined, location: draft.location, snapshot: draft.snapshot || undefined, body: body.trim(), expectedUpdatedAt: change?.updatedAt })
      });
      this.#commentDraft = null;
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
    const section = memorySection(this.#location);
    if (section === "market") {
      const query = this.#selectedMarket ? { item: this.#selectedMarket } : {};
      const sourceProjectId = projectFromLocation(this.#location);
      this.#changeReturnTarget = sourceProjectId
        ? this.#routes.projectMarket.to({ projectId: sourceProjectId }, { query })
        : this.#routes.market.to(undefined, { query });
    } else {
      this.#changeReturnTarget = undefined;
    }
    await this.navigate(this.#routes.changeDetail.to({ projectId, changeId }, { query: { section } }));
  }

  private async navigate(target: RouteTarget): Promise<void> { await this.#navigate(target); }

  private memoryIndexTarget(): RouteTarget {
    if (this.#changeReturnTarget) return this.#changeReturnTarget;
    const section = memorySection(this.#location);
    const projectId = projectFromLocation(this.#location);
    if (section === "market") {
      const query = this.#selectedMarket ? { item: this.#selectedMarket } : {};
      return projectId
        ? this.#routes.projectMarket.to({ projectId }, { query })
        : this.#routes.market.to(undefined, { query });
    }
    if (section === "project" && projectId) {
      return this.#routes.projectIndex.to({ projectId }, { query: { section } });
    }
    return this.#routes.projectIndex.to({ projectId: projectId || this.#currentProject || "memsphere" }, { query: { section } });
  }

  private marketTarget(item = ""): RouteTarget {
    return this.#routes.projectMarket.to({ projectId: projectFromLocation(this.#location) || this.#currentProject || "memsphere" }, { query: item ? { item } : {} });
  }

  private visibleMemories(): MemorySummary[] {
    const query = this.#query.trim().toLowerCase();
    const visible = this.#memories.filter(memory => (!this.#hideSystem || !memory.system) && (!query || `${memory.id} ${memory.path} ${(memory.names ?? []).join(" ")}`.toLowerCase().includes(query)));
    if (this.#location.query.section !== "recent") return visible;
    const byId = new Map(visible.map(memory => [memory.id, memory]));
    return this.recentMemoryIds().map(id => byId.get(id)).filter((memory): memory is MemorySummary => Boolean(memory));
  }

  private recentMemoryIds(): string[] {
    const project = this.#currentProject || projectFromLocation(this.#location) || "memsphere";
    try {
      const stored = JSON.parse(localStorage.getItem(recentMemoriesKey) || "{}");
      return Array.isArray(stored[project]) ? stored[project].filter((value: unknown): value is string => typeof value === "string") : [];
    } catch {
      return [];
    }
  }

  private rememberRecentMemory(id: string): void {
    if (!id) return;
    const project = this.#currentProject || projectFromLocation(this.#location) || "memsphere";
    let stored: Record<string, string[]> = {};
    try {
      const parsed = JSON.parse(localStorage.getItem(recentMemoriesKey) || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed;
    } catch { /* reset corrupt recent history */ }
    stored[project] = [id, ...(stored[project] ?? []).filter(candidate => candidate !== id)].slice(0, recentMemoryLimit);
    localStorage.setItem(recentMemoriesKey, JSON.stringify(stored));
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
  private operationLabel(operation: string): string { const key = `change.operation.${operation}`; return this.t(key) === key ? operation : this.t(key); }
  private commentStatus(status: string): string { return this.t(`change.comment.${status}`); }
  private renderOptions(): RenderOptions {
    return {
      knownReferences: new Set(this.#memories.map(memoryReference)),
      openReference: target => {
        const memory = this.#memories.find(candidate => memoryReference(candidate) === target || candidate.names?.[0] === target);
        if (!memory) return;
        const [kind, ...name] = memory.id.split("/");
        const query = this.#location.query.section ? { section: this.#location.query.section } : {};
        void this.navigate(this.#routes.projectMemoryDetail.to({ projectId: projectFromLocation(this.#location) || this.#currentProject || "memsphere", kind, name: name.join("/") }, { query }));
      }
    };
  }
  private t(key: string): string { return message(this.#config, key); }
  private format(key: string, params: Record<string, string | number>): string { return Object.entries(params).reduce((value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)), this.t(key)); }

  private renderError(error: unknown, retry: () => void): void {
    this.#fatalError = error;
    if (this.#listRoot || this.#detailRoot) { this.render(); return; }
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

function projectApiUrl(config: Readonly<MemoryConfig>, path: string): string {
  return path !== "/api/projects" && path.startsWith("/api/") && config.projectApiBase ? `${config.projectApiBase}${path.slice(4)}` : path;
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

function renderMemoryComparison(
  candidate: MemorySummary,
  base: MemorySummary,
  t: (key: string) => string,
  comment: CommentCallback,
  options: RenderOptions,
  change?: ChangeSummary
): HTMLElement {
  const root = candidate.kind === "procedures" ? "procedure"
    : candidate.kind === "statements" ? "statement"
      : candidate.kind === "schemas" ? "schema" : "memory";
  const beforeEntity = (base.entity ?? base) as JsonRecord;
  const afterEntity = (candidate.entity ?? candidate) as JsonRecord;
  const changes = scalarDiffEntries(beforeEntity, afterEntity, root);
  const wrap = el("div", "memory-diff-view");
  const summary = el("div", "memory-diff-summary");
  summary.append(el("strong", "", t("change.fieldChanges").replace("{count}", String(changes.length))));
  wrap.append(summary);
  const before = renderMemoryEntity(candidate.kind, beforeEntity, t, comment, options);
  const after = renderMemoryEntity(candidate.kind, afterEntity, t, comment, options);
  applyInlineMemoryDiff(before, after, changes, t("change.before"), t("change.after"), t("change.added"), t("change.deleted"));
  wrap.append(after);
  return wrap;
}

function renderWholeMemoryChange(
  memory: MemorySummary,
  tone: "old" | "new",
  t: (key: string) => string,
  comment: CommentCallback | undefined,
  options: RenderOptions
): HTMLElement {
  const rootPath = memory.kind === "procedures" ? "procedure"
    : memory.kind === "statements" ? "statement"
      : memory.kind === "schemas" ? "schema" : "memory";
  const entity = (memory.entity ?? memory) as JsonRecord;
  const changes = collectScalarDiffs(entity, rootPath, tone === "old" ? "before" : "after");
  const wrap = el("div", "memory-diff-view");
  const summary = el("div", "memory-diff-summary");
  summary.append(el("strong", "", t("change.fieldChanges").replace("{count}", String(changes.length))));
  wrap.append(summary);
  const document = renderMemoryEntity(memory.kind, entity, t, comment, options);
  applyWholeMemoryTone(document, changes, tone, tone === "old" ? t("change.deleted") : t("change.added"));
  wrap.append(document);
  return wrap;
}

function applyWholeMemoryTone(root: HTMLElement, changes: readonly ScalarDiffEntry[], tone: "old" | "new", label: string): void {
  const nodes = anchoredNodes(root);
  const groups = diffGroups(root);
  const handledGroups = new Set<string>();
  for (const change of changes) {
    const path = tone === "old" ? change.beforePath : change.afterPath;
    if (!path) continue;
    const node = nodes.get(path);
    if (!node || !root.contains(node)) continue;
    const groupKey = node.closest<HTMLElement>("[data-diff-group]")?.dataset.diffGroup;
    if (groupKey) {
      if (handledGroups.has(groupKey)) continue;
      handledGroups.add(groupKey);
      const group = groups.get(groupKey);
      if (group && root.contains(group)) renderInlineSingle(group, tone, label);
      continue;
    }
    renderInlineSingle(node, tone, label);
  }
}

type ScalarDiffEntry = { beforePath?: string; afterPath?: string };

function applyInlineMemoryDiff(
  before: HTMLElement,
  after: HTMLElement,
  changes: readonly ScalarDiffEntry[],
  beforeLabel: string,
  afterLabel: string,
  addedLabel: string,
  deletedLabel: string
): void {
  const beforeNodes = anchoredNodes(before);
  const afterNodes = anchoredNodes(after);
  const beforeGroups = diffGroups(before);
  const afterGroups = diffGroups(after);
  const handledGroups = new Set<string>();
  for (const change of changes) {
    const oldNode = change.beforePath ? beforeNodes.get(change.beforePath) : undefined;
    const newNode = change.afterPath ? afterNodes.get(change.afterPath) : undefined;
    const groupKey = oldNode?.closest<HTMLElement>("[data-diff-group]")?.dataset.diffGroup
      ?? newNode?.closest<HTMLElement>("[data-diff-group]")?.dataset.diffGroup;
    if (groupKey) {
      if (handledGroups.has(groupKey)) continue;
      handledGroups.add(groupKey);
      const oldGroup = beforeGroups.get(groupKey);
      const newGroup = afterGroups.get(groupKey);
      if (oldGroup && newGroup) renderInlineReplacement(oldGroup, newGroup, beforeLabel, afterLabel);
      else if (newGroup) renderInlineSingle(newGroup, "new", addedLabel);
      else if (oldGroup) renderInlineRemoval(oldGroup, change.beforePath ?? groupKey, beforeNodes, afterNodes, after, deletedLabel);
      continue;
    }
    if (oldNode && newNode) {
      renderInlineReplacement(oldNode, newNode, beforeLabel, afterLabel);
    } else if (newNode) {
      renderInlineSingle(newNode, "new", addedLabel);
    } else if (oldNode) {
      renderInlineRemoval(oldNode, change.beforePath ?? "", beforeNodes, afterNodes, after, deletedLabel);
    }
  }
}

function diffGroups(root: HTMLElement): Map<string, HTMLElement> {
  const groups = new Map<string, HTMLElement>();
  for (const node of root.querySelectorAll<HTMLElement>("[data-diff-group]")) {
    const key = node.dataset.diffGroup ?? "";
    if (key && !groups.has(key)) groups.set(key, node);
  }
  return groups;
}

function anchoredNodes(root: HTMLElement): Map<string, HTMLElement> {
  const nodes = new Map<string, HTMLElement>();
  for (const node of root.querySelectorAll<HTMLElement>("[data-anchor]")) {
    const path = node.dataset.anchor ?? "";
    if (path && !nodes.has(path)) nodes.set(path, node);
  }
  return nodes;
}

function renderInlineReplacement(oldSource: HTMLElement, newNode: HTMLElement, beforeLabel: string, afterLabel: string): void {
  const oldListItem = textListItem(oldSource);
  const newListItem = textListItem(newNode);
  if (oldListItem && newListItem) {
    const oldItem = cleanDiffClone(oldListItem);
    const oldLine = diffLine(oldItem, "old", beforeLabel);
    const newLine = diffLine(newListItem, "new", afterLabel);
    newListItem.classList.add("memory-inline-diff-item");
    newListItem.append(oldLine, newLine);
    return;
  }
  const oldNode = cleanDiffClone(oldSource);
  const pair = diffPair();
  newNode.replaceWith(pair);
  pair.append(diffLine(oldNode, "old", beforeLabel), diffLine(newNode, "new", afterLabel));
}

function renderInlineSingle(node: HTMLElement, tone: "old" | "new", label: string): void {
  const listItem = textListItem(node);
  if (listItem) {
    decorateListDiff(listItem, tone, label);
    return;
  }
  const marker = document.createTextNode("");
  node.replaceWith(marker);
  marker.replaceWith(diffLine(node, tone, label));
}

function renderInlineRemoval(oldSource: HTMLElement, path: string, beforeNodes: ReadonlyMap<string, HTMLElement>, afterNodes: ReadonlyMap<string, HTMLElement>, after: HTMLElement, label: string): void {
  const beforePaths = [...beforeNodes.keys()];
  const position = beforePaths.indexOf(path);
  const followingPath = beforePaths.slice(position + 1).find(candidatePath => afterNodes.has(candidatePath));
  const nearbyPath = followingPath ?? beforePaths.slice(0, Math.max(0, position)).reverse().find(candidatePath => afterNodes.has(candidatePath));
  const nearby = nearbyPath ? afterNodes.get(nearbyPath) : undefined;
  const oldList = oldSource.closest<HTMLElement>("ul.text-list");
  const oldPanel = oldList?.parentElement;
  const oldNode = textListItem(oldSource) ?? oldSource;
  if (oldList && oldPanel) {
    const block = el("section", `${oldPanel.className} memory-inline-removed`.trim());
    const title = oldPanel.querySelector<HTMLElement>(":scope > .memory-block-title")?.cloneNode(true);
    const list = document.createElement("ul"); list.className = "text-list";
    const item = oldNode.tagName === "LI" ? oldNode : document.createElement("li");
    if (item !== oldNode) item.append(oldNode);
    decorateListDiff(item, "old", label);
    list.append(item);
    if (title) block.append(title);
    block.append(list);
    const nearbyBlock = nearby?.closest<HTMLElement>(".memory-list-block, .action-contracts, section");
    if (nearbyBlock && followingPath) nearbyBlock.before(block);
    else if (nearbyBlock) nearbyBlock.after(block);
    else after.append(block);
    return;
  }
  const pair = diffPair("memory-inline-removed");
  pair.append(diffLine(oldNode, "old", label));
  if (nearby?.parentElement) nearby.before(pair);
  else after.append(pair);
}

function cleanDiffClone(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.removeAttribute("data-anchor");
  clone.querySelectorAll("[data-anchor]").forEach(node => node.removeAttribute("data-anchor"));
  clone.querySelectorAll("button").forEach(node => node.remove());
  clone.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
  return clone;
}

function textListItem(node: HTMLElement): HTMLLIElement | undefined {
  const item = node.closest<HTMLLIElement>("li");
  return item?.parentElement?.matches("ul.text-list") ? item : undefined;
}

function diffPair(className = ""): HTMLDivElement {
  return el("div", `memory-inline-diff-pair ${className}`.trim());
}

function diffLine(node: HTMLElement, tone: "old" | "new", label: string): HTMLDivElement {
  const item = el("div", `memory-inline-diff-line memory-inline-${tone}`);
  const line = el("div", "memory-inline-diff-list-row");
  const content = el("div", "memory-inline-diff-content");
  if (node.tagName === "LI") while (node.firstChild) content.append(node.firstChild);
  else content.append(node);
  line.append(el("span", "memory-inline-diff-label", label), content);
  item.append(line);
  return item;
}

function decorateListDiff(node: HTMLElement, tone: "old" | "new", label: string): void {
  const line = diffLine(node, tone, label);
  node.classList.add("memory-inline-diff-item", `memory-inline-marker-${tone}`);
  node.append(line);
}

function scalarDiffEntries(before: unknown, after: unknown, path: string): ScalarDiffEntry[] {
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.every(isPrimitive) && after.every(isPrimitive)) return primitiveArrayDiff(before, after, path);
    const result: ScalarDiffEntry[] = [];
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      const itemPath = `${path}[${index + 1}]`;
      if (index >= before.length) result.push(...collectScalarDiffs(after[index], itemPath, "after"));
      else if (index >= after.length) result.push(...collectScalarDiffs(before[index], itemPath, "before"));
      else result.push(...scalarDiffEntries(before[index], after[index], itemPath));
    }
    return result;
  }
  if (isRecord(before) && isRecord(after)) {
    const result: ScalarDiffEntry[] = [];
    const ignored = new Set(["tag", "syntax", "effectiveRules"]);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (ignored.has(key)) continue;
      const childPath = `${path}.${key}`;
      const inBefore = Object.prototype.hasOwnProperty.call(before, key);
      const inAfter = Object.prototype.hasOwnProperty.call(after, key);
      if (!inBefore) result.push(...collectScalarDiffs(after[key], childPath, "after"));
      else if (!inAfter) result.push(...collectScalarDiffs(before[key], childPath, "before"));
      else result.push(...scalarDiffEntries(before[key], after[key], childPath));
    }
    return result;
  }
  if (scalar(before) === scalar(after)) return [];
  return [{ beforePath: path, afterPath: path }];
}

function primitiveArrayDiff(before: unknown[], after: unknown[], path: string): ScalarDiffEntry[] {
  const rows = before.length + 1;
  const columns = after.length + 1;
  const table = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  for (let left = before.length - 1; left >= 0; left -= 1) for (let right = after.length - 1; right >= 0; right -= 1) {
    table[left]![right] = scalar(before[left]) === scalar(after[right])
      ? 1 + table[left + 1]![right + 1]!
      : Math.max(table[left + 1]![right]!, table[left]![right + 1]!);
  }
  const matches: Array<[number, number]> = [];
  let left = 0; let right = 0;
  while (left < before.length && right < after.length) {
    if (scalar(before[left]) === scalar(after[right])) { matches.push([left, right]); left += 1; right += 1; }
    else if (table[left + 1]![right]! >= table[left]![right + 1]!) left += 1;
    else right += 1;
  }
  const result: ScalarDiffEntry[] = [];
  let beforeStart = 0; let afterStart = 0;
  for (const [beforeMatch, afterMatch] of [...matches, [before.length, after.length] as [number, number]]) {
    const removed = Array.from({ length: beforeMatch - beforeStart }, (_, index) => beforeStart + index);
    const added = Array.from({ length: afterMatch - afterStart }, (_, index) => afterStart + index);
    const paired = Math.min(removed.length, added.length);
    for (let index = 0; index < paired; index += 1) result.push({ beforePath: `${path}[${removed[index]! + 1}]`, afterPath: `${path}[${added[index]! + 1}]` });
    for (const index of removed.slice(paired)) result.push({ beforePath: `${path}[${index + 1}]` });
    for (const index of added.slice(paired)) result.push({ afterPath: `${path}[${index + 1}]` });
    beforeStart = beforeMatch + 1;
    afterStart = afterMatch + 1;
  }
  return result;
}

function collectScalarDiffs(value: unknown, path: string, side: "before" | "after"): ScalarDiffEntry[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => collectScalarDiffs(item, `${path}[${index + 1}]`, side));
  if (isRecord(value)) return Object.entries(value).flatMap(([key, child]) => ["tag", "syntax", "effectiveRules"].includes(key) ? [] : collectScalarDiffs(child, `${path}.${key}`, side));
  return [side === "before" ? { beforePath: path } : { afterPath: path }];
}

function isPrimitive(value: unknown): boolean { return value === null || typeof value !== "object"; }
function isRecord(value: unknown): value is JsonRecord { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }

function renderSchema(node: JsonRecord, depth: number, fallback: string, path: string, t: (key: string) => string, comment?: CommentCallback, options: RenderOptions = {}, openThroughDepth = 1): HTMLElement {
  const names = array(node.names);
  const title = depth === 0 ? "" : String(names[1] ?? names[0] ?? node.name ?? fallback);
  const badges = ["!schema"];
  if (node.optional === true) badges.push(`${t("optional")}: true`);
  if (node.type !== undefined) badges.push(`${t("type")}: ${translatedScalar(node.type, t)}`);
  if (node.format !== undefined) badges.push(`${t("format")}: ${formatLabel(node.format)}`);
  const section = nodeSection(title, path, node, comment, badges, depth <= openThroughDepth);
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
      else if (field && typeof field === "object") children.append(renderSchema(field as JsonRecord, depth + 1, t("schemas"), fieldPath, t, comment, options, openThroughDepth));
    });
    body.append(children);
  }
  if (node.item && typeof node.item === "object") {
    body.append(blockTitle(t("item")), isReference(node.item) ? renderMemoryReference(node.item, options, t) : renderSchema(node.item as JsonRecord, depth + 1, t("item"), `${path}.item`, t, comment, options, openThroughDepth));
  }
  const items = array(node.items);
  if (items.length) {
    body.append(blockTitle(t("items")));
    const children = el("div", "memory-child-stack");
    items.forEach((item, index) => { if (item && typeof item === "object") children.append(isReference(item) ? renderMemoryReference(item, options, t) : renderSchema(item, depth + 1, `${t("item")} ${index + 1}`, `${path}.items[${index + 1}]`, t, comment, options, openThroughDepth)); });
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
  head.append(el("span", "memory-flow-label", t(tag === "!if" ? "if" : tag === "!while" ? "while" : "step")), commentable(el("span", "memory-flow-action", action), `${path}.action`, action, comment), renderArtifactMeta(control, path, t, comment));
  item.append(head);
  for (const key of ["asserts", "suggests"] as const) appendRuleList(item, key, array(control[key]), control.effectiveRules as JsonRecord | undefined, path, t, comment, options, "action-contracts");
  const artifact = artifactContract(control);
  if (artifact.schema && typeof artifact.schema === "object") {
    if (isReference(artifact.schema)) {
      item.append(renderMemoryReference(artifact.schema, options, t));
    } else {
      const schema = renderSchema(artifact.schema as JsonRecord, 1, t("inlineSchema"), `${path}.artifact.schema`, t, comment, options, 2);
      schema.classList.remove("open");
      schema.classList.add("memory-artifact-schema");
      item.append(schema);
    }
  }
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

function renderArtifactMeta(step: JsonRecord, path: string, t: (key: string) => string, comment?: CommentCallback): HTMLElement {
  const row = el("div", "memory-artifact-row");
  row.dataset.diffGroup = `${path}.artifact`;
  const artifact = artifactContract(step);
  const name = String(artifact.name ?? "");
  row.append(el("span", "memory-artifact-label", t("artifact")));
  if (name) row.append(anchored(el("span", "memory-pill strong", name), `${path}.artifact.name`));
  if (artifact.type) row.append(anchored(el("span", "memory-pill", String(artifact.type)), `${path}.artifact.type`));
  if (artifact.format) row.append(anchored(el("span", "memory-pill", formatLabel(artifact.format)), `${path}.artifact.format`));
  if (artifact.final) row.append(anchored(el("span", "memory-pill done", t("final")), `${path}.artifact.final`));
  const reviewers = Array.isArray(artifact.review) ? artifact.review : typeof artifact.review === "string" ? [artifact.review] : [];
  reviewers.forEach((value, index) => row.append(anchored(el("span", "memory-pill", String(value)), `${path}.artifact.review[${index + 1}]`)));
  if (comment) {
    const target = `${path}.artifact`;
    row.classList.add("memory-commentable");
    row.dataset.anchor = target;
    row.append(plusButton(() => comment(target, scalar(artifact), { anchor: target })));
  }
  return row;
}

function artifactContract(step: JsonRecord): JsonRecord {
  return step.artifact && typeof step.artifact === "object"
    ? step.artifact as JsonRecord
    : { name: step.artifact, type: step.type, format: step.format, schema: step.schema, final: step.final, review: step.reviewPolicy };
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
  node.dataset.anchor = target;
  if (!comment) return node;
  node.classList.add("memory-commentable"); node.append(plusButton(() => comment(target, scalar(snapshot), { anchor: target }))); return node;
}
function anchored(node: HTMLElement, target: string): HTMLElement { node.dataset.anchor = target; return node; }
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
  values.forEach((value, index) => {
    const li = document.createElement("li");
    const body = el("span", "commentable-body", scalar(value));
    li.append(commentable(body, `${path}.${key}[${index + 1}]`, value, comment));
    list.append(li);
  });
  block.append(list); parent.append(block);
}

function changeRevision(label: string, revision: string): HTMLElement {
  const item = el("span", "memory-change-revision");
  item.append(el("span", "", label), el("code", "", revision.slice(0, 7) || "—"));
  return item;
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
function memorySummaryDescription(memory: MemorySummary): string {
  const entity = memory.entity ?? memory;
  for (const key of ["summary", "description", "defines", "goals"] as const) {
    const value = entity[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const first = value.find(entry => typeof entry === "string" && entry.trim());
      if (typeof first === "string") return first.trim();
    }
  }
  return "";
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
