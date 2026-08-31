import {
  defineViewPlugin,
  slots,
  type RouteLocation,
  type RouteToken,
  type ViewMount,
  type ViewPluginContext
} from "@memsphere/view-sdk";
import { createRunDetailState, renderRunDetail } from "./run-detail.js";
import { runDetailStyles } from "./run-styles.js";

type Json = Record<string, any>;
type RunConfig = { locale?: string; messages?: Readonly<Record<string, string>> };
type RunRoutes = { index: RouteToken; detail: RouteToken; review: RouteToken };
type Navigate = (target: ReturnType<RouteToken["to"]>) => Promise<void>;

const zh: Readonly<Record<string, string>> = Object.freeze({
  run: "运行", running: "运行中", done: "已完成", abandoned: "已废弃",
  loading: "加载中…", empty: "当前状态下没有 Run。", choose: "选择一个 Run 查看详情。",
  retry: "重试", archive: "归档", abandon: "废弃", review: "产物评审",
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
  resizeReview: "调整产物与评审区域宽度", viewDetails: "查看详情", hideDetails: "收起详情",
  activity: "运行记录", selectAttempt: "选择尝试", attempt: "尝试",
  message: "消息", tool: "工具调用", plan: "执行计划", lifecycle: "运行状态",
  submitted: "已提交", failed: "执行失败", pending: "等待启动",
  materialTitle: "评审材料", reviewTime: "评审时间", myReview: "我的评审",
  participationProgress: "参与进度", reviewRecord: "评审记录", submittedOpinions: "已提交意见",
  runner: "执行者", decision: "决策票", advisory: "建议票", agent: "Agent",
  pendingVote: "待投票", decisionReady: "决策票已就绪", reviewComplete: "评审已完成", waitingReviews: "仍在等待评审",
  blockingComments: "阻塞意见", unresolved: "未处置", environmentFailures: "环境失败",
  repeatedAdvisories: "重复建议组", voteSummary: "投票摘要", implementationEvidence: "实现证据",
  referenced: "已引用", notReferenced: "未引用", file: "文件", document: "文档",
  inline: "内联", roundSummary: "本轮汇总"
});

const en: Readonly<Record<string, string>> = Object.freeze({
  run: "Runs", running: "Running", done: "Done", abandoned: "Abandoned",
  loading: "Loading…", empty: "No runs in this status.", choose: "Choose a run to inspect.",
  retry: "Retry", archive: "Archive", abandon: "Abandon", review: "Artifact review",
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
  resizeReview: "Resize artifact and review panes", viewDetails: "View details", hideDetails: "Hide details",
  activity: "Activity", selectAttempt: "Select attempt", attempt: "Attempt",
  message: "Message", tool: "Tool call", plan: "Plan", lifecycle: "Lifecycle",
  submitted: "Submitted", failed: "Failed", pending: "Queued",
  materialTitle: "Review material", reviewTime: "Review time", myReview: "My review",
  participationProgress: "Participation progress", reviewRecord: "Review record", submittedOpinions: "Submitted opinions",
  runner: "Runner", decision: "Decision", advisory: "Advisory", agent: "Agent",
  pendingVote: "Pending vote", decisionReady: "Decision votes are ready", reviewComplete: "Review completed", waitingReviews: "Waiting for reviews",
  blockingComments: "Blocking comments", unresolved: "Unresolved", environmentFailures: "Environment failures",
  repeatedAdvisories: "Repeated advisory groups", voteSummary: "Vote summary", implementationEvidence: "Implementation evidence",
  referenced: "Referenced", notReferenced: "Not referenced", file: "File", document: "Document",
  inline: "Inline", roundSummary: "Round summary"
});

