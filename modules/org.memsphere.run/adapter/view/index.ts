import { createContextGraph } from "./context-control.js";
import { RunSummaryRequests } from "./summary-requests.js";
import {
  defineViewPlugin,
  portableSlots,
  slots,
  type Disposer,
  type ContentListDescriptor,
  type HeaderActionDescriptor,
  type HeaderTitleDescriptor,
  type RouteLocation,
  type RouteToken,
  type ViewMount,
  type ViewPluginContext,
  type ViewRenderContext,
  type ViewUi
} from "@memsphere/view-sdk";
import { createRunDetailState, currentRunStep, renderRunDetail } from "./run-detail.js";
import { DisclosureState, nativeDisclosure, type DisclosureBinding } from "../../../shared/view/disclosure-state.js";
import { runDetailStyles } from "./run-styles.js";
import { contentFlowStyles } from "../../../shared/view/content-flow.js";
import { createPageLayout, pageLayoutStyles } from "../../../shared/view/page-layout.js";
import { defaultContentStyles } from "../../../shared/view/default-content-styles.js";

type Json = Record<string, any>;
type RunConfig = { locale?: string; messages?: Readonly<Record<string, string>>; projectApiBase?: string };
type RunRoutes = { index: RouteToken; detail: RouteToken; review: RouteToken };
type Navigate = (target: ReturnType<RouteToken["to"]>) => Promise<void>;
type RefreshableViewMount = ViewMount & { refresh(): Promise<void> };

const zh: Readonly<Record<string, string>> = Object.freeze({
  run: "运行", running: "运行中", done: "已完成", abandoned: "已废弃",
  loading: "加载中…", empty: "当前状态下没有 Run。", choose: "选择一个 Run 查看详情。",
  retry: "重试", refresh: "刷新", archive: "归档", abandon: "废弃", review: "产物评审", jumpCurrent: "跳到当前步骤",
  finish: "结束运行", finishConfirm: "以当前成果结束这个 Run？结束后产物与评审记录将保持只读。", restore: "恢复归档", archived: "已归档",
  archiveConfirm: "确认归档这个 Run？", abandonConfirm: "确认废弃这个 Run？",
  artifact: "产物", flow: "执行流程", current: "当前步骤", notStarted: "未开始",
  completed: "已完成", updated: "更新时间", procedure: "流程", events: "产物数",
  reviewProgress: "评审进度", close: "关闭", cancel: "取消", locate: "定位", submit: "提交评审", approve: "通过",
  requestChanges: "要求修改", abstain: "弃权", comments: "评审意见", addComment: "添加意见",
  noReviewRequired: "无需评审", selectIdentity: "选择评审身份", round: "轮次",
  artifactPane: "产物", reviewPane: "评审", participants: "参与者", scope: "评审范围",
  record: "本轮汇总", saveDraft: "保存草稿", savedOpinion: "已保存意见", conflict: "评审正在更新，请稍后重试。",
  loadFailed: "加载 Run 失败", binding: "运行时评审绑定", status: "状态",
  identity: "评审身份", overallPlaceholder: "补充整体评审意见", addOpinion: "添加意见", commentSeverity: "意见类型",
  severityBlocking: "阻塞", severityRisk: "风险", severitySuggestion: "建议",
  selectMaterial: "选择评审材料", candidate: "待评审产物", contract: "冻结契约", earlier: "前序产物",
  currentRound: "当前轮次", historicalRound: "历史轮次 · 只读",
  historyReadOnly: "历史轮次仅供查看，不能投票、添加意见或重新提交。",
  resizeReview: "调整产物与评审区域宽度", viewDetails: "运行记录", hideDetails: "收起运行记录",
  activity: "运行记录", selectAttempt: "选择尝试", attempt: "尝试",
  message: "消息", tool: "工具调用", plan: "执行计划", lifecycle: "运行状态",
  submitted: "已提交", failed: "执行失败", pending: "等待启动",
  materialTitle: "评审材料", reviewTime: "评审时间", myReview: "我的评审", delegatedByRunner: "Runner 受托提交", authorizationNote: "授权说明",
  participationProgress: "评审结果", reviewRecord: "评审记录", submittedOpinions: "已提交意见",
  runner: "执行者", decision: "决策票", advisory: "建议票", agent: "Agent",
  pendingVote: "未投票", decisionReady: "决策票已就绪", reviewComplete: "评审已完成", waitingReviews: "仍在等待评审",
  blockingComments: "阻塞意见", unresolved: "未处置", environmentFailures: "环境失败",
  repeatedAdvisories: "重复建议组", voteSummary: "投票摘要",
  file: "文件", document: "文档",
  noMaterialReview: "此材料没有独立的评审记录", materialReadOnly: "前序产物评审记录 · 只读", inline: "内联", roundSummary: "本轮汇总"
});

const en: Readonly<Record<string, string>> = Object.freeze({
  run: "Runs", running: "Running", done: "Done", abandoned: "Abandoned",
  loading: "Loading…", empty: "No runs in this status.", choose: "Choose a run to inspect.",
  retry: "Retry", refresh: "Refresh", archive: "Archive", abandon: "Abandon", review: "Artifact review", jumpCurrent: "Jump to current step",
  finish: "Finish run", finishConfirm: "Finish this run with its current outputs? Artifacts and reviews will become read-only.", restore: "Restore", archived: "Archived",
  archiveConfirm: "Archive this run?", abandonConfirm: "Abandon this run?",
  artifact: "Artifact", flow: "Flow", current: "Current step", notStarted: "Not started",
  completed: "Completed", updated: "Updated", procedure: "Procedure", events: "Artifacts",
  reviewProgress: "Review progress", close: "Close", cancel: "Cancel", locate: "Locate", submit: "Submit review", approve: "Approve",
  requestChanges: "Request changes", abstain: "Abstain", comments: "Comments", addComment: "Add comment",
  noReviewRequired: "No review required for this identity", selectIdentity: "Select review identity",
  round: "Round", artifactPane: "Artifact", reviewPane: "Review", participants: "Participants",
  scope: "Review scope", record: "Round summary", saveDraft: "Save draft", savedOpinion: "Saved comment",
  conflict: "The review is being updated. Try again shortly.", loadFailed: "Unable to load run",
  binding: "Runtime review bindings", status: "Status", identity: "Review identity",
  overallPlaceholder: "Add an overall review comment", addOpinion: "Add comment", commentSeverity: "Comment type",
  severityBlocking: "Blocking", severityRisk: "Risk", severitySuggestion: "Suggestion",
  selectMaterial: "Select review material", candidate: "Artifact under review", contract: "Frozen contract", earlier: "Earlier Artifact",
  currentRound: "Current round", historicalRound: "Historical round · Read-only",
  historyReadOnly: "Historical rounds are read-only; voting, commenting, and resubmission are unavailable.",
  resizeReview: "Resize artifact and review panes", viewDetails: "Run activity", hideDetails: "Hide activity",
  activity: "Activity", selectAttempt: "Select attempt", attempt: "Attempt",
  message: "Message", tool: "Tool call", plan: "Plan", lifecycle: "Lifecycle",
  submitted: "Submitted", failed: "Failed", pending: "Queued",
  materialTitle: "Review material", reviewTime: "Review time", myReview: "My review", delegatedByRunner: "Runner delegated", authorizationNote: "Authorization note",
  participationProgress: "Review results", reviewRecord: "Review record", submittedOpinions: "Submitted opinions",
  runner: "Runner", decision: "Decision", advisory: "Advisory", agent: "Agent",
  pendingVote: "Pending vote", decisionReady: "Decision votes are ready", reviewComplete: "Review completed", waitingReviews: "Waiting for reviews",
  blockingComments: "Blocking comments", unresolved: "Unresolved", environmentFailures: "Environment failures",
  repeatedAdvisories: "Repeated advisory groups", voteSummary: "Vote summary",
  file: "File", document: "Document",
  noMaterialReview: "No review record for this material", materialReadOnly: "Earlier artifact review · Read-only", inline: "Inline", roundSummary: "Round summary"
});

