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
      --review-width: 380px;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    button, input, textarea { font: inherit; }
    button { cursor: pointer; }
    .shell { display: grid; grid-template-columns: 300px minmax(0, 1fr) 0 0; min-height: 100vh; transition: grid-template-columns 160ms ease; }
    body.review-resizing, body.review-resizing * { cursor: col-resize !important; user-select: none !important; }
    body.review-resizing .shell { transition: none; }
    .sidebar { background: #fbfbf8; border-color: var(--line); overflow: auto; height: 100vh; position: sticky; top: 0; }
    .sidebar { border-right: 1px solid var(--line); padding: 16px; }
    .review { min-width: 0; overflow: hidden; visibility: hidden; pointer-events: none; background: #fbfbf8; border-left: 0; padding: 0; }
    .review-resizer { display: none; position: relative; min-width: 8px; background: #fbfbf8; cursor: col-resize; touch-action: none; outline: none; }
    .review-resizer::before { content: ""; position: absolute; top: 0; bottom: 0; left: 3px; width: 1px; background: var(--line); transition: background 120ms ease, width 120ms ease; }
    .review-resizer:hover::before, .review-resizer:focus-visible::before, body.review-resizing .review-resizer::before { width: 2px; background: var(--accent); }
    .brand, .review-head, .toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .review-actions { display: flex; gap: 8px; align-items: flex-start; }
    .review-toggle, .review-close { display: inline-flex; }
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
    .memory-options { border-top: 1px solid var(--line); margin-top: 16px; padding-top: 12px; }
    .memory-option { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; }
    .memory-option input { width: 15px; height: 15px; accent-color: var(--accent); }
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
    .section-header { width: 100%; border: 0; background: transparent; text-align: left; display: grid; grid-template-columns: 22px 24px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 12px 14px; color: var(--text); }
    .section-header:hover { background: #f4f5f1; }
    .chevron { color: var(--muted); transition: transform 120ms ease; }
    .section.open > .section-header .chevron { transform: rotate(90deg); }
    .node-title { overflow-wrap: anywhere; font-weight: 700; }
    .node-badges { display: flex; gap: 6px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
    .section-body { display: none; border-top: 1px solid var(--line); padding: 12px 14px 14px; }
    .section.open > .section-body { display: block; }
    .block-title { margin: 12px 0 6px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; font-weight: 700; }
    .text-list { margin: 0; padding-left: 18px; }
    .text-list li { margin: 5px 0; white-space: pre-wrap; }
    .commentable { position: relative; display: block; margin: 4px 0; width: 100%; }
    .review-active .commentable { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 7px; align-items: flex-start; }
    .commentable-body { min-width: 0; max-width: 100%; white-space: pre-wrap; overflow-wrap: anywhere; }
    .inline-plus, .target-add { border: 1px solid var(--line); border-radius: 999px; background: #fff; color: var(--muted); padding: 0; }
    .inline-plus { width: 20px; height: 20px; line-height: 16px; opacity: 0; transition: opacity 120ms ease, border-color 120ms ease, color 120ms ease; }
    .target-add { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; line-height: 1; opacity: 0; transition: opacity 120ms ease, border-color 120ms ease, color 120ms ease; }
    .review-active .commentable:hover .inline-plus, .review-active .field-table th:hover .inline-plus, .review-active .inline-plus:focus, .review-active .section-header:hover .target-add, .review-active .schema-field-content:hover .target-add, .review-active .target-add:focus { opacity: 1; }
    .inline-plus:hover, .target-add:hover { border-color: var(--accent); color: var(--accent); }
    body:not(.review-active) .target-add, body:not(.review-active) .inline-plus { display: none; }
    body:not(.review-active) .section-header { grid-template-columns: 22px minmax(0, 1fr) auto; }
    body:not(.review-active) .schema-field-content { grid-template-columns: minmax(0, 1fr) auto; }
    .inline-comment-editor { grid-column: 2; border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 10px; box-shadow: var(--shadow); margin-top: 8px; width: 100%; }
    .inline-comment-editor textarea { margin-bottom: 8px; }
    .thread-edit-editor { grid-column: auto; margin: 2px 0 0; }
    .child-stack { margin-top: 12px; }
    .definition-list > li { margin: 10px 0; }
    .definition-list > li > .section { min-width: 0; margin: 0; }
    .schema-node > .section-header .node-title { font-weight: 400; }
    .schema-field-list { margin-top: 0; }
    .schema-field-content { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 8px; }
    .schema-field-plain .node-title { font-weight: 400; }
    .schema-field-type { color: var(--muted); font-size: 13px; }
    .memory-ref-link { display: inline-flex; align-items: center; width: fit-content; max-width: 100%; border: 0; background: transparent; color: var(--accent); padding: 0; font: inherit; font-weight: 700; text-align: left; overflow-wrap: anywhere; text-decoration: underline; text-underline-offset: 3px; }
    .memory-ref-link:hover { color: #173f3c; }
    .memory-ref-link.missing { color: var(--muted); text-decoration-style: dotted; }
    .field-table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
    .field-table th, .field-table td { border-bottom: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; white-space: pre-wrap; }
    .field-table th { width: 220px; background: #f3f5f0; font-weight: 700; }
    .flow-item { min-width: 0; border: 1px solid var(--line); border-left: 4px solid #a7b0a5; background: var(--surface); border-radius: 8px; padding: 10px 14px; box-shadow: var(--shadow); white-space: normal; }
    .flow, .task-summary, .section-body, .task-result { min-width: 0; }
    .flow > *, .task-summary > *, .section-body > *, .task-result > * { min-width: 0; }
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
    .artifact-row { display: grid; gap: 6px; align-items: start; justify-items: start; justify-content: start; min-width: 260px; color: var(--muted); }
    .artifact-meta-line { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: flex-start; min-width: 0; }
    .artifact-label { color: var(--muted); font-size: 12px; font-weight: 700; }
    .call-link { color: var(--accent); text-decoration: none; font-weight: 700; }
    .call-link:hover { text-decoration: underline; }
    .task-summary { display: grid; gap: 12px; }
    .task-step { border-left: 4px solid var(--accent); }
    .task-step-spotlight { animation: taskStepSpotlight 1600ms ease-out; box-shadow: 0 0 0 3px rgba(40, 108, 103, .18), var(--shadow); }
    .task-result { margin-top: 8px; }
    .task-result .pre { margin-top: 6px; }
    .pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f3f5f0; border: 1px solid var(--line); border-radius: 6px; padding: 10px; margin: 8px 0 0; }
    .markdown-body { min-width: 0; max-width: 100%; white-space: normal; overflow-wrap: anywhere; background: #f3f5f0; border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; margin: 8px 0 0; line-height: 1.55; }
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
    .markdown-table-scroll { width: 100%; min-width: 0; max-width: 100%; overflow-x: auto; contain: inline-size; margin: 8px 0; }
    .markdown-body table { width: max-content; min-width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--line); }
    .markdown-body th, .markdown-body td { border: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; white-space: nowrap; }
    .markdown-body th { background: #f3f5f0; font-weight: 700; }
    .markdown-body img { max-width: 100%; height: auto; }
    .markdown-body hr { border: 0; border-top: 1px solid var(--line); margin: 10px 0; }
    .action-contracts { display: grid; gap: 6px; margin-top: 8px; }
    .action-contracts ul { margin: 0; padding-left: 20px; }
    .inline-schema-toggle { border: 1px solid var(--line); cursor: pointer; font-family: inherit; font-size: 12px; font-weight: inherit; }
    .inline-schema-toggle:hover, .inline-schema-toggle:focus-visible { border-color: var(--accent); color: var(--accent); }
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
    .artifact-review-stack { display: grid; gap: 10px; }
    .artifact-review-grid { display: grid; gap: 8px; }
    .artifact-review-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line); }
    .artifact-review-row:last-child { border-bottom: 0; }
    .artifact-review-row-main { min-width: 0; display: grid; gap: 3px; }
    .artifact-review-controls { display: grid; gap: 8px; }
    .artifact-review-select { width: 100%; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); padding: 8px 9px; }
    .artifact-review-round-select { position: relative; min-width: 0; }
    .artifact-review-select-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; cursor: pointer; }
    .artifact-review-select-trigger[aria-expanded="true"] { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
    .artifact-review-select-caret { color: var(--muted); font-size: 13px; line-height: 1; }
    .artifact-review-select-menu { position: absolute; top: calc(100% + 4px); right: 0; left: 0; z-index: 30; display: grid; gap: 2px; max-height: 240px; overflow-y: auto; padding: 4px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); box-shadow: 0 10px 28px rgba(25, 30, 35, .16); }
    .artifact-review-select-menu[hidden] { display: none; }
    .artifact-review-select-option { width: 100%; border: 0; border-radius: 4px; background: transparent; color: var(--text); padding: 7px 8px; text-align: left; cursor: pointer; }
    .artifact-review-select-option:hover, .artifact-review-select-option:focus-visible { outline: 0; background: var(--soft); }
    .artifact-review-select-option[aria-selected="true"] { background: var(--accent-soft); color: #173f3c; }
    .artifact-review-vote { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
    .artifact-review-vote .btn { min-width: 0; padding: 7px 5px; }
    .artifact-review-vote .btn.active { background: var(--accent-soft); border-color: var(--accent); color: #173f3c; font-weight: 700; }
    .artifact-review-message { border-left: 3px solid var(--accent); background: #f2f8f6; padding: 8px 10px; color: #315653; }
    .artifact-review-message.warn { border-left-color: var(--warn); background: #fbf7f0; color: #71471f; }
    .artifact-review-comment { display: grid; gap: 6px; }
    .artifact-review-candidate { border-left-color: var(--accent); }
    .artifact-review-candidate .section-body { display: block; }
    .artifact-review-progress { font-variant-numeric: tabular-nums; }
    .artifact-review-agent-status { display: grid; gap: 8px; }
    .artifact-review-agent-status .btn { justify-self: start; }
    .artifact-review-id { overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
    dialog.artifact-review-dialog { width: min(460px, calc(100vw - 32px)); border: 1px solid var(--line); border-radius: 8px; padding: 0; color: var(--text); box-shadow: 0 20px 60px rgba(25, 30, 35, .24); }
    dialog.artifact-review-dialog::backdrop { background: rgba(22, 28, 30, .34); }
    .artifact-review-dialog-body { padding: 18px; display: grid; gap: 12px; }
    .artifact-review-dialog-body h3 { margin: 0; font-size: 18px; }
    .artifact-review-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
    code { background: var(--soft); border-radius: 4px; padding: 1px 4px; }
    body.task-mode .search, body.task-mode #expand, body.task-mode #collapse { display: none; }
    body.review-drawer-open .shell { grid-template-columns: 300px minmax(0, 1fr) 8px var(--review-width); }
    body.review-drawer-open .review-resizer { display: block; }
    body.review-drawer-open .review { overflow: auto; visibility: visible; pointer-events: auto; padding: 16px; }
    @keyframes taskStepSpotlight {
      0% { box-shadow: 0 0 0 5px rgba(40, 108, 103, .24), var(--shadow); }
      100% { box-shadow: var(--shadow); }
    }
    @media (max-width: 1400px) {
      .shell { grid-template-columns: 280px minmax(0, 1fr) 0 0; }
      body.task-mode .shell { grid-template-columns: 280px minmax(0, 1fr) 0 0; }
      body.review-drawer-open .shell { grid-template-columns: 280px minmax(0, 1fr) 8px var(--review-width); }
    }
    @media (max-width: 1100px) {
      .flow-head { grid-template-columns: 1fr; gap: 8px; align-items: flex-start; }
      .artifact-row { justify-content: flex-start; min-width: 0; }
    }
    @media (max-width: 760px) {
      .shell, body.review-drawer-open .shell { grid-template-columns: 1fr; }
      .sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
      .review-resizer, body.review-drawer-open .review-resizer { display: none; }
      .review { grid-column: 1; }
      .content { padding: 18px 16px 36px; }
      .toolbar { flex-direction: column; }
      body.review-drawer-open .sidebar, body.review-drawer-open .content { display: none; }
      body.review-drawer-open .review { min-height: 100vh; border-left: 0; }
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
          <button class="btn review-toggle" id="review-toggle" type="button" aria-controls="review-panel" aria-expanded="false">Review</button>
          <button class="btn" id="refresh">Refresh</button>
        </div>
      </div>
      <div id="detail" class="empty">Loading...</div>
    </section>

    <div class="review-resizer" id="review-resizer" role="separator" aria-controls="review-panel" aria-orientation="vertical" aria-valuemin="300" aria-valuenow="380" tabindex="-1"></div>

    <aside class="review" id="review-panel" aria-labelledby="review-heading">
      <div class="review-head">
        <div>
          <h2 id="review-heading">Review</h2>
          <div class="review-sub" id="review-label">Create or select a review to comment inline</div>
        </div>
        <div class="review-actions">
          <button class="btn primary" id="create-review">Create Review</button>
          <button class="btn review-close" id="review-close" type="button">Close</button>
        </div>
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
    const hideSystemMemoriesKey = "memsphere.hideSystemMemories.v1";
    const artifactReviewIdentityKey = "memsphere.artifactReviewIdentity.v1";
    const artifactReviewOpenedKey = "memsphere.artifactReviewOpened.v1";
    const reviewPanelWidthKey = "memsphere.reviewPanelWidth.v1";
    const displayLanguage = localStorage.getItem(displayLanguageKey) === "yaml" ? "yaml" : "zh";
    const vocabulary = {
      procedures: { zh: "流程", yaml: "procedures" },
      schemas: { zh: "图式", yaml: "schemas" },
      concepts: { zh: "概念", yaml: "concepts" },
      statements: { zh: "命题", yaml: "statements" },
      syntax: { zh: "语法版本", yaml: "syntax" },
      names: { zh: "名称", yaml: "names" },
      defines: { zh: "定义", yaml: "defines" },
      asserts: { zh: "断言", yaml: "asserts" },
      procedureAsserts: { zh: "流程断言", yaml: "Procedure Asserts" },
      suggests: { zh: "建议", yaml: "suggests" },
      sections: { zh: "章节", yaml: "sections" },
      goals: { zh: "目标", yaml: "goals" },
      flow: { zh: "流程", yaml: "flow" },
      step: { zh: "步骤", yaml: "action" },
      if: { zh: "条件判断", yaml: "!if" },
      elseif: { zh: "否则如果", yaml: "elseif" },
      else: { zh: "否则", yaml: "else" },
      while: { zh: "循环判断", yaml: "!while" },
      call: { zh: "调用流程", yaml: "!call" },
      repeat: { zh: "重复字段组", yaml: "!repeat" },
      actor: { zh: "执行者", yaml: "actor" },
      agent: { zh: "Agent", yaml: "agent" },
      human: { zh: "人", yaml: "human" },
      artifact: { zh: "产物", yaml: "artifact" },
      schema: { zh: "图式", yaml: "schema" },
      inlineSchema: { zh: "内嵌图式", yaml: "inline schema" },
      type: { zh: "类型", yaml: "type" },
      fields: { zh: "字段", yaml: "fields" },
      item: { zh: "元素", yaml: "item" },
      items: { zh: "候选元素", yaml: "items" },
      itemCandidate: { zh: "候选元素", yaml: "item candidate" },
      final: { zh: "最终交付物", yaml: "final" },
      finalArtifacts: { zh: "最终交付物", yaml: "final artifacts" },
      layout: { zh: "布局", yaml: "layout" },
      statement: { zh: "命题", yaml: "statement" },
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
      hideSystemMemories: { zh: "隐藏系统记忆", yaml: "Hide system memory" },
      format: { zh: "格式", yaml: "format" },
      boolean: { zh: "判断结果", yaml: "boolean" },
      string: { zh: "短文本", yaml: "string" },
      number: { zh: "数字", yaml: "number" },
      markdown: { zh: "文档", yaml: "markdown" },
      json: { zh: "JSON", yaml: "json" },
      yaml: { zh: "YAML", yaml: "yaml" },
      legacyReadOnly: { zh: "旧版只读", yaml: "v1 read-only" },
      validated: { zh: "校验通过", yaml: "validated" },
      artifactReview: { zh: "产物评审", yaml: "Artifact Review" },
      reviewers: { zh: "评审", yaml: "Review" },
      pendingReview: { zh: "待评审", yaml: "Pending review" },
      reviewedArtifact: { zh: "待评审产物", yaml: "Artifact under review" },
      identity: { zh: "评审身份", yaml: "Review identity" },
      decisionVote: { zh: "决策票", yaml: "Decision vote" },
      advisoryVote: { zh: "建议票", yaml: "Advisory vote" },
      approve: { zh: "通过", yaml: "Approve" },
      requestChanges: { zh: "修改", yaml: "Request changes" },
      abstain: { zh: "弃权", yaml: "Abstain" },
      submitArtifactReview: { zh: "提交评审", yaml: "Submit review" },
      participants: { zh: "参与进度", yaml: "Participation" },
      roundSummary: { zh: "本轮汇总", yaml: "Round summary" },
      myDraft: { zh: "我的草稿", yaml: "My draft" },
      submittedOpinions: { zh: "已提交意见", yaml: "Submitted opinions" },
      automatic: { zh: "自动", yaml: "Automatic" },
      round: { zh: "轮次", yaml: "Round" },
      revisionSummary: { zh: "修改摘要", yaml: "Revision summary" },
      selectIdentity: { zh: "请选择评审身份", yaml: "Select a review identity" },
      resizeReview: { zh: "调整产物与评审区域宽度", yaml: "Resize artifact and review panels" },
      resetReviewWidth: { zh: "双击恢复默认宽度", yaml: "Double-click to reset width" },
      submitted: { zh: "已提交", yaml: "Submitted" },
      draft: { zh: "草稿", yaml: "Draft" },
      passed: { zh: "已通过", yaml: "Passed" },
      changesRequested: { zh: "需修改", yaml: "Changes requested" },
      awaitingRunnerVote: { zh: "等待 Runner 投票", yaml: "Awaiting Runner vote" },
      pendingVote: { zh: "待投票", yaml: "Pending vote" },
      agentReviewer: { zh: "Agent 评审", yaml: "Agent reviewer" },
      queued: { zh: "等待启动", yaml: "Queued" },
      running: { zh: "评审中", yaml: "Running" },
      failed: { zh: "执行失败", yaml: "Failed" },
      retry: { zh: "重试", yaml: "Retry" },
      attempt: { zh: "尝试", yaml: "Attempt" }
    };
    const state = {
      viewMode: localStorage.getItem(viewModeKey) === "task" ? "task" : "memory",
      payload: null,
      memories: [],
      roleNames: {},
      systemMemoryPaths: new Set(),
      reservedMemories: [],
      filtered: [],
      hideSystemMemories: localStorage.getItem(hideSystemMemoriesKey) !== "false",
      selectedId: null,
      selectedTaskId: localStorage.getItem(selectedTaskKey) || null,
      selectedReviewId: localStorage.getItem(selectedReviewKey) || null,
      byName: new Map(),
      reviews: [],
      runs: [],
      artifactReviewContext: null,
      artifactReviewLoading: false,
      artifactReviewSaving: false,
      artifactReviewRequest: 0,
      artifactReviewConflict: "",
      taskPollingRenderPending: false,
      artifactReviewHistoryRoundId: null,
      artifactReviewIdentityByReview: readStoredObject(artifactReviewIdentityKey),
      artifactReviewOpenedRounds: readStoredObject(artifactReviewOpenedKey),
      reviewSnapshots: new Map(),
      loadingSnapshots: new Set(),
      reviewDrawerOpen: false,
      reviewPanelWidth: Number.parseFloat(localStorage.getItem(reviewPanelWidthKey) || "") || 380,
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
      reviewHeading: document.getElementById("review-heading"),
      reviewLabel: document.getElementById("review-label"),
      createReview: document.getElementById("create-review"),
      reviewPanel: document.getElementById("review-panel"),
      reviewResizer: document.getElementById("review-resizer"),
      shell: document.querySelector(".shell"),
      sidebar: document.querySelector(".sidebar"),
      reviewToggle: document.getElementById("review-toggle"),
      reviewClose: document.getElementById("review-close"),
      memoryTab: document.getElementById("memory-tab"),
      taskTab: document.getElementById("task-tab")
    };

    document.getElementById("expand").addEventListener("click", () => setAllSections(true));
    document.getElementById("collapse").addEventListener("click", () => setAllSections(false));
    document.getElementById("refresh").addEventListener("click", () => loadAll().catch(renderFatalError));
    el.createReview.addEventListener("click", () => runButtonAction(el.createReview, createReview));
    el.reviewToggle.addEventListener("click", () => setReviewDrawer(!state.reviewDrawerOpen));
    el.reviewClose.addEventListener("click", () => setReviewDrawer(false));
    el.reviewResizer.addEventListener("pointerdown", beginReviewResize);
    el.reviewResizer.addEventListener("keydown", resizeReviewWithKeyboard);
    el.reviewResizer.addEventListener("dblclick", () => setReviewPanelWidth(380, true));
    el.reviewResizer.setAttribute("aria-label", t("resizeReview"));
    el.reviewResizer.title = t("resizeReview") + " · " + t("resetReviewWidth");
    el.memoryTab.addEventListener("click", () => setViewMode("memory"));
    el.taskTab.addEventListener("click", () => setViewMode("task"));
    el.submitReview.addEventListener("click", () => runButtonAction(el.submitReview, submitReview));
    el.search.addEventListener("input", () => {
      applyFilter();
      renderNav();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.reviewDrawerOpen) setReviewDrawer(false);
    });
    document.addEventListener("focusout", () => {
      setTimeout(() => {
        if (!state.taskPollingRenderPending || hasActiveTaskInteraction()) return;
        state.taskPollingRenderPending = false;
        renderAll();
      }, 0);
    });
    window.addEventListener("resize", () => syncReviewDrawer());

    loadAll().catch(renderFatalError);
    setInterval(() => {
      if (state.viewMode === "task" && !hasActiveTaskInteraction()) {
        loadRuns().then(() => {
          if (hasActiveTaskInteraction()) {
            state.taskPollingRenderPending = true;
            return;
          }
          state.taskPollingRenderPending = false;
          renderAll();
        }).catch(console.error);
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
      state.roleNames = state.payload.roleNames || {};
      state.systemMemoryPaths = new Set(state.payload.systemMemoryPaths || []);
      state.byName = new Map();
      for (const memory of state.memories) {
        if (!memory.entity) continue;
        for (const name of memory.entity.names || []) state.byName.set(name, memory);
      }
      applyFilter();
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
      await syncArtifactReviewContext();
    }

    async function syncArtifactReviewContext(force = false) {
      if (state.viewMode !== "task") return;
      const run = state.runs.find(item => item.id === state.selectedTaskId) || state.runs[0] || null;
      const review = run?.artifactReview;
      if (!review?.round) {
        state.artifactReviewContext = null;
        state.artifactReviewConflict = "";
        return;
      }
      const assignments = review.round.assignments || [];
      let identityId = state.artifactReviewIdentityByReview[review.id] || "";
      if (!assignments.some(assignment => assignment.identityId === identityId)) {
        identityId = assignments.length === 1 ? assignments[0].identityId : "";
      }
      if (identityId) {
        state.artifactReviewIdentityByReview[review.id] = identityId;
        writeStoredObject(artifactReviewIdentityKey, state.artifactReviewIdentityByReview);
      }
      if (identityId && (force || !hasOpenInlineEditor())) {
        await loadArtifactReviewContext(review.id, review.currentRoundId, identityId);
      } else if (!identityId) {
        state.artifactReviewContext = null;
      }
      if (!state.artifactReviewOpenedRounds[review.currentRoundId]) {
        state.reviewDrawerOpen = true;
        state.artifactReviewOpenedRounds[review.currentRoundId] = true;
        writeStoredObject(artifactReviewOpenedKey, state.artifactReviewOpenedRounds);
      }
    }

    async function loadArtifactReviewContext(reviewId, roundId, identityId) {
      const requestId = ++state.artifactReviewRequest;
      state.artifactReviewLoading = true;
      try {
        const response = await fetch(
          "/api/artifact-reviews/" + encodeURIComponent(reviewId)
          + "/rounds/" + encodeURIComponent(roundId)
          + "?identity_id=" + encodeURIComponent(identityId)
        );
        if (!response.ok) throw new Error(await response.text());
        const context = await response.json();
        if (requestId !== state.artifactReviewRequest) return;
        const previousRoundId = state.artifactReviewContext?.review?.currentRoundId;
        if (previousRoundId && previousRoundId !== context.review?.currentRoundId) {
          state.artifactReviewHistoryRoundId = null;
        }
        state.artifactReviewContext = context;
        state.artifactReviewConflict = "";
      } finally {
        if (requestId === state.artifactReviewRequest) state.artifactReviewLoading = false;
      }
    }

    function renderAll() {
      document.body.classList.toggle("task-mode", state.viewMode === "task");
      document.body.classList.toggle("review-active", canComment());
      const artifactReview = activeArtifactReviewSummary();
      el.reviewToggle.textContent = artifactReview?.round
        ? t("artifactReview") + " " + artifactReview.round.submitted + "/" + artifactReview.round.total
        : "Review";
      syncReviewDrawer();
      el.memoryTab.classList.toggle("active", state.viewMode === "memory");
      el.taskTab.classList.toggle("active", state.viewMode === "task");
      if (state.viewMode === "task") {
        renderTaskNav();
        renderSelectedTask();
        renderReview();
        return;
      }
      updateMemoryCount();
      renderNav();
      renderSelected();
      renderReview();
    }

    async function setViewMode(mode) {
      state.viewMode = mode;
      localStorage.setItem(viewModeKey, mode);
      ensureSelectedReview();
      renderAll();
      if (mode === "task") {
        await syncArtifactReviewContext();
        renderAll();
      }
    }

    function syncReviewDrawer() {
      const open = state.reviewDrawerOpen;
      const resizable = open && window.innerWidth > 760;
      document.body.classList.toggle("review-drawer-open", open);
      el.reviewToggle.setAttribute("aria-expanded", String(open));
      el.reviewPanel.setAttribute("aria-hidden", String(!open));
      el.reviewResizer.tabIndex = resizable ? 0 : -1;
      el.reviewResizer.setAttribute("aria-hidden", String(!resizable));
      applyReviewPanelWidth(state.reviewPanelWidth);
    }

    function reviewPanelWidthBounds() {
      const shellWidth = el.shell.getBoundingClientRect().width || window.innerWidth;
      const sidebarWidth = window.innerWidth > 760 ? el.sidebar.getBoundingClientRect().width : 0;
      const min = 300;
      const max = Math.max(min, Math.floor(shellWidth - sidebarWidth - 360 - 8));
      return { min, max };
    }

    function applyReviewPanelWidth(width) {
      const bounds = reviewPanelWidthBounds();
      const numericWidth = Number.isFinite(width) ? width : 380;
      const clamped = Math.round(Math.min(bounds.max, Math.max(bounds.min, numericWidth)));
      document.documentElement.style.setProperty("--review-width", clamped + "px");
      el.reviewResizer.setAttribute("aria-valuemin", String(bounds.min));
      el.reviewResizer.setAttribute("aria-valuemax", String(bounds.max));
      el.reviewResizer.setAttribute("aria-valuenow", String(clamped));
      el.reviewResizer.setAttribute("aria-valuetext", clamped + "px");
      return clamped;
    }

    function setReviewPanelWidth(width, persist) {
      const clamped = applyReviewPanelWidth(width);
      state.reviewPanelWidth = clamped;
      if (persist) localStorage.setItem(reviewPanelWidthKey, String(clamped));
    }

    function beginReviewResize(event) {
      if (!state.reviewDrawerOpen || window.innerWidth <= 760 || event.button !== 0) return;
      event.preventDefault();
      const pointerId = event.pointerId;
      const shellRight = el.shell.getBoundingClientRect().right;
      document.body.classList.add("review-resizing");
      el.reviewResizer.setPointerCapture(pointerId);
      const move = moveEvent => {
        setReviewPanelWidth(shellRight - moveEvent.clientX - 4, false);
      };
      const finish = finishEvent => {
        if (el.reviewResizer.hasPointerCapture(pointerId)) el.reviewResizer.releasePointerCapture(pointerId);
        el.reviewResizer.removeEventListener("pointermove", move);
        el.reviewResizer.removeEventListener("pointerup", finish);
        el.reviewResizer.removeEventListener("pointercancel", finish);
        document.body.classList.remove("review-resizing");
        setReviewPanelWidth(state.reviewPanelWidth, true);
      };
      el.reviewResizer.addEventListener("pointermove", move);
      el.reviewResizer.addEventListener("pointerup", finish);
      el.reviewResizer.addEventListener("pointercancel", finish);
      move(event);
    }

    function resizeReviewWithKeyboard(event) {
      const bounds = reviewPanelWidthBounds();
      const step = event.shiftKey ? 64 : 24;
      let width = Number(el.reviewResizer.getAttribute("aria-valuenow")) || state.reviewPanelWidth;
      if (event.key === "ArrowLeft") width += step;
      else if (event.key === "ArrowRight") width -= step;
      else if (event.key === "Home") width = bounds.min;
      else if (event.key === "End") width = bounds.max;
      else return;
      event.preventDefault();
      setReviewPanelWidth(width, true);
    }

    function setReviewDrawer(open) {
      state.reviewDrawerOpen = Boolean(open);
      syncReviewDrawer();
      if (state.reviewDrawerOpen) requestAnimationFrame(() => el.reviewClose.focus());
      else el.reviewToggle.focus();
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
        if (state.hideSystemMemories && isSystemMemory(memory)) return false;
        if (!q) return true;
        return [memory.kind, memory.path, errorText(memory.error), ...(memory.entity?.names || [])].join(" ").toLowerCase().includes(q);
      });
      updateMemoryCount();
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
      renderSystemMemoryToggle();
    }

    function renderSystemMemoryToggle() {
      const options = document.createElement("div");
      options.className = "memory-options";
      const label = document.createElement("label");
      label.className = "memory-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.hideSystemMemories;
      checkbox.addEventListener("change", () => {
        state.hideSystemMemories = checkbox.checked;
        localStorage.setItem(hideSystemMemoriesKey, String(state.hideSystemMemories));
        applyFilter();
        renderAll();
      });
      const text = document.createElement("span");
      text.textContent = t("hideSystemMemories");
      label.append(checkbox, text);
      options.append(label);
      el.nav.append(options);
    }

    function isSystemMemory(memory) {
      return memory?.source !== "reserved" && state.systemMemoryPaths.has(memory.path);
    }

    function updateMemoryCount() {
      el.count.textContent = state.filtered.length + " memories";
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
          if (run.artifactReview?.round) {
            meta.append(
              " · ",
              t("pendingReview") + " " + run.artifactReview.round.submitted + "/" + run.artifactReview.round.total
            );
          }
          button.append(title, meta);
          button.addEventListener("click", async () => {
            const changedTask = state.selectedTaskId !== run.id;
            state.selectedTaskId = run.id;
            saveSelectedTask();
            if (changedTask) state.artifactReviewContext = null;
            renderAll();
            if (changedTask) scrollTaskDetailToTop();
            await syncArtifactReviewContext();
            renderAll();
          });
          card.append(button, archiveRunButton(run, "task-card-archive"));
          list.append(card);
        }
        el.nav.append(list);
      }
    }

    function selectedTask() {
      const snapshot = currentReviewSnapshot("task");
      if (snapshot?.run && !activeArtifactReviewSummary()) return snapshot.run;
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
      appendOptional(el.detail, renderRunProcedureAsserts(run));
      if (run.plan && run.plan.length) {
        el.detail.append(renderRunFlow(run));
        el.detail.append(renderFinalArtifacts(run));
      }
      else el.detail.append(renderRunArtifacts(run));
    }

    function renderRunMeta(run) {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.append(pill(run.status, false, statusPillClass(run.status)));
      if (run.contractVersion === 1 || run.readOnly) meta.append(pill(t("legacyReadOnly"), false, "warn"));
      meta.append(pill(run.stack.length + " active frame(s)"));
      meta.append(pill(run.events.length + " artifact(s)"));
      meta.append(pill("updated " + formatTime(run.updatedAt)));
      if (run.artifactReview?.round) {
        const reviewStatus = artifactReviewRoundStatusLabel(run.artifactReview.round.status);
        meta.append(pill(
          reviewStatus + " " + run.artifactReview.round.submitted + "/" + run.artifactReview.round.total,
          false,
          run.artifactReview.status === "awaiting_revision" ? "warn" : "processing"
        ));
      }
      const activeStep = currentRunStep(run);
      if (activeStep && run.plan && run.plan.length) meta.append(currentStepJumpButton(run));
      const review = selectedReview();
      const commentCount = review ? review.comments.filter(comment => comment.memoryId === "task/" + run.id).length : 0;
      if (commentCount) meta.append(pill(commentCount + " review comments", false, "warn"));
      return meta;
    }

    function renderRunProcedureAsserts(run) {
      const values = activeRunProcedureAsserts(run);
      if (!values.length) return null;
      const wrap = document.createElement("div");
      wrap.className = "run-procedure-asserts";
      wrap.append(blockTitle(t("procedureAsserts")));
      const list = document.createElement("ul");
      list.className = "text-list";
      values.forEach((value, index) => {
        const item = document.createElement("li");
        const target = t("procedureAsserts") + "[" + (index + 1) + "]";
        item.append(commentable(
          value,
          target,
          value,
          "task:" + run.id + ":procedure:asserts[" + (index + 1) + "]",
          { run, commentKind: "asserts" }
        ));
        list.append(item);
      });
      wrap.append(list);
      return wrap;
    }

    function activeRunProcedureAsserts(run) {
      const values = [...(run.asserts || [])];
      for (const frame of (run.stack || [])) {
        if (frame.type === "procedure") values.push(...(frame.asserts || []));
      }
      return [...new Set(values)];
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
      section.className = "section open task-step inline-schema-host";
      const isRepeat = step.kind === "repeat" && step.repeat;
      const title = isRepeat ? t("repeat") : step.artifact;
      section.append(taskSectionHeader("Next: " + title, isRepeat ? "!repeat" : formatLabel(step.format), "next-step"));
      const panel = document.createElement("div");
      panel.className = "section-body";
      panel.append(blockTitle(t("action")));
      const instruction = document.createElement("div");
      instruction.textContent = step.instruction;
      panel.append(instruction);
      appendOptional(panel, renderActionContracts(step, run));
      appendOptional(panel, renderInlineSchemaDetails(step, true));
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
      if (!isRepeat) appendArtifactMeta(artifact, step);
      artifact.append(pill((frame?.type || "run") + " · " + (frame ? (frame.index + 1) + "/" + frame.steps.length : "")));
      panel.append(artifact);
      const command = document.createElement("div");
      command.className = "pre mono";
      command.textContent = isRepeat
        ? "memsphere run repeat <count> --run " + shellQuote(run.id)
        : formatName(step.format) === "markdown" && step.schema
          ? "memsphere run enter-schema" + (step.schema.kind === "inline" ? "" : " " + shellQuote(step.schema.name || step.artifact)) + " --run " + shellQuote(run.id)
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

    function renderFinalArtifacts(run) {
      const events = run.events.filter(event => event.artifact && event.artifact.final);
      if (!events.length) return document.createDocumentFragment();
      const wrap = document.createElement("div");
      const title = document.createElement("div");
      title.className = "block-title";
      title.textContent = t("finalArtifacts");
      wrap.append(title);
      for (const event of events) wrap.append(renderRunArtifact(event));
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
      if (event.artifact.type) meta.append(pill(event.artifact.type));
      appendFormatMeta(meta, event.artifact.format, artifactSchemaName(event.artifact), event.artifact.schema?.kind === "inline");
      appendArtifactStorageMeta(meta, event.artifact);
      if (event.artifact.validation?.status === "passed") meta.append(pill(t("validated"), false, "done"));
      if (event.artifact.final) meta.append(pill(t("final"), false, "done"));
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
      if (step.kind === "call") return renderTaskCall(step, run);
      return renderTaskAction(step, eventsByStep, activeStep, run);
    }

    function renderTaskAction(step, eventsByStep, activeStep, run) {
      const item = document.createElement("div");
      const isActive = activeStep && activeStep.id === step.id;
      item.className = "flow-item" + (isActive ? " task-step" : "");
      attachTaskStepLocation(item, run, step, isActive);
      const event = eventsByStep.get(step.id);
      item.append(renderFlowHead(t("step"), step.instruction, step.artifact || step.id, taskAnchor(run, step, "action"), step, taskStepStatus(step, event, activeStep), { run, step, event, commentKind: "action" }));
      appendOptional(item, renderActionContracts(step, run));
      appendOptional(item, renderInlineSchemaDetails(step, Boolean(isActive)));
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
      appendOptional(item, renderActionContracts(step, run));
      appendOptional(item, renderInlineSchemaDetails(step, Boolean(isActive)));
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
      appendOptional(item, renderActionContracts(step, run));
      appendOptional(item, renderInlineSchemaDetails(step, Boolean(isActive)));
      appendOptional(item, renderTaskStepResult(step, event, run));
      item.append(renderTaskChildSteps(step.loop.body, eventsByStep, activeStep, run));
      return item;
    }

    function renderTaskCall(step, run) {
      return renderCall(
        step.target,
        taskAnchor(run, step, "call"),
        { run, step, commentKind: "call" }
      );
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
      const reviewContext = artifactReviewContextForStep(run, step);
      if (!shouldRenderTaskStepArtifact(event) && !reviewContext) return null;
      const box = document.createElement("div");
      box.className = "task-result";
      const title = document.createElement("div");
      title.className = "block-title";
      title.textContent = reviewContext ? t("reviewedArtifact") : t("artifactContent");
      const artifact = reviewContext ? reviewContext.submission.artifact : event.artifact;
      const artifactValue = artifactDisplayValue(artifact);
      const artifactContent = renderArtifactValue(artifact);
      const value = commentable(
        artifactContent,
        artifact.name,
        artifactValue,
        taskAnchor(run, step, reviewContext ? "artifact-review" : "artifact"),
        { run, step, event, artifactReview: reviewContext, commentKind: "artifact" }
      );
      if (reviewContext) {
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.append(pill(
          artifactReviewRoundStatusLabel(reviewContext.review.round.status),
          false,
          reviewContext.review.status === "awaiting_revision" ? "warn" : "processing"
        ));
        meta.append(pill(t("round") + " " + reviewContext.review.round.sequence));
        box.append(meta);
      }
      box.append(title, value);
      return box;
    }

    function artifactReviewContextForStep(run, step) {
      const context = state.artifactReviewContext;
      if (!context || context.review?.id !== run.artifactReview?.id) return null;
      return run.artifactReview && step.id === currentRunStep(run)?.id ? context : null;
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
      return state.filtered.find((item) => item.id === state.selectedId)
        || filteredReservedMemories().find((item) => item.id === state.selectedId)
        || state.filtered[0]
        || filteredReservedMemories()[0];
    }

    function selectedReview() {
      return filteredReviews().find(review => review.id === state.selectedReviewId) || null;
    }

    function activeArtifactReviewSummary() {
      if (state.viewMode !== "task") return null;
      const run = state.runs.find(item => item.id === state.selectedTaskId) || state.runs[0] || null;
      return run?.artifactReview || null;
    }

    function isArtifactReviewMode() {
      return Boolean(activeArtifactReviewSummary());
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
      if (isArtifactReviewMode()) {
        const context = state.artifactReviewContext;
        return Boolean(
          context
          && context.review?.status === "pending"
          && context.assignment?.status === "draft"
          && !state.artifactReviewConflict
        );
      }
      const status = selectedReview()?.status;
      return status === "draft" || status === "submitted";
    }

    function canCreateReview() {
      const subject = currentReviewSubject();
      if (!subject) return false;
      if (subject.source === "memory" && selectedMemory()?.source === "reserved") return false;
      return subject.source !== "task" || selectedTask()?.status === "done";
    }

    function reviewCreationDisabledReason() {
      const subject = currentReviewSubject();
      if (!subject) return "Select a Memory or Task before creating a review";
      if (subject.source === "memory" && selectedMemory()?.source === "reserved") {
        return "Import reserved memory before creating a review";
      }
      if (subject.source === "task" && selectedTask()?.status !== "done") {
        return "Only done tasks can create a review";
      }
      return "";
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
      else if (memory.kind === "statements") el.detail.append(renderStatement(memory.entity, 0, primaryName(memory.entity)));
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

    function displayName(entity, fallback) {
      const name = primaryName(entity);
      return name === "(unnamed)" ? fallback : name;
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
      if (memory.entity.syntax) meta.append(pill(t("syntax") + ": " + memory.entity.syntax));
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
      const headerAnchor = "section:" + primaryName(entity);
      box.append(sectionHeader("", entity.tag || "memory", primaryName(entity), headerAnchor));
      const body = document.createElement("div");
      body.className = "section-body";
      appendSectionHeaderThread(body, headerAnchor, "");
      appendNames(body, entity);
      appendTextBlocks(body, entity);
      box.append(body);
      return box;
    }

    function renderSchema(node, depth, path, fallbackName = t("schema")) {
      const section = document.createElement("div");
      section.className = "section schema-node" + (depth < 2 ? " open" : "");
      const badges = ["!schema"];
      if (node.optional) badges.push("optional: true");
      if (node.type) badges.push(t("type") + ": " + node.type);
      if (node.format) {
        badges.push(t("format") + ": " + formatLabel(node.format));
        const layout = formatOptions(node.format).layout;
        if (layout) badges.push(t("layout") + ": " + layout);
      }
      const name = depth === 0 ? "" : displayName(node, fallbackName);
      const headerAnchor = "schema:" + path;
      section.append(sectionHeader(name, badges, path, headerAnchor));
      const body = document.createElement("div");
      body.className = "section-body";
      appendSectionHeaderThread(body, headerAnchor, name);
      if (depth === 0) appendNames(body, node);
      appendTextBlocks(body, node, path);
      if (formatName(node.format) === "markdown" && formatOptions(node.format).layout === "table" && node.fields?.length) {
        body.append(blockTitle(t("fields")), renderTableFields(node.fields, path));
      }
      else if (node.fields && node.fields.length) {
        const children = document.createElement("div");
        children.className = "child-stack";
        for (const child of node.fields) {
          const childName = typeof child === "string"
            ? child
            : child.tag === "!repeat"
              ? t("repeat")
              : child.tag === "!ref"
                ? child.target
              : displayName(child, t("schema"));
          const childPath = path + " > " + childName;
          children.append(typeof child === "string"
            ? renderSimpleSchemaField(child, childPath)
            : child.tag === "!repeat"
              ? renderSchemaRepeat(child, depth + 1, childPath)
              : child.tag === "!ref"
                ? renderMemoryRef(child, childPath)
              : renderSchema(child, depth + 1, childPath));
        }
        body.append(blockTitle(t("fields")), children);
      }
      if (node.item) {
        const itemPath = path + " > " + t("item");
        body.append(blockTitle(t("item")), node.item.tag === "!ref"
          ? renderMemoryRef(node.item)
          : renderSchema(node.item, depth + 1, itemPath, t("item")));
      }
      if (node.items?.length) {
        const candidates = document.createElement("div");
        candidates.className = "child-stack";
        for (const [index, item] of node.items.entries()) {
          const fallback = t("itemCandidate") + " " + (index + 1);
          const itemPath = path + " > " + fallback;
          candidates.append(item.tag === "!ref"
            ? renderMemoryRef(item)
            : renderSchema(item, depth + 1, itemPath, fallback));
        }
        body.append(blockTitle(t("items")), candidates);
      }
      section.append(body);
      return section;
    }

    function renderSchemaRepeat(node, depth, path) {
      const section = document.createElement("div");
      section.className = "section schema-node" + (depth < 2 ? " open" : "");
      const min = node.limit && node.limit.min !== undefined ? node.limit.min : 0;
      const max = node.limit && node.limit.max !== undefined ? node.limit.max : "unbounded";
      const name = t("repeat");
      const headerAnchor = "schema:" + path;
      section.append(sectionHeader(name, ["!repeat", "min: " + min, "max: " + max], path, headerAnchor));
      const body = document.createElement("div");
      body.className = "section-body";
      appendSectionHeaderThread(body, headerAnchor, name);
      const children = document.createElement("div");
      children.className = "child-stack";
      for (const child of node.body || []) {
        const childName = typeof child === "string" ? child : displayName(child, t("schema"));
        const childPath = path + " > " + childName;
        children.append(typeof child === "string"
          ? renderSimpleSchemaField(child, childPath)
          : child.tag === "!ref"
            ? renderMemoryRef(child, childPath)
          : renderSchema(child, depth + 1, childPath));
      }
      body.append(children);
      section.append(body);
      return section;
    }

    function renderStatement(node, depth, path, fallbackName = t("statements"), anchor = "statement:" + path) {
      const section = document.createElement("div");
      section.className = "section statement-node" + (depth < 2 ? " open" : "");
      const name = depth === 0 ? "" : displayName(node, fallbackName);
      section.append(sectionHeader(name, "!statement", path, anchor));
      const body = document.createElement("div");
      body.className = "section-body";
      appendSectionHeaderThread(body, anchor, name);
      if (depth === 0) appendNames(body, node);
      appendTextBlocks(body, node, path);
      if (node.sections && node.sections.length) {
        const children = document.createElement("div");
        children.className = "child-stack";
        for (const [index, child] of node.sections.entries()) {
          const childName = displayName(child, t("statements"));
          const childPath = path + " > " + childName;
          children.append(renderStatement(child, depth + 1, childPath, t("statements"), anchor + ":sections[" + (index + 1) + "]"));
        }
        body.append(blockTitle(t("sections")), children);
      }
      section.append(body);
      return section;
    }

    function sectionHeader(text, badges, target, anchor) {
      const location = nextLocation(anchor || "section:" + target);
      const button = document.createElement("button");
      button.className = "section-header";
      button.dataset.anchor = location.anchor;
      button.dataset.commentSnapshot = String(text ?? "");
      button.id = domIdForAnchor(location.anchor);
      button.innerHTML = '<span class="chevron">›</span><span class="node-title"></span><span class="node-badges"></span>';
      button.querySelector(".node-title").textContent = text;
      const badgeContainer = button.querySelector(".node-badges");
      for (const badge of (Array.isArray(badges) ? badges : [badges])) {
        badgeContainer.append(pill(badge));
      }
      const count = commentsForAnchor(location.anchor, text).length;
      if (count) badgeContainer.append(pill(count + " comments", false, "warn"));
      const targetButton = document.createElement("span");
      targetButton.className = "target-add";
      targetButton.textContent = "+";
      targetButton.title = "Add review comment";
      targetButton.addEventListener("click", (event) => {
        event.stopPropagation();
        event.preventDefault();
        const section = button.parentElement;
        section.classList.add("open");
        openInlineEditor(section.querySelector(".section-body") || section, target || text, text, withLocationHash(location, text), {}, true);
      });
      button.insertBefore(targetButton, button.querySelector(".node-title"));
      button.addEventListener("click", () => button.parentElement.classList.toggle("open"));
      return button;
    }

    function appendSectionHeaderThread(body, anchor, snapshot) {
      const thread = renderInlineThread(anchor, snapshot);
      if (thread) body.append(thread);
    }

    function appendTextBlocks(target, node, path = "") {
      appendDefinitions(target, node.defines, path);
      appendList(target, t("asserts"), node.asserts, "asserts", path);
      appendList(target, t("suggests"), node.suggests, "suggests", path);
    }

    function appendNames(target, node) {
      appendList(target, t("names"), node.names, "names");
    }

    function appendDefinitions(target, definitions, path = "") {
      if (!definitions || !definitions.length) return;
      const title = document.createElement("div");
      title.className = "block-title";
      title.textContent = t("defines");
      target.append(title);
      const strings = definitions
        .map((value, index) => ({ value, index }))
        .filter(entry => typeof entry.value === "string");
      if (strings.length) {
        const list = document.createElement("ul");
        list.className = "text-list";
        for (const entry of strings) {
          const item = document.createElement("li");
          const label = t("defines") + "[" + (entry.index + 1) + "]";
          const legacyAnchor = "defines[" + (entry.index + 1) + "]";
          const anchor = path ? path + "." + legacyAnchor : legacyAnchor;
          item.append(commentable(entry.value, label, entry.value, anchor, {}, legacyAnchor));
          list.append(item);
        }
        target.append(list);
      }
      const structures = definitions
        .map((value, index) => ({ value, index }))
        .filter(entry => entry.value && typeof entry.value === "object");
      if (!structures.length) return;
      const children = document.createElement("ul");
      children.className = "text-list definition-list child-stack";
      structures.forEach((entry) => {
        const definition = entry.value;
        const path = "defines[" + (entry.index + 1) + "]";
        if (definition.tag === "!schema") {
          children.append(renderDefinitionItem(renderSchema(definition, 1, path, "")));
          return;
        }
        if (definition.tag === "!ref") {
          children.append(renderDefinitionItem(renderMemoryRef(definition, path)));
          return;
        }
        children.append(renderDefinitionItem(renderStatement(definition, 1, path, "", path)));
      });
      target.append(children);
    }

    function renderMemoryRef(ref, path) {
      const target = ref.target || "";
      const link = document.createElement("button");
      link.type = "button";
      link.className = "memory-ref-link" + (memoryByReference(target) ? "" : " missing");
      link.textContent = target || t("missingTarget");
      link.title = memoryByReference(target) ? "Open referenced memory" : "Referenced memory not found";
      link.addEventListener("click", (event) => {
        event.stopPropagation();
        openMemoryReference(target);
      });
      return link;
    }

    function memoryByReference(reference) {
      const value = String(reference || "");
      if (!value) return null;
      const direct = [...state.memories, ...state.reservedMemories].find(memory => memory.id === value);
      if (direct) return direct;
      const separator = value.indexOf("/");
      if (separator > 0) {
        const kind = value.slice(0, separator);
        const name = value.slice(separator + 1);
        return [...state.memories, ...state.reservedMemories].find(memory =>
          memory.kind === kind && memory.entity?.names?.includes(name)
        ) || null;
      }
      return state.byName.get(value) || null;
    }

    function openMemoryReference(reference) {
      const target = memoryByReference(reference);
      if (!target) return;
      state.viewMode = "memory";
      localStorage.setItem(viewModeKey, "memory");
      state.selectedId = target.id;
      renderAll();
    }

    function renderDefinitionItem(section) {
      const item = document.createElement("li");
      item.append(section);
      return item;
    }

    function appendList(target, heading, values, key, path = "") {
      if (!values || !values.length) return;
      const title = document.createElement("div");
      title.className = "block-title";
      title.textContent = heading;
      const list = document.createElement("ul");
      list.className = "text-list";
      values.forEach((value, index) => {
        const item = document.createElement("li");
        const label = heading + "[" + (index + 1) + "]";
        const legacyAnchor = key + "[" + (index + 1) + "]";
        const anchor = path ? path + "." + legacyAnchor : legacyAnchor;
        item.append(commentable(value, label, value, anchor, {}, legacyAnchor));
        list.append(item);
      });
      target.append(title, list);
    }

    function renderTableFields(fields, path) {
      const table = document.createElement("table");
      table.className = "field-table";
      const body = document.createElement("tbody");
      for (const field of fields) {
        const fieldName = typeof field === "string"
          ? field
          : field.tag === "!ref"
            ? field.target
            : displayName(field, t("schema"));
        const row = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = fieldName + (field && typeof field === "object" && field.optional ? " (optional: true)" : "");
        const fieldTarget = path + " > " + fieldName;
        const fieldAnchor = "field:" + fieldTarget;
        const fieldLocation = nextLocation(fieldAnchor);
        th.dataset.anchor = fieldLocation.anchor;
        th.prepend(commentButton(fieldTarget, fieldName, withLocationHash(fieldLocation, fieldName)));
        const td = document.createElement("td");
        const parts = [];
        if (typeof field !== "string") {
          if (field.tag === "!ref") parts.push("!ref " + field.target);
          if (field.defines && field.defines.length) parts.push(field.defines.filter(value => typeof value === "string").join("\n"));
          if (field.asserts && field.asserts.length) parts.push(field.asserts.join("\n"));
        }
        const snapshot = parts.join("\n\n") || "Column";
        td.append(commentable(snapshot, fieldTarget, snapshot, fieldAnchor + ":body"));
        row.append(th, td);
        body.append(row);
      }
      table.append(body);
      return table;
    }

    function renderSimpleSchemaField(name, path) {
      const location = nextLocation("field:" + path);
      const list = document.createElement("ul");
      list.className = "text-list schema-field-list";
      const field = document.createElement("li");
      field.className = "schema-field-plain";
      field.dataset.anchor = location.anchor;
      field.id = domIdForAnchor(location.anchor);
      const content = document.createElement("span");
      content.className = "schema-field-content";
      const title = document.createElement("span");
      title.className = "node-title";
      title.textContent = name;
      const meta = document.createElement("span");
      meta.className = "schema-field-type";
      meta.textContent = "string";
      const count = commentsForAnchor(location.anchor, name).length;
      if (count) meta.append(" · " + count + " comments");
      const targetButton = document.createElement("button");
      targetButton.className = "target-add";
      targetButton.textContent = "+";
      targetButton.title = "Add review comment";
      targetButton.addEventListener("click", () => {
        openInlineEditor(field, path, name, withLocationHash(location, name));
      });
      content.append(targetButton, title, meta);
      field.append(content);
      list.append(field);
      return list;
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
      if (step.tag === "!action" && step.action && artifactSpec(step).format) return renderStructuredAction(step, anchor);
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

    function renderCall(name, anchor, context = {}) {
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
          state.viewMode = "memory";
          localStorage.setItem(viewModeKey, "memory");
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
      action.append(commentable(content, "!call " + name, String(name), anchor, context));
      head.append(label, action);
      item.append(head);
      return item;
    }

    function renderCanonicalIf(step, anchor) {
      const item = document.createElement("div");
      item.className = "flow-item branch";
      item.append(renderStructuredControlHead(step.condition, anchor + ".condition", t("if")));
      item.append(renderNamedFlowChildren("", step.then || [], anchor + ".then"));
      let branch = step.elseif;
      let index = 1;
      while (branch) {
        const branchWrap = document.createElement("div");
        const branchAnchor = anchor + ".elseif".repeat(index);
        branchWrap.append(renderStructuredControlHead(branch.condition, branchAnchor + ".condition", t("elseif")));
        branchWrap.append(renderNamedFlowChildren("", branch.then || [], branchAnchor + ".then"));
        item.append(branchWrap);
        branch = branch.elseif;
        index += 1;
      }
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
      appendOptional(item, renderActionContracts(step, null, anchor));
      appendOptional(item, renderInlineSchemaDetails(step));
      return item;
    }

    function renderStructuredControlHead(step, anchor, labelText = t("if")) {
      const wrap = document.createElement("div");
      if (!step || typeof step !== "object") {
        wrap.append(commentable(String(step), anchor, String(step), anchor));
        return wrap;
      }
      const artifact = artifactSpec(step);
      wrap.append(renderFlowHead(labelText, step.action || "", artifact.name || anchor, anchor + ".action", step));
      appendOptional(wrap, renderActionContracts(step, null, anchor));
      appendOptional(wrap, renderInlineSchemaDetails(step));
      return wrap;
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
      const artifactLine = document.createElement("div");
      artifactLine.className = "artifact-meta-line";
      if (stepActor(step) === "human") {
        const actorLabel = document.createElement("span");
        actorLabel.className = "artifact-label";
        actorLabel.textContent = t("actor");
        artifactLine.append(actorLabel, actorPill("human"));
      }
      const label = document.createElement("span");
      label.className = "artifact-label";
      label.textContent = t("artifact");
      artifactLine.append(label);
      appendArtifactMeta(artifactLine, step);
      if (status) artifactLine.append(pill(status, false, status === t("currentStep") ? "processing" : status === t("completed") ? "done" : ""));
      row.append(artifactLine);
      appendArtifactReviewRoles(row, step);
      return row;
    }

    function actorPill(actor) {
      return pill(t(actor), false, actor === "human" ? "human" : "agent");
    }

    function appendArtifactMeta(target, step) {
      const artifact = artifactSpec(step);
      target.append(pill(artifact.name || t("artifact"), true));
      if (artifact.type) target.append(pill(artifact.type));
      if (artifact.schema?.kind === "inline") {
        target.append(inlineSchemaTogglePill(artifact.schema.node));
        appendFormatMeta(target, artifact.format, undefined, true);
      } else {
        appendFormatMeta(target, artifact.format, artifact.schema?.kind === "external" ? artifact.schema.name : undefined, false);
      }
      if (artifact.final) target.append(pill(t("final"), false, "done"));
    }

    function appendArtifactReviewRoles(target, step) {
      const artifact = artifactSpec(step);
      if (!artifact.review) return;
      const bindings = effectiveArtifactReviewBindings(step, artifact);
      const roleIds = Object.keys(bindings);
      if (!roleIds.length) return;

      const reviewLine = document.createElement("div");
      reviewLine.className = "artifact-meta-line artifact-review-line";
      const label = document.createElement("span");
      label.className = "artifact-label";
      label.textContent = t("reviewers");
      reviewLine.append(label);
      for (const roleId of roleIds) reviewLine.append(pill(artifactReviewRoleDisplayName(roleId)));
      target.append(reviewLine);
    }

    function effectiveArtifactReviewBindings(step, artifact) {
      if (state.viewMode === "task" && step?.controlPlane?.bindings) return step.controlPlane.bindings;
      const memory = selectedMemory();
      const procedureBindings = memory?.entity?.tag === "!procedure" ? memory.entity.roleBindings || {} : {};
      return { ...procedureBindings, ...(artifact.roleBindings || {}) };
    }

    function artifactReviewRoleDisplayName(roleId) {
      if (state.viewMode === "task") {
        return selectedTask()?.controlPlane?.roles?.[roleId]?.name || state.roleNames[roleId] || roleId;
      }
      return state.roleNames[roleId] || roleId;
    }

    function inlineSchemaTogglePill(schema) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pill inline-schema-toggle";
      button.textContent = inlineSchemaSummary(schema);
      button.title = t("inlineSchema");
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", () => {
        const host = button.closest(".inline-schema-host") || button.closest(".flow-item");
        const details = host?.querySelector(".inline-schema-section");
        if (!details) return;
        const open = !details.classList.contains("open");
        details.classList.toggle("open", open);
        button.setAttribute("aria-expanded", String(open));
      });
      return button;
    }

    function inlineSchemaSummary(schema) {
      const parts = [t("inlineSchema")];
      if (schema.type) parts.push(t("type") + ": " + schema.type);
      if (schema.format) {
        parts.push(t("format") + ": " + formatLabel(schema.format));
        const layout = formatOptions(schema.format).layout;
        if (layout) parts.push(t("layout") + ": " + layout);
      }
      if (schema.asserts?.length) parts.push(schema.asserts.length + " " + t("asserts"));
      if (schema.fields?.length) parts.push(schema.fields.length + " " + t("fields"));
      if (schema.item) parts.push("1 " + t("item"));
      if (schema.items?.length) parts.push(schema.items.length + " " + t("items"));
      return parts.join(" · ");
    }

    function appendFormatMeta(target, format, schemaName, inlineSchema) {
      target.append(pill(formatLabel(format)));
      const options = formatOptions(format);
      for (const [name, value] of Object.entries(options)) target.append(pill(name + ": " + String(value)));
      if (inlineSchema) target.append(pill(t("inlineSchema")));
      if (schemaName) target.append(schemaLinkPill(schemaName));
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
      if (artifact.schema?.kind === "inline") return t("inlineSchema");
      if (schemaName) return t("schema") + ": " + schemaName;
      return formatLabel(artifact.format);
    }

    function artifactSchemaName(artifact) {
      return artifact?.schema?.kind === "external" ? artifact.schema.name : "";
    }

    function renderActionContracts(step, run, anchorPrefix = "") {
      if (!step || (!step.asserts?.length && !step.suggests?.length)) return null;
      const wrap = document.createElement("div");
      wrap.className = "action-contracts";
      for (const [key, label, values] of [["asserts", t("asserts"), step.asserts], ["suggests", t("suggests"), step.suggests]]) {
        if (!values?.length) continue;
        const group = document.createElement("div");
        group.append(blockTitle(label));
        const list = document.createElement("ul");
        values.forEach((value, index) => {
          const item = document.createElement("li");
          const target = label + "[" + (index + 1) + "]";
          const fieldAnchor = key + "[" + (index + 1) + "]";
          const anchor = run ? taskAnchor(run, step, fieldAnchor) : anchorPrefix ? anchorPrefix + "." + fieldAnchor : fieldAnchor;
          item.append(commentable(value, target, value, anchor, { run, step, commentKind: key }));
          list.append(item);
        });
        group.append(list);
        wrap.append(group);
      }
      return wrap;
    }

    function renderInlineSchemaDetails(step, expanded = false) {
      const artifact = artifactSpec(step || {});
      const schema = artifact.schema?.kind === "inline" ? artifact.schema.node : undefined;
      if (!schema) return null;
      const identity = artifact.schema.id || step?.id || artifact.name || "artifact";
      const section = renderSchema(schema, 1, "inline-schema:" + identity, t("inlineSchema"));
      section.classList.add("inline-schema-section");
      if (!expanded) section.classList.remove("open");
      const wrap = document.createElement("div");
      wrap.className = "artifact-structure";
      wrap.append(blockTitle(t("artifact")), section);
      return wrap;
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
      return formatName(artifact?.format) === "markdown" && typeof artifact.renderedContent === "string";
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
        const inlineSchema = step.artifact.schema && typeof step.artifact.schema === "object"
          ? { kind: "inline", id: "inline:" + (step.id || step.artifact.name || "artifact"), node: step.artifact.schema }
          : typeof step.artifact.schema === "string"
            ? { kind: "external", name: step.artifact.schema }
            : undefined;
        return {
          name: step.artifact.name || "",
          type: step.artifact.type || "",
          format: step.artifact.format || { name: "plain", options: {} },
          schema: inlineSchema,
          final: Boolean(step.artifact.final),
          review: step.artifact.review || "",
          roleBindings: step.artifact.roleBindings || {}
        };
      }
      return {
        name: typeof step?.artifact === "string" ? step.artifact : "",
        type: step?.type || "",
        format: step?.format || { name: "plain", options: {} },
        schema: step?.schema,
        final: Boolean(step?.final),
        review: step?.reviewPolicy || "",
        roleBindings: step?.roleBindings || {}
      };
    }

    function stepActor(step) {
      return step?.actor === "human" ? "human" : "agent";
    }

    function formatLabel(format) {
      const name = formatName(format);
      if (name === "plain") return "plain";
      if (name === "markdown") return t("markdown");
      if (name === "json") return t("json");
      if (name === "yaml") return t("yaml");
      return name || t("format");
    }

    function formatName(format) {
      return typeof format === "string" ? format : format?.name || "";
    }

    function formatOptions(format) {
      return format && typeof format === "object" && format.options && typeof format.options === "object"
        ? format.options
        : {};
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

    function commentable(content, target, snapshot, anchor, context = {}, legacyAnchor = "") {
      const location = nextLocation(anchor || target);
      const locationWithHash = withLocationHash(location, snapshot);
      const wrap = document.createElement("div");
      wrap.className = "commentable";
      wrap.dataset.anchor = location.anchor;
      if (legacyAnchor && legacyAnchor !== location.anchor) wrap.dataset.legacyAnchor = legacyAnchor;
      wrap.id = domIdForAnchor(location.anchor);
      wrap.append(commentButton(target, snapshot, locationWithHash, context));
      const body = document.createElement("div");
      body.className = "commentable-body";
      body.dataset.commentSnapshot = String(snapshot ?? "");
      if (content instanceof Node) body.append(content);
      else body.textContent = String(content);
      wrap.append(body);
      const thread = renderInlineThread(location.anchor, snapshot, legacyAnchor);
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

    function openInlineEditor(host, target, snapshot, location, context = {}, insertAtStart = false) {
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
      save.addEventListener("click", () => {
        const body = textarea.value.trim();
        if (!body) {
          textarea.focus();
          return;
        }
        runButtonAction(save, async () => {
          const comment = await addComment(target, snapshot, body, location, context);
          editor.remove();
          if (comment) scrollToComment(comment);
        });
      });
      cancel.addEventListener("click", () => editor.remove());
      actions.append(save, cancel);
      editor.append(textarea, actions);
      if (insertAtStart) host.prepend(editor);
      else host.append(editor);
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

    function commentsForAnchor(anchor, snapshot, legacyAnchor = "") {
      if (isArtifactReviewMode()) {
        return artifactReviewVisibleComments().filter(comment => {
          const candidate = comment.anchor;
          if (!candidate || candidate.sourceHash !== state.artifactReviewContext?.submission?.digest) return false;
          return candidate.location === anchor || candidate.target === anchor || (legacyAnchor && candidate.location === legacyAnchor);
        });
      }
      const review = selectedReview();
      const subject = currentReviewSubject();
      if (!review || !subject) return [];
      return review.comments.filter(comment => {
        if (comment.memoryId !== subject.id) return false;
        const anchorMatches = comment.location?.anchor
          ? comment.location.anchor === anchor || (legacyAnchor && comment.location.anchor === legacyAnchor)
          : comment.target === anchor;
        if (!anchorMatches) return false;
        if (!comment.location?.hash) return true;
        return comment.location.hash === hashSnapshot(snapshot);
      });
    }

    function renderInlineThread(anchor, snapshot, legacyAnchor = "") {
      const comments = commentsForAnchor(anchor, snapshot, legacyAnchor);
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
        if (canComment() && (!isArtifactReviewMode() || comment._mineDraft)) {
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
      save.addEventListener("click", () => {
        const body = textarea.value.trim();
        if (!body) {
          textarea.focus();
          return;
        }
        runButtonAction(save, () => updateComment(comment.id, body));
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
      if (document.querySelector(".inline-comment-editor")) return true;
      const composer = document.querySelector(".artifact-review-comment textarea");
      return Boolean(composer && (composer === document.activeElement || composer.value));
    }

    function hasActiveTaskInteraction() {
      if (hasOpenInlineEditor()) return true;
      if (document.querySelector(".artifact-review-select-menu:not([hidden])")) return true;
      return Boolean(document.activeElement?.matches?.(".artifact-review-select"));
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
      if (isArtifactReviewMode()) {
        const reviewContext = state.artifactReviewContext;
        if (!reviewContext || !canComment()) return;
        const comment = {
          id: uuid(),
          body,
          anchor: {
            target: String(target || "").trim(),
            location: String(location?.anchor || ""),
            sourceHash: reviewContext.submission.digest
          },
          _mineDraft: true
        };
        await saveArtifactReviewDraft({
          ...reviewContext.assignment.draft,
          comments: reviewContext.assignment.draft.comments.concat(comment)
        });
        return comment;
      }
      const review = selectedReview();
      const subject = currentReviewSubject();
      if (!subject || !review || !canComment()) return;
      const comment = {
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
      };
      const comments = review.comments.concat(comment);
      await patchReview(review.id, { comments });
      return comment;
    }

    async function removeComment(id) {
      if (isArtifactReviewMode()) {
        const context = state.artifactReviewContext;
        if (!context || !canComment()) return;
        await saveArtifactReviewDraft({
          ...context.assignment.draft,
          comments: context.assignment.draft.comments.filter(comment => comment.id !== id)
        });
        return;
      }
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
      if (isArtifactReviewMode()) {
        const context = state.artifactReviewContext;
        if (!context || !canComment()) return;
        await saveArtifactReviewDraft({
          ...context.assignment.draft,
          comments: context.assignment.draft.comments.map(comment => comment.id === id ? { ...comment, body } : comment)
        });
        return;
      }
      const review = selectedReview();
      if (!review || !canComment()) return;
      await patchReview(review.id, {
        comments: review.comments.map(comment => comment.id === id ? { ...comment, body } : comment)
      });
    }

    async function submitReview() {
      if (isArtifactReviewMode()) {
        await submitArtifactReview();
        return;
      }
      const review = selectedReview();
      if (!review || review.status !== "draft" || !review.comments.length) return;
      await patchReview(review.id, { status: "submitted" });
    }

    function artifactReviewVisibleComments() {
      const context = state.artifactReviewContext;
      if (!context) return [];
      const comments = (context.assignment?.draft?.comments || []).map(comment => ({ ...comment, _mineDraft: true }));
      const selectedRoundId = state.artifactReviewHistoryRoundId || context.review.currentRoundId;
      const selectedRounds = (context.rounds || []).filter(round => round.id === selectedRoundId);
      for (const round of selectedRounds) {
        for (const assignment of round.assignments || []) {
          for (const comment of assignment.submitted?.comments || []) {
            comments.push({
              ...comment,
              _mineDraft: false,
              _identityName: artifactReviewRoleName(assignment),
              _binding: assignment.binding,
              _round: round.sequence
            });
          }
        }
      }
      return comments;
    }

    async function saveArtifactReviewDraft(draft) {
      const context = state.artifactReviewContext;
      if (!context || context.assignment.status !== "draft" || state.artifactReviewSaving) return;
      state.artifactReviewSaving = true;
      setArtifactReviewControlsBusy(true);
      try {
        const response = await fetch(artifactReviewAssignmentUrl(context, "draft"), {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedRevision: context.review.round.revision,
            vote: draft.vote,
            comments: (draft.comments || []).map(comment => ({
              id: comment.id,
              body: comment.body,
              anchor: comment.anchor
            }))
          })
        });
        if (response.status === 409) {
          state.artifactReviewConflict = t("round") + " " + t("changesRequested") + ": " + response.statusText;
          throw new Error(t("round") + " revision conflict; your text is still in this page");
        }
        if (!response.ok) throw new Error(await response.text());
        state.artifactReviewContext = await response.json();
        state.artifactReviewConflict = "";
      } finally {
        state.artifactReviewSaving = false;
        renderAll();
      }
    }

    function setArtifactReviewControlsBusy(busy) {
      for (const control of el.reviewPanel.querySelectorAll(".artifact-review-vote button, .artifact-review-comment button, .artifact-review-select, #submit-review")) {
        control.disabled = busy;
      }
    }

    function artifactReviewAssignmentUrl(context, operation) {
      return "/api/artifact-reviews/" + encodeURIComponent(context.review.id)
        + "/rounds/" + encodeURIComponent(context.review.currentRoundId)
        + "/assignments/" + encodeURIComponent(context.assignment.identityId)
        + "/" + operation;
    }

    function artifactReviewSubmitDisabledReason() {
      const context = state.artifactReviewContext;
      if (!context) return t("selectIdentity");
      if (state.artifactReviewSaving) return displayLanguage === "zh" ? "正在保存评审草稿" : "Saving review draft";
      if (state.artifactReviewConflict) return state.artifactReviewConflict;
      if (context.review.status !== "pending") return t("round") + " " + context.review.status;
      if (context.assignment.status === "submitted") return t("submitted");
      const vote = context.assignment.draft.vote;
      if (!vote) return displayLanguage === "zh" ? "请先选择投票结果" : "Select a vote first";
      if (vote === "request_changes" && !(context.assignment.draft.comments || []).length) {
        return displayLanguage === "zh" ? "选择修改时，至少需要一条意见" : "Requesting changes requires at least one comment";
      }
      return "";
    }

    async function submitArtifactReview() {
      const context = state.artifactReviewContext;
      const disabledReason = artifactReviewSubmitDisabledReason();
      if (!context || disabledReason) return;
      const confirmed = await confirmArtifactReviewSubmit(context);
      if (!confirmed) return;
      const response = await fetch(artifactReviewAssignmentUrl(context, "submit"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: context.review.round.revision })
      });
      if (response.status === 409) {
        state.artifactReviewConflict = displayLanguage === "zh"
          ? "评审轮次已更新；当前页面中的未提交文本仍然保留，请刷新本轮后再操作。"
          : "The review round changed. Your local text is preserved; refresh before submitting.";
        renderAll();
        return;
      }
      if (!response.ok) throw new Error(await response.text());
      state.artifactReviewContext = await response.json();
      await loadRuns();
      renderAll();
    }

    function confirmArtifactReviewSubmit(context) {
      return new Promise(resolve => {
        const dialog = document.createElement("dialog");
        dialog.className = "artifact-review-dialog";
        const body = document.createElement("div");
        body.className = "artifact-review-dialog-body";
        const title = document.createElement("h3");
        title.textContent = t("submitArtifactReview");
        const summary = document.createElement("div");
        const vote = artifactReviewVoteLabel(context.assignment.draft.vote, context.assignment.binding);
        summary.textContent = artifactReviewRoleName(context.assignment) + " · "
          + t("round") + " " + context.review.round.sequence + " · "
          + (context.assignment.binding === "decision" ? t("decisionVote") : t("advisoryVote")) + " · "
          + vote + " · " + context.assignment.draft.comments.length + " comment(s)";
        const warning = document.createElement("div");
        warning.className = "artifact-review-message warn";
        warning.textContent = displayLanguage === "zh" ? "提交后，本轮评审不可修改。" : "This round cannot be edited after submission.";
        const actions = document.createElement("div");
        actions.className = "artifact-review-dialog-actions";
        const cancel = document.createElement("button");
        cancel.className = "btn";
        cancel.textContent = displayLanguage === "zh" ? "取消" : "Cancel";
        const confirmButton = document.createElement("button");
        confirmButton.className = "btn primary";
        confirmButton.textContent = t("submitArtifactReview");
        cancel.addEventListener("click", () => dialog.close("cancel"));
        confirmButton.addEventListener("click", () => dialog.close("confirm"));
        dialog.addEventListener("close", () => {
          const confirmed = dialog.returnValue === "confirm";
          dialog.remove();
          resolve(confirmed);
        });
        actions.append(cancel, confirmButton);
        body.append(title, summary, warning, actions);
        dialog.append(body);
        document.body.append(dialog);
        dialog.showModal();
        cancel.focus();
      });
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
      if (isArtifactReviewMode()) {
        renderArtifactReviewPanel();
        return;
      }
      const review = selectedReview();
      el.reviewHeading.textContent = "Review";
      el.createReview.hidden = false;
      el.submitReview.hidden = false;
      const canCreate = canCreateReview();
      el.createReview.disabled = !canCreate;
      el.createReview.title = canCreate ? "Create Review" : reviewCreationDisabledReason();
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
        open.textContent = "Go to";
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

    function renderArtifactReviewPanel() {
      const review = activeArtifactReviewSummary();
      const context = state.artifactReviewContext;
      el.reviewHeading.textContent = t("artifactReview");
      el.createReview.hidden = true;
      el.submitReview.hidden = false;
      el.reviews.innerHTML = "";
      el.comments.innerHTML = "";
      if (!review?.round) {
        el.reviewLabel.textContent = "";
        el.commentSummary.textContent = "";
        el.submitReview.disabled = true;
        return;
      }

      el.reviewLabel.textContent = review.artifactName + " · " + t("round") + " " + review.round.sequence;
      const controls = document.createElement("section");
      controls.className = "panel artifact-review-stack";
      const identityLabel = blockTitle(t("identity"));
      controls.append(identityLabel, renderArtifactReviewIdentitySelector(review, context));

      if (context) {
        const role = document.createElement("div");
        role.className = "meta";
        role.style.margin = "0";
        role.append(pill(
          context.assignment.binding === "decision" ? t("decisionVote") : t("advisoryVote"),
          false,
          context.assignment.binding === "decision" ? "strong" : "warn"
        ));
        controls.append(role);
      }

      controls.append(blockTitle(t("participants")), renderArtifactReviewProgress(review, context));
      if (context?.rounds?.length > 1) controls.append(renderArtifactReviewHistorySelector(context));
      el.reviews.append(controls);

      if (state.artifactReviewLoading) {
        const loading = document.createElement("div");
        loading.className = "muted";
        loading.textContent = "Loading...";
        el.comments.append(loading);
      } else if (!context) {
        const empty = document.createElement("div");
        empty.className = "artifact-review-message";
        empty.textContent = t("selectIdentity");
        el.comments.append(empty);
      } else {
        renderArtifactReviewWorkspace(context);
      }

      const disabledReason = artifactReviewSubmitDisabledReason();
      const agentManaged = context?.assignment?.identityKind === "agent";
      el.submitReview.hidden = Boolean(agentManaged);
      el.submitReview.textContent = context?.assignment?.status === "submitted" ? t("submitted") : t("submitArtifactReview");
      el.submitReview.disabled = agentManaged || Boolean(disabledReason);
      el.submitReview.title = disabledReason;
      el.commentSummary.textContent = context
        ? artifactReviewRoleName(context.assignment) + " · " + context.review.id
        : review.id;
    }

    function renderArtifactReviewProgress(review, context) {
      const list = document.createElement("div");
      list.className = "artifact-review-grid";
      const currentRound = context?.rounds?.find(round => round.id === review.currentRoundId);
      for (const assignment of review.round.assignments || []) {
        const submitted = currentRound?.assignments?.find(item => item.identityId === assignment.identityId)?.submitted;
        const row = document.createElement("div");
        row.className = "artifact-review-row";
        const main = document.createElement("div");
        main.className = "artifact-review-row-main";
        const name = document.createElement("span");
        name.textContent = artifactReviewRoleName(assignment);
        const type = document.createElement("span");
        type.className = "muted";
        type.textContent = (assignment.binding === "decision" ? t("decisionVote") : t("advisoryVote"))
          + (assignment.identityKind === "agent" ? " · Agent" : "");
        main.append(name, type);
        const status = document.createElement("span");
        status.className = "artifact-review-progress";
        status.textContent = submitted
          ? artifactReviewVoteLabel(submitted.vote, assignment.binding)
          : artifactReviewAssignmentStatusLabel(assignment.status, assignment.identityKind);
        row.append(main, status);
        list.append(row);
      }
      if (review.round.runner) {
        const row = document.createElement("div");
        row.className = "artifact-review-row";
        const main = document.createElement("div");
        main.className = "artifact-review-row-main";
        const name = document.createElement("span");
        name.textContent = (review.round.runner.roleName || "Runner")
          + (review.round.runner.automatic ? " · " + t("automatic") : "");
        const type = document.createElement("span");
        type.className = "muted";
        type.textContent = t("decisionVote");
        main.append(name, type);
        const status = document.createElement("span");
        status.className = "artifact-review-progress";
        status.textContent = review.round.runner.status === "submitted"
          ? artifactReviewVoteLabel(review.round.runner.vote, "decision")
          : t("pendingVote");
        row.append(main, status);
        list.append(row);
      }
      return list;
    }

    function renderArtifactReviewIdentitySelector(review, context) {
      const assignments = review.round.assignments || [];
      const selectedIdentityId = context?.assignment?.identityId || state.artifactReviewIdentityByReview[review.id] || "";
      const selectedAssignment = assignments.find(assignment => assignment.identityId === selectedIdentityId);
      const chooser = document.createElement("div");
      chooser.className = "artifact-review-round-select artifact-review-identity-select";
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "artifact-review-select artifact-review-select-trigger";
      trigger.setAttribute("role", "combobox");
      trigger.setAttribute("aria-label", t("identity"));
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      trigger.disabled = state.artifactReviewSaving;
      const triggerText = document.createElement("span");
      triggerText.textContent = selectedAssignment ? artifactReviewRoleName(selectedAssignment) : t("selectIdentity");
      const caret = document.createElement("span");
      caret.className = "artifact-review-select-caret";
      caret.setAttribute("aria-hidden", "true");
      caret.textContent = "⌄";
      trigger.append(triggerText, caret);
      const menu = document.createElement("div");
      menu.className = "artifact-review-select-menu";
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", t("identity"));
      menu.hidden = true;

      const setOpen = open => {
        menu.hidden = !open;
        trigger.setAttribute("aria-expanded", String(open));
      };
      const focusOption = offset => {
        const options = [...menu.querySelectorAll(".artifact-review-select-option")];
        if (!options.length) return;
        const focusedIndex = options.indexOf(document.activeElement);
        const selectedIndex = options.findIndex(option => option.getAttribute("aria-selected") === "true");
        const start = focusedIndex >= 0 ? focusedIndex : selectedIndex >= 0 ? selectedIndex : 0;
        options[(start + offset + options.length) % options.length].focus();
      };
      for (const assignment of assignments) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "artifact-review-select-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(assignment.identityId === selectedIdentityId));
        option.dataset.identityId = assignment.identityId;
        option.textContent = artifactReviewRoleName(assignment) + " · "
          + (assignment.binding === "decision" ? t("decisionVote") : t("advisoryVote"));
        option.addEventListener("click", async () => {
          setOpen(false);
          state.artifactReviewIdentityByReview[review.id] = assignment.identityId;
          writeStoredObject(artifactReviewIdentityKey, state.artifactReviewIdentityByReview);
          await loadArtifactReviewContext(review.id, review.currentRoundId, assignment.identityId);
          renderAll();
        });
        menu.append(option);
      }
      trigger.addEventListener("click", () => setOpen(menu.hidden));
      trigger.addEventListener("keydown", event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setOpen(true);
          focusOption(event.key === "ArrowDown" ? 1 : -1);
        } else if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
        }
      });
      menu.addEventListener("keydown", event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          focusOption(event.key === "ArrowDown" ? 1 : -1);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.focus();
        }
      });
      chooser.addEventListener("focusout", () => {
        setTimeout(() => {
          if (!chooser.contains(document.activeElement)) setOpen(false);
        }, 0);
      });
      trigger.addEventListener("click", () => {
        if (menu.hidden) return;
        setTimeout(() => {
          document.addEventListener("pointerdown", event => {
            if (!chooser.contains(event.target)) setOpen(false);
          }, { once: true });
        }, 0);
      });
      chooser.append(trigger, menu);
      return chooser;
    }

    function artifactReviewRoleName(assignment) {
      const names = assignment?.roleNames || assignment?.roleIds || [];
      return names.length ? names.join(" / ") : assignment?.identityName || "";
    }

    function renderArtifactReviewHistorySelector(context) {
      const wrap = document.createElement("div");
      wrap.className = "artifact-review-controls";
      wrap.append(blockTitle(t("round")));
      const currentId = state.artifactReviewHistoryRoundId || context.review.currentRoundId;
      const selectedId = context.rounds.some(round => round.id === currentId)
        ? currentId
        : context.review.currentRoundId;
      const selectedRound = context.rounds.find(round => round.id === selectedId);
      const chooser = document.createElement("div");
      chooser.className = "artifact-review-round-select";
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "artifact-review-select artifact-review-select-trigger";
      trigger.setAttribute("aria-label", t("round"));
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      const triggerText = document.createElement("span");
      triggerText.textContent = selectedRound
        ? t("round") + " " + selectedRound.sequence + " · " + artifactReviewRoundStatusLabel(selectedRound.status)
        : t("round");
      const caret = document.createElement("span");
      caret.className = "artifact-review-select-caret";
      caret.setAttribute("aria-hidden", "true");
      caret.textContent = "⌄";
      trigger.append(triggerText, caret);
      const menu = document.createElement("div");
      menu.className = "artifact-review-select-menu";
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", t("round"));
      menu.hidden = true;

      const setOpen = open => {
        menu.hidden = !open;
        trigger.setAttribute("aria-expanded", String(open));
      };
      const focusOption = offset => {
        const options = [...menu.querySelectorAll(".artifact-review-select-option")];
        if (!options.length) return;
        const focusedIndex = options.indexOf(document.activeElement);
        const selectedIndex = options.findIndex(option => option.getAttribute("aria-selected") === "true");
        const start = focusedIndex >= 0 ? focusedIndex : selectedIndex >= 0 ? selectedIndex : 0;
        options[(start + offset + options.length) % options.length].focus();
      };
      for (const round of context.rounds) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "artifact-review-select-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(round.id === selectedId));
        option.dataset.roundId = round.id;
        option.textContent = t("round") + " " + round.sequence + " · " + artifactReviewRoundStatusLabel(round.status);
        option.addEventListener("click", () => {
          state.artifactReviewHistoryRoundId = round.id;
          setOpen(false);
          renderAll();
        });
        menu.append(option);
      }
      trigger.addEventListener("click", () => {
        setOpen(menu.hidden);
      });
      trigger.addEventListener("keydown", event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setOpen(true);
          focusOption(event.key === "ArrowDown" ? 1 : -1);
        } else if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
        }
      });
      menu.addEventListener("keydown", event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          focusOption(event.key === "ArrowDown" ? 1 : -1);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.focus();
        }
      });
      chooser.addEventListener("focusout", () => {
        setTimeout(() => {
          if (!chooser.contains(document.activeElement)) setOpen(false);
        }, 0);
      });
      trigger.addEventListener("click", () => {
        if (menu.hidden) return;
        setTimeout(() => {
          document.addEventListener("pointerdown", event => {
            if (!chooser.contains(event.target)) setOpen(false);
          }, { once: true });
        }, 0);
      });
      chooser.append(trigger, menu);
      wrap.append(chooser);
      return wrap;
    }

    function renderArtifactReviewWorkspace(context) {
      if (state.artifactReviewConflict) {
        const conflict = document.createElement("div");
        conflict.className = "artifact-review-message warn";
        conflict.textContent = state.artifactReviewConflict;
        const refresh = document.createElement("button");
        refresh.className = "btn";
        refresh.textContent = displayLanguage === "zh" ? "刷新当前轮次" : "Refresh round";
        refresh.addEventListener("click", async () => {
          await syncArtifactReviewContext(true);
          renderAll();
        });
        el.comments.append(conflict, refresh);
      }
      const selectedRoundId = state.artifactReviewHistoryRoundId || context.review.currentRoundId;
      const selectedRound = context.rounds.find(round => round.id === selectedRoundId)
        || context.rounds.find(round => round.id === context.review.currentRoundId);
      const viewingHistory = selectedRound?.id !== context.review.currentRoundId;
      if (viewingHistory) {
        renderArtifactReviewSubmittedOpinions(selectedRound);
        renderArtifactReviewRoundSummary(context, selectedRound, true);
        return;
      }

      const assignment = context.assignment;
      if (assignment.identityKind === "agent") {
        renderArtifactReviewAgentWorkspace(context, selectedRound);
        return;
      }
      const readOnly = assignment.status === "submitted" || context.review.status !== "pending";
      const controls = document.createElement("div");
      controls.className = "artifact-review-controls";
      controls.append(blockTitle(readOnly ? t("submitted") : t("myDraft")));
      controls.append(renderArtifactVoteControl(context, readOnly));
      if (!readOnly) controls.append(renderArtifactReviewCommentComposer(context));
      el.comments.append(controls);

      const draftComments = assignment.draft?.comments || [];
      if (draftComments.length) {
        for (const comment of draftComments) el.comments.append(renderArtifactReviewCommentCard(comment, artifactReviewRoleName(assignment), true));
      }
      renderArtifactReviewSubmittedOpinions(selectedRound);
      renderArtifactReviewRoundSummary(context, selectedRound, false);
    }

    function renderArtifactReviewAgentWorkspace(context, selectedRound) {
      const assignment = context.assignment;
      const attempt = assignment.attempts?.[assignment.attempts.length - 1];
      const status = document.createElement("div");
      status.className = "artifact-review-agent-status";
      status.append(blockTitle(t("agentReviewer")));
      const progress = document.createElement("div");
      progress.className = "artifact-review-message" + (assignment.status === "failed" ? " warn" : "");
      progress.textContent = artifactReviewAssignmentStatusLabel(assignment.status, "agent")
        + (attempt ? " · " + (attempt.provider || "Agent") + " · " + t("attempt") + " " + attempt.sequence : "");
      status.append(progress);
      if (attempt?.failure?.message) {
        const failure = document.createElement("div");
        failure.className = "muted artifact-review-id";
        failure.textContent = attempt.failure.code + ": " + attempt.failure.message;
        status.append(failure);
      }
      if (assignment.status === "failed" && context.review.status === "pending") {
        const retry = document.createElement("button");
        retry.className = "btn";
        retry.textContent = t("retry");
        retry.addEventListener("click", () => runButtonAction(retry, () => retryArtifactReviewAgent(context)));
        status.append(retry);
      }
      el.comments.append(status);
      for (const comment of assignment.draft?.comments || []) {
        el.comments.append(renderArtifactReviewCommentCard(comment, artifactReviewRoleName(assignment), false));
      }
      renderArtifactReviewSubmittedOpinions(selectedRound);
      renderArtifactReviewRoundSummary(context, selectedRound, false);
    }

    async function retryArtifactReviewAgent(context) {
      const response = await fetch(artifactReviewAssignmentUrl(context, "retry"), { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      state.artifactReviewContext = await response.json();
      await loadRuns();
      renderAll();
    }

    function renderArtifactReviewSubmittedOpinions(round) {
      const submitted = (round?.assignments || [])
        .filter(assignment => assignment.submitted)
        .map(assignment => ({ assignment, opinion: assignment.submitted }));
      if (submitted.length) {
        el.comments.append(blockTitle(t("submittedOpinions")));
        for (const entry of submitted) {
          const heading = document.createElement("div");
          heading.className = "artifact-review-message";
          heading.textContent = artifactReviewRoleName(entry.assignment) + " · "
            + (entry.assignment.binding === "decision" ? t("decisionVote") : t("advisoryVote")) + " · "
            + artifactReviewVoteLabel(entry.opinion.vote, entry.assignment.binding);
          el.comments.append(heading);
          for (const comment of entry.opinion.comments || []) {
            el.comments.append(renderArtifactReviewCommentCard(comment, artifactReviewRoleName(entry.assignment), false));
          }
        }
      }
    }

    function renderArtifactVoteControl(context, readOnly) {
      const group = document.createElement("div");
      group.className = "artifact-review-vote";
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-label", context.assignment.binding === "decision" ? t("decisionVote") : t("advisoryVote"));
      const current = context.assignment.submitted?.vote || context.assignment.draft?.vote;
      for (const value of ["approve", "request_changes", "abstain"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn" + (current === value ? " active" : "");
        button.textContent = artifactReviewVoteLabel(value, context.assignment.binding);
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", String(current === value));
        button.disabled = readOnly || state.artifactReviewSaving;
        button.addEventListener("click", () => saveArtifactReviewDraft({
          ...context.assignment.draft,
          vote: value
        }));
        group.append(button);
      }
      return group;
    }

    function renderArtifactReviewCommentComposer(context) {
      const wrap = document.createElement("div");
      wrap.className = "artifact-review-comment";
      const textarea = document.createElement("textarea");
      textarea.placeholder = displayLanguage === "zh" ? "补充整体评审意见" : "Add an overall review comment";
      textarea.disabled = state.artifactReviewSaving;
      const add = document.createElement("button");
      add.className = "btn";
      add.textContent = displayLanguage === "zh" ? "添加意见" : "Add comment";
      add.disabled = state.artifactReviewSaving;
      add.addEventListener("click", () => {
        const body = textarea.value.trim();
        if (!body) return textarea.focus();
        runButtonAction(add, async () => {
          await saveArtifactReviewDraft({
            ...context.assignment.draft,
            comments: context.assignment.draft.comments.concat({ id: uuid(), body })
          });
        });
      });
      wrap.append(textarea, add);
      return wrap;
    }

    function renderArtifactReviewCommentCard(comment, identityName, editable) {
      const card = document.createElement("article");
      card.className = "comment-card";
      const title = document.createElement("b");
      title.textContent = identityName + (comment.anchor?.target ? " · " + comment.anchor.target : "");
      const body = document.createElement("p");
      body.textContent = comment.body;
      card.append(title, body);
      if (comment.anchor?.location) {
        const go = document.createElement("button");
        go.className = "btn";
        go.textContent = displayLanguage === "zh" ? "定位" : "Go to";
        go.addEventListener("click", () => {
          const target = document.querySelector('[data-anchor="' + CSS.escape(comment.anchor.location) + '"]');
          if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
        });
        card.append(go);
      }
      if (editable) {
        const remove = document.createElement("button");
        remove.className = "btn danger";
        remove.textContent = displayLanguage === "zh" ? "删除" : "Remove";
        remove.addEventListener("click", () => runButtonAction(remove, () => removeComment(comment.id)));
        card.append(remove);
      }
      return card;
    }

    function renderArtifactReviewRoundSummary(context, round, history) {
      if (!round) return;
      el.comments.append(blockTitle(t("roundSummary")));
      const summary = document.createElement("div");
      summary.className = "artifact-review-message" + (round.status === "changes_requested" ? " warn" : "");
      const result = round.result;
      summary.textContent = result
        ? t("round") + " " + round.sequence + " · " + artifactReviewRoundStatusLabel(round.status)
          + " · " + result.decisionApprove + "/" + result.decisionTotal + " " + t("approve")
        : t("round") + " " + round.sequence + " · "
          + (round.assignments || []).filter(assignment => assignment.status === "submitted").length
          + "/" + (round.assignments || []).length + " " + t("submitted");
      el.comments.append(summary);
      if (history) {
        const id = document.createElement("div");
        id.className = "muted artifact-review-id";
        id.textContent = round.id;
        el.comments.append(id);
      }
      if (round.revisionSummary?.body) {
        el.comments.append(blockTitle(t("revisionSummary")));
        const revision = document.createElement("div");
        revision.className = "pre";
        revision.textContent = round.revisionSummary.body;
        el.comments.append(revision);
      }
    }

    function artifactReviewVoteLabel(value, binding) {
      if (value === "approve") return t("approve");
      if (value === "request_changes") return t("requestChanges");
      if (value === "abstain") return t("abstain");
      return t("draft");
    }

    function artifactReviewAssignmentStatusLabel(status, identityKind) {
      if (status === "submitted") return t("submitted");
      if (identityKind !== "agent") return t("draft");
      if (status === "queued") return t("queued");
      if (status === "running") return t("running");
      if (status === "failed") return t("failed");
      return status;
    }

    function artifactReviewRoundStatusLabel(status) {
      if (status === "passed") return t("passed");
      if (status === "changes_requested") return t("changesRequested");
      if (status === "awaiting_runner_vote") return t("awaitingRunnerVote");
      return t("pendingReview");
    }

    function scrollToComment(comment) {
      if (isArtifactReviewMode() && comment.anchor?.location) {
        const artifactTarget = document.querySelector('[data-anchor="' + CSS.escape(comment.anchor.location) + '"]');
        if (artifactTarget) artifactTarget.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      if (isCommentOutdated(comment)) return;
      const target = findCommentTarget(comment);
      if (target) {
        for (const section of target.closest(".content")?.querySelectorAll(".section") || []) {
          if (section.contains(target)) section.classList.add("open");
        }
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
      return !findCommentTarget(comment);
    }

    function findCommentTarget(comment) {
      const anchor = comment.location?.anchor || comment.target || "";
      const selector = '[data-anchor="' + CSS.escape(anchor) + '"], [data-legacy-anchor="' + CSS.escape(anchor) + '"]';
      const candidates = [...document.querySelectorAll(selector)];
      if (!comment.location?.hash) return candidates[0] || null;
      return candidates.find(node => {
        const snapshot = node.dataset.commentSnapshot ?? node.querySelector(".commentable-body")?.dataset.commentSnapshot;
        return snapshot !== undefined && hashSnapshot(snapshot) === comment.location.hash;
      }) || null;
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

    function readStoredObject(key) {
      try {
        const value = JSON.parse(localStorage.getItem(key) || "{}");
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
      } catch {
        return {};
      }
    }

    function writeStoredObject(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    }

    function uuid() {
      if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
      return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }
  </script>
</body>
</html>`;