const styles = `
  .run-module{--surface:#fff;--soft:#f1f3ef;--line:#dce0da;--text:#242829;--muted:#70777a;--accent:#286c67;--danger:#a14436;color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,sans-serif;min-width:0;max-width:100%;min-height:100%;overflow-x:hidden;background:#f7f8f5}
  .run-module *{box-sizing:border-box}.run-module button,.run-module textarea,.run-module select{font:inherit}.run-module button{cursor:pointer}
  .run-layout{display:grid;grid-template-columns:300px minmax(0,1fr);min-height:100vh}.run-sidebar{position:sticky;top:0;height:100vh;overflow:auto;padding:16px;border-right:1px solid var(--line);background:#fbfbf8}
  .run-status-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:3px;background:var(--soft);border:1px solid var(--line);border-radius:7px}.run-status-tab{border:0;border-radius:5px;padding:7px 4px;background:transparent;color:var(--muted)}.run-status-tab.active{background:var(--surface);color:var(--text);font-weight:700;box-shadow:0 1px 2px #0001}
  .run-list{display:grid;gap:7px;margin-top:14px}.run-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;border:1px solid transparent;border-radius:7px}.run-card.active{border-color:#aec8c3;background:#e5f0ed}.run-card-main{border:0;background:transparent;text-align:left;padding:9px;min-width:0}.run-card-main b,.run-card-main span{display:block;overflow:hidden;text-overflow:ellipsis}.run-card-main span,.muted{color:var(--muted);font-size:12px}.run-card-action{align-self:center;margin-right:6px;border:1px solid var(--line);border-radius:5px;background:var(--surface);padding:5px 7px;color:var(--muted)}
  .run-workspace,.run-workspace>*{min-width:0;max-width:100%}.run-workspace{padding:24px 30px 60px}.run-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:18px}.run-title{margin:0;font-size:26px;min-width:0;overflow-wrap:anywhere}.run-subtitle{min-width:0;margin-top:5px;color:var(--muted);overflow-wrap:anywhere}.run-panel,.run-error,.run-step,.run-artifact{min-width:0;max-width:100%;overflow-wrap:anywhere;margin:12px 0;padding:15px;border:1px solid var(--line);border-radius:8px;background:var(--surface);box-shadow:0 1px 2px #0000000b}.run-error{border-left:4px solid var(--danger)}
  .run-meta{display:flex;flex-wrap:wrap;gap:6px}.run-pill{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:2px 8px;background:var(--soft);color:var(--muted);font-size:11px}.run-pill.running{color:var(--accent);border-color:#a9c8c2}.run-pill.abandoned{color:#7b5a1e;background:#fff6db}.run-pill.done{color:#315f42;background:#e8f4ea}.run-meta-action{display:inline-flex;align-items:center;border:1px solid #bcc5c1;border-radius:6px;background:var(--surface);color:#485352;padding:5px 10px;font-size:12px;font-weight:600;box-shadow:0 1px 2px #00000012}.run-meta-action:hover{border-color:#829d98;background:#f5f8f6;color:#173f3c}.run-meta-action.primary{border-color:#79a9a1;background:#eef7f4;color:#1f625d}.run-meta-action:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .run-section-title{font-weight:750;margin:18px 0 7px}.run-flow{display:grid;gap:8px;min-width:0}.run-step.current{border-left:4px solid var(--accent)}.run-step h3,.run-artifact h3{min-width:0;margin:0 0 7px;font-size:15px;overflow-wrap:anywhere}.run-pre{max-width:100%;padding:11px;border-radius:6px;background:#f3f4f1;white-space:pre-wrap;overflow:auto;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace}.artifact-review-artifact-content{min-width:0;max-width:100%;overflow-wrap:anywhere}.artifact-review-artifact-content table{display:block;max-width:100%;overflow:auto}.run-btn{border:1px solid var(--line);border-radius:6px;background:var(--surface);padding:7px 10px}.run-btn.primary{border-color:var(--accent);background:var(--accent);color:#fff}.run-btn.danger{color:var(--danger)}
  dialog.artifact-review-modal,dialog.artifact-review-dialog{--surface:#fff;--soft:#f1f3ef;--line:#dce0da;--text:#242829;--muted:#70777a;--accent:#286c67;--danger:#a14436;color:var(--text);background:var(--surface);font:14px/1.45 ui-sans-serif,system-ui,sans-serif}
  dialog.artifact-review-modal *,dialog.artifact-review-dialog *{box-sizing:border-box}
  dialog.artifact-review-modal{width:90vw;max-width:none;height:90dvh;max-height:none;margin:auto;padding:0;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--text);box-shadow:0 24px 80px #191e233d;overflow:hidden}dialog.artifact-review-modal::backdrop{background:#1d262980}.artifact-review-shell{display:grid;grid-template-rows:auto auto auto minmax(0,1fr);height:100%;background:var(--surface)}.artifact-review-head{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line);background:var(--surface)}.artifact-review-head h2{margin:0;font-size:18px}.artifact-review-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 18px;border-bottom:1px solid var(--line);background:var(--surface)}.artifact-review-mobile-tabs{display:none}.artifact-review-body{display:grid;grid-template-columns:minmax(0,var(--artifact-review-left,58%)) 7px minmax(330px,1fr);min-height:0;background:var(--surface)}.artifact-review-modal-pane{min-width:0;overflow-x:hidden;overflow-y:auto;padding:18px;overscroll-behavior:contain;background:var(--surface)}#artifact-review-review-pane{background:#fbfbf8}.artifact-review-divider{background:var(--line);cursor:col-resize}.artifact-review-operation-group{border-top:1px solid var(--line);padding:12px 0}.artifact-review-row{padding:9px 0;border-bottom:1px solid var(--line)}.artifact-review-row-main{display:grid;gap:3px}.artifact-review-comment textarea{width:100%;min-height:90px;padding:10px 11px;border:1px solid #aebbb7;border-radius:7px;background:#fff;box-shadow:inset 0 1px 2px #17211f0a}.artifact-review-comment textarea:focus{border-color:var(--accent);outline:2px solid #286c6726;outline-offset:0}.artifact-review-actions,.artifact-review-vote{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}.artifact-review-actions>.run-btn:not(.primary){border-color:#b9c3bf;background:#f7f8f5;font-weight:650;box-shadow:0 1px 2px #17211f12}.artifact-review-actions>.run-btn:not(.primary):hover{border-color:#7f9994;background:#f1f6f4}.artifact-review-submit-area{margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}.artifact-review-vote label{display:inline-flex;gap:5px;align-items:center}.artifact-review-target{position:relative;padding:4px}.inline-plus{position:absolute;right:3px;top:3px;border:0;border-radius:50%;background:#dfeae7}.inline-plus::before{content:"+"}.artifact-review-target-located,.artifact-review-opinion-located{outline:3px solid #e6b85b;outline-offset:2px}.artifact-review-message.warn{color:var(--danger)}
  dialog.artifact-review-dialog{width:min(460px,calc(100vw - 32px));padding:0;border:1px solid var(--line);border-radius:8px;box-shadow:0 20px 60px #191e233d}dialog.artifact-review-dialog::backdrop{background:#161c1e57}.artifact-review-dialog-body{display:grid;gap:12px;padding:18px}.artifact-review-dialog-body h3{margin:0;font-size:18px}
  .artifact-review-heading{min-width:0;display:grid;gap:4px}.artifact-review-heading h2{margin:0}.artifact-review-subtitle{color:var(--muted);font-size:13px;overflow-wrap:anywhere}.artifact-review-material-heading{margin:0 0 10px;font-size:16px}.artifact-review-material-meta{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0}.artifact-review-material-path{display:block;margin:8px 0;padding:7px 10px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:12px;overflow-wrap:anywhere}.artifact-review-material-time{display:inline-block;margin-bottom:12px;color:var(--muted);font-size:12px}.artifact-review-artifact-frame{padding:12px;border:1px solid var(--line);border-radius:8px;background:#f8f9f6}
  .artifact-review-card{margin:0 0 34px;padding:14px;border:1px solid var(--line);border-radius:8px;background:var(--surface);box-shadow:0 1px 2px #0000000b}.artifact-review-card>h3{margin:0 0 12px;font-size:16px}.artifact-review-card-label{display:block;margin:10px 0 6px;color:var(--muted);font-size:12px;font-weight:700}.artifact-review-card-line{margin:6px 0;overflow-wrap:anywhere}.artifact-review-card .artifact-review-row:last-child{border-bottom:0}.artifact-review-progress-summary{margin:8px 0 12px;padding:9px 10px;border-radius:7px;background:var(--soft);color:var(--muted);font-size:12px}.artifact-review-participant{padding:12px 0;border-top:1px solid var(--line)}.artifact-review-participant:first-of-type{border-top:0}.artifact-review-participant-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.artifact-review-participant-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:5px}.artifact-review-opinion{margin-top:9px;padding:10px;border-left:3px solid #b8cbc7;background:#f7f9f6;white-space:pre-wrap;overflow-wrap:anywhere}.artifact-review-opinion h1,.artifact-review-opinion h2,.artifact-review-opinion h3{font-size:1em}.artifact-review-opinion p:first-child{margin-top:0}.artifact-review-opinion p:last-child{margin-bottom:0}.artifact-review-comment-severity{display:inline-block;margin-right:7px;border-radius:999px;padding:1px 7px;background:#fff0eb;color:var(--danger);font-size:11px}.artifact-review-result-summary{padding:10px;border-radius:7px;background:var(--soft)}
  .artifact-review-round-select{position:relative}.artifact-review-select{min-width:180px;display:flex;justify-content:space-between;gap:10px;border:1px solid var(--line);border-radius:6px;background:#fff;padding:7px 9px}.artifact-review-select-menu{position:absolute;z-index:10;top:calc(100% + 3px);left:0;min-width:100%;max-width:360px;padding:4px;border:1px solid var(--line);border-radius:7px;background:#fff;box-shadow:0 8px 24px #0002}.artifact-review-select-option{display:block;width:100%;border:0;background:transparent;text-align:left;padding:7px;border-radius:4px;white-space:nowrap}.artifact-review-select-option:hover,.artifact-review-select-option[aria-selected=true]{background:var(--soft)}.comment-card{display:grid;gap:5px;padding:11px 12px;margin:8px 0;border:1px solid #c7d8d4;border-left:3px solid var(--accent);border-radius:7px;background:#f2f8f6;box-shadow:0 1px 2px #17211f0a}.comment-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--accent);font-size:12px;font-weight:700}.comment-card-body{white-space:pre-wrap;overflow-wrap:anywhere}.artifact-review-activity{margin-top:9px;padding:9px;background:var(--soft);border-radius:7px}.artifact-review-activity-head,.artifact-review-activity-event-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.artifact-review-activity-log{max-height:240px;overflow:auto}.artifact-review-activity-event{display:grid;gap:4px;padding:8px 0;border-bottom:1px solid var(--line)}.artifact-review-activity-event-title{display:block}
  .artifact-review-select{width:100%;min-width:0;align-items:center;color:var(--text);text-align:left;cursor:pointer}.artifact-review-select:hover{border-color:#aeb8b4}.artifact-review-select:focus-visible,.artifact-review-select[aria-expanded=true]{outline:0;border-color:var(--accent);box-shadow:0 0 0 2px #dfeeea}.artifact-review-select-caret{flex:0 0 auto;color:var(--muted);font-size:13px;line-height:1}.artifact-review-select-menu{right:0;z-index:30;display:grid;gap:2px;max-width:none;max-height:240px;overflow-y:auto}.artifact-review-select-menu[hidden]{display:none}.artifact-review-select-option{color:var(--text)}.artifact-review-select-option:hover,.artifact-review-select-option:focus-visible{outline:0;background:var(--soft)}.artifact-review-select-option[aria-selected=true]{background:#dfeeea;color:#173f3c;font-weight:700}.artifact-review-material-select{width:min(100%,520px)}.artifact-review-actor-select{width:min(100%,280px)}.artifact-review-attempt-select{width:min(100%,260px)}.artifact-review-severity-select{width:100%;margin-bottom:7px}
  .artifact-review-vote{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.artifact-review-vote .run-btn{min-width:0;padding:9px 7px;border-color:#b9c3bf;background:#fff;color:var(--text);font-weight:650;box-shadow:0 1px 2px #17211f12}.artifact-review-vote .run-btn:hover{border-color:#7f9994;background:#f1f6f4}.artifact-review-vote .run-btn.active{border-color:var(--accent);background:#dfeeea;color:#173f3c;font-weight:750;box-shadow:inset 0 0 0 1px var(--accent)}.artifact-review-vote .run-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .artifact-review-activity-toggle{flex:0 0 auto;border:0;background:transparent;color:var(--accent);padding:1px 0;font-size:12px}.artifact-review-activity-toggle:hover,.artifact-review-activity-toggle:focus-visible{text-decoration:underline;text-underline-offset:2px;outline:0}.artifact-review-row>.artifact-review-activity{margin-top:10px}
  .artifact-review-artifact-frame{padding:0;border:0;background:transparent}.markdown-body{min-width:0;max-width:100%;margin:8px 0 0;padding:10px 12px;border:1px solid var(--line);border-radius:6px;background:#f3f5f0;line-height:1.55;overflow-wrap:anywhere}.markdown-body>:first-child{margin-top:0}.markdown-body>:last-child{margin-bottom:0}.markdown-body p{margin:6px 0}.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4,.markdown-body h5,.markdown-body h6{margin:12px 0 6px;line-height:1.3;font-weight:800}.markdown-body h1{font-size:21px}.markdown-body h2{font-size:18px}.markdown-body h3{font-size:16px}.markdown-body h4,.markdown-body h5,.markdown-body h6{font-size:14px}.markdown-body ul,.markdown-body ol{margin:6px 0;padding-left:22px}.markdown-body li{margin:3px 0}.markdown-body blockquote{margin:8px 0;padding:2px 12px;border-left:3px solid var(--line);color:var(--muted)}.markdown-body code{border:1px solid var(--line);border-radius:4px;background:#e9ece6;padding:1px 4px;font:12px ui-monospace,monospace}.markdown-body pre{max-width:100%;margin:8px 0;padding:9px 10px;border:1px solid var(--line);border-radius:6px;background:#e9ece6;white-space:pre-wrap;overflow:auto}.markdown-body pre code{border:0;background:none;padding:0;white-space:inherit}.markdown-body table{display:table;width:max-content;min-width:100%;border-collapse:collapse;background:#fff}.markdown-body th,.markdown-body td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}.artifact-review-commentable{display:grid;grid-template-columns:24px minmax(0,1fr);gap:7px;align-items:start;width:100%;scroll-margin-top:16px}.artifact-review-commentable-body{min-width:0;max-width:100%;overflow-wrap:anywhere}.artifact-review-commentable>.inline-plus{position:static;width:20px;height:20px;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--muted);padding:0;line-height:16px;opacity:0;transition:opacity 120ms ease,border-color 120ms ease,color 120ms ease}.artifact-review-commentable:hover>.inline-plus,.artifact-review-commentable>.inline-plus:focus,.artifact-review-commentable>.inline-plus[aria-expanded=true]{opacity:1}.artifact-review-commentable>.inline-plus:hover{border-color:var(--accent);color:var(--accent)}.artifact-review-commentable>.inline-comment-editor{grid-column:2;width:100%;margin-top:4px;padding:10px;border:1px solid #c7d8d4;border-radius:8px;background:#f7faf8;box-shadow:0 1px 3px #17211f12}.inline-comment-editor textarea{width:100%;min-height:76px;margin:0;padding:10px 11px;border:1px solid #aebbb7;border-radius:7px;background:#fff}.inline-comment-editor textarea:focus{border-color:var(--accent);outline:2px solid #286c6726}.inline-comment-actions{display:flex;gap:7px;margin-top:8px}.comment-card-head>.artifact-review-locate{flex:0 0 auto;width:auto;padding:1px 3px;border:0;background:transparent;color:var(--accent);font-size:12px;font-weight:500;box-shadow:none}.comment-card-head>.artifact-review-locate:hover{text-decoration:underline;text-underline-offset:2px}.artifact-review-target{padding:0}.artifact-review-target-located{background:#edf6f3;box-shadow:0 0 0 3px #286c6733;outline:0}
  @media(max-width:820px){.run-layout{display:block}.run-sidebar{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}.run-workspace{padding:18px 14px 40px}.artifact-review-mobile-tabs{display:flex;gap:5px;padding:8px;border-bottom:1px solid var(--line)}.artifact-review-body{display:block}.artifact-review-divider{display:none}.artifact-review-modal-pane{height:calc(90dvh - 116px)}.artifact-review-modal-pane[hidden]{display:none}}
`;