const styles = `
  .run-module{--surface:var(--mem-view-color-surface);--soft:var(--mem-view-color-subtle);--line:var(--mem-view-color-border);--text:var(--mem-view-color-text);--muted:var(--mem-view-color-text-muted);--accent:var(--mem-view-color-accent);--danger:var(--mem-view-color-danger);color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,sans-serif;min-width:0;max-width:100%;min-height:100%;overflow-x:hidden;background:var(--mem-view-color-canvas)}
  .run-module *{box-sizing:border-box}.run-module button,.run-module textarea,.run-module select{font:inherit}.run-module button{cursor:pointer}
  .run-layout{display:grid;grid-template-columns:300px minmax(0,1fr);min-height:100vh}.run-sidebar{position:sticky;top:0;height:100vh;overflow:auto;padding:16px;border-right:1px solid var(--line);background:var(--mem-view-color-subtle)}
  .run-workspace,.run-workspace>*{min-width:0;max-width:100%}.run-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin:0 0 14px;padding:19px 20px;border:1px solid var(--line);border-radius:12px;background:var(--surface);box-shadow:0 1px 2px rgba(20,47,42,.025)}.run-title{margin:0;font-size:22px;min-width:0;overflow-wrap:anywhere}.run-subtitle{min-width:0;margin-top:5px;color:var(--muted);overflow-wrap:anywhere}.run-panel,.run-error,.run-artifact{min-width:0;max-width:100%;overflow-wrap:anywhere;margin:12px 0;padding:20px 22px;border:1px solid var(--line);border-radius:12px;background:var(--surface);box-shadow:0 1px 2px rgba(20,47,42,.025)}.run-error{border-left:4px solid var(--danger)}
  .run-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.run-pill{display:inline-flex;min-height:30px;align-items:center;border:1px solid var(--line);border-radius:999px;padding:0 11px;background:var(--soft);color:var(--muted);font-size:11px;line-height:1.2}.run-pill.running{color:var(--accent);border-color:var(--mem-view-color-border-strong);background:var(--mem-view-color-accent-soft)}.run-pill.abandoned{color:var(--mem-view-color-warning);background:var(--mem-view-color-warning-soft)}.run-pill.done{color:var(--mem-view-color-success);background:var(--mem-view-color-success-soft)}.run-meta-action{display:inline-flex;min-height:34px;align-items:center;border:1px solid var(--mem-view-color-border-strong);border-radius:8px;background:var(--surface);color:var(--mem-view-color-accent);padding:0 13px;font-size:12px;font-weight:650;box-shadow:0 1px 2px #00000012}.run-meta-action:hover{border-color:var(--mem-view-color-border-strong);background:var(--mem-view-color-subtle);color:var(--mem-view-color-accent)}.run-meta-action.primary{border-color:var(--accent);background:var(--accent);color:var(--mem-view-color-on-accent)}.run-meta-action.primary:hover{border-color:var(--mem-view-color-accent-hover);background:var(--mem-view-color-accent-hover);color:var(--mem-view-color-on-accent)}.run-meta-action:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .run-section-title{font-weight:750;margin:18px 0 7px}.run-artifact h3{min-width:0;margin:0 0 7px;font-size:15px;overflow-wrap:anywhere}.run-pre{max-width:100%;padding:11px;border-radius:6px;background:var(--mem-view-color-subtle);white-space:pre-wrap;overflow:auto;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace}.artifact-review-artifact-content{min-width:0;max-width:100%;overflow-wrap:anywhere}.artifact-review-artifact-content table{display:block;max-width:100%;overflow:auto}
  .artifact-review-modal{--surface:var(--mem-view-color-surface);--soft:var(--mem-view-color-subtle);--line:var(--mem-view-color-border);--text:var(--mem-view-color-text);--muted:var(--mem-view-color-text-muted);--accent:var(--mem-view-color-accent);--danger:var(--mem-view-color-danger);color:var(--text);background:var(--surface);font:14px/1.45 ui-sans-serif,system-ui,sans-serif}
  .artifact-review-modal *{box-sizing:border-box}
  .artifact-review-modal{width:100%;max-width:none;height:100%;max-height:none;margin:0;padding:0;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--text);box-shadow:0 24px 80px #191e233d;overflow:hidden}.run-review-loading{display:grid;width:100%;height:100%;min-height:0;place-items:center;border:0;border-radius:10px;background:var(--surface);color:var(--muted);box-shadow:none}.artifact-review-shell{display:grid;grid-template-rows:auto auto auto minmax(0,1fr);height:100%;background:var(--surface)}.artifact-review-head{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line);background:var(--surface)}.artifact-review-head h2{margin:0;font-size:18px}.artifact-review-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 18px;border-bottom:1px solid var(--line);background:var(--surface)}.artifact-review-mobile-tabs{display:none}.artifact-review-body{display:grid;grid-template-columns:minmax(0,var(--artifact-review-left,70%)) 7px minmax(0,1fr);min-height:0;background:var(--surface)}.artifact-review-modal-pane{min-width:0;overflow-x:hidden;overflow-y:auto;padding:18px;overscroll-behavior:contain;background:var(--surface)}#artifact-review-review-pane{background:var(--mem-view-color-subtle)}.artifact-review-divider{background:var(--line);cursor:col-resize}.artifact-review-operation-group{border-top:1px solid var(--line);padding:12px 0}.artifact-review-row{padding:9px 0;border-bottom:1px solid var(--line)}.artifact-review-row-main{display:grid;gap:3px}.artifact-review-comment textarea{width:100%;min-height:90px;padding:10px 11px;border:1px solid var(--mem-view-color-border-strong);border-radius:7px;background:var(--mem-view-color-surface);box-shadow:inset 0 1px 2px #17211f0a}.artifact-review-comment textarea:focus{border-color:var(--accent);outline:2px solid var(--mem-view-color-focus-ring);outline-offset:0}.artifact-review-actions,.artifact-review-vote{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}.artifact-review-submit-area{margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}.artifact-review-vote label{display:inline-flex;gap:5px;align-items:center}.artifact-review-target{position:relative;padding:4px}.inline-plus{position:absolute;right:3px;top:3px}.artifact-review-target-located,.artifact-review-opinion-located{outline:3px solid var(--mem-view-color-warning);outline-offset:2px}.artifact-review-message.warn{color:var(--danger)}
  .artifact-review-heading{min-width:0;display:grid;gap:4px}.artifact-review-heading h2{margin:0}.artifact-review-subtitle{color:var(--muted);font-size:13px;overflow-wrap:anywhere}.artifact-review-material-heading{margin:0 0 10px;font-size:16px}.artifact-review-material-meta{display:grid;gap:6px;margin:0 0 10px}.artifact-review-material-name{font-size:14px;font-weight:500;line-height:1.5}.artifact-review-material-description{color:var(--muted);font-size:12px;line-height:1.5}.artifact-review-material-path{display:block;margin:8px 0;padding:7px 10px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:12px;overflow-wrap:anywhere}.artifact-review-material-time{display:inline-block;margin-bottom:12px;color:var(--muted);font-size:12px}.artifact-review-artifact-frame{padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--mem-view-color-subtle)}
  .artifact-review-card{margin:0 0 34px;padding:14px;border:1px solid var(--line);border-radius:8px;background:var(--surface);box-shadow:0 1px 2px #0000000b}.artifact-review-card>h3{margin:0 0 12px;font-size:16px}.artifact-review-card-label{display:block;margin:10px 0 6px;color:var(--muted);font-size:12px;font-weight:700}.artifact-review-card-line{margin:6px 0;overflow-wrap:anywhere}.artifact-review-card .artifact-review-row:last-child{border-bottom:0}.artifact-review-progress-summary{margin:8px 0 12px;padding:9px 10px;border-radius:7px;background:var(--soft);color:var(--muted);font-size:12px}.artifact-review-participant{padding:12px 0;border-top:1px solid var(--line)}.artifact-review-participant:first-of-type{border-top:0}.artifact-review-participant-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:10px}.artifact-review-participant-head>.artifact-review-row-main{flex:1;min-width:110px}.artifact-review-result-details{padding-top:4px}.artifact-review-participant-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:5px}.artifact-review-opinion{margin-top:9px;padding:10px;border-left:3px solid var(--mem-view-color-border-strong);background:var(--mem-view-color-subtle);white-space:pre-wrap;overflow-wrap:anywhere}.artifact-review-opinion h1,.artifact-review-opinion h2,.artifact-review-opinion h3{font-size:1em}.artifact-review-opinion p:first-child{margin-top:0}.artifact-review-opinion p:last-child{margin-bottom:0}.artifact-review-comment-severity{display:inline-block;margin-right:7px;border-radius:999px;padding:1px 7px;background:var(--mem-view-color-danger-soft);color:var(--danger);font-size:11px}.artifact-review-results-heading{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.artifact-review-results-heading>h3{margin:0;font-size:16px}.artifact-review-result-summary{margin-bottom:12px}.artifact-review-result-summary>p{margin:8px 0 0;font-size:12px;color:var(--muted)}
  .comment-card{display:grid;gap:5px;padding:11px 12px;margin:8px 0;border:1px solid var(--mem-view-color-border-strong);border-left:3px solid var(--accent);border-radius:7px;background:var(--mem-view-color-subtle);box-shadow:0 1px 2px #17211f0a}.comment-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--accent);font-size:12px;font-weight:700}.comment-card-body{white-space:pre-wrap;overflow-wrap:anywhere}.artifact-review-activity{margin-top:9px;padding:9px;background:var(--soft);border-radius:7px}.artifact-review-activity-head,.artifact-review-activity-event-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.artifact-review-activity-log{max-height:240px;overflow:auto}.artifact-review-activity-event{display:grid;gap:4px;padding:8px 0;border-bottom:1px solid var(--line)}.artifact-review-activity-event-title{display:block}
  .artifact-review-field-control{width:100%;min-width:0}.artifact-review-material-select{width:min(100%,520px)}.artifact-review-actor-select{width:min(100%,280px)}.artifact-review-attempt-select{width:min(100%,260px)}.artifact-review-severity-select{width:100%;margin-bottom:7px}
  .artifact-review-vote{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));width:100%}.artifact-review-vote>button{min-width:0}
  #artifact-review-my-panel .artifact-review-actor-select{margin:0 0 16px;font-size:12px;font-weight:400;color:var(--muted)}
  #artifact-review-my-panel .artifact-review-field-control{min-height:34px;font-size:13px;font-weight:400;color:var(--text)}
  .artifact-review-compose-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.artifact-review-compose-head>h4{margin:0;font-size:13px;font-weight:500}.artifact-review-compose-group>.comment-card{margin:0}
  .artifact-review-compose-group{display:grid;gap:10px;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--soft)}
  .artifact-review-compose-group .artifact-review-editor-field{margin:0;gap:6px;font-size:12px;font-weight:400;color:var(--muted)}
  .artifact-review-comment .artifact-review-editor-field textarea{min-height:84px;font-size:13px;font-weight:400;line-height:1.5;resize:vertical}
  .artifact-review-compose-group>.artifact-review-actions{justify-content:flex-end;margin:0}
  .artifact-review-decision-group{display:grid;gap:10px;margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}
  .artifact-review-decision-group>h4{margin:0;font-size:12px;font-weight:500;color:var(--muted)}
  .artifact-review-decision-group>.artifact-review-vote{margin:0;gap:4px}
  .artifact-review-decision-group>.artifact-review-vote>button{min-height:32px;font-size:13px;font-weight:500;padding:0 8px}
  .artifact-review-decision-group>.artifact-review-submit-area{justify-content:flex-end;margin:0;padding:0;border:0}
  #artifact-review-my-panel .artifact-review-editor-button{height:32px;min-height:32px;padding:0 12px;font-size:13px;font-weight:500}
  .artifact-review-attempt-select .artifact-review-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
  .artifact-review-activity-toggle,.artifact-review-result-toggle{flex:0 0 auto}.artifact-review-row>.artifact-review-activity{margin-top:10px}
  .artifact-review-opinion{display:grid;gap:16px;padding:12px;border:1px solid var(--line);border-radius:7px;background:var(--surface);white-space:normal}.artifact-review-opinion-vote{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;background:var(--soft);border-radius:6px;font-size:13px;font-weight:600}.artifact-review-opinion-section{min-width:0}.artifact-review-opinion-section>h4{margin:0 0 8px;font-size:12px;font-weight:600;color:var(--muted)}.artifact-review-opinion-summary{font-size:13px;line-height:1.7;overflow-wrap:anywhere}.artifact-review-opinion-summary>p:first-child{margin-top:0}.artifact-review-opinion-comments{display:grid;gap:8px}.artifact-review-opinion-comments>.comment-card{margin:0}.artifact-review-opinion-empty{margin:0;color:var(--muted);font-size:12px}.artifact-review-opinion .artifact-review-message{margin:0;font-size:12px;color:var(--muted)}
  .artifact-review-artifact-frame{padding:0;border:0;background:transparent}.markdown-body{min-width:0;max-width:100%;margin:8px 0 0;padding:10px 12px;border:1px solid var(--line);border-radius:6px;background:var(--mem-view-color-subtle);line-height:1.55;overflow-wrap:anywhere}.markdown-body>:first-child{margin-top:0}.markdown-body>:last-child{margin-bottom:0}.markdown-body p{margin:6px 0}.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4,.markdown-body h5,.markdown-body h6{margin:12px 0 6px;line-height:1.3;font-weight:800}.markdown-body h1{font-size:21px}.markdown-body h2{font-size:18px}.markdown-body h3{font-size:16px}.markdown-body h4,.markdown-body h5,.markdown-body h6{font-size:14px}.markdown-body ul,.markdown-body ol{margin:6px 0;padding-left:22px}.markdown-body li{margin:3px 0}.markdown-body blockquote{margin:8px 0;padding:2px 12px;border-left:3px solid var(--line);color:var(--muted)}.markdown-body code{border:1px solid var(--line);border-radius:4px;background:var(--mem-view-color-subtle);padding:1px 4px;font:12px ui-monospace,monospace}.markdown-body pre{max-width:100%;margin:8px 0;padding:9px 10px;border:1px solid var(--line);border-radius:6px;background:var(--mem-view-color-subtle);white-space:pre-wrap;overflow:auto}.markdown-body pre code{border:0;background:none;padding:0;white-space:inherit}.markdown-body table{display:table;width:max-content;min-width:100%;border-collapse:collapse;background:var(--mem-view-color-surface)}.markdown-body th,.markdown-body td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}.artifact-review-commentable{display:block;min-width:0;scroll-margin-top:16px}.artifact-review-commentable-body{min-width:0;max-width:100%;overflow-wrap:anywhere}.artifact-review-commentable .inline-plus{position:static;display:inline-flex;vertical-align:middle;width:20px;min-width:20px;max-width:20px;height:20px;min-height:20px;max-height:20px;flex:0 0 20px;margin:0 0 0 6px;border:1px solid var(--line);border-radius:999px;background:var(--mem-view-color-surface);color:var(--muted);padding:0;line-height:1;font-size:12px;opacity:0;transition:opacity 120ms ease}.artifact-review-commentable:hover .inline-plus,.artifact-review-commentable .inline-plus:focus-visible,.artifact-review-commentable .inline-plus[aria-expanded=true]{opacity:1}.artifact-review-commentable .inline-plus:hover{border-color:var(--accent);color:var(--accent)}.artifact-review-commentable>.inline-comment-editor{width:100%;margin-top:4px;padding:10px;border:1px solid var(--mem-view-color-border-strong);border-radius:8px;background:var(--mem-view-color-subtle);box-shadow:0 1px 3px #17211f12}.inline-comment-editor textarea{width:100%;min-height:76px;margin:0;padding:10px 11px;border:1px solid var(--mem-view-color-border-strong);border-radius:7px;background:var(--mem-view-color-surface)}.inline-comment-editor textarea:focus{border-color:var(--accent);outline:2px solid var(--mem-view-color-focus-ring)}.inline-comment-actions{display:flex;gap:7px;margin-top:8px}.comment-card-head>.artifact-review-locate{flex:0 0 auto;width:auto;padding:1px 3px;border:0;background:transparent;color:var(--accent);font-size:12px;font-weight:500;box-shadow:none}.comment-card-head>.artifact-review-locate:hover{text-decoration:underline;text-underline-offset:2px}.artifact-review-target{padding:0}.artifact-review-target-located{background:var(--mem-view-color-accent-soft);box-shadow:0 0 0 3px var(--mem-view-color-focus-ring);outline:0}
  @media(max-width:820px){.run-layout{display:block}.run-sidebar{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}.artifact-review-mobile-tabs{display:flex;gap:5px;padding:8px;border-bottom:1px solid var(--line)}.artifact-review-body{display:block}.artifact-review-divider{display:none}.artifact-review-modal-pane{height:calc(100dvh - 116px)}.artifact-review-modal-pane[hidden]{display:none}}
  .artifact-review-overview{display:grid;gap:16px}.artifact-review-overview>h3{margin:0;font-size:16px;font-weight:600}.artifact-review-overview-object{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.artifact-review-overview-name{min-width:0;font-size:14px;font-weight:500;line-height:1.5;overflow-wrap:anywhere}.artifact-review-status{flex-shrink:0;margin:0;font-size:12px;line-height:1.5;padding:3px 8px}.artifact-review-status[data-status=passed]{color:var(--mem-view-color-accent);background:var(--mem-view-color-accent-soft);border-color:transparent}.artifact-review-overview .artifact-review-round-select{margin:0;display:grid;gap:6px}.artifact-review-overview .artifact-review-round-select label{font-size:12px;font-weight:400;color:var(--muted)}.artifact-review-overview .artifact-review-field-control{font-size:13px;font-weight:400}.artifact-review-overview-facts{display:grid;grid-template-columns:72px minmax(0,1fr);column-gap:12px;row-gap:10px;margin:0;padding-top:14px;border-top:1px solid var(--line);font-size:12px;line-height:1.6}.artifact-review-overview-facts dt{margin:0;font-weight:400;color:var(--muted)}.artifact-review-overview-facts dd{margin:0;font-weight:400;color:var(--text);overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.artifact-review-overview-note{margin:0;color:var(--muted);font-size:12px}
  [data-view-theme-mode="dark"] .run-module .run-meta-action.primary { background:color-mix(in srgb,var(--mem-view-color-accent) 45%,var(--mem-view-color-canvas)); color:var(--mem-view-color-text); }
  [data-view-theme-mode="dark"] .run-module .run-meta-action.primary:hover:not(:disabled) { background:color-mix(in srgb,var(--mem-view-color-accent) 55%,var(--mem-view-color-canvas)); color:var(--mem-view-color-text); }
`;

export default defineViewPlugin<RunConfig>({
  name: "memsphere-run-view",
  apiVersion: 1,
  inject: ["slots", "router", "theme", "ui"],
  themeVersion: 1,
  uiVersion: 1,
  apply(ctx, config) {
    if (!ctx.router || !ctx.ui || !ctx.theme) throw new Error("Run View requires router, theme, and ui services");
    const navigate:Navigate=target=>ctx.router!.navigate(target);
    const routes: RunRoutes = {
      index: ctx.router.register({ id: "index", path: "/tasks", query: ["status"] }),
      detail: ctx.router.register({ id: "detail", path: "/tasks/:runId", query: ["status"] }),
      review: ctx.router.register({ id: "artifact-review", path: "/tasks/:runId/artifact-reviews/:reviewId", query: ["status", "round", "material"] })
    };
    const runDetailCache = new Map<string, Json>();
    const summaries = new RunSummaryRequests();
    ctx.lifecycle.own(() => summaries.dispose());
    const publishSecondary = createRunSecondaryPublisher(ctx, config, routes);
    ctx.slots.register(portableSlots.runArtifactRenderer, {
      id: "run.artifact.official",
      key: "artifact",
      priority: 1000,
      value: { render(input) {
        const fallback = (input as { defaultRender?: () => HTMLElement }).defaultRender;
        if (!fallback) throw new Error("Run Artifact renderer input is invalid");
        return fallback();
      } }
    });
    const renderArtifact = (input: unknown) => ctx.slots.render(portableSlots.runArtifactRenderer, "artifact", input);
    const page = createRunPageMounts(config, routes, navigate, ctx.ui, runDetailCache, publishSecondary, renderArtifact, summaries);
    ctx.lifecycle.own(page.dispose);
    ctx.slots.register(slots.navigationPrimary, {
      id: "run.navigation", order: 200,
      value: { label: { text: tr(config, "run") }, icon: { kind: "system", name: "play-circle" }, route: routes.index.to() }
    });
    registerPage(ctx, routes.index, "run.index", config, page);
    registerPage(ctx, routes.detail, "run.detail", config, page);
    registerRunSecondary(ctx, config, routes, routes.index, normalizedRunStatus(ctx.router.location.query.status));
    registerRunSecondary(ctx, config, routes, routes.detail, normalizedRunStatus(ctx.router.location.query.status));
    ctx.slots.register(slots.searchProviders, {
      id: "run.search",
      order: 200,
      value: {
        label: { text: tr(config, "run") },
        icon: { kind: "system", name: "play-circle" },
        async search({ query, signal }) {
          const groups = await Promise.all(["running", "done", "abandoned", "archived"].map(async status => {
            const payload = await summaries.read(projectApiUrl(config, `/api/runs?${new URLSearchParams({ representation: "summary", ...(status === "archived" ? { archived: "true" } : { status }) })}`), signal);
            return (payload.runs as Json[] | undefined) ?? [];
          }));
          const needle = query.trim().toLowerCase();
          return groups.flat().filter(run => !needle || `${run.name ?? ""} ${run.id ?? ""}`.toLowerCase().includes(needle)).slice(0, 30).map(run => ({
            title: { text: displayName(run) },
            summary: { text: `${tr(config, String(run.status ?? "running"))} · ${shortId(String(run.id))}` },
            type: { text: tr(config, "run") },
            icon: { kind: "system" as const, name: "play-circle" },
            route: routes.detail.to({ runId: String(run.id) }, { query: { status: String(run.status ?? "running") } })
          }));
        }
      }
    });
    ctx.slots.register(slots.overlay, {
      id: "run.review",
      key: routes.review.key,
      when: routes.review.activation,
      value: {
        label: { text: tr(config, "review") },
        presentation: "dialog",
        background: ctx.router.project({ from: routes.review, to: routes.detail, params: { runId: "runId" }, query: { status: "status" }, hash: "discard" }),
        mount: createMount(config, routes, navigate, ctx.ui, runDetailCache, true, renderArtifact, summaries)
      }
    });
    startRunHome(ctx, config, routes, summaries);
  }
});

