export const modelStyles = `
  [data-models] { min-width:0; min-height:100%; padding:var(--mem-view-space-6); color:var(--mem-view-color-text); background:var(--mem-view-color-canvas); font:var(--mem-view-font-size-base)/var(--mem-view-line-body) var(--mem-view-font-sans); }
  [data-models] .model-browser-body { max-width:var(--mem-view-layout-content-max); margin:0 auto; display:grid; min-width:0; gap:var(--mem-view-space-5); }
  [data-models] .model-browser-heading { margin:0; font-size:var(--mem-view-font-size-xl); line-height:var(--mem-view-line-heading); overflow-wrap:anywhere; }
  [data-models] .model-browser-description { margin:0; color:var(--mem-view-color-text-muted); }
  [data-models] .model-browser-meta { display:grid; grid-template-columns:160px minmax(0,1fr); gap:var(--mem-view-space-2) var(--mem-view-space-4); margin:0; }
  [data-models] .model-browser-meta dt { color:var(--mem-view-color-text-muted); }
  [data-models] .model-browser-meta dd { margin:0; overflow-wrap:anywhere; font-family:var(--mem-view-font-mono); }
  [data-models] .model-browser-code { min-width:0; max-width:100%; overflow:auto; white-space:pre; padding:var(--mem-view-space-4); margin:0; background:var(--mem-view-color-surface); border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-md); font:var(--mem-view-font-size-sm)/var(--mem-view-line-body) var(--mem-view-font-mono); }
  [data-models] .model-browser-actions { display:flex; flex-wrap:wrap; gap:var(--mem-view-space-2); }
  [data-models] .model-browser-form { display:grid; gap:var(--mem-view-space-4); max-width:720px; }
  [data-models] .model-browser-code-header { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:var(--mem-view-space-3); }
  [data-models] .model-browser-code-header h3 { margin:0; font-size:var(--mem-view-font-size-md); }
  [data-models] .model-definition-structure { display:grid; gap:var(--mem-view-space-3); min-width:0; }
  [data-models] .model-browser-definition-panel { min-width:0; }
  [data-models] .model-definition-table-scroll { max-width:100%; overflow:auto; border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-md); }
  [data-models] .model-definition-table { width:100%; min-width:560px; border-collapse:collapse; background:var(--mem-view-color-surface); font-size:var(--mem-view-font-size-sm); }
  [data-models] .model-definition-table th { text-align:left; background:var(--mem-view-color-canvas); color:var(--mem-view-color-text-muted); font-size:var(--mem-view-font-size-sm); }
  [data-models] .model-definition-table th, [data-models] .model-definition-table td { padding:var(--mem-view-space-2) var(--mem-view-space-3); border-bottom:1px solid var(--mem-view-color-border); vertical-align:top; }
  [data-models] .model-definition-table th { white-space:nowrap; }
  [data-models] .model-definition-table td:first-child { white-space:nowrap; }
  [data-models] .model-definition-table td:nth-child(2), [data-models] .model-definition-table td:nth-child(3), [data-models] .model-definition-table td:nth-child(4) { white-space:nowrap; }
  [data-models] .model-definition-table th:last-child { width:40%; }
  [data-models] .model-definition-table tr:last-child td { border-bottom:0; }
  [data-models] .model-definition-field { display:flex; align-items:stretch; min-height:1.5em; }
  [data-models] .model-definition-toggle, [data-models] .model-definition-leaf { display:inline-flex; align-items:center; gap:var(--mem-view-space-1); }
  [data-models] .model-definition-toggle { border:0; padding:0; background:transparent; color:var(--mem-view-color-text); font:inherit; cursor:pointer; }
  [data-models] .model-definition-toggle:hover { color:var(--mem-view-color-accent); }
  [data-models] .model-definition-arrow { display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box; width:var(--mem-view-space-4); height:var(--mem-view-space-4); flex:0 0 var(--mem-view-space-4); line-height:1; }
  [data-models] .model-definition-toggle .model-definition-arrow { border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-sm); background:var(--mem-view-color-canvas); color:var(--mem-view-color-text-muted); }
  [data-models] .model-definition-name { font-family:var(--mem-view-font-mono); }
  [data-models] .model-definition-indent { display:flex; flex-shrink:0; }
  [data-models] .model-definition-indent-step { width:var(--mem-view-space-4); flex:0 0 var(--mem-view-space-4); }
  [data-models] .model-definition-field-title, [data-models] .model-definition-node-label { align-self:center; margin-left:var(--mem-view-space-2); color:var(--mem-view-color-text-muted); font-size:var(--mem-view-font-size-sm); }
  [data-models] .model-definition-node-label { border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-sm); padding:0 var(--mem-view-space-1); }
  [data-models] .model-definition-table tr:is([data-definition-kind="element"], [data-definition-kind="dynamic-field"], [data-definition-kind="branch"]) td { background:var(--mem-view-color-canvas); color:var(--mem-view-color-text-muted); }
  [data-models] .model-definition-table tr:is([data-definition-kind="element"], [data-definition-kind="dynamic-field"], [data-definition-kind="branch"]) .model-definition-name { font-family:var(--mem-view-font-sans); }
  [data-models] .model-definition-table td.model-definition-format { min-width:8em; white-space:pre-line; overflow-wrap:anywhere; }
  [data-models] .model-definition-table td.model-definition-rules { min-width:8em; white-space:normal; overflow-wrap:anywhere; }
  @media (max-width:700px) {
    [data-models] { padding:var(--mem-view-space-4); }
    [data-models] .model-browser-meta { grid-template-columns:1fr; }
    [data-models] .model-browser-meta dd { margin-bottom:var(--mem-view-space-2); }
  }

  [data-models] .model-definition-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:var(--mem-view-space-4); }
  [data-models] .model-definition-text-action { min-height:var(--mem-view-space-6); border:0; background:transparent; padding:0; color:var(--mem-view-color-accent); font:400 var(--mem-view-font-size-sm)/var(--mem-view-line-compact) var(--mem-view-font-sans); cursor:pointer; }
  [data-models] .model-definition-text-action:hover:not(:disabled) { background:transparent; color:var(--mem-view-color-accent-hover); text-decoration:underline; }
  [data-models] .model-definition-text-action:focus-visible { outline:2px solid var(--mem-view-color-accent); outline-offset:2px; box-shadow:0 0 0 3px var(--mem-view-color-focus-ring); }
`;

export const registrationStyles = `
[data-models-list] .model-tags-filter{padding:var(--mem-view-space-2) var(--mem-view-space-4)}
[data-models-list] .model-tags-filter .mem-view-field{min-width:0;margin:0}
[data-models] .model-information-table{border:1px solid var(--mem-view-color-border);border-radius:var(--mem-view-radius-md);background:var(--mem-view-color-surface);border-collapse:collapse;width:100%;font-size:var(--mem-view-font-size-sm)}
[data-models] .model-information-table th,[data-models] .model-information-table td{padding:var(--mem-view-space-3);border-bottom:1px solid var(--mem-view-color-border);text-align:left;vertical-align:top;overflow-wrap:anywhere}
[data-models] .model-information-table th{width:120px;color:var(--mem-view-color-text-muted);font-weight:400;background:var(--mem-view-color-canvas)}
[data-models] .model-market-grid{display:grid;gap:var(--mem-view-space-4)}
[data-models] .model-market-card{padding:var(--mem-view-space-5);border:1px solid var(--mem-view-color-border);border-radius:var(--mem-view-radius-md);background:var(--mem-view-color-surface)}
[data-models] .model-market-card h3{margin-top:0}
@media(max-width:700px){[data-models] .model-information-table th{width:85px}}
`;