export default defineViewPlugin<RunConfig>({
  name: "memsphere-run-view",
  apiVersion: 1,
  inject: ["slots", "router"],
  apply(ctx, config) {
    if (!ctx.router) throw new Error("Run View requires the router service");
    const navigate:Navigate=target=>ctx.router!.navigate(target);
    const routes: RunRoutes = {
      index: ctx.router.register({ id: "index", path: "/tasks" }),
      detail: ctx.router.register({ id: "detail", path: "/tasks/:runId" }),
      review: ctx.router.register({ id: "artifact-review", path: "/tasks/:runId/artifact-reviews/:reviewId" })
    };
    ctx.slots.register(slots.navigationPrimary, {
      id: "run.navigation", order: 200,
      value: { label: { text: tr(config, "run") }, icon: { kind: "system", name: "play" }, route: routes.index.to() }
    });
    registerPage(ctx, routes.index, "run.index", config, routes,navigate);
    registerPage(ctx, routes.detail, "run.detail", config, routes,navigate);
    registerPage(ctx, routes.review, "run.review", config, routes,navigate);
  }
});

function registerPage(ctx: ViewPluginContext, route: RouteToken, id: string, config: Readonly<RunConfig>, routes: RunRoutes,navigate:Navigate): void {
  ctx.slots.register(slots.headerTitle, {
    id: `${id}.header`, when: route.activation, value: { title: { text: tr(config, id === "run.review" ? "review" : "run") } }
  });
  ctx.slots.register(slots.mainView, {
    id, key: route.key, when: route.activation, value: createMount(config, routes,navigate)
  });
}

function createMount(config: Readonly<RunConfig>, routes: RunRoutes,navigate:Navigate): ViewMount {
  return {
    async mount({ element, portal }, context) {
      const controller = new AbortController();
      element.classList.add("run-module");
      const style = document.createElement("style"); style.textContent = styles + runDetailStyles; element.append(style);
      const app = new RunApplication(element, portal, config, routes, context.route, controller,navigate);
      await app.start();
      return () => { controller.abort(); app.dispose(); element.classList.remove("run-module"); element.replaceChildren(); portal.replaceChildren(); };
    }
  };
}

