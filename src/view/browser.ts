export function shouldRenderTaskStepArtifact(event: unknown): boolean {
  return Boolean(event);
}

export function shouldRenderMarkdownArtifact(artifact: { format?: string; renderedContent?: string } | undefined): boolean {
  return artifact?.format === "markdown" && typeof artifact.renderedContent === "string";
}

export function canCreateTaskReview(status: string | undefined): boolean {
  return status === "done";
}

export const browserHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>memsphere</title>
  <style>
    :root {
      --bg: #f6f7f4;
      --surface: #fff;
      --soft: #eef1ed;
      --line: #d9ded8;
      --text: #222629;
      --muted: #6c7379;
      --accent: #286c67;
      --accent-soft: #dfeeea;
      --warn: #99602e;
      --danger: #a14436;
      --ok: #23744d;
      --shadow: 0 1px 2px rgba(25, 30, 35, .08);
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    button, input, textarea { font: inherit; }
    button { cursor: pointer; }
    .shell { display: grid; grid-template-columns: 300px minmax(0, 1fr) 360px; min-height: 100vh; }
    .sidebar, .review { background: #fbfbf8; border-color: var(--line); overflow: auto; height: 100vh; position: sticky; top: 0; }
    .sidebar { border-right: 1px solid var(--line); padding: 16px; }
    .review { border-left: 1px solid var(--line); padding: 16px; }
    .brand, .review-head, .toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .brand h1, .review-head h2, .title { margin: 0; letter-spacing: 0; }
    .brand h1 { font-size: 18px; }
    .view-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 14px; }
    .view-tab { border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--muted); padding: 7px 8px; }
    .view-tab.active { border-color: #b8cbc7; background: var(--accent-soft); color: #173f3c; font-weight: 700; }
    .count, .muted, .subtitle, .review-sub { color: var(--muted); }
    .count { font-size: 12px; }
    .search, textarea { width: 100%; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); outline: none; }
    .search { margin: 14px 0 16px; padding: 9px 10px; }
    textarea { min-height: 92px; resize: vertical; padding: 10px; }
    .search:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(40, 108, 103, .12); }
    .kind { margin: 14px 0 6px; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .08em; }
    .memory-list, .review-list, .comment-list, .flow, .task-list, .event-list { display: grid; gap: 8px; }
    .memory-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; }
    .memory-button, .review-card, .task-card { width: 100%; text-align: left; border: 0; border-radius: 6px; background: transparent; color: var(--text); padding: 8px 9px; }
    .memory-button:hover, .review-card:hover, .task-card:hover { background: #eceee8; }
    .memory-button.active, .review-card.active, .task-card.active { background: var(--accent-soft); color: #173f3c; font-weight: 700; }
    .memory-toggle { border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--muted); padding: 4px 7px; font-size: 12px; line-height: 1.2; min-width: 52px; }
    .memory-toggle:hover { border-color: var(--accent); color: var(--accent); }
    .memory-toggle.imported { color: var(--ok); border-color: #b8d8c5; background: #edf6f0; }
    .review-card { border: 1px solid var(--line); background: var(--surface); border-radius: 8px; box-shadow: var(--shadow); }
    .review-card b { display: block; overflow-wrap: anywhere; margin-bottom: 4px; }
    .review-card-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start; }
    .review-card-main { min-width: 0; border: 0; background: transparent; color: inherit; padding: 0; text-align: left; cursor: pointer; }
    .review-card-main b { display: block; overflow-wrap: anywhere; margin-bottom: 4px; }
    .review-card-actions { display: grid; gap: 6px; justify-items: end; }
    .review-delete { padding: 4px 7px; font-size: 12px; }
    .review-archive { padding: 4px 7px; font-size: 12px; }
    .task-card { width: 100%; border: 0; border-radius: 6px; background: transparent; color: var(--text); padding: 8px 9px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: end; }
    .task-card-main { min-width: 0; border: 0; background: transparent; color: inherit; padding: 0; text-align: left; cursor: pointer; display: grid; gap: 4px; }
    .task-card b { overflow-wrap: anywhere; }
    .content { min-width: 0; padding: 22px 28px 48px; }
    .toolbar { margin-bottom: 18px; }
    .toolbar-actions, .comment-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .title { font-size: 26px; line-height: 1.2; }
    .subtitle { margin-top: 7px; font-size: 13px; overflow-wrap: anywhere; }
    .btn { border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); padding: 7px 10px; }
    .btn:not(:disabled):hover { border-color: var(--accent); }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn.danger { color: var(--danger); }
    .btn:disabled { opacity: .55; cursor: not-allowed; }
    .empty, .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow); }
    .empty { padding: 24px; color: var(--muted); }
    .panel { padding: 12px; margin: 12px 0; }
    .error-panel { background: #fffdfb; border: 1px solid #e8c7bd; border-left: 4px solid var(--danger); border-radius: 8px; box-shadow: var(--shadow); padding: 18px; }
    .error-panel h3 { margin: 0 0 8px; font-size: 16px; color: var(--danger); }
    .error-panel p { margin: 0 0 12px; color: var(--muted); }
    .error-list { margin: 0; padding-left: 18px; }
    .error-list li { margin: 6px 0; overflow-wrap: anywhere; }
    .meta { display: flex; gap: 8px; flex-wrap: wrap; margin: 13px 0 18px; }
    .pill { border: 1px solid var(--line); background: var(--surface); color: var(--muted); border-radius: 999px; padding: 3px 8px; font-size: 12px; }
    button.pill { cursor: pointer; }
    button.pill:not(:disabled):hover { border-color: var(--accent); color: var(--accent); }
    .archive-run-action { align-self: center; min-height: 30px; min-width: 52px; padding: 5px 10px; font-size: 12px; line-height: 1.45; color: #4f5a5c; background: var(--surface); border-color: #c7cfca; box-shadow: var(--shadow); }
    .archive-run-action:not(:disabled):hover { color: #173f3c; border-color: var(--accent); background: #edf6f3; }
    .archive-run-action:disabled { color: #9aa1a5; background: #f2f3ef; border-color: var(--line); box-shadow: none; }
    .task-card-archive { justify-self: end; align-self: end; }
    .current-step-jump { color: var(--accent); background: #edf6f3; border-color: #b8cbc7; font-weight: 700; }
    .current-step-jump:hover { background: #e3f2ee; }
    .current-step-jump:focus-visible { outline: 3px solid rgba(40, 108, 103, .18); outline-offset: 2px; }
    .pill.strong { color: #173f3c; border-color: #b8cbc7; background: #edf6f3; }
    .pill.warn { color: var(--warn); background: #fbf2e8; border-color: #ead2b7; }
    .pill.processing { color: var(--accent); background: #edf6f3; border-color: #b8cbc7; }
    .pill.done { color: var(--ok); background: #edf6f0; border-color: #b8d8c5; }
    .pill.outdated { color: var(--danger); background: #fbefed; border-color: #e5bcb5; }
    .pill.human { color: #7b3f17; background: #fff1df; border-color: #e5c09c; }
    .pill.agent { color: #173f3c; background: #edf6f3; border-color: #b8cbc7; }
    .section { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow); margin: 10px 0; overflow: hidden; }
    .section-header { width: 100%; border: 0; background: transparent; text-align: left; display: grid; grid-template-columns: 22px minmax(0, 1fr) auto auto; align-items: center; gap: 8px; padding: 12px 14px; color: var(--text); }
    .section-header:hover { background: #f4f5f1; }
    .chevron { color: var(--muted); transition: transform 120ms ease; }
    .section.open > .section-header .chevron { transform: rotate(90deg); }
    .node-title { overflow-wrap: anywhere; font-weight: 700; }
    .section-body { display: none; border-top: 1px solid var(--line); padding: 12px 14px 14px; }
    .section.open > .section-body { display: block; }
    .block-title { margin: 12px 0 6px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; font-weight: 700; }
    .text-list { margin: 0; padding-left: 18px; }
    .text-list li { margin: 5px 0; white-space: pre-wrap; }
    .commentable { position: relative; display: block; margin: 4px 0; width: 100%; }
    .review-active .commentable { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 7px; align-items: flex-start; }
    .commentable-body { min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .inline-plus, .target-add { border: 1px solid var(--line); border-radius: 999px; background: #fff; color: var(--muted); padding: 0; }
    .inline-plus { width: 20px; height: 20px; line-height: 16px; opacity: 0; transition: opacity 120ms ease, border-color 120ms ease, color 120ms ease; }
    .target-add { width: 24px; height: 24px; }
    .review-active .commentable:hover .inline-plus, .review-active .field-table th:hover .inline-plus, .review-active .inline-plus:focus { opacity: 1; }
    .inline-plus:hover, .target-add:hover { border-color: var(--accent); color: var(--accent); }
    body:not(.review-active) .target-add, body:not(.review-active) .inline-plus { display: none; }
    .inline-comment-editor { grid-column: 2; border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 10px; box-shadow: var(--shadow); margin-top: 8px; width: 100%; }
    .inline-comment-editor textarea { margin-bottom: 8px; }
    .thread-edit-editor { grid-column: auto; margin: 2px 0 0; }
    .child-stack { margin-top: 12px; }
    .field-table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
    .field-table th, .field-table td { border-bottom: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; white-space: pre-wrap; }
    .field-table th { width: 220px; background: #f3f5f0; font-weight: 700; }
    .flow-item { border: 1px solid var(--line); border-left: 4px solid #a7b0a5; background: var(--surface); border-radius: 8px; padding: 10px 14px; box-shadow: var(--shadow); white-space: normal; }
    .flow-item.call { border-left-color: var(--accent); background: #f2f8f6; }
    .flow-item.branch { border-left-color: var(--warn); background: #fbf7f0; }
    .flow-head { display: grid; grid-template-columns: max-content minmax(220px, 1fr) max-content; gap: 12px; align-items: center; }
    .flow-label { display: inline-flex; align-items: center; width: fit-content; border-radius: 999px; background: #eef1ed; color: #4f5a5c; font-size: 12px; font-weight: 700; padding: 2px 8px; }
    .flow-condition { color: #4f5a5c; font-size: 13px; font-weight: 700; margin: 12px 0 7px; }
    .flow-children { margin-left: 12px; padding-left: 14px; border-left: 2px solid var(--line); display: grid; gap: 8px; }
    .flow-branch-row { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 10px; align-items: start; margin-top: 10px; }
    .flow-branch-row .flow-condition { margin: 8px 0 0; }
    .flow-branch-row .flow-children { margin-left: 0; }
    .flow-else { display: grid; gap: 8px; margin-top: 10px; }
    .flow-action { color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
    .artifact-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: flex-end; min-width: 260px; color: var(--muted); }
    .artifact-label { color: var(--muted); font-size: 12px; font-weight: 700; }
    .call-link { color: var(--accent); text-decoration: none; font-weight: 700; }
    .call-link:hover { text-decoration: underline; }
    .task-summary { display: grid; gap: 12px; }
    .task-step { border-left: 4px solid var(--accent); }
    .task-step-spotlight { animation: taskStepSpotlight 1600ms ease-out; box-shadow: 0 0 0 3px rgba(40, 108, 103, .18), var(--shadow); }
    .task-result { margin-top: 8px; }
    .task-result .pre { margin-top: 6px; }
    .pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f3f5f0; border: 1px solid var(--line); border-radius: 6px; padding: 10px; margin: 8px 0 0; }
    .markdown-body { white-space: normal; overflow-wrap: anywhere; background: #f3f5f0; border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; margin: 8px 0 0; line-height: 1.55; }
    .markdown-body > :first-child { margin-top: 0; }
    .markdown-body > :last-child { margin-bottom: 0; }
    .markdown-body p { margin: 6px 0; }
    .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 { margin: 12px 0 6px; line-height: 1.3; font-weight: 800; }
    .markdown-body h1 { font-size: 21px; }
    .markdown-body h2 { font-size: 18px; }
    .markdown-body h3 { font-size: 16px; }
    .markdown-body h4, .markdown-body h5, .markdown-body h6 { font-size: 14px; }
    .markdown-body ul, .markdown-body ol { margin: 6px 0; padding-left: 22px; }
    .markdown-body li { margin: 3px 0; }
    .markdown-body blockquote { margin: 8px 0; padding: 2px 12px; border-left: 3px solid var(--line); color: var(--muted); }
    .markdown-body a { color: var(--accent); text-decoration: underline; }
    .markdown-body code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: 12px; background: #e9ece6; border: 1px solid var(--line); border-radius: 4px; padding: 1px 4px; }
    .markdown-body pre { margin: 8px 0; background: #e9ece6; border: 1px solid var(--line); border-radius: 6px; padding: 9px 10px; overflow-x: auto; }
    .markdown-body pre code { background: none; border: 0; padding: 0; white-space: pre; }
    .markdown-body table { border-collapse: collapse; display: block; overflow-x: auto; margin: 8px 0; }
    .markdown-body th, .markdown-body td { border: 1px solid var(--line); padding: 5px 8px; text-align: left; }
    .markdown-body th { background: #e9ece6; }
    .markdown-body img { max-width: 100%; height: auto; }
    .markdown-body hr { border: 0; border-top: 1px solid var(--line); margin: 10px 0; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: 12px; }
    .comment-card { border: 1px solid var(--line); border-radius: 8px; background: #fff; padding: 10px; }
    .comment-card b { display: block; overflow-wrap: anywhere; }
    .comment-card p { margin: 6px 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .inline-thread {
      grid-column: 2;
      border-left: 3px solid var(--accent);
      background: #f5faf8;
      border-radius: 6px;
      margin: 8px 0 2px;
      padding: 8px 10px;
      display: grid;
      gap: 7px;
    }
    .inline-thread-note { white-space: pre-wrap; overflow-wrap: anywhere; }
    .inline-thread-item { display: grid; gap: 6px; }
    .inline-thread-view { display: grid; gap: 6px; }
    .inline-thread-item.editing > .inline-thread-view { display: none; }
    .line-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 20px;
      border-radius: 999px;
      background: var(--accent);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
    }
    .review-sub { margin: 4px 0 14px; font-size: 13px; }
    code { background: var(--soft); border-radius: 4px; padding: 1px 4px; }
    body.task-mode .shell { grid-template-columns: 300px minmax(0, 1fr) 300px; }
    body.task-mode .search, body.task-mode #expand, body.task-mode #collapse { display: none; }
    @keyframes taskStepSpotlight {
      0% { box-shadow: 0 0 0 5px rgba(40, 108, 103, .24), var(--shadow); }
      100% { box-shadow: var(--shadow); }
    }
    @media (max-width: 1100px) {
      .shell { grid-template-columns: 280px minmax(0, 1fr); }
      .review { grid-column: 1 / -1; height: auto; position: static; border-left: 0; border-top: 1px solid var(--line); }
    }
    @media (max-width: 760px) {
      .shell { grid-template-columns: 1fr; }
      .sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
      .content { padding: 18px 16px 36px; }
      .toolbar { flex-direction: column; }
      .flow-head { grid-template-columns: 1fr; gap: 8px; align-items: flex-start; }
      .artifact-row { justify-content: flex-start; min-width: 0; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <aside class="sidebar">
      <div class="brand"><h1>memsphere</h1><span class="count" id="count">Loading</span></div>
      <div class="view-tabs">
        <button class="view-tab active" id="memory-tab" type="button">Memory</button>
        <button class="view-tab" id="task-tab" type="button">Task</button>
      </div>
      <input id="search" class="search" type="search" placeholder="Search memories" />
      <div id="nav"></div>
    </aside>

    <section class="content">
      <div class="toolbar">
        <div>
          <h2 class="title" id="title">Memory Browser</h2>
          <div class="subtitle" id="subtitle">Loading local memory store...</div>
        </div>
        <div class="toolbar-actions">
          <button class="btn" id="expand">Expand all</button>
          <button class="btn" id="collapse">Collapse all</button>
          <button class="btn" id="refresh">Refresh</button>
        </div>
      </div>
      <div id="detail" class="empty">Loading...</div>
    </section>

    <aside class="review">
      <div class="review-head">
        <div>
          <h2>Review</h2>
          <div class="review-sub" id="review-label">Create or select a review to comment inline</div>
        </div>
        <button class="btn primary" id="create-review">Create Review</button>
      </div>
      <div id="reviews" class="review-list"></div>
      <section class="panel">
        <div class="toolbar" style="margin-bottom: 10px;">
          <div>
            <div class="block-title" style="margin-top: 0;">Comments</div>
            <div class="muted" id="comment-summary"></div>
          </div>
          <button class="btn primary" id="submit-review">Submit</button>
        </div>
        <div id="comments" class="comment-list"></div>
      </section>
    </aside>
  </main>

  <script>
    const kindOrder = ["procedures", "schemas", "concepts", "statements"];
    const selectedReviewKey = "memsphere.selectedReview.v2";
    const selectedTaskKey = "memsphere.selectedTask.v1";
    const viewModeKey = "memsphere.viewMode.v1";
    const displayLanguageKey = "memsphere.displayLanguage.v1";
    const displayLanguage = localStorage.getItem(displayLanguageKey) === "yaml" ? "yaml" : "zh";
    const vocabulary = {
      procedures: { zh: "流程", yaml: "procedures" },
      schemas: { zh: "图式", yaml: "schemas" },
      concepts: { zh: "概念", yaml: "concepts" },
      statements: { zh: "命题", yaml: "statements" },
      names: { zh: "名称", yaml: "names" },
      defines: { zh: "定义", yaml: "defines" },
      asserts: { zh: "断言", yaml: "asserts" },
      goals: { zh: "目标", yaml: "goals" },
      flow: { zh: "流程", yaml: "flow" },
      step: { zh: "步骤", yaml: "action" },
      if: { zh: "条件判断", yaml: "!if" },
      elseif: { zh: "否则如果", yaml: "elseif" },
      else: { zh: "否则", yaml: "else" },
      while: { zh: "循环判断", yaml: "!while" },
      call: { zh: "调用流程", yaml: "!call" },
      actor: { zh: "执行者", yaml: "actor" },
      agent: { zh: "Agent", yaml: "agent" },
      human: { zh: "人", yaml: "human" },
      artifact: { zh: "产物", yaml: "artifact" },
      schema: { zh: "图式", yaml: "schema" },
      action: { zh: "要做什么", yaml: "action" },
      then: { zh: "然后", yaml: "then" },
      artifactContent: { zh: "产物内容", yaml: "artifact.value" },
      currentStep: { zh: "当前步骤", yaml: "current" },
      jumpToCurrentStep: { zh: "跳到当前步骤", yaml: "Jump to current" },
      jumpToCurrentStepTitle: { zh: "跳转到当前正在运行的流程节点", yaml: "Jump to the currently running flow node" },
      archive: { zh: "归档", yaml: "Archive" },
      archiveDoneOnly: { zh: "只有 done 状态的内容可以归档", yaml: "Only done items can be archived" },
      archiveRunConfirm: { zh: "归档这个 run？归档后它将不再出现在 Task 列表中。", yaml: "Archive this run? It will no longer appear in the Task list." },
      archiveReviewConfirm: { zh: "归档这个 review？归档后它将不再出现在 Review 列表中。", yaml: "Archive this review? It will no longer appear in the Review list." },
      completed: { zh: "已完成", yaml: "done" },
      notStarted: { zh: "未开始", yaml: "pending" },
      waitingReport: { zh: "等待上报", yaml: "waiting" },
      none: { zh: "无", yaml: "none" },
      missingTarget: { zh: "未找到 ", yaml: "missing " },
      noSteps: { zh: "没有步骤", yaml: "No steps" },
      noArtifacts: { zh: "还没有上报产物。", yaml: "No artifact has been reported yet." },
      format: { zh: "格式", yaml: "format" },
      boolean: { zh: "判断结果", yaml: "boolean" },
      string: { zh: "短文本", yaml: "string" },
      int: { zh: "数字", yaml: "int" },
      markdown: { zh: "文档", yaml: "markdown" },
      json: { zh: "JSON", yaml: "json" },
      yaml: { zh: "YAML", yaml: "yaml" }
    };
    const state = {
      viewMode: localStorage.getItem(viewModeKey) === "task" ? "task" : "memory",
      payload: null,
      memories: [],
      reservedMemories: [],
      filtered: [],
      selectedId: null,
      selectedTaskId: localStorage.getItem(selectedTaskKey) || null,
      selectedReviewId: localStorage.getItem(selectedReviewKey) || null,
      byName: new Map(),
      reviews: [],
      runs: [],
      reviewSnapshots: new Map(),
      loadingSnapshots: new Set(),
      renderLine: 0
    };

    function t(key) {
      return vocabulary[key]?.[displayLanguage] || key;
    }

    const el = {
      nav: document.getElementById("nav"),
      detail: document.getElementById("detail"),
      title: document.getElementById("title"),
      subtitle: document.getElementById("subtitle"),
      count: document.getElementById("count"),
      search: document.getElementById("search"),
      reviews: document.getElementById("reviews"),
      comments: document.getElementById("comments"),
      commentSummary: document.getElementById("comment-summary"),
      submitReview: document.getElementById("submit-review"),
      reviewLabel: document.getElementById("review-label"),
      createReview: document.getElementById("create-review"),
      memoryTab: document.getElementById("memory-tab"),
      taskTab: document.getElementById("task-tab")
    };

    document.getElementById("expand").addEventListener("click", () => setAllSections(true));
    document.getElementById("collapse").addEventListener("click", () => setAllSections(false));
    document.getElementById("refresh").addEventListener("click", () => loadAll().catch(renderFatalError));
    el.createReview.addEventListener("click", createReview);
    el.memoryTab.addEventListener("click", () => setViewMode("memory"));
    el.taskTab.addEventListener("click", () => setViewMode("task"));
    el.submitReview.addEventListener("click", submitReview);
    el.search.addEventListener("input", () => {
      applyFilter();
      renderNav();
    });

    loadAll().catch(renderFatalError);
    setInterval(() => {
      if (state.viewMode === "task" && !hasOpenInlineEditor()) {
        loadRuns().then(renderAll).catch(console.error);
      }
    }, 4000);

    async function loadAll() {
      await Promise.all([loadMemories(), loadReservedMemories(), loadReviews(), loadRuns()]);
      ensureSelectedReview();
      renderAll();
    }

    function renderFatalError(error) {
      const message = error instanceof Error ? error.message : String(error);
      el.title.textContent = "Failed to load memsphere";
      el.subtitle.textContent = "";
      el.detail.className = "empty";
      el.detail.textContent = message;
      el.nav.innerHTML = "";
      el.count.textContent = "Error";
      renderReview();
    }

    async function loadMemories() {
      el.detail.className = "empty";
      el.detail.textContent = "Loading...";
      const response = await fetch("/api/memories");
      if (!response.ok) throw new Error(await response.text());
      state.payload = await response.json();
      state.memories = state.payload.memories;
      state.byName = new Map();
      for (const memory of state.memories) {
        if (!memory.entity) continue;
        for (const name of memory.entity.names || []) state.byName.set(name, memory);
      }
      applyFilter();
      el.count.textContent = state.memories.length + " memories";
      if (!state.selectedId && state.filtered[0]) state.selectedId = state.filtered[0].id;
    }

    async function loadReservedMemories() {
      const response = await fetch("/api/reserved-memories");
      if (!response.ok) throw new Error(await response.text());
      state.reservedMemories = (await response.json()).memories || [];
    }

    async function loadReviews() {
      const response = await fetch("/api/reviews");
      if (!response.ok) throw new Error(await response.text());
      state.reviews = (await response.json()).reviews || [];
      ensureSelectedReview();
    }

    async function ensureReviewSnapshot(kind) {
      const review = selectedReview();
      if (!review?.snapshots?.length) return null;
      const key = review.id + ":" + kind;
      if (state.reviewSnapshots.has(key)) return state.reviewSnapshots.get(key);
      if (state.loadingSnapshots.has(key)) return null;
      state.loadingSnapshots.add(key);
      fetch("/api/reviews/" + encodeURIComponent(review.id) + "/snapshot?kind=" + encodeURIComponent(kind))
        .then(async response => {
          if (!response.ok) {
            if (response.status !== 404) throw new Error(await response.text());
            return null;
          }
          return response.json();
        })
        .then(snapshot => {
          if (snapshot) state.reviewSnapshots.set(key, snapshot);
        })
        .catch(console.error)
        .finally(() => {
          state.loadingSnapshots.delete(key);
          renderAll();
        });
      return null;
    }

    function currentReviewSnapshot(kind) {
      const review = selectedReview();
      if (!review?.snapshots?.length) return null;
      return state.reviewSnapshots.get(review.id + ":" + kind) || null;
    }

    async function loadRuns() {
      const response = await fetch("/api/runs");
      if (!response.ok) throw new Error(await response.text());
      state.runs = (await response.json()).runs || [];
      if (!state.runs.some(run => run.id === state.selectedTaskId)) {
        state.selectedTaskId = state.runs[0]?.id || null;
        saveSelectedTask();
      }
    }

    function renderAll() {
      document.body.classList.toggle("task-mode", state.viewMode === "task");
      document.body.classList.toggle("review-active", canComment());
      el.memoryTab.classList.toggle("active", state.viewMode === "memory");
      el.taskTab.classList.toggle("active", state.viewMode === "task");
      if (state.viewMode === "task") {
        renderTaskNav();
        renderSelectedTask();
        renderReview();
        return;
      }
      el.count.textContent = state.memories.length + " memories";
      renderNav();
      renderSelected();
      renderReview();
    }

    function setViewMode(mode) {
      state.viewMode = mode;
      localStorage.setItem(viewModeKey, mode);
      ensureSelectedReview();
      renderAll();
    }

    function ensureSelectedReview() {
      const reviews = filteredReviews();
      if (!reviews.some(review => review.id === state.selectedReviewId)) {
        state.selectedReviewId = null;
        saveSelectedReview();
      }
    }

    function applyFilter() {
      const q = el.search.value.trim().toLowerCase();
      state.filtered = state.memories.filter((memory) => {
        if (!q) return true;
        return [memory.kind, memory.path, errorText(memory.error), ...(memory.entity?.names || [])].join(" ").toLowerCase().includes(q);
      });
    }

    function renderNav() {
      el.nav.innerHTML = "";
      for (const kind of kindOrder) {
        const group = state.filtered.filter((memory) => memory.kind === kind);
        if (!group.length) continue;
        const label = document.createElement("div");
        label.className = "kind";
        label.textContent = t(kind);
        el.nav.append(label);
        const list = document.createElement("div");
        list.className = "memory-list";
        for (const memory of group) {
          const button = document.createElement("button");
          button.className = "memory-button" + (memory.id === state.selectedId ? " active" : "");
          button.textContent = memory.error ? invalidMemoryName(memory) : primaryName(memory.entity);
          button.title = memory.error ? errorText(memory.error) : primaryName(memory.entity);
          button.addEventListener("click", () => {
            state.selectedId = memory.id;
            renderAll();
          });
          list.append(button);
        }
        el.nav.append(list);
      }
      for (const kind of kindOrder) {
        const reserved = filteredReservedMemories().filter((memory) => memory.kind === kind);
        if (!reserved.length) continue;
        const label = document.createElement("div");
        label.className = "kind";
        label.textContent = "Reserved / " + t(kind);
        el.nav.append(label);
        const list = document.createElement("div");
        list.className = "memory-list";
        for (const memory of reserved) {
          const row = document.createElement("div");
          row.className = "memory-row";
          const button = document.createElement("button");
          button.className = "memory-button" + (memory.id === state.selectedId ? " active" : "");
          button.textContent = memory.error ? invalidMemoryName(memory) : primaryName(memory.entity);
          button.title = memory.path;
          button.addEventListener("click", () => {
            state.selectedId = memory.id;
            renderAll();
          });
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "memory-toggle" + (memory.imported ? " imported" : "");
          toggle.textContent = memory.imported ? "Imported" : "Import";
          toggle.title = memory.imported ? "Already imported into memory" : "Import reserved memory";
          toggle.disabled = Boolean(memory.imported);
          toggle.addEventListener("click", () => importReservedMemory(memory, toggle));
          row.append(button, toggle);
          list.append(row);
        }
        el.nav.append(list);
      }
    }

    function filteredReservedMemories() {
      const q = el.search.value.trim().toLowerCase();
      return state.reservedMemories.filter((memory) => {
        if (!q) return true;
        return [memory.kind, memory.path, errorText(memory.error), ...(memory.entity?.names || [])].join(" ").toLowerCase().includes(q);
      });
    }

    async function importReservedMemory(memory, button) {
      await runButtonAction(button, async () => {
        const response = await fetch("/api/reserved-memories/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: memory.path })
        });
        if (!response.ok) throw new Error(await response.text());
        await Promise.all([loadMemories(), loadReservedMemories()]);
        const current = state.reservedMemories.find((item) => item.path === memory.path);
        state.selectedId = current?.id || memory.id;
        renderAll();
      });
    }

    function renderTaskNav() {
      el.nav.innerHTML = "";
      el.count.textContent = state.runs.length + " tasks";
      if (!state.runs.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "No task runs yet.";
        el.nav.append(empty);
        return;
      }

      for (const status of ["running", "done"]) {
        const group = state.runs.filter(run => run.status === status);
        if (!group.length) continue;
        const label = document.createElement("div");
        label.className = "kind";
        label.textContent = status;
        el.nav.append(label);
        const list = document.createElement("div");
        list.className = "task-list";
        for (const run of group) {
          const card = document.createElement("article");
          card.className = "task-card" + (run.id === state.selectedTaskId ? " active" : "");
          const button = document.createElement("button");
          button.type = "button";
          button.className = "task-card-main";
          const title = document.createElement("b");
          title.textContent = run.procedureName;
          const meta = document.createElement("span");
          meta.className = "muted";
          meta.textContent = shortRunId(run.id) + " · " + run.events.length + " artifact(s)";
          button.append(title, meta);
          button.addEventListener("click", () => {
            const changedTask = state.selectedTaskId !== run.id;
            state.selectedTaskId = run.id;
            saveSelectedTask();
            renderAll();
            if (changedTask) scrollTaskDetailToTop();
          });
          card.append(button, archiveRunButton(run, "task-card-archive"));
          list.append(card);
        }
        el.nav.append(list);
      }
    }

    function selectedTask() {
      const snapshot = currentReviewSnapshot("task");
      if (snapshot?.run) return snapshot.run;
      return state.runs.find(run => run.id === state.selectedTaskId) || state.runs[0] || null;
    }

    function renderSelectedTask() {
      const review = selectedReview();
      if (review && !review.snapshots?.some(snapshot => snapshot.kind === "task")) {
        renderInvalidReview(review, "Task review has no task snapshot.");
        return;
      }
      if (review && !currentReviewSnapshot("task")) {
        ensureReviewSnapshot("task");
        el.title.textContent = "Tasks";
        el.subtitle.textContent = review.id;
        el.detail.className = "empty";
        el.detail.textContent = "Loading review snapshot...";
        return;
      }
      const run = selectedTask();
      if (!run) {
        el.title.textContent = "Tasks";
        el.subtitle.textContent = "No runs found.";
        el.detail.className = "empty";
        el.detail.innerHTML = 'Start one with <code>memsphere run start &lt;procedure&gt;</code>.';
        return;
      }

      state.selectedTaskId = run.id;
      if (!currentReviewSnapshot("task")) saveSelectedTask();
      el.title.textContent = run.procedureName;
      el.subtitle.textContent = run.id;
      el.detail.className = "task-summary";
      el.detail.innerHTML = "";
      el.detail.append(renderRunMeta(run));
      if (run.plan && run.plan.length) el.detail.append(renderRunFlow(run));
      else el.detail.append(renderRunArtifacts(run));
    }

    function renderRunMeta(run) {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.append(pill(run.status, false, statusPillClass(run.status)));
      meta.append(pill(run.stack.length + " active frame(s)"));
      meta.append(pill(run.events.length + " artifact(s)"));
      meta.append(pill("updated " + formatTime(run.updatedAt)));
      const activeStep = currentRunStep(run);
      if (activeStep && run.plan && run.plan.length) meta.append(currentStepJumpButton(run));
      const review = selectedReview();
      const commentCount = review ? review.comments.filter(comment => comment.memoryId === "task/" + run.id).length : 0;
      if (commentCount) meta.append(pill(commentCount + " review comments", false, "warn"));
      return meta;
    }

    function archiveRunButton(run, className = "") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = ["btn", "archive-run-action", className].filter(Boolean).join(" ");
      button.textContent = t("archive");
      button.disabled = run.status !== "done";
      button.title = run.status === "done" ? t("archiveRunConfirm") : t("archiveDoneOnly");
      button.addEventListener("click", () => runButtonAction(button, () => archiveSelectedRun(run)));
      return button;
    }

    function currentStepJumpButton(run) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pill current-step-jump";
      button.textContent = t("jumpToCurrentStep");
      button.title = t("jumpToCurrentStepTitle");
      button.setAttribute("aria-label", t("jumpToCurrentStepTitle"));
      button.addEventListener("click", () => scrollToCurrentTaskStep(run));
      return button;
    }

    function renderCurrentRunStep(run, step) {
      const frame = currentRunFrame(run);
      const section = document.createElement("section");
      section.className = "section open task-step";
      section.append(taskSectionHeader("Next: " + step.artifact, formatLabel(step.format), "next-step"));
      const panel = document.createElement("div");
      panel.className = "section-body";
      panel.append(blockTitle(t("action")));
      const instruction = document.createElement("div");
      instruction.textContent = step.instruction;
      panel.append(instruction);
      if (step.details && step.details.length) {
        const details = document.createElement("ul");
        details.className = "text-list";
        for (const detail of step.details) {
          const item = document.createElement("li");
          item.textContent = detail;
          details.append(item);
        }
        panel.append(details);
      }
      const artifact = document.createElement("div");
      artifact.className = "meta";
      if (step.kind) artifact.append(pill(step.kind));
      artifact.append(pill(step.artifact, true));
      appendFormatMeta(artifact, step.format, step.schemaName);
      artifact.append(pill((frame?.type || "run") + " · " + (frame ? (frame.index + 1) + "/" + frame.steps.length : "")));
      panel.append(artifact);
      const command = document.createElement("div");
      command.className = "pre mono";
      command.textContent = step.format === "schema"
        ? "memsphere run enter-schema " + shellQuote(step.schemaName || step.artifact) + " --run " + shellQuote(run.id)
        : "memsphere run report --run " + shellQuote(run.id) + " --artifact <value>";
      panel.append(blockTitle(t("then")));
      panel.append(command);
      section.append(panel);
      return section;
    }

    function renderRunArtifacts(run) {
      const wrap = document.createElement("div");
      if (!run.events.length) {
        const empty = document.createElement("section");
        empty.className = "panel";
        empty.append(blockTitle(t("artifact")));
        const body = document.createElement("div");
        body.className = "muted";
        body.textContent = t("noArtifacts");
        empty.append(body);
        wrap.append(empty);
        return wrap;
      }
      const title = document.createElement("div");
      title.className = "block-title";
      title.textContent = t("artifact");
      wrap.append(title);
      for (const event of run.events) {
        wrap.append(renderRunArtifact(event));
      }
      return wrap;
    }

    function renderRunArtifact(event) {
      const section = document.createElement("section");
      section.className = "section open";
      section.append(taskSectionHeader(event.artifact.name, artifactHeaderBadge(event.artifact), event.stepId));
      const body = document.createElement("div");
      body.className = "section-body";
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.append(pill(event.frame));
      appendFormatMeta(meta, event.artifact.format, artifactSchemaName(event.artifact));
      appendArtifactStorageMeta(meta, event.artifact);
      meta.append(pill(formatTime(event.at)));
      const value = renderArtifactValue(event.artifact);
      body.append(meta, blockTitle(t("artifactContent")), value);
      section.append(body);
      return section;
    }

    function renderRunFlow(run) {
      const wrap = document.createElement("div");
      const title = document.createElement("div");
      title.className = "block-title";
      title.textContent = t("flow");
      wrap.append(title);
      const flow = document.createElement("div");
      flow.className = "flow";
      const eventsByStep = new Map();
      for (const event of run.events) eventsByStep.set(event.stepId, event);
      const activeStep = currentRunStep(run);
      for (const step of run.plan || []) {
        flow.append(renderTaskFlowStep(step, eventsByStep, activeStep, run));
      }
      wrap.append(flow);
      return wrap;
    }

    function renderTaskFlowStep(step, eventsByStep, activeStep, run) {
      if (step.kind === "branch" && step.branches) return renderTaskBranch(step, eventsByStep, activeStep, run);
      if (step.kind === "loop" && step.loop) return renderTaskLoop(step, eventsByStep, activeStep, run);
      if (step.kind === "call") return renderTaskCall(step);
      return renderTaskAction(step, eventsByStep, activeStep, run);
    }

    function renderTaskAction(step, eventsByStep, activeStep, run) {
      const item = document.createElement("div");
      const isActive = activeStep && activeStep.id === step.id;
      item.className = "flow-item" + (isActive ? " task-step" : "");
      attachTaskStepLocation(item, run, step, isActive);
      const event = eventsByStep.get(step.id);
      item.append(renderFlowHead(t("step"), step.instruction, step.artifact || step.id, taskAnchor(run, step, "action"), step, taskStepStatus(step, event, activeStep), { run, step, event, commentKind: "action" }));
      appendOptional(item, renderTaskStepResult(step, event, run));
      return item;
    }

    function renderTaskBranch(step, eventsByStep, activeStep, run) {
      const item = document.createElement("div");
      const isActive = activeStep && activeStep.id === step.id;
      item.className = "flow-item branch" + (isActive ? " task-step" : "");
      attachTaskStepLocation(item, run, step, isActive);
      const event = eventsByStep.get(step.id);
      item.append(renderFlowHead(t("if"), step.instruction, step.artifact || step.id, taskAnchor(run, step, "action"), step, taskStepStatus(step, event, activeStep), { run, step, event, commentKind: "action" }));
      appendOptional(item, renderTaskStepResult(step, event, run));
      item.append(renderTaskChildSteps(step.branches.truthy, eventsByStep, activeStep, run));
      if (step.branches.falsy.length) item.append(renderElseTaskBranch(step.branches.falsy, eventsByStep, activeStep, run));
      return item;
    }

    function renderTaskLoop(step, eventsByStep, activeStep, run) {
      const item = document.createElement("div");
      const isActive = activeStep && activeStep.id === step.id;
      item.className = "flow-item branch" + (isActive ? " task-step" : "");
      attachTaskStepLocation(item, run, step, isActive);
      const event = eventsByStep.get(step.id);
      item.append(renderFlowHead(t("while"), step.instruction, step.artifact || step.id, taskAnchor(run, step, "action"), step, taskStepStatus(step, event, activeStep), { run, step, event, commentKind: "action" }));
      appendOptional(item, renderTaskStepResult(step, event, run));
      item.append(renderTaskChildSteps(step.loop.body, eventsByStep, activeStep, run));
      return item;
    }

    function renderTaskCall(step) {
      return renderCall(step.target, step.id);
    }

    function renderTaskChildSteps(steps, eventsByStep, activeStep, run) {
      const children = document.createElement("div");
      children.className = "flow-children";
      if (!steps.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = t("noSteps");
        children.append(empty);
      } else {
        steps.forEach(step => children.append(renderTaskFlowStep(step, eventsByStep, activeStep, run)));
      }
      return children;
    }

    function renderElseTaskBranch(steps, eventsByStep, activeStep, run) {
      const wrap = document.createElement("div");
      wrap.className = "flow-else";
      const head = document.createElement("div");
      head.className = "flow-head";
      const label = document.createElement("div");
      label.className = "flow-label";
      label.textContent = t("else");
      head.append(label, document.createElement("div"));
      wrap.append(head, renderTaskChildSteps(steps, eventsByStep, activeStep, run));
      return wrap;
    }

    function appendOptional(parent, child) {
      if (child) parent.append(child);
    }

    function shouldRenderTaskStepArtifact(event) {
      return Boolean(event);
    }

    function renderTaskStepResult(step, event, run) {
      if (!shouldRenderTaskStepArtifact(event)) return null;
      const box = document.createElement("div");
      box.className = "task-result";
      const title = document.createElement("div");
      title.className = "block-title";
      title.textContent = t("artifactContent");
      const artifactValue = artifactDisplayValue(event.artifact);
      const artifactContent = renderArtifactValue(event.artifact);
      const value = commentable(
        artifactContent,
        event.artifact.name,
        artifactValue,
        taskAnchor(run, step, "artifact"),
        { run, step, event, commentKind: "artifact" }
      );
      box.append(title, value);
      return box;
    }

    function taskAnchor(run, step, part) {
      return "task:" + run.id + ":" + step.id + ":" + part;
    }

    function attachTaskStepLocation(item, run, step, isActive) {
      item.dataset.stepId = step.id;
      if (!isActive) return;
      item.dataset.currentTaskStep = "true";
      item.id = taskStepDomId(run, step);
    }

    function scrollToCurrentTaskStep(run) {
      const activeStep = currentRunStep(run);
      if (!activeStep) return;
      const target = document.getElementById(taskStepDomId(run, activeStep))
        || el.detail.querySelector('[data-current-task-step="true"]')
        || el.detail.querySelector(".task-step");
      if (!target) return;
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.classList.remove("task-step-spotlight");
      setTimeout(() => target.classList.add("task-step-spotlight"), 20);
      setTimeout(() => target.classList.remove("task-step-spotlight"), 1700);
    }

    function taskStepDomId(run, step) {
      return "task-step-" + slug(run.id + "-" + step.id);
    }

    function scrollTaskDetailToTop() {
      requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
    }

    function taskStepStatus(step, event, activeStep) {
      if (event) return t("completed");
      if (activeStep && activeStep.id === step.id) return t("currentStep");
      return t("notStarted");
    }

    function taskSectionHeader(text, badge, anchor) {
      const button = document.createElement("button");
      button.className = "section-header";
      button.dataset.anchor = "task:" + anchor;
      button.innerHTML = '<span class="chevron">›</span><span class="node-title"></span><span class="pill"></span>';
      button.querySelector(".node-title").textContent = text;
      button.querySelector(".pill").textContent = badge;
      button.addEventListener("click", () => button.parentElement.classList.toggle("open"));
      return button;
    }

    function currentRunFrame(run) {
      return run.stack && run.stack.length ? run.stack[run.stack.length - 1] : null;
    }

    function currentRunStep(run) {
      const frame = currentRunFrame(run);
      return frame ? frame.steps[frame.index] : null;
    }

    function blockTitle(text) {
      const title = document.createElement("div");
      title.className = "block-title";
      title.textContent = text;
      return title;
    }

    function shortRunId(id) {
      return String(id || "").replace(/^run-/, "").slice(0, 18);
    }

    function formatTime(value) {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString();
    }

    function shellQuote(value) {
      const text = String(value ?? "");
      if (/^[a-zA-Z0-9_./:-]+$/.test(text)) return text;
      return "'" + text.replace(/'/g, "'\\''") + "'";
    }

    function selectedMemory() {
      const snapshot = currentReviewSnapshot("memory");
      if (snapshot?.memory) return snapshot.memory;
      return state.memories.find((item) => item.id === state.selectedId)
        || state.reservedMemories.find((item) => item.id === state.selectedId)
        || state.filtered[0]
        || state.reservedMemories[0];
    }

    function selectedReview() {
      return filteredReviews().find(review => review.id === state.selectedReviewId) || null;
    }

    function filteredReviews() {
      const subject = reviewListSubject();
      if (!subject) return [];
      return state.reviews.filter(review => reviewMatchesSubject(review, subject));
    }

    function reviewListSubject() {
      if (state.viewMode === "task") {
        const run = state.runs.find(item => item.id === state.selectedTaskId) || state.runs[0] || null;
        if (!run) return null;
        return {
          source: "task",
          id: "task/" + run.id,
          runId: run.id
        };
      }
      const memory = state.memories.find((item) => item.id === state.selectedId) || state.filtered[0];
      if (!memory) return null;
      return {
        source: "memory",
        id: memory.id,
        path: memory.path
      };
    }

    function reviewMatchesSubject(review, subject) {
      if (reviewSource(review) !== subject.source) return false;

      if (review.target) {
        if (review.target.source !== subject.source) return false;
        if (subject.source === "task") {
          return review.target.runId === subject.runId || review.target.id === subject.id;
        }
        if (review.target.path && subject.path) return review.target.path === subject.path;
        return review.target.id === subject.id;
      }

      if (subject.source === "task") {
        return review.snapshots?.some(snapshot => snapshot.kind === "task" && snapshot.label === subject.runId + ".json");
      }

      return review.snapshots?.some(snapshot => snapshot.kind === "memory" && snapshot.label === subject.path)
        || review.comments?.some(comment => comment.memoryId === subject.id);
    }

    function reviewSource(review) {
      if (review.source === "task" || review.source === "memory") return review.source;
      return "invalid";
    }

    function currentReviewSubject() {
      if (state.viewMode === "task") {
        const run = selectedTask();
        if (!run) return null;
        return {
          source: "task",
          id: "task/" + run.id,
          kind: "tasks",
          name: run.procedureName,
          runId: run.id
        };
      }
      const memory = selectedMemory();
      if (!memory) return null;
      return {
        source: "memory",
        id: memory.id,
        kind: memory.kind,
        name: memory.error ? invalidMemoryName(memory) : primaryName(memory.entity),
        path: memory.path
      };
    }

    function canComment() {
      const status = selectedReview()?.status;
      return status === "draft" || status === "submitted";
    }

    function canCreateReview() {
      const subject = currentReviewSubject();
      if (!subject) return false;
      return subject.source !== "task" || selectedTask()?.status === "done";
    }

    function renderSelected() {
      const review = selectedReview();
      if (review && !review.snapshots?.some(snapshot => snapshot.kind === "memory")) {
        renderInvalidReview(review, "Memory review has no memory snapshot.");
        return;
      }
      if (review && !currentReviewSnapshot("memory")) {
        ensureReviewSnapshot("memory");
        el.title.textContent = "Memory";
        el.subtitle.textContent = review.id;
        el.detail.className = "empty";
        el.detail.textContent = "Loading review snapshot...";
        return;
      }
      const memory = selectedMemory();
      if (!memory) {
        el.title.textContent = "No memories";
        el.subtitle.textContent = "";
        el.detail.className = "empty";
        el.detail.textContent = "No memory entities found.";
        return;
      }
      if (memory.error) {
        if (!currentReviewSnapshot("memory")) state.selectedId = memory.id;
        renderInvalidMemory(memory);
        return;
      }
      if (!currentReviewSnapshot("memory")) state.selectedId = memory.id;
      el.title.textContent = primaryName(memory.entity);
      el.subtitle.textContent = memory.path;
      el.detail.className = "";
      el.detail.innerHTML = "";
      state.renderLine = 0;
      el.detail.append(renderMeta(memory));
      if (memory.kind === "schemas") el.detail.append(renderSchema(memory.entity, 0, primaryName(memory.entity)));
      else if (memory.kind === "procedures") el.detail.append(renderProcedure(memory.entity));
      else el.detail.append(renderGeneric(memory.entity));
    }

    function renderInvalidReview(review, message) {
      el.title.textContent = "Invalid review";
      el.subtitle.textContent = review?.id || "";
      el.detail.className = "empty";
      el.detail.textContent = message || "This review has no snapshot.";
    }

    function primaryName(entity) {
      return entity && Array.isArray(entity.names) && entity.names.length ? entity.names[0] : "(unnamed)";
    }

    function invalidMemoryName(memory) {
      return memory.path ? memory.path.replace(/^.*\//, "").replace(/\.ya?ml$/, "") : "Invalid memory";
    }

    function renderInvalidMemory(memory) {
      el.title.textContent = invalidMemoryName(memory);
      el.subtitle.textContent = memory.kind + " / " + memory.path;
      el.detail.className = "";
      el.detail.innerHTML = "";

      const panel = document.createElement("section");
      panel.className = "error-panel";

      const heading = document.createElement("h3");
      heading.textContent = "Invalid memory YAML";
      panel.append(heading);

      const body = document.createElement("p");
      body.textContent = memory.error?.message || "This memory could not be loaded.";
      panel.append(body);

      const issues = Array.isArray(memory.error?.issues) && memory.error.issues.length
        ? memory.error.issues
        : [errorText(memory.error)];
      const list = document.createElement("ul");
      list.className = "error-list";
      for (const issue of issues) {
        const item = document.createElement("li");
        item.textContent = issue;
        list.append(item);
      }
      panel.append(list);

      el.detail.append(panel);
    }

    function errorText(error) {
      if (!error) return "";
      if (typeof error === "string") return error;
      return [error.message, ...(Array.isArray(error.issues) ? error.issues : [])].filter(Boolean).join(" ");
    }

    function renderMeta(memory) {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.append(pill(memory.entity.tag || memory.kind, true));
      if (memory.source === "reserved") {
        meta.append(pill("reserved", true));
        meta.append(pill(memory.imported ? "imported" : "not imported", false, memory.imported ? "done" : ""));
      }
      if (memory.entity.format) meta.append(pill("format: " + memory.entity.format));
      const review = selectedReview();
      const commentCount = review ? review.comments.filter(c => c.memoryId === memory.id).length : 0;
      if (commentCount) meta.append(pill(commentCount + " review comments", false, "warn"));
      return meta;
    }

    function pill(text, strong = false, extra = "") {
      const item = document.createElement("span");
      item.className = "pill" + (strong ? " strong" : "") + (extra ? " " + extra : "");
      item.textContent = text;
      return item;
    }

    function renderGeneric(entity) {
      const box = document.createElement("div");
      box.className = "section open";
      const label = entity.tag || "memory";
      box.append(sectionHeader(label, label, label, "section:" + label));
      const body = document.createElement("div");
      body.className = "section-body";
      appendNames(body, entity);
      appendTextBlocks(body, entity);
      box.append(body);
      return box;
    }

    function renderSchema(node, depth, path) {
      const section = document.createElement("div");
      section.className = "section" + (depth < 2 ? " open" : "");
      const badge = node.format ? "format: " + node.format : (node.fields && node.fields.length ? node.fields.length + " fields" : "field");
      const label = depth === 0 ? (node.tag || "schema") : primaryName(node);
      section.append(sectionHeader(label, badge, path, "schema:" + path));
      const body = document.createElement("div");
      body.className = "section-body";
      if (depth === 0) appendNames(body, node);
      appendTextBlocks(body, node);
      if (node.format === "table") body.append(renderTableFields(node.fields || [], path));
      else if (node.fields && node.fields.length) {
        const children = document.createElement("div");
        children.className = "child-stack";
        for (const child of node.fields) children.append(renderSchema(child, depth + 1, path + " > " + primaryName(child)));
        body.append(children);
      }
      section.append(body);
      return section;
    }

    function sectionHeader(text, badge, target, anchor) {
      const location = nextLocation(anchor || "section:" + target);
      const button = document.createElement("button");
      button.className = "section-header";
      button.dataset.anchor = location.anchor;
      button.id = domIdForAnchor(location.anchor);
      button.innerHTML = '<span class="chevron">›</span><span class="node-title"></span><span class="pill"></span>';
      button.querySelector(".node-title").textContent = text;
      button.querySelector(".pill").textContent = badge;
      const count = commentsForAnchor(location.anchor, text).length;
      if (count) button.append(pill(count + " comments", false, "warn"));
      const targetButton = document.createElement("span");
      targetButton.className = "target-add";
      targetButton.textContent = "+";
      targetButton.title = "Add review comment";
      targetButton.addEventListener("click", (event) => {
        event.stopPropagation();
        openInlineEditor(button.parentElement, target || text, text, withLocationHash(location, text));
      });
      button.append(targetButton);
      button.addEventListener("click", () => button.parentElement.classList.toggle("open"));
      return button;
    }

    function appendTextBlocks(target, node) {
      appendList(target, t("defines"), node.defines, "defines");
      appendList(target, t("asserts"), node.asserts, "asserts");
    }

    function appendNames(target, node) {
      appendList(target, t("names"), node.names, "names");
    }

    function appendList(target, heading, values, key) {
      if (!values || !values.length) return;
      const title = document.createElement("div");
      title.className = "block-title";
      title.textContent = heading;
      const list = document.createElement("ul");
      list.className = "text-list";
      values.forEach((value, index) => {
        const item = document.createElement("li");
        const label = heading + "[" + (index + 1) + "]";
        item.append(commentable(value, label, value, key + "[" + (index + 1) + "]"));
        list.append(item);
      });
      target.append(title, list);
    }

    function renderTableFields(fields, path) {
      const table = document.createElement("table");
      table.className = "field-table";
      const body = document.createElement("tbody");
      for (const field of fields) {
        const row = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = primaryName(field);
        const fieldTarget = path + " > " + primaryName(field);
        const fieldAnchor = "field:" + fieldTarget;
        const fieldLocation = nextLocation(fieldAnchor);
        th.dataset.anchor = fieldLocation.anchor;
        th.append(commentButton(fieldTarget, primaryName(field), withLocationHash(fieldLocation, primaryName(field))));
        const td = document.createElement("td");
        const parts = [];
        if (field.defines && field.defines.length) parts.push(field.defines.join("\n"));
        if (field.asserts && field.asserts.length) parts.push(field.asserts.join("\n"));
        const snapshot = parts.join("\n\n") || "Column";
        td.append(commentable(snapshot, fieldTarget, snapshot, fieldAnchor + ":body"));
        row.append(th, td);
        body.append(row);
      }
      table.append(body);
      return table;
    }

    function renderProcedure(entity) {
      const wrap = document.createElement("div");
      appendNames(wrap, entity);
      appendTextBlocks(wrap, entity);
      if (entity.goals && entity.goals.length) appendList(wrap, t("goals"), entity.goals, "goals");
      const title = document.createElement("div");
      title.className = "block-title";
      title.textContent = t("flow");
      const flow = document.createElement("div");
      flow.className = "flow";
      for (const [index, step] of (entity.flow || []).entries()) flow.append(renderFlowStep(step, "flow[" + (index + 1) + "]"));
      wrap.append(title, flow);
      return wrap;
    }

    function renderFlowStep(step, anchor) {
      if (!step || typeof step !== "object") return invalidFlowItem(step, anchor);
      if (step.tag === "!call" && step.target) return renderCall(step.target, anchor);
      if (step.tag === "!if" && step.condition) return renderCanonicalIf(step, anchor);
      if (step.tag === "!while" && step.condition) return renderCanonicalWhile(step, anchor);
      if (step.action && artifactSpec(step).format) return renderStructuredAction(step, anchor);
      return invalidFlowItem(step, anchor);
    }

    function flowItem(child) {
      const item = document.createElement("div");
      item.className = "flow-item";
      item.append(child);
      return item;
    }

    function invalidFlowItem(step, anchor) {
      const text = "Invalid flow step: " + JSON.stringify(step, null, 2);
      const item = document.createElement("div");
      item.className = "flow-item branch";
      item.append(commentable(text, anchor, text, anchor));
      return item;
    }

    function renderCall(name, anchor) {
      const item = document.createElement("div");
      item.className = "flow-item call";
      const target = state.byName.get(name);
      const link = document.createElement("a");
      link.className = "call-link";
      link.href = "#";
      link.textContent = target ? primaryName(target.entity) : (name || "(missing target)");
      link.title = target ? "Open called memory" : "Called memory not found";
      link.addEventListener("click", (event) => {
        event.preventDefault();
        if (target) {
          state.selectedId = target.id;
          renderAll();
        }
      });
      const head = document.createElement("div");
      head.className = "flow-head";
      const label = document.createElement("div");
      label.className = "flow-label";
      label.textContent = t("call");
      const action = document.createElement("div");
      action.className = "flow-action";
      const content = document.createElement("span");
      if (!target) {
        const text = document.createElement("span");
        text.textContent = t("missingTarget");
        content.append(text);
      }
      content.append(link);
      action.append(commentable(content, "!call " + name, String(name), anchor));
      head.append(label, action);
      item.append(head);
      return item;
    }

    function renderCanonicalIf(step, anchor) {
      const item = document.createElement("div");
      item.className = "flow-item branch";
      item.append(renderStructuredControlHead(step.condition, anchor + ".condition", t("if")));
      item.append(renderNamedFlowChildren("", step.then || [], anchor + ".then"));
      const elseif = Array.isArray(step.elseif) ? step.elseif : [];
      elseif.forEach((branch, index) => {
        const branchWrap = document.createElement("div");
        branchWrap.append(renderStructuredControlHead(branch.condition, anchor + ".elseif[" + (index + 1) + "].condition", t("elseif")));
        branchWrap.append(renderNamedFlowChildren("", branch.then || [], anchor + ".elseif[" + (index + 1) + "].then"));
        item.append(branchWrap);
      });
      if (step.else) item.append(renderElseBranch(step.else || [], anchor + ".else"));
      return item;
    }

    function renderCanonicalWhile(step, anchor) {
      const item = document.createElement("div");
      item.className = "flow-item branch";
      item.append(renderStructuredControlHead(step.condition, anchor + ".condition", t("while")));
      item.append(renderNamedFlowChildren("", step.do || [], anchor + ".do"));
      return item;
    }

    function renderStructuredAction(step, anchor) {
      const item = document.createElement("div");
      item.className = "flow-item";
      const artifact = artifactSpec(step);
      item.append(renderFlowHead(t("step"), step.action, artifact.name || anchor, anchor + ".action", step));
      return item;
    }

    function renderStructuredBranch(step, anchor) {
      const item = document.createElement("div");
      item.className = "flow-item branch";
      item.append(renderStructuredControlHead(step.branch, anchor + ".branch", t("if")));
      item.append(renderNamedFlowChildren("when true", step.when_true || [], anchor + ".when_true"));
      item.append(renderNamedFlowChildren("when false", step.when_false || [], anchor + ".when_false"));
      return item;
    }

    function renderStructuredLoop(step, anchor) {
      const item = document.createElement("div");
      item.className = "flow-item branch";
      item.append(renderStructuredControlHead(step.loop, anchor + ".loop", t("while")));
      item.append(renderNamedFlowChildren("while true", step.while_true || [], anchor + ".while_true"));
      return item;
    }

    function renderStructuredControlHead(step, anchor, labelText = t("if")) {
      const head = document.createElement("div");
      if (!step || typeof step !== "object") {
        head.append(commentable(String(step), anchor, String(step), anchor));
        return head;
      }
      const artifact = artifactSpec(step);
      head.append(renderFlowHead(labelText, step.action || "", artifact.name || anchor, anchor + ".action", step));
      return head;
    }

    function renderElseBranch(steps, anchor) {
      const wrap = document.createElement("div");
      wrap.className = "flow-else";
      const head = document.createElement("div");
      head.className = "flow-head";
      const label = document.createElement("div");
      label.className = "flow-label";
      label.textContent = t("else");
      const action = document.createElement("div");
      action.className = "flow-action muted";
      head.append(label, action);
      wrap.append(head);
      const children = document.createElement("div");
      children.className = "flow-children";
      if (!Array.isArray(steps) || !steps.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = t("noSteps");
        children.append(empty);
      } else {
        steps.forEach((child, index) => children.append(renderFlowStep(child, anchor + "[" + (index + 1) + "]")));
      }
      wrap.append(children);
      return wrap;
    }

    function renderFlowHead(labelText, action, target, anchor, step, status, context = {}) {
      const head = document.createElement("div");
      head.className = "flow-head";
      const label = document.createElement("div");
      label.className = "flow-label";
      label.textContent = labelText || t("if");
      head.append(label);
      head.append(renderActionText(action, target, anchor, context));
      head.append(renderArtifactRow(step, status));
      return head;
    }

    function renderActionText(text, target, anchor, context = {}) {
      const wrap = document.createElement("div");
      wrap.className = "flow-action";
      wrap.append(commentable(text, target, text, anchor, context));
      return wrap;
    }

    function renderArtifactRow(step, status) {
      const row = document.createElement("div");
      row.className = "artifact-row";
      if (stepActor(step) === "human") {
        const actorLabel = document.createElement("span");
        actorLabel.className = "artifact-label";
        actorLabel.textContent = t("actor");
        row.append(actorLabel, actorPill("human"));
      }
      const label = document.createElement("span");
      label.className = "artifact-label";
      label.textContent = t("artifact");
      row.append(label);
      appendArtifactMeta(row, step);
      if (status) row.append(pill(status, false, status === t("currentStep") ? "processing" : status === t("completed") ? "done" : ""));
      return row;
    }

    function actorPill(actor) {
      return pill(t(actor), false, actor === "human" ? "human" : "agent");
    }

    function appendArtifactMeta(target, step) {
      const artifact = artifactSpec(step);
      target.append(pill(artifact.name || t("artifact"), true));
      appendFormatMeta(target, artifact.format, artifact.schema);
    }

    function appendFormatMeta(target, format, schemaName) {
      if (format === "schema" && schemaName) {
        target.append(schemaLinkPill(schemaName));
        return;
      }
      target.append(pill(formatLabel(format)));
    }

    function appendArtifactStorageMeta(target, artifact) {
      if (!artifact) return;
      if (artifact.storage === "file") {
        target.append(pill("file", false, "strong"));
        if (artifact.path) target.append(pill(artifact.path));
        return;
      }
      if (artifact.storage === "inline") target.append(pill("inline"));
    }

    function schemaLinkPill(schemaName) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "pill schema-link";
      link.textContent = t("schema") + ": " + schemaName;
      link.title = "Open schema";
      link.addEventListener("click", (event) => {
        event.stopPropagation();
        const target = state.byName.get(schemaName);
        if (target) {
          state.viewMode = "memory";
          localStorage.setItem(viewModeKey, "memory");
          state.selectedId = target.id;
          renderAll();
        }
      });
      return link;
    }

    function artifactHeaderBadge(artifact) {
      const schemaName = artifactSchemaName(artifact);
      if (artifact.format === "schema" && schemaName) return t("schema") + ": " + schemaName;
      return formatLabel(artifact.format);
    }

    function artifactSchemaName(artifact) {
      const fieldValue = artifact?.fields?.schema_name;
      return typeof fieldValue === "string" ? fieldValue : artifact?.schemaName || "";
    }

    function artifactDisplayValue(artifact) {
      if (!artifact) return "";
      if (artifact.storage === "file") {
        if (typeof artifact.content === "string") return artifact.content;
        if (artifact.contentError) return "Unable to read artifact file: " + artifact.contentError;
        return artifact.path ? "File artifact: " + artifact.path : "";
      }
      return artifact.value ?? "";
    }

    function shouldRenderMarkdownArtifact(artifact) {
      return artifact?.format === "markdown" && typeof artifact.renderedContent === "string";
    }

    function renderArtifactValue(artifact) {
      if (shouldRenderMarkdownArtifact(artifact)) {
        const markdown = document.createElement("div");
        markdown.className = "markdown-body";
        markdown.innerHTML = artifact.renderedContent;
        return markdown;
      }
      const pre = document.createElement("div");
      pre.className = "pre";
      pre.textContent = artifactDisplayValue(artifact);
      return pre;
    }

    function artifactSpec(step) {
      if (step && step.artifact && typeof step.artifact === "object") {
        return {
          name: step.artifact.name || "",
          format: step.artifact.format || "",
          schema: step.artifact.schema || ""
        };
      }
      return {
        name: typeof step?.artifact === "string" ? step.artifact : "",
        format: step?.format || "",
        schema: step?.schema || ""
      };
    }

    function stepActor(step) {
      return step?.actor === "human" ? "human" : "agent";
    }

    function formatLabel(format) {
      if (format === "boolean") return t("boolean");
      if (format === "string") return t("string");
      if (format === "int") return t("int");
      if (format === "markdown") return t("markdown");
      if (format === "json") return t("json");
      if (format === "yaml") return t("yaml");
      if (format === "schema") return t("schema");
      return format || t("format");
    }

    function renderNamedFlowChildren(labelText, steps, anchor) {
      const wrap = document.createElement("div");
      const children = document.createElement("div");
      children.className = "flow-children";
      if (!Array.isArray(steps) || !steps.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = t("noSteps");
        children.append(empty);
      } else {
        steps.forEach((child, index) => children.append(renderFlowStep(child, anchor + "[" + (index + 1) + "]")));
      }
      if (labelText) {
        wrap.className = "flow-branch-row";
        const condition = document.createElement("div");
        condition.className = "flow-condition";
        condition.textContent = labelText;
        wrap.append(condition);
      } else {
        wrap.className = "flow-branch-body";
      }
      wrap.append(children);
      return wrap;
    }

    function renderBranch(step, anchor) {
      const item = document.createElement("div");
      item.className = "flow-item branch";
      const label = document.createElement("div");
      label.className = "flow-label";
      label.textContent = step.tag.replace("!", "");
      item.append(label);
      for (const [key, value] of Object.entries(step)) {
        if (key === "tag") continue;
        const condition = document.createElement("div");
        condition.className = "flow-condition";
        condition.append(commentable(key, step.tag + " " + key, key, anchor + "." + key));
        item.append(condition);
        const children = document.createElement("div");
        children.className = "flow-children";
        const steps = Array.isArray(value) ? value : [value];
        steps.forEach((child, index) => children.append(renderFlowStep(child, anchor + "." + key + "[" + (index + 1) + "]")));
        item.append(children);
      }
      return item;
    }

    function commentable(content, target, snapshot, anchor, context = {}) {
      const location = nextLocation(anchor || target);
      const locationWithHash = withLocationHash(location, snapshot);
      const wrap = document.createElement("div");
      wrap.className = "commentable";
      wrap.dataset.anchor = location.anchor;
      wrap.id = domIdForAnchor(location.anchor);
      wrap.append(commentButton(target, snapshot, locationWithHash, context));
      const body = document.createElement("div");
      body.className = "commentable-body";
      if (content instanceof Node) body.append(content);
      else body.textContent = String(content);
      wrap.append(body);
      const thread = renderInlineThread(location.anchor, snapshot);
      if (thread) wrap.append(thread);
      return wrap;
    }

    function commentButton(target, snapshot, location, context = {}) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "inline-plus";
      button.textContent = "+";
      button.title = "Add review comment";
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        openInlineEditor(button.parentElement, target, snapshot, location, context);
      });
      return button;
    }

    function openInlineEditor(host, target, snapshot, location, context = {}) {
      if (!canComment() || !host) return;
      closeInlineEditors();
      const editor = document.createElement("div");
      editor.className = "inline-comment-editor";
      const textarea = document.createElement("textarea");
      textarea.placeholder = "What should change here?";
      const actions = document.createElement("div");
      actions.className = "comment-actions";
      const save = document.createElement("button");
      save.type = "button";
      save.className = "btn primary";
      save.textContent = "Add comment";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn";
      cancel.textContent = "Cancel";
      save.addEventListener("click", async () => {
        const body = textarea.value.trim();
        if (!body) {
          textarea.focus();
          return;
        }
        await addComment(target, snapshot, body, location, context);
        editor.remove();
      });
      cancel.addEventListener("click", () => editor.remove());
      actions.append(save, cancel);
      editor.append(textarea, actions);
      host.append(editor);
      textarea.focus();
    }

    function nextLocation(anchor) {
      state.renderLine += 1;
      return {
        anchor: String(anchor || "line[" + state.renderLine + "]"),
        line: state.renderLine
      };
    }

    function withLocationHash(location, snapshot) {
      return {
        ...location,
        hash: hashSnapshot(snapshot)
      };
    }

    function hashSnapshot(value) {
      const text = normalizeSnapshot(value);
      let hash = 2166136261;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    }

    function normalizeSnapshot(value) {
      return String(value ?? "").replace(/\r\n/g, "\n").trim();
    }

    function commentsForAnchor(anchor, snapshot) {
      const review = selectedReview();
      const subject = currentReviewSubject();
      if (!review || !subject) return [];
      return review.comments.filter(comment => {
        if (comment.memoryId !== subject.id) return false;
        const anchorMatches = comment.location?.anchor ? comment.location.anchor === anchor : comment.target === anchor;
        if (!anchorMatches) return false;
        if (!comment.location?.hash) return true;
        return comment.location.hash === hashSnapshot(snapshot);
      });
    }

    function renderInlineThread(anchor, snapshot) {
      const comments = commentsForAnchor(anchor, snapshot);
      if (!comments.length) return null;
      const thread = document.createElement("div");
      thread.className = "inline-thread";
      for (const comment of comments) {
        const item = document.createElement("div");
        item.className = "inline-thread-item";
        item.id = commentDomId(comment.id);
        const view = document.createElement("div");
        view.className = "inline-thread-view";
        const note = document.createElement("div");
        note.className = "inline-thread-note";
        note.textContent = comment.body;
        view.append(note);
        if (canComment()) {
          const actions = document.createElement("div");
          actions.className = "comment-actions";
          const edit = document.createElement("button");
          edit.type = "button";
          edit.className = "btn";
          edit.textContent = "Edit";
          edit.addEventListener("click", () => openCommentEditEditor(item, comment));
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "btn danger";
          remove.textContent = "Remove";
          remove.addEventListener("click", () => runButtonAction(remove, () => removeComment(comment.id)));
          actions.append(edit, remove);
          view.append(actions);
        }
        item.append(view);
        thread.append(item);
      }
      return thread;
    }

    function openCommentEditEditor(host, comment) {
      if (!canComment() || !host) return;
      closeInlineEditors();
      host.classList.add("editing");
      const editor = document.createElement("div");
      editor.className = "inline-comment-editor thread-edit-editor";
      const textarea = document.createElement("textarea");
      textarea.value = comment.body;
      const actions = document.createElement("div");
      actions.className = "comment-actions";
      const save = document.createElement("button");
      save.type = "button";
      save.className = "btn primary";
      save.textContent = "Save";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn";
      cancel.textContent = "Cancel";
      save.addEventListener("click", async () => {
        const body = textarea.value.trim();
        if (!body) {
          textarea.focus();
          return;
        }
        await updateComment(comment.id, body);
      });
      cancel.addEventListener("click", () => {
        host.classList.remove("editing");
        editor.remove();
      });
      actions.append(save, cancel);
      editor.append(textarea, actions);
      host.append(editor);
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }

    function domIdForAnchor(anchor) {
      return "anchor-" + slug(anchor);
    }

    function commentDomId(id) {
      return "comment-" + slug(id);
    }

    function slug(value) {
      return String(value || "anchor").trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "") || "anchor";
    }

    function closeInlineEditors() {
      for (const editor of document.querySelectorAll(".inline-comment-editor")) editor.remove();
      for (const item of document.querySelectorAll(".inline-thread-item.editing")) item.classList.remove("editing");
    }

    function hasOpenInlineEditor() {
      return Boolean(document.querySelector(".inline-comment-editor"));
    }

    function setAllSections(open) {
      for (const section of el.detail.querySelectorAll(".section")) section.classList.toggle("open", open);
    }

    async function createReview() {
      if (!canCreateReview()) return;
      const subject = currentReviewSubject();
      const title = subject
        ? (subject.source === "task" ? "Task review · " : "Memory review · ") + subject.name
        : undefined;
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          source: subject?.source || (state.viewMode === "task" ? "task" : "memory"),
          memoryId: subject?.source === "memory" ? subject.id : undefined,
          memoryName: subject?.source === "memory" ? subject.name : undefined,
          memoryPath: subject?.source === "memory" ? subject.path : undefined,
          runId: subject?.source === "task" ? subject.runId : undefined,
          runName: subject?.source === "task" ? subject.name : undefined
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const review = (await response.json()).review;
      state.reviews.unshift(review);
      state.selectedReviewId = review.id;
      saveSelectedReview();
      renderAll();
    }

    async function addComment(target, snapshot, body, location, context = {}) {
      const review = selectedReview();
      const subject = currentReviewSubject();
      if (!subject || !review || !canComment()) return;
      const comments = review.comments.concat({
        id: uuid(),
        source: subject.source,
        memoryId: subject.id,
        memoryName: subject.name,
        kind: subject.kind,
        runId: subject.source === "task" ? subject.runId : undefined,
        runName: subject.source === "task" ? subject.name : undefined,
        stepId: subject.source === "task" ? context.step?.id : undefined,
        artifactName: subject.source === "task" ? context.event?.artifact?.name || String(target || "").trim() : undefined,
        target: String(target || "").trim(),
        location,
        snapshot: snapshot === undefined ? undefined : String(snapshot),
        body,
        createdAt: new Date().toISOString()
      });
      await patchReview(review.id, { comments });
    }

    async function removeComment(id) {
      const review = selectedReview();
      if (!review || !canComment()) return;
      await patchReview(review.id, { comments: review.comments.filter(comment => comment.id !== id) });
    }

    async function deleteSelectedReview(id) {
      const review = state.reviews.find(item => item.id === id);
      if (!review) return;
      const label = review.title || review.id;
      if (!confirm("Delete review \"" + label + "\"? This will remove its comments and snapshots.")) return;
      const response = await fetch("/api/reviews/" + encodeURIComponent(id), { method: "DELETE" });
      if (!response.ok) throw new Error(await response.text());
      state.reviewSnapshots.delete(id + ":memory");
      state.reviewSnapshots.delete(id + ":task");
      await loadReviews();
      ensureSelectedReview();
      renderAll();
    }

    async function archiveSelectedRun(run) {
      if (!run || run.status !== "done") return;
      if (!confirm(t("archiveRunConfirm"))) return;
      const response = await fetch("/api/archive/runs/" + encodeURIComponent(run.id), { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      if (state.selectedTaskId === run.id) {
        state.selectedTaskId = null;
        saveSelectedTask();
      }
      await loadRuns();
      renderAll();
    }

    async function archiveReviewById(id) {
      const review = state.reviews.find(item => item.id === id);
      if (!review || review.status !== "done") return;
      if (!confirm(t("archiveReviewConfirm"))) return;
      const response = await fetch("/api/archive/reviews/" + encodeURIComponent(review.id), { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      state.reviewSnapshots.delete(review.id + ":memory");
      state.reviewSnapshots.delete(review.id + ":task");
      if (state.selectedReviewId === review.id) {
        state.selectedReviewId = null;
        saveSelectedReview();
      }
      await loadReviews();
      renderAll();
    }

    async function updateComment(id, body) {
      const review = selectedReview();
      if (!review || !canComment()) return;
      await patchReview(review.id, {
        comments: review.comments.map(comment => comment.id === id ? { ...comment, body } : comment)
      });
    }

    async function submitReview() {
      const review = selectedReview();
      if (!review || review.status !== "draft" || !review.comments.length) return;
      await patchReview(review.id, { status: "submitted" });
    }

    async function patchReview(id, patch) {
      const response = await fetch("/api/reviews/" + encodeURIComponent(id), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (!response.ok) throw new Error(await response.text());
      await response.json();
      await loadReviews();
      renderAll();
    }

    async function runButtonAction(button, action) {
      button.disabled = true;
      try {
        await action();
      } catch (error) {
        alert(error instanceof Error ? error.message : String(error));
        button.disabled = false;
      }
    }

    function renderReview() {
      const review = selectedReview();
      const canCreate = canCreateReview();
      el.createReview.disabled = !canCreate;
      el.createReview.title = canCreate || state.viewMode !== "task"
        ? "Create Review"
        : "Only done tasks can create a review";
      renderReviewList();
      el.reviewLabel.textContent = review
        ? review.status + " · " + review.comments.length + " comment(s)"
        : "Create or select a review to comment inline";
      const comments = review?.comments || [];
      el.commentSummary.textContent = review
        ? review.id
        : "No review selected";
      el.submitReview.disabled = !review || review.status !== "draft" || comments.length === 0;
      el.submitReview.textContent = review?.status === "draft" ? "Submit" : review?.status || "Submit";
      el.comments.innerHTML = "";
      if (!review) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "Create a review, then use + beside the content to add comments.";
        el.comments.append(empty);
        return;
      }
      if (!comments.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = canComment()
          ? "Use + beside a section, line, field, or step to add comments."
          : "No comments in this review.";
        el.comments.append(empty);
        return;
      }
      for (const comment of comments) {
        const card = document.createElement("article");
        card.className = "comment-card";
        const title = document.createElement("b");
        title.textContent = commentTitle(comment);
        const meta = document.createElement("div");
        meta.className = "muted";
        meta.textContent = commentMetaText(comment);
        if (isCommentOutdated(comment)) meta.append(" ", pill("outdated", false, "outdated"));
        const body = document.createElement("p");
        body.textContent = comment.body;
        const actions = document.createElement("div");
        actions.className = "comment-actions";
        const open = document.createElement("button");
        open.className = "btn";
        open.textContent = "Open";
        open.addEventListener("click", () => {
          selectCommentSubject(comment);
          renderAll();
          setTimeout(() => scrollToComment(comment), 0);
        });
        actions.append(open);
        if (canComment()) {
          const edit = document.createElement("button");
          edit.className = "btn";
          edit.textContent = "Edit";
          edit.addEventListener("click", () => editCommentInDocument(comment));
          const remove = document.createElement("button");
          remove.className = "btn danger";
          remove.textContent = "Remove";
          remove.addEventListener("click", () => runButtonAction(remove, () => removeComment(comment.id)));
          actions.append(edit, remove);
        }
        card.append(title, meta, body, actions);
        el.comments.append(card);
      }
    }

    function scrollToComment(comment) {
      if (isCommentOutdated(comment)) return;
      const anchor = comment.location?.anchor || comment.target || "";
      const target = document.getElementById(domIdForAnchor(anchor)) || document.querySelector('[data-anchor="' + CSS.escape(anchor) + '"]');
      if (target) {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }

    function editCommentInDocument(comment) {
      selectCommentSubject(comment);
      renderAll();
      setTimeout(() => {
        if (isCommentOutdated(comment)) return;
        scrollToComment(comment);
        const item = document.getElementById(commentDomId(comment.id));
        if (item) openCommentEditEditor(item, comment);
      }, 0);
    }

    function commentMetaText(comment) {
      if (isCommentOutdated(comment)) return "";
      const base = comment.source === "task" ? "Task" : "Memory";
      return base + (comment.location?.line ? " · Line " + comment.location.line : " · Unanchored");
    }

    function isCommentOutdated(comment) {
      if (!comment.location?.hash) return false;
      const subject = currentReviewSubject();
      if (!subject || subject.id !== comment.memoryId) return false;
      const node = document.querySelector('[data-anchor="' + CSS.escape(comment.location.anchor) + '"] .commentable-body');
      if (!node) return true;
      return hashSnapshot(node.textContent || "") !== comment.location.hash;
    }

    function commentTitle(comment) {
      const prefix = comment.source === "task" ? "Task" : "Memory";
      const target = comment.artifactName || comment.target;
      return prefix + " · " + comment.memoryName + (target ? " · " + target : "");
    }

    function selectCommentSubject(comment) {
      if (comment.source === "task" || comment.kind === "tasks") {
        state.viewMode = "task";
        localStorage.setItem(viewModeKey, "task");
        const runId = comment.runId || String(comment.memoryId || "").replace(/^task\//, "");
        if (runId) {
          state.selectedTaskId = runId;
          saveSelectedTask();
        }
        return;
      }
      state.viewMode = "memory";
      localStorage.setItem(viewModeKey, "memory");
      state.selectedId = comment.memoryId;
    }

    function renderReviewList() {
      el.reviews.innerHTML = "";
      const reviews = filteredReviews();
      if (!reviews.length) return;
      for (const review of reviews) {
        const card = document.createElement("article");
        card.className = "review-card review-card-row" + (review.id === state.selectedReviewId ? " active" : "");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "review-card-main";
        const title = document.createElement("b");
        title.textContent = review.title || review.id;
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.style.margin = "0";
        meta.append(pill(review.status, false, statusPillClass(review.status)));
        meta.append(pill(review.comments.length + " comments"));
        button.append(title, meta);
        button.addEventListener("click", () => {
          state.selectedReviewId = state.selectedReviewId === review.id ? null : review.id;
          saveSelectedReview();
          renderAll();
        });
        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn danger review-delete";
        del.textContent = "Delete";
        del.addEventListener("click", () => runButtonAction(del, () => deleteSelectedReview(review.id)));
        const archive = document.createElement("button");
        archive.type = "button";
        archive.className = "btn review-archive";
        archive.textContent = t("archive");
        archive.disabled = review.status !== "done";
        archive.title = review.status === "done" ? t("archiveReviewConfirm") : t("archiveDoneOnly");
        archive.addEventListener("click", () => runButtonAction(archive, () => archiveReviewById(review.id)));
        const actions = document.createElement("div");
        actions.className = "review-card-actions";
        actions.append(del, archive);
        card.append(button, actions);
        el.reviews.append(card);
      }
    }

    function statusPillClass(status) {
      if (status === "done") return "done";
      if (status === "running") return "processing";
      if (status === "processing") return "processing";
      if (status === "draft") return "warn";
      return "";
    }

    function saveSelectedTask() {
      if (state.selectedTaskId) localStorage.setItem(selectedTaskKey, state.selectedTaskId);
      else localStorage.removeItem(selectedTaskKey);
    }

    function saveSelectedReview() {
      if (state.selectedReviewId) localStorage.setItem(selectedReviewKey, state.selectedReviewId);
      else localStorage.removeItem(selectedReviewKey);
    }

    function uuid() {
      if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
      return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }
  </script>
</body>
</html>`;