function startRunHome(ctx: ViewPluginContext, config: Readonly<RunConfig>, routes: RunRoutes, summaries: RunSummaryRequests): void {
  const leases = new Map<string, Disposer>();
  let controller = new AbortController();
  let disposed = false;
  let refreshing: Promise<void> | undefined;
  const replace = (key: string, create: () => Disposer) => {
    const previous = leases.get(key);
    const next = create();
    leases.set(key, next);
    void previous?.();
  };
  const withdrawMissing = (prefix: string, keep: ReadonlySet<string>) => {
    for (const [key, dispose] of [...leases]) {
      if (!key.startsWith(prefix) || keep.has(key)) continue;
      leases.delete(key); void dispose();
    }
  };
  const refresh = async () => {
    controller.abort(); controller = new AbortController();
    try {
      const payload = await summaries.read(projectApiUrl(config, "/api/runs?representation=summary&status=running"), controller.signal) as { runs?: Json[] };
      const attentionKeep = new Set<string>();
      const continueKeep = new Set<string>();
      for (const run of (payload.runs ?? []).filter(item => !item.archived && !item.readOnly).slice(0, 10)) {
        const progress = run.reviewProgress as Json | undefined;
        if (progress?.id && progress?.currentRoundId && !["approved", "completed", "cancelled"].includes(String(progress.status ?? ""))) {
          const key = `attention:${run.id}:${progress.id}`; attentionKeep.add(key);
          const target = routes.review.to({ runId: String(run.id), reviewId: String(progress.id) });
          replace(key, () => ctx.slots.upsert(slots.homeAttention, {
            id: `run.review.${progress.id}`, order: 200,
            value: {
              title: { text: String(run.name ?? run.id) },
              summary: { text: `${tr(config, "reviewProgress")} ${progress.submitted ?? 0}/${progress.total ?? 0}` },
              icon: { kind: "system", name: "file-text" },
              source: { text: tr(config, "review") }, status: "warning", updatedAt: String(progress.updatedAt ?? run.updatedAt ?? ""),
              action: { label: { text: tr(config, "review") }, run: () => ctx.router!.navigate(target) }
            }
          }));
        } else if (run.status === "running") {
          const key = `continue:${run.id}`; continueKeep.add(key);
          const target = routes.detail.to({ runId: String(run.id) });
          replace(key, () => ctx.slots.upsert(slots.homeContinue, {
            id: `run.${run.id}`, order: 200,
            value: {
              title: { text: String(run.name ?? run.id) },
              summary: { text: tr(config, "running") }, icon: { kind: "system", name: "play-circle" }, updatedAt: String(run.updatedAt ?? ""), route: target
            }
          }));
        }
      }
      withdrawMissing("attention:", attentionKeep);
      withdrawMissing("continue:", continueKeep);
      const failed = leases.get("attention:error"); if (failed) { leases.delete("attention:error"); void failed(); }
    } catch (error) {
      if (controller.signal.aborted || ctx.lifecycle.disposed) return;
      replace("attention:error", () => ctx.slots.upsert(slots.homeAttention, {
        id: "run.home.error", order: 290,
        value: {
          title: { text: tr(config, "loadFailed") },
          summary: { text: error instanceof Error ? error.message : String(error) }, status: "error",
          icon: { kind: "system", name: "warning-circle" },
          action: { label: { text: tr(config, "retry") }, run: refresh }
        }
      }));
    }
  };
  const task = refresh().finally(() => {
    if (refreshing === task) refreshing = undefined;
  });
  refreshing = task;
  ctx.lifecycle.own(async () => {
    disposed = true;
    controller.abort();
    if (refreshing) await Promise.allSettled([refreshing]);
    await Promise.allSettled([...leases.values()].map(dispose => dispose())); leases.clear();
  });
}

type RunPageMounts = Readonly<{
  list: RefreshableViewMount;
  detail: RefreshableViewMount;
  refresh(): Promise<void>;
  dispose(): Promise<void>;
}>;

function registerPage(ctx: ViewPluginContext, route: RouteToken, id: string, config: Readonly<RunConfig>, page: RunPageMounts): void {
  ctx.slots.register(slots.headerTitle, {
    id: `${id}.header`, when: route.activation, value: { title: { text: tr(config, id === "run.review" ? "review" : "run") } }
  });
  ctx.slots.register(slots.mainView, {
    id, key: route.key, when: route.activation, value: page.detail
  });
  ctx.slots.register(portableSlots.runPagePresentation, {
    id: `${id}.presentation`, key: "page", priority: 1000, when: route.activation, value: page.detail
  });
  ctx.slots.register(slots.contentList, {
    id: `${id}.list`, when: route.activation, value: page.list
  });
  ctx.slots.register(slots.headerActions, {
    id: `${id}.refresh`, order: 100, when: route.activation,
    value: { label: { text: tr(config, "refresh") }, run: () => page.refresh() }
  });
}

function registerRunSecondary(
  ctx: ViewPluginContext,
  config: Readonly<RunConfig>,
  routes: RunRoutes,
  route: RouteToken,
  selectedStatus: string
): void {
  const statusTarget = (status: string) => routes.index.to(undefined, { query: status === "running" ? {} : { status } });
  ctx.slots.register(slots.navigationSecondary, {
    id: `run.secondary.${route.key}`,
    when: route.activation,
    value: {
      title: { text: tr(config, "run") },
      icon: { kind: "system", name: "play-circle" },
      items: ["running", "done", "abandoned", "archived"].map(status => ({
        id: status,
        label: { text: tr(config, status) },
        icon: { kind: "system" as const, name: status === "running" ? "play-circle" : status === "done" ? "check-circle" : "archive" },
        selected: selectedStatus === status,
        route: statusTarget(status)
      }))
    }
  });
}

type PublishedRunHeaderAction = Readonly<{
  id: string;
  order: number;
  stateKey: string;
  value: HeaderActionDescriptor;
}>;

function createRunSecondaryPublisher(ctx: ViewPluginContext, config: Readonly<RunConfig>, routes: RunRoutes): (
  location: RouteLocation,
  badges?: Readonly<Record<string, number>>,
  heading?: HeaderTitleDescriptor,
  actions?: readonly PublishedRunHeaderAction[]
) => void {
  let lastKey = "";
  let dispose: Disposer | undefined;
  let titleDispose: Disposer | undefined;
  const actionLeases = new Map<string, { stateKey: string; dispose: Disposer }>();
  ctx.lifecycle.own(() => {
    for (const lease of actionLeases.values()) void lease.dispose();
    actionLeases.clear();
  });
  return (location, badges = {}, heading, actions = []) => {
    const selectedStatus = normalizedRunStatus(location.query.status);
    const route = location.routeKey?.endsWith(":detail") || location.pathname.includes("/artifact-reviews/") ? routes.detail : routes.index;
    const key = `${route.key}:${selectedStatus}:${JSON.stringify(badges)}:${JSON.stringify(heading ?? {})}:${actions.map(action => `${action.id}:${action.stateKey}`).join("|")}`;
    if (key === lastKey) return;
    lastKey = key;
    const statusTarget = (status: string) => routes.index.to(undefined, { query: status === "running" ? {} : { status } });
    const previous = dispose;
    dispose = ctx.slots.upsert(slots.navigationSecondary, {
      id: `run.secondary.${route.key}`,
      when: route.activation,
      value: {
        title: { text: tr(config, "run") },
        icon: { kind: "system", name: "play-circle" },
        items: ["running", "done", "abandoned", "archived"].map(status => ({
          id: status,
          label: { text: tr(config, status) },
          icon: { kind: "system" as const, name: status === "running" ? "play-circle" : status === "done" ? "check-circle" : "archive" },
          badge: badges[status] ? { text: String(badges[status]) } : undefined,
          selected: selectedStatus === status,
          route: statusTarget(status)
        }))
      }
    });
    void previous?.();
    const previousTitle = titleDispose;
    titleDispose = ctx.slots.upsert(slots.headerTitle, {
      id: `${route === routes.detail ? "run.detail" : "run.index"}.header`,
      when: route.activation,
      value: heading ?? { title: { text: tr(config, "run") } }
    });
    void previousTitle?.();
    const keep = new Set(route === routes.detail ? actions.map(action => action.id) : []);
    for (const [id, lease] of [...actionLeases]) {
      if (keep.has(id)) continue;
      actionLeases.delete(id);
      void lease.dispose();
    }
    if (route !== routes.detail) return;
    for (const action of actions) {
      const previousAction = actionLeases.get(action.id);
      if (previousAction?.stateKey === action.stateKey) continue;
      const actionDispose = ctx.slots.upsert(slots.headerActions, {
        id: `run.detail.${action.id}`,
        order: action.order,
        when: routes.detail.activation,
        value: action.value
      });
      actionLeases.set(action.id, { stateKey: action.stateKey, dispose: actionDispose });
      void previousAction?.dispose();
    }
  };
}

function createRunPageMounts(
  config: Readonly<RunConfig>,
  routes: RunRoutes,
  navigate: Navigate,
  ui: ViewUi,
  runDetailCache: Map<string, Json>,
  publishSecondary: (
    location: RouteLocation,
    badges?: Readonly<Record<string, number>>,
    heading?: HeaderTitleDescriptor,
    actions?: readonly PublishedRunHeaderAction[]
  ) => void,
  renderArtifact: (input: unknown) => HTMLElement,
  summaries: RunSummaryRequests
): RunPageMounts {
  const controller = new AbortController();
  let scratch: HTMLElement | undefined;
  let portal: HTMLElement | undefined;
  let app: RunApplication | undefined;
  let start: Promise<void> | undefined;
  let routeKey = "";
  let update: Promise<void> | undefined;
  let listContext: ViewRenderContext | undefined;
  const listMount = ui.contentList(() => app!.contentListDescriptor());
  const refreshList = () => {
    if (listContext) void listMount.update?.(listContext);
  };
  const publish = (route: RouteLocation) => publishSecondary(
    route.query.status ? route : Object.freeze({ ...route, query: Object.freeze({ ...route.query, status: app!.status }) }),
    app!.secondaryBadges(),
    app!.headerTitle(),
    app!.headerActions()
  );
  const ensure = (route: RouteLocation) => {
    scratch ??= document.createElement("div");
    portal ??= document.createElement("div");
    if (!app) {
      app = new RunApplication(scratch, portal, config, routes, route, controller, navigate, ui, runDetailCache, false, refreshList, renderArtifact, summaries);
      routeKey = `${route.pathname}${route.search}${route.hash}:${Boolean(route.projected)}`;
    }
    start ??= app.start();
    return start;
  };
  const updateRoute = async (route: RouteLocation) => {
    await ensure(route);
    const key = `${route.pathname}${route.search}${route.hash}:${Boolean(route.projected)}`;
    if (key === routeKey) {
      await update;
      publish(route);
      return;
    }
    routeKey = key;
    const task = app!.updateRoute(route).finally(() => { if (update === task) update = undefined; });
    update = task;
    await task;
    if (key !== routeKey) return;
    publish(route);
  };
  const makeMount = (surface: "list" | "detail"): RefreshableViewMount => ({
    async mount({ element, portal: mountPortal }, context) {
      element.classList.add("run-module", `run-${surface}-surface`);
      if (surface === "list") {
        await ensure(context.route);
        app!.setRenderContext(context);
        listContext = context;
        const dispose = await listMount.mount({ element, portal: mountPortal }, context);
        await updateRoute(context.route);
        await listMount.update?.(context);
        return async () => {
          if (listContext === context) listContext = undefined;
          await dispose?.();
          element.classList.remove("run-module", "run-list-surface");
          element.replaceChildren();
        };
      }
      const style = document.createElement("style");
      style.textContent = styles + runDetailStyles + contentFlowStyles + defaultContentStyles + pageLayoutStyles;
      element.append(style);
      await ensure(context.route);
      app!.setRenderContext(context);
      app!.attachDetail(element);
      await updateRoute(context.route);
      return () => {
        app?.detachDetail(element);
        element.classList.remove("run-module", `run-${surface}-surface`);
        element.replaceChildren();
      };
    },
    async update(context) {
      if (surface === "list") listContext = context;
      app?.setRenderContext(context);
      await updateRoute(context.route);
      if (surface === "list") await listMount.update?.(context);
    },
    refresh: async () => {
      await app?.refresh();
      refreshList();
      if (app) publish(app.location);
    }
  });
  const list = makeMount("list");
  const detail = makeMount("detail");
  return {
    list,
    detail,
    refresh: async () => {
      await app?.refresh();
      if (app) publish(app.location);
    },
    dispose: async () => {
      controller.abort();
      listContext = undefined;
      await app?.dispose();
      app = undefined;
    }
  };
}

function createMount(config: Readonly<RunConfig>, routes: RunRoutes,navigate:Navigate, ui: ViewUi, runDetailCache: Map<string, Json>, reviewOnly = false, renderArtifact: (input: unknown) => HTMLElement = input => (input as { defaultRender: () => HTMLElement }).defaultRender(), summaries?: RunSummaryRequests): RefreshableViewMount {
  let app: RunApplication | undefined;
  return {
    async mount({ element, portal }, context) {
      const controller = new AbortController();
      element.classList.add("run-module");
      const style = document.createElement("style"); style.textContent = styles + runDetailStyles + contentFlowStyles + defaultContentStyles + pageLayoutStyles; element.append(style);
      app = new RunApplication(element, portal, config, routes, context.route, controller,navigate,ui,runDetailCache,reviewOnly, () => undefined, renderArtifact, summaries);
      app.setRenderContext(context);
      await app.start();
      return async () => { controller.abort(); await app?.dispose(); app = undefined; element.classList.remove("run-module"); element.replaceChildren(); portal.replaceChildren(); };
    },
    async update(context) {
      app?.setRenderContext(context);
      await app?.updateRoute(context.route);
    },
    async refresh() {
      await app?.refresh();
    }
  };
}