class RunApplication {
  readonly #root: HTMLElement; readonly #portal: HTMLElement; readonly #config: Readonly<RunConfig>;
  readonly #routes: RunRoutes; readonly #route: RouteLocation; readonly #controller: AbortController;readonly #navigate:Navigate;
  #runs: Json[] = []; #detail: Json | null = null; #status = "running"; #poll = 0; #busy = false;
  #detailError = ""; #detailErrorRunId = "";
  #reviewContext: Json | null = null; #reviewDialog: HTMLDialogElement | null = null;
  #reviewRoundId = ""; #reviewMaterial = "candidate";
  #activities = new Map<string, Json>();
  #composerByActor = new Map<string,string>();
  #severityByActor = new Map<string,string>();
  #runDetailState = createRunDetailState();
  constructor(root: HTMLElement, portal: HTMLElement, config: Readonly<RunConfig>, routes: RunRoutes, route: RouteLocation, controller: AbortController,navigate:Navigate) {
    this.#root=root; this.#portal=portal; this.#config=config; this.#routes=routes; this.#route=route; this.#controller=controller;this.#navigate=navigate;
  }
  async start(): Promise<void> {
    this.#renderLoading();
    const runId = this.#route.params.runId;
    await this.#load(runId, { adoptStatus: true });
    this.#render();
    if (this.#route.routeKey?.endsWith("artifact-review") && runId && this.#route.params.reviewId) {
      await this.#openReview(runId, this.#route.params.reviewId);
    }
    this.#poll = window.setInterval(() => { if(this.#busy)return;if(this.#reviewContext)void this.#pollActivities();if(!this.#root.querySelector(":focus"))void this.#refresh(); }, 4000);
  }
  dispose(): void { if (this.#poll) window.clearInterval(this.#poll); this.#reviewDialog?.close(); }
  async #request(path: string, init?: RequestInit): Promise<any> {
    const response = await fetch(path, { ...init, signal: this.#controller.signal });
    if (!response.ok) throw new Error((await response.text()) || `${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  async #load(runId?: string, options: { adoptStatus?: boolean; replaceMoved?: boolean } = {}): Promise<string | undefined> {
    const payload = await this.#request("/api/runs?representation=summary");
    this.#runs = payload.runs || [];
    const selected = runId ? this.#runs.find(run => run.id === runId) : undefined;
    if (options.adoptStatus && selected?.status) this.#status = selected.status;
    const visible = (run: Json | undefined): boolean => Boolean(run && run.status === this.#status && !run.archived && !run.readOnly);
    let targetId = runId;
    if (!targetId || (options.replaceMoved && !visible(selected))) targetId = this.#runs.find(visible)?.id;
    if (!targetId) { this.#detail=null;this.#detailError="";this.#detailErrorRunId="";return undefined; }
    try{const detail = await this.#request(`/api/runs/${encodeURIComponent(targetId)}`);this.#detail = detail.run;this.#detailError="";this.#detailErrorRunId="";}catch(error){this.#detail=null;this.#detailError=error instanceof Error?error.message:String(error);this.#detailErrorRunId=targetId;}
    return targetId;
  }
  async #refresh(): Promise<void> {
    try {
      const selected = this.#detail?.id;
      const replacement = await this.#load(selected, { replaceMoved: !this.#reviewContext });
      this.#render();
      if (replacement !== selected) {
        this.#reviewDialog?.close();
        this.#reviewContext = null;
        await this.#navigate(replacement ? this.#routes.detail.to({ runId: replacement }) : this.#routes.index.to());
      } else if (this.#reviewContext && replacement) {
        await this.#reloadReview(replacement);
      }
    } catch (error) { if (!this.#controller.signal.aborted) console.error("Unable to refresh Runs", error); }
  }
  #renderLoading(): void { const box=document.createElement("div"); box.className="run-panel run-loading"; box.textContent=tr(this.#config,"loading"); this.#root.append(box); }
  #render(): void {
    this.#root.querySelector(":scope > .run-loading")?.remove();
    this.#root.querySelector(".run-layout")?.remove();
    const layout=document.createElement("div"); layout.className="run-layout";
    const sidebar=document.createElement("aside"); sidebar.className="run-sidebar";
    sidebar.append(this.#renderTabs(), this.#renderList());
    const main=document.createElement("main"); main.className="run-workspace"; main.append(this.#renderDetail());
    layout.append(sidebar,main); this.#root.append(layout);
  }
  #renderTabs(): HTMLElement {
    const tabs=document.createElement("div"); tabs.className="run-status-tabs"; tabs.id="task-status-tabs"; tabs.setAttribute("role","tablist");
    for (const status of ["running","done","abandoned"]) {
      const b=document.createElement("button"); b.className=`run-status-tab${this.#status===status?" active":""}`; b.id=`${status}-task-tab`; b.setAttribute("role","tab"); b.setAttribute("aria-selected",String(this.#status===status)); b.textContent=tr(this.#config,status);
      b.onclick=()=>{this.#status=status; const first=this.#visible()[0]; this.#detail=null; this.#render(); if(first) void this.#select(first.id);}; tabs.append(b);
    } return tabs;
  }
  #visible(): Json[] { return this.#runs.filter(run=>!run.archived&&!run.readOnly&&run.status===this.#status); }
  #renderList(): HTMLElement {
    const list=document.createElement("div"); list.className="run-list"; const runs=this.#visible();
    if(!runs.length){const empty=document.createElement("p");empty.className="muted";empty.textContent=tr(this.#config,"empty");list.append(empty);return list;}
    for(const run of runs){const card=document.createElement("article");card.className=`run-card${run.id===this.#detail?.id?" active":""}`;
      const main=document.createElement("button");main.className="run-card-main";main.innerHTML=`<b></b><span></span>`;main.querySelector("b")!.textContent=displayName(run);main.querySelector("span")!.textContent=`${shortId(run.id)} · ${run.eventCount ?? 0}`;main.onclick=()=>void this.#select(run.id);
      const action=document.createElement("button");action.className="run-card-action";action.textContent=tr(this.#config,run.status==="running"?"abandon":"archive");action.onclick=event=>{event.stopPropagation();void(run.status==="running"?this.#abandon(run):this.#archive(run));};card.append(main,action);list.append(card);}
    return list;
  }
  async #select(id:string):Promise<void>{
    this.#busy=true;
    try {
      if (this.#route.params.runId !== id) {
        await this.#navigate(this.#routes.detail.to({runId:id}));
        return;
      }
      try{const payload=await this.#request(`/api/runs/${encodeURIComponent(id)}`);this.#detail=payload.run;this.#detailError="";this.#detailErrorRunId="";}
      catch(error){this.#detail=null;this.#detailError=error instanceof Error?error.message:String(error);this.#detailErrorRunId=id;}
      this.#render();
    } finally { this.#busy=false; }
  }
  #renderDetail(): HTMLElement {
    const wrap=document.createElement("div"); const run=this.#detail;
    if(!run){const empty=document.createElement("div");empty.className=this.#detailError?"run-error":"run-panel muted";empty.textContent=this.#detailError||tr(this.#config,"choose");if(this.#detailError&&this.#detailErrorRunId){const retry=button(tr(this.#config,"retry"),"primary");retry.onclick=()=>void this.#select(this.#detailErrorRunId);empty.append(document.createElement("br"),retry);}wrap.append(empty);return wrap;}
    return renderRunDetail(run, {
      locale: this.#config.locale,
      state: this.#runDetailState,
      request: (path, init) => this.#request(path, init),
      refresh: () => this.#refresh(),
      openReview: (runId, reviewId) => this.#openReview(runId, reviewId)
    });
  }
  #renderStep(step:Json,event:Json|undefined,current:boolean):HTMLElement{const card=document.createElement("article");card.className=`run-step${current?" current":""}`;card.dataset.stepId=step.id;if(current)card.dataset.currentTaskStep="true";const h=document.createElement("h3");h.textContent=step.instruction||step.artifact||step.id;const meta=document.createElement("div");meta.className="run-meta";meta.append(pill(current?tr(this.#config,"current"):event?tr(this.#config,"completed"):tr(this.#config,"notStarted")),pill(step.kind||"action"));card.append(h,meta);if(event?.artifact)card.append(renderArtifactValue(event.artifact));return card;}
  #renderBindings(run:Json):HTMLElement{const panel=document.createElement("details");panel.className="run-panel run-bindings";const summary=document.createElement("summary");summary.textContent=tr(this.#config,"binding");panel.append(summary);for(const [slot,binding] of Object.entries(run.reviewConfiguration.slots) as [string,Json][]){const row=document.createElement("div");row.className="artifact-review-row";row.textContent=`${slot}: ${binding.skip?"skip":(binding.actorIds||[]).join(", ")}`;panel.append(row);}return panel;}
  async #archive(run:Json):Promise<void>{if(!confirm(tr(this.#config,"archiveConfirm")))return;this.#busy=true;try{await this.#request(`/api/archive/runs/${encodeURIComponent(run.id)}`,{method:"POST"});await this.#refresh();}finally{this.#busy=false;}}
  async #abandon(run:Json):Promise<void>{if(!confirm(tr(this.#config,"abandonConfirm")))return;this.#busy=true;try{await this.#request(`/api/runs/${encodeURIComponent(run.id)}/abandon`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});await this.#refresh();}finally{this.#busy=false;}}
  async #openReview(runId:string,reviewId:string):Promise<void>{
    this.#busy=true;
    try{
      if(!this.#route.routeKey?.endsWith("artifact-review"))await this.#navigate(this.#routes.review.to({runId,reviewId}));
      if(this.#controller.signal.aborted)return;
      await this.#reloadReview(runId,reviewId);
      if(!this.#controller.signal.aborted)this.#renderReview(runId,reviewId);
    }finally{this.#busy=false;}
  }
  async #reloadReview(runId:string,explicitReviewId?:string):Promise<void>{
    const reviewId=explicitReviewId||this.#reviewContext?.review?.id;if(!reviewId)return;
    const summary=(this.#detail?.artifactReviewSummaries||[]).find((candidate:Json)=>candidate.id===reviewId)||reviewSummary(this.#detail);const requested=this.#reviewRoundId||new URLSearchParams(location.search).get("round")||summary?.currentRoundId||summary?.round?.id;if(!requested)return;
    const actorId=this.#reviewContext?.assignment?.actorId||localStorage.getItem(`memsphere.review.identity.${reviewId}`)||"";
    const load=async(roundId:string)=>this.#request(`/api/runs/${encodeURIComponent(runId)}/artifact-reviews/${encodeURIComponent(reviewId)}/rounds/${encodeURIComponent(roundId)}${actorId?`?actor_id=${encodeURIComponent(actorId)}`:""}`);
    try{this.#reviewContext=await load(requested);this.#reviewRoundId=requested;}catch(error){
      const fallback=summary?.currentRoundId||summary?.round?.id;if(!fallback||fallback===requested)throw error;this.#reviewContext=await load(fallback);this.#reviewRoundId=fallback;
    }
    if(this.#reviewContext&&!this.#reviewContext.assignment){const humans=(selectedRound(this.#reviewContext,this.#reviewRoundId).assignments||[]).filter((assignment:Json)=>assignment.actorKind!=="agent");if(humans.length===1){const selected=humans[0].actorId;localStorage.setItem(`memsphere.review.identity.${reviewId}`,selected);this.#reviewContext=await this.#request(`/api/runs/${encodeURIComponent(runId)}/artifact-reviews/${encodeURIComponent(reviewId)}/rounds/${encodeURIComponent(this.#reviewRoundId)}?actor_id=${encodeURIComponent(selected)}`);}}
    if(!this.#reviewContext)return;const validMaterials=new Set(materials(this.#reviewContext).map(item=>item.key));const queryMaterial=new URLSearchParams(location.search).get("material")||this.#reviewMaterial;
    this.#reviewMaterial=validMaterials.has(queryMaterial)?queryMaterial:"candidate";this.#syncReviewUrl();
  }
  #syncReviewUrl():void{const url=new URL(location.href);url.searchParams.set("round",this.#reviewRoundId);if(this.#reviewMaterial==="candidate")url.searchParams.delete("material");else url.searchParams.set("material",this.#reviewMaterial);history.replaceState(history.state,"",url);}
  #renderReview(runId:string,reviewId:string):void{
    const previous=this.#reviewDialog;previous?.remove();const context=this.#reviewContext;if(!context)return;
    const split=Math.min(75,Math.max(30,Number(localStorage.getItem("memsphere.artifactReviewSplit.v1"))||58));
    const dialog=document.createElement("dialog");dialog.className="artifact-review-modal";dialog.id="artifact-review-modal";dialog.style.setProperty("--artifact-review-left",`${split}%`);
    dialog.innerHTML=`<div class="artifact-review-shell"><header class="artifact-review-head"><div class="artifact-review-heading"><h2></h2><div class="artifact-review-subtitle"></div></div><button class="run-btn" data-close></button></header><div class="artifact-review-controls"></div><div class="artifact-review-mobile-tabs"><button id="artifact-review-artifact-tab" class="run-btn"></button><button id="artifact-review-review-tab" class="run-btn"></button></div><div class="artifact-review-body"><section id="artifact-review-artifact-pane" class="artifact-review-modal-pane"></section><div class="artifact-review-divider" role="separator" tabindex="0" aria-controls="artifact-review-artifact-pane artifact-review-review-pane"></div><section id="artifact-review-review-pane" class="artifact-review-modal-pane"></section></div></div>`;
    dialog.querySelector("h2")!.textContent=tr(this.#config,"review");(dialog.querySelector(".artifact-review-subtitle") as HTMLElement).textContent=`${context.review?.artifactName||tr(this.#config,"artifact")} · ${reviewId}`;(dialog.querySelector("[data-close]") as HTMLButtonElement).textContent=tr(this.#config,"close");
    (dialog.querySelector("#artifact-review-artifact-tab") as HTMLButtonElement).textContent=tr(this.#config,"artifactPane");(dialog.querySelector("#artifact-review-review-tab") as HTMLButtonElement).textContent=tr(this.#config,"reviewPane");
    const controls=dialog.querySelector(".artifact-review-controls") as HTMLElement;controls.append(this.#materialSelector(context,()=>this.#renderReview(runId,reviewId)));
    const divider=dialog.querySelector(".artifact-review-divider") as HTMLElement;divider.setAttribute("aria-label",tr(this.#config,"resizeReview"));divider.setAttribute("aria-valuemin","30");divider.setAttribute("aria-valuemax","75");divider.setAttribute("aria-valuenow",String(split));this.#wireDivider(divider,dialog);
    (dialog.querySelector("[data-close]") as HTMLButtonElement).onclick=()=>dialog.close();const artifactPane=dialog.querySelector("#artifact-review-artifact-pane") as HTMLElement;const reviewPane=dialog.querySelector("#artifact-review-review-pane") as HTMLElement;artifactPane.append(this.#renderMaterial(context));reviewPane.append(this.#renderReviewPanel(runId,context));
    const show=(artifact:boolean)=>{artifactPane.hidden=!artifact;reviewPane.hidden=artifact;localStorage.setItem("memsphere.artifactReviewMobilePane.v1",artifact?"artifact":"review");};(dialog.querySelector("#artifact-review-artifact-tab") as HTMLButtonElement).onclick=()=>show(true);(dialog.querySelector("#artifact-review-review-tab") as HTMLButtonElement).onclick=()=>show(false);
    if(matchMedia("(max-width: 820px)").matches)show(localStorage.getItem("memsphere.artifactReviewMobilePane.v1")!=="review");
    this.#portal.append(dialog);this.#reviewDialog=dialog;
    dialog.addEventListener("close",()=>{dialog.remove();this.#reviewDialog=null;void this.#navigate(this.#routes.detail.to({runId}));},{once:true});dialog.showModal();
  }
  #renderReviewPanel(runId:string,context:Json):HTMLElement{
    const wrap=document.createElement("div");const round=selectedRound(context,this.#reviewRoundId);const historical=round?.id!==context.review.currentRoundId;
    const scope=reviewCard("artifact-review-scope-panel",tr(this.#config,"scope"));
    scope.append(cardLabel(tr(this.#config,"reviewTime")),textBlock(reviewTime(context.review,round)));
    const artifactLine=document.createElement("div");artifactLine.className="artifact-review-card-line";artifactLine.textContent=context.review?.artifactName||"—";scope.append(artifactLine);
    const scopeMeta=document.createElement("div");scopeMeta.className="run-meta";scopeMeta.append(
      pill(reviewStatus(this.#config,context.review?.status)),pill(context.review?.policyId||"—"),pill(`${tr(this.#config,"round")} ${round?.sequence||"—"} · ${roundSubmitted(round)}/${roundTotal(round)}`),pill(round?.id===context.review?.currentRoundId?tr(this.#config,"currentRound"):`${tr(this.#config,"historicalRound")} · ${tr(this.#config,"round")} ${round?.sequence||"—"}`)
    );scope.append(scopeMeta,cardLabel(tr(this.#config,"round")),this.#roundSelector(runId,context));
    const mine=reviewCard("artifact-review-my-panel",tr(this.#config,"myReview"));const assignments=round?.assignments||[];const humans=assignments.filter((a:Json)=>a.actorKind!=="agent");const selectedSubmitted=assignmentSubmitted(context.assignment);if(humans.length>1||humans.length===1&&!selectedSubmitted)mine.append(this.#identity(context,humans,runId));
    if(historical){const badge=textBlock(tr(this.#config,"historicalRound"));badge.className="artifact-review-message";const notice=textBlock(tr(this.#config,"historyReadOnly"));notice.className="artifact-review-message warn";mine.append(badge,notice);}else if(!context.assignment)mine.append(textBlock(tr(this.#config,"noReviewRequired")));else if(context.assignment.actorKind!=="agent"){if(selectedSubmitted)mine.append(this.#submittedOpinion(context.assignment));else mine.append(this.#reviewEditor(context,runId));}
    const progress=reviewCard("artifact-review-progress-panel",tr(this.#config,"participationProgress"));const progressSummary=document.createElement("div");progressSummary.className="artifact-review-progress-summary";progressSummary.textContent=roundProgress(this.#config,round);progress.append(progressSummary);for(const assignment of assignments){const selected=assignment.actorId===context.assignment?.actorId?{...assignment,draft:context.assignment.draft,submitted:context.assignment.submitted}:assignment;progress.append(this.#participant(context,round,selected));}progress.append(this.#runner(round));
    const record=reviewCard("artifact-review-record-panel",tr(this.#config,"reviewRecord"));const result=document.createElement("div");result.className="artifact-review-result-summary";result.textContent=roundResultSummary(this.#config,round);record.append(cardLabel(tr(this.#config,"roundSummary")),result);const submitted=assignments.filter((assignment:Json)=>assignment.submitted||assignment.summary||assignment.vote);if(submitted.length){record.append(cardLabel(tr(this.#config,"submittedOpinions")));for(const assignment of submitted)record.append(this.#submittedOpinion(assignment));}wrap.append(scope,mine,progress,record);return wrap;
  }
  #identity(context:Json,assignments:Json[],runId:string):HTMLElement{
    return chooser("artifact-review-actor-select",tr(this.#config,"identity"),assignmentName(assignments.find(a=>a.actorId===context.assignment?.actorId))||tr(this.#config,"selectIdentity"),assignments.map(assignment=>({id:assignment.actorId,label:`${assignmentName(assignment)} · ${assignment.binding}` ,selected:assignment.actorId===context.assignment?.actorId})),async actorId=>{
      localStorage.setItem(`memsphere.review.identity.${context.review.id}`,actorId);this.#reviewContext=await this.#request(`/api/runs/${encodeURIComponent(runId)}/artifact-reviews/${encodeURIComponent(context.review.id)}/rounds/${encodeURIComponent(this.#reviewRoundId)}?actor_id=${encodeURIComponent(actorId)}`);this.#renderReview(runId,context.review.id);
    });
  }
  #reviewEditor(context:Json,runId:string):HTMLElement{
    const editor=document.createElement("div");editor.className="artifact-review-comment";editor.id="artifact-review-my-content";const draft=context.assignment?.draft||{vote:null,comments:[]};
    for(const comment of draft.comments||[])editor.append(commentCard(comment,`${tr(this.#config,"savedOpinion")} · ${severityLabel(this.#config,comment.severity)}`,tr(this.#config,"locate")));
    const textarea=document.createElement("textarea");textarea.placeholder=tr(this.#config,"overallPlaceholder");const actorKey=context.assignment.actorId;textarea.value=this.#composerByActor.get(actorKey)||"";textarea.oninput=()=>this.#composerByActor.set(actorKey,textarea.value);const initialSeverity=this.#severityByActor.get(actorKey)||"blocking";let severity:HTMLElement;severity=chooser("artifact-review-severity-select",tr(this.#config,"commentSeverity"),severityLabel(this.#config,initialSeverity),["blocking","risk","suggestion"].map(value=>({id:value,label:severityLabel(this.#config,value),selected:value===initialSeverity})),value=>{this.#severityByActor.set(actorKey,value);const trigger=severity.querySelector(".artifact-review-select-trigger span");if(trigger)trigger.textContent=severityLabel(this.#config,value);for(const option of severity.querySelectorAll<HTMLElement>("[role=option]"))option.setAttribute("aria-selected",String(option.textContent===severityLabel(this.#config,value)));});
    const actions=document.createElement("div");actions.className="artifact-review-actions";const add=button(tr(this.#config,"addOpinion"));actions.append(add);editor.append(cardLabel(tr(this.#config,"commentSeverity")),severity,textarea,actions);
    const votes=document.createElement("div");votes.className="artifact-review-vote";votes.setAttribute("role","radiogroup");for(const [value,label] of [["approve",tr(this.#config,"approve")],["request_changes",tr(this.#config,"requestChanges")],["abstain",tr(this.#config,"abstain")]]){const choice=button(label,draft.vote===value?"active":"");choice.setAttribute("role","radio");choice.setAttribute("aria-checked",String(draft.vote===value));choice.onclick=()=>{for(const item of votes.querySelectorAll<HTMLButtonElement>("button")){const selected=item===choice;item.classList.toggle("active",selected);item.setAttribute("aria-checked",String(selected));}draft.vote=value;void this.#saveDraft(context,runId,{vote:value,comments:draft.comments||[]},choice,undefined,false);};votes.append(choice);}editor.append(votes);
    add.onclick=()=>{const body=textarea.value.trim();if(!body)return;void this.#saveDraft(context,runId,{vote:draft.vote||null,comments:[...(draft.comments||[]),{id:`comment-${Date.now()}`,body,severity:this.#severityByActor.get(actorKey)||initialSeverity}]},add,textarea);};
    const submitArea=document.createElement("div");submitArea.className="artifact-review-actions artifact-review-submit-area";submitArea.id="artifact-review-submit-area";const submit=button(tr(this.#config,"submit"),"primary");submit.onclick=()=>void this.#confirmSubmit(context,runId);submitArea.append(submit);editor.append(submitArea);return editor;
  }
  #roundSelector(runId:string,context:Json):HTMLElement{
    const rounds=context.rounds||[];const current=selectedRound(context,this.#reviewRoundId);return chooser("artifact-review-round-select",tr(this.#config,"round"),`${tr(this.#config,"round")} ${current?.sequence||"—"}`,rounds.map((round:Json)=>({id:round.id,label:`${tr(this.#config,"round")} ${round.sequence} · ${round.id===context.review.currentRoundId?tr(this.#config,"currentRound"):tr(this.#config,"historicalRound")}`,selected:round.id===current?.id})),async roundId=>{
      this.#reviewRoundId=roundId;this.#syncReviewUrl();const actor=this.#reviewContext?.assignment?.actorId||"";this.#reviewContext=await this.#request(`/api/runs/${encodeURIComponent(runId)}/artifact-reviews/${encodeURIComponent(context.review.id)}/rounds/${encodeURIComponent(roundId)}${actor?`?actor_id=${encodeURIComponent(actor)}`:""}`);this.#renderReview(runId,context.review.id);
    },"button");
  }
  #materialSelector(context:Json,onChange:()=>void):HTMLElement{
    const items=materials(context);const selected=items.find(item=>item.key===this.#reviewMaterial)||items[0];return chooser("artifact-review-material-select",tr(this.#config,"selectMaterial"),materialLabel(this.#config,selected),items.map(item=>({id:item.key,label:materialLabel(this.#config,item),selected:item.key===selected?.key})),key=>{this.#reviewMaterial=key;this.#syncReviewUrl();onChange();});
  }
  #renderMaterial(context:Json):HTMLElement{
    const material=materials(context).find(item=>item.key===this.#reviewMaterial)||materials(context)[0];const artifact=material?.artifact||{};const wrap=document.createElement("div");wrap.dataset.material=material?.key||"candidate";
    const heading=document.createElement("h3");heading.className="artifact-review-material-heading";heading.textContent=tr(this.#config,"materialTitle");
    const meta=document.createElement("div");meta.className="artifact-review-material-meta";meta.append(
      pill(materialLabel(this.#config,material)),
      pill(String(artifact.type||artifact.valueType||"string")),
      pill(artifactFormatLabel(this.#config,artifact)),
      pill(artifact.storage==="file"?tr(this.#config,"file"):tr(this.#config,"inline"))
    );
    wrap.append(heading,meta);
    if(artifact.path||artifact.fileName){const path=document.createElement("code");path.className="artifact-review-material-path";path.textContent=String(artifact.path||artifact.fileName);wrap.append(path);}
    const time=document.createElement("time");time.className="artifact-review-material-time";time.textContent=`${tr(this.#config,"reviewTime")}：${formatTime(context.submission?.submittedAt||context.review?.createdAt)}`;wrap.append(time);
    const frame=document.createElement("div");frame.className="artifact-review-artifact-frame";const content=renderArtifactValue(artifact);
    if(material?.commentable){const children=[...content.children] as HTMLElement[];if(children.length){children.forEach((child,index)=>{const anchor=`markdown:${child.tagName.toLowerCase()}:${index}`;const target=document.createElement("div");target.className="artifact-review-target artifact-review-commentable";target.dataset.anchor=anchor;const body=document.createElement("div");body.className="artifact-review-commentable-body";child.replaceWith(target);body.append(child);const plus=button("");plus.className="inline-plus";plus.setAttribute("aria-label",this.#config.locale?.startsWith("en")?"Add inline comment":"添加行内意见");plus.setAttribute("aria-expanded","false");plus.onclick=()=>this.#openInlineEditor(target,context,anchor);target.append(plus,body);});}else{content.classList.add("artifact-review-target");content.dataset.anchor="artifact:root";}}
    frame.append(content);wrap.append(frame);return wrap;
  }
  #openInlineEditor(target:HTMLElement,context:Json,anchor:string):void{
    const toggle=target.querySelector<HTMLButtonElement>(":scope > .inline-plus");const existing=target.querySelector(":scope > .inline-comment-editor");if(existing){existing.remove();toggle?.setAttribute("aria-expanded","false");return;}for(const open of this.#reviewDialog?.querySelectorAll(".inline-comment-editor")||[]){open.parentElement?.querySelector<HTMLButtonElement>(":scope > .inline-plus")?.setAttribute("aria-expanded","false");open.remove();}
    const editor=document.createElement("div");editor.className="inline-comment-editor";const input=document.createElement("textarea");input.placeholder=this.#config.locale?.startsWith("en")?"How should this change?":"这里应该如何修改？";const actions=document.createElement("div");actions.className="inline-comment-actions";const save=button(tr(this.#config,"addOpinion"),"primary");const cancel=button(tr(this.#config,"cancel"));cancel.onclick=()=>{editor.remove();toggle?.setAttribute("aria-expanded","false");toggle?.focus();};save.onclick=()=>{const body=input.value.trim();if(!body){input.focus();return;}const draft=context.assignment?.draft||{vote:null,comments:[]};const comment={id:`comment-${Date.now()}`,body,severity:"risk",anchor:{submissionId:context.submission.id,sourceHash:context.submission.digest,target:anchor,location:anchor,context:String(target.textContent||"").replace("+","").trim().slice(0,500)}};void this.#saveDraft(context,this.#detail?.id||"",{vote:draft.vote||null,comments:[...(draft.comments||[]),comment]},save,input);};actions.append(save,cancel);editor.append(input,actions);target.append(editor);toggle?.setAttribute("aria-expanded","true");input.focus();
  }
  #wireDivider(divider:HTMLElement,dialog:HTMLDialogElement):void{
    const set=(value:number,persist=true)=>{const next=Math.min(75,Math.max(30,Math.round(value)));dialog.style.setProperty("--artifact-review-left",`${next}%`);divider.setAttribute("aria-valuenow",String(next));if(persist)localStorage.setItem("memsphere.artifactReviewSplit.v1",String(next));};
    divider.onkeydown=event=>{const now=Number(divider.getAttribute("aria-valuenow"))||58;if(event.key==="ArrowLeft"){event.preventDefault();set(now-2);}else if(event.key==="ArrowRight"){event.preventDefault();set(now+2);}};
    divider.onpointerdown=event=>{if(innerWidth<=820)return;const body=divider.parentElement!;divider.setPointerCapture(event.pointerId);const move=(moveEvent:PointerEvent)=>{const box=body.getBoundingClientRect();set(((moveEvent.clientX-box.left)/box.width)*100,false);};const finish=()=>{set(Number(divider.getAttribute("aria-valuenow"))||58);divider.removeEventListener("pointermove",move);divider.removeEventListener("pointerup",finish);};divider.addEventListener("pointermove",move);divider.addEventListener("pointerup",finish);};
  }
  async #saveDraft(context:Json,runId:string,draft:Json,control:HTMLButtonElement|HTMLInputElement,composer?:HTMLTextAreaElement,rerender=true):Promise<void>{
    control.disabled=true;let active:Json=this.#reviewContext?.assignment?.actorId===context.assignment.actorId?this.#reviewContext!:context;const payload:{vote?:string;comments:Json[]}={comments:draft.comments};if(draft.vote)payload.vote=draft.vote;const messageHost=control.closest(".artifact-review-comment,.inline-comment-editor");messageHost?.querySelector(":scope > .artifact-review-message.warn")?.remove();
    try{let saved:Response|null=null;for(let attempt=0;attempt<5;attempt+=1){const response=await fetch(this.#assignmentUrl(active,"draft"),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({...payload,expectedRevision:active.review.round.revision}),signal:this.#controller.signal});if(response.status!==409){saved=response;break;}if(attempt===4)throw new Error(tr(this.#config,"conflict"));active=await this.#request(`/api/runs/${encodeURIComponent(runId)}/artifact-reviews/${encodeURIComponent(context.review.id)}/rounds/${encodeURIComponent(this.#reviewRoundId)}?actor_id=${encodeURIComponent(context.assignment.actorId)}`);}if(!saved||!saved.ok)throw new Error(saved?await this.#responseError(saved):tr(this.#config,"conflict"));this.#reviewContext=await saved.json();if(composer){composer.value="";this.#composerByActor.delete(context.assignment.actorId);}if(rerender)this.#renderReview(runId,context.review.id);}catch(error){const message=document.createElement("div");message.className="artifact-review-message warn";message.textContent=error instanceof Error?error.message:String(error);messageHost?.prepend(message);}finally{control.disabled=false;}
  }
  #confirmSubmit(context:Json,runId:string):void{
    const confirmDialog=document.createElement("dialog");confirmDialog.className="artifact-review-dialog";const body=document.createElement("div");body.className="artifact-review-dialog-body";const title=document.createElement("h3");title.textContent=tr(this.#config,"submit");const message=document.createElement("div");message.className="artifact-review-message warn";message.hidden=true;const cancel=button(tr(this.#config,"close"));const submit=button(tr(this.#config,"submit"),"primary");body.append(title,message,cancel,submit);confirmDialog.append(body);this.#portal.append(confirmDialog);cancel.onclick=()=>confirmDialog.close();submit.onclick=()=>void this.#withButton(submit,async()=>{message.hidden=true;let latest=this.#reviewContext||context;let response=await this.#submitAssignment(latest);if(response.status===409){latest=await this.#request(`/api/runs/${encodeURIComponent(runId)}/artifact-reviews/${encodeURIComponent(context.review.id)}/rounds/${encodeURIComponent(this.#reviewRoundId)}?actor_id=${encodeURIComponent(latest.assignment.actorId)}`);this.#reviewContext=latest;response=await this.#submitAssignment(latest);}if(!response.ok){message.textContent=response.status===409?tr(this.#config,"conflict"):await this.#responseError(response);message.hidden=false;return;}this.#reviewContext=await response.json();confirmDialog.close();await this.#refresh();this.#renderReview(runId,context.review.id);});confirmDialog.addEventListener("close",()=>confirmDialog.remove(),{once:true});confirmDialog.showModal();
  }
  #submitAssignment(context:Json):Promise<Response>{return fetch(this.#assignmentUrl(context,"submit"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({expectedRevision:context.review.round.revision}),signal:this.#controller.signal});}
  async #responseError(response:Response):Promise<string>{const text=await response.text();try{const payload=JSON.parse(text);return typeof payload?.error==="string"?payload.error:text;}catch{return text||tr(this.#config,"conflict");}}
  #participant(context:Json,round:Json,assignment:Json):HTMLElement{
    const row=document.createElement("article");row.className="artifact-review-row artifact-review-participant";row.id=`artifact-review-participant-${safeId(assignment.actorId)}`;const head=document.createElement("div");head.className="artifact-review-participant-head";const main=document.createElement("div");main.className="artifact-review-row-main";const name=document.createElement("b");name.textContent=assignmentName(assignment);const meta=document.createElement("div");meta.className="artifact-review-participant-meta";meta.append(pill(`${assignment.binding==="decision"?tr(this.#config,"decision"):tr(this.#config,"advisory")} · ${assignment.actorKind==="agent"?tr(this.#config,"agent"):assignment.actorKind||"Human"}`),pill(assignmentStatus(this.#config,assignment)),pill(voteLabel(this.#config,assignment.vote||assignment.submitted?.vote)));main.append(name,meta);head.append(main);row.append(head);
    const attempts=assignment.attempts||(assignment.attempt?[assignment.attempt]:[]);if(assignment.actorKind==="agent"&&attempts.length){const evidence=document.createElement("span");evidence.className="muted";evidence.textContent=`${tr(this.#config,"implementationEvidence")}：${tr(this.#config,assignment.implementationEvidenceReferenced?"referenced":"notReferenced")}`;main.append(evidence);const toggle=button(tr(this.#config,"viewDetails"));toggle.className="artifact-review-activity-toggle";toggle.setAttribute("aria-expanded","false");head.append(toggle);toggle.onclick=async()=>{const existing=row.querySelector(".artifact-review-activity");if(existing){existing.remove();toggle.textContent=tr(this.#config,"viewDetails");toggle.setAttribute("aria-expanded","false");return;}toggle.textContent=tr(this.#config,"hideDetails");toggle.setAttribute("aria-expanded","true");head.insertAdjacentElement("afterend",await this.#agentActivity(context.review,round,{...assignment,attempts}));};}
    const opinion=assignment.submitted||((assignment.summary||assignment.vote)?assignment:null);if(opinion&&(opinion.renderedSummary||opinion.summary))row.append(this.#opinionBody(opinion,false));return row;
  }
  #runner(round:Json):HTMLElement{const runner=round?.runner;const row=document.createElement("article");row.className="artifact-review-participant";const head=document.createElement("div");head.className="artifact-review-participant-head";const main=document.createElement("div");main.className="artifact-review-row-main";const name=document.createElement("b");name.textContent=runner?.actorName||tr(this.#config,"runner");const meta=document.createElement("div");meta.className="artifact-review-participant-meta";meta.append(pill(tr(this.#config,"decision")),pill(runner?.status?assignmentStatus(this.#config,runner):tr(this.#config,"pendingVote")));main.append(name,meta);head.append(main);row.append(head);return row;}
  #submittedOpinion(assignment:Json):HTMLElement{const row=document.createElement("article");row.className="artifact-review-participant";const name=document.createElement("b");name.textContent=assignmentName(assignment);const meta=document.createElement("div");meta.className="artifact-review-participant-meta";meta.append(pill(`${tr(this.#config,"voteSummary")} · ${voteLabel(this.#config,assignment.vote||assignment.submitted?.vote)}`));row.append(name,meta,this.#opinionBody(assignment.submitted||assignment));return row;}
  #opinionBody(opinion:Json,includeComments=true):HTMLElement{const wrap=document.createElement("div");wrap.className="artifact-review-opinion";if(opinion.renderedSummary){const summary=document.createElement("div");summary.innerHTML=opinion.renderedSummary;wrap.append(summary);}else if(opinion.summary){wrap.append(textBlock(opinion.summary));}if(includeComments)for(const comment of opinion.comments||[]){const card=commentCard(comment,"",tr(this.#config,"locate"));const severity=document.createElement("span");severity.className="artifact-review-comment-severity";severity.textContent=severityLabel(this.#config,comment.severity);card.prepend(severity);wrap.append(card);}return wrap;}
  async #agentActivity(review:Json,round:Json,assignment:Json):Promise<HTMLElement>{
    const attempts=assignment.attempts||[];const latest=attempts.at(-1);const wrap=document.createElement("section");wrap.className="artifact-review-activity";const head=document.createElement("div");head.className="artifact-review-activity-head";const title=document.createElement("b");title.textContent=tr(this.#config,"activity");head.append(title);wrap.append(head);if(!latest)return wrap;
    const selectedKey=`${review.id}:${round.id}:${assignment.actorId}`;const selected=this.#activities.get(selectedKey)?.sequence||latest.sequence;head.append(chooser("artifact-review-attempt-select",tr(this.#config,"selectAttempt"),`${tr(this.#config,"attempt")} ${selected} · ${assignmentStatus(this.#config,attempts.find((a:Json)=>a.sequence===selected)||latest)}`,attempts.map((attempt:Json)=>({id:String(attempt.sequence),label:`${tr(this.#config,"attempt")} ${attempt.sequence} · ${assignmentStatus(this.#config,attempt)}`,selected:attempt.sequence===selected})),sequence=>{this.#activities.set(selectedKey,{...(this.#activities.get(selectedKey)||{}),sequence:Number(sequence)});}));
    const response=await this.#request(`/api/artifact-reviews/${encodeURIComponent(review.id)}/rounds/${encodeURIComponent(round.id)}/assignments/${encodeURIComponent(assignment.actorId)}/attempts/${encodeURIComponent(selected)}/activity?cursor=0&limit=500`);const log=document.createElement("div");log.className="artifact-review-activity-log";this.#appendActivityEvents(log,response.events||[]);this.#activities.set(selectedKey,{sequence:selected,cursor:response.nextCursor||0,reviewId:review.id,roundId:round.id,actorId:assignment.actorId,log});wrap.append(log);return wrap;
  }
  async #pollActivities():Promise<void>{for(const entry of this.#activities.values()){const log=entry.log;if(!(log instanceof HTMLElement)||!log.isConnected)continue;try{const response=await this.#request(`/api/artifact-reviews/${encodeURIComponent(entry.reviewId)}/rounds/${encodeURIComponent(entry.roundId)}/assignments/${encodeURIComponent(entry.actorId)}/attempts/${encodeURIComponent(entry.sequence)}/activity?cursor=${encodeURIComponent(entry.cursor||0)}&limit=500`);const pinned=log.scrollHeight-log.clientHeight-log.scrollTop<20;const top=log.scrollTop;this.#appendActivityEvents(log,response.events||[]);entry.cursor=response.nextCursor||entry.cursor;if(pinned)log.scrollTop=log.scrollHeight;else log.scrollTop=top;}catch(error){if(!this.#controller.signal.aborted)console.error("Unable to refresh Agent Activity",error);}}}
  #appendActivityEvents(log:HTMLElement,events:Json[]):void{for(const event of events){const existing=log.querySelector(`[data-event-id="${CSS.escape(String(event.id||""))}"]`);existing?.remove();const item=document.createElement("article");item.className="artifact-review-activity-event";item.dataset.kind=event.kind;item.dataset.eventId=event.id||"";const eventHead=document.createElement("div");eventHead.className="artifact-review-activity-event-head";const kind=document.createElement("span");kind.className="artifact-review-activity-kind";kind.textContent=tr(this.#config,event.kind);const time=document.createElement("time");time.textContent=formatTime(event.updatedAt);eventHead.append(kind,time);const eventTitle=document.createElement("b");eventTitle.className="artifact-review-activity-event-title";eventTitle.textContent=event.title||"";item.append(eventHead,eventTitle);if(event.body)item.append(textBlock(event.body));if(event.plan?.length){const list=document.createElement("ol");for(const plan of event.plan){const li=document.createElement("li");li.textContent=`${plan.content} · ${plan.status}`;list.append(li);}item.append(list);}log.append(item);}}
  #assignmentUrl(context:Json,operation:string):string{return `/api/artifact-reviews/${encodeURIComponent(context.review.id)}/rounds/${encodeURIComponent(context.review.currentRoundId)}/assignments/${encodeURIComponent(context.assignment.actorId)}/${operation}`;}
  async #withButton(control:HTMLButtonElement,operation:()=>Promise<void>):Promise<void>{control.disabled=true;try{await operation();}catch(error){alert(error instanceof Error?error.message:String(error));}finally{control.disabled=false;}}
}

function tr(config: Readonly<RunConfig>, key: string): string { const candidate=config.messages?.[key];return typeof candidate==="string"?candidate:((config.locale||document.documentElement.lang).startsWith("en")?en:zh)[key]||key; }
function displayName(run:Json):string{return String(run.name||run.procedureName||run.id||"");}function shortId(id:string):string{return String(id||"").replace(/^run-/,"").slice(0,18);}
function formatTime(value:unknown):string{if(!value)return "—";const date=new Date(String(value));return Number.isNaN(date.valueOf())?String(value):date.toLocaleString();}
function pill(text:string,kind=""):HTMLElement{const span=document.createElement("span");span.className=`run-pill ${kind}`;span.textContent=text;return span;}
function button(label:string,kind=""):HTMLButtonElement{const result=document.createElement("button");result.className=`run-btn ${kind}`;result.type="button";result.textContent=label;return result;}
function textBlock(value:unknown):HTMLElement{const p=document.createElement("p");p.textContent=typeof value==="string"?value:JSON.stringify(value,null,2);return p;}
function section(id:string,title:string):HTMLElement{const result=document.createElement("section");result.id=id;result.className="artifact-review-operation-group";const h=document.createElement("h3");h.textContent=title;result.append(h);return result;}
function reviewCard(id:string,title:string):HTMLElement{const result=document.createElement("section");result.id=id;result.className="artifact-review-card";const h=document.createElement("h3");h.textContent=title;result.append(h);return result;}
function cardLabel(label:string):HTMLElement{const result=document.createElement("span");result.className="artifact-review-card-label";result.textContent=label;return result;}
function reviewTime(review:Json,round:Json):string{const start=round?.createdAt||review?.createdAt;const end=round?.updatedAt||review?.updatedAt;return start&&end&&start!==end?`${formatTime(start)} — ${formatTime(end)}`:formatTime(start||end);}
function reviewStatus(config:Readonly<RunConfig>,status:unknown):string{const labels:Record<string,[string,string]>={pending:["待评审","Pending"],in_progress:["评审中","In review"],awaiting_revision:["需修改","Changes requested"],changes_requested:["需修改","Changes requested"],approved:["已通过","Approved"],completed:["已完成","Completed"],submitted:["已提交","Submitted"],failed:["执行失败","Failed"],queued:["等待启动","Queued"]};const label=labels[String(status||"")];return label?(config.locale?.startsWith("en")?label[1]:label[0]):String(status||"—");}
function voteLabel(config:Readonly<RunConfig>,vote:unknown):string{const labels:Record<string,string>={approve:"approve",request_changes:"requestChanges",abstain:"abstain"};return vote?tr(config,labels[String(vote)]||String(vote)):tr(config,"pendingVote");}
function countValue(value:unknown):number{return Array.isArray(value)?value.length:Number(value||0);}
function roundSubmitted(round:Json):number{return Number(round?.submitted||(round?.assignments||[]).filter((assignment:Json)=>assignment.status==="submitted"||assignment.submitted).length);}
function roundTotal(round:Json):number{return Number(round?.total||(round?.assignments||[]).length);}
function roundProgress(config:Readonly<RunConfig>,round:Json):string{const submitted=roundSubmitted(round);const total=roundTotal(round);const status=String(round?.result?.status||round?.status||"");const completed=Boolean(round?.result)||["approved","completed","passed","changes_requested","cancelled"].includes(status);const readiness=completed?tr(config,"reviewComplete"):(round?.decisionReady||(total>0&&submitted>=total)?tr(config,"decisionReady"):tr(config,"waitingReviews"));return `${submitted}/${total} · ${readiness} · ${tr(config,"blockingComments")} ${countValue(round?.blockingComments)} · ${tr(config,"unresolved")} ${countValue(round?.unresolvedBlocking)} · ${tr(config,"environmentFailures")} ${countValue(round?.failures)} · ${tr(config,"repeatedAdvisories")} ${countValue(round?.repeatedAdvisories)}`;}
function roundResultSummary(config:Readonly<RunConfig>,round:Json):string{const result=round?.result||{};const status=reviewStatus(config,result.status||round?.status);const votes=result.voteSummary||result.votes||{};const voteText=Object.entries(votes).map(([key,value])=>`${voteLabel(config,key)} ${String(value)}`).join(" · ");const summary=String(result.summary||round?.summary||"").trim();return [status,voteText,summary].filter(Boolean).join(" · ");}
function selectedRound(context:Json,roundId:string):Json{return (context.rounds||[]).find((round:Json)=>round.id===roundId)||(context.rounds||[]).find((round:Json)=>round.id===context.review?.currentRoundId)||context.review?.round||{};}
function materials(context:Json):Json[]{return [{key:"candidate",artifact:context.submission?.artifact||{},commentable:true},{key:"contract",artifact:context.submission?.contractArtifact||{},commentable:false},...(context.submission?.contextArtifacts||[]).map((item:Json,index:number)=>({key:`context:${index}`,artifact:item.artifact||{},commentable:false}))];}
function materialLabel(config:Readonly<RunConfig>,material:Json|undefined):string{if(!material)return "—";const prefix=material.key==="candidate"?tr(config,"candidate"):material.key==="contract"?tr(config,"contract"):tr(config,"earlier");return `${prefix} · ${material.artifact?.name||"Artifact"}`;}
function artifactFormatLabel(config:Readonly<RunConfig>,artifact:Json):string{const raw=typeof artifact.format==="object"?artifact.format?.name:artifact.format;const format=String(raw||artifact.contentType||"").toLowerCase();return format.includes("markdown")||format==="md"?tr(config,"document"):(format||tr(config,"document"));}
function assignmentName(assignment:Json|undefined):string{return assignment?.slotNames?.join?.(" / ")||assignment?.slotIds?.join?.(" / ")||assignment?.actorName||assignment?.actorId||"";}
function assignmentSubmitted(assignment:Json|undefined):boolean{return Boolean(assignment&&(assignment.status==="submitted"||assignment.submitted));}
function assignmentStatus(config:Readonly<RunConfig>,assignment:Json):string{return tr(config,assignment.status)||String(assignment.status||"");}
function severityLabel(config:Readonly<RunConfig>,severity:unknown):string{return tr(config,{blocking:"severityBlocking",risk:"severityRisk",suggestion:"severitySuggestion"}[String(severity||"")]||"severityRisk");}
function safeId(value:unknown):string{return String(value||"").replace(/[^a-zA-Z0-9_-]/g,"-");}
function commentCard(comment:Json,label="",locateLabel="Locate"):HTMLElement{const card=document.createElement("article");card.className="comment-card";const head=document.createElement("div");head.className="comment-card-head";if(label){const title=document.createElement("span");title.textContent=label;head.append(title);}if(comment.anchor){const locate=button(locateLabel);locate.classList.add("artifact-review-locate");locate.onclick=()=>{const anchor=typeof comment.anchor==="string"?comment.anchor:comment.anchor.target;const target=document.querySelector(`[data-anchor="${CSS.escape(anchor||"")}"]`);if(target instanceof HTMLElement){target.scrollIntoView({block:"center"});target.classList.add("artifact-review-target-located");setTimeout(()=>target.classList.remove("artifact-review-target-located"),1800);}};head.append(locate);}if(head.childElementCount)card.append(head);const body=document.createElement("div");body.className="comment-card-body";body.textContent=comment.body||"";card.append(body);return card;}
function chooser(className:string,label:string,current:string,items:Array<{id:string;label:string;selected:boolean}>,onSelect:(id:string)=>void|Promise<void>,role:"combobox"|"button"="combobox"):HTMLElement{
  const wrap=document.createElement("div");wrap.className=`artifact-review-round-select ${className}`;
  const trigger=document.createElement("button");trigger.type="button";trigger.className="artifact-review-select artifact-review-select-trigger";trigger.setAttribute("role",role);trigger.setAttribute("aria-label",label);trigger.setAttribute("aria-haspopup","listbox");trigger.setAttribute("aria-expanded","false");
  const value=document.createElement("span");value.textContent=current;const caret=document.createElement("span");caret.className="artifact-review-select-caret";caret.textContent="⌄";trigger.append(value,caret);
  const menu=document.createElement("div");menu.className="artifact-review-select-menu";menu.setAttribute("role","listbox");menu.setAttribute("aria-label",label);menu.hidden=true;
  const options:HTMLButtonElement[]=[];const setOpen=(open:boolean,focus=false)=>{menu.hidden=!open;trigger.setAttribute("aria-expanded",String(open));if(open&&focus)(options.find(option=>option.getAttribute("aria-selected")==="true")||options[0])?.focus();};
  for(const item of items){const option=document.createElement("button");option.type="button";option.className="artifact-review-select-option";option.dataset.actorId=className.includes("actor")?item.id:undefined;option.dataset.roundId=className.includes("round-select")?item.id:undefined;option.setAttribute("role","option");option.setAttribute("aria-selected",String(item.selected));option.textContent=item.label;option.onclick=()=>{setOpen(false);void onSelect(item.id);};options.push(option);menu.append(option);}
  trigger.onclick=()=>setOpen(menu.hidden);trigger.onkeydown=event=>{if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();setOpen(true,true);}else if(event.key==="Escape")setOpen(false);};
  menu.onkeydown=event=>{const index=options.indexOf(document.activeElement as HTMLButtonElement);if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();options[(index+(event.key==="ArrowDown"?1:-1)+options.length)%options.length]?.focus();}else if(event.key==="Escape"){event.preventDefault();setOpen(false);trigger.focus();}};
  wrap.addEventListener("focusout",()=>setTimeout(()=>{if(!wrap.contains(document.activeElement))setOpen(false);},0));wrap.append(trigger,menu);return wrap;
}
function reviewSummary(run:Json|null):Json|null{return run?.artifactReview||run?.artifactReviews?.[0]||null;}
function currentStep(run:Json):Json|null{if(run.status!=="running")return null;const frame=run.stack?.at?.(-1)||run.stack?.[run.stack.length-1];return frame?.steps?.[frame.index]||null;}
function flattenSteps(steps:Json[]):Json[]{const out:Json[]=[];for(const step of steps){out.push(step);out.push(...flattenSteps(step.branches?.truthy||[]),...flattenSteps(step.branches?.falsy||[]),...flattenSteps(step.loop?.body||[]));}return out;}
function renderArtifact(event:Json):HTMLElement{const card=document.createElement("article");card.className="run-artifact task-result";const h=document.createElement("h3");h.textContent=event.artifact?.name||event.stepId||"Artifact";card.append(h,renderArtifactValue(event.artifact));return card;}
function renderArtifactValue(artifact:Json):HTMLElement{const wrap=document.createElement("div");wrap.className="artifact-review-artifact-content";if(typeof artifact?.renderedContent==="string"){wrap.classList.add("markdown-body");wrap.innerHTML=artifact.renderedContent;}else{const pre=document.createElement("pre");pre.className="run-pre";const value=artifact?.value??artifact?.content??artifact;pre.textContent=typeof value==="string"?value:JSON.stringify(value,null,2);wrap.append(pre);}return wrap;}
