export function shouldRenderTaskStepArtifact(event: unknown): boolean {
  return Boolean(event);
}

export function shouldRenderMarkdownArtifact(artifact: { format?: string; renderedContent?: string } | undefined): boolean {
  return artifact?.format === "markdown" && typeof artifact.renderedContent === "string";
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
      --artifact-review-left: 58%;
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
    .brand { align-items: center; min-width: 0; }
    .brand-settings { display: inline-grid; place-items: center; flex: 0 0 34px; width: 34px; height: 34px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--muted); padding: 0; font-size: 20px; line-height: 1; }
    .brand-settings:hover { background: var(--soft); color: var(--text); }
    .brand-settings:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .brand-settings.active { border-color: #b8cbc7; background: var(--accent-soft); color: #173f3c; font-weight: 700; }
    .project-switcher { display: grid; gap: 6px; min-width: 0; margin-top: 14px; }
    .project-label { color: var(--muted); font-size: 11px; font-weight: 700; }
    .project-select-wrap { position: relative; min-width: 0; }
    .project-select { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; width: 100%; min-width: 0; height: 38px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); padding: 0 10px; outline: none; text-align: left; }
    .project-select:hover { border-color: #b8cbc7; background: #f7f8f4; }
    .project-select:focus-visible, .project-select[aria-expanded="true"] { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(40, 108, 103, .12); }
    .project-select-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .project-select-caret { width: 7px; height: 7px; border-right: 1.5px solid var(--muted); border-bottom: 1.5px solid var(--muted); transform: rotate(45deg) translate(-1px, 1px); transform-origin: center; transition: transform 120ms ease; }
    .project-select[aria-expanded="true"] .project-select-caret { transform: rotate(225deg) translate(-1px, 1px); }
    .project-select-menu { position: absolute; z-index: 30; top: calc(100% + 4px); right: 0; left: 0; max-height: 240px; overflow-y: auto; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); box-shadow: var(--shadow); padding: 4px; }
    .project-select-menu[hidden] { display: none; }
    .project-select-option { display: block; width: 100%; border: 0; border-radius: 4px; background: transparent; color: var(--text); padding: 8px; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
    .project-select-option:hover, .project-select-option:focus-visible { background: var(--soft); outline: none; }
    .project-select-option[aria-selected="true"] { background: var(--accent-soft); color: #173f3c; font-weight: 700; }
    .review-actions { display: flex; gap: 8px; align-items: flex-start; }
    .review-toggle, .review-close { display: inline-flex; }
    .review-toggle[hidden] { display: none; }
    .brand h1, .review-head h2, .title { margin: 0; letter-spacing: 0; }
    .brand h1 { font-size: 18px; }
    .view-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-top: 14px; }
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
    .memory-button, .review-card, .task-card { width: 100%; text-align: left; border: 0; border-radius: 6px; background: transparent; color: var(--text); padding: 8px 9px; }
    .memory-button:hover, .review-card:hover, .task-card:hover { background: #eceee8; }
    .memory-button.active, .review-card.active, .task-card.active { background: var(--accent-soft); color: #173f3c; font-weight: 700; }
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
    .title { font-size: 26px; line-height: 1.2; overflow-wrap: anywhere; }
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
    .pill { max-width: 100%; overflow-wrap: anywhere; border: 1px solid var(--line); background: var(--surface); color: var(--muted); border-radius: 999px; padding: 3px 8px; font-size: 12px; }
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
    html.artifact-review-modal-open, body.artifact-review-modal-open { overflow: hidden; overscroll-behavior: none; }
    body.artifact-review-modal-open .content .target-add, body.artifact-review-modal-open .content .inline-plus { display: none !important; }
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
    .run-binding-list { display: grid; gap: 10px; }
    .run-binding-row { border: 1px solid var(--line); border-radius: 7px; padding: 10px; display: grid; gap: 8px; }
    .run-binding-head, .run-binding-actions, .run-binding-actors { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .run-binding-head { justify-content: space-between; }
    .run-binding-actor { display: inline-flex; gap: 5px; align-items: center; }
    .run-binding-history { margin: 8px 0 0; padding-left: 18px; color: var(--muted); }
    .task-step { border-left: 4px solid var(--accent); }
    .task-step-spotlight { animation: taskStepSpotlight 1600ms ease-out; box-shadow: 0 0 0 3px rgba(40, 108, 103, .18), var(--shadow); }
    .task-result { margin-top: 8px; }
    .task-result .pre { margin-top: 6px; }
    .schema-writing { margin-top: 10px; border-top: 1px solid var(--line); padding-top: 2px; }
    .schema-writing-progress { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .schema-writing-source { margin-top: 10px; padding-left: 12px; border-left: 2px solid var(--line); }
    .schema-writing-source .text-list { margin-top: 4px; }
    .schema-draft-preview { margin-top: 10px; }
    .schema-draft-preview > summary { cursor: pointer; color: var(--accent); font-weight: 700; }
    .schema-draft-path { margin-top: 7px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
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
    .artifact-review-comment-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 6px; }
    .artifact-review-comment-head > b { min-width: 0; }
    .artifact-review-comment-head > .pill { flex: 0 0 auto; }
    .artifact-review-markdown { overflow-wrap: anywhere; }
    .artifact-review-markdown > :first-child { margin-top: 0; }
    .artifact-review-markdown > :last-child { margin-bottom: 0; }
    .artifact-review-markdown p { margin: 6px 0 8px; }
    .artifact-review-markdown ul, .artifact-review-markdown ol { margin: 6px 0 8px; padding-left: 22px; }
    .artifact-review-markdown code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: 12px; background: #e9ece6; border: 1px solid var(--line); border-radius: 4px; padding: 1px 4px; }
    .artifact-review-markdown pre { overflow-x: hidden; background: #e9ece6; border: 1px solid var(--line); border-radius: 6px; padding: 9px 10px; }
    .artifact-review-markdown pre code { background: none; border: 0; padding: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
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
    .artifact-review-panel { display: grid; gap: 10px; align-content: start; }
    .artifact-review-panel > h3 { margin: 0; font-size: 15px; letter-spacing: 0; }
    .artifact-review-panel-content { min-width: 0; display: grid; gap: 10px; }
    .artifact-review-operation-group { min-width: 0; display: grid; gap: 8px; padding-top: 12px; border-top: 1px solid var(--line); }
    .artifact-review-operation-group:first-child { padding-top: 0; border-top: 0; }
    .artifact-review-operation-group h4 { margin: 0; font-size: 13px; letter-spacing: 0; }
    .artifact-review-operation-help { margin: 0; color: var(--muted); font-size: 12px; }
    .artifact-review-submit-area .btn { justify-self: stretch; }
    .artifact-review-grid { display: grid; gap: 8px; }
    .artifact-review-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line); }
    .artifact-review-row:last-child { border-bottom: 0; }
    .artifact-review-row-main { min-width: 0; display: grid; gap: 3px; }
    .artifact-review-participant-link { width: fit-content; max-width: 100%; border: 0; padding: 0; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 3px; }
    .artifact-review-participant-link:hover, .artifact-review-participant-link:focus-visible { color: var(--accent); text-decoration-color: currentColor; outline: 0; }
    .artifact-review-controls { display: grid; gap: 8px; }
    .artifact-review-time-range { display: grid; gap: 4px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
    .artifact-review-time-value { font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .artifact-review-select { width: 100%; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); padding: 8px 9px; }
    .artifact-review-round-select { position: relative; min-width: 0; }
    .artifact-review-severity-select { width: 100%; }
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
    .artifact-review-opinion { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); scroll-margin-top: 16px; transition: background 140ms ease, box-shadow 140ms ease; }
    .artifact-review-opinion-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
    .artifact-review-opinion-head time { flex: 0 0 auto; font-size: 12px; font-variant-numeric: tabular-nums; }
    .artifact-review-opinion .block-title { margin-top: 2px; }
    .artifact-review-opinion-located { background: #edf6f3; box-shadow: 0 0 0 3px rgba(40, 108, 103, .2); }
    .artifact-review-comment { display: grid; gap: 6px; }
    .artifact-review-candidate { border-left-color: var(--accent); }
    .artifact-review-candidate .section-body { display: block; }
    .artifact-review-progress { font-variant-numeric: tabular-nums; }
    .artifact-review-agent-status { display: grid; gap: 8px; }
    .artifact-review-agent-status .btn { justify-self: start; }
    .artifact-review-agent-summary { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .artifact-review-agent-summary-row { min-width: 0; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; }
    .artifact-review-activity-toggle { flex: 0 0 auto; border: 0; padding: 0; background: transparent; color: var(--accent); font: inherit; font-size: 12px; cursor: pointer; }
    .artifact-review-activity-toggle:hover, .artifact-review-activity-toggle:focus-visible { text-decoration: underline; text-underline-offset: 2px; }
    .artifact-review-activity { grid-column: 1 / -1; min-width: 0; display: grid; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 6px; background: #fbfbf8; }
    .artifact-review-activity-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
    .artifact-review-attempt-select { width: min(100%, 260px); }
    .artifact-review-activity-log { min-width: 0; max-height: 300px; overflow-x: hidden; overflow-y: auto; display: grid; gap: 6px; padding-right: 2px; overscroll-behavior: contain; }
    .artifact-review-activity-event { min-width: 0; display: grid; gap: 3px; padding: 7px 8px; border-left: 3px solid var(--line); background: var(--surface); overflow-wrap: anywhere; }
    .artifact-review-activity-event[data-kind="tool"] { border-left-color: var(--accent); }
    .artifact-review-activity-event[data-kind="plan"] { border-left-color: var(--warn); }
    .artifact-review-activity-event-head { min-width: 0; display: flex; flex-wrap: nowrap; gap: 8px; justify-content: space-between; align-items: center; }
    .artifact-review-activity-event-head time { flex: 0 0 auto; white-space: nowrap; }
    .artifact-review-activity-event-title { min-width: 0; display: block; overflow-wrap: anywhere; }
    .artifact-review-activity-kind { flex: 0 0 auto; }
    .artifact-review-activity-event-body { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .artifact-review-activity-locations { white-space: normal; overflow-wrap: anywhere; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .artifact-review-activity-plan { margin: 2px 0 0; padding-left: 20px; }
    .artifact-review-id { overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
    dialog.artifact-review-dialog { width: min(460px, calc(100vw - 32px)); border: 1px solid var(--line); border-radius: 8px; padding: 0; color: var(--text); box-shadow: 0 20px 60px rgba(25, 30, 35, .24); }
    dialog.artifact-review-dialog::backdrop { background: rgba(22, 28, 30, .34); }
    .artifact-review-dialog-body { padding: 18px; display: grid; gap: 12px; }
    .artifact-review-dialog-body h3 { margin: 0; font-size: 18px; }
    .artifact-review-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
    dialog.artifact-review-modal { width: 90vw; max-width: none; height: 90dvh; max-height: none; margin: auto; border: 1px solid var(--line); border-radius: 8px; padding: 0; color: var(--text); background: var(--bg); box-shadow: 0 24px 80px rgba(25, 30, 35, .28); overflow: hidden; overscroll-behavior: none; }
    dialog.artifact-review-modal::backdrop { background: rgba(22, 28, 30, .42); }
    .artifact-review-modal-shell { height: 100%; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); }
    .artifact-review-modal-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; padding: 16px 18px; border-bottom: 1px solid var(--line); background: var(--surface); }
    .artifact-review-modal-head h2 { margin: 0; font-size: 20px; letter-spacing: 0; }
    .artifact-review-modal-heading { min-width: 0; display: grid; gap: 5px; }
    .artifact-review-modal-subtitle { color: var(--muted); overflow-wrap: anywhere; }
    .artifact-review-modal-body { min-height: 0; display: grid; grid-template-columns: minmax(320px, var(--artifact-review-left)) 8px minmax(320px, 1fr); }
    .artifact-review-modal-pane { min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; padding: 16px 18px 28px; }
    .artifact-review-modal-pane > *, .artifact-review-modal-pane .panel, .artifact-review-modal-pane .section, .artifact-review-modal-pane .task-result { min-width: 0; max-width: 100%; }
    .artifact-review-modal-pane .markdown-body pre { overflow-x: hidden; white-space: pre-wrap; overflow-wrap: anywhere; }
    .artifact-review-modal-pane .markdown-body pre code { white-space: inherit; overflow-wrap: inherit; }
    .artifact-review-modal-pane.review-pane { display: grid; gap: 12px; align-content: start; background: #fbfbf8; }
    .artifact-review-modal-resizer { position: relative; min-width: 8px; background: #fbfbf8; cursor: col-resize; touch-action: none; outline: none; }
    .artifact-review-modal-resizer::before { content: ""; position: absolute; inset: 0 auto 0 3px; width: 1px; background: var(--line); }
    .artifact-review-modal-resizer:hover::before, .artifact-review-modal-resizer:focus-visible::before, body.artifact-review-resizing .artifact-review-modal-resizer::before { width: 2px; background: var(--accent); }
    .artifact-review-mobile-tabs { display: none; }
    .artifact-review-artifact-head { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; margin-bottom: 10px; }
    .artifact-review-artifact-heading { min-width: 0; display: grid; gap: 8px; width: min(100%, 520px); }
    .artifact-review-artifact-head h3 { margin: 0; font-size: 16px; }
    .artifact-review-material-select { width: min(100%, 520px); }
    .artifact-review-artifact-content { min-width: 0; }
    .artifact-review-artifact-content .commentable { margin-block: 0; }
    .artifact-review-artifact-content .commentable-body { white-space: normal; }
    .artifact-review-artifact-content .markdown-body > .commentable:first-child .commentable-body > :first-child { margin-top: 0; }
    .artifact-review-artifact-content .markdown-body > .commentable:last-child .commentable-body > :last-child { margin-bottom: 0; }
    .artifact-review-target { border-radius: 6px; transition: background 140ms ease, box-shadow 140ms ease; }
    .artifact-review-target-located { background: #edf6f3; box-shadow: 0 0 0 3px rgba(40, 108, 103, .2); }
    .artifact-review-locate-failure { margin-bottom: 10px; }
    .artifact-review-comment-context { margin-top: 7px; padding: 7px 8px; border-left: 2px solid var(--line); color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
    .settings-nav { display: grid; gap: 10px; margin-top: 18px; }
    .settings-nav-group { overflow: hidden; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
    .settings-nav-group.active { border-color: #b8cbc7; }
    .settings-nav-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; width: 100%; border: 0; border-radius: 0; background: var(--soft); color: var(--muted); padding: 9px 10px; font-size: 11px; font-weight: 700; overflow-wrap: anywhere; text-align: left; text-transform: uppercase; }
    .settings-nav-heading:hover { background: #eceee8; color: var(--text); }
    .settings-nav-heading:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .settings-nav-group.active .settings-nav-heading { color: #173f3c; }
    .settings-nav-caret { width: 7px; height: 7px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg) translate(-1px, 1px); transform-origin: center; transition: transform 120ms ease; }
    .settings-nav-heading[aria-expanded="true"] .settings-nav-caret { transform: rotate(225deg) translate(-1px, 1px); }
    .settings-nav-items { display: grid; gap: 2px; padding: 4px; }
    .settings-nav-items[hidden] { display: none; }
    .settings-nav .memory-button { font-weight: 600; }
    .settings-layout { display: grid; gap: 16px; max-width: 1120px; }
    .settings-status { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .settings-section { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow); padding: 18px; }
    .settings-section h3 { margin: 0; font-size: 17px; }
    .settings-section > h3 { margin-bottom: 14px; }
    .settings-section h4 { margin: 18px 0 8px; font-size: 14px; }
    .settings-section-head { display: flex; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 14px; }
    .settings-section-subtitle { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
    .settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 16px; }
    .settings-compact-grid { grid-template-columns: repeat(auto-fit, minmax(240px, 360px)); justify-content: start; }
    .settings-compact-grid > .settings-field:not(.wide) { width: 100%; max-width: 360px; }
    .settings-compact-grid > .settings-field.wide { grid-column: 1 / -1; }
    .settings-participant-basic { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .settings-field { display: grid; gap: 6px; min-width: 0; }
    .settings-path-field { align-content: start; }
    .settings-path-field > .settings-field { grid-template-rows: auto auto minmax(34px, auto); }
    .settings-field.wide { grid-column: 1 / -1; }
    .settings-field > label, .settings-label { color: #4f5a5c; font-size: 12px; font-weight: 700; }
    .settings-input, .settings-select { width: 100%; min-width: 0; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); padding: 8px 10px; outline: none; }
    .settings-input:focus, .settings-select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(40, 108, 103, .12); }
    .settings-input:disabled { border-style: dashed; background: var(--soft); color: var(--muted); cursor: not-allowed; opacity: 1; }
    .settings-select-wrap { position: relative; min-width: 0; }
    .settings-select-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; cursor: pointer; }
    .settings-select-trigger[aria-expanded="true"] { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(40, 108, 103, .12); }
    .settings-select-caret { flex: 0 0 auto; color: var(--muted); font-size: 13px; line-height: 1; }
    .settings-select-menu { position: absolute; top: calc(100% + 4px); right: 0; left: 0; z-index: 40; display: grid; gap: 2px; max-height: 240px; overflow-y: auto; padding: 4px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); box-shadow: 0 10px 28px rgba(25, 30, 35, .16); }
    .settings-select-menu[hidden] { display: none; }
    .settings-select-option { width: 100%; border: 0; border-radius: 4px; background: transparent; color: var(--text); padding: 7px 8px; text-align: left; cursor: pointer; }
    .settings-select-option:hover, .settings-select-option:focus-visible { outline: 0; background: var(--soft); }
    .settings-select-option[aria-selected="true"] { background: var(--accent-soft); color: #173f3c; }
    .settings-check { display: flex; gap: 8px; align-items: flex-start; color: var(--text); }
    .settings-check input { width: 16px; height: 16px; margin-top: 2px; accent-color: var(--accent); }
    .settings-default-toggle { margin-top: 14px; }
    .settings-help, .settings-error { font-size: 12px; overflow-wrap: anywhere; }
    .settings-help { color: var(--muted); }
    .settings-error { color: var(--danger); }
    .settings-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .settings-participants { border-top: 1px solid var(--line); }
    .settings-providers { border-top: 1px solid var(--line); }
    .settings-provider-status { display: flex; gap: 7px; align-items: center; flex-wrap: wrap; }
    .settings-provider-preview { margin: 12px 0 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--code); overflow-wrap: anywhere; }
    .settings-participant { border-bottom: 1px solid var(--line); }
    .settings-provider { border-bottom: 1px solid var(--line); }
    .settings-participant > summary { list-style: none; }
    .settings-participant > summary::-webkit-details-marker { display: none; }
    .settings-participant-summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; min-height: 58px; padding: 10px 4px; cursor: pointer; }
    .settings-participant-summary:hover { background: #f7f8f5; }
    .settings-participant-summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .settings-participant-summary::after { content: "›"; color: var(--muted); font-size: 20px; transform: rotate(90deg); transition: transform 120ms ease; }
    .settings-participant[open] .settings-participant-summary::after { transform: rotate(-90deg); }
    .settings-participant-summary-main { min-width: 0; display: grid; gap: 5px; }
    .settings-participant-summary-meta { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .settings-participant-body { padding: 2px 4px 18px; }
    .settings-participant-actions { display: flex; justify-content: flex-end; margin-bottom: 10px; }
    .settings-participant-title { display: flex; gap: 8px; align-items: center; min-width: 0; }
    .settings-permissions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 14px; margin-top: 8px; }
    .settings-permission { border-left: 2px solid var(--line); padding-left: 9px; }
    .settings-permission .settings-check { font-weight: 600; }
    .settings-permission p { margin: 3px 0 0 24px; color: var(--muted); font-size: 12px; }
    .settings-code { width: 100%; max-width: 100%; max-height: 440px; overflow: auto; white-space: pre; background: #f3f5f0; border: 1px solid var(--line); border-radius: 6px; padding: 12px; }
    .settings-field > .mono { white-space: normal; overflow-wrap: anywhere; }
    .settings-change-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .settings-change-list li { border-left: 3px solid var(--accent); padding: 7px 10px; background: #f3f5f0; overflow-wrap: anywhere; }
    .settings-token { max-width: 520px; }
    body.settings-mode .view-tabs, body.settings-mode .search, body.settings-mode #expand, body.settings-mode #collapse, body.settings-mode #review-toggle { display: none; }
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
      dialog.artifact-review-modal { width: 100vw; height: 100dvh; max-height: none; border: 0; border-radius: 0; }
      .artifact-review-modal-head { padding: 12px 14px; }
      .artifact-review-modal-body { display: block; }
      .artifact-review-modal-resizer { display: none; }
      .artifact-review-mobile-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--surface); }
      .artifact-review-modal-shell { grid-template-rows: auto auto minmax(0, 1fr); }
      .artifact-review-modal-pane { height: 100%; padding: 14px 14px 24px; }
      .artifact-review-modal[data-mobile-pane="artifact"] .review-pane { display: none; }
      .artifact-review-modal[data-mobile-pane="review"] .artifact-pane { display: none; }
      .settings-grid, .settings-compact-grid, .settings-participant-basic, .settings-permissions { grid-template-columns: minmax(0, 1fr); }
      .settings-section { padding: 14px; }
      .settings-section-head { align-items: flex-start; }
      .settings-participant-summary { grid-template-columns: minmax(0, 1fr) auto; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <aside class="sidebar">
      <div class="brand">
        <h1>memsphere</h1>
        <button class="brand-settings" id="settings-tab" type="button" aria-label="设置" title="设置">&#9881;</button>
      </div>
      <div class="project-switcher">
        <span class="project-label" id="project-select-label">Project</span>
        <div class="project-select-wrap">
          <button id="project-select" class="project-select" type="button" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="project-select-label project-select-value">
            <span class="project-select-value" id="project-select-value">Loading</span>
            <span class="project-select-caret" aria-hidden="true"></span>
          </button>
          <div id="project-select-menu" class="project-select-menu" role="listbox" aria-labelledby="project-select-label" hidden></div>
        </div>
      </div>
      <span class="count" id="count">Loading</span>
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

  <dialog class="artifact-review-modal" id="artifact-review-modal" aria-labelledby="artifact-review-modal-title">
    <div class="artifact-review-modal-shell">
      <header class="artifact-review-modal-head">
        <div class="artifact-review-modal-heading">
          <h2 id="artifact-review-modal-title">Artifact Review</h2>
          <div class="artifact-review-modal-subtitle" id="artifact-review-modal-subtitle"></div>
        </div>
        <button class="btn" id="artifact-review-modal-close" type="button">Close</button>
      </header>
      <div class="artifact-review-mobile-tabs" id="artifact-review-mobile-tabs">
        <button class="view-tab active" id="artifact-review-artifact-tab" type="button">Artifact</button>
        <button class="view-tab" id="artifact-review-review-tab" type="button">Review</button>
      </div>
      <div class="artifact-review-modal-body">
        <section class="artifact-review-modal-pane artifact-pane" id="artifact-review-artifact-pane">
          <div class="artifact-review-artifact-head"><div class="artifact-review-artifact-heading"><h3 id="artifact-review-artifact-title">Artifact</h3><div id="artifact-review-material-selector"></div></div></div>
          <div id="artifact-review-artifact-content" class="artifact-review-artifact-content"></div>
        </section>
        <div class="artifact-review-modal-resizer" id="artifact-review-modal-resizer" role="separator" aria-controls="artifact-review-artifact-pane artifact-review-review-pane" aria-orientation="vertical" aria-valuemin="30" aria-valuemax="75" aria-valuenow="58" tabindex="0"></div>
        <aside class="artifact-review-modal-pane review-pane" id="artifact-review-review-pane">
          <section class="panel artifact-review-panel" id="artifact-review-scope-panel">
            <h3 id="artifact-review-scope-title">Review scope</h3>
            <div id="artifact-review-modal-controls" class="artifact-review-panel-content"></div>
          </section>
          <section class="panel artifact-review-panel" id="artifact-review-my-panel">
            <h3 id="artifact-review-my-title">My review</h3>
            <div class="muted" id="artifact-review-comment-summary"></div>
            <div id="artifact-review-my-content" class="artifact-review-panel-content"></div>
            <div id="artifact-review-submit-area" class="artifact-review-operation-group artifact-review-submit-area">
              <h4 id="artifact-review-submit-title">Submit review</h4>
              <p class="artifact-review-operation-help" id="artifact-review-submit-summary"></p>
              <button class="btn primary" id="artifact-review-submit">Submit review</button>
            </div>
          </section>
          <section class="panel artifact-review-panel" id="artifact-review-progress-panel">
            <h3 id="artifact-review-progress-title">Participation progress</h3>
            <div id="artifact-review-progress-content" class="artifact-review-panel-content"></div>
          </section>
          <section class="panel artifact-review-panel" id="artifact-review-record-panel">
            <h3 id="artifact-review-record-title">Review record</h3>
            <div id="artifact-review-modal-comments" class="comment-list"></div>
          </section>
        </aside>
      </div>
    </div>
  </dialog>

  <script>
    const kindOrder = ["procedures", "schemas", "concepts", "statements"];
    const selectedReviewKey = "memsphere.selectedReview.v2";
    const selectedTaskKey = "memsphere.selectedTask.v1";
    const viewModeKey = "memsphere.viewMode.v1";
    const displayLanguageKey = "memsphere.displayLanguage.v1";
    const hideSystemMemoriesKey = "memsphere.hideSystemMemories.v1";
    const artifactReviewIdentityKey = "memsphere.artifactReviewIdentity.v1";
    const artifactReviewOpenedKey = "memsphere.artifactReviewOpened.v1";
    const artifactReviewSelectedKey = "memsphere.artifactReviewSelected.v1";
    const artifactReviewRoundKey = "memsphere.artifactReviewRound.v1";
    const artifactReviewMobilePaneKey = "memsphere.artifactReviewMobilePane.v1";
    const artifactReviewSplitKey = "memsphere.artifactReviewSplit.v1";
    const reviewPanelWidthKey = "memsphere.reviewPanelWidth.v1";
    const settingsTokenKey = "memsphere.settingsToken.v1";
    const settingsRouteDestinations = {
      overview: { scope: "global", module: "overview" },
      general: { scope: "global", module: "general" },
      view: { scope: "global", module: "view" },
      providers: { scope: "global", module: "providers" },
      project: { scope: "project", module: "overview" },
      participants: { scope: "project", module: "participants" }
    };
    const initialBrowserRoute = parseBrowserRoute(window.location);
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
      procedureName: { zh: "流程", yaml: "Procedure" },
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
      schemaWriting: { zh: "图式写作", yaml: "Schema writing" },
      schemaProgress: { zh: "字段进度", yaml: "Field progress" },
      managedDraft: { zh: "累计草稿", yaml: "Managed draft" },
      globalAdjustment: { zh: "等待全局调整", yaml: "Awaiting global adjustment" },
      contractValidation: { zh: "结构与契约校验", yaml: "Contract validation" },
      remaining: { zh: "剩余", yaml: "remaining" },
      constraintSource: { zh: "约束来源", yaml: "Constraint source" },
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
      reviewArtifact: { zh: "评审产物", yaml: "Reviewed artifact" },
      artifactPane: { zh: "产物", yaml: "Artifact" },
      reviewPane: { zh: "评审", yaml: "Review" },
      close: { zh: "关闭", yaml: "Close" },
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
      reviewComments: { zh: "评审意见", yaml: "Review comments" },
      voteSummary: { zh: "投票摘要", yaml: "Vote summary" },
      noReviewComments: { zh: "无单独评审意见", yaml: "No separate review comments" },
      reviewTime: { zh: "评审时间", yaml: "Review time" },
      inProgress: { zh: "进行中", yaml: "In progress" },
      automatic: { zh: "自动", yaml: "Automatic" },
      runner: { zh: "执行者", yaml: "Runner" },
      round: { zh: "轮次", yaml: "Round" },
      revisionSummary: { zh: "修改摘要", yaml: "Revision summary" },
      selectIdentity: { zh: "请选择评审身份", yaml: "Select a review identity" },
      resizeReview: { zh: "调整产物与评审区域宽度", yaml: "Resize artifact and review panels" },
      resetReviewWidth: { zh: "双击恢复默认宽度", yaml: "Double-click to reset width" },
      submitted: { zh: "已提交", yaml: "Submitted" },
      draft: { zh: "草稿", yaml: "Draft" },
      passed: { zh: "已通过", yaml: "Passed" },
      changesRequested: { zh: "需修改", yaml: "Changes requested" },
      awaitingRunnerVote: { zh: "等待执行者投票", yaml: "Awaiting Runner vote" },
      pendingVote: { zh: "待投票", yaml: "Pending vote" },
      agentReviewer: { zh: "Agent 评审", yaml: "Agent reviewer" },
      queued: { zh: "等待启动", yaml: "Queued" },
      running: { zh: "评审中", yaml: "Running" },
      failed: { zh: "执行失败", yaml: "Failed" },
      retry: { zh: "重试", yaml: "Retry" },
      attempt: { zh: "尝试", yaml: "Attempt" }
    };
    const state = {
      viewMode: routeViewMode(initialBrowserRoute),
      lastContentViewMode: ["task", "artifact-review"].includes(initialBrowserRoute.page)
        ? "task"
        : localStorage.getItem(viewModeKey) === "task" ? "task" : "memory",
      payload: null,
      memories: [],
      actorNames: {},
      filtered: [],
      hideSystemMemories: localStorage.getItem(hideSystemMemoriesKey) !== "false",
      selectedId: initialBrowserRoute.page === "memory"
        ? initialBrowserRoute.kind + "/" + initialBrowserRoute.name
        : null,
      selectedTaskId: initialBrowserRoute.runId || localStorage.getItem(selectedTaskKey) || null,
      selectedReviewId: initialBrowserRoute.page === "memory-review"
        ? initialBrowserRoute.reviewId
        : localStorage.getItem(selectedReviewKey) || null,
      byName: new Map(),
      reviews: [],
      runs: [],
      memoryDetails: new Map(),
      reviewDetails: new Map(),
      runDetails: new Map(),
      pageLoadGeneration: 0,
      projectGeneration: 0,
      artifactReviewContext: null,
      artifactReviewLoading: false,
      artifactReviewSaving: false,
      artifactReviewRequest: 0,
      artifactReviewConflict: "",
      artifactReviewDrafts: {},
      artifactReviewRetries: {},
      artifactReviewActivities: {},
      artifactReviewMaterialBySubmission: {},
      inlineCommentDraft: null,
      taskPollingRenderPending: false,
      artifactReviewHistoryRoundId: null,
      artifactReviewIdentityByReview: readStoredObject(artifactReviewIdentityKey),
      artifactReviewOpenedRounds: readStoredObject(artifactReviewOpenedKey),
      artifactReviewSelectedByRun: readStoredObject(artifactReviewSelectedKey),
      artifactReviewRoundByReview: readStoredObject(artifactReviewRoundKey),
      artifactReviewModalOpen: initialBrowserRoute.page === "artifact-review",
      artifactReviewMobilePane: localStorage.getItem(artifactReviewMobilePaneKey) === "review" ? "review" : "artifact",
      artifactReviewSplit: Number.parseFloat(localStorage.getItem(artifactReviewSplitKey) || "") || 58,
      artifactReviewLocateFailure: "",
      artifactReviewOpenSelect: "",
      artifactReviewReturnScrollY: null,
      artifactReviewReturnFocus: "",
      artifactReviewReturnFocusTop: null,
      reviewSnapshots: new Map(),
      loadingSnapshots: new Set(),
      reviewDrawerOpen: initialBrowserRoute.page === "memory-review",
      reviewPanelWidth: Number.parseFloat(localStorage.getItem(reviewPanelWidthKey) || "") || 380,
      settingsMeta: null,
      settingsScope: initialBrowserRoute.settings?.scope || "global",
      settingsModules: { global: "overview", project: "overview" },
      settingsScopes: {
        global: { data: null, draft: null, errors: [], confirm: null, notice: "", loading: false },
        project: { data: null, draft: null, errors: [], confirm: null, notice: "", loading: false }
      },
      settingsData: null,
      settingsDraft: null,
      settingsErrors: [],
      settingsModule: initialBrowserRoute.settings?.module || "overview",
      settingsConfirm: null,
      settingsLoading: false,
      settingsNotice: "",
      settingsToken: sessionStorage.getItem(settingsTokenKey) || "",
      settingsTokenError: "",
      settingsExpandedParticipants: [],
      settingsExpandedProviders: [],
      settingsProviderDetection: {},
      settingsProviderDetecting: false,
      settingsProviderAutoDetectionAttemptedRevision: "",
      renderLine: 0,
      projects: [],
      currentProject: "",
      settingsNavExpanded: { global: true, project: true },
      routeReady: false,
      routeApplying: false,
      routeReplaceNext: true,
      routeError: "",
      pendingRoute: initialBrowserRoute,
      pendingArtifactMaterial: initialBrowserRoute.material || "",
      pendingFragment: initialBrowserRoute.fragment || "",
      routeLanding: ["root", "memories"].includes(initialBrowserRoute.page)
        ? "memories"
        : initialBrowserRoute.page === "tasks" ? "tasks" : ""
    };

    state.settingsModules[state.settingsScope] = state.settingsModule;
    if (initialBrowserRoute.page === "artifact-review") {
      state.artifactReviewSelectedByRun[initialBrowserRoute.runId] = initialBrowserRoute.reviewId;
      if (initialBrowserRoute.roundId) {
        state.artifactReviewRoundByReview[initialBrowserRoute.reviewId] = initialBrowserRoute.roundId;
      }
    }

    function parseBrowserRoute(locationLike) {
      const pathname = locationLike.pathname || "/";
      const parts = pathname.split("/").filter(Boolean);
      const search = new URLSearchParams(locationLike.search || "");
      const fragment = locationLike.hash || "";
      const decoded = value => {
        try {
          return decodeURIComponent(value);
        } catch {
          return null;
        }
      };
      if (pathname === "/") return { page: "root", fragment };
      if (pathname === "/memories") return { page: "memories", fragment };
      if (parts[0] === "memories" && parts.length === 3) {
        const kind = decoded(parts[1]);
        const name = decoded(parts[2]);
        return kind && name
          ? { page: "memory", kind, name, fragment }
          : { page: "invalid", mode: "memory", error: "Invalid Memory URL.", fragment };
      }
      if (pathname === "/tasks") return { page: "tasks", fragment };
      if (parts[0] === "tasks" && parts.length === 2) {
        const runId = decoded(parts[1]);
        return runId
          ? { page: "task", runId, fragment }
          : { page: "invalid", mode: "task", error: "Invalid Task URL.", fragment };
      }
      if (parts[0] === "tasks" && parts[2] === "artifact-reviews" && parts.length === 4) {
        const runId = decoded(parts[1]);
        const reviewId = decoded(parts[3]);
        return runId && reviewId
          ? {
              page: "artifact-review",
              runId,
              reviewId,
              roundId: search.get("round") || "",
              material: search.get("material") || "",
              fragment
            }
          : { page: "invalid", mode: "task", error: "Invalid Artifact Review URL.", fragment };
      }
      if (parts[0] === "settings" && parts.length === 2) {
        const moduleName = decoded(parts[1]);
        const settings = moduleName ? settingsRouteDestinations[moduleName] : null;
        return settings
          ? { page: "settings", publicModule: moduleName, settings, fragment }
          : { page: "invalid", mode: "settings", error: "Settings page not found: " + (moduleName || parts[1]), fragment };
      }
      if (
        parts[0] === "projects"
        && parts[2] === "memories"
        && parts[5] === "reviews"
        && parts.length === 7
      ) {
        const project = decoded(parts[1]);
        const kind = decoded(parts[3]);
        const name = decoded(parts[4]);
        const reviewId = decoded(parts[6]);
        return project && kind && name && reviewId
          ? { page: "memory-review", project, kind, name, reviewId, fragment }
          : { page: "invalid", mode: "memory", error: "Invalid Memory Review URL.", fragment };
      }
      return { page: "invalid", mode: "memory", error: "Page not found: " + pathname, fragment };
    }

    function routeViewMode(route) {
      if (route.page === "settings" || route.mode === "settings") return "settings";
      if (["tasks", "task", "artifact-review"].includes(route.page) || route.mode === "task") return "task";
      if (["root", "memories", "memory", "memory-review"].includes(route.page)) return "memory";
      const stored = localStorage.getItem(viewModeKey);
      return ["memory", "task", "settings"].includes(stored) ? stored : "memory";
    }

    function encodeRoutePart(value) {
      return encodeURIComponent(String(value || ""));
    }

    function t(key) {
      return vocabulary[key]?.[displayLanguage] || key;
    }

    function artifactReviewImplementationEvidenceLabel(referenced) {
      if (displayLanguage === "zh") return "实现证据：" + (referenced ? "已引用" : "未引用");
      return "Implementation evidence: " + (referenced ? "referenced" : "not referenced");
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
      artifactReviewModal: document.getElementById("artifact-review-modal"),
      artifactReviewModalTitle: document.getElementById("artifact-review-modal-title"),
      artifactReviewModalSubtitle: document.getElementById("artifact-review-modal-subtitle"),
      artifactReviewModalClose: document.getElementById("artifact-review-modal-close"),
      artifactReviewModalControls: document.getElementById("artifact-review-modal-controls"),
      artifactReviewMyContent: document.getElementById("artifact-review-my-content"),
      artifactReviewProgressContent: document.getElementById("artifact-review-progress-content"),
      artifactReviewModalComments: document.getElementById("artifact-review-modal-comments"),
      artifactReviewScopeTitle: document.getElementById("artifact-review-scope-title"),
      artifactReviewMyTitle: document.getElementById("artifact-review-my-title"),
      artifactReviewProgressTitle: document.getElementById("artifact-review-progress-title"),
      artifactReviewRecordTitle: document.getElementById("artifact-review-record-title"),
      artifactReviewCommentSummary: document.getElementById("artifact-review-comment-summary"),
      artifactReviewSubmitArea: document.getElementById("artifact-review-submit-area"),
      artifactReviewSubmitTitle: document.getElementById("artifact-review-submit-title"),
      artifactReviewSubmitSummary: document.getElementById("artifact-review-submit-summary"),
      artifactReviewSubmit: document.getElementById("artifact-review-submit"),
      artifactReviewArtifactTitle: document.getElementById("artifact-review-artifact-title"),
      artifactReviewMaterialSelector: document.getElementById("artifact-review-material-selector"),
      artifactReviewArtifactContent: document.getElementById("artifact-review-artifact-content"),
      artifactReviewModalResizer: document.getElementById("artifact-review-modal-resizer"),
      artifactReviewArtifactTab: document.getElementById("artifact-review-artifact-tab"),
      artifactReviewReviewTab: document.getElementById("artifact-review-review-tab"),
      memoryTab: document.getElementById("memory-tab"),
      taskTab: document.getElementById("task-tab"),
      settingsTab: document.getElementById("settings-tab"),
      projectSelect: document.getElementById("project-select"),
      projectSelectValue: document.getElementById("project-select-value"),
      projectSelectMenu: document.getElementById("project-select-menu")
    };

    document.getElementById("expand").addEventListener("click", () => setAllSections(true));
    document.getElementById("collapse").addEventListener("click", () => setAllSections(false));
    document.getElementById("refresh").addEventListener("click", () => loadAll().catch(renderFatalError));
    el.createReview.addEventListener("click", () => runButtonAction(el.createReview, createReview));
    el.reviewToggle.addEventListener("click", () => handleReviewToggle().catch(error => alert(error instanceof Error ? error.message : String(error))));
    el.reviewClose.addEventListener("click", () => setReviewDrawer(false));
    el.reviewResizer.addEventListener("pointerdown", beginReviewResize);
    el.reviewResizer.addEventListener("keydown", resizeReviewWithKeyboard);
    el.reviewResizer.addEventListener("dblclick", () => setReviewPanelWidth(380, true));
    el.reviewResizer.setAttribute("aria-label", t("resizeReview"));
    el.reviewResizer.title = t("resizeReview") + " · " + t("resetReviewWidth");
    el.artifactReviewModalResizer.setAttribute("aria-label", t("resizeReview"));
    el.artifactReviewModalResizer.title = t("resizeReview") + " · " + t("resetReviewWidth");
    el.memoryTab.addEventListener("click", () => setViewMode("memory", { landing: true }));
    el.taskTab.addEventListener("click", () => setViewMode("task", { landing: true }));
    el.settingsTab.addEventListener("click", () => {
      setViewMode(state.viewMode === "settings" ? state.lastContentViewMode : "settings");
    });
    el.projectSelect.addEventListener("click", toggleProjectMenu);
    el.projectSelect.addEventListener("keydown", handleProjectSelectKeydown);
    el.submitReview.addEventListener("click", () => runButtonAction(el.submitReview, submitReview));
    el.artifactReviewModalClose.addEventListener("click", closeArtifactReviewModal);
    el.artifactReviewSubmit.addEventListener("click", () => runButtonAction(el.artifactReviewSubmit, submitArtifactReview));
    el.artifactReviewModalResizer.addEventListener("pointerdown", beginArtifactReviewModalResize);
    el.artifactReviewModalResizer.addEventListener("keydown", resizeArtifactReviewModalWithKeyboard);
    el.artifactReviewModalResizer.addEventListener("dblclick", () => setArtifactReviewSplit(58, true));
    el.artifactReviewArtifactTab.addEventListener("click", () => setArtifactReviewMobilePane("artifact"));
    el.artifactReviewReviewTab.addEventListener("click", () => setArtifactReviewMobilePane("review"));
    el.artifactReviewModal.addEventListener("cancel", event => {
      event.preventDefault();
      closeArtifactReviewModal();
    });
    el.search.addEventListener("input", () => {
      applyFilter();
      renderNav();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeProjectMenu();
      if (event.key === "Escape" && state.reviewDrawerOpen) setReviewDrawer(false);
    });
    document.addEventListener("click", (event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".project-select-wrap")) closeProjectMenu();
    });
    document.addEventListener("focusout", () => {
      setTimeout(() => {
        if (!state.taskPollingRenderPending || hasActiveTaskInteraction()) return;
        state.taskPollingRenderPending = false;
        renderAll();
      }, 0);
    });
    window.addEventListener("resize", () => syncReviewDrawer());
    window.addEventListener("popstate", () => {
      loadAll({ route: parseBrowserRoute(window.location), render: true }).catch(renderFatalError);
    });

    loadAll().catch(renderFatalError);
    setInterval(() => {
      if (state.viewMode === "settings") return;
      if (state.viewMode !== "task") return;
      if (hasActiveTaskInteraction()) {
        syncArtifactReviewActivities().catch(console.error);
      } else {
        loadRuns().then(changed => {
          if (!changed) return;
          if (hasActiveTaskInteraction()) {
            state.taskPollingRenderPending = true;
            return;
          }
          state.taskPollingRenderPending = false;
          renderAll();
        }).catch(console.error);
      }
    }, 4000);

    async function loadAll(options = {}) {
      const generation = ++state.pageLoadGeneration;
      await loadProjects();
      let route = options.route || (!state.routeReady ? state.pendingRoute : null);
      if (route) {
        route = await prepareBrowserRoute(route);
        state.pendingRoute = route;
        if (route.project && route.project !== state.currentProject) {
          if (!confirmProjectSwitch()) {
            state.routeReplaceNext = true;
            syncBrowserUrl();
            return;
          }
          await activateProject(route.project);
          await loadProjects();
        }
      }
      const targetMode = route ? routeViewMode(route) : state.viewMode;
      state.viewMode = targetMode;
      if (targetMode === "memory") await loadMemories();
      else if (targetMode === "task") await loadRuns({ loadDetail: false });
      else await loadSettings();
      if (generation !== state.pageLoadGeneration) return;
      if (route) {
        const applied = await applyBrowserRoute(route, { render: false, generation });
        if (!applied || generation !== state.pageLoadGeneration) return;
        state.routeReady = true;
        if (targetMode === "memory" && route.page !== "memory" && route.page !== "memory-review") {
          await loadMemoryDetail(state.selectedId || state.memories[0]?.id);
        } else if (targetMode === "task" && route.page === "tasks") {
          await loadRunDetail(state.selectedTaskId || state.runs[0]?.id);
        }
      } else if (targetMode === "memory") {
        await loadMemoryDetail(state.selectedId || state.memories[0]?.id);
      } else if (targetMode === "task") {
        await loadRunDetail(state.selectedTaskId || state.runs[0]?.id);
      }
      ensureSelectedReview();
      if (options.render !== false) renderAll();
    }

    async function prepareBrowserRoute(route) {
      if (route.page !== "memory-review") return route;
      if (
        route.project !== state.currentProject
        && !state.projects.some(project => project.name === route.project)
      ) {
        return {
          page: "invalid",
          mode: "memory",
          error: "Project not found: " + route.project,
          fragment: route.fragment || ""
        };
      }
      return route;
    }

    async function loadProjects() {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      state.projects = (payload.projects || []).filter(project => !project.missing);
      state.currentProject = payload.current || "";
      el.projectSelectValue.textContent = state.currentProject || "No Project";
      el.projectSelect.title = state.currentProject || "No Project";
      el.projectSelectMenu.innerHTML = "";
      for (const project of state.projects) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "project-select-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(project.name === state.currentProject));
        option.dataset.projectName = project.name;
        option.textContent = project.name;
        option.title = project.name;
        option.addEventListener("click", () => {
          closeProjectMenu();
          if (project.name !== state.currentProject) selectProject(project.name).catch(renderFatalError);
        });
        el.projectSelectMenu.append(option);
      }
      el.projectSelect.disabled = state.projects.length === 0;
    }

    function toggleProjectMenu() {
      if (el.projectSelect.disabled) return;
      if (el.projectSelect.getAttribute("aria-expanded") === "true") closeProjectMenu();
      else openProjectMenu();
    }

    function openProjectMenu(focusSelected = false) {
      el.projectSelect.setAttribute("aria-expanded", "true");
      el.projectSelectMenu.hidden = false;
      if (!focusSelected) return;
      const selected = el.projectSelectMenu.querySelector('[aria-selected="true"]')
        || el.projectSelectMenu.querySelector(".project-select-option");
      selected?.focus();
    }

    function closeProjectMenu() {
      el.projectSelect.setAttribute("aria-expanded", "false");
      el.projectSelectMenu.hidden = true;
    }

    function handleProjectSelectKeydown(event) {
      if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
      event.preventDefault();
      openProjectMenu(true);
    }

    function resetProjectState() {
      state.projectGeneration += 1;
      state.selectedId = null;
      state.selectedTaskId = null;
      state.selectedReviewId = null;
      state.memories = [];
      state.reviews = [];
      state.runs = [];
      state.memoryDetails.clear();
      state.reviewDetails.clear();
      state.runDetails.clear();
      state.reviewSnapshots.clear();
      state.settingsScopes.project = {
        data: null,
        draft: null,
        errors: [],
        confirm: null,
        notice: "",
        loading: false
      };
      if (state.settingsScope === "project") applySettingsScope("project");
    }

    async function activateProject(name) {
      stashSettingsScope();
      const response = await fetch("/api/projects/select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name })
      });
      if (!response.ok) throw new Error(await response.text());
      resetProjectState();
    }

    async function selectProject(name) {
      if (!confirmProjectSwitch()) return;
      await activateProject(name);
      await loadAll();
    }

    function confirmProjectSwitch() {
      stashSettingsScope();
      const projectScope = state.settingsScopes.project;
      const projectDirty = Boolean(
        projectScope.data
        && projectScope.draft
        && JSON.stringify(projectScope.draft) !== JSON.stringify(projectScope.data.config)
      );
      return !projectDirty || window.confirm("当前 Project 设置有未保存修改。放弃修改并切换 Project？");
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
      const projectGeneration = state.projectGeneration;
      el.detail.className = "empty";
      el.detail.textContent = "Loading...";
      const response = await fetch("/api/memories?representation=summary");
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      if (projectGeneration !== state.projectGeneration) return false;
      state.payload = payload;
      state.memories = (state.payload.memories || []).map(memory => ({
        ...memory,
        ...(state.memoryDetails.get(memory.id) || {})
      }));
      state.actorNames = state.payload.actorNames || {};
      state.byName = new Map();
      for (const memory of state.memories) {
        for (const name of memory.entity?.names || memory.names || []) state.byName.set(name, memory);
      }
      applyFilter();
      if (!state.selectedId && state.filtered[0]) state.selectedId = state.filtered[0].id;
      return true;
    }

    async function loadMemoryDetail(id) {
      if (!id) return null;
      const projectGeneration = state.projectGeneration;
      const summary = state.memories.find(memory => memory.id === id);
      if (!summary || summary.error) return null;
      const names = summary.entity?.names || summary.names || [];
      const canonicalName = names[0] || id.slice(id.indexOf("/") + 1);
      const response = await fetch(
        "/api/memories/" + encodeURIComponent(summary.kind) + "/" + encodeURIComponent(canonicalName)
      );
      if (!response.ok) throw new Error(await response.text());
      const detail = (await response.json()).memory;
      if (projectGeneration !== state.projectGeneration) return null;
      state.memoryDetails.set(id, detail);
      Object.assign(summary, detail);
      for (const name of detail.entity?.names || []) state.byName.set(name, summary);
      return summary;
    }

    async function loadMemorySelection(id) {
      await loadMemoryDetail(id);
      if (state.selectedId !== id || !state.reviewDrawerOpen) return;
      await loadReviews();
      if (state.selectedId !== id) return;
      ensureSelectedReview();
      if (state.selectedReviewId) await loadReviewDetail(state.selectedReviewId);
    }

    async function loadReviews() {
      const projectGeneration = state.projectGeneration;
      const subject = reviewListSubject();
      if (!subject) {
        state.reviews = [];
        return;
      }
      const query = new URLSearchParams({ representation: "summary", memory_id: subject.id });
      if (subject.path) query.set("memory_path", subject.path);
      const response = await fetch("/api/reviews?" + query);
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      if (projectGeneration !== state.projectGeneration) return false;
      const currentSubject = reviewListSubject();
      if (!currentSubject || currentSubject.id !== subject.id || currentSubject.path !== subject.path) return false;
      state.reviews = (payload.reviews || []).map(review => {
        const detail = state.reviewDetails.get(review.id);
        return detail?.updatedAt === review.updatedAt ? { ...review, ...detail } : review;
      });
      return true;
    }

    async function loadReviewDetail(id) {
      if (!id) return null;
      const projectGeneration = state.projectGeneration;
      const subject = reviewListSubject();
      if (!subject) return null;
      const response = await fetch("/api/reviews/" + encodeURIComponent(id));
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(await response.text());
      }
      const detail = (await response.json()).review;
      if (projectGeneration !== state.projectGeneration) return null;
      const currentSubject = reviewListSubject();
      if (!currentSubject || currentSubject.id !== subject.id || currentSubject.path !== subject.path) return null;
      if (!reviewMatchesSubject(detail, subject)) return null;
      const summary = state.reviews.find(review => review.id === id);
      if (!summary) return null;
      state.reviewDetails.set(id, detail);
      Object.assign(summary, detail, { commentCount: detail.comments?.length || 0 });
      return detail;
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

    async function loadRuns(options = {}) {
      const projectGeneration = state.projectGeneration;
      const previousSignature = runSummarySignature(state.runs);
      const previous = new Map(state.runs.map(run => [run.id, run.updatedAt]));
      const response = await fetch("/api/runs?representation=summary");
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      if (projectGeneration !== state.projectGeneration) return false;
      const selectedArchivedDetail = state.selectedTaskId
        ? state.runDetails.get(state.selectedTaskId)
        : null;
      const activeRuns = (payload.runs || []).map(run => {
        const detail = state.runDetails.get(run.id);
        return detail && detail.updatedAt === run.updatedAt ? { ...run, ...detail } : run;
      });
      state.runs = selectedArchivedDetail?.readOnly === true
        && !activeRuns.some(run => run.id === selectedArchivedDetail.id)
        ? [{ ...selectedArchivedDetail, eventCount: selectedArchivedDetail.events?.length || 0, archived: true }, ...activeRuns]
        : activeRuns;
      const explicitRunRoute = !state.routeReady && ["task", "artifact-review"].includes(state.pendingRoute?.page);
      if (!explicitRunRoute && !state.runs.some(run => run.id === state.selectedTaskId)) {
        state.selectedTaskId = state.runs[0]?.id || null;
        saveSelectedTask();
      }
      const selected = state.runs.find(run => run.id === state.selectedTaskId) || state.runs[0];
      if (options.loadDetail !== false && selected && previous.get(selected.id) !== selected.updatedAt && !hasActiveTaskInteraction()) {
        await loadRunDetail(selected.id);
      }
      if (state.artifactReviewModalOpen) {
        await syncArtifactReviewContext();
        await syncArtifactReviewActivities();
      }
      return previousSignature !== runSummarySignature(state.runs);
    }

    function runSummarySignature(runs) {
      return runs.map(run => [run.id, run.updatedAt, run.status, run.eventCount,
        run.reviewProgress?.status, run.reviewProgress?.submitted, run.reviewProgress?.total].join(":"))
        .sort()
        .join("|");
    }

    async function loadRunDetail(id) {
      if (!id) return null;
      const projectGeneration = state.projectGeneration;
      const response = await fetch("/api/runs/" + encodeURIComponent(id));
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(await response.text());
      }
      const detail = (await response.json()).run;
      if (projectGeneration !== state.projectGeneration) return null;
      state.runDetails.set(id, detail);
      const summary = state.runs.find(run => run.id === id);
      if (summary) Object.assign(summary, detail, { eventCount: detail.events?.length || 0 });
      else state.runs.unshift({ ...detail, eventCount: detail.events?.length || 0, archived: detail.readOnly === true });
      return detail;
    }

    async function syncArtifactReviewContext(force = false) {
      if (state.viewMode !== "task" || !state.artifactReviewModalOpen) {
        state.artifactReviewContext = null;
        return;
      }
      const run = state.runs.find(item => item.id === state.selectedTaskId) || state.runs[0] || null;
      const reviews = artifactReviewSummariesForRun(run);
      let reviewId = run && state.artifactReviewModalOpen ? state.artifactReviewSelectedByRun[run.id] : "";
      let review = reviews.find(candidate => candidate.id === reviewId);
      if (!review) review = defaultArtifactReviewSummary(run);
      if (!review?.round) {
        state.artifactReviewContext = null;
        state.artifactReviewConflict = "";
        return;
      }
      if (run) {
        state.artifactReviewSelectedByRun[run.id] = review.id;
        writeStoredObject(artifactReviewSelectedKey, state.artifactReviewSelectedByRun);
      }
      const assignments = (review.round.assignments || []).filter(assignment => assignment.actorKind !== "agent");
      let actorId = state.artifactReviewIdentityByReview[review.id] || "";
      if (!assignments.some(assignment => assignment.actorId === actorId)) {
        actorId = assignments.length === 1 ? assignments[0].actorId : "";
      }
      if (actorId) {
        state.artifactReviewIdentityByReview[review.id] = actorId;
        writeStoredObject(artifactReviewIdentityKey, state.artifactReviewIdentityByReview);
      }
      if (force || !hasOpenInlineEditor()) {
        const requestedRoundId = state.artifactReviewRoundByReview[review.id] || review.currentRoundId;
        try {
          await loadArtifactReviewContext(review.id, requestedRoundId, actorId);
        } catch (error) {
          if (requestedRoundId === review.currentRoundId) throw error;
          state.artifactReviewRoundByReview[review.id] = review.currentRoundId;
          writeStoredObject(artifactReviewRoundKey, state.artifactReviewRoundByReview);
          await loadArtifactReviewContext(review.id, review.currentRoundId, actorId);
        }
      }
    }

    async function loadArtifactReviewContext(reviewId, roundId, actorId) {
      const requestId = ++state.artifactReviewRequest;
      state.artifactReviewLoading = true;
      try {
        const context = await fetchArtifactReviewContext(reviewId, roundId, actorId);
        if (requestId !== state.artifactReviewRequest) return;
        state.artifactReviewContext = context;
        state.artifactReviewRoundByReview[reviewId] = roundId;
        state.artifactReviewHistoryRoundId = roundId;
        writeStoredObject(artifactReviewRoundKey, state.artifactReviewRoundByReview);
        if (state.pendingArtifactMaterial) {
          const materials = artifactReviewMaterials(context);
          const material = materials.find(item => item.key === state.pendingArtifactMaterial);
          state.artifactReviewMaterialBySubmission[context.submission.id] = material?.key || "candidate";
          state.pendingArtifactMaterial = "";
        }
        if (!artifactReviewLocalEntry(context)?.dirty) state.artifactReviewConflict = "";
      } finally {
        if (requestId === state.artifactReviewRequest) state.artifactReviewLoading = false;
      }
    }

    async function fetchArtifactReviewContext(reviewId, roundId, actorId) {
      const runId = state.selectedTaskId;
      if (!runId) throw new Error("No task selected for Artifact Review");
      const response = await fetch(
        "/api/runs/" + encodeURIComponent(runId)
        + "/artifact-reviews/" + encodeURIComponent(reviewId)
        + "/rounds/" + encodeURIComponent(roundId)
        + (actorId ? "?actor_id=" + encodeURIComponent(actorId) : "")
      );
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }

    async function loadSettings(options = {}) {
      stashSettingsScope();
      state.settingsLoading = true;
      state.settingsNotice = "";
      try {
        const metaResponse = await fetch("/api/settings/meta");
        if (!metaResponse.ok) throw new Error(await metaResponse.text());
        state.settingsMeta = await metaResponse.json();

        const globalScope = state.settingsScopes.global;
        if (!globalScope.data || options.forceScope === "global") {
          const response = await settingsFetch("/api/settings/global");
          if (response.status === 401) {
            globalScope.data = null;
            globalScope.draft = null;
            state.settingsScopes.project.data = null;
            state.settingsScopes.project.draft = null;
            state.settingsTokenError = state.settingsToken
              ? "操作令牌不正确，请检查后重试。"
              : "";
            sessionStorage.removeItem(settingsTokenKey);
            applySettingsScope(state.settingsScope);
            return;
          }
          if (!response.ok) throw new Error(await response.text());
          globalScope.data = await response.json();
          globalScope.draft = cloneSettingsValue(globalScope.data.config);
          globalScope.errors = [];
          globalScope.confirm = null;
          globalScope.notice = "";
        }

        const projectScope = state.settingsScopes.project;
        const projectChanged = projectScope.data?.projectName !== state.currentProject;
        if (!state.currentProject) {
          Object.assign(projectScope, { data: null, draft: null, errors: [], confirm: null, notice: "" });
        } else if (!projectScope.data || projectChanged || options.forceScope === "project") {
          const response = await settingsFetch("/api/settings/project");
          if (response.status === 404) {
            Object.assign(projectScope, { data: null, draft: null, errors: [], confirm: null, notice: "" });
          } else {
            if (!response.ok) throw new Error(await response.text());
            projectScope.data = await response.json();
            projectScope.draft = cloneSettingsValue(projectScope.data.config);
            projectScope.errors = [];
            projectScope.confirm = null;
            projectScope.notice = "";
          }
        }

        state.settingsTokenError = "";
        if (state.settingsToken) sessionStorage.setItem(settingsTokenKey, state.settingsToken);
        applySettingsScope(state.settingsScope);
        if (state.settingsScope === "global") restoreSettingsProviderDetection();
      } finally {
        state.settingsLoading = false;
      }
    }

    function stashSettingsScope() {
      const scope = state.settingsScopes[state.settingsScope];
      scope.data = state.settingsData;
      scope.draft = state.settingsDraft;
      scope.errors = state.settingsErrors;
      scope.confirm = state.settingsConfirm;
      scope.notice = state.settingsNotice;
      scope.loading = state.settingsLoading;
      state.settingsModules[state.settingsScope] = state.settingsModule;
    }

    function applySettingsScope(scopeName) {
      const scope = state.settingsScopes[scopeName];
      state.settingsScope = scopeName;
      state.settingsData = scope.data;
      state.settingsDraft = scope.draft;
      state.settingsErrors = scope.errors;
      state.settingsConfirm = scope.confirm;
      state.settingsNotice = scope.notice;
      state.settingsModule = state.settingsModules[scopeName];
    }

    function activateSettingsDestination(scopeName, moduleName) {
      state.routeError = "";
      state.routeLanding = "";
      if (scopeName !== state.settingsScope) {
        stashSettingsScope();
        applySettingsScope(scopeName);
      }
      state.settingsModule = moduleName;
      state.settingsModules[scopeName] = moduleName;
      state.settingsNavExpanded[scopeName] = true;
      state.settingsConfirm = null;
      renderAll();
    }

    function settingsFetch(url, options = {}) {
      const headers = new Headers(options.headers || {});
      if (state.settingsToken) headers.set("authorization", "Bearer " + state.settingsToken);
      return fetch(url, { ...options, headers });
    }

    function cloneSettingsValue(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function renderSettingsNav() {
      el.nav.innerHTML = "";
      el.count.textContent = "";
      const nav = document.createElement("div");
      nav.className = "settings-nav";
      const groups = [
        ["global", "Memsphere", [["overview", "概览"], ["general", "常规"], ["view", "View 服务"], ["providers", "ACP Provider"]]],
        ["project", "Project · " + state.currentProject, [["overview", "概览"], ["participants", "参与者配置"]]]
      ];
      for (const [scopeName, headingText, modules] of groups) {
        if (scopeName === "project" && !state.currentProject) continue;
        const group = document.createElement("div");
        group.className = "settings-nav-group" + (state.settingsScope === scopeName ? " active" : "");
        group.setAttribute("role", "group");
        const heading = document.createElement("button");
        heading.type = "button";
        heading.className = "settings-nav-heading";
        heading.id = "settings-nav-" + scopeName;
        heading.setAttribute("aria-expanded", String(state.settingsNavExpanded[scopeName]));
        const headingLabel = document.createElement("span");
        headingLabel.textContent = headingText;
        const caret = document.createElement("span");
        caret.className = "settings-nav-caret";
        caret.setAttribute("aria-hidden", "true");
        heading.append(headingLabel, caret);
        group.setAttribute("aria-labelledby", heading.id);
        const items = document.createElement("div");
        items.className = "settings-nav-items";
        items.hidden = !state.settingsNavExpanded[scopeName];
        heading.addEventListener("click", () => {
          state.settingsNavExpanded[scopeName] = !state.settingsNavExpanded[scopeName];
          renderSettingsNav();
        });
        for (const [id, label] of modules) {
          const button = document.createElement("button");
          button.type = "button";
          const active = state.settingsScope === scopeName && state.settingsModule === id;
          button.className = "memory-button" + (active ? " active" : "");
          button.textContent = label;
          if (active) button.setAttribute("aria-current", "page");
          button.addEventListener("click", () => activateSettingsDestination(scopeName, id));
          items.append(button);
        }
        group.append(heading, items);
        nav.append(group);
      }
      el.nav.append(nav);
    }

    function renderSettings() {
      el.title.textContent = state.settingsScope === "global"
        ? "Memsphere 设置"
        : state.currentProject ? state.currentProject + " 项目设置" : "Project 设置";
      el.subtitle.textContent = state.settingsScope === "global"
        ? "管理 Memsphere Home 全局配置"
        : state.currentProject ? "管理当前 Project 配置" : "当前没有可管理的 Project";
      el.detail.className = "";
      el.detail.innerHTML = "";
      const layout = document.createElement("div");
      layout.className = "settings-layout";
      el.detail.append(layout);

      if (state.settingsLoading) {
        layout.append(settingsEmpty("正在读取配置..."));
        return;
      }
      if (state.settingsMeta?.requiresToken && !state.settingsScopes.global.data) {
        layout.append(renderSettingsToken());
        return;
      }
      if (!state.settingsData || !state.settingsDraft) {
        layout.append(settingsEmpty(state.settingsScope === "project"
          ? "当前没有可管理的 Project。Memsphere 全局设置仍然可用。"
          : "配置尚未加载。"));
        return;
      }

      layout.append(renderSettingsStatus());
      if (state.settingsNotice) {
        const notice = document.createElement("div");
        notice.className = "artifact-review-message";
        notice.textContent = state.settingsNotice;
        layout.append(notice);
      }
      if (state.settingsConfirm) {
        layout.append(renderSettingsConfirmation());
        return;
      }
      if (state.settingsModule === "general") layout.append(renderGeneralSettings());
      else if (state.settingsModule === "view") layout.append(renderViewSettings());
      else if (state.settingsModule === "providers") layout.append(renderProviderSettings());
      else if (state.settingsModule === "participants") layout.append(renderParticipantSettings());
      else layout.append(renderSettingsOverview());
      if (["general", "view", "providers", "participants"].includes(state.settingsModule)) {
        layout.append(renderSettingsActions());
      }
    }

    function settingsInlineCode(value) {
      const code = document.createElement("code");
      code.textContent = value;
      return code;
    }

    function renderSettingsToken() {
      const section = document.createElement("section");
      section.className = "settings-section settings-token";
      const title = document.createElement("h3");
      title.textContent = "验证配置操作权限";
      const field = settingsTextField("操作令牌", state.settingsToken, value => {
        state.settingsToken = value.trim();
        state.settingsTokenError = "";
        field.querySelector(".settings-error")?.remove();
        const input = field.querySelector("input");
        input?.removeAttribute("aria-invalid");
        input?.removeAttribute("aria-describedby");
      }, { type: "password" });
      if (state.settingsTokenError) {
        const input = field.querySelector("input");
        input?.setAttribute("aria-invalid", "true");
        const error = settingsErrorElement(state.settingsTokenError);
        error.id = "settings-token-error";
        error.setAttribute("role", "alert");
        input?.setAttribute("aria-describedby", error.id);
        field.append(error);
      }
      const help = document.createElement("div");
      help.className = "settings-help";
      help.append(
        document.createTextNode("不知道令牌？请在启动 View 的工作区执行 "),
        settingsInlineCode("memsphere view status"),
        document.createTextNode("。")
      );
      field.append(help);
      const action = document.createElement("button");
      action.type = "button";
      action.className = "btn primary";
      action.textContent = "进入配置中心";
      action.addEventListener("click", () => {
        loadSettings().then(renderAll).catch(renderFatalError);
      });
      section.append(title, field, action);
      return section;
    }

    function renderSettingsStatus() {
      const status = document.createElement("div");
      status.id = "settings-status";
      status.className = "settings-status";
      status.append(pill("磁盘配置 " + shortRevision(state.settingsData.diskRevision), false, "strong"));
      if (state.settingsScope === "global") {
        status.append(pill("运行配置 " + shortRevision(state.settingsData.runningRevision)));
        status.append(pill(state.settingsData.restartRequired ? "待重启生效" : "已生效", false, state.settingsData.restartRequired ? "warn" : "done"));
      } else {
        status.append(pill("Project 配置", false, "done"));
      }
      status.append(pill(settingsIsDirty() ? "未保存修改" : "没有未保存修改", false, settingsIsDirty() ? "warn" : "done"));
      status.append(pill("错误 " + state.settingsErrors.length, false, state.settingsErrors.length ? "warn" : ""));
      return status;
    }

    function renderSettingsOverview() {
      const section = document.createElement("section");
      section.className = "settings-section";
      const title = document.createElement("h3");
      title.textContent = "概览";
      const grid = document.createElement("div");
      grid.className = "settings-grid";
      if (state.settingsScope === "global") {
        const projectCount = state.projects.length;
        grid.append(
          settingsReadOnly("Scope", "Memsphere Home"),
          settingsReadOnly("全局配置", state.settingsData.configPath),
          settingsReadOnly("已注册 Project", String(projectCount)),
          settingsReadOnly("ACP Provider", String(state.settingsData.acpProviderCatalog?.length || 0))
        );
      } else {
        grid.append(
          settingsReadOnly("Project", state.settingsData.projectName || "-"),
          settingsReadOnly("Project 配置", state.settingsData.configPath),
          settingsReadOnly("Store 类型", state.settingsData.store?.type || "-"),
          settingsReadOnly("Store", JSON.stringify(state.settingsData.store || {}))
        );
      }
      section.append(title, grid);
      if (state.settingsScope === "project") {
        const storageTitle = document.createElement("h4");
        storageTitle.textContent = "存储位置";
        const storageGrid = document.createElement("div");
        storageGrid.className = "settings-grid";
        for (const [key, label] of [
          ["memoryRoot", "Memory 根目录"],
          ["reviewsRoot", "Review 根目录"],
          ["runsRoot", "Run 根目录"],
          ["archiveRoot", "Archive 根目录"]
        ]) {
          storageGrid.append(settingsReadOnly(label, state.settingsData.resolvedPaths[key]));
        }
        section.append(storageTitle, storageGrid);
      }
      return section;
    }

    function renderGeneralSettings() {
      const section = document.createElement("section");
      section.className = "settings-section";
      const title = document.createElement("h3");
      title.textContent = "常规";
      const grid = document.createElement("div");
      grid.className = "settings-grid";
      grid.append(settingsSelectField(
        "工作语言",
        state.settingsDraft.language || "zh-CN",
        [
          ["zh-CN", "中文"],
          ["en", "English"]
        ],
        value => {
          state.settingsDraft.language = value;
        }
      ));
      section.append(title, grid);
      return section;
    }

    function renderViewSettings() {
      const section = document.createElement("section");
      section.className = "settings-section";
      const title = document.createElement("h3");
      title.textContent = "View 服务";
      const explicit = Boolean(state.settingsDraft.view);
      const view = state.settingsDraft.view || cloneSettingsValue(state.settingsData.defaults.view);
      const grid = document.createElement("div");
      grid.className = "settings-grid";
      grid.append(
        settingsTextField("Host", view.host, value => {
          state.settingsDraft.view ||= cloneSettingsValue(state.settingsData.defaults.view);
          state.settingsDraft.view.host = value;
        }, { path: "view.host", disabled: !explicit }),
        settingsTextField("Port", String(view.port), value => {
          state.settingsDraft.view ||= cloneSettingsValue(state.settingsData.defaults.view);
          state.settingsDraft.view.port = Number(value);
        }, { path: "view.port", type: "number", min: 0, max: 65535, disabled: !explicit })
      );
      const useDefault = settingsPermissionCheck("使用默认 View 配置", !explicit, checked => {
        if (checked) delete state.settingsDraft.view;
        else state.settingsDraft.view = cloneSettingsValue(state.settingsData.defaults.view);
        renderAll();
      });
      useDefault.classList.add("settings-default-toggle");
      const help = document.createElement("p");
      help.className = "settings-help";
      help.textContent = "保存后执行 memsphere view restart，使 Host 与 Port 配置生效。";
      section.append(title, grid, useDefault, help);
      return section;
    }

    function renderParticipantSettings() {
      const section = document.createElement("section");
      section.className = "settings-section";
      const heading = document.createElement("div");
      heading.className = "settings-section-head";
      const headingCopy = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = "参与者配置";
      const subtitle = document.createElement("p");
      subtitle.className = "settings-section-subtitle";
      subtitle.textContent = "按参与者展开编辑权限；Agent 只选择 ACP Provider 与 Model。";
      headingCopy.append(title, subtitle);
      if (!state.settingsDraft.control_plane) {
        const message = document.createElement("p");
        message.className = "muted";
        message.textContent = "当前未启用参与者控制平面。";
        const enable = document.createElement("button");
        enable.type = "button";
        enable.className = "btn";
        enable.textContent = "启用参与者配置";
        enable.addEventListener("click", () => {
          state.settingsDraft.control_plane = { runner: { permissions: [] }, actors: {} };
          renderAll();
        });
        heading.append(headingCopy);
        section.append(heading, message, enable);
        return section;
      }
      const list = document.createElement("div");
      list.className = "settings-participants";
      list.append(renderSettingsParticipant(
        "runner",
        state.settingsDraft.control_plane.runner,
        true
      ));
      for (const [id, actor] of Object.entries(state.settingsDraft.control_plane.actors || {})) {
        list.append(renderSettingsParticipant(id, actor, false));
      }
      const add = document.createElement("button");
      add.type = "button";
      add.className = "btn";
      add.textContent = "添加参与者";
      add.addEventListener("click", () => {
        const actors = state.settingsDraft.control_plane.actors;
        let index = Object.keys(actors).length + 1;
        let id = "actor" + index;
        while (actors[id]) id = "actor" + (++index);
        actors[id] = { kind: "human", name: "新参与者", permissions: [] };
        state.settingsExpandedParticipants.push(id);
        renderAll();
      });
      heading.append(headingCopy, add);
      section.append(heading, list);
      return section;
    }

    function renderProviderSettings() {
      const section = document.createElement("section");
      section.className = "settings-section";
      const heading = document.createElement("div");
      heading.className = "settings-section-head";
      const headingCopy = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = "ACP Provider";
      const subtitle = document.createElement("p");
      subtitle.className = "settings-section-subtitle";
      subtitle.textContent = "管理 Agent CLI、启动参数与安装检测；认证仍由各 Provider 自身管理。";
      headingCopy.append(title, subtitle);
      const actions = document.createElement("div");
      actions.className = "settings-provider-status";
      const detect = document.createElement("button");
      detect.type = "button";
      detect.className = "btn";
      detect.textContent = state.settingsProviderDetecting ? "检测中..." : "自动检测";
      detect.disabled = state.settingsProviderDetecting;
      detect.addEventListener("click", () => detectSettingsProviders().catch(showSettingsFailure));
      actions.append(detect);
      heading.append(headingCopy, actions);

      const list = document.createElement("div");
      list.className = "settings-providers";
      for (const entry of settingsProviderEntries()) list.append(renderSettingsProvider(entry));
      section.append(heading, list);
      if (
        !Object.keys(state.settingsProviderDetection).length
        && !state.settingsProviderDetecting
        && state.settingsProviderAutoDetectionAttemptedRevision !== state.settingsData.diskRevision
      ) {
        state.settingsProviderAutoDetectionAttemptedRevision = state.settingsData.diskRevision;
        queueMicrotask(() => detectSettingsProviders().catch(showSettingsFailure));
      }
      return section;
    }

    function renderSettingsProvider(entry) {
      const item = document.createElement("details");
      item.className = "settings-provider settings-participant";
      item.dataset.providerId = entry.id;
      item.open = state.settingsExpandedProviders.includes(entry.id);
      item.addEventListener("toggle", () => {
        const expanded = new Set(state.settingsExpandedProviders);
        if (item.open) expanded.add(entry.id);
        else expanded.delete(entry.id);
        state.settingsExpandedProviders = [...expanded];
      });
      const summary = document.createElement("summary");
      summary.className = "settings-participant-summary";
      const main = document.createElement("div");
      main.className = "settings-participant-summary-main";
      const heading = document.createElement("div");
      heading.className = "settings-participant-title";
      const name = document.createElement("strong");
      name.textContent = entry.id;
      const windowsSupport = entry.definition.windowsSupport;
      heading.append(
        name,
        pill(entry.definition.name),
        providerDetectionPill(entry.id),
        pill("Windows: " + (windowsSupport?.status || "unknown"))
      );
      const refs = settingsProviderReferences(entry.id);
      const meta = document.createElement("div");
      meta.className = "settings-participant-summary-meta";
      const detection = state.settingsProviderDetection[entry.id];
      meta.textContent = [
        detection?.path,
        detection?.version || detection?.reason || "尚未检测",
        windowsSupport?.reason,
        refs.length + " 个参与者引用"
      ].filter(Boolean).join(" · ");
      main.append(heading, meta);
      summary.append(main);

      const body = document.createElement("div");
      body.className = "settings-participant-body";
      const bodyActions = document.createElement("div");
      bodyActions.className = "settings-participant-actions";
      const resetOrDelete = document.createElement("button");
      resetOrDelete.type = "button";
      resetOrDelete.className = "btn" + (entry.builtin ? "" : " danger");
      resetOrDelete.textContent = entry.builtin ? "恢复默认值" : "删除";
      resetOrDelete.disabled = refs.length > 0 || (entry.builtin && !entry.explicit);
      resetOrDelete.title = refs.length
        ? "以下参与者仍在引用：" + refs.join("、")
        : entry.builtin && !entry.explicit ? "当前正在使用系统默认值" : "";
      resetOrDelete.addEventListener("click", () => {
        delete state.settingsDraft.acp_providers?.[entry.id];
        state.settingsProviderDetection[entry.id] = { status: "pending_redetect" };
        renderAll();
      });
      const markProviderExplicit = () => {
        if (!entry.builtin) return;
        resetOrDelete.disabled = refs.length > 0;
        resetOrDelete.title = refs.length ? "以下参与者仍在引用：" + refs.join("、") : "";
      };
      bodyActions.append(resetOrDelete);
      body.append(bodyActions);
      if (detection && (detection.status === "missing" || detection.status === "failed")) {
        const guidance = document.createElement("div");
        guidance.className = "settings-error";
        guidance.setAttribute("role", "alert");
        guidance.textContent = [detection.reason, detection.installHelp].filter(Boolean).join(" ");
        body.append(guidance);
      }

      const provider = entry.value;
      const grid = document.createElement("div");
      grid.className = "settings-grid settings-participant-basic";
      grid.append(
        settingsTextField("Command", provider.command || entry.definition.defaultCommand, () => {}, {
          disabled: true,
          wide: true
        })
      );
      body.append(grid);

      const timeoutGrid = document.createElement("div");
      timeoutGrid.className = "settings-grid settings-participant-basic";
      timeoutGrid.append(
        settingsTextField("Startup timeout (ms)", String(provider.startup_timeout_ms ?? 60000), value => {
          ensureSettingsProvider(entry.id, provider.type).startup_timeout_ms = Number(value);
          markProviderExplicit();
          invalidateSettingsProviderDetection(entry.id);
        }, { type: "number", min: 1 }),
        settingsTextField("Idle timeout (ms)", String(provider.idle_timeout_ms ?? 120000), value => {
          ensureSettingsProvider(entry.id, provider.type).idle_timeout_ms = Number(value);
          markProviderExplicit();
          invalidateSettingsProviderDetection(entry.id);
        }, { type: "number", min: 1 }),
        settingsTextField("Max runtime (ms)", provider.max_runtime_ms == null ? "" : String(provider.max_runtime_ms), value => {
          ensureSettingsProvider(entry.id, provider.type).max_runtime_ms = value.trim() ? Number(value) : null;
          markProviderExplicit();
          invalidateSettingsProviderDetection(entry.id);
        }, { type: "number", min: 1 })
      );
      body.append(timeoutGrid);
      body.append(
        settingsTextArea("Args（每行一个）", (provider.args || []).join("\n"), value => {
          ensureSettingsProvider(entry.id, provider.type).args = value.split(/\r?\n/).filter(line => line.length > 0);
          markProviderExplicit();
          invalidateSettingsProviderDetection(entry.id);
        }, "acp_providers." + entry.id + ".args"),
        settingsTextArea("Env（每行 KEY=VALUE，不允许凭据）", Object.entries(provider.env || {})
          .map(([key, value]) => key + "=" + value).join("\n"), value => {
          ensureSettingsProvider(entry.id, provider.type).env = Object.fromEntries(value.split(/\r?\n/)
            .filter(line => line.includes("="))
            .map(line => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1)]));
          markProviderExplicit();
          invalidateSettingsProviderDetection(entry.id);
        }, "acp_providers." + entry.id + ".env")
      );
      const preview = document.createElement("div");
      preview.className = "settings-provider-preview mono";
      preview.textContent = "实际启动：" + settingsProviderLaunchPreview(provider);
      body.append(preview);
      item.append(summary, body);
      return item;
    }

    function renderSettingsParticipant(id, actor, runner) {
      const item = document.createElement("details");
      item.className = "settings-participant";
      const key = runner ? "runner" : id;
      item.open = state.settingsExpandedParticipants.includes(key);
      item.addEventListener("toggle", () => {
        const expanded = new Set(state.settingsExpandedParticipants);
        if (item.open) expanded.add(key);
        else expanded.delete(key);
        state.settingsExpandedParticipants = [...expanded];
      });
      const summary = document.createElement("summary");
      summary.className = "settings-participant-summary";
      const summaryMain = document.createElement("div");
      summaryMain.className = "settings-participant-summary-main";
      const heading = document.createElement("div");
      heading.className = "settings-participant-title";
      const name = document.createElement("strong");
      name.textContent = runner ? t("runner") : (actor.name || id);
      heading.append(name, pill(runner ? "runner" : actor.kind));
      const meta = document.createElement("div");
      meta.className = "settings-participant-summary-meta";
      const configurablePermissionIds = new Set(
        (state.settingsData.permissionCatalog || []).map(definition => definition.id)
      );
      const permissionCount = (actor.permissions || [])
        .filter(permission => configurablePermissionIds.has(permission)).length;
      const runtimeSummary = actor.kind === "agent"
        ? " · " + (actor.agent?.provider || "traex") + (actor.agent?.model ? " · " + actor.agent.model : "")
        : "";
      meta.textContent = permissionCount + " 项权限" + runtimeSummary;
      summaryMain.append(heading, meta);
      summary.append(summaryMain);

      const body = document.createElement("div");
      body.className = "settings-participant-body";
      const actions = document.createElement("div");
      actions.className = "settings-participant-actions";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn danger";
      remove.textContent = "删除";
      remove.disabled = runner;
      remove.title = runner ? t("runner") + "不能删除" : "";
      remove.addEventListener("click", () => {
        delete state.settingsDraft.control_plane.actors[id];
        state.settingsExpandedParticipants = state.settingsExpandedParticipants.filter(value => value !== id);
        renderAll();
      });
      actions.append(remove);
      body.append(actions);

      if (!runner) {
        const basic = document.createElement("div");
        basic.className = "settings-grid settings-compact-grid settings-participant-basic";
        basic.append(
          settingsTextField("ID", id, value => renameSettingsActor(id, value), {
            path: "control_plane.actors." + id,
            commitOnChange: true
          }),
          settingsSelectField("类型", actor.kind, [["human", "Human"], ["agent", "Agent"]], value => {
            actor.kind = value;
            if (value === "agent" && !actor.agent) actor.agent = defaultSettingsAgent();
            if (value === "human") delete actor.agent;
          }),
          settingsTextField("名称", actor.name || "", value => { actor.name = value; }, { path: "control_plane.actors." + id + ".name" }),
          settingsTextArea("System prompt", actor.system_prompt || "", value => {
            if (value.trim()) actor.system_prompt = value;
            else delete actor.system_prompt;
          }, "control_plane.actors." + id + ".system_prompt")
        );
        body.append(basic);
      }

      body.append(renderSettingsPermissions(actor, runner ? "control_plane.runner" : "control_plane.actors." + id));
      if (!runner && actor.kind === "agent") body.append(renderSettingsAgentRuntime(actor.agent, id));
      item.append(summary, body);
      return item;
    }

    function renderSettingsPermissions(actor, path) {
      const permissions = actor.permissions || [];
      const wrap = document.createElement("div");
      const title = document.createElement("h4");
      title.textContent = "权限";
      const grid = document.createElement("div");
      grid.className = "settings-permissions";
      for (const definition of state.settingsData.permissionCatalog || []) {
        const row = document.createElement("div");
        row.className = "settings-permission";
        row.append(settingsPermissionCheck(definition.id, permissions.includes(definition.id), checked => {
          updateSettingsPermission(actor, "permissions", definition.id, checked);
          renderAll();
        }));
        const description = document.createElement("p");
        description.textContent = definition.descriptions?.["zh-CN"] || definition.id;
        row.append(description);
        grid.append(row);
      }
      wrap.append(title, grid);
      return wrap;
    }

    function renderSettingsAgentRuntime(agent, id) {
      const runtime = agent || defaultSettingsAgent();
      const wrap = document.createElement("div");
      const title = document.createElement("h4");
      title.textContent = "Agent 运行";
      const grid = document.createElement("div");
      grid.className = "settings-grid settings-compact-grid";
      const providerOptions = settingsProviderEntries().map(entry => {
        const status = settingsProviderStatusLabel(state.settingsProviderDetection[entry.id]);
        return [entry.id, entry.id + " · " + entry.definition.name + " · " + status];
      });
      grid.append(
        settingsSelectField("ACP Provider", runtime.provider || "traex", providerOptions, value => {
          runtime.provider = value;
        }),
        settingsTextField("Model", runtime.model || "", value => setOptionalValue(runtime, "model", value), {
          path: "control_plane.actors." + id + ".agent.model"
        })
      );
      wrap.append(title, grid);
      return wrap;
    }

    function renderSettingsActions() {
      const actions = document.createElement("div");
      actions.className = "settings-actions";
      const reload = document.createElement("button");
      reload.type = "button";
      reload.className = "btn";
      reload.textContent = "重新读取";
      reload.addEventListener("click", () => loadSettings({ forceScope: state.settingsScope }).then(renderAll).catch(renderFatalError));
      const save = document.createElement("button");
      save.type = "button";
      save.className = "btn primary";
      save.textContent = "保存";
      save.addEventListener("click", () => validateSettings().catch(showSettingsFailure));
      actions.append(reload, save);
      return actions;
    }

    async function validateSettings() {
      state.settingsErrors = [];
      state.settingsNotice = "";
      const response = await settingsFetch("/api/settings/" + state.settingsScope + "/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: state.settingsData.diskRevision,
          config: state.settingsDraft
        })
      });
      const payload = await response.json();
      if (response.status === 409) {
        state.settingsNotice = "配置文件已在磁盘上发生变化，请重新读取后再编辑。";
        renderAll();
        return;
      }
      if (!response.ok || !payload.valid) {
        state.settingsErrors = payload.errors || [{ path: "", message: payload.error || "配置校验失败" }];
        renderAll();
        return;
      }
      state.settingsConfirm = payload;
      renderAll();
    }

    function renderSettingsConfirmation() {
      const section = document.createElement("section");
      section.className = "settings-section";
      const title = document.createElement("h3");
      title.textContent = "确认配置变更";
      const changes = document.createElement("ul");
      changes.className = "settings-change-list";
      for (const change of state.settingsConfirm.changes || []) {
        const item = document.createElement("li");
        item.textContent = change.path + " · " + settingsChangeLabel(change.kind)
          + " · " + compactSettingsValue(change.before) + " → " + compactSettingsValue(change.after);
        changes.append(item);
      }
      if (!changes.children.length) {
        const item = document.createElement("li");
        item.textContent = "没有配置变化。";
        changes.append(item);
      }
      const code = document.createElement("pre");
      code.className = "settings-code mono";
      code.textContent = settingsJsonDiff(
        JSON.stringify(state.settingsData.config, null, 2) + "\n",
        state.settingsConfirm.normalizedJson || JSON.stringify(state.settingsDraft, null, 2) + "\n"
      );
      const diffTitle = document.createElement("h4");
      diffTitle.textContent = "JSON diff";
      const actions = document.createElement("div");
      actions.className = "settings-actions";
      const back = document.createElement("button");
      back.type = "button";
      back.className = "btn";
      back.textContent = "返回编辑";
      back.addEventListener("click", () => {
        state.settingsConfirm = null;
        renderAll();
      });
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = "btn primary";
      confirm.textContent = "确认保存";
      confirm.disabled = !state.settingsConfirm.changes?.length;
      confirm.addEventListener("click", () => saveSettings().catch(showSettingsFailure));
      actions.append(back, confirm);
      section.append(title, changes, diffTitle, code, actions);
      return section;
    }

    async function saveSettings() {
      const response = await settingsFetch("/api/settings/" + state.settingsScope, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: state.settingsData.diskRevision,
          config: state.settingsDraft
        })
      });
      const payload = await response.json();
      if (response.status === 409) {
        state.settingsConfirm = null;
        state.settingsNotice = "保存失败：配置文件已被其他进程修改，请重新读取。";
        renderAll();
        return;
      }
      if (!response.ok) {
        state.settingsConfirm = null;
        state.settingsErrors = payload.errors || [{ path: "", message: payload.error || "保存失败" }];
        renderAll();
        return;
      }
      state.settingsData = payload;
      state.settingsDraft = cloneSettingsValue(payload.config);
      state.settingsConfirm = null;
      state.settingsErrors = [];
      state.settingsNotice = payload.restartRequired
        ? "配置已保存。请执行 memsphere view restart；重启后地址："
          + settingsViewUrl(payload.config.view || payload.defaults.view) + "。"
        : "配置已保存并生效。";
      stashSettingsScope();
      renderAll();
    }

    function showSettingsFailure(error) {
      state.settingsNotice = error instanceof Error ? error.message : String(error);
      renderAll();
    }

    function settingsViewUrl(view) {
      const host = view?.host || "127.0.0.1";
      const port = Number(view?.port || 0);
      return "http://" + host + ":" + port;
    }

    function settingsOptionalPathField(key, label) {
      const wrap = document.createElement("div");
      wrap.className = "settings-field settings-path-field";
      const useDefault = state.settingsDraft[key] === undefined;
      const check = settingsPermissionCheck("使用默认值", useDefault, checked => {
        if (checked) delete state.settingsDraft[key];
        else state.settingsDraft[key] = state.settingsData.defaults[key];
        renderAll();
      });
      const field = settingsTextField(label, useDefault ? state.settingsData.defaults[key] : state.settingsDraft[key], value => {
        state.settingsDraft[key] = value;
      }, {
        path: key,
        disabled: useDefault,
        help: state.settingsData.resolvedPaths[key]
      });
      wrap.append(field, check);
      return wrap;
    }

    function settingsTextField(label, value, onInput, options = {}) {
      const field = document.createElement("div");
      field.className = "settings-field" + (options.wide ? " wide" : "");
      const labelElement = document.createElement("label");
      labelElement.textContent = label;
      const input = document.createElement("input");
      const inputId = "settings-input-" + uuid();
      labelElement.htmlFor = inputId;
      input.id = inputId;
      input.className = "settings-input";
      input.type = options.type || "text";
      input.value = value ?? "";
      input.disabled = Boolean(options.disabled);
      if (options.min !== undefined) input.min = String(options.min);
      if (options.max !== undefined) input.max = String(options.max);
      input.addEventListener(options.commitOnChange ? "change" : "input", () => {
        onInput(input.value);
        state.settingsConfirm = null;
        clearSettingsErrors(options.path);
        refreshSettingsStatus();
      });
      field.append(labelElement, input);
      if (options.help) {
        const help = document.createElement("div");
        help.className = "settings-help";
        help.textContent = options.help;
        field.append(help);
      }
      const error = settingsErrorFor(options.path);
      if (error) field.append(settingsErrorElement(error));
      return field;
    }

    function settingsTextArea(label, value, onInput, path, options = {}) {
      const field = document.createElement("div");
      field.className = "settings-field" + (options.wide === false ? "" : " wide");
      const labelElement = document.createElement("label");
      labelElement.textContent = label;
      const textarea = document.createElement("textarea");
      const textareaId = "settings-textarea-" + uuid();
      labelElement.htmlFor = textareaId;
      textarea.id = textareaId;
      textarea.value = value;
      textarea.addEventListener("input", () => {
        onInput(textarea.value);
        state.settingsConfirm = null;
        clearSettingsErrors(path);
        refreshSettingsStatus();
      });
      field.append(labelElement, textarea);
      const error = settingsErrorFor(path);
      if (error) field.append(settingsErrorElement(error));
      return field;
    }

    function settingsSelectField(label, value, options, onChange) {
      const field = document.createElement("div");
      field.className = "settings-field";
      const labelElement = document.createElement("div");
      labelElement.className = "settings-label";
      labelElement.textContent = label;
      const wrap = document.createElement("div");
      wrap.className = "settings-select-wrap";
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "settings-select settings-select-trigger";
      trigger.setAttribute("role", "combobox");
      trigger.setAttribute("aria-label", label);
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      const selectedLabel = document.createElement("span");
      selectedLabel.textContent = options.find(([optionValue]) => optionValue === value)?.[1] || value;
      const caret = document.createElement("span");
      caret.className = "settings-select-caret";
      caret.setAttribute("aria-hidden", "true");
      caret.textContent = "⌄";
      trigger.append(selectedLabel, caret);
      const menu = document.createElement("div");
      menu.className = "settings-select-menu";
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", label);
      menu.hidden = true;
      const setOpen = open => {
        if (open) {
          for (const other of document.querySelectorAll(".settings-select-menu:not([hidden])")) {
            if (other !== menu) {
              other.hidden = true;
              other.previousElementSibling?.setAttribute("aria-expanded", "false");
            }
          }
        }
        menu.hidden = !open;
        trigger.setAttribute("aria-expanded", String(open));
        if (open) {
          queueMicrotask(() => {
            const close = event => {
              if (!wrap.contains(event.target)) setOpen(false);
            };
            document.addEventListener("pointerdown", close, { once: true });
          });
        }
      };
      for (const [optionValue, optionLabel] of options) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "settings-select-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(optionValue === value));
        option.textContent = optionLabel;
        option.addEventListener("click", () => {
          onChange(optionValue);
          state.settingsConfirm = null;
          renderAll();
        });
        menu.append(option);
      }
      trigger.addEventListener("click", () => setOpen(menu.hidden));
      trigger.addEventListener("keydown", event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
          const choices = [...menu.querySelectorAll(".settings-select-option")];
          const selected = choices.find(option => option.getAttribute("aria-selected") === "true");
          (selected || choices[0])?.focus();
        } else if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
        }
      });
      menu.addEventListener("keydown", event => {
        const choices = [...menu.querySelectorAll(".settings-select-option")];
        const index = choices.indexOf(document.activeElement);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          const offset = event.key === "ArrowDown" ? 1 : -1;
          choices[(index + offset + choices.length) % choices.length]?.focus();
        } else if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
          trigger.focus();
        }
      });
      wrap.append(trigger, menu);
      field.append(labelElement, wrap);
      return field;
    }

    function settingsPermissionCheck(label, checked, onChange) {
      const labelElement = document.createElement("label");
      labelElement.className = "settings-check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = checked;
      input.addEventListener("change", () => onChange(input.checked));
      const text = document.createElement("span");
      text.textContent = label;
      labelElement.append(input, text);
      return labelElement;
    }

    function settingsReadOnly(label, value) {
      const field = document.createElement("div");
      field.className = "settings-field";
      const heading = document.createElement("div");
      heading.className = "settings-label";
      heading.textContent = label;
      const content = document.createElement("div");
      content.className = "mono";
      content.textContent = value;
      field.append(heading, content);
      return field;
    }

    function settingsEmpty(message) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = message;
      return empty;
    }

    function settingsErrorFor(path) {
      if (!path) return state.settingsErrors.find(error => !error.path)?.message || "";
      return state.settingsErrors.find(error => error.path === path || error.path?.startsWith(path + "."))?.message || "";
    }

    function settingsErrorElement(message) {
      const error = document.createElement("div");
      error.className = "settings-error";
      error.textContent = message;
      return error;
    }

    function settingsIsDirty() {
      return JSON.stringify(state.settingsDraft) !== JSON.stringify(state.settingsData.config);
    }

    function refreshSettingsStatus() {
      const current = document.querySelector("#settings-status");
      if (current) current.replaceWith(renderSettingsStatus());
    }

    function clearSettingsErrors(path) {
      if (!path) return;
      state.settingsErrors = state.settingsErrors.filter(error =>
        error.path !== path
        && !error.path?.startsWith(path + ".")
        && !path.startsWith((error.path || "") + ".")
      );
    }

    function renameSettingsActor(currentId, nextId) {
      const clean = nextId.trim();
      if (!clean || clean === currentId) return;
      const actors = state.settingsDraft.control_plane.actors;
      if (actors[clean]) {
        state.settingsNotice = "参与者 ID 已存在：" + clean;
        return;
      }
      actors[clean] = actors[currentId];
      delete actors[currentId];
      state.settingsExpandedParticipants = state.settingsExpandedParticipants.map(value =>
        value === currentId ? clean : value
      );
      renderAll();
    }

    function defaultSettingsAgent() {
      return {
        provider: "traex"
      };
    }

    function defaultSettingsProvider(type) {
      const definition = (state.settingsScopes.global.data?.acpProviderCatalog || [])
        .find(candidate => candidate.type === type);
      const instance = definition?.defaultInstance || {
        type,
        command: definition?.defaultCommand || type,
        args: [],
        env: {},
        startupTimeoutMs: 60000,
        idleTimeoutMs: 120000,
        maxRuntimeMs: null
      };
      return {
        type: instance.type,
        command: instance.command,
        args: [...(instance.args || [])],
        env: { ...(instance.env || {}) },
        startup_timeout_ms: instance.startupTimeoutMs ?? 60000,
        idle_timeout_ms: instance.idleTimeoutMs ?? 120000,
        max_runtime_ms: instance.maxRuntimeMs ?? null
      };
    }

    function settingsProviderEntries() {
      const explicit = state.settingsScopes.global.draft?.acp_providers || {};
      const catalog = state.settingsScopes.global.data?.acpProviderCatalog || [];
      return catalog.map(definition => ({
        id: definition.type,
        builtin: true,
        explicit: Boolean(explicit[definition.type]),
        definition,
        value: {
          ...defaultSettingsProvider(definition.type),
          ...(explicit[definition.type] || {}),
          type: definition.type,
          command: definition.defaultCommand
        }
      }));
    }

    function ensureSettingsProvider(id) {
      const globalDraft = state.settingsScopes.global.draft;
      const providers = globalDraft.acp_providers ||= {};
      if (!providers[id]) {
        const defaults = defaultSettingsProvider(id);
        providers[id] = {
          args: [...defaults.args],
          env: { ...defaults.env },
          startup_timeout_ms: defaults.startup_timeout_ms,
          idle_timeout_ms: defaults.idle_timeout_ms,
          max_runtime_ms: defaults.max_runtime_ms
        };
      }
      return providers[id];
    }

    function settingsProviderReferences(providerId) {
      return (state.settingsScopes.global.data?.providerReferences?.[providerId] || [])
        .map(reference => reference.projectName + " / " + (reference.actorName || reference.actorId));
    }

    function invalidateSettingsProviderDetection(id) {
      state.settingsProviderDetection[id] = { status: "pending_redetect" };
      for (const item of document.querySelectorAll(".settings-provider")) {
        if (item.dataset.providerId !== id) continue;
        const status = item.querySelector(".settings-provider-detection");
        if (status) status.textContent = "待重新检测";
        const preview = item.querySelector(".settings-provider-preview");
        const provider = settingsProviderEntries().find(entry => entry.id === id)?.value;
        if (preview && provider) preview.textContent = "实际启动：" + settingsProviderLaunchPreview(provider);
      }
    }

    function settingsProviderLaunchPreview(provider) {
      const args = [provider.command];
      if (provider.type === "traex") {
        args.push("--sandbox", "workspace-write", "--ask-for-approval", "never", "-c", "model=\"<参与者模型>\"");
      } else if (provider.type === "qwen") {
        args.push("--model", "<参与者模型>", "--approval-mode=auto");
      } else if (provider.type === "kimi") {
        args.push("--model", "<参与者模型>", "--auto");
      } else if (provider.type === "codex") {
        args.unshift(
          "CODEX_CONFIG={\"model\":\"<参与者模型>\"}",
          "NO_BROWSER=1",
          "INITIAL_AGENT_MODE=read-only"
        );
      }
      args.push(...(provider.args || []));
      if (provider.type === "traex") args.push("acp", "serve");
      else if (provider.type === "qwen") args.push("--acp");
      else if (provider.type === "kimi") args.push("acp");
      return args.map(settingsShellArgument).join(" ");
    }

    function settingsShellArgument(value) {
      const text = String(value);
      return /^[A-Za-z0-9_./:=+-]+$/.test(text)
        ? text
        : "'" + text.replace(/'/g, "'\\''") + "'";
    }

    function settingsProviderStatusLabel(result) {
      if (!result) return "待检测";
      return {
        installed: "已安装",
        version_unknown: "版本未知",
        missing: "未安装",
        failed: "检测失败",
        pending_redetect: "待重新检测"
      }[result.status] || "待检测";
    }

    function providerDetectionPill(id) {
      const result = state.settingsProviderDetection[id];
      const label = settingsProviderStatusLabel(result);
      const tone = result?.status === "installed"
        ? "done"
        : result?.status === "missing" || result?.status === "failed" ? "warn" : "";
      const status = pill(label, false, tone);
      status.classList.add("settings-provider-detection");
      return status;
    }

    async function detectSettingsProviders() {
      state.settingsProviderDetecting = true;
      state.settingsNotice = "";
      renderAll();
      try {
        const globalScope = state.settingsScopes.global;
        const response = await settingsFetch("/api/settings/global/acp-providers/detect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedRevision: globalScope.data.diskRevision,
            config: globalScope.draft
          })
        });
        const payload = await response.json();
        if (!response.ok) {
          state.settingsErrors = payload.errors || [{ path: "", message: payload.error || "ACP Provider 检测失败" }];
          return;
        }
        state.settingsProviderDetection = Object.fromEntries(
          (payload.results || []).map(result => [result.id, result])
        );
        persistSettingsProviderDetection();
        state.settingsNotice = "ACP Provider 检测完成。";
      } finally {
        state.settingsProviderDetecting = false;
        renderAll();
      }
    }

    function settingsProviderDetectionStorageKey() {
      return "memsphere.settings.acp-provider-detection";
    }

    function persistSettingsProviderDetection() {
      const globalScope = state.settingsScopes.global;
      if (!globalScope.data?.diskRevision) return;
      localStorage.setItem(settingsProviderDetectionStorageKey(), JSON.stringify({
        diskRevision: globalScope.data.diskRevision,
        providerConfig: JSON.stringify(globalScope.draft.acp_providers || {}),
        detectedAt: Date.now(),
        results: state.settingsProviderDetection
      }));
    }

    function restoreSettingsProviderDetection() {
      const cached = readStoredObject(settingsProviderDetectionStorageKey(), {});
      const fresh = Number.isFinite(cached.detectedAt)
        && Date.now() - cached.detectedAt < 24 * 60 * 60 * 1000;
      const globalScope = state.settingsScopes.global;
      const providerConfig = JSON.stringify(globalScope.draft?.acp_providers || {});
      if (
        cached.diskRevision === globalScope.data?.diskRevision
        && cached.providerConfig === providerConfig
        && fresh
        && cached.results
      ) {
        state.settingsProviderDetection = cached.results;
      } else {
        state.settingsProviderDetection = {};
      }
    }

    function setSettingsPermission(list, permission, enabled) {
      const index = list.indexOf(permission);
      if (enabled && index < 0) list.push(permission);
      if (!enabled && index >= 0) list.splice(index, 1);
    }

    function updateSettingsPermission(actor, key, permission, enabled) {
      const list = actor[key] ? [...actor[key]] : [];
      setSettingsPermission(list, permission, enabled);
      if (key === "permissions" || list.length) actor[key] = list;
      else delete actor[key];
    }

    function setOptionalValue(target, key, value) {
      if (value.trim()) target[key] = value;
      else delete target[key];
    }

    function setOptionalNumber(target, key, value) {
      if (value === "") delete target[key];
      else target[key] = Number(value);
    }

    function optionalNumber(value) {
      return value === undefined ? "" : String(value);
    }

    function shortRevision(value) {
      return typeof value === "string" ? value.replace(/^sha256:/, "").slice(0, 8) : "unknown";
    }

    function compactSettingsValue(value) {
      if (value === undefined) return "未设置";
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return text.length > 90 ? text.slice(0, 87) + "..." : text;
    }

    function settingsJsonDiff(beforeText, afterText) {
      const before = beforeText.trimEnd().split("\n");
      const after = afterText.trimEnd().split("\n");
      let prefix = 0;
      while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
      let suffix = 0;
      while (
        suffix < before.length - prefix
        && suffix < after.length - prefix
        && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
      ) suffix += 1;
      return [
        ...before.slice(0, prefix).map(line => "  " + line),
        ...before.slice(prefix, before.length - suffix).map(line => "- " + line),
        ...after.slice(prefix, after.length - suffix).map(line => "+ " + line),
        ...before.slice(before.length - suffix).map(line => "  " + line)
      ].join("\n");
    }

    function settingsChangeLabel(kind) {
      return ({ added: "新增", removed: "移除", changed: "修改" })[kind] || kind;
    }

    function memoryForRoute(kind, name) {
      return state.memories.find(memory =>
        memory.kind === kind
        && (memory.id === kind + "/" + name || memoryNames(memory).includes(name))
      ) || null;
    }

    function memoryNames(memory) {
      return memory?.entity?.names || memory?.names || [];
    }

    function memorySummaryName(memory) {
      return memoryDisplayName(memory.entity || { names: memoryNames(memory) });
    }

    function memoryForReview(review) {
      const target = review?.target;
      const comment = review?.comments?.[0];
      const snapshot = review?.snapshots?.find(item => item.kind === "memory");
      return state.memories.find(memory => {
        if (target?.path && memory.path === target.path) return true;
        if (target?.id && memory.id === target.id) return true;
        if (comment?.memoryId && memory.id === comment.memoryId) return true;
        return Boolean(snapshot?.label && memory.path === snapshot.label);
      }) || null;
    }

    async function applyBrowserRoute(route, options = {}) {
      state.routeApplying = true;
      state.artifactReviewRequest += 1;
      state.pendingRoute = route;
      state.pendingFragment = route.fragment || "";
      state.routeError = "";
      state.routeLanding = "";
      state.reviewDrawerOpen = false;
      state.artifactReviewModalOpen = false;
      if (el.artifactReviewModal.open) el.artifactReviewModal.close();
      try {
        if (route.page === "invalid") {
          state.viewMode = route.mode || "memory";
          state.routeError = route.error || "Page not found.";
        } else if (["root", "memories"].includes(route.page)) {
          state.viewMode = "memory";
          state.routeLanding = "memories";
        } else if (route.page === "memory") {
          state.viewMode = "memory";
          const memory = memoryForRoute(route.kind, route.name);
          if (memory) {
            state.selectedId = memory.id;
            await loadMemoryDetail(memory.id);
            if (!isCurrentPageLoad(options)) return false;
          }
          else {
            state.selectedId = null;
            state.routeError = "Memory not found: " + route.kind + "/" + route.name;
          }
        } else if (route.page === "memory-review") {
          state.viewMode = "memory";
          const routeMemory = route.kind && route.name ? memoryForRoute(route.kind, route.name) : null;
          if (routeMemory) {
            state.selectedId = routeMemory.id;
            await loadMemoryDetail(routeMemory.id);
            if (!isCurrentPageLoad(options)) return false;
            await loadReviews();
            if (!isCurrentPageLoad(options)) return false;
            await loadReviewDetail(route.reviewId);
            if (!isCurrentPageLoad(options)) return false;
          }
          const review = state.reviews.find(item => item.id === route.reviewId);
          const memory = memoryForReview(review);
          if (route.project && route.project !== state.currentProject) {
            state.routeError = "Project not found: " + route.project;
          } else if (!review) state.routeError = "Memory Review not found: " + route.reviewId;
          else if (!memory) state.routeError = "The Memory for this review is unavailable.";
          else if (route.kind && route.name && !routeMemory) {
            state.routeError = "Memory not found: " + route.kind + "/" + route.name;
          } else if (routeMemory && routeMemory.id !== memory.id) {
            state.routeError = "The Memory Review target does not match the URL Memory.";
          }
          else {
            state.selectedId = memory.id;
            state.selectedReviewId = review.id;
            state.reviewDrawerOpen = true;
            saveSelectedReview();
          }
        } else if (route.page === "tasks") {
          state.viewMode = "task";
          state.routeLanding = "tasks";
        } else if (route.page === "task" || route.page === "artifact-review") {
          state.viewMode = "task";
          let run = state.runs.find(item => item.id === route.runId);
          if (!run) {
            await loadRunDetail(route.runId);
            if (!isCurrentPageLoad(options)) return false;
            run = state.runs.find(item => item.id === route.runId);
          } else {
            await loadRunDetail(run.id);
            if (!isCurrentPageLoad(options)) return false;
            run = state.runs.find(item => item.id === route.runId);
          }
          if (!run) {
            state.selectedTaskId = null;
            state.routeError = "Task not found: " + route.runId;
          } else {
            state.selectedTaskId = run.id;
            saveSelectedTask();
            if (route.page === "artifact-review") {
              const review = artifactReviewSummariesForRun(run).find(item => item.id === route.reviewId);
              if (!review) state.routeError = "Artifact Review not found: " + route.reviewId;
              else {
                state.artifactReviewSelectedByRun[run.id] = review.id;
                state.artifactReviewRoundByReview[review.id] = route.roundId || review.currentRoundId;
                state.pendingArtifactMaterial = route.material || "";
                state.artifactReviewModalOpen = true;
                writeStoredObject(artifactReviewSelectedKey, state.artifactReviewSelectedByRun);
                writeStoredObject(artifactReviewRoundKey, state.artifactReviewRoundByReview);
                await syncArtifactReviewContext(true);
                if (!isCurrentPageLoad(options)) return false;
                if (!el.artifactReviewModal.open) el.artifactReviewModal.showModal();
              }
            }
          }
        } else if (route.page === "settings") {
          state.viewMode = "settings";
          const { scope, module } = route.settings;
          state.settingsModules[scope] = module;
          if (scope !== state.settingsScope) {
            stashSettingsScope();
            applySettingsScope(scope);
          }
          state.settingsModule = module;
          state.settingsModules[scope] = module;
          if (!state.settingsMeta || (!state.settingsScopes.global.data && !state.settingsLoading)) {
            await loadSettings();
          }
        }
        if (state.viewMode === "memory" || state.viewMode === "task") state.lastContentViewMode = state.viewMode;
        localStorage.setItem(viewModeKey, state.viewMode);
        if (options.render) renderAll();
      } finally {
        if (isCurrentPageLoad(options)) state.routeApplying = false;
      }
      if (options.render && !state.routeError) {
        state.routeReplaceNext = true;
        syncBrowserUrl();
      }
      restoreRouteFragment();
      return true;
    }

    function isCurrentPageLoad(options) {
      return options.generation === undefined || options.generation === state.pageLoadGeneration;
    }

    function settingsPublicModule(scope, module) {
      return Object.entries(settingsRouteDestinations)
        .find(([, destination]) => destination.scope === scope && destination.module === module)?.[0]
        || "overview";
    }

    function currentBrowserUrl() {
      let path = "/memories";
      let search = "";
      if (state.viewMode === "settings") {
        path = "/settings/" + settingsPublicModule(state.settingsScope, state.settingsModule);
      } else if (state.viewMode === "task") {
        if (state.routeLanding === "tasks") return "/tasks";
        const run = state.runs.find(item => item.id === state.selectedTaskId) || null;
        if (!run) path = "/tasks";
        else if (state.artifactReviewModalOpen) {
          const review = selectedArtifactReviewSummary();
          if (review) {
            path = "/tasks/" + encodeRoutePart(run.id) + "/artifact-reviews/" + encodeRoutePart(review.id);
            const params = new URLSearchParams();
            const roundId = state.artifactReviewRoundByReview[review.id] || review.currentRoundId;
            if (roundId) params.set("round", roundId);
            const submissionId = state.artifactReviewContext?.submission?.id;
            const material = submissionId ? state.artifactReviewMaterialBySubmission[submissionId] : "";
            if (material && material !== "candidate") params.set("material", material);
            search = params.toString() ? "?" + params.toString() : "";
          } else path = "/tasks/" + encodeRoutePart(run.id);
        } else path = "/tasks/" + encodeRoutePart(run.id);
      } else if (state.reviewDrawerOpen && state.selectedReviewId) {
        const review = state.reviews.find(item => item.id === state.selectedReviewId) || null;
        const memory = memoryForReview(review);
        const memoryName = memoryNames(memory)[0];
        path = review && memoryName && state.currentProject
          ? "/projects/" + encodeRoutePart(state.currentProject)
            + "/memories/" + encodeRoutePart(memory.kind)
            + "/" + encodeRoutePart(memoryName)
            + "/reviews/" + encodeRoutePart(review.id)
          : "/memories";
      } else {
        if (state.routeLanding === "memories") return "/memories";
        const memory = state.memories.find(item => item.id === state.selectedId) || null;
        const memoryName = memoryNames(memory)[0];
        path = memoryName
          ? "/memories/" + encodeRoutePart(memory.kind) + "/" + encodeRoutePart(memoryName)
          : "/memories";
      }
      const currentBase = window.location.pathname + window.location.search;
      const nextBase = path + search;
      const hash = currentBase === nextBase ? window.location.hash : "";
      return nextBase + hash;
    }

    function syncBrowserUrl() {
      if (!state.routeReady || state.routeApplying || state.routeError) return;
      const next = currentBrowserUrl();
      const current = window.location.pathname + window.location.search + window.location.hash;
      if (next === current) {
        state.routeReplaceNext = false;
        return;
      }
      const method = state.routeReplaceNext ? "replaceState" : "pushState";
      history[method](null, "", next);
      state.routeReplaceNext = false;
    }

    function restoreRouteFragment() {
      if (!state.pendingFragment) return;
      const raw = state.pendingFragment.replace(/^#/, "");
      let id = raw;
      try { id = decodeURIComponent(raw); } catch { /* Preserve the raw fragment. */ }
      requestAnimationFrame(() => {
        const target = document.getElementById(id);
        if (!target) return;
        state.pendingFragment = "";
        target.scrollIntoView({ block: "center" });
      });
    }

    function renderRouteError() {
      el.title.textContent = "Not found";
      el.subtitle.textContent = window.location.pathname;
      el.detail.className = "empty";
      el.detail.textContent = state.routeError;
    }

    function finishRouteRender() {
      syncBrowserUrl();
      restoreRouteFragment();
    }

    function renderAll() {
      document.body.classList.toggle("task-mode", state.viewMode === "task");
      document.body.classList.toggle("settings-mode", state.viewMode === "settings");
      document.body.classList.toggle("review-active", canComment());
      document.body.classList.toggle("artifact-review-modal-open", state.artifactReviewModalOpen);
      document.documentElement.classList.toggle("artifact-review-modal-open", state.artifactReviewModalOpen);
      const run = state.runs.find(item => item.id === state.selectedTaskId) || state.runs[0] || null;
      const artifactReview = state.viewMode === "task" ? defaultArtifactReviewSummary(run) : null;
      const taskHasArtifactReview = state.viewMode === "task" && Boolean(artifactReview?.round);
      el.reviewToggle.hidden = state.viewMode === "task" ? !taskHasArtifactReview : false;
      el.reviewToggle.textContent = taskHasArtifactReview
        ? t("artifactReview") + " " + artifactReview.round.submitted + "/" + artifactReview.round.total
        : "Review";
      el.reviewToggle.setAttribute("aria-controls", taskHasArtifactReview ? "artifact-review-modal" : "review-panel");
      if (state.viewMode === "task") state.reviewDrawerOpen = false;
      syncReviewDrawer();
      syncArtifactReviewModalState();
      el.memoryTab.classList.toggle("active", state.viewMode === "memory");
      el.taskTab.classList.toggle("active", state.viewMode === "task");
      el.settingsTab.classList.toggle("active", state.viewMode === "settings");
      el.settingsTab.setAttribute("aria-pressed", String(state.viewMode === "settings"));
      el.settingsTab.setAttribute("aria-label", state.viewMode === "settings" ? "退出设置" : "设置");
      el.settingsTab.title = state.viewMode === "settings" ? "退出设置" : "设置";
      el.settingsTab.textContent = state.viewMode === "settings" ? "\u2190" : "\u2699";
      if (state.viewMode === "settings") {
        state.reviewDrawerOpen = false;
        syncReviewDrawer();
        renderSettingsNav();
        if (state.routeError) renderRouteError();
        else renderSettings();
        finishRouteRender();
        return;
      }
      if (state.viewMode === "task") {
        renderTaskNav();
        if (state.routeError) renderRouteError();
        else {
          renderSelectedTask();
          if (state.artifactReviewModalOpen) renderArtifactReviewPanel();
        }
        restoreOpenInlineEditor();
        finishRouteRender();
        return;
      }
      updateMemoryCount();
      renderNav();
      if (state.routeError) renderRouteError();
      else renderSelected();
      renderReview();
      restoreOpenInlineEditor();
      finishRouteRender();
    }

    async function handleReviewToggle() {
      if (state.viewMode === "task") {
        if (!artifactReviewSummariesForRun().length) return;
        if (state.artifactReviewModalOpen) closeArtifactReviewModal();
        else await openArtifactReviewModal();
        return;
      }
      const open = !state.reviewDrawerOpen;
      setReviewDrawer(open);
      if (open) {
        await loadReviews();
        ensureSelectedReview();
        if (state.selectedReviewId) await loadReviewDetail(state.selectedReviewId);
        renderAll();
      }
    }

    async function openArtifactReviewModal(reviewId) {
      const run = state.runs.find(item => item.id === state.selectedTaskId) || state.runs[0] || null;
      if (!run) return;
      state.routeLanding = "";
      const reviews = artifactReviewSummariesForRun(run);
      const selected = reviews.find(review => review.id === reviewId)
        || defaultArtifactReviewSummary(run);
      if (!selected) return;
      if (!state.artifactReviewModalOpen) {
        state.artifactReviewReturnScrollY = window.scrollY;
        const active = document.activeElement;
        state.artifactReviewReturnFocus = active?.id
          || (active?.dataset?.artifactReviewId ? "review:" + active.dataset.artifactReviewId : "");
        state.artifactReviewReturnFocusTop = active instanceof HTMLElement
          ? active.getBoundingClientRect().top
          : null;
      }
      state.artifactReviewSelectedByRun[run.id] = selected.id;
      writeStoredObject(artifactReviewSelectedKey, state.artifactReviewSelectedByRun);
      if (!state.artifactReviewOpenedRounds[selected.currentRoundId]) {
        state.artifactReviewRoundByReview[selected.id] = selected.currentRoundId;
        state.artifactReviewOpenedRounds[selected.currentRoundId] = true;
        writeStoredObject(artifactReviewRoundKey, state.artifactReviewRoundByReview);
        writeStoredObject(artifactReviewOpenedKey, state.artifactReviewOpenedRounds);
      }
      state.reviewDrawerOpen = false;
      state.artifactReviewModalOpen = true;
      state.artifactReviewLocateFailure = "";
      await syncArtifactReviewContext(true);
      await syncArtifactReviewActivities(true);
      if (!el.artifactReviewModal.open) el.artifactReviewModal.showModal();
      renderAll();
    }

    function closeArtifactReviewModal() {
      const returnScrollY = state.artifactReviewReturnScrollY;
      const returnFocus = state.artifactReviewReturnFocus;
      const returnFocusTop = state.artifactReviewReturnFocusTop;
      state.artifactReviewModalOpen = false;
      state.artifactReviewLocateFailure = "";
      state.artifactReviewReturnScrollY = null;
      state.artifactReviewReturnFocus = "";
      state.artifactReviewReturnFocusTop = null;
      if (el.artifactReviewModal.open) el.artifactReviewModal.close();
      renderAll();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const focusTarget = returnFocus.startsWith("review:")
            ? document.querySelector('[data-artifact-review-id="' + CSS.escape(returnFocus.slice(7)) + '"]')
            : returnFocus ? document.getElementById(returnFocus) : null;
          focusTarget?.focus({ preventScroll: true });
          if (focusTarget instanceof HTMLElement && Number.isFinite(returnFocusTop)) {
            window.scrollBy(0, focusTarget.getBoundingClientRect().top - returnFocusTop);
          } else if (Number.isFinite(returnScrollY)) {
            window.scrollTo(0, returnScrollY);
          }
        });
      });
    }

    function syncArtifactReviewModalState() {
      el.artifactReviewModal.dataset.mobilePane = state.artifactReviewMobilePane;
      el.artifactReviewArtifactTab.classList.toggle("active", state.artifactReviewMobilePane === "artifact");
      el.artifactReviewReviewTab.classList.toggle("active", state.artifactReviewMobilePane === "review");
      document.documentElement.style.setProperty("--artifact-review-left", state.artifactReviewSplit + "%");
      el.artifactReviewModalResizer.setAttribute("aria-valuenow", String(state.artifactReviewSplit));
      el.reviewToggle.setAttribute("aria-expanded", String(state.artifactReviewModalOpen || state.reviewDrawerOpen));
    }

    function setArtifactReviewMobilePane(pane) {
      state.artifactReviewMobilePane = pane === "review" ? "review" : "artifact";
      localStorage.setItem(artifactReviewMobilePaneKey, state.artifactReviewMobilePane);
      syncArtifactReviewModalState();
    }

    function setArtifactReviewSplit(value, persist) {
      state.artifactReviewSplit = Math.min(75, Math.max(30, Math.round(value)));
      document.documentElement.style.setProperty("--artifact-review-left", state.artifactReviewSplit + "%");
      el.artifactReviewModalResizer.setAttribute("aria-valuenow", String(state.artifactReviewSplit));
      if (persist) localStorage.setItem(artifactReviewSplitKey, String(state.artifactReviewSplit));
    }

    function beginArtifactReviewModalResize(event) {
      if (!state.artifactReviewModalOpen || window.innerWidth <= 760 || event.button !== 0) return;
      event.preventDefault();
      const pointerId = event.pointerId;
      const body = el.artifactReviewModal.querySelector(".artifact-review-modal-body");
      const bounds = body.getBoundingClientRect();
      document.body.classList.add("artifact-review-resizing");
      el.artifactReviewModalResizer.setPointerCapture(pointerId);
      const move = moveEvent => setArtifactReviewSplit(((moveEvent.clientX - bounds.left) / bounds.width) * 100, false);
      const finish = () => {
        if (el.artifactReviewModalResizer.hasPointerCapture(pointerId)) el.artifactReviewModalResizer.releasePointerCapture(pointerId);
        el.artifactReviewModalResizer.removeEventListener("pointermove", move);
        el.artifactReviewModalResizer.removeEventListener("pointerup", finish);
        el.artifactReviewModalResizer.removeEventListener("pointercancel", finish);
        document.body.classList.remove("artifact-review-resizing");
        setArtifactReviewSplit(state.artifactReviewSplit, true);
      };
      el.artifactReviewModalResizer.addEventListener("pointermove", move);
      el.artifactReviewModalResizer.addEventListener("pointerup", finish);
      el.artifactReviewModalResizer.addEventListener("pointercancel", finish);
      move(event);
    }

    function resizeArtifactReviewModalWithKeyboard(event) {
      const step = event.shiftKey ? 8 : 3;
      if (event.key === "ArrowLeft") setArtifactReviewSplit(state.artifactReviewSplit - step, true);
      else if (event.key === "ArrowRight") setArtifactReviewSplit(state.artifactReviewSplit + step, true);
      else if (event.key === "Home") setArtifactReviewSplit(30, true);
      else if (event.key === "End") setArtifactReviewSplit(75, true);
      else return;
      event.preventDefault();
    }

    async function setViewMode(mode, options = {}) {
      state.pageLoadGeneration += 1;
      state.routeError = "";
      if (options.landing) state.routeLanding = mode === "task" ? "tasks" : mode === "memory" ? "memories" : "";
      else if (mode === "settings") state.routeLanding = "";
      if (!state.routeReady) {
        if (mode === "task") state.pendingRoute = { page: "tasks", fragment: "" };
        else if (mode === "memory") state.pendingRoute = { page: "memories", fragment: "" };
        else if (mode === "settings") {
          state.pendingRoute = {
            page: "settings",
            settings: { scope: state.settingsScope, module: state.settingsModule },
            fragment: ""
          };
        }
      }
      state.viewMode = mode;
      if (mode === "memory" || mode === "task") state.lastContentViewMode = mode;
      localStorage.setItem(viewModeKey, mode);
      ensureSelectedReview();
      if (mode === "settings" || mode === "task") {
        state.reviewDrawerOpen = false;
      }
      renderAll();
      if (mode === "settings") {
        if (!state.settingsMeta || (!state.settingsData && !state.settingsLoading)) {
          await loadSettings();
          renderAll();
        }
        return;
      }
      if (mode === "memory") {
        await loadMemories();
        await loadMemoryDetail(state.selectedId || state.memories[0]?.id);
      } else if (mode === "task") {
        await loadRuns({ loadDetail: false });
        await loadRunDetail(state.selectedTaskId || state.runs[0]?.id);
      }
      renderAll();
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
      syncBrowserUrl();
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
        const identity = memory.error ? memory.path : memory.id;
        return [memory.kind, identity, errorText(memory.error), ...memoryNames(memory)].join(" ").toLowerCase().includes(q);
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
          button.textContent = memory.error ? invalidMemoryName(memory) : memorySummaryName(memory);
          button.title = memory.error ? errorText(memory.error) : memory.id;
          button.addEventListener("click", async () => {
            state.routeError = "";
            state.routeLanding = "";
            state.selectedId = memory.id;
            state.selectedReviewId = null;
            if (state.reviewDrawerOpen) state.reviews = [];
            renderAll();
            await loadMemorySelection(memory.id);
            renderAll();
          });
          list.append(button);
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
      return memory?.system === true;
    }

    function updateMemoryCount() {
      el.count.textContent = state.filtered.length + " memories";
    }

    function renderTaskNav() {
      el.nav.innerHTML = "";
      const activeRuns = state.runs.filter(run => run.archived !== true && run.readOnly !== true);
      el.count.textContent = activeRuns.length + " tasks";
      if (!activeRuns.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "No task runs yet.";
        el.nav.append(empty);
        return;
      }

      for (const status of ["running", "done"]) {
        const group = activeRuns.filter(run => run.status === status);
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
          title.textContent = runDisplayName(run);
          const meta = document.createElement("span");
          meta.className = "muted";
          meta.textContent = shortRunId(run.id) + " · " + (run.eventCount ?? run.events?.length ?? 0) + " artifact(s)";
          const reviewProgress = run.artifactReview?.round || run.reviewProgress;
          if (reviewProgress) {
            meta.append(
              " · ",
              t("pendingReview") + " " + reviewProgress.submitted + "/" + reviewProgress.total
            );
          }
          button.append(title, meta);
          button.addEventListener("click", async () => {
            state.routeError = "";
            state.routeLanding = "";
            const changedTask = state.selectedTaskId !== run.id;
            state.selectedTaskId = run.id;
            saveSelectedTask();
            if (changedTask) state.artifactReviewContext = null;
            renderAll();
            if (changedTask) scrollTaskDetailToTop();
            await loadRunDetail(run.id);
            renderAll();
          });
          card.append(button, archiveRunButton(run, "task-card-archive"));
          list.append(card);
        }
        el.nav.append(list);
      }
    }

    function selectedTask() {
      return state.runs.find(run => run.id === state.selectedTaskId) || state.runs[0] || null;
    }

    function runDisplayName(run) {
      return run?.name?.trim() || run?.procedureName || "";
    }

    function renderSelectedTask() {
      const run = selectedTask();
      if (!run) {
        el.title.textContent = "Tasks";
        el.subtitle.textContent = "No runs found.";
        el.detail.className = "empty";
        el.detail.innerHTML = 'Start one with <code>memsphere run start &lt;procedure&gt; --name &lt;run-name&gt;</code>.';
        return;
      }

      state.selectedTaskId = run.id;
      saveSelectedTask();
      el.title.textContent = runDisplayName(run);
      el.subtitle.textContent = run.id;
      if (!Array.isArray(run.stack) || !Array.isArray(run.events)) {
        el.detail.className = "empty";
        el.detail.textContent = "Loading task...";
        return;
      }
      el.detail.className = "task-summary";
      el.detail.innerHTML = "";
      el.detail.append(renderRunMeta(run));
      appendOptional(el.detail, renderRunProcedureAsserts(run));
      appendOptional(el.detail, renderRunBindings(run));
      if (run.plan && run.plan.length) {
        el.detail.append(renderRunFlow(run));
        el.detail.append(renderFinalArtifacts(run));
      }
      else el.detail.append(renderRunArtifacts(run));
    }

    function renderRunMeta(run) {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.append(pill(t("procedureName") + ": " + run.procedureName));
      meta.append(pill(run.status, false, statusPillClass(run.status)));
      if (run.contractVersion === 1 || run.readOnly) meta.append(pill(t("legacyReadOnly"), false, "warn"));
      meta.append(pill(run.stack.length + " active frame(s)"));
      meta.append(pill(run.events.length + " artifact(s)"));
      meta.append(pill("updated " + formatTime(run.updatedAt)));
      if (run.artifactReview?.round) {
        const reviewStatus = artifactReviewRoundStatusLabel(run.artifactReview.round.status);
        const reviewButton = document.createElement("button");
        reviewButton.type = "button";
        reviewButton.className = "pill strong " + (run.artifactReview.status === "awaiting_revision" ? "warn" : "processing");
        reviewButton.textContent = reviewStatus + " " + run.artifactReview.round.submitted + "/" + run.artifactReview.round.total;
        reviewButton.addEventListener("click", () => openArtifactReviewModal(run.artifactReview.id));
        meta.append(reviewButton);
      }
      const activeStep = currentRunStep(run);
      if (activeStep && run.plan && run.plan.length) meta.append(currentStepJumpButton(run));
      const review = selectedReview();
      const commentCount = review ? review.comments.filter(comment => comment.memoryId === "task/" + run.id).length : 0;
      if (commentCount) meta.append(pill(commentCount + " review comments", false, "warn"));
      return meta;
    }

    function renderRunBindings(run) {
      const slots = Object.entries(run.reviewConfiguration?.slots || {});
      const actors = Object.entries(run.controlPlane?.actors || {});
      if (!slots.length || !actors.length) return null;
      const panel = document.createElement("section");
      panel.className = "panel run-bindings";
      panel.append(blockTitle(displayLanguage === "zh" ? "运行期评审绑定" : "Runtime review bindings"));
      const help = document.createElement("div");
      help.className = "muted";
      help.textContent = displayLanguage === "zh"
        ? "换绑只影响尚未创建的 Review；已创建 Review 的参与者保持不变。"
        : "Changes affect only Reviews that have not been created; existing Review participants stay frozen.";
      panel.append(help);
      const list = document.createElement("div");
      list.className = "run-binding-list";
      const bindingSnapshotSlots = new Map((run.bindingSnapshot?.slots || []).map(item => [item.key, item]));
      for (const [slot, binding] of slots) {
        const row = document.createElement("div");
        row.className = "run-binding-row";
        const head = document.createElement("div");
        head.className = "run-binding-head";
        const name = document.createElement("b");
        name.textContent = artifactReviewRoleDisplayName(slot);
        const bindingSnapshot = bindingSnapshotSlots.get(slot);
        const scopeCount = bindingSnapshot?.reviewScopes?.length || 0;
        head.append(name, pill(scopeCount + (displayLanguage === "zh" ? " 个 Review scope" : " Review scopes")));
        if (bindingSnapshot?.reviewIds?.length) {
          head.append(pill(bindingSnapshot.reviewIds.length + (displayLanguage === "zh" ? " 个既有 Review 保持不变" : " existing Reviews preserved"), false, "done"));
        }
        row.append(head);

        const actorChoices = document.createElement("div");
        actorChoices.className = "run-binding-actors";
        const selected = new Set(binding.actorIds || []);
        for (const [actorId, actor] of actors) {
          const label = document.createElement("label");
          label.className = "run-binding-actor";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.value = actorId;
          checkbox.checked = selected.has(actorId);
          checkbox.disabled = run.status !== "running" || run.readOnly || binding.skip === true;
          label.append(checkbox, document.createTextNode(actor.name + " · " + actor.kind));
          actorChoices.append(label);
        }
        row.append(actorChoices);

        const actions = document.createElement("div");
        actions.className = "run-binding-actions";
        const skipLabel = document.createElement("label");
        skipLabel.className = "run-binding-actor";
        const skip = document.createElement("input");
        skip.type = "checkbox";
        skip.checked = binding.skip === true;
        skip.disabled = run.status !== "running" || run.readOnly;
        skip.addEventListener("change", () => {
          for (const checkbox of actorChoices.querySelectorAll('input[type="checkbox"]')) checkbox.disabled = skip.checked;
        });
        skipLabel.append(skip, document.createTextNode(displayLanguage === "zh" ? "跳过未来评审" : "Skip future reviews"));
        const save = document.createElement("button");
        save.type = "button";
        save.className = "btn primary";
        save.textContent = displayLanguage === "zh" ? "更新绑定" : "Update binding";
        save.disabled = run.status !== "running" || run.readOnly;
        save.addEventListener("click", () => runButtonAction(save, async () => {
          const actorIds = [...actorChoices.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
          await updateRunBinding(run, slot, skip.checked, actorIds);
        }));
        actions.append(skipLabel, save);
        row.append(actions);
        list.append(row);
      }
      panel.append(list);
      if (run.bindingChanges?.length) {
        panel.append(blockTitle(displayLanguage === "zh" ? "换绑历史" : "Binding history"));
        const history = document.createElement("ul");
        history.className = "run-binding-history";
        for (const change of [...run.bindingChanges].reverse()) {
          const item = document.createElement("li");
          item.textContent = formatTime(change.changedAt) + " · " + artifactReviewRoleDisplayName(change.slot)
            + " · " + runBindingValueLabel(change.before, run) + " → " + runBindingValueLabel(change.after, run);
          history.append(item);
        }
        panel.append(history);
      }
      return panel;
    }

    async function updateRunBinding(run, slot, skip, actorIds) {
      const response = await settingsFetch("/api/runs/" + encodeURIComponent(run.id) + "/bindings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(skip ? { slot, skip: true } : { slot, actorIds })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || await response.text());
      }
      await loadRuns();
      renderAll();
    }

    function runBindingValueLabel(binding, run) {
      if (binding?.skip) return displayLanguage === "zh" ? "跳过" : "skip";
      return (binding?.actorIds || []).map(actorId => run.controlPlane?.actors?.[actorId]?.name || actorId).join(", ");
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
      appendOptional(item, renderSchemaWriting(run, step));
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
      const reviewSummary = artifactReviewForStep(run, step);
      if (!shouldRenderTaskStepArtifact(event) && !reviewContext && !reviewSummary) return null;
      const box = document.createElement("div");
      box.className = "task-result";
      const title = document.createElement("div");
      title.className = "block-title";
      title.textContent = reviewContext ? t("reviewedArtifact") : t("artifactContent");
      const artifact = reviewContext ? reviewContext.submission.artifact : event?.artifact;
      const value = artifact ? renderArtifactValue(artifact) : null;
      if (reviewSummary) {
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.append(pill(
          artifactReviewRoundStatusLabel(reviewSummary.round.status),
          false,
          reviewSummary.status === "awaiting_revision" ? "warn" : reviewSummary.status === "passed" ? "done" : "processing"
        ));
        meta.append(pill(t("round") + " " + reviewSummary.round.sequence));
        meta.append(openArtifactReviewButton(reviewSummary));
        box.append(meta);
      }
      box.append(title);
      if (value) box.append(value);
      return box;
    }

    function artifactReviewForStep(run, step) {
      return artifactReviewSummariesForRun(run).find(review => review.stepId === step.id) || null;
    }

    function openArtifactReviewButton(review) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pill current-step-jump";
      button.textContent = t("artifactReview");
      button.dataset.artifactReviewId = review.id;
      button.addEventListener("click", () => openArtifactReviewModal(review.id));
      return button;
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
      if (run.schemaWriting?.parentStepId) {
        return findRunStepById(run.plan || [], run.schemaWriting.parentStepId);
      }
      const frame = currentRunFrame(run);
      return frame ? frame.steps[frame.index] : null;
    }

    function findRunStepById(steps, id) {
      for (const step of steps || []) {
        if (step.id === id) return step;
        const branch = findRunStepById(step.branches?.truthy, id)
          || findRunStepById(step.branches?.falsy, id)
          || findRunStepById(step.loop?.body, id);
        if (branch) return branch;
      }
      return null;
    }

    function renderSchemaWriting(run, step) {
      const snapshot = run.schemaWriting;
      if (!snapshot || snapshot.parentStepId !== step.id) return null;
      const wrap = document.createElement("div");
      wrap.className = "schema-writing";
      wrap.append(blockTitle(t("schemaWriting")));

      const progress = document.createElement("div");
      progress.className = "schema-writing-progress";
      progress.append(pill(t("schemaProgress") + " " + snapshot.progress.completed + "/" + snapshot.progress.total));
      progress.append(pill(t("remaining") + " " + snapshot.progress.remaining));
      if (snapshot.draft?.status === "awaiting_finalization") {
        progress.append(pill(t("globalAdjustment"), false, "warn"));
      }
      if (snapshot.currentField?.path) progress.append(pill(snapshot.currentField.path, false, "strong"));
      wrap.append(progress);

      for (const source of snapshot.currentField?.sources || []) {
        const section = document.createElement("div");
        section.className = "schema-writing-source";
        const heading = document.createElement("div");
        heading.textContent = t("constraintSource") + " · " + source.path;
        section.append(heading);
        const values = [];
        for (const value of source.defines || []) values.push("defines: " + value);
        for (const value of source.asserts || []) values.push("asserts: " + value);
        for (const value of source.suggests || []) values.push("suggests: " + value);
        if (values.length) {
          const list = document.createElement("ul");
          list.className = "text-list";
          for (const value of values) {
            const item = document.createElement("li");
            item.textContent = value;
            list.append(item);
          }
          section.append(list);
        }
        wrap.append(section);
      }

      if (snapshot.draft) {
        const preview = document.createElement("details");
        preview.className = "schema-draft-preview";
        preview.open = snapshot.draft.status === "awaiting_finalization";
        const summary = document.createElement("summary");
        summary.textContent = t("managedDraft");
        preview.append(summary);
        const path = document.createElement("div");
        path.className = "schema-draft-path mono";
        path.textContent = snapshot.draft.filePath;
        preview.append(path);
        if (snapshot.draft.validation) {
          const validation = document.createElement("div");
          validation.className = "meta";
          validation.append(pill(
            t("contractValidation") + " · " + snapshot.draft.validation.status,
            false,
            snapshot.draft.validation.status === "passed" ? "done" : "warn"
          ));
          preview.append(validation);
        }
        if (typeof snapshot.draft.renderedContent === "string") {
          const content = document.createElement("div");
          content.className = "markdown-body";
          content.innerHTML = snapshot.draft.renderedContent;
          preview.append(content);
        } else if (snapshot.draft.contentError) {
          const error = document.createElement("div");
          error.className = "muted";
          error.textContent = snapshot.draft.contentError;
          preview.append(error);
        }
        if (snapshot.draft.status === "awaiting_finalization") {
          const command = document.createElement("div");
          command.className = "pre mono";
          command.textContent = "memsphere run report --run " + shellQuote(run.id)
            + " --artifact-file " + shellQuote(snapshot.draft.filePath);
          preview.append(command);
        }
        wrap.append(preview);
      }
      return wrap;
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
        || state.filtered[0];
    }

    function selectedReview() {
      return filteredReviews().find(review => review.id === state.selectedReviewId) || null;
    }

    function activeArtifactReviewSummary() {
      if (state.viewMode !== "task") return null;
      const run = state.runs.find(item => item.id === state.selectedTaskId) || state.runs[0] || null;
      return run?.artifactReview || null;
    }

    function artifactReviewSummariesForRun(run) {
      const selectedRun = run || (state.viewMode === "task"
        ? state.runs.find(item => item.id === state.selectedTaskId) || state.runs[0] || null
        : null);
      return selectedRun?.artifactReviewSummaries || (selectedRun?.artifactReview ? [selectedRun.artifactReview] : []);
    }

    function defaultArtifactReviewSummary(run) {
      if (!run) return null;
      if (run.artifactReview) return run.artifactReview;
      return artifactReviewSummariesForRun(run).reduce((latest, review) => {
        if (!latest) return review;
        const latestTime = new Date(latest.updatedAt || latest.createdAt || 0).getTime();
        const reviewTime = new Date(review.updatedAt || review.createdAt || 0).getTime();
        return reviewTime >= latestTime ? review : latest;
      }, null);
    }

    function selectedArtifactReviewSummary() {
      const run = state.runs.find(item => item.id === state.selectedTaskId) || state.runs[0] || null;
      if (!run) return null;
      const reviews = artifactReviewSummariesForRun(run);
      const reviewId = state.artifactReviewSelectedByRun[run.id];
      return reviews.find(review => review.id === reviewId) || defaultArtifactReviewSummary(run);
    }

    function isArtifactReviewMode() {
      return Boolean(state.artifactReviewModalOpen && state.artifactReviewContext);
    }

    function filteredReviews() {
      const subject = reviewListSubject();
      if (!subject) return [];
      return state.reviews.filter(review => reviewMatchesSubject(review, subject));
    }

    function reviewListSubject() {
      if (state.viewMode !== "memory") return null;
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
        if (review.target.path && subject.path) return review.target.path === subject.path;
        return review.target.id === subject.id;
      }

      return review.snapshots?.some(snapshot => snapshot.kind === "memory" && snapshot.label === subject.path)
        || review.comments?.some(comment => comment.memoryId === subject.id);
    }

    function reviewSource(review) {
      if (review.source === "memory") return review.source;
      return "invalid";
    }

    function currentReviewSubject() {
      if (state.viewMode !== "memory") return null;
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
        );
      }
      const status = selectedReview()?.status;
      return status === "draft" || status === "submitted";
    }

    function canCreateReview() {
      const subject = currentReviewSubject();
      return Boolean(subject);
    }

    function reviewCreationDisabledReason() {
      const subject = currentReviewSubject();
      if (!subject) return "Select a Memory before creating a review";
      return "";
    }

    function renderSelected() {
      const review = selectedReview();
      if (review && !Array.isArray(review.comments)) {
        el.title.textContent = "Review";
        el.subtitle.textContent = review.id;
        el.detail.className = "empty";
        el.detail.textContent = "Loading review...";
        return;
      }
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
      if (!memory.entity && !memory.error) {
        el.title.textContent = memorySummaryName(memory);
        el.subtitle.textContent = memory.id;
        el.detail.className = "empty";
        el.detail.textContent = "Loading...";
        return;
      }
      if (memory.error) {
        if (!currentReviewSnapshot("memory")) state.selectedId = memory.id;
        renderInvalidMemory(memory);
        return;
      }
      if (!currentReviewSnapshot("memory")) state.selectedId = memory.id;
      el.title.textContent = memoryDisplayName(memory.entity);
      el.subtitle.textContent = memory.id;
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

    function memoryDisplayName(entity) {
      if (!entity || !Array.isArray(entity.names)) return "(unnamed)";
      return entity.names[1] || entity.names[0] || "(unnamed)";
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
      const direct = state.memories.find(memory => memory.id === value);
      if (direct) return direct;
      const separator = value.indexOf("/");
      if (separator > 0) {
        const kind = value.slice(0, separator);
        const name = value.slice(separator + 1);
        return state.memories.find(memory =>
          memory.kind === kind && memoryNames(memory).includes(name)
        ) || null;
      }
      return state.byName.get(value) || null;
    }

    function openMemoryReference(reference) {
      const target = memoryByReference(reference);
      if (!target) return;
      state.routeError = "";
      state.routeLanding = "";
      state.viewMode = "memory";
      localStorage.setItem(viewModeKey, "memory");
      state.selectedId = target.id;
      state.selectedReviewId = null;
      if (state.reviewDrawerOpen) state.reviews = [];
      renderAll();
      loadMemorySelection(target.id).then(renderAll).catch(renderFatalError);
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
      link.textContent = target ? memoryNames(target)[0] : (name || "(missing target)");
      link.title = target ? "Open called memory" : "Called memory not found";
      link.addEventListener("click", (event) => {
        event.preventDefault();
        if (target) {
          openMemoryReference(target.id);
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
      const slotIds = Object.keys(bindings);
      if (!slotIds.length) return;

      const reviewLine = document.createElement("div");
      reviewLine.className = "artifact-meta-line artifact-review-line";
      const label = document.createElement("span");
      label.className = "artifact-label";
      label.textContent = t("reviewers");
      reviewLine.append(label);
      for (const roleId of slotIds) reviewLine.append(pill(artifactReviewRoleDisplayName(roleId)));
      target.append(reviewLine);
    }

    function effectiveArtifactReviewBindings(step, artifact) {
      if (state.viewMode === "task" && step?.controlPlane?.bindings) return step.controlPlane.bindings;
      const slots = Array.isArray(artifact.review) ? artifact.review : [];
      return Object.fromEntries(slots.map(slot => [slot, { actorIds: [] }]));
    }

    function artifactReviewRoleDisplayName(roleId) {
      if (state.viewMode === "task") {
        return roleId.includes("::") ? roleId.slice(roleId.lastIndexOf("::") + 2) : roleId;
      }
      return roleId.includes("::") ? roleId.slice(roleId.lastIndexOf("::") + 2) : roleId;
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
      if (schema.suggests?.length) parts.push(schema.suggests.length + " " + t("suggests"));
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
          openMemoryReference(target.id);
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
      const value = artifact.value;
      return value !== null && typeof value === "object" ? JSON.stringify(value, null, 2) : value ?? "";
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
          review: step.artifact.review || []
        };
      }
      return {
        name: typeof step?.artifact === "string" ? step.artifact : "",
        type: step?.type || "",
        format: step?.format || { name: "plain", options: {} },
        schema: step?.schema,
        final: Boolean(step?.final),
        review: step?.reviewPolicy || ""
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

    function openInlineEditor(host, target, snapshot, location, context = {}, insertAtStart = false, initialBody = "") {
      if (!canComment() || !host) return;
      closeInlineEditors();
      const artifactReviewScope = currentArtifactReviewDraftScope();
      state.inlineCommentDraft = artifactReviewScope
        ? {
          target,
          snapshot,
          location,
          context,
          insertAtStart,
          body: initialBody,
          artifactReviewScope
        }
        : null;
      const editor = document.createElement("div");
      editor.className = "inline-comment-editor";
      const textarea = document.createElement("textarea");
      textarea.placeholder = "What should change here?";
      textarea.value = initialBody;
      textarea.addEventListener("input", () => {
        if (state.inlineCommentDraft && state.inlineCommentDraft.location?.anchor === location?.anchor) {
          state.inlineCommentDraft.body = textarea.value;
        }
      });
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
          if (comment) {
            state.inlineCommentDraft = null;
            editor.remove();
            scrollToComment(comment);
            return true;
          }
          return false;
        });
      });
      cancel.addEventListener("click", () => {
        state.inlineCommentDraft = null;
        if (isArtifactReviewMode()) {
          discardArtifactReviewPendingComment(state.artifactReviewContext, context.pendingCommentId);
          delete context.pendingCommentId;
        }
        editor.remove();
      });
      actions.append(save, cancel);
      editor.append(textarea, actions);
      if (insertAtStart) host.prepend(editor);
      else host.append(editor);
      textarea.focus();
    }

    function restoreOpenInlineEditor() {
      const draft = state.inlineCommentDraft;
      if (!draft?.artifactReviewScope || !canComment()) return;
      if (!sameArtifactReviewDraftScope(draft.artifactReviewScope, currentArtifactReviewDraftScope())) return;
      const host = document.getElementById(domIdForAnchor(draft.location?.anchor));
      if (!host || host.querySelector(".inline-comment-editor")) return;
      openInlineEditor(host, draft.target, draft.snapshot, draft.location, draft.context || {}, draft.insertAtStart, draft.body);
    }

    function currentArtifactReviewDraftScope() {
      if (!isArtifactReviewMode()) return null;
      const context = state.artifactReviewContext;
      if (!context?.assignment) return null;
      return {
        reviewId: context.review.id,
        roundId: context.review.currentRoundId,
        actorId: context.assignment.actorId
      };
    }

    function sameArtifactReviewDraftScope(left, right) {
      if (!left && !right) return true;
      if (!left || !right) return false;
      return left.reviewId === right.reviewId
        && left.roundId === right.roundId
        && left.actorId === right.actorId;
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
          if (
            !candidate
            || candidate.submissionId !== state.artifactReviewContext?.submission?.id
            || candidate.sourceHash !== state.artifactReviewContext?.submission?.digest
          ) return false;
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
      if (Object.values(state.artifactReviewActivities).some(entry => entry.expanded && !entry.pinnedToBottom)) return true;
      return Boolean(document.activeElement?.matches?.(".artifact-review-select"));
    }

    function setAllSections(open) {
      for (const section of el.detail.querySelectorAll(".section")) section.classList.toggle("open", open);
    }

    async function createReview() {
      if (!canCreateReview()) return;
      const subject = currentReviewSubject();
      const title = subject ? "Memory review · " + subject.name : undefined;
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          source: "memory",
          memoryId: subject?.id,
          memoryName: subject?.name,
          memoryPath: subject?.path
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const review = (await response.json()).review;
      state.reviewDetails.set(review.id, review);
      state.reviews.unshift(review);
      state.selectedReviewId = review.id;
      saveSelectedReview();
      renderAll();
    }

    async function addComment(target, snapshot, body, location, context = {}) {
      if (isArtifactReviewMode()) {
        const reviewContext = state.artifactReviewContext;
        if (!reviewContext || !canComment()) return;
        const commentId = context.pendingCommentId || uuid();
        context.pendingCommentId = commentId;
        const comment = {
          id: commentId,
          body,
          severity: "risk",
          anchor: {
            submissionId: reviewContext.submission.id,
            target: String(target || "").trim(),
            location: String(location?.anchor || ""),
            sourceHash: reviewContext.submission.digest,
            context: String(snapshot ?? "").trim().slice(0, 500) || undefined
          },
          _mineDraft: true
        };
        const draft = artifactReviewEffectiveDraft(reviewContext);
        const result = await saveArtifactReviewDraft({
          ...draft,
          comments: draft.comments.some(existing => existing.id === comment.id)
            ? draft.comments.map(existing => existing.id === comment.id ? comment : existing)
            : draft.comments.concat(comment)
        }, { changedCommentIds: [comment.id] });
        if (result.ok) delete context.pendingCommentId;
        return result.ok ? comment : null;
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
        const draft = artifactReviewEffectiveDraft(context);
        const result = await saveArtifactReviewDraft({
          ...draft,
          comments: draft.comments.filter(comment => comment.id !== id)
        }, { deletedCommentIds: [id] });
        return result.ok;
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
      state.reviewDetails.delete(id);
      state.reviews = state.reviews.filter(item => item.id !== id);
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
      state.runDetails.delete(run.id);
      state.runs = state.runs.filter(item => item.id !== run.id);
      if (!state.selectedTaskId) state.selectedTaskId = state.runs[0]?.id || null;
      saveSelectedTask();
      if (state.selectedTaskId) await loadRunDetail(state.selectedTaskId);
      renderAll();
    }

    async function archiveReviewById(id) {
      const review = state.reviews.find(item => item.id === id);
      if (!review || review.status !== "done") return;
      if (!confirm(t("archiveReviewConfirm"))) return;
      const response = await fetch("/api/archive/reviews/" + encodeURIComponent(review.id), { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      state.reviewSnapshots.delete(review.id + ":memory");
      if (state.selectedReviewId === review.id) {
        state.selectedReviewId = null;
        saveSelectedReview();
      }
      state.reviewDetails.delete(review.id);
      state.reviews = state.reviews.filter(item => item.id !== review.id);
      renderAll();
    }

    async function updateComment(id, body) {
      if (isArtifactReviewMode()) {
        const context = state.artifactReviewContext;
        if (!context || !canComment()) return;
        const draft = artifactReviewEffectiveDraft(context);
        const result = await saveArtifactReviewDraft({
          ...draft,
          comments: draft.comments.map(comment => comment.id === id ? { ...comment, body } : comment)
        }, { changedCommentIds: [id] });
        return result.ok;
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
      const selectedRoundId = state.artifactReviewRoundByReview[context.review.id] || context.review.currentRoundId;
      const draft = artifactReviewEffectiveDraft(context);
      const comments = selectedRoundId === context.review.currentRoundId && context.assignment?.status === "draft"
        ? (draft.comments || []).map(comment => ({ ...comment, _mineDraft: true }))
        : [];
      const selectedRounds = (context.rounds || []).filter(round => round.id === selectedRoundId);
      for (const round of selectedRounds) {
        for (const assignment of round.assignments || []) {
          for (const comment of assignment.submitted?.comments || []) {
            comments.push({
              ...comment,
              _mineDraft: false,
              _actorName: artifactReviewRoleName(assignment),
              _binding: assignment.binding,
              _round: round.sequence
            });
          }
        }
      }
      return comments;
    }

    function artifactReviewDraftKey(context) {
      if (!context?.review || !context?.assignment) return "";
      return [context.review.id, context.review.currentRoundId, context.assignment.actorId].join(":");
    }

    function artifactReviewLocalEntry(context) {
      const key = artifactReviewDraftKey(context);
      return key ? state.artifactReviewDrafts[key] : null;
    }

    function normalizeArtifactReviewDraftForClient(draft = {}) {
      return {
        vote: draft.vote,
        comments: (draft.comments || []).map(comment => ({
          id: comment.id,
          body: comment.body,
          severity: comment.severity,
          anchor: comment.anchor
        }))
      };
    }

    function artifactReviewServerDraft(context) {
      return normalizeArtifactReviewDraftForClient(context?.assignment?.draft || {});
    }

    function artifactReviewEffectiveDraft(context) {
      const entry = artifactReviewLocalEntry(context);
      return entry?.dirty ? entry.draft : artifactReviewServerDraft(context);
    }

    function ensureArtifactReviewLocalEntry(context) {
      const key = artifactReviewDraftKey(context);
      if (!key) return null;
      const entry = state.artifactReviewDrafts[key] ||= {
        draft: artifactReviewServerDraft(context),
        dirty: false,
        voteDirty: false,
        changedCommentIds: {},
        deletedCommentIds: {},
        composerText: "",
        composerSeverity: "risk",
        pendingComposerCommentId: "",
        status: "",
        warning: ""
      };
      if (!entry.dirty) entry.draft = artifactReviewServerDraft(context);
      return entry;
    }

    function setArtifactReviewLocalDraft(context, draft, change = {}) {
      const entry = ensureArtifactReviewLocalEntry(context);
      if (!entry) return artifactReviewServerDraft(context);
      entry.draft = normalizeArtifactReviewDraftForClient(draft);
      entry.dirty = true;
      entry.status = "";
      entry.warning = "";
      for (const id of change.changedCommentIds || []) {
        if (id) {
          entry.changedCommentIds[id] = true;
          delete entry.deletedCommentIds[id];
        }
      }
      for (const id of change.deletedCommentIds || []) {
        if (id) {
          entry.deletedCommentIds[id] = true;
          delete entry.changedCommentIds[id];
        }
      }
      if (change.voteDirty) entry.voteDirty = true;
      return entry.draft;
    }

    function clearArtifactReviewLocalDraft(context) {
      const key = artifactReviewDraftKey(context);
      if (key) delete state.artifactReviewDrafts[key];
    }

    function discardArtifactReviewPendingComment(context, commentId) {
      const entry = artifactReviewLocalEntry(context);
      if (!entry || !commentId) return;
      entry.draft = {
        ...entry.draft,
        comments: (entry.draft.comments || []).filter(comment => comment.id !== commentId)
      };
      delete entry.changedCommentIds[commentId];
      delete entry.deletedCommentIds[commentId];
      entry.dirty = Boolean(
        entry.voteDirty
        || Object.keys(entry.changedCommentIds || {}).length
        || Object.keys(entry.deletedCommentIds || {}).length
      );
      if (!entry.dirty) entry.draft = artifactReviewServerDraft(context);
    }

    function completeArtifactReviewLocalDraft(context, clearComposer = false) {
      const key = artifactReviewDraftKey(context);
      if (!key) return;
      const entry = state.artifactReviewDrafts[key];
      if (!entry) return;
      if (!clearComposer && entry.composerText) {
        state.artifactReviewDrafts[key] = {
          draft: artifactReviewServerDraft(context),
          dirty: false,
          voteDirty: false,
          changedCommentIds: {},
          deletedCommentIds: {},
          composerText: entry.composerText,
          composerSeverity: entry.composerSeverity || "risk",
          pendingComposerCommentId: entry.pendingComposerCommentId || "",
          status: "",
          warning: ""
        };
        return;
      }
      delete state.artifactReviewDrafts[key];
    }

    function mergeArtifactReviewDraft(serverDraft, entry) {
      if (!entry?.dirty) return normalizeArtifactReviewDraftForClient(serverDraft);
      const merged = normalizeArtifactReviewDraftForClient(serverDraft);
      const byId = new Map((merged.comments || []).map(comment => [comment.id, comment]));
      for (const id of Object.keys(entry.deletedCommentIds || {})) byId.delete(id);
      for (const localComment of entry.draft.comments || []) {
        if (!entry.changedCommentIds?.[localComment.id]) continue;
        byId.set(localComment.id, {
          id: localComment.id,
          body: localComment.body,
          severity: localComment.severity,
          anchor: localComment.anchor
        });
      }
      return {
        vote: entry.voteDirty ? entry.draft.vote : merged.vote,
        comments: Array.from(byId.values())
      };
    }

    function artifactReviewDraftPayload(context, draft) {
      return {
        expectedRevision: context.review.round.revision,
        vote: draft.vote,
        comments: (draft.comments || []).map(comment => ({
          id: comment.id,
          body: comment.body,
          severity: comment.severity,
          anchor: comment.anchor
        }))
      };
    }

    async function saveArtifactReviewDraft(draft, change = {}) {
      const context = state.artifactReviewContext;
      if (!context?.assignment || context.assignment.status !== "draft" || state.artifactReviewSaving) return { ok: false };
      const entry = ensureArtifactReviewLocalEntry(context);
      const pendingDraft = setArtifactReviewLocalDraft(context, draft, change);
      state.artifactReviewSaving = true;
      entry.status = displayLanguage === "zh" ? "正在保存评审草稿" : "Saving review draft";
      entry.warning = "";
      state.artifactReviewConflict = "";
      setArtifactReviewControlsBusy(true);
      try {
        const response = await fetch(artifactReviewAssignmentUrl(context, "draft"), {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(artifactReviewDraftPayload(context, pendingDraft))
        });
        if (response.status === 409) {
          entry.status = displayLanguage === "zh" ? "评审轮次已更新，正在同步你的草稿" : "The review round changed; syncing your draft";
          try {
            const latestContext = await fetchArtifactReviewContext(context.review.id, context.review.currentRoundId, context.assignment.actorId);
            state.artifactReviewContext = latestContext;
            const latestDraft = artifactReviewServerDraft(latestContext);
            const mergedDraft = mergeArtifactReviewDraft(latestDraft, entry);
            entry.draft = mergedDraft;
            const retry = await fetch(artifactReviewAssignmentUrl(latestContext, "draft"), {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(artifactReviewDraftPayload(latestContext, mergedDraft))
            });
            if (!retry.ok) {
              const retryText = retry.status === 409 ? "" : await retry.text();
              throw new Error(retryText || "retry failed");
            }
            state.artifactReviewContext = await retry.json();
            completeArtifactReviewLocalDraft(state.artifactReviewContext, change.clearComposerOnSuccess);
            state.artifactReviewConflict = "";
            state.artifactReviewSaving = false;
            setArtifactReviewControlsBusy(false);
            renderAll();
            return { ok: true, recovered: true };
          } catch (_error) {
            entry.warning = displayLanguage === "zh"
              ? "评审轮次又被更新了，你的草稿已保留，请稍后重试"
              : "The review round changed again. Your draft is preserved; retry shortly.";
            entry.status = "";
            state.artifactReviewConflict = entry.warning;
            if (hasOpenInlineEditor()) syncArtifactReviewStatusMessage(state.artifactReviewContext || context);
            else {
              state.artifactReviewSaving = false;
              setArtifactReviewControlsBusy(false);
              renderAll();
            }
            return { ok: false, conflict: true };
          }
        }
        if (!response.ok) {
          entry.warning = await response.text();
          entry.status = "";
          state.artifactReviewConflict = entry.warning;
          if (hasOpenInlineEditor()) syncArtifactReviewStatusMessage(state.artifactReviewContext || context);
          else {
            state.artifactReviewSaving = false;
            setArtifactReviewControlsBusy(false);
            renderAll();
          }
          return { ok: false };
        }
        state.artifactReviewContext = await response.json();
        completeArtifactReviewLocalDraft(state.artifactReviewContext, change.clearComposerOnSuccess);
        state.artifactReviewConflict = "";
        state.artifactReviewSaving = false;
        setArtifactReviewControlsBusy(false);
        renderAll();
        return { ok: true, recovered: false };
      } finally {
        const activeEntry = artifactReviewLocalEntry(state.artifactReviewContext || context);
        if (activeEntry) activeEntry.status = "";
        state.artifactReviewSaving = false;
        setArtifactReviewControlsBusy(false);
      }
    }

    function setArtifactReviewControlsBusy(busy) {
      for (const control of el.artifactReviewModal.querySelectorAll(".artifact-review-vote button, .artifact-review-comment button, .artifact-review-select, #artifact-review-submit")) {
        control.disabled = busy;
      }
    }

    function artifactReviewAssignmentUrl(context, operation) {
      return "/api/artifact-reviews/" + encodeURIComponent(context.review.id)
        + "/rounds/" + encodeURIComponent(context.review.currentRoundId)
        + "/assignments/" + encodeURIComponent(context.assignment.actorId)
        + "/" + operation;
    }

    function artifactReviewSubmitDisabledReason() {
      const context = state.artifactReviewContext;
      if (!context?.assignment) return displayLanguage === "zh" ? "无需评审" : "No review required";
      if (state.artifactReviewSaving) return displayLanguage === "zh" ? "正在保存评审草稿" : "Saving review draft";
      if (state.artifactReviewConflict) return state.artifactReviewConflict;
      if (context.review.status !== "pending") return t("round") + " " + context.review.status;
      if (context.assignment.status === "submitted") return t("submitted");
      const draft = artifactReviewEffectiveDraft(context);
      const vote = draft.vote;
      if (!vote) return displayLanguage === "zh" ? "请先选择投票结果" : "Select a vote first";
      if ((vote === "request_changes" || vote === "abstain") && !(draft.comments || []).length) {
        return displayLanguage === "zh"
          ? (vote === "abstain" ? "选择弃权时，至少需要一条原因说明" : "选择修改时，至少需要一条意见")
          : (vote === "abstain" ? "Abstaining requires at least one reason" : "Requesting changes requires at least one comment");
      }
      return "";
    }

    async function submitArtifactReview() {
      const context = state.artifactReviewContext;
      if (!context?.assignment) return;
      const entry = artifactReviewLocalEntry(context);
      if (entry?.dirty) {
        const saved = await saveArtifactReviewDraft(entry.draft);
        if (!saved.ok) return;
      }
      const latestContext = state.artifactReviewContext || context;
      const disabledReason = artifactReviewSubmitDisabledReason();
      if (!latestContext || disabledReason) return;
      const confirmed = await confirmArtifactReviewSubmit(latestContext);
      if (!confirmed) return;
      const response = await fetch(artifactReviewAssignmentUrl(latestContext, "submit"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: latestContext.review.round.revision })
      });
      if (response.status === 409) {
        try {
          state.artifactReviewContext = await fetchArtifactReviewContext(latestContext.review.id, latestContext.review.currentRoundId, latestContext.assignment.actorId);
        } catch (_error) {
          // Keep the visible draft state when the refresh also fails.
        }
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
        const draft = artifactReviewEffectiveDraft(context);
        const vote = artifactReviewVoteLabel(draft.vote, context.assignment.binding);
        summary.textContent = artifactReviewRoleName(context.assignment) + " · "
          + t("round") + " " + context.review.round.sequence + " · "
          + (context.assignment.binding === "decision" ? t("decisionVote") : t("advisoryVote")) + " · "
          + vote + " · " + draft.comments.length + " comment(s)";
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
      const review = (await response.json()).review;
      state.reviewDetails.set(review.id, review);
      const current = state.reviews.find(item => item.id === review.id);
      if (current) Object.assign(current, review, { commentCount: review.comments?.length || 0 });
      else state.reviews.unshift({ ...review, commentCount: review.comments?.length || 0 });
      renderAll();
    }

    async function runButtonAction(button, action) {
      button.disabled = true;
      try {
        const result = await action();
        if (result === false) button.disabled = false;
      } catch (error) {
        alert(error instanceof Error ? error.message : String(error));
        button.disabled = false;
      }
    }

    function renderReview() {
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
      const review = selectedArtifactReviewSummary();
      const context = state.artifactReviewContext;
      el.artifactReviewModalControls.innerHTML = "";
      el.artifactReviewMyContent.innerHTML = "";
      el.artifactReviewProgressContent.innerHTML = "";
      el.artifactReviewModalComments.innerHTML = "";
      el.artifactReviewArtifactContent.innerHTML = "";
      el.artifactReviewMaterialSelector.innerHTML = "";
      el.artifactReviewScopeTitle.textContent = displayLanguage === "zh" ? "评审范围" : "Review scope";
      el.artifactReviewMyTitle.textContent = displayLanguage === "zh" ? "我的评审" : "My review";
      el.artifactReviewProgressTitle.textContent = displayLanguage === "zh" ? "参与进度" : "Participation progress";
      el.artifactReviewRecordTitle.textContent = displayLanguage === "zh" ? "评审记录" : "Review record";
      el.artifactReviewSubmitTitle.textContent = displayLanguage === "zh" ? "提交评审" : "Submit review";
      if (!review?.round) {
        el.artifactReviewModalTitle.textContent = t("artifactReview");
        el.artifactReviewModalSubtitle.textContent = "";
        el.artifactReviewCommentSummary.textContent = "";
        el.artifactReviewSubmitArea.hidden = true;
        el.artifactReviewSubmit.disabled = true;
        return;
      }

      const selectedRound = context ? selectedArtifactReviewRound(context) : review.round;
      const selectedSequence = selectedRound?.sequence || review.round.sequence;
      const viewingHistory = Boolean(selectedRound && selectedRound.id !== review.currentRoundId);
      el.artifactReviewModalTitle.textContent = t("artifactReview");
      el.artifactReviewModalClose.textContent = t("close");
      el.artifactReviewArtifactTab.textContent = t("artifactPane");
      el.artifactReviewReviewTab.textContent = t("reviewPane");
      el.artifactReviewModalSubtitle.textContent = review.artifactName + " · " + review.id;
      const selectedMaterial = context ? selectedArtifactReviewMaterial(context) : null;
      el.artifactReviewArtifactTitle.textContent = displayLanguage === "zh" ? "评审材料" : "Review material";
      if (context && selectedMaterial) {
        el.artifactReviewMaterialSelector.append(renderArtifactReviewMaterialSelector(context, selectedMaterial));
      }
      const controls = el.artifactReviewModalControls;
      if (context) {
        controls.append(renderArtifactReviewRoundTimeline(context));
      }
      controls.append(renderArtifactReviewSelector(review));
      const scopeRound = selectedRound || review.round;
      const scopeSubmitted = scopeRound.submitted
        ?? (scopeRound.assignments || []).filter(assignment => assignment.status === "submitted").length;
      const scopeTotal = scopeRound.total ?? scopeRound.assignments?.length ?? 0;
      const scopeMeta = document.createElement("div");
      scopeMeta.className = "meta";
      scopeMeta.style.margin = "0";
      scopeMeta.append(
        pill(
          artifactReviewRoundStatusLabel(scopeRound.status),
          false,
          scopeRound.status === "passed" ? "done" : scopeRound.status === "changes_requested" ? "warn" : "processing"
        ),
        pill(review.policyId),
        pill(t("round") + " " + selectedSequence + " · " + scopeSubmitted + "/" + scopeTotal),
        pill(viewingHistory
          ? (displayLanguage === "zh" ? "历史轮次 · 只读" : "Historical round · read-only")
          : (displayLanguage === "zh" ? "当前轮次" : "Current round"))
      );
      controls.append(scopeMeta);
      if (context) controls.append(renderArtifactReviewHistorySelector(context));
      const humanAssignments = (review.round.assignments || []).filter(assignment => assignment.actorKind !== "agent");
      if (humanAssignments.length) {
        const identityLabel = blockTitle(t("identity"));
        el.artifactReviewMyContent.append(identityLabel, renderArtifactReviewIdentitySelector(review, context));
      }

      if (context?.assignment) {
        const role = document.createElement("div");
        role.className = "meta";
        role.style.margin = "0";
        role.append(pill(
          context.assignment.binding === "decision" ? t("decisionVote") : t("advisoryVote"),
          false,
          context.assignment.binding === "decision" ? "strong" : "warn"
        ));
        el.artifactReviewMyContent.append(role);
      }

      const reviewSummary = document.createElement("div");
      reviewSummary.className = "artifact-review-message" + (artifactReviewUnresolvedBlocking(scopeRound) ? " warn" : "");
      reviewSummary.textContent = artifactReviewProgressSummary(scopeRound);
      el.artifactReviewProgressContent.append(reviewSummary, renderArtifactReviewProgress(review, context));

      if (state.artifactReviewLoading) {
        const loading = document.createElement("div");
        loading.className = "muted";
        loading.textContent = displayLanguage === "zh" ? "加载中..." : "Loading...";
        el.artifactReviewMyContent.append(loading);
        el.artifactReviewArtifactContent.append(loading.cloneNode(true));
      } else if (!context) {
        const empty = document.createElement("div");
        empty.className = "artifact-review-message";
        empty.textContent = t("selectIdentity");
        el.artifactReviewMyContent.append(empty);
      } else {
        el.artifactReviewArtifactContent.append(renderArtifactReviewSubmission(context, selectedMaterial));
        renderArtifactReviewWorkspace(context);
      }

      const disabledReason = artifactReviewSubmitDisabledReason();
      const agentManaged = context?.assignment?.actorKind === "agent";
      const readOnly = !context?.assignment || viewingHistory || context.assignment.status === "submitted" || context.review.status !== "pending";
      el.artifactReviewSubmitArea.hidden = Boolean(agentManaged || readOnly);
      el.artifactReviewSubmit.textContent = context?.assignment?.status === "submitted" ? t("submitted") : t("submitArtifactReview");
      el.artifactReviewSubmit.disabled = agentManaged || Boolean(disabledReason);
      el.artifactReviewSubmit.title = disabledReason;
      el.artifactReviewCommentSummary.textContent = context?.assignment
        ? artifactReviewRoleName(context.assignment) + " · " + context.review.id
        : "";
      if (context?.assignment && !agentManaged) {
        const draft = artifactReviewEffectiveDraft(context);
        const vote = context.assignment.submitted?.vote || draft.vote;
        const comments = draft.comments?.length || 0;
        el.artifactReviewSubmitSummary.textContent = displayLanguage === "zh"
          ? "当前投票：" + artifactReviewVoteLabel(vote, context.assignment.binding) + " · 草稿意见：" + comments + " 条"
          : "Current vote: " + artifactReviewVoteLabel(vote, context.assignment.binding) + " · Draft comments: " + comments;
      } else {
        el.artifactReviewSubmitSummary.textContent = "";
      }
    }

    function artifactReviewProgressSummary(round) {
      const comments = (round.assignments || []).flatMap(assignment => assignment.submitted?.comments || []);
      const severity = round.severity || comments.reduce((counts, comment) => {
        if (comment.severity) counts[comment.severity] = (counts[comment.severity] || 0) + 1;
        return counts;
      }, {});
      const submitted = round.submitted
        ?? (round.assignments || []).filter(assignment => assignment.status === "submitted").length;
      const total = round.total ?? round.assignments?.length ?? 0;
      const decisionReady = round.decisionReady
        ?? ["passed", "changes_requested"].includes(round.status);
      const failures = round.failures || (round.assignments || [])
        .map(assignment => assignment.attempts?.at(-1)?.failure)
        .filter(Boolean);
      const environmentFailures = failures.filter(item => item.category === "environment").length;
      const unresolvedBlocking = artifactReviewUnresolvedBlocking(round);
      if (displayLanguage === "zh") {
        return "已提交 " + submitted + "/" + total
          + " · " + (decisionReady ? "决策票已就绪" : "仍在等待评审")
          + " · 阻塞意见 " + (severity.blocking || 0)
          + " · 未处置 " + unresolvedBlocking
          + " · 环境失败 " + environmentFailures
          + " · 重复建议组 " + (round.repeatedAdvisories || []).length;
      }
      return submitted + "/" + total + " submitted"
        + " · " + (decisionReady ? "Decision votes are ready" : "Waiting for reviews")
        + " · Blocking comments " + (severity.blocking || 0)
        + " · Unresolved " + unresolvedBlocking
        + " · Environment failures " + environmentFailures
        + " · Repeated advisory groups " + (round.repeatedAdvisories || []).length;
    }

    function artifactReviewUnresolvedBlocking(round) {
      if (round.unresolvedBlocking !== undefined) return round.unresolvedBlocking;
      const resolved = new Set((round.commentDispositions || []).map(item => item.commentId));
      return (round.assignments || [])
        .flatMap(assignment => assignment.submitted?.comments || [])
        .filter(comment => comment.severity === "blocking" && !resolved.has(comment.id))
        .length;
    }

    function artifactReviewMaterials(context) {
      return [
        {
          key: "candidate",
          label: displayLanguage === "zh" ? "待评审产物" : "Artifact under review",
          artifact: context.submission.artifact,
          commentable: true
        },
        {
          key: "contract",
          label: displayLanguage === "zh" ? "冻结契约" : "Frozen contract",
          artifact: context.submission.contractArtifact,
          commentable: false
        },
        ...((context.submission.contextArtifacts || []).map((item, index) => ({
          key: "context:" + index,
          label: displayLanguage === "zh" ? "前序产物" : "Earlier Artifact",
          artifact: item.artifact,
          commentable: false
        })))
      ];
    }

    function selectedArtifactReviewMaterial(context) {
      const materials = artifactReviewMaterials(context);
      const selectedKey = state.artifactReviewMaterialBySubmission[context.submission.id] || "candidate";
      return materials.find(material => material.key === selectedKey) || materials[0];
    }

    function renderArtifactReviewMaterialSelector(context, selectedMaterial) {
      const chooser = document.createElement("div");
      chooser.className = "artifact-review-round-select artifact-review-material-select";
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "artifact-review-select artifact-review-select-trigger";
      trigger.setAttribute("role", "combobox");
      trigger.setAttribute("aria-label", displayLanguage === "zh" ? "选择评审材料" : "Select review material");
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      const triggerText = document.createElement("span");
      triggerText.textContent = selectedMaterial.label + " · " + selectedMaterial.artifact.name;
      const caret = document.createElement("span");
      caret.className = "artifact-review-select-caret";
      caret.setAttribute("aria-hidden", "true");
      caret.textContent = "⌄";
      trigger.append(triggerText, caret);
      const menu = document.createElement("div");
      menu.className = "artifact-review-select-menu";
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", displayLanguage === "zh" ? "选择评审材料" : "Select review material");
      menu.hidden = true;
      const setOpen = open => {
        menu.hidden = !open;
        trigger.setAttribute("aria-expanded", String(open));
        state.artifactReviewOpenSelect = open ? "material:" + context.submission.id : "";
      };
      for (const material of artifactReviewMaterials(context)) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "artifact-review-select-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(material.key === selectedMaterial.key));
        option.textContent = material.label + " · " + material.artifact.name;
        option.addEventListener("click", () => {
          state.artifactReviewMaterialBySubmission[context.submission.id] = material.key;
          setOpen(false);
          renderArtifactReviewMaterialPane(context);
        });
        menu.append(option);
      }
      trigger.addEventListener("click", () => setOpen(menu.hidden));
      trigger.addEventListener("keydown", event => {
        if (event.key === "Escape") setOpen(false);
      });
      chooser.addEventListener("focusout", () => {
        setTimeout(() => {
          if (chooser.isConnected && !chooser.contains(document.activeElement)) setOpen(false);
        }, 0);
      });
      chooser.append(trigger, menu);
      if (state.artifactReviewOpenSelect === "material:" + context.submission.id) setOpen(true);
      return chooser;
    }

    function renderArtifactReviewMaterialPane(context) {
      const selectedMaterial = selectedArtifactReviewMaterial(context);
      el.artifactReviewMaterialSelector.innerHTML = "";
      el.artifactReviewArtifactContent.innerHTML = "";
      el.artifactReviewMaterialSelector.append(renderArtifactReviewMaterialSelector(context, selectedMaterial));
      el.artifactReviewArtifactContent.append(renderArtifactReviewSubmission(context, selectedMaterial));
      syncBrowserUrl();
    }

    function renderArtifactReviewSubmission(context, selectedMaterial) {
      const wrap = document.createElement("div");
      const material = selectedMaterial || selectedArtifactReviewMaterial(context);
      const artifact = material.artifact;
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.append(pill(material.label, true));
      if (!material.commentable) meta.append(pill(displayLanguage === "zh" ? "只读快照" : "Read-only snapshot"));
      if (artifact.type) meta.append(pill(artifact.type));
      appendFormatMeta(meta, artifact.format, artifactSchemaName(artifact), artifact.schema?.kind === "inline");
      appendArtifactStorageMeta(meta, artifact);
      meta.append(pill(formatTime(context.submission.createdAt)));
      wrap.append(meta);
      if (state.artifactReviewLocateFailure) {
        const failure = document.createElement("div");
        failure.className = "artifact-review-message warn artifact-review-locate-failure";
        failure.textContent = state.artifactReviewLocateFailure;
        wrap.append(failure);
      }
      const content = renderArtifactValue(artifact);
      if (!material.commentable) {
        wrap.append(content);
        return wrap;
      }
      if (shouldRenderMarkdownArtifact(artifact)) {
        const blocks = [...content.children];
        blocks.forEach((block, index) => {
          const next = block.nextSibling;
          const target = "markdown:" + block.tagName.toLowerCase() + ":" + index;
          const snapshot = String(block.textContent || "").trim();
          const commentTarget = commentable(block, target, snapshot, target, { artifactReview: context, commentKind: "artifact" });
          commentTarget.classList.add("artifact-review-target");
          content.insertBefore(commentTarget, next);
        });
        wrap.append(content);
      } else {
        const snapshot = artifactDisplayValue(artifact);
        const target = commentable(content, "artifact:root", snapshot, "artifact:root", { artifactReview: context, commentKind: "artifact" });
        target.classList.add("artifact-review-target");
        wrap.append(target);
      }
      return wrap;
    }

    function selectedArtifactReviewRound(context) {
      const selectedId = state.artifactReviewRoundByReview[context.review.id] || context.review.currentRoundId;
      return context.rounds.find(round => round.id === selectedId)
        || context.rounds.find(round => round.id === context.review.currentRoundId)
        || context.rounds[context.rounds.length - 1];
    }

    function renderArtifactReviewRoundTimeline(context) {
      const round = selectedArtifactReviewRound(context);
      const wrap = document.createElement("div");
      wrap.className = "artifact-review-time-range";
      const label = blockTitle(t("reviewTime"));
      label.style.marginTop = "0";
      const value = document.createElement("div");
      value.className = "artifact-review-time-value";
      const timestamps = [
        ...(round?.assignments || []).map(assignment => assignment.submitted?.submittedAt),
        ...(round?.votes || []).map(vote => vote.submittedAt)
      ].filter(Boolean).map(timestamp => new Date(timestamp).getTime()).filter(Number.isFinite);
      const end = timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : "";
      const terminal = round?.status === "passed" || round?.status === "changes_requested";
      value.textContent = formatTime(round?.createdAt) + " – " + (terminal && end ? formatTime(end) : t("inProgress"));
      wrap.append(label, value);
      return wrap;
    }

    function renderArtifactReviewSelector(selectedReview) {
      const run = state.runs.find(item => item.id === state.selectedTaskId) || state.runs[0] || null;
      const reviews = artifactReviewSummariesForRun(run);
      const chooser = document.createElement("div");
      chooser.className = "artifact-review-round-select artifact-review-artifact-select";
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "artifact-review-select artifact-review-select-trigger";
      trigger.setAttribute("role", "combobox");
      trigger.setAttribute("aria-label", t("reviewArtifact"));
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      const triggerText = document.createElement("span");
      triggerText.textContent = selectedReview.artifactName;
      const caret = document.createElement("span");
      caret.className = "artifact-review-select-caret";
      caret.setAttribute("aria-hidden", "true");
      caret.textContent = "⌄";
      trigger.append(triggerText, caret);

      const menu = document.createElement("div");
      menu.className = "artifact-review-select-menu";
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", t("reviewArtifact"));
      menu.hidden = true;
      const setOpen = open => {
        menu.hidden = !open;
        trigger.setAttribute("aria-expanded", String(open));
        state.artifactReviewOpenSelect = open && run ? "artifact:" + run.id : "";
      };
      for (const review of reviews) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "artifact-review-select-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(review.id === selectedReview.id));
        option.textContent = review.artifactName + " · " + t("round") + " " + review.roundCount
          + " · " + artifactReviewRoundStatusLabel(review.round?.status);
        option.addEventListener("click", async () => {
          setOpen(false);
          if (!run || review.id === selectedReview.id) return;
          state.artifactReviewSelectedByRun[run.id] = review.id;
          state.artifactReviewRoundByReview[review.id] = review.currentRoundId;
          state.artifactReviewContext = null;
          writeStoredObject(artifactReviewSelectedKey, state.artifactReviewSelectedByRun);
          writeStoredObject(artifactReviewRoundKey, state.artifactReviewRoundByReview);
          await syncArtifactReviewContext(true);
          renderAll();
        });
        menu.append(option);
      }
      trigger.addEventListener("click", () => setOpen(menu.hidden));
      trigger.addEventListener("keydown", event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setOpen(true);
          const options = [...menu.querySelectorAll(".artifact-review-select-option")];
          const selectedIndex = options.findIndex(option => option.getAttribute("aria-selected") === "true");
          options[Math.max(0, selectedIndex)]?.focus();
        } else if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
        }
      });
      chooser.addEventListener("focusout", () => {
        setTimeout(() => {
          if (chooser.isConnected && !chooser.contains(document.activeElement)) setOpen(false);
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
      if (run && state.artifactReviewOpenSelect === "artifact:" + run.id) setOpen(true);
      return chooser;
    }

    function renderArtifactReviewProgress(review, context) {
      const list = document.createElement("div");
      list.className = "artifact-review-grid";
      const selectedRound = context ? selectedArtifactReviewRound(context) : review.round;
      const currentRoundSelected = selectedRound?.id === review.currentRoundId;
      const assignments = selectedRound?.assignments || review.round.assignments || [];
      for (const assignment of assignments) {
        const submitted = assignment.submitted;
        const row = document.createElement("div");
        row.className = "artifact-review-row";
        if (assignment.actorKind === "agent") {
          row.id = agentActivityRowDomId(review, selectedRound, assignment);
        }
        const main = document.createElement("div");
        main.className = "artifact-review-row-main";
        const name = document.createElement(submitted ? "button" : "span");
        if (submitted) {
          name.type = "button";
          name.className = "artifact-review-participant-link";
          name.addEventListener("click", () => scrollToArtifactReviewParticipant(assignment));
        }
        name.textContent = artifactReviewRoleName(assignment);
        const type = document.createElement("span");
        type.className = "muted";
        type.textContent = (assignment.binding === "decision" ? t("decisionVote") : t("advisoryVote"))
          + (assignment.actorKind === "agent" ? " · Agent" : "");
        main.append(name, type);
        if (assignment.actorKind === "agent") {
          const activity = agentActivityEntry(review, selectedRound, assignment);
          const attempt = latestAgentAttempt(assignment);
          const summaryRow = document.createElement("div");
          summaryRow.className = "artifact-review-agent-summary-row";
          const summary = document.createElement("span");
          summary.className = "artifact-review-agent-summary";
          summary.textContent = activity?.summary
            ? activity.summary.text + " · " + formatTime(activity.summary.at)
            : (displayLanguage === "zh" ? "等待 Agent 活动" : "Waiting for Agent activity");
          summaryRow.append(summary);
          if (latestAgentAttempt(assignment)) {
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "artifact-review-activity-toggle";
            toggle.textContent = activity?.expanded
              ? (displayLanguage === "zh" ? "收起详情" : "Hide details")
              : (displayLanguage === "zh" ? "查看详情" : "View details");
            toggle.setAttribute("aria-expanded", String(Boolean(activity?.expanded)));
            toggle.setAttribute("aria-controls", agentActivityDomId(review, selectedRound, assignment));
            toggle.addEventListener("click", async () => {
              if (!activity) return;
              activity.expanded = !activity.expanded;
              if (activity.expanded && !activity.loaded) {
                activity.cursor = 0;
                activity.events = [];
                activity.loading = true;
                renderAll();
                await fetchAgentActivity(review, selectedRound, assignment, activity, true);
              }
              renderAll();
            });
            summaryRow.append(toggle);
          }
          main.append(summaryRow);
          if (attempt?.failure?.message) {
            const failure = document.createElement("span");
            failure.className = "muted";
            failure.textContent = displayLanguage === "zh"
              ? "失败：" + attempt.failure.message
              : "Failure: " + attempt.failure.message;
            main.append(failure);
          }
        }
        const decisionIntent = submitted?.summary || assignment.summary;
        if (assignment.binding === "decision" && decisionIntent) {
          const intent = document.createElement("span");
          intent.className = "muted";
          intent.textContent = "Decision intent: " + decisionIntent;
          main.append(intent);
        }
        if (submitted || assignment.status === "submitted") {
          const evidenceReference = document.createElement("span");
          evidenceReference.className = "muted";
          evidenceReference.textContent = artifactReviewImplementationEvidenceLabel(
            submitted?.implementationEvidenceReferenced ?? assignment.implementationEvidenceReferenced
          );
          main.append(evidenceReference);
        }
        const status = document.createElement("span");
        status.className = "artifact-review-progress";
        status.textContent = submitted
          ? artifactReviewVoteLabel(submitted.vote, assignment.binding)
          : artifactReviewAssignmentStatusLabel(assignment.status, assignment.actorKind);
        const actions = document.createElement("div");
        actions.className = "comment-actions";
        actions.append(status);
        if (
          currentRoundSelected
          && assignment.actorKind === "agent"
          && assignment.status === "failed"
          && review.status === "pending"
        ) {
          const retry = document.createElement("button");
          retry.type = "button";
          retry.className = "btn";
          retry.textContent = t("retry");
          retry.addEventListener("click", () => runButtonAction(retry, () => retryArtifactReviewAgentAssignment(review, assignment)));
          actions.append(retry);
        }
        row.append(main, actions);
        if (assignment.actorKind === "agent") {
          const activity = agentActivityEntry(review, selectedRound, assignment);
          if (activity?.expanded) row.append(renderAgentActivity(review, selectedRound, assignment, activity));
        }
        list.append(row);
      }
      const selectedRunnerVote = selectedRound?.votes?.find(vote => vote.subject?.kind === "runner");
      const runnerSummary = selectedRound?.id === review.currentRoundId ? review.round.runner : null;
      if (selectedRunnerVote || runnerSummary) {
        const row = document.createElement("div");
        row.className = "artifact-review-row";
        const main = document.createElement("div");
        main.className = "artifact-review-row-main";
        const name = document.createElement(selectedRunnerVote ? "button" : "span");
        const runnerName = t("runner");
        name.textContent = runnerName + (runnerSummary?.automatic ? " · " + t("automatic") : "");
        if (selectedRunnerVote) {
          name.type = "button";
          name.className = "artifact-review-participant-link";
          name.addEventListener("click", () => scrollToArtifactReviewParticipant({ actorId: "runner" }));
        }
        const type = document.createElement("span");
        type.className = "muted";
        type.textContent = t("decisionVote");
        main.append(name, type);
        const status = document.createElement("span");
        status.className = "artifact-review-progress";
        status.textContent = selectedRunnerVote || runnerSummary?.status === "submitted"
          ? artifactReviewVoteLabel(selectedRunnerVote?.value || runnerSummary?.vote, "decision")
          : t("pendingVote");
        row.append(main, status);
        list.append(row);
      }
      return list;
    }

    function agentActivityKey(review, round, assignment) {
      return [review.id, round?.id || review.currentRoundId, assignment.actorId].join(":");
    }

    function agentActivityDomId(review, round, assignment) {
      return "agent-activity-" + agentActivityKey(review, round, assignment).replace(/[^a-zA-Z0-9_-]/g, "-");
    }

    function agentActivityRowDomId(review, round, assignment) {
      return agentActivityDomId(review, round, assignment) + "-row";
    }

    function latestAgentAttempt(assignment) {
      return assignment.attempts?.at(-1) || assignment.attempt;
    }

    function agentActivityEntry(review, round, assignment) {
      const attempt = latestAgentAttempt(assignment);
      if (!attempt || !round) return null;
      const key = agentActivityKey(review, round, assignment);
      let entry = state.artifactReviewActivities[key];
      if (!entry) {
        entry = state.artifactReviewActivities[key] = {
          selectedAttempt: attempt.sequence,
          followLatest: true,
          cursor: 0,
          summaryCursor: 0,
          events: [],
          summary: null,
          expanded: false,
          loaded: false,
          loading: false,
          pinnedToBottom: true,
          scrollTop: 0,
          error: "",
          truncated: false,
          droppedCount: 0
        };
      }
      if (entry.followLatest && entry.selectedAttempt !== attempt.sequence) {
        entry.selectedAttempt = attempt.sequence;
        entry.summary = null;
        entry.summaryCursor = 0;
        resetAgentActivityTimeline(entry);
      } else if (!(assignment.attempts || [attempt]).some(candidate => candidate.sequence === entry.selectedAttempt)) {
        entry.selectedAttempt = attempt.sequence;
        entry.followLatest = true;
        entry.summary = null;
        entry.summaryCursor = 0;
        resetAgentActivityTimeline(entry);
      }
      return entry;
    }

    function resetAgentActivityTimeline(entry) {
      entry.cursor = 0;
      entry.events = [];
      entry.loaded = false;
      entry.error = "";
      entry.scrollTop = 0;
      entry.pinnedToBottom = true;
    }

    async function syncArtifactReviewActivities(force = false) {
      if (!state.artifactReviewModalOpen) return;
      const review = selectedArtifactReviewSummary();
      if (!review) return;
      const round = state.artifactReviewContext
        ? selectedArtifactReviewRound(state.artifactReviewContext)
        : review.round;
      if (!round) return;
      const agents = (round.assignments || []).filter(assignment => assignment.actorKind === "agent");
      await Promise.all(agents.map(async assignment => {
        const entry = agentActivityEntry(review, round, assignment);
        if (!entry || entry.loading) return;
        const cursor = entry.expanded ? entry.cursor : entry.summaryCursor;
        const error = entry.error;
        const loaded = entry.loaded;
        await fetchAgentActivity(review, round, assignment, entry, Boolean(entry.expanded));
        const nextCursor = entry.expanded ? entry.cursor : entry.summaryCursor;
        if (nextCursor !== cursor || entry.error !== error || entry.loaded !== loaded) {
          refreshAgentActivityDom(review, round, assignment, entry);
        }
      }));
    }

    function refreshAgentActivityDom(review, round, assignment, entry) {
      const row = document.getElementById(agentActivityRowDomId(review, round, assignment));
      if (!row) return;
      const summary = row.querySelector(".artifact-review-agent-summary");
      if (summary) {
        summary.textContent = entry.summary
          ? entry.summary.text + " · " + formatTime(entry.summary.at)
          : (displayLanguage === "zh" ? "等待 Agent 活动" : "Waiting for Agent activity");
      }
      const existing = document.getElementById(agentActivityDomId(review, round, assignment));
      const interacting = existing && (
        existing.querySelector(".artifact-review-select-menu:not([hidden])")
        || existing.contains(document.activeElement)
      );
      if (existing && entry.expanded && !interacting) {
        existing.replaceWith(renderAgentActivity(review, round, assignment, entry));
      }
    }

    async function fetchAgentActivity(review, round, assignment, entry, includeEvents) {
      entry.loading = true;
      const cursor = includeEvents ? entry.cursor : entry.summaryCursor;
      const limit = includeEvents ? 500 : 0;
      try {
        const response = await fetch(
          "/api/artifact-reviews/" + encodeURIComponent(review.id)
          + "/rounds/" + encodeURIComponent(round.id)
          + "/assignments/" + encodeURIComponent(assignment.actorId)
          + "/attempts/" + encodeURIComponent(entry.selectedAttempt)
          + "/activity?cursor=" + encodeURIComponent(cursor)
          + "&limit=" + limit
        );
        if (!response.ok) throw new Error(await response.text());
        const payload = await response.json();
        entry.summary = payload.summary || entry.summary;
        entry.summaryCursor = payload.nextCursor;
        entry.truncated = Boolean(payload.truncated);
        entry.droppedCount = payload.droppedCount || 0;
        if (includeEvents) {
          const byId = new Map(entry.events.map(event => [event.id, event]));
          for (const event of payload.events || []) byId.set(event.id, event);
          entry.events = [...byId.values()].sort((left, right) => left.updatedRevision - right.updatedRevision);
          entry.cursor = payload.nextCursor;
          entry.loaded = true;
        }
        entry.error = "";
      } catch (error) {
        entry.error = error instanceof Error ? error.message : String(error);
      } finally {
        entry.loading = false;
      }
    }

    function renderAgentActivity(review, round, assignment, entry) {
      const wrap = document.createElement("section");
      wrap.id = agentActivityDomId(review, round, assignment);
      wrap.className = "artifact-review-activity";
      const head = document.createElement("div");
      head.className = "artifact-review-activity-head";
      const title = document.createElement("b");
      title.textContent = displayLanguage === "zh" ? "运行记录" : "Activity";
      const attempts = assignment.attempts || [assignment.attempt].filter(Boolean);
      const chooser = document.createElement("div");
      chooser.className = "artifact-review-round-select artifact-review-attempt-select";
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "artifact-review-select artifact-review-select-trigger";
      trigger.setAttribute("role", "combobox");
      trigger.setAttribute("aria-label", displayLanguage === "zh" ? "选择 Attempt" : "Select attempt");
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      const selectedAttempt = attempts.find(attempt => attempt.sequence === entry.selectedAttempt);
      const triggerText = document.createElement("span");
      triggerText.textContent = selectedAttempt
        ? t("attempt") + " " + selectedAttempt.sequence + " · " + selectedAttempt.status
        : t("attempt");
      const caret = document.createElement("span");
      caret.className = "artifact-review-select-caret";
      caret.setAttribute("aria-hidden", "true");
      caret.textContent = "⌄";
      trigger.append(triggerText, caret);
      const menu = document.createElement("div");
      menu.className = "artifact-review-select-menu";
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", displayLanguage === "zh" ? "选择 Attempt" : "Select attempt");
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
      for (const attempt of attempts) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "artifact-review-select-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(attempt.sequence === entry.selectedAttempt));
        option.textContent = t("attempt") + " " + attempt.sequence + " · " + attempt.status;
        option.addEventListener("click", async () => {
          setOpen(false);
          if (attempt.sequence === entry.selectedAttempt) return trigger.focus();
          entry.selectedAttempt = attempt.sequence;
          entry.followLatest = false;
          entry.summary = null;
          entry.summaryCursor = 0;
          resetAgentActivityTimeline(entry);
          entry.loading = true;
          renderAll();
          await fetchAgentActivity(review, round, assignment, entry, true);
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
          if (chooser.isConnected && !chooser.contains(document.activeElement)) setOpen(false);
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
      head.append(title, chooser);
      wrap.append(head);
      if (entry.truncated) {
        const truncated = document.createElement("div");
        truncated.className = "artifact-review-message warn";
        truncated.textContent = (displayLanguage === "zh" ? "较早活动已截断" : "Earlier activity was truncated")
          + " · " + entry.droppedCount;
        wrap.append(truncated);
      }
      if (entry.error) {
        const error = document.createElement("div");
        error.className = "artifact-review-message warn";
        error.textContent = entry.error;
        wrap.append(error);
      }
      const log = document.createElement("div");
      log.className = "artifact-review-activity-log";
      if (entry.loading && !entry.loaded) {
        const loading = document.createElement("div");
        loading.className = "muted";
        loading.textContent = "Loading...";
        log.append(loading);
      } else if (!entry.events.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = displayLanguage === "zh" ? "等待 Agent 活动" : "Waiting for Agent activity";
        log.append(empty);
      } else {
        for (const event of entry.events) log.append(renderAgentActivityEvent(event));
      }
      log.addEventListener("scroll", () => {
        const distance = log.scrollHeight - log.clientHeight - log.scrollTop;
        entry.pinnedToBottom = distance < 20;
        entry.scrollTop = log.scrollTop;
      });
      requestAnimationFrame(() => {
        if (!log.isConnected) return;
        log.scrollTop = entry.pinnedToBottom ? log.scrollHeight : entry.scrollTop;
      });
      wrap.append(log);
      return wrap;
    }

    function renderAgentActivityEvent(event) {
      const row = document.createElement("article");
      row.className = "artifact-review-activity-event";
      row.dataset.kind = event.kind;
      const head = document.createElement("div");
      head.className = "artifact-review-activity-event-head";
      const kind = pill(agentActivityKindLabel(event.kind), true, "artifact-review-activity-kind");
      const time = document.createElement("time");
      time.className = "muted";
      time.textContent = formatTime(event.updatedAt);
      head.append(kind, time);
      const title = document.createElement("b");
      title.className = "artifact-review-activity-event-title";
      title.textContent = event.title;
      row.append(head, title);
      if (event.status && event.status !== "completed") {
        row.append(pill(agentActivityStatusLabel(event.status), false, event.status === "failed" ? "outdated" : ""));
      }
      if (event.body) {
        const body = document.createElement("p");
        body.className = "artifact-review-activity-event-body";
        body.textContent = event.body;
        row.append(body);
      }
      if (event.plan?.length) {
        const plan = document.createElement("ol");
        plan.className = "artifact-review-activity-plan";
        for (const item of event.plan) {
          const line = document.createElement("li");
          line.textContent = item.content + " · " + agentActivityStatusLabel(item.status);
          plan.append(line);
        }
        row.append(plan);
      }
      if (event.locations?.length) {
        const locations = document.createElement("div");
        locations.className = "artifact-review-activity-locations";
        locations.textContent = event.locations.join(" · ");
        row.append(locations);
      }
      return row;
    }

    function agentActivityKindLabel(kind) {
      if (displayLanguage !== "zh") return kind;
      return ({
        message: "消息",
        tool: "工具调用",
        plan: "执行计划",
        thought: "分析",
        lifecycle: "运行状态"
      })[kind] || kind;
    }

    function agentActivityStatusLabel(status) {
      if (displayLanguage !== "zh") return status;
      return ({
        pending: "等待中",
        in_progress: "进行中",
        running: "运行中",
        connected: "已连接",
        completed: "已完成",
        submitted: "已提交",
        stopped: "已停止",
        failed: "失败"
      })[status] || status;
    }

    function artifactReviewParticipantDomId(assignment) {
      return "artifact-review-participant-" + String(assignment.actorId || "runner").replace(/[^a-zA-Z0-9_-]/g, "-");
    }

    function scrollToArtifactReviewParticipant(assignment) {
      const target = document.getElementById(artifactReviewParticipantDomId(assignment));
      if (!target) return;
      target.scrollIntoView({ block: "start", behavior: "smooth" });
      target.classList.remove("artifact-review-opinion-located");
      setTimeout(() => target.classList.add("artifact-review-opinion-located"), 20);
      setTimeout(() => target.classList.remove("artifact-review-opinion-located"), 1800);
    }

    async function retryArtifactReviewAgentAssignment(review, assignment) {
      const response = await fetch(
        "/api/artifact-reviews/" + encodeURIComponent(review.id)
        + "/rounds/" + encodeURIComponent(review.currentRoundId)
        + "/assignments/" + encodeURIComponent(assignment.actorId)
        + "/retry",
        { method: "POST" }
      );
      if (!response.ok) throw new Error(await response.text());
      await loadRuns();
      renderAll();
    }

    function renderArtifactReviewIdentitySelector(review, context) {
      const assignments = (review.round.assignments || []).filter(assignment => assignment.actorKind !== "agent");
      const selectedIdentityId = context?.assignment?.actorId || state.artifactReviewIdentityByReview[review.id] || "";
      const selectedAssignment = assignments.find(assignment => assignment.actorId === selectedIdentityId);
      const chooser = document.createElement("div");
      chooser.className = "artifact-review-round-select artifact-review-actor-select";
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
        state.artifactReviewOpenSelect = open ? "identity:" + review.id : "";
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
        option.setAttribute("aria-selected", String(assignment.actorId === selectedIdentityId));
        option.dataset.actorId = assignment.actorId;
        option.textContent = artifactReviewRoleName(assignment) + " · "
          + (assignment.binding === "decision" ? t("decisionVote") : t("advisoryVote"));
        option.addEventListener("click", async () => {
          setOpen(false);
          state.artifactReviewIdentityByReview[review.id] = assignment.actorId;
          writeStoredObject(artifactReviewIdentityKey, state.artifactReviewIdentityByReview);
          const roundId = state.artifactReviewRoundByReview[review.id] || review.currentRoundId;
          await loadArtifactReviewContext(review.id, roundId, assignment.actorId);
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
          if (chooser.isConnected && !chooser.contains(document.activeElement)) setOpen(false);
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
      if (state.artifactReviewOpenSelect === "identity:" + review.id) setOpen(true);
      return chooser;
    }

    function artifactReviewRoleName(assignment) {
      const names = assignment?.slotNames || assignment?.slotIds || [];
      return names.length ? names.join(" / ") : assignment?.actorName || "";
    }

    function renderArtifactReviewHistorySelector(context) {
      const wrap = document.createElement("div");
      wrap.className = "artifact-review-controls";
      wrap.append(blockTitle(t("round")));
      const currentId = state.artifactReviewRoundByReview[context.review.id] || context.review.currentRoundId;
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
        state.artifactReviewOpenSelect = open ? "round:" + context.review.id : "";
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
        option.addEventListener("click", async () => {
          state.artifactReviewRoundByReview[context.review.id] = round.id;
          state.artifactReviewHistoryRoundId = round.id;
          writeStoredObject(artifactReviewRoundKey, state.artifactReviewRoundByReview);
          setOpen(false);
          await loadArtifactReviewContext(context.review.id, round.id, context.assignment?.actorId || "");
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
          if (chooser.isConnected && !chooser.contains(document.activeElement)) setOpen(false);
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
      if (state.artifactReviewOpenSelect === "round:" + context.review.id) setOpen(true);
      wrap.append(chooser);
      return wrap;
    }

    function syncArtifactReviewStatusMessage(context) {
      const existing = el.artifactReviewMyContent.querySelector("[data-artifact-review-status-message]");
      if (existing) existing.remove();
      const entry = artifactReviewLocalEntry(context);
      const statusMessage = entry?.status || state.artifactReviewConflict || entry?.warning || "";
      if (!statusMessage) return;
      const region = document.createElement("div");
      region.dataset.artifactReviewStatusMessage = "true";
      const conflict = document.createElement("div");
      conflict.className = "artifact-review-message" + (entry?.status ? "" : " warn");
      conflict.textContent = statusMessage;
      region.append(conflict);
      if (!entry?.status) {
        const refresh = document.createElement("button");
        refresh.className = "btn";
        refresh.textContent = displayLanguage === "zh" ? "刷新当前轮次" : "Refresh round";
        refresh.addEventListener("click", async () => {
          await syncArtifactReviewContext(true);
          renderAll();
        });
        region.append(refresh);
      }
      el.artifactReviewMyContent.prepend(region);
    }

    function renderArtifactReviewWorkspace(context) {
      syncArtifactReviewStatusMessage(context);
      const selectedRoundId = state.artifactReviewRoundByReview[context.review.id] || context.review.currentRoundId;
      const selectedRound = context.rounds.find(round => round.id === selectedRoundId)
        || context.rounds.find(round => round.id === context.review.currentRoundId);
      const viewingHistory = selectedRound?.id !== context.review.currentRoundId;
      renderArtifactReviewRoundSummary(context, selectedRound, viewingHistory, el.artifactReviewModalComments);
      if (viewingHistory) {
        const history = document.createElement("div");
        history.className = "artifact-review-message";
        history.textContent = displayLanguage === "zh"
          ? "历史轮次仅供查看，不能投票、添加意见或重新提交。"
          : "Historical rounds are read-only; voting, commenting, and resubmission are unavailable.";
        el.artifactReviewMyContent.append(history);
        renderArtifactReviewSubmittedOpinions(selectedRound, el.artifactReviewModalComments, false);
        return;
      }

      const assignment = context.assignment;
      if (!assignment) {
        const noReview = document.createElement("div");
        noReview.className = "artifact-review-message";
        noReview.textContent = displayLanguage === "zh" ? "无需评审" : "No review required";
        el.artifactReviewMyContent.append(noReview);
        renderArtifactReviewSubmittedOpinions(selectedRound, el.artifactReviewModalComments, false);
        return;
      }
      if (assignment.actorKind === "agent") {
        renderArtifactReviewAgentWorkspace(context, selectedRound);
        return;
      }
      const readOnly = assignment.status === "submitted" || context.review.status !== "pending";
      if (readOnly) {
        const submitted = document.createElement("div");
        submitted.className = "artifact-review-message";
        const vote = assignment.submitted?.vote;
        submitted.textContent = displayLanguage === "zh"
          ? "已提交评审 · " + artifactReviewVoteLabel(vote, assignment.binding)
          : "Review submitted · " + artifactReviewVoteLabel(vote, assignment.binding);
        const jump = document.createElement("button");
        jump.className = "btn";
        jump.textContent = displayLanguage === "zh" ? "查看正式意见" : "View submitted opinion";
        jump.addEventListener("click", () => scrollToArtifactReviewParticipant(assignment));
        el.artifactReviewMyContent.append(submitted, jump);
      } else {
        const commentGroup = artifactReviewOperationGroup(
          displayLanguage === "zh" ? "评审意见" : "Review comments",
          displayLanguage === "zh"
            ? "记录具体问题或建议。添加意见只保存草稿，不会提交整份评审。"
            : "Record specific issues or suggestions. Adding a comment saves a draft; it does not submit the review."
        );
        commentGroup.append(renderArtifactReviewCommentComposer(context));
        const draftComments = artifactReviewEffectiveDraft(context).comments || [];
        for (const comment of draftComments) {
          commentGroup.append(renderArtifactReviewCommentCard(comment, artifactReviewRoleName(assignment), true));
        }
        el.artifactReviewMyContent.append(commentGroup);

        const voteGroup = artifactReviewOperationGroup(
          displayLanguage === "zh" ? "投票" : "Vote",
          displayLanguage === "zh"
            ? "根据上述评审意见，选择你对本轮产物的最终立场。"
            : "Based on the review comments above, choose your final position on this Artifact."
        );
        voteGroup.append(renderArtifactVoteControl(context, false));
        el.artifactReviewMyContent.append(voteGroup);
      }
      renderArtifactReviewSubmittedOpinions(
        selectedRound,
        el.artifactReviewModalComments,
        selectedRound?.id === context.review.currentRoundId && context.review.status === "awaiting_runner_vote"
      );
    }

    function artifactReviewOperationGroup(titleText, helpText) {
      const section = document.createElement("section");
      section.className = "artifact-review-operation-group";
      const title = document.createElement("h4");
      title.textContent = titleText;
      const help = document.createElement("p");
      help.className = "artifact-review-operation-help";
      help.textContent = helpText;
      section.append(title, help);
      return section;
    }

    function renderArtifactReviewAgentWorkspace(context, selectedRound) {
      const assignment = context.assignment;
      const attempt = assignment.attempts?.[assignment.attempts.length - 1];
      const status = document.createElement("div");
      status.className = "artifact-review-agent-status";
      status.append(blockTitle(t("agentReviewer")));
      const retryKey = context.review.id + ":" + assignment.actorId;
      const retryState = state.artifactReviewRetries[retryKey];
      const progress = document.createElement("div");
      progress.className = "artifact-review-message" + (assignment.status === "failed" ? " warn" : "");
      progress.textContent = retryState
        ? retryState.status + " · " + t("attempt") + " " + retryState.attempt
        : artifactReviewAssignmentStatusLabel(assignment.status, "agent")
          + (attempt ? " · " + (attempt.provider || "Agent") + " · " + t("attempt") + " " + attempt.sequence : "");
      status.append(progress);
      if (retryState?.error) {
        const retryError = document.createElement("div");
        retryError.className = "muted artifact-review-id";
        retryError.textContent = retryState.error;
        status.append(retryError);
      }
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
        retry.addEventListener("click", () => retryArtifactReviewAgent(context));
        status.append(retry);
      }
      el.artifactReviewProgressContent.append(status);
      for (const comment of assignment.draft?.comments || []) {
        el.artifactReviewProgressContent.append(renderArtifactReviewCommentCard(comment, artifactReviewRoleName(assignment), false));
      }
      renderArtifactReviewSubmittedOpinions(
        selectedRound,
        el.artifactReviewModalComments,
        selectedRound?.id === context.review.currentRoundId && context.review.status === "awaiting_runner_vote"
      );
    }

    async function retryArtifactReviewAgent(context) {
      const key = context.review.id + ":" + context.assignment.actorId;
      const nextAttempt = (context.assignment.attempts?.at(-1)?.sequence || 0) + 1;
      state.artifactReviewRetries[key] = { status: "queued", attempt: nextAttempt };
      renderAll();
      try {
        const response = await fetch(artifactReviewAssignmentUrl(context, "retry"), { method: "POST" });
        if (!response.ok) throw new Error(await response.text());
        state.artifactReviewContext = await response.json();
        const attempt = state.artifactReviewContext.assignment?.attempts?.at(-1);
        state.artifactReviewRetries[key] = {
          status: state.artifactReviewContext.assignment?.status || "queued",
          attempt: attempt?.sequence || nextAttempt
        };
        await loadRuns();
      } catch (error) {
        state.artifactReviewRetries[key] = {
          status: "failed",
          attempt: nextAttempt,
          error: error instanceof Error ? error.message : String(error)
        };
      }
      renderAll();
    }

    function renderArtifactReviewSubmittedOpinions(
      round,
      target = el.artifactReviewModalComments,
      allowDisposition = false
    ) {
      const entries = (round?.assignments || [])
        .filter(assignment => assignment.submitted)
        .map(assignment => ({
          kind: "assignment",
          submittedAt: assignment.submitted.submittedAt,
          assignment,
          opinion: assignment.submitted
        }));
      for (const vote of round?.votes || []) {
        if (vote.subject?.kind === "runner") entries.push({ kind: "runner", submittedAt: vote.submittedAt, vote });
      }
      entries.sort((left, right) => new Date(right.submittedAt || 0).getTime() - new Date(left.submittedAt || 0).getTime());
      if (!entries.length) return;
      target.append(blockTitle(t("submittedOpinions")));
      for (const entry of entries) {
        target.append(entry.kind === "runner"
          ? renderArtifactReviewRunnerOpinion(entry.vote)
          : renderArtifactReviewAssignmentOpinion(
            entry.assignment,
            entry.opinion,
            round?.commentDispositions || [],
            allowDisposition
          ));
      }
    }

    function renderArtifactReviewAssignmentOpinion(assignment, opinion, dispositions = [], allowDisposition = false) {
      const section = artifactReviewOpinionSection(
        assignment,
        artifactReviewRoleName(assignment),
        opinion.submittedAt
      );
      section.append(blockTitle(t("voteSummary")));
      const voteSummary = document.createElement("div");
      voteSummary.className = "artifact-review-message" + (opinion.vote === "request_changes" ? " warn" : "");
      voteSummary.textContent = (assignment.binding === "decision" ? t("decisionVote") : t("advisoryVote"))
        + " · " + artifactReviewVoteLabel(opinion.vote, assignment.binding);
      section.append(voteSummary);
      const implementationEvidence = document.createElement("div");
      implementationEvidence.className = "muted";
      implementationEvidence.textContent = artifactReviewImplementationEvidenceLabel(
        assignment.implementationEvidenceReferenced
      );
      section.append(implementationEvidence);
      if (opinion.summary) {
        const summary = document.createElement("div");
        summary.className = "artifact-review-markdown";
        if (opinion.renderedSummary) summary.innerHTML = opinion.renderedSummary;
        else summary.textContent = opinion.summary;
        section.append(summary);
      }
      section.append(blockTitle(t("reviewComments")));
      const comments = opinion.comments || [];
      if (comments.length) {
        for (const comment of comments) {
          const disposition = dispositions.find(item => item.commentId === comment.id);
          section.append(renderArtifactReviewCommentCard(
            comment,
            artifactReviewRoleName(assignment),
            false,
            assignment.binding === "advisory",
            disposition,
            allowDisposition
          ));
        }
      } else {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = t("noReviewComments");
        section.append(empty);
      }
      return section;
    }

    function renderArtifactReviewRunnerOpinion(vote) {
      const section = artifactReviewOpinionSection({ actorId: "runner" }, t("runner"), vote.submittedAt);
      section.append(blockTitle(t("voteSummary")));
      const summary = document.createElement("div");
      summary.className = "artifact-review-message" + (vote.value === "request_changes" ? " warn" : "");
      summary.textContent = t("decisionVote") + " · " + artifactReviewVoteLabel(vote.value, "decision");
      section.append(summary);
      if (vote.comment) {
        const comment = document.createElement("div");
        comment.className = "artifact-review-markdown";
        if (vote.renderedComment) comment.innerHTML = vote.renderedComment;
        else comment.textContent = vote.comment;
        section.append(comment);
      }
      return section;
    }

    function artifactReviewOpinionSection(subject, actorName, submittedAtValue) {
      const section = document.createElement("article");
      section.className = "artifact-review-opinion";
      section.id = artifactReviewParticipantDomId(subject);
      const header = document.createElement("header");
      header.className = "artifact-review-opinion-head";
      const role = document.createElement("strong");
      role.textContent = actorName;
      const submittedAt = document.createElement("time");
      submittedAt.className = "muted";
      submittedAt.dateTime = submittedAtValue || "";
      submittedAt.textContent = formatTime(submittedAtValue);
      header.append(role, submittedAt);
      section.append(header);
      return section;
    }

    function renderArtifactVoteControl(context, readOnly) {
      const group = document.createElement("div");
      group.className = "artifact-review-vote";
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-label", context.assignment.binding === "decision" ? t("decisionVote") : t("advisoryVote"));
      const draft = artifactReviewEffectiveDraft(context);
      const current = context.assignment.submitted?.vote || draft.vote;
      for (const value of ["approve", "request_changes", "abstain"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn" + (current === value ? " active" : "");
        button.textContent = artifactReviewVoteLabel(value, context.assignment.binding);
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", String(current === value));
        button.disabled = readOnly || state.artifactReviewSaving;
        button.addEventListener("click", () => saveArtifactReviewDraft({
          ...draft,
          vote: value
        }, { voteDirty: true }));
        group.append(button);
      }
      return group;
    }

    function renderArtifactReviewCommentComposer(context) {
      const wrap = document.createElement("div");
      wrap.className = "artifact-review-comment";
      const entry = ensureArtifactReviewLocalEntry(context);
      const textarea = document.createElement("textarea");
      textarea.placeholder = displayLanguage === "zh" ? "补充整体评审意见" : "Add an overall review comment";
      textarea.value = entry?.composerText || "";
      textarea.addEventListener("input", () => {
        const activeEntry = ensureArtifactReviewLocalEntry(context);
        if (activeEntry) {
          const pendingId = activeEntry.pendingComposerCommentId;
          const pending = pendingId
            ? activeEntry.draft.comments.find(comment => comment.id === pendingId)
            : null;
          if (pending && pending.body !== textarea.value.trim()) {
            discardArtifactReviewPendingComment(context, pendingId);
            activeEntry.pendingComposerCommentId = "";
          }
          activeEntry.composerText = textarea.value;
        }
      });
      textarea.disabled = state.artifactReviewSaving;
      let selectedSeverity = entry?.composerSeverity || "risk";
      const severity = document.createElement("div");
      severity.className = "artifact-review-round-select artifact-review-severity-select";
      const severityTrigger = document.createElement("button");
      severityTrigger.type = "button";
      severityTrigger.className = "artifact-review-select artifact-review-select-trigger";
      severityTrigger.setAttribute("role", "combobox");
      severityTrigger.setAttribute("aria-label", displayLanguage === "zh" ? "意见分类" : "Comment severity");
      severityTrigger.setAttribute("aria-haspopup", "listbox");
      severityTrigger.setAttribute("aria-expanded", "false");
      severityTrigger.disabled = state.artifactReviewSaving;
      const severityText = document.createElement("span");
      severityText.textContent = artifactReviewSeverityLabel(selectedSeverity);
      const severityCaret = document.createElement("span");
      severityCaret.className = "artifact-review-select-caret";
      severityCaret.setAttribute("aria-hidden", "true");
      severityCaret.textContent = "⌄";
      severityTrigger.append(severityText, severityCaret);
      const severityMenu = document.createElement("div");
      severityMenu.className = "artifact-review-select-menu";
      severityMenu.setAttribute("role", "listbox");
      severityMenu.setAttribute("aria-label", displayLanguage === "zh" ? "意见分类" : "Comment severity");
      severityMenu.hidden = true;
      const setSeverityOpen = open => {
        severityMenu.hidden = !open;
        severityTrigger.setAttribute("aria-expanded", String(open));
      };
      const focusSeverityOption = offset => {
        const options = [...severityMenu.querySelectorAll(".artifact-review-select-option")];
        if (!options.length) return;
        const focusedIndex = options.indexOf(document.activeElement);
        const selectedIndex = options.findIndex(option => option.getAttribute("aria-selected") === "true");
        const start = focusedIndex >= 0 ? focusedIndex : selectedIndex >= 0 ? selectedIndex : 0;
        options[(start + offset + options.length) % options.length].focus();
      };
      for (const value of ["blocking", "risk", "suggestion"]) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "artifact-review-select-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(value === selectedSeverity));
        option.textContent = artifactReviewSeverityLabel(value);
        option.addEventListener("click", () => {
          selectedSeverity = value;
          severityText.textContent = artifactReviewSeverityLabel(value);
          for (const item of severityMenu.querySelectorAll(".artifact-review-select-option")) {
            item.setAttribute("aria-selected", String(item === option));
          }
          const activeEntry = ensureArtifactReviewLocalEntry(context);
          if (activeEntry) activeEntry.composerSeverity = value;
          setSeverityOpen(false);
          severityTrigger.focus();
        });
        severityMenu.append(option);
      }
      severityTrigger.addEventListener("click", () => {
        setSeverityOpen(severityMenu.hidden);
        if (!severityMenu.hidden) {
          setTimeout(() => {
            document.addEventListener("pointerdown", event => {
              if (!severity.contains(event.target)) setSeverityOpen(false);
            }, { once: true });
          }, 0);
        }
      });
      severityTrigger.addEventListener("keydown", event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setSeverityOpen(true);
          focusSeverityOption(event.key === "ArrowDown" ? 1 : -1);
        } else if (event.key === "Escape") {
          event.preventDefault();
          setSeverityOpen(false);
        }
      });
      severityMenu.addEventListener("keydown", event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          focusSeverityOption(event.key === "ArrowDown" ? 1 : -1);
        } else if (event.key === "Escape") {
          event.preventDefault();
          setSeverityOpen(false);
          severityTrigger.focus();
        }
      });
      severity.addEventListener("focusout", () => {
        setTimeout(() => {
          if (severity.isConnected && !severity.contains(document.activeElement)) setSeverityOpen(false);
        }, 0);
      });
      severity.append(severityTrigger, severityMenu);
      const add = document.createElement("button");
      add.className = "btn";
      add.textContent = displayLanguage === "zh" ? "添加意见" : "Add comment";
      add.disabled = state.artifactReviewSaving;
      add.addEventListener("click", () => {
        const body = textarea.value.trim();
        if (!body) return textarea.focus();
        runButtonAction(add, async () => {
          const activeEntry = ensureArtifactReviewLocalEntry(context);
          const commentId = activeEntry?.pendingComposerCommentId || uuid();
          if (activeEntry) activeEntry.pendingComposerCommentId = commentId;
          const draft = artifactReviewEffectiveDraft(context);
          const comment = { id: commentId, body, severity: selectedSeverity };
          const result = await saveArtifactReviewDraft({
            ...draft,
            comments: draft.comments.some(existing => existing.id === comment.id)
              ? draft.comments.map(existing => existing.id === comment.id ? comment : existing)
              : draft.comments.concat(comment)
          }, { changedCommentIds: [comment.id], clearComposerOnSuccess: true });
          if (result.ok && activeEntry) activeEntry.pendingComposerCommentId = "";
          return result.ok;
        });
      });
      wrap.append(severity, textarea, add);
      return wrap;
    }

    function renderArtifactReviewCommentCard(
      comment,
      actorName,
      editable,
      advisory = false,
      disposition = null,
      allowDisposition = false
    ) {
      const card = document.createElement("article");
      card.className = "comment-card";
      const header = document.createElement("header");
      header.className = "artifact-review-comment-head";
      const title = document.createElement("b");
      title.textContent = actorName + (comment.anchor?.target ? " · " + comment.anchor.target : "");
      header.append(title);
      if (comment.severity) {
        header.append(pill(artifactReviewSeverityLabel(comment.severity), false, comment.severity === "blocking" ? "outdated" : "warn"));
      }
      const body = document.createElement("div");
      body.className = "artifact-review-markdown";
      if (comment.renderedBody) body.innerHTML = comment.renderedBody;
      else body.textContent = comment.body;
      card.append(header, body);
      if (comment.anchor?.context) {
        const context = document.createElement("div");
        context.className = "artifact-review-comment-context";
        context.textContent = comment.anchor.context;
        card.append(context);
      }
      if (disposition) {
        const resolution = document.createElement("div");
        resolution.className = "artifact-review-message";
        resolution.textContent = (displayLanguage === "zh" ? "处置：" : "Disposition: ")
          + artifactReviewDispositionLabel(disposition.disposition)
          + (disposition.note ? " · " + disposition.note : "");
        card.append(resolution);
        if (disposition.validationSummary) {
          const validation = document.createElement("div");
          validation.className = "muted";
          validation.textContent = (displayLanguage === "zh" ? "验证：" : "Validation: ")
            + disposition.validationSummary;
          card.append(validation);
        }
      }
      if (comment.anchor?.location || comment.anchor?.target) {
        const go = document.createElement("button");
        go.className = "btn";
        go.textContent = displayLanguage === "zh" ? "定位" : "Go to";
        go.addEventListener("click", () => runButtonAction(go, () => locateArtifactReviewComment(comment)));
        card.append(go);
      }
      if (editable) {
        const remove = document.createElement("button");
        remove.className = "btn danger";
        remove.textContent = displayLanguage === "zh" ? "删除" : "Remove";
        remove.addEventListener("click", () => runButtonAction(remove, () => removeComment(comment.id)));
        card.append(remove);
      } else if (
        allowDisposition
        && advisory
        && comment.id
        && activeArtifactReviewSummary()?.status === "awaiting_runner_vote"
      ) {
        const resolve = document.createElement("button");
        resolve.className = "btn";
        resolve.textContent = displayLanguage === "zh" ? "处置" : "Resolve";
        resolve.addEventListener("click", () => runButtonAction(resolve, () => resolveArtifactReviewCommentInView(comment)));
        card.append(resolve);
      }
      return card;
    }

    function artifactReviewDispositionLabel(value) {
      if (displayLanguage !== "zh") {
        return ({
          "accepted-fixed": "Accepted and fixed",
          "accepted-followup": "Accepted for follow-up",
          "rejected-out-of-scope": "Out of scope",
          "rejected-not-blocking": "Not blocking",
          "rejected-invalid": "Invalid"
        })[value] || value;
      }
      return ({
        "accepted-fixed": "已接受并修复",
        "accepted-followup": "已接受，后续处理",
        "rejected-out-of-scope": "超出范围",
        "rejected-not-blocking": "不构成阻塞",
        "rejected-invalid": "无效意见"
      })[value] || value;
    }

    async function locateArtifactReviewComment(comment) {
      const context = state.artifactReviewContext;
      if (!context || !comment.anchor) return;
      const targetRound = context.rounds.find(round => round.submissionId === comment.anchor.submissionId);
      if (!targetRound) {
        state.artifactReviewLocateFailure = displayLanguage === "zh"
          ? "无法找到该意见对应的评审轮次，已保留原始定位引用。"
          : "The review round for this comment is unavailable; the original reference is preserved.";
        renderAll();
        return;
      }
      if (context.submission.id !== comment.anchor.submissionId) {
        state.artifactReviewRoundByReview[context.review.id] = targetRound.id;
        writeStoredObject(artifactReviewRoundKey, state.artifactReviewRoundByReview);
        await loadArtifactReviewContext(context.review.id, targetRound.id, context.assignment?.actorId || "");
        renderAll();
      }
      const anchor = comment.anchor.location || comment.anchor.target;
      const target = el.artifactReviewArtifactContent.querySelector('[data-anchor="' + CSS.escape(anchor) + '"]')
        || el.artifactReviewArtifactContent.querySelector('[data-anchor="' + CSS.escape(comment.anchor.target) + '"]');
      if (!target) {
        state.artifactReviewLocateFailure = (displayLanguage === "zh" ? "无法精确定位：" : "Unable to locate: ")
          + comment.anchor.target;
        renderAll();
        return;
      }
      state.artifactReviewLocateFailure = "";
      setArtifactReviewMobilePane("artifact");
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.classList.remove("artifact-review-target-located");
      setTimeout(() => target.classList.add("artifact-review-target-located"), 20);
      setTimeout(() => target.classList.remove("artifact-review-target-located"), 1800);
    }

    async function resolveArtifactReviewCommentInView(comment) {
      const context = state.artifactReviewContext;
      if (!context) return;
      const disposition = prompt("Disposition: accepted-fixed / accepted-followup / rejected-out-of-scope / rejected-not-blocking / rejected-invalid", "rejected-not-blocking");
      if (!disposition) return false;
      const note = prompt("Disposition note", "") || "";
      if (!note.trim()) return false;
      const validationSummary = disposition === "accepted-fixed" ? (prompt("Validation summary", "") || "") : undefined;
      const response = await fetch("/api/artifact-reviews/" + encodeURIComponent(context.review.id)
        + "/rounds/" + encodeURIComponent(context.review.currentRoundId)
        + "/comments/" + encodeURIComponent(comment.id) + "/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disposition, note, validationSummary })
      });
      if (!response.ok) throw new Error(await response.text());
      await loadRuns();
      await loadArtifactReviewContext(context.review.id, context.review.currentRoundId, context.assignment?.actorId || "");
      renderAll();
      return true;
    }

    function renderArtifactReviewRoundSummary(context, round, history, target = el.artifactReviewModalComments) {
      if (!round) return;
      target.append(blockTitle(t("roundSummary")));
      const summary = document.createElement("div");
      summary.className = "artifact-review-message" + (round.status === "changes_requested" ? " warn" : "");
      const result = round.result;
      if (result) {
        const decisionText = result.decisionApprove + "/" + result.decisionTotal;
        summary.textContent = displayLanguage === "zh"
          ? (round.status === "passed"
              ? "本轮已通过：" + decisionText + " 张决策票通过；另记录 " + result.advisoryTotal + " 张建议票。"
              : "本轮要求修改：" + decisionText + " 张决策票通过，未达到当前决策规则；另记录 " + result.advisoryTotal + " 张建议票。")
          : (round.status === "passed"
              ? "This round passed: " + decisionText + " decision votes approved; " + result.advisoryTotal + " advisory votes were recorded."
              : "This round requested changes: " + decisionText + " decision votes approved, which did not satisfy the policy; " + result.advisoryTotal + " advisory votes were recorded.");
      } else {
        summary.textContent = t("round") + " " + round.sequence + " · "
          + (round.assignments || []).filter(assignment => assignment.status === "submitted").length
          + "/" + (round.assignments || []).length + " " + t("submitted");
      }
      target.append(summary);
      if (history) {
        const id = document.createElement("div");
        id.className = "muted artifact-review-id";
        id.textContent = round.id;
        target.append(id);
      }
      if (round.revisionSummary?.body) {
        target.append(blockTitle(t("revisionSummary")));
        const revision = document.createElement("div");
        revision.className = "pre";
        revision.textContent = round.revisionSummary.body;
        target.append(revision);
      }
    }

    function artifactReviewVoteLabel(value, binding) {
      if (value === "approve") return t("approve");
      if (value === "request_changes") return t("requestChanges");
      if (value === "abstain") return t("abstain");
      return t("draft");
    }

    function artifactReviewSeverityLabel(value) {
      if (displayLanguage !== "zh") {
        return ({ blocking: "Blocking", risk: "Risk", suggestion: "Suggestion" })[value] || value;
      }
      return ({ blocking: "阻塞问题", risk: "风险", suggestion: "建议" })[value] || value;
    }

    function artifactReviewAssignmentStatusLabel(status, actorKind) {
      if (status === "submitted") return t("submitted");
      if (actorKind !== "agent") return t("draft");
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
      return "Memory" + (comment.location?.line ? " · Line " + comment.location.line : " · Unanchored");
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
      const target = comment.artifactName || comment.target;
      return "Memory · " + comment.memoryName + (target ? " · " + target : "");
    }

    function selectCommentSubject(comment) {
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
        meta.append(pill((review.commentCount ?? review.comments?.length ?? 0) + " comments"));
        button.append(title, meta);
        button.addEventListener("click", async () => {
          state.routeError = "";
          state.routeLanding = "";
          state.selectedReviewId = state.selectedReviewId === review.id ? null : review.id;
          saveSelectedReview();
          if (state.selectedReviewId) await loadReviewDetail(state.selectedReviewId);
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