class RunApplication {
  readonly #createdAt=Date.now();
  readonly #reviewSession: ArtifactReviewSession;
  #inlineReview?: {key:string;session:ArtifactReviewSession;content:HTMLElement;panel:HTMLElement;timer:number};
  #disposeInlineReview(){if(this.#inlineReview){window.clearInterval(this.#inlineReview.timer);this.#inlineReview.session.dispose();this.#inlineReview=undefined;}}
  async #mountInlineReview(runId:string,reviewId:string,roundId:string,container:HTMLElement,content:HTMLElement,panel:HTMLElement){
    const key=JSON.stringify([runId,reviewId,roundId]);
    if(this.#inlineReview?.key===key){content.append(this.#inlineReview.content);panel.append(this.#inlineReview.panel);this.#inlineReview.session.inline!.container=container;return;}
    this.#disposeInlineReview();
    const body=document.createElement("div"),right=document.createElement("div");right.textContent=tr(this.#config,"loading");content.append(body);panel.append(right);
    const controller=new AbortController();
    const session=new ArtifactReviewSession({config:this.#config,ui:this.#ui,controller,root:container,detail:()=>({id:runId}),route:()=>this.#route,request:async path=>{const response=await fetch(projectApiUrl(this.#config,path),{signal:controller.signal});if(!response.ok)throw new Error(await response.text());return response.json();}});
    session.inline={container,content:body,panel:right};session.reviewRoundId=roundId;
    let busy=false, rendered="";
    const refresh=async()=>{if(busy||controller.signal.aborted||right.closest<HTMLElement>(".cc-pane-review")?.hidden)return;if(session.reviewContext&&(session.reviewRoundId!==session.reviewContext.review.currentRoundId||["passed","cancelled","awaiting_revision"].includes(session.reviewContext.review.status)))return;busy=true;try{await session.reloadReview(runId,reviewId);if(controller.signal.aborted)return;const next=JSON.stringify(session.reviewContext);if(rendered!==next&&!container.querySelector(".inline-comment-editor")&&!container.querySelector("textarea:focus")){session.renderReview(runId,reviewId);rendered=next;}await session.pollActivities();}catch(error){if(!controller.signal.aborted){const message=document.createElement("p");message.textContent=error instanceof Error?error.message:String(error);right.querySelector(".artifact-review-load-error")?.remove();const feedback=document.createElement("div");feedback.className="artifact-review-load-error";feedback.append(message);right.append(feedback);const retry=this.#ui.button({label:{text:tr(this.#config,"retry")},run:refresh});right.querySelector(".artifact-review-load-error")!.append(retry);}}finally{busy=false;}};
    container.addEventListener("cc-review-visible",()=>void refresh(),{signal:controller.signal});
    this.#inlineReview={key,session,content:body,panel:right,timer:window.setInterval(()=>void refresh(),4000)};await refresh();
  }
  readonly #root: HTMLElement; readonly #portal: HTMLElement; readonly #config: Readonly<RunConfig>;
  #detailRoot: HTMLElement | null = null;
  #contextGraph: ReturnType<typeof createContextGraph> | undefined;
  #contextGraphRun = "";
  readonly #routes: RunRoutes; #route: RouteLocation; readonly #controller: AbortController;readonly #navigate:Navigate;
  readonly #ui: ViewUi;
  readonly #onListChange: () => void;
  readonly #renderArtifact: (input: unknown) => HTMLElement;
  readonly #summaries: RunSummaryRequests | undefined;
  #loadGeneration = 0;
  #runs: Json[] = []; #detail: Json | null = null; #status = "running"; #poll = 0; #busy = false;
  #detailError = ""; #detailErrorRunId = "";
  readonly #reviewOnly:boolean;
  readonly #runDetailCache: Map<string, Json>;
  #disclosures = new DisclosureState();
  #runDetailState = createRunDetailState();
  #polling: Promise<void> | undefined;
  #disposed = false;
  #runListVersion = "";
  #lastLoadChanged = true;
  #renderContext: ViewRenderContext | undefined;
  constructor(root: HTMLElement, portal: HTMLElement, config: Readonly<RunConfig>, routes: RunRoutes, route: RouteLocation, controller: AbortController,navigate:Navigate,ui:ViewUi,runDetailCache:Map<string,Json>,reviewOnly=false,onListChange:()=>void=()=>undefined,renderArtifact:(input:unknown)=>HTMLElement=input=>(input as {defaultRender:()=>HTMLElement}).defaultRender(), summaries?: RunSummaryRequests) {
    this.#root=root; this.#portal=portal; this.#config=config; this.#routes=routes; this.#route=route; this.#controller=controller;this.#navigate=navigate;this.#ui=ui;this.#runDetailCache=runDetailCache;this.#reviewOnly=reviewOnly;this.#onListChange=onListChange;this.#renderArtifact=renderArtifact;
    this.#reviewSession=new ArtifactReviewSession({config,ui,controller,root,request:path=>this.#request(path),detail:()=>this.#detail,route:()=>this.#route});
    this.#status = normalizedRunStatus(route.query.status);
    this.#summaries = summaries;
  }
  get status(): string { return this.#status; }
  get location(): RouteLocation { return this.#route; }
  setRenderContext(context: ViewRenderContext): void { this.#renderContext = context; }
  secondaryBadges(): Readonly<Record<string, number>> {
    if(this.#listCursor)return {};
    return Object.fromEntries(["running", "done", "abandoned", "archived"].map(status => [status, this.#runs.filter(run => status === "archived" ? run.archived : !run.archived && run.status === status).length]));
  }
  headerTitle(): HeaderTitleDescriptor {
    if (!this.#detail) return { title: { text: tr(this.#config,"run") } };
    return {
      title: { text: displayName(this.#detail) },
      subtitle: { text: this.#detail.representation === "context-control" ? tr(this.#config, String(this.#detail.status)) : `${tr(this.#config, String(this.#detail.status ?? "running"))} · ${String(this.#detail.id ?? "")}` },
      breadcrumbs: [{ label: { text: tr(this.#config,"run") }, route: this.#routes.index.to(undefined, { query: this.#status === "running" ? {} : { status: this.#status } }) }]
    };
  }
  headerActions(): readonly PublishedRunHeaderAction[] {
    const run = this.#detail;
    if (!run || this.#route.routeKey?.endsWith("artifact-review")) return [];
    if (run.representation === "context-control") {
      const action = (id: string, runAction: () => Promise<void>): PublishedRunHeaderAction => ({ id, order: 200, stateKey: `${id}:${run.id}:${run.status}:${run.archived}`, value: { label: { text: tr(this.#config, id) }, run: runAction } });
      if (run.archived) return [action("restore", () => this.#restore(run))];
      return run.status === "running" ? [action("finish", () => this.#finish(run)), action("abandon", () => this.#abandon(run))] : [action("archive", () => this.#archive(run))];
    }
    const actions: PublishedRunHeaderAction[] = [];
    if (run.archived) return [{ id: "restore", order: 200, stateKey: `restore:${run.id}`, value: { label: { text: tr(this.#config, "restore") }, run: () => this.#restore(run) } }];
    if (run.readOnly) return [];
    if (currentRunStep(run)) {
      actions.push({
        id: "jump-current",
        order: 200,
        stateKey: `jump:${String(run.id)}`,
        value: {
          label: { text: tr(this.#config, "jumpCurrent") },
          run: () => this.#detailRoot?.querySelector<HTMLElement>('[data-current-task-step="true"]')?.scrollIntoView({ block: "center", behavior: "smooth" })
        }
      });
    }
    const review = run.artifactReview || run.artifactReviewSummaries?.find((item: Json) => item.status !== "passed");
    if (review?.id) {
      actions.push({
        id: "review",
        order: 300,
        stateKey: `review:${String(run.id)}:${String(review.id)}:${review.round?.submitted ?? 0}:${review.round?.total ?? 0}`,
        value: {
          label: { text: `${tr(this.#config, "review")} ${review.round?.submitted ?? 0}/${review.round?.total ?? 0}` },
          run: () => this.#openReview(String(run.id), String(review.id))
        }
      });
    }
    return actions;
  }
  async start(): Promise<void> {
    this.#renderLoading();
    const runId = this.#route.params.runId;
    if (this.#reviewOnly && runId) await this.#loadReviewRun(runId);
    else if(!this.#route.projected)await this.#load(runId, { adoptStatus: true });
    if(!this.#reviewOnly){this.#render();if(!this.#route.projected)void this.#loadSummaries(true);}
    if (this.#route.routeKey?.endsWith("artifact-review") && runId && this.#route.params.reviewId) {
      await this.#openReview(runId, this.#route.params.reviewId);
    }
    if (this.#reviewOnly) this.#poll = window.setInterval(() => this.#scheduleActivityPoll(), 4000);
  }
  attachDetail(root: HTMLElement): void { this.#detailRoot = root; this.#render(); }
  detachDetail(root: HTMLElement): void { if (this.#detailRoot === root) this.#detailRoot = null; }
  async #loadReviewRun(runId:string):Promise<void>{this.#detail=this.#runDetailCache.get(runId)??{id:runId};}
  async updateRoute(route: RouteLocation): Promise<void> {
    const previousStatus = this.#status;
    this.#route = route;
    if (this.#reviewOnly) return;
    if(route.projected){if(this.#detail?.id!==route.params.runId)this.#detail=null;this.#render();return;}
    this.#status = normalizedRunStatus(route.query.status);
    const runId = route.params.runId;
    if (previousStatus !== this.#status) {
      this.#detail = null;
      this.#detailError = "";
      this.#detailErrorRunId = "";
      await this.#load(runId);
      void this.#loadSummaries();
      this.#render();
      return;
    }
    if (!runId) {
      this.#detail = null;
      this.#render();
      return;
    }
    const summary = this.#runs.find(run => run.id === runId);
    if (summary?.status) this.#status = summary.archived ? "archived" : summary.status;
    if (this.#detail?.id !== runId || this.#detailErrorRunId === runId) {
      try {
        const payload = await this.#request(`/api/runs/${encodeURIComponent(runId)}?representation=overview`);
        if (this.#route !== route || this.#controller.signal.aborted) return;
        this.#detail = this.#rememberRun(payload.run);
        this.#detailError = "";
        this.#detailErrorRunId = "";
      } catch (error) {
        if (this.#route !== route || this.#controller.signal.aborted) return;
        this.#detail = null;
        this.#detailError = error instanceof Error ? error.message : String(error);
        this.#detailErrorRunId = runId;
      }
    }
    this.#render();
  }
  #scheduleActivityPoll(): void {
    if (this.#disposed || this.#busy || this.#polling || !this.#reviewSession.reviewContext) return;
    const task = this.#reviewSession.pollActivities().finally(() => {
      if (this.#polling === task) this.#polling = undefined;
    });
    this.#polling = task;
  }
  async dispose(): Promise<void> {
    this.#disposed = true;
    if (this.#poll) window.clearInterval(this.#poll);
    this.#controller.abort();
    if (this.#polling) await Promise.allSettled([this.#polling]);
    this.#reviewSession.reviewMediaCleanup?.();
    this.#reviewSession.reviewDialog?.remove();
    this.#contextGraph?.dispose();
    this.#disposeInlineReview();
  }
  async refresh(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try { await this.#refresh(); }
    finally { this.#busy = false; }
  }
  async #request(path: string, init?: RequestInit): Promise<any> {
    if (!init?.method && path.startsWith("/api/runs?") && new URLSearchParams(path.split("?")[1]).get("representation") === "summary" && this.#summaries) {
      return this.#summaries.read(projectApiUrl(this.#config, path), this.#controller.signal);
    }
    const response = await fetch(projectApiUrl(this.#config, path), { ...init, signal: this.#controller.signal });
    if (!response.ok) throw new Error((await response.text()) || `${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  #listCursor="";#listLoading=false;
  async #loadSummaries(initial=false,more=false):Promise<void>{
    const status=this.#status;this.#listLoading=true;this.#onListChange();
    try{const query=new URLSearchParams({representation:"summary",...(status==="archived"?{archived:"true"}:{status})});
      const path=`/api/runs?${query}`,cached=initial?await this.#summaries?.peek(projectApiUrl(this.#config,path),this.#createdAt):undefined;
      query.set("limit","30");if(more&&this.#listCursor)query.set("cursor",this.#listCursor);
      const payload=cached??await this.#request(`/api/runs?${query}`);
      if(this.#controller.signal.aborted||status!==this.#status)return;
      const rows=payload.runs??[],page=rows.slice(0,30);
      this.#runs=more?[...new Map([...this.#runs,...page].map((r:Json)=>[r.id,r])).values()]:page;
      this.#listCursor=payload.nextCursor??(rows.length>30?page.at(-1)?.id:"");
    }catch(error){if(!this.#controller.signal.aborted)console.error("Unable to load Run list",error);}
    finally{if(status===this.#status){this.#listLoading=false;this.#onListChange();}}
  }
  async #load(runId?:string,options:{adoptStatus?:boolean;replaceMoved?:boolean}={}):Promise<string|undefined>{
    const generation=++this.#loadGeneration,route=this.#route;
    if(!runId){this.#detail=null;this.#lastLoadChanged=true;return undefined;}
    try{
      const payload=await this.#request(`/api/runs/${encodeURIComponent(runId)}?representation=overview`);
      if(generation!==this.#loadGeneration||route!==this.#route||this.#controller.signal.aborted)return undefined;
      if(options.replaceMoved&&(payload.run.status!==this.#status||Boolean(payload.run.archived)!==(this.#status==="archived"))&&!(this.#detail?.id===runId&&this.#detail?.archived)){this.#detail=null;this.#lastLoadChanged=true;return undefined;}
      this.#detail=this.#rememberRun(payload.run);this.#detailError="";this.#detailErrorRunId="";this.#lastLoadChanged=true;
      if(options.adoptStatus&&payload.run.status)this.#status=payload.run.archived&&(!this.#route.projected||this.#status==="archived")?"archived":payload.run.status;
    }catch(error){if(generation!==this.#loadGeneration)return undefined;this.#detail=null;this.#detailError=error instanceof Error?error.message:String(error);this.#detailErrorRunId=runId;}
    return runId;
  }
  async #refresh(awaitNavigation = true): Promise<void> {
    try {
      const route = this.#route;
      const selected = this.#reviewOnly ? this.#route.params.runId : this.#detail?.id;
      const replacement = await this.#load(selected, { replaceMoved: !this.#reviewSession.reviewContext });
      void this.#loadSummaries();
      if (route !== this.#route || this.#controller.signal.aborted) return;
      if(!this.#reviewOnly&&this.#lastLoadChanged)this.#render();
      if (replacement !== selected) {
        if (this.#route.projected) return;
        this.#reviewSession.reviewDialog?.remove();
        this.#reviewSession.reviewContext = null;
        const navigation = this.#navigate(replacement ? this.#routes.detail.to({ runId: replacement }) : this.#routes.index.to());
        if (awaitNavigation) await navigation;
        else void navigation.catch(error => {
          if (!this.#controller.signal.aborted) console.error("Unable to navigate after Run refresh", error);
        });
      } else if (this.#reviewSession.reviewContext && replacement) {
        await this.#reviewSession.reloadReview(replacement);
        if (!this.#controller.signal.aborted) this.#reviewSession.renderReview(replacement, this.#reviewSession.reviewContext.review.id);
      }
    } catch (error) { if (!this.#controller.signal.aborted) console.error("Unable to refresh Runs", error); }
  }
  #rememberRun(run: Json | null | undefined): Json | null {
    if (run?.id) this.#runDetailCache.set(String(run.id), run);
    return run ?? null;
  }
  #renderLoading(): void { const box=document.createElement("div"); box.className=`run-panel run-loading${this.#reviewOnly?" run-review-loading":""}`; box.textContent=tr(this.#config,"loading"); this.#root.append(box); }
  #render(): void {
    this.#disclosures.capture();
    this.#root.querySelector(":scope > .run-loading")?.remove();
    this.#root.querySelector(".run-layout")?.remove();
    this.#onListChange();
    if (!this.#detailRoot) return;
    if (this.#detail?.representation === "context-control") {
      if (!this.#contextGraph || this.#contextGraphRun !== this.#detail.id) {
        this.#contextGraph?.dispose();
    this.#disposeInlineReview();
        this.#contextGraph = createContextGraph(this.#ui, path => this.#request(path), this.#config.locale, this.#config.projectApiBase, (runId, reviewId, roundId) => this.#openReview(runId, reviewId, roundId), (runId,reviewId,roundId,container,content,panel)=>this.#mountInlineReview(runId,reviewId,roundId,container,content,panel), ()=>this.#disposeInlineReview());
        this.#contextGraphRun = this.#detail.id;
      }
      if (!this.#detailRoot.contains(this.#contextGraph.element)) {
        for (const child of [...this.#detailRoot.children]) if (child.tagName !== "STYLE") child.remove();
        const main = createPageLayout("run-workspace"); main.style.setProperty("--mem-page-layout-inset", "0px"); main.append(this.#contextGraph.element); this.#detailRoot.append(main);
      }
      this.#contextGraph.update(this.#detail.context);
      return;
    }
    this.#contextGraph?.dispose();
    this.#disposeInlineReview(); this.#contextGraph = undefined; this.#contextGraphRun = "";
    for (const child of [...this.#detailRoot.children]) if (child.tagName !== "STYLE") child.remove();
    const main=createPageLayout("run-workspace"); main.append(this.#renderDetail());
    this.#detailRoot.append(main);
  }
  async #selectStatus(status:string):Promise<void>{
    if(this.#status===status)return;
    await this.#navigate(this.#routes.index.to(undefined, { query: status === "running" ? {} : { status } }));
  }
  #visible(): Json[] { return this.#runs.filter(run=>(this.#status === "archived" ? run.archived : !run.archived && run.status === this.#status)); }
  contentListDescriptor(): ContentListDescriptor {
    const runs = this.#visible();
    return {
      label: { text: `${tr(this.#config, "run")} · ${tr(this.#config, this.#status)}` },
      header: {
        eyebrow: { text: tr(this.#config, "run") },
        title: { text: tr(this.#config, this.#status) },
        action: {
          label: { text: this.#config.locale?.startsWith("en") ? "Refresh list" : "刷新列表" },
          icon: { kind: "system", name: "arrows-clockwise" },
          run: () => this.#loadSummaries()
        }
      },
      ...(this.#listLoading&&!runs.length?{state:"loading" as const}:{empty:{title:{text:tr(this.#config,"empty")}}}),
      sections: [{
        id: this.#status,
        items: runs.map(run => {
          const id = String(run.id);
          const destructive = run.status === "running";
          const review = run.reviewProgress as Json | undefined;
          return {
            id,
            title: { text: displayName(run) },
            meta: { text: typeof run.eventCount === "number" && Number.isFinite(run.eventCount) ? `${shortId(id)} · ${run.eventCount}` : shortId(id) },
            description: review?.id ? { text: `${tr(this.#config, "reviewProgress")} ${review.submitted ?? 0}/${review.total ?? 0}` } : undefined,
            icon: { kind: "system" as const, name: run.status === "running" ? "play-circle" : run.status === "done" ? "check-circle" : "archive" },
            selected: id === this.#detail?.id,
            route: this.#routes.detail.to({ runId: id }, { query: this.#status === "running" ? {} : { status: this.#status } }),
            trailingActions: run.readOnly ? undefined : [{
              label: { text: tr(this.#config, destructive ? "abandon" : "archive") },
              icon: { kind: "system" as const, name: "archive" },
              run: () => destructive ? this.#abandon(run) : this.#archive(run)
            }]
          };
        }).concat(this.#listCursor?[{id:"run-list-more",title:{text:this.#config.locale?.startsWith("en")?"Load more":"加载更多"},action:{label:{text:this.#config.locale?.startsWith("en")?"Load more":"加载更多"},run:()=>this.#loadSummaries(false,true)}} as any]:[])
      }]
    };
  }
  async #select(id:string):Promise<void>{
    this.#busy=true;
    try {
      if (this.#route.params.runId !== id) {
        await this.#navigate(this.#routes.detail.to({runId:id}, { query: this.#status === "running" ? {} : { status: this.#status } }));
        return;
      }
      try{const payload=await this.#request(`/api/runs/${encodeURIComponent(id)}`);this.#detail=this.#rememberRun(payload.run);this.#detailError="";this.#detailErrorRunId="";}
      catch(error){this.#detail=null;this.#detailError=error instanceof Error?error.message:String(error);this.#detailErrorRunId=id;}
      this.#render();
    } finally { this.#busy=false; }
  }
  #renderDetail(): HTMLElement {
    const wrap=document.createElement("div"); const run=this.#detail;
    if(!run){const feedback=this.#ui.feedback(this.#detailError?{state:"error",title:{text:this.#detailError},icon:{kind:"system",name:"warning-circle"},action:this.#detailErrorRunId?{label:{text:tr(this.#config,"retry")},run:()=>this.#select(this.#detailErrorRunId)}:undefined}:{state:"empty",title:{text:tr(this.#config,"choose")}});feedback.classList.add(this.#detailError?"run-error":"run-panel");wrap.append(feedback);return wrap;}
    if (!this.#renderContext) return wrap;
    const detail = renderRunDetail(run, {
      locale: this.#config.locale,
      state: this.#runDetailState,
      ui: this.#ui,
      renderContext: this.#renderContext,
      request: (path, init) => this.#request(path, init),
      refresh: () => this.#refresh(),
      openReview: (runId, reviewId) => this.#openReview(runId, reviewId),
      renderArtifact: this.#renderArtifact
    });
    const bindings: DisclosureBinding[] = [];
    detail.querySelectorAll<HTMLDetailsElement>("details:not([data-disclosure-key])").forEach(node => {
      const parent = node.parentElement?.closest<HTMLElement>("[data-disclosure-key], [data-step-id]");
      const summaries: string[] = [];
      for (let ancestor: HTMLElement | null = node; ancestor && ancestor !== parent; ancestor = ancestor.parentElement) {
        if (ancestor instanceof HTMLDetailsElement) summaries.unshift(ancestor.querySelector(":scope > summary")?.textContent || "");
      }
      node.dataset.disclosureKey = JSON.stringify(["native", parent?.dataset.disclosureKey || parent?.dataset.stepId || "run", summaries]);
    });
    detail.querySelectorAll<HTMLElement>("[data-disclosure-key]").forEach(node => {
      const key = node.dataset.disclosureKey!;
      if (node instanceof HTMLDetailsElement) bindings.push(nativeDisclosure(node, key));
      else if (node.matches(".effective-section, .effective-reference")) {
        const body = node.querySelector<HTMLElement>(":scope > .section-body")!;
        const header = node.querySelector<HTMLElement>(":scope > .section-header")!;
        bindings.push({ key, read: () => !body.hidden, write: expanded => {
          body.hidden = !expanded;
          header.setAttribute("aria-expanded", String(expanded));
        }});
      }
    });
    this.#disclosures.restore(JSON.stringify([this.#config.projectApiBase || "", run.id]), bindings);
    detail.querySelector(".run-detail-content")?.dispatchEvent(new Event("disclosure-state-restored"));
    return detail;
  }
  async #finish(run: Json): Promise<void> {
    const payload = await this.#request(`/api/runs/${encodeURIComponent(run.id)}`);
    const context = payload.run.context;
    const artifactIds: string[] = [...context.outputArtifactIds];
    const names = artifactIds.map(id => context.artifacts.find((a: Json) => a.id === id)?.name ?? id);
    const outputs = names.length ? `${names.length}\n${names.join("\n")}` : (this.#config.locale?.startsWith("en") ? "No deliverables" : "无交付成果");
    if (!await this.#ui.confirm({ title: { text: tr(this.#config, "finish") }, description: { text: `${tr(this.#config, "finishConfirm")}\n\n${outputs}` }, confirmLabel: { text: tr(this.#config, "finish") }, cancelLabel: { text: tr(this.#config, "cancel") }, closeLabel: { text: tr(this.#config, "close") } })) return;
    this.#busy = true;
    try {
      await this.#request(`/api/runs/${encodeURIComponent(run.id)}/finish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ artifactIds }) });
      await this.#navigate(this.#routes.detail.to({ runId: run.id }, { query: { status: "done" } }));
    } finally { this.#busy = false; }
  }
  async #restore(run: Json): Promise<void> {
    this.#busy = true;
    try {
      const payload = await this.#request(`/api/archive/runs/${encodeURIComponent(run.id)}/restore`, { method: "POST" });
      this.#detail = this.#rememberRun(payload.run);
      await this.#navigate(this.#routes.detail.to({ runId: run.id }, { query: { status: run.status } }));
      await this.#refresh();
    } finally { this.#busy = false; }
  }
  async #archive(run:Json):Promise<void>{if(!await this.#ui.confirm({title:{text:tr(this.#config,"archive")},description:{text:tr(this.#config,"archiveConfirm")},confirmLabel:{text:tr(this.#config,"archive")},cancelLabel:{text:tr(this.#config,"cancel")},closeLabel:{text:tr(this.#config,"close")}}))return;this.#busy=true;try{await this.#request(`/api/archive/runs/${encodeURIComponent(run.id)}`,{method:"POST"});if(run.representation === "context-control")await this.#navigate(this.#routes.index.to(undefined,{query:{status:this.#status}}));else await this.#refresh();}finally{this.#busy=false;}}
  async #abandon(run:Json):Promise<void>{if(!await this.#ui.confirm({title:{text:tr(this.#config,"abandon")},description:{text:tr(this.#config,"abandonConfirm")},confirmLabel:{text:tr(this.#config,"abandon")},cancelLabel:{text:tr(this.#config,"cancel")},closeLabel:{text:tr(this.#config,"close")},tone:"danger"}))return;this.#busy=true;try{await this.#request(`/api/runs/${encodeURIComponent(run.id)}/abandon`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});await this.#refresh();}finally{this.#busy=false;}}
  async #openReview(runId:string,reviewId:string,roundId?:string):Promise<void>{
    this.#reviewSession.reviewRoundId=roundId??"";
    this.#busy=true;
    try{
      if(!this.#route.routeKey?.endsWith("artifact-review")){
        await this.#navigate(this.#routes.review.to({runId,reviewId}, { query: { ...(this.#status === "running" ? {} : { status: this.#status }), ...(roundId ? { round: roundId } : {}) } }));
        return;
      }
      if(this.#controller.signal.aborted)return;
      this.#reviewSession.renderLoading();
      await this.#reviewSession.reloadReview(runId,reviewId);
      if(!this.#controller.signal.aborted)this.#reviewSession.renderReview(runId,reviewId);
    }finally{this.#busy=false;}
  }

}

/** Shared review session for the routed Flow page and inline Graph panes. */
class ArtifactReviewSession {
  reviewContext: Json | null = null; reviewDialog: HTMLElement | null = null;
  reviewMediaCleanup: (()=>void) | null = null;
  reviewRoundId=""; reviewMaterial="candidate";
  expandedResults=new Set<string>();resultRequests=new Map<string,Promise<Json>>();
  activities=new Map<string,Json>(); expandedActivities=new Set<string>();
  reviewRenderGeneration=0; composerByActor=new Map<string,string>();
  expandedComposers=new Set<string>(); severityByActor=new Map<string,string>(); voteByActor=new Map<string,string>();
  #disposed=false;
  #contextGeneration=0;
  inline?: {container:HTMLElement;content:HTMLElement;panel:HTMLElement};
  constructor(readonly options:{config:Readonly<RunConfig>;ui:ViewUi;controller:AbortController;root:HTMLElement;request:(path:string)=>Promise<Json>;detail:()=>Json|null;route:()=>RouteLocation}){}
  get #config(){return this.options.config;} get #ui(){return this.options.ui;}
  get #controller(){return this.options.controller;} get #root(){return this.options.root;}
  get #detail(){return this.options.detail();} get #route(){return this.options.route();}
  #request(path:string){return this.options.request(path);}
  dispose(){this.#disposed=true;this.options.controller.abort();this.reviewMediaCleanup?.();if(!this.inline)this.reviewDialog?.remove();}
  #contextUrl(runId:string,reviewId:string,roundId:string,actorId=""):string{
    const query=new URLSearchParams({view:"compact",material:this.reviewMaterial,auto_actor:"true"});if(actorId)query.set("actor_id",actorId);
    return `/api/runs/${encodeURIComponent(runId)}/artifact-reviews/${encodeURIComponent(reviewId)}/rounds/${encodeURIComponent(roundId)}?${query}`;
  }
  renderLoading():void{
    if(this.inline)return;
    this.reviewMediaCleanup?.();this.reviewDialog?.remove();
    const shell=document.createElement("div");shell.className="artifact-review-modal";shell.id="artifact-review-loading";shell.setAttribute("aria-busy","true");
    const frame=document.createElement("div");frame.className="artifact-review-shell";const head=document.createElement("header");head.className="artifact-review-head";const title=document.createElement("h2");title.textContent=tr(this.#config,"review");head.append(title);
    const body=document.createElement("div");body.className="artifact-review-body";const feedback=this.#ui.feedback({state:"loading",title:{text:tr(this.#config,"loading")}});body.append(feedback);frame.append(head,body);shell.append(frame);this.#root.replaceChildren(shell);this.reviewDialog=shell;
  }
  async reloadReview(runId:string,explicitReviewId?:string,actorOverride?:string):Promise<void>{
    const generation=++this.#contextGeneration;
    const reviewId=explicitReviewId||this.reviewContext?.review?.id;if(!reviewId)return;
    const summary=(this.#detail?.artifactReviewSummaries||[]).find((candidate:Json)=>candidate.id===reviewId)||reviewSummary(this.#detail);const requested=this.reviewRoundId||(this.inline ? null : new URLSearchParams(location.search).get("round"))||summary?.currentRoundId||summary?.round?.id||"current";if(!requested)return;
    const actorId=actorOverride??(this.reviewContext?.assignment?.actorId||localStorage.getItem(`memsphere.review.identity.${reviewId}`)||"");
    if(!this.inline)this.reviewMaterial=new URLSearchParams(location.search).get("material")||this.reviewMaterial;
    const load=async(roundId:string)=>this.#request(this.#contextUrl(runId,reviewId,roundId,actorId));
    let context:Json,selectedId=requested;
    try{context=await load(requested);}catch(error){
      const fallback=summary?.currentRoundId||summary?.round?.id||"current";if(fallback===requested)throw error;context=await load(fallback);selectedId=fallback;
    }
    if(generation!==this.#contextGeneration||this.#disposed||this.#controller.signal.aborted)return;
    this.reviewContext=context;this.reviewRoundId=selectedId==="current"?context.review.currentRoundId:selectedId;
    if(this.reviewContext?.assignment)localStorage.setItem(`memsphere.review.identity.${reviewId}`,this.reviewContext.assignment.actorId);
    if(!this.reviewContext)return;const validMaterials=new Set(materials(this.reviewContext).map(item=>item.key));const queryMaterial=(this.inline ? null : new URLSearchParams(location.search).get("material"))||this.reviewMaterial;
    this.reviewMaterial=validMaterials.has(queryMaterial)?queryMaterial:"candidate";this.#syncReviewUrl();
  }
  #syncReviewUrl():void{if(this.inline)return;const url=new URL(location.href);url.searchParams.set("round",this.reviewRoundId);if(this.reviewMaterial==="candidate")url.searchParams.delete("material");else url.searchParams.set("material",this.reviewMaterial);history.replaceState(history.state,"",url);}
  renderReview(runId:string,reviewId:string):void{
    if(this.#disposed||this.#controller.signal.aborted)return;
    this.reviewRenderGeneration += 1;
    const previous=this.reviewDialog;this.reviewMediaCleanup?.();this.reviewMediaCleanup=null;if(!this.inline)previous?.remove();const context=this.reviewContext;if(!context)return;
    const split=Math.min(75,Math.max(30,Number(localStorage.getItem("memsphere.artifactReviewSplit.v1"))||70));
    const dialog=document.createElement("div");this.reviewDialog=this.inline?.container??dialog;dialog.className="artifact-review-modal";dialog.id="artifact-review-modal";dialog.style.setProperty("--artifact-review-left",`${split}%`);
    dialog.innerHTML=`<div class="artifact-review-shell"><header class="artifact-review-head"><div class="artifact-review-heading"><h2></h2><div class="artifact-review-subtitle"></div></div></header><div class="artifact-review-controls"></div><div class="artifact-review-mobile-tabs"></div><div class="artifact-review-body"><section id="artifact-review-artifact-pane" class="artifact-review-modal-pane" role="tabpanel"></section><div class="artifact-review-divider" role="separator" tabindex="0" aria-controls="artifact-review-artifact-pane artifact-review-review-pane"></div><section id="artifact-review-review-pane" class="artifact-review-modal-pane" role="tabpanel"></section></div></div>`;
    dialog.querySelector("h2")!.textContent=tr(this.#config,"review");(dialog.querySelector(".artifact-review-subtitle") as HTMLElement).textContent=`${context.review?.artifactName||tr(this.#config,"artifact")} · ${reviewId}`;
    const controls=dialog.querySelector(".artifact-review-controls") as HTMLElement;if(!this.inline)controls.append(this.#materialSelector(context,()=>this.renderReview(runId,reviewId)));
    const divider=dialog.querySelector(".artifact-review-divider") as HTMLElement;divider.setAttribute("aria-label",tr(this.#config,"resizeReview"));divider.setAttribute("aria-valuemin","30");divider.setAttribute("aria-valuemax","75");divider.setAttribute("aria-valuenow",String(split));this.#wireDivider(divider,dialog);
    const artifactPane=dialog.querySelector("#artifact-review-artifact-pane") as HTMLElement;const reviewPane=dialog.querySelector("#artifact-review-review-pane") as HTMLElement;artifactPane.append(this.#renderMaterial(context));const material=materials(context).find(item=>item.key===this.reviewMaterial)||materials(context)[0];
    if(material.key==="candidate")reviewPane.append(this.renderReviewPanel(runId,context));
    else if(material.reviewContext)reviewPane.append(this.renderReviewPanel(runId,material.reviewContext,true));
    else {const empty=reviewCard("artifact-review-scope-panel",tr(this.#config,"scope"));empty.append(textBlock(material.artifact?.name||materialLabel(this.#config,material)),textBlock(tr(this.#config,"noMaterialReview")));reviewPane.append(empty);}
    const mobileTabs=dialog.querySelector(".artifact-review-mobile-tabs") as HTMLElement;
    const show=(selected:"artifact"|"review")=>{const artifact=selected==="artifact";artifactPane.hidden=!artifact;reviewPane.hidden=artifact;localStorage.setItem("memsphere.artifactReviewMobilePane.v1",selected);mobileTabs.replaceChildren(this.#ui.tabs({label:{text:tr(this.#config,"review")},selectedId:selected,items:[{id:"artifact",label:{text:tr(this.#config,"artifactPane")},panelId:"artifact-review-artifact-pane",action:{label:{text:tr(this.#config,"artifactPane")},run:()=>show("artifact")}},{id:"review",label:{text:tr(this.#config,"reviewPane")},panelId:"artifact-review-review-pane",action:{label:{text:tr(this.#config,"reviewPane")},run:()=>show("review")}}]}));};
    const selectedMobilePane=localStorage.getItem("memsphere.artifactReviewMobilePane.v1")==="review"?"review":"artifact";
    const media=matchMedia("(max-width: 820px)");
    const syncLayout=()=>{if(media.matches)show(localStorage.getItem("memsphere.artifactReviewMobilePane.v1")==="review"?"review":selectedMobilePane);else{mobileTabs.replaceChildren();artifactPane.hidden=false;reviewPane.hidden=false;}};
    if(!this.inline)media.addEventListener("change",syncLayout);this.reviewMediaCleanup=()=>media.removeEventListener("change",syncLayout);syncLayout();
    if(this.inline){
      const material=dialog.querySelector("#artifact-review-artifact-pane")!;
      const panel=dialog.querySelector("#artifact-review-review-pane")!;
      this.inline.content.replaceChildren(...material.childNodes);
      this.inline.panel.replaceChildren(...panel.childNodes);
      this.inline.content.dispatchEvent(new Event("cc-review-material-ready",{bubbles:true}));
      this.reviewDialog=this.inline.container;
    }else{this.#root.replaceChildren(dialog);this.reviewDialog=dialog;}
  }
  renderReviewPanel(runId:string,context:Json,readOnly=false):HTMLElement{
    const wrap=document.createElement("div");const round=selectedRound(context,readOnly?context.review.outcome?.roundId||context.review.currentRoundId:this.reviewRoundId);const historical=round?.id!==context.review.currentRoundId;
    const scope=reviewCard("artifact-review-scope-panel",tr(this.#config,"scope"));
    scope.classList.add("artifact-review-overview");
    const english=this.#config.locale?.startsWith("en");
    const object=document.createElement("div");object.className="artifact-review-overview-object";
    const name=document.createElement("span");name.className="artifact-review-overview-name";name.textContent=context.review?.artifactName||"—";
    const status=round?.result?.status||round?.status||context.review?.status;
    object.append(name,reviewStateBadge(this.#config,status));scope.append(object);
    if(!readOnly)scope.append(this.#roundSelector(runId,context));else{const note=textBlock(tr(this.#config,"materialReadOnly"));note.className="artifact-review-overview-note";scope.append(note);}
    const facts=document.createElement("dl");facts.className="artifact-review-overview-facts";
    const start=round?.createdAt||context.review?.createdAt,end=round?.result?.completedAt;
    const dateText=(value:string)=>new Date(value).toLocaleString(english?"en-GB":"zh-CN",{hour12:false});
    const rows=[
      [english?"Started":"开始时间",start?dateText(start):"—"],
      [english?"Completed":"结束时间",end?dateText(end):status==="cancelled"?(english?"Cancelled":"已取消"):english?"In progress":"进行中"],
      ...(context.review?.policyId==="artifact_acceptance.unanimous"?[[english?"Approval rule":"通过条件",english?"All decision votes approve":"全部决策票通过"]]:[])
    ];
    for(const [label,value] of rows){const key=document.createElement("dt"),text=document.createElement("dd");key.textContent=label;text.textContent=value;facts.append(key,text);}scope.append(facts);
    const mine=reviewCard("artifact-review-my-panel",tr(this.#config,"myReview"));const assignments=round?.assignments||[];const humans=assignments.filter((a:Json)=>a.actorKind!=="agent");const selectedSubmitted=assignmentSubmitted(context.assignment);if(!readOnly&&(humans.length>1||humans.length===1&&!selectedSubmitted))mine.append(this.#identity(context,humans,runId));
    if(historical){const badge=textBlock(tr(this.#config,"historicalRound"));badge.className="artifact-review-message";const notice=textBlock(tr(this.#config,"historyReadOnly"));notice.className="artifact-review-message warn";mine.append(badge,notice);}else if(!context.assignment)mine.append(textBlock(tr(this.#config,"noReviewRequired")));else if(context.assignment.actorKind!=="agent"){if(selectedSubmitted)mine.append(textBlock(`${tr(this.#config,"voteSummary")} · ${voteLabel(this.#config,context.assignment.submitted?.vote)}`));else mine.append(this.#reviewEditor(context,runId));}
    const progress=reviewCard("artifact-review-progress-panel",tr(this.#config,"participationProgress"));const progressSummary=document.createElement("div");progressSummary.className="artifact-review-progress-summary";progressSummary.textContent=roundProgress(this.#config,round);progress.append(progressSummary);for(const assignment of assignments){const selected=assignment.actorId===context.assignment?.actorId?{...assignment,draft:context.assignment.draft,submitted:context.assignment.submitted}:assignment;progress.append(this.#participant(context,round,selected));}progress.append(this.#runner(round));
    const heading=progress.querySelector("h3")!;const resultHeading=document.createElement("div");resultHeading.className="artifact-review-results-heading";heading.before(resultHeading);resultHeading.append(heading,reviewStateBadge(this.#config,round?.result?.status||round?.status));const summary=round?.result?.summary||round?.summary;if(summary){const result=document.createElement("div");result.className="artifact-review-result-summary";result.append(textBlock(summary));progressSummary.after(result);}wrap.append(scope);if(!readOnly)wrap.append(mine);wrap.append(progress);return wrap;
  }
  #identity(context:Json,assignments:Json[],runId:string):HTMLElement{
    return chooser(this.#ui,"artifact-review-actor-select",tr(this.#config,"identity"),assignmentName(assignments.find(a=>a.actorId===context.assignment?.actorId))||tr(this.#config,"selectIdentity"),assignments.map(assignment=>({id:assignment.actorId,label:`${assignmentName(assignment)} · ${assignment.binding}` ,selected:assignment.actorId===context.assignment?.actorId})),async actorId=>{
      localStorage.setItem(`memsphere.review.identity.${context.review.id}`,actorId);await this.reloadReview(runId,context.review.id,actorId);this.renderReview(runId,context.review.id);
    });
  }
  #reviewEditor(context:Json,runId:string):HTMLElement{
    const editor=document.createElement("div");editor.className="artifact-review-comment";editor.id="artifact-review-my-content";const draft=context.assignment?.draft||{vote:null,comments:[]};const actorKey=context.assignment.actorId;const selectedVote=this.voteByActor.get(actorKey)??draft.vote;
    const composerKey=JSON.stringify([context.review.id,this.reviewRoundId,actorKey]);
    const commentGroup=document.createElement("section");commentGroup.className="artifact-review-compose-group";commentGroup.setAttribute("aria-label",tr(this.#config,"comments"));
    const head=document.createElement("div");head.className="artifact-review-compose-head";const title=document.createElement("h4");title.textContent=tr(this.#config,"comments");
    const expanded=this.expandedComposers.has(composerKey);
    const toggle=this.#ui.button({label:{text:expanded?(this.#config.locale?.startsWith("en")?"Collapse":"收起"):tr(this.#config,"addOpinion")},run:()=>{if(expanded)this.expandedComposers.delete(composerKey);else this.expandedComposers.add(composerKey);this.renderReview(runId,context.review.id);if(!expanded)this.reviewDialog?.querySelector<HTMLTextAreaElement>("#artifact-review-my-content textarea")?.focus();}});toggle.classList.add("artifact-review-editor-button");toggle.setAttribute("aria-expanded",String(expanded));head.append(title,toggle);commentGroup.append(head);
    for(const comment of draft.comments||[])commentGroup.append(commentCard(this.#ui,comment,`${tr(this.#config,"savedOpinion")} · ${severityLabel(this.#config,comment.severity)}`,tr(this.#config,"locate"),this.reviewDialog??this.#root));
    if(expanded){
      const textareaField=this.#ui.textareaField({label:{text:this.#config.locale?.startsWith("en")?"Comment":"意见内容"},placeholder:{text:tr(this.#config,"overallPlaceholder")},value:this.composerByActor.get(actorKey)||"",onInput:value=>{this.composerByActor.set(actorKey,value);}});const textarea=textareaField.control;textarea.dataset.reviewComposerKey=composerKey;
      const initialSeverity=this.severityByActor.get(actorKey)||"blocking";const severity=chooser(this.#ui,"artifact-review-severity-select",tr(this.#config,"commentSeverity"),severityLabel(this.#config,initialSeverity),["blocking","risk","suggestion"].map(value=>({id:value,label:severityLabel(this.#config,value),selected:value===initialSeverity})),value=>{this.severityByActor.set(actorKey,value);});
      const actions=document.createElement("div");actions.className="artifact-review-actions";const add=this.#ui.button({label:{text:tr(this.#config,"addOpinion")},run:()=>{const body=textarea.value.trim();if(!body){textarea.focus();return;}return this.#saveDraft(context,runId,{vote:draft.vote||null,comments:[...(draft.comments||[]),{id:`comment-${Date.now()}`,body,severity:this.severityByActor.get(actorKey)||initialSeverity}]},textarea);}});add.classList.add("artifact-review-editor-button");actions.append(add);severity.classList.add("artifact-review-editor-field");textareaField.root.classList.add("artifact-review-editor-field");commentGroup.append(severity,textareaField.root,actions);
    }
    editor.append(commentGroup);
    const votes=this.#ui.segmentedControl({label:{text:tr(this.#config,"decision")},selectedId:selectedVote||"abstain",items:[["approve",tr(this.#config,"approve")],["request_changes",tr(this.#config,"requestChanges")],["abstain",tr(this.#config,"abstain")]].map(([id,label])=>({id,label:{text:label}})),onSelect:value=>{this.voteByActor.set(actorKey,value);this.renderReview(runId,context.review.id);}});votes.classList.add("artifact-review-vote");const voteGroup=document.createElement("section");voteGroup.className="artifact-review-decision-group";const voteHeading=document.createElement("h4");voteHeading.textContent=this.#config.locale?.startsWith("en")?"Final vote":"投票结论";voteGroup.append(voteHeading,votes);editor.append(voteGroup);
    const submitArea=document.createElement("div");submitArea.className="artifact-review-actions artifact-review-submit-area";submitArea.id="artifact-review-submit-area";const submit=this.#ui.confirmButton({label:{text:tr(this.#config,"submit")},run:()=>this.#submitReview(context,runId)},{title:{text:tr(this.#config,"submit")},confirmLabel:{text:tr(this.#config,"submit")},cancelLabel:{text:tr(this.#config,"cancel")},closeLabel:{text:tr(this.#config,"close")}},{tone:"primary"});submit.classList.add("artifact-review-editor-button");submitArea.append(submit);voteGroup.append(submitArea);return editor;
  }
  #roundSelector(runId:string,context:Json):HTMLElement{
    const rounds=context.rounds||[];const current=selectedRound(context,this.reviewRoundId);return chooser(this.#ui,"artifact-review-round-select",tr(this.#config,"round"),`${tr(this.#config,"round")} ${current?.sequence||"—"}`,rounds.map((round:Json)=>({id:round.id,label:this.#config.locale?.startsWith("en")?`Round ${round.sequence}${round.id===context.review.currentRoundId?" (current)":" (history)"}`:`第 ${round.sequence} 轮${round.id===context.review.currentRoundId?"（当前）":"（历史）"}`,selected:round.id===current?.id})),async roundId=>{
      this.reviewRoundId=roundId;this.#syncReviewUrl();const actor=this.reviewContext?.assignment?.actorId||"";await this.reloadReview(runId,context.review.id,actor);this.renderReview(runId,context.review.id);
    },"button");
  }
  #materialSelector(context:Json,onChange:()=>void):HTMLElement{
    const items=materials(context);const selected=items.find(item=>item.key===this.reviewMaterial)||items[0];return chooser(this.#ui,"artifact-review-material-select",tr(this.#config,"selectMaterial"),materialLabel(this.#config,selected),items.map(item=>({id:item.key,label:materialLabel(this.#config,item),selected:item.key===selected?.key})),async key=>{this.reviewMaterial=key;this.#syncReviewUrl();await this.reloadReview(this.#detail?.id||this.#route.params.runId||"",context.review.id);onChange();});
  }
  #renderMaterial(context:Json):HTMLElement{
    const material=materials(context).find(item=>item.key===this.reviewMaterial)||materials(context)[0];const artifact=material?.artifact||{};const wrap=document.createElement("div");wrap.dataset.material=material?.key||"candidate";
    const heading=document.createElement("h3");heading.className="artifact-review-material-heading";heading.textContent=tr(this.#config,"materialTitle");
    const meta=document.createElement("div");meta.className="artifact-review-material-meta";const name=document.createElement("div");name.className="artifact-review-material-name";name.textContent=materialLabel(this.#config,material);const description=document.createElement("div");description.className="artifact-review-material-description";description.textContent=[artifactFormatLabel(this.#config,artifact),artifact.storage==="file"?tr(this.#config,"file"):tr(this.#config,"inline")].join(" · ");meta.append(name,description);
    wrap.append(heading,meta);
    if(artifact.path||artifact.fileName){const path=document.createElement("code");path.className="artifact-review-material-path";path.textContent=String(artifact.path||artifact.fileName);wrap.append(path);}
    const time=document.createElement("time");time.className="artifact-review-material-time";time.textContent=`${this.#config.locale?.startsWith("en")?"Submitted":"提交时间"}：${formatTime(context.submission?.submittedAt||context.review?.createdAt)}`;wrap.append(time);
    const frame=document.createElement("div");frame.className="artifact-review-artifact-frame";const content=renderArtifactValue(artifact);
    if(material?.commentable){
      const attach=(child:HTMLElement,anchor:string)=>{const target=document.createElement("div");target.className="artifact-review-target artifact-review-commentable";target.dataset.anchor=anchor;const body=document.createElement("div");body.className="artifact-review-commentable-body";child.replaceWith(target);body.append(child);const label=this.#config.locale?.startsWith("en")?"Add inline comment":"添加行内意见";const plus=this.#ui.iconButton({label:{text:label},icon:{kind:"system",name:"plus"},run:()=>this.#openInlineEditor(target,context,anchor)});plus.classList.add("inline-plus");plus.removeAttribute("data-tooltip");plus.setAttribute("aria-expanded","false");let end=child;while(end.lastElementChild&&["P","LI","BLOCKQUOTE"].includes(end.lastElementChild.tagName))end=end.lastElementChild as HTMLElement;if(/^H[1-6]$/.test(end.tagName))end.setAttribute("aria-label",end.textContent||"");end.append(plus);target.append(body);};
      const children=[...content.children] as HTMLElement[];
      children.forEach((child,index)=>{const anchor=`markdown:${child.tagName.toLowerCase()}:${index}`;if(child.matches("ul,ol")){child.dataset.anchor=anchor;for(const [i,item] of [...child.children].entries()){if(!(item instanceof HTMLElement))continue;const line=document.createElement("span");while(item.firstChild)line.append(item.firstChild);item.append(line);attach(line,`${anchor}:li:${i}`);}}else attach(child,anchor);});
      if(!children.length){content.classList.add("artifact-review-target");content.dataset.anchor="artifact:root";}
    }
    frame.append(content);wrap.append(frame);return wrap;
  }
  #openInlineEditor(target:HTMLElement,context:Json,anchor:string):void{
    const toggle=target.querySelector<HTMLButtonElement>(".inline-plus");const existing=target.querySelector(":scope > .inline-comment-editor");if(existing){existing.remove();toggle?.setAttribute("aria-expanded","false");return;}for(const open of this.reviewDialog?.querySelectorAll(".inline-comment-editor")||[]){open.parentElement?.querySelector<HTMLButtonElement>(".inline-plus")?.setAttribute("aria-expanded","false");open.remove();}
    const editor=document.createElement("div");editor.className="inline-comment-editor";const field=this.#ui.textareaField({label:{text:tr(this.#config,"addOpinion")},value:"",placeholder:{text:this.#config.locale?.startsWith("en")?"How should this change?":"这里应该如何修改？"},onInput:()=>undefined});const input=field.control;const actions=document.createElement("div");actions.className="inline-comment-actions";const save=this.#ui.button({label:{text:tr(this.#config,"addOpinion")},run:()=>{const body=input.value.trim();if(!body){input.focus();return;}const draft=context.assignment?.draft||{vote:null,comments:[]};const comment={id:`comment-${Date.now()}`,body,severity:"risk",anchor:{submissionId:context.submission.id,sourceHash:context.submission.digest,target:anchor,location:anchor,context:String(target.querySelector(".artifact-review-commentable-body")?.textContent||"").trim().slice(0,500)}};return this.#saveDraft(context,this.#detail?.id||"",{vote:draft.vote||null,comments:[...(draft.comments||[]),comment]},input);}}, {tone:"primary"});const cancel=this.#ui.button({label:{text:tr(this.#config,"cancel")},run:()=>{editor.remove();toggle?.setAttribute("aria-expanded","false");toggle?.focus();}});actions.append(save,cancel);editor.append(field.root,actions);target.append(editor);toggle?.setAttribute("aria-expanded","true");input.focus();
  }
  #wireDivider(divider:HTMLElement,dialog:HTMLElement):void{
    const set=(value:number,persist=true)=>{const next=Math.min(75,Math.max(30,Math.round(value)));dialog.style.setProperty("--artifact-review-left",`${next}%`);divider.setAttribute("aria-valuenow",String(next));if(persist)localStorage.setItem("memsphere.artifactReviewSplit.v1",String(next));};
    divider.onkeydown=event=>{const now=Number(divider.getAttribute("aria-valuenow"))||70;if(event.key==="ArrowLeft"){event.preventDefault();set(now-2);}else if(event.key==="ArrowRight"){event.preventDefault();set(now+2);}};
    divider.onpointerdown=event=>{if(innerWidth<=820)return;const body=divider.parentElement!;divider.setPointerCapture(event.pointerId);const move=(moveEvent:PointerEvent)=>{const box=body.getBoundingClientRect();set(((moveEvent.clientX-box.left)/box.width)*100,false);};const finish=()=>{set(Number(divider.getAttribute("aria-valuenow"))||70);divider.removeEventListener("pointermove",move);divider.removeEventListener("pointerup",finish);};divider.addEventListener("pointermove",move);divider.addEventListener("pointerup",finish);};
  }
  async #saveDraft(context:Json,runId:string,draft:Json,composer?:HTMLTextAreaElement,rerender=true):Promise<void>{
    await this.#persistDraft(context,runId,draft);if(composer){composer.value="";const key=composer.dataset.reviewComposerKey;if(key){this.composerByActor.delete(context.assignment.actorId);this.expandedComposers.delete(key);}}if(rerender)this.renderReview(runId,context.review.id);
  }
  async #persistDraft(context:Json,runId:string,draft:Json):Promise<Json>{let active:Json=this.reviewContext?.assignment?.actorId===context.assignment.actorId?this.reviewContext!:context;const payload:{vote?:string;comments:Json[]}={comments:draft.comments||[]};if(draft.vote)payload.vote=draft.vote;let saved:Response|null=null;for(let attempt=0;attempt<5;attempt+=1){const response=await fetch(projectApiUrl(this.#config,this.#assignmentUrl(active,"draft")),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({...payload,expectedRevision:active.review.round.revision}),signal:this.#controller.signal});if(response.status!==409){saved=response;break;}if(attempt===4)throw new Error(tr(this.#config,"conflict"));active=await this.#request(`/api/runs/${encodeURIComponent(runId)}/artifact-reviews/${encodeURIComponent(context.review.id)}/rounds/${encodeURIComponent(this.reviewRoundId)}?actor_id=${encodeURIComponent(context.assignment.actorId)}`);}if(!saved||!saved.ok)throw new Error(saved?await this.#responseError(saved):tr(this.#config,"conflict"));const result=await saved.json();this.reviewContext=result;return result;}
  async #submitReview(context:Json,runId:string):Promise<void>{
    let latest=this.reviewContext||context;const actorKey=latest.assignment.actorId;const localVote=this.voteByActor.get(actorKey);if(localVote)latest=await this.#persistDraft(latest,runId,{vote:localVote,comments:latest.assignment?.draft?.comments||[]});let response=await this.#submitAssignment(latest);if(response.status===409){latest=await this.#request(`/api/runs/${encodeURIComponent(runId)}/artifact-reviews/${encodeURIComponent(context.review.id)}/rounds/${encodeURIComponent(this.reviewRoundId)}?actor_id=${encodeURIComponent(actorKey)}`);this.reviewContext=latest;if(localVote)latest=await this.#persistDraft(latest,runId,{vote:localVote,comments:latest.assignment?.draft?.comments||[]});response=await this.#submitAssignment(latest);}if(!response.ok)throw new Error(response.status===409?tr(this.#config,"conflict"):await this.#responseError(response));this.reviewContext=await response.json();this.voteByActor.delete(actorKey);this.renderReview(runId,context.review.id);
  }
  #submitAssignment(context:Json):Promise<Response>{return fetch(projectApiUrl(this.#config,this.#assignmentUrl(context,"submit")),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({expectedRevision:context.review.round.revision}),signal:this.#controller.signal});}
  async #responseError(response:Response):Promise<string>{const text=await response.text();try{const payload=JSON.parse(text);return typeof payload?.error==="string"?payload.error:text;}catch{return text||tr(this.#config,"conflict");}}
  #participant(context:Json,round:Json,assignment:Json):HTMLElement{
    const row=document.createElement("article");row.className="artifact-review-row artifact-review-participant";row.id=`artifact-review-participant-${safeId(assignment.actorId)}`;const head=document.createElement("div");head.className="artifact-review-participant-head";const main=document.createElement("div");main.className="artifact-review-row-main";const name=document.createElement("b");name.textContent=assignmentName(assignment);const meta=document.createElement("div");meta.className="artifact-review-participant-meta";meta.append(pill(`${assignment.binding==="decision"?tr(this.#config,"decision"):tr(this.#config,"advisory")} · ${assignment.actorKind==="agent"?tr(this.#config,"agent"):assignment.actorKind||"Human"}`),...(assignment.status==="failed"||assignment.status==="running"||assignment.status==="queued"?[pill(assignmentStatus(this.#config,assignment))]:[]),pill(voteLabel(this.#config,assignment.vote||assignment.submitted?.vote)));if(assignment.submitted?.delegation?.kind==="runner")meta.append(pill(tr(this.#config,"delegatedByRunner")));main.append(name,meta);head.append(main);row.append(head);
    const attempts = assignment.attempts || (assignment.attempt ? [assignment.attempt] : []);
    if (assignment.actorKind === "agent" && attempts.length) {
      const activityKey = JSON.stringify([this.#config.projectApiBase || "", this.#detail?.id || this.#route.params.runId,
        context.review.id, round.id, this.reviewMaterial, context.submission?.id, assignment.actorId]);
      const generation = this.reviewRenderGeneration;
      let toggle!: HTMLButtonElement;
      const update = () => {
        const expanded = this.expandedActivities.has(activityKey);
        const label = tr(this.#config, expanded ? "hideDetails" : "viewDetails");
        toggle.querySelector(":scope > span:not(.mem-view-button-error)")!.textContent = label;
        toggle.setAttribute("aria-label", label);
        toggle.setAttribute("aria-expanded", String(expanded));
      };
      let requestVersion = 0;
      const load = async () => {
        const version = ++requestVersion;
        const isCurrent = () => !this.#disposed && !this.#controller.signal.aborted && generation === this.reviewRenderGeneration &&
          version === requestVersion && row.isConnected && this.expandedActivities.has(activityKey);
        try {
          const activity = await this.#agentActivity(context.review, round, { ...assignment, attempts }, activityKey, isCurrent);
          if (!isCurrent()) return;
          row.querySelector(".artifact-review-activity")?.remove();
          head.insertAdjacentElement("afterend", activity);
        } catch (error) { if (isCurrent()) throw error; }
      };
      const reportLoadError = (error: unknown) => {
        if (this.#controller.signal.aborted || generation !== this.reviewRenderGeneration || !row.isConnected) return;
        console.error("Unable to load Agent Activity", error);
        this.expandedActivities.delete(activityKey); update();
        const feedback = this.#ui.feedback({ state: "error", title: { text: error instanceof Error ? error.message : String(error) } });
        feedback.classList.add("artifact-review-activity"); head.insertAdjacentElement("afterend", feedback);
      };
      toggle = this.#ui.button({ label: { text: tr(this.#config,"viewDetails") }, run: () => {
        if (this.expandedActivities.has(activityKey)) {
          this.expandedActivities.delete(activityKey); requestVersion += 1;
          row.querySelector(".artifact-review-activity")?.remove(); update(); return;
        }
        row.querySelector(".artifact-review-activity")?.remove();
        this.expandedActivities.add(activityKey); update(); void load().catch(reportLoadError);
      }});
      toggle.classList.add("artifact-review-activity-toggle"); head.append(toggle); update();
      if (this.expandedActivities.has(activityKey)) void load().catch(reportLoadError);
    }
    const opinion=assignment.submitted||((assignment.summary||assignment.vote)?assignment:null);
    if(opinion){
      const key=JSON.stringify([context.review.id,round.id,assignment.actorId,opinion.submittedAt]);
      const details=document.createElement("div");details.className="artifact-review-result-details";details.id=`review-result-${safeId(round.id)}-${safeId(assignment.actorId)}`;
      let version=0,loaded=false;const generation=this.reviewRenderGeneration;
      const update=()=>{const expanded=this.expandedResults.has(key);details.hidden=!expanded;const label=this.#config.locale?.startsWith("en")?(expanded?"Hide review details":"Review details"):(expanded?"收起评审详情":"评审详情");toggle.setAttribute("aria-label",label);toggle.setAttribute("aria-expanded",String(expanded));toggle.querySelector(":scope > span:not(.mem-view-button-error)")!.textContent=label;};
      const load=async()=>{if(loaded)return;const current=++version;details.replaceChildren(this.#ui.feedback({state:"loading",title:{text:tr(this.#config,"loading")}}));try{
        let value=opinion;
        if(opinion.detailsDeferred){
          let request=this.resultRequests.get(key);if(!request){const runId=this.#detail?.id||this.#route.params.runId||"";const query=new URLSearchParams({view:"compact",material:"contract",opinion_actor:assignment.actorId});request=this.#request(`/api/runs/${encodeURIComponent(runId)}/artifact-reviews/${encodeURIComponent(context.review.id)}/rounds/${encodeURIComponent(round.id)}?${query}`).then(payload=>selectedRound(payload,round.id).assignments.find((a:Json)=>a.actorId===assignment.actorId)?.submitted);this.resultRequests.set(key,request);request.catch(()=>this.resultRequests.delete(key));}value=await request;
        }
        if(this.#disposed||generation!==this.reviewRenderGeneration||current!==version||!row.isConnected)return;
        details.replaceChildren(this.#opinionBody(value||{}));loaded=true;
      }catch(error){if(current===version&&row.isConnected)details.replaceChildren(this.#ui.feedback({state:"error",title:{text:error instanceof Error?error.message:String(error)}}));}};
      const toggle=this.#ui.button({label:{text:this.#config.locale?.startsWith("en")?"Review details":"评审详情"},run:()=>{if(this.expandedResults.has(key)){this.expandedResults.delete(key);version++;}else{this.expandedResults.add(key);void load();}update();}});toggle.classList.add("artifact-review-result-toggle");toggle.setAttribute("aria-controls",details.id);head.append(toggle);row.append(details);update();if(this.expandedResults.has(key))void load();
    }else{
      const toggle=this.#ui.button({label:{text:this.#config.locale?.startsWith("en")?"Review details":"评审详情"},disabled:true,run:()=>undefined});toggle.classList.add("artifact-review-result-toggle");toggle.setAttribute("aria-expanded","false");head.append(toggle);
    }
    return row;
  }
  #runner(round:Json):HTMLElement{const runner=round?.runner;const row=document.createElement("article");row.className="artifact-review-participant";const head=document.createElement("div");head.className="artifact-review-participant-head";const main=document.createElement("div");main.className="artifact-review-row-main";const name=document.createElement("b");name.textContent=runner?.actorName||tr(this.#config,"runner");const meta=document.createElement("div");meta.className="artifact-review-participant-meta";meta.append(pill(tr(this.#config,"decision")),pill(voteLabel(this.#config,runner?.vote)));main.append(name,meta);head.append(main);row.append(head);return row;}
  #opinionBody(opinion:Json):HTMLElement{
    const english=this.#config.locale?.startsWith("en");
    const wrap=document.createElement("div");wrap.className="artifact-review-opinion";
    const vote=document.createElement("div");vote.className="artifact-review-opinion-vote";const label=document.createElement("span");label.textContent=english?"Final vote":"最终投票";vote.append(label,pill(voteLabel(this.#config,opinion.vote)));wrap.append(vote);
    if(opinion.delegation?.kind==="runner"&&opinion.delegation.authorizationNote){const note=textBlock(`${tr(this.#config,"authorizationNote")}：${opinion.delegation.authorizationNote}`);note.className="artifact-review-message";wrap.append(note);}
    if(opinion.renderedSummary||opinion.summary){
      const section=document.createElement("section");section.className="artifact-review-opinion-section";
      const summary=document.createElement("div");summary.className="artifact-review-opinion-summary";if(opinion.renderedSummary)summary.innerHTML=opinion.renderedSummary;else summary.textContent=opinion.summary;section.append(summary);wrap.append(section);
    }
    const section=document.createElement("section");section.className="artifact-review-opinion-section";const heading=document.createElement("h4");const comments=opinion.comments||[];heading.textContent=`${english?"Specific comments":"具体意见"}（${comments.length}）`;section.append(heading);
    const list=document.createElement("div");list.className="artifact-review-opinion-comments";
    for(const comment of comments){const card=commentCard(this.#ui,comment,"",tr(this.#config,"locate"),this.reviewDialog??this.#root);const severity=document.createElement("span");severity.className="artifact-review-comment-severity";severity.textContent=severityLabel(this.#config,comment.severity);card.prepend(severity);list.append(card);}
    if(!comments.length){const empty=textBlock(english?"No specific comments":"无具体意见");empty.className="artifact-review-opinion-empty";list.append(empty);}section.append(list);wrap.append(section);return wrap;
  }
  async #agentActivity(review: Json, round: Json, assignment: Json, selectedKey: string, isCurrent: () => boolean): Promise<HTMLElement> {
    const attempts = assignment.attempts || [];
    const latest = attempts.at(-1);
    const wrap = document.createElement("section"); wrap.className = "artifact-review-activity";
    const head = document.createElement("div"); head.className = "artifact-review-activity-head";
    const title = document.createElement("b"); title.textContent = tr(this.#config,"activity"); head.append(title); wrap.append(head);
    if (!latest) return wrap;
    const cached = this.activities.get(selectedKey);
    const selected = attempts.some((attempt: Json) => attempt.sequence === cached?.sequence) ? cached!.sequence : latest.sequence;
    head.append(chooser(this.#ui,"artifact-review-attempt-select",tr(this.#config,"selectAttempt"),
      `${tr(this.#config,"attempt")} ${selected} · ${assignmentStatus(this.#config,attempts.find((attempt: Json) => attempt.sequence === selected) || latest)}`,
      attempts.map((attempt: Json) => ({ id: String(attempt.sequence), label: `${tr(this.#config,"attempt")} ${attempt.sequence} · ${assignmentStatus(this.#config,attempt)}`, selected: attempt.sequence === selected })), sequence => {
        this.activities.set(selectedKey, { sequence: Number(sequence) });
        this.renderReview(this.#detail?.id || this.#route.params.runId || "", review.id);
      }));
    const log = cached && cached.sequence === selected && cached.log instanceof HTMLElement ? cached.log.cloneNode(true) as HTMLElement : document.createElement("div");
    log.className = "artifact-review-activity-log";
    const cursor = cached && cached.sequence === selected ? cached.cursor || 0 : 0;
    const response = await this.#request(`/api/artifact-reviews/${encodeURIComponent(review.id)}/rounds/${encodeURIComponent(round.id)}/assignments/${encodeURIComponent(assignment.actorId)}/attempts/${encodeURIComponent(selected)}/activity?cursor=${encodeURIComponent(cursor)}&limit=500`);
    this.#appendActivityEvents(log, response.events || []);
    if (isCurrent()) this.activities.set(selectedKey, { sequence: selected, cursor: response.nextCursor ?? cursor, reviewId: review.id, roundId: round.id, actorId: assignment.actorId, log });
    wrap.append(log); return wrap;
  }
  async pollActivities():Promise<void>{for(const entry of this.activities.values()){const log=entry.log;if(!(log instanceof HTMLElement)||!log.isConnected||log.closest("[hidden]"))continue;try{const response=await this.#request(`/api/artifact-reviews/${encodeURIComponent(entry.reviewId)}/rounds/${encodeURIComponent(entry.roundId)}/assignments/${encodeURIComponent(entry.actorId)}/attempts/${encodeURIComponent(entry.sequence)}/activity?cursor=${encodeURIComponent(entry.cursor||0)}&limit=500`);const pinned=log.scrollHeight-log.clientHeight-log.scrollTop<20;const top=log.scrollTop;this.#appendActivityEvents(log,response.events||[]);entry.cursor=response.nextCursor||entry.cursor;if(pinned)log.scrollTop=log.scrollHeight;else log.scrollTop=top;}catch(error){if(!this.#controller.signal.aborted)console.error("Unable to refresh Agent Activity",error);}}}
  #appendActivityEvents(log:HTMLElement,events:Json[]):void{for(const event of events){const existing=log.querySelector(`[data-event-id="${CSS.escape(String(event.id||""))}"]`);existing?.remove();const item=document.createElement("article");item.className="artifact-review-activity-event";item.dataset.kind=event.kind;item.dataset.eventId=event.id||"";const eventHead=document.createElement("div");eventHead.className="artifact-review-activity-event-head";const kind=document.createElement("span");kind.className="artifact-review-activity-kind";kind.textContent=tr(this.#config,event.kind);const time=document.createElement("time");time.textContent=formatTime(event.updatedAt);eventHead.append(kind,time);const eventTitle=document.createElement("b");eventTitle.className="artifact-review-activity-event-title";eventTitle.textContent=event.title||"";item.append(eventHead,eventTitle);if(event.body)item.append(textBlock(event.body));if(event.plan?.length){const list=document.createElement("ol");for(const plan of event.plan){const li=document.createElement("li");li.textContent=`${plan.content} · ${plan.status}`;list.append(li);}item.append(list);}log.append(item);}}
  #assignmentUrl(context:Json,operation:string):string{return `/api/artifact-reviews/${encodeURIComponent(context.review.id)}/rounds/${encodeURIComponent(context.review.currentRoundId)}/assignments/${encodeURIComponent(context.assignment.actorId)}/${operation}`;}
}

function tr(config: Readonly<RunConfig>, key: string): string { const candidate=config.messages?.[key];return typeof candidate==="string"?candidate:((config.locale||document.documentElement.lang).startsWith("en")?en:zh)[key]||key; }
function projectApiUrl(config: Readonly<RunConfig>, path: string): string { return path.startsWith("/api/") && config.projectApiBase ? `${config.projectApiBase}${path.slice(4)}` : path; }
function normalizedRunStatus(value: unknown): string { return ["running", "done", "abandoned", "archived"].includes(String(value)) ? String(value) : "running"; }
function displayName(run:Json):string{return String(run.name||run.procedureName||run.id||"");}function shortId(id:string):string{return String(id||"").replace(/^run-/,"").slice(0,18);}
function formatTime(value:unknown):string{if(!value)return "—";const date=new Date(String(value));return Number.isNaN(date.valueOf())?String(value):date.toLocaleString();}
function pill(text:string,kind=""):HTMLElement{const span=document.createElement("span");span.className=`run-pill ${kind}`;span.textContent=text;return span;}
function textBlock(value:unknown):HTMLElement{const p=document.createElement("p");p.textContent=typeof value==="string"?value:JSON.stringify(value,null,2);return p;}
function section(id:string,title:string):HTMLElement{const result=document.createElement("section");result.id=id;result.className="artifact-review-operation-group";const h=document.createElement("h3");h.textContent=title;result.append(h);return result;}
function reviewCard(id:string,title:string):HTMLElement{const result=document.createElement("section");result.id=id;result.className="artifact-review-card";const h=document.createElement("h3");h.textContent=title;result.append(h);return result;}
function cardLabel(label:string):HTMLElement{const result=document.createElement("span");result.className="artifact-review-card-label";result.textContent=label;return result;}

function reviewStatus(config:Readonly<RunConfig>,status:unknown):string{const labels:Record<string,[string,string]>={pending:["待评审","Pending"],in_progress:["评审中","In review"],awaiting_revision:["需修改","Changes requested"],changes_requested:["需修改","Changes requested"],passed:["已通过","Passed"],approved:["已通过","Approved"],completed:["已完成","Completed"],submitted:["已提交","Submitted"],failed:["执行失败","Failed"],queued:["等待启动","Queued"],awaiting_runner_vote:["等待最终决策","Awaiting final decision"],cancelled:["已取消","Cancelled"]};const label=labels[String(status||"")];return label?(config.locale?.startsWith("en")?label[1]:label[0]):String(status||"—");}
function voteLabel(config:Readonly<RunConfig>,vote:unknown):string{const labels:Record<string,string>={approve:"approve",request_changes:"requestChanges",abstain:"abstain"};return vote?tr(config,labels[String(vote)]||String(vote)):tr(config,"pendingVote");}
function countValue(value:unknown):number{return Array.isArray(value)?value.length:Number(value||0);}
function roundSubmitted(round:Json):number{return Number(round?.submitted||(round?.assignments||[]).filter((assignment:Json)=>assignment.status==="submitted"||assignment.submitted).length);}
function roundTotal(round:Json):number{return Number(round?.total||(round?.assignments||[]).length);}
function roundProgress(config:Readonly<RunConfig>,round:Json):string{const submitted=roundSubmitted(round);const total=roundTotal(round);const status=String(round?.result?.status||round?.status||"");const completed=Boolean(round?.result)||["approved","completed","passed","changes_requested","cancelled"].includes(status);const readiness=completed?tr(config,"reviewComplete"):(round?.decisionReady||(total>0&&submitted>=total)?tr(config,"decisionReady"):tr(config,"waitingReviews"));return `${submitted}/${total} · ${readiness} · ${tr(config,"blockingComments")} ${countValue(round?.blockingComments??round?.severity?.blocking)} · ${tr(config,"unresolved")} ${countValue(round?.unresolvedBlocking)} · ${tr(config,"environmentFailures")} ${countValue(round?.failures)} · ${tr(config,"repeatedAdvisories")} ${countValue(round?.repeatedAdvisories)}`;}
function reviewStateBadge(config:Readonly<RunConfig>,status:unknown):HTMLElement{const badge=pill(reviewStatus(config,status));badge.classList.add("artifact-review-status");badge.dataset.status=String(status||"");return badge;}

function selectedRound(context:Json,roundId:string):Json{const round=(context.rounds||[]).find((round:Json)=>round.id===roundId)||(context.rounds||[]).find((round:Json)=>round.id===context.review?.currentRoundId);if(!round)return context.review?.round||{};const vote=round.votes?.find((vote:Json)=>vote.subject?.kind==="runner");return {...(context.review?.round?.id===round.id?context.review.round:{}),...round,...(vote?{runner:{actorName:"Runner",vote:vote.value,status:"submitted"}}:{})};}
function materials(context:Json):Json[]{return [{key:"candidate",artifact:context.submission?.artifact||{},commentable:true},{key:"contract",artifact:context.submission?.contractArtifact||{},commentable:false},...(context.submission?.contextArtifacts||[]).map((item:Json,index:number)=>({key:`context:${index}`,artifact:item.artifact||{},reviewContext:item.reviewContext,commentable:false}))];}
function materialLabel(config:Readonly<RunConfig>,material:Json|undefined):string{if(!material)return "—";const prefix=material.key==="candidate"?tr(config,"candidate"):material.key==="contract"?tr(config,"contract"):tr(config,"earlier");return `${prefix} · ${material.artifact?.name||"Artifact"}`;}
function artifactFormatLabel(config:Readonly<RunConfig>,artifact:Json):string{const raw=typeof artifact.format==="object"?artifact.format?.name:artifact.format;const format=String(raw||artifact.contentType||"").toLowerCase();return format.includes("markdown")||format==="md"?tr(config,"document"):(format||tr(config,"document"));}
function assignmentName(assignment:Json|undefined):string{return assignment?.slotNames?.join?.(" / ")||assignment?.slotIds?.join?.(" / ")||assignment?.actorName||assignment?.actorId||"";}
function assignmentSubmitted(assignment:Json|undefined):boolean{return Boolean(assignment&&(assignment.status==="submitted"||assignment.submitted));}
function assignmentStatus(config:Readonly<RunConfig>,assignment:Json):string{return tr(config,assignment.status)||String(assignment.status||"");}
function severityLabel(config:Readonly<RunConfig>,severity:unknown):string{return tr(config,{blocking:"severityBlocking",risk:"severityRisk",suggestion:"severitySuggestion"}[String(severity||"")]||"severityRisk");}
function safeId(value:unknown):string{return String(value||"").replace(/[^a-zA-Z0-9_-]/g,"-");}
function commentCard(ui:ViewUi,comment:Json,label="",locateLabel="Locate",scope:ParentNode=document):HTMLElement{const card=document.createElement("article");card.className="comment-card";const head=document.createElement("div");head.className="comment-card-head";if(label){const title=document.createElement("span");title.textContent=label;head.append(title);}if(comment.anchor){const locate=ui.button({label:{text:locateLabel},run:()=>{const anchor=typeof comment.anchor==="string"?comment.anchor:comment.anchor.target;const target=scope.querySelector(`[data-anchor="${CSS.escape(anchor||"")}"]`);if(target instanceof HTMLElement){target.scrollIntoView({block:"center"});target.classList.add("artifact-review-target-located");setTimeout(()=>target.classList.remove("artifact-review-target-located"),1800);}}});locate.classList.add("artifact-review-locate");head.append(locate);}if(head.childElementCount)card.append(head);const body=document.createElement("div");body.className="comment-card-body";body.textContent=comment.body||"";card.append(body);return card;}
function chooser(ui:ViewUi,className:string,label:string,current:string,items:Array<{id:string;label:string;selected:boolean}>,onSelect:(id:string)=>void|Promise<void>,_role:"combobox"|"button"="combobox"):HTMLElement{
  const selected=items.find(item=>item.selected)?.id??items.find(item=>item.label===current)?.id??"";
  const field=ui.select({label:{text:label},value:selected,placeholder:selected?undefined:{text:current},options:items.map(item=>({value:item.id,label:{text:item.label}})),onChange:onSelect});
  field.root.classList.add("artifact-review-round-select",className);field.control.classList.add("artifact-review-field-control");
  if(className==="artifact-review-attempt-select")for(const id of (field.control.getAttribute("aria-labelledby")||"").split(/\s+/).filter(Boolean))field.root.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.classList.add("artifact-review-visually-hidden");
  for(const option of field.control.options){if(className.includes("actor"))option.dataset.actorId=option.value;if(className.includes("round-select"))option.dataset.roundId=option.value;}
  return field.root;
}
function reviewSummary(run:Json|null):Json|null{return run?.artifactReview||run?.artifactReviews?.[0]||null;}
function currentStep(run:Json):Json|null{if(run.status!=="running")return null;const frame=run.stack?.at?.(-1)||run.stack?.[run.stack.length-1];return frame?.steps?.[frame.index]||null;}
function flattenSteps(steps:Json[]):Json[]{const out:Json[]=[];for(const step of steps){out.push(step);out.push(...flattenSteps(step.branches?.truthy||[]),...flattenSteps(step.branches?.falsy||[]),...flattenSteps(step.loop?.body||[]));}return out;}
function renderArtifact(event:Json):HTMLElement{const card=document.createElement("article");card.className="run-artifact task-result";const h=document.createElement("h3");h.textContent=event.artifact?.name||event.stepId||"Artifact";card.append(h,renderArtifactValue(event.artifact));return card;}
function renderArtifactValue(artifact:Json):HTMLElement{const wrap=document.createElement("div");wrap.className="artifact-review-artifact-content";if(typeof artifact?.renderedContent==="string"){wrap.classList.add("markdown-body");wrap.innerHTML=artifact.renderedContent;}else{const pre=document.createElement("pre");pre.className="run-pre";const value=artifact?.value??artifact?.content??artifact;pre.textContent=typeof value==="string"?value:JSON.stringify(value,null,2);wrap.append(pre);}return wrap;}
