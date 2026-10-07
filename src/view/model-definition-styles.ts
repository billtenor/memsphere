export const modelDefinitionStyles = `
  :where([data-mem-model-definition]) { min-width:0; color:var(--mem-view-color-text); font:var(--mem-view-font-size-base)/var(--mem-view-line-body) var(--mem-view-font-sans); }
  :where([data-mem-model-definition]) .model-browser-code { min-width:0; max-width:100%; overflow:auto; white-space:pre; padding:var(--mem-view-space-4); margin:0; background:var(--mem-view-color-surface); border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-md); font:var(--mem-view-font-size-sm)/var(--mem-view-line-body) var(--mem-view-font-mono); }
  :where([data-mem-model-definition]) .model-definition-structure { display:grid; gap:var(--mem-view-space-3); min-width:0; }
  :where([data-mem-model-definition]) .model-definition-table-scroll { max-width:100%; overflow:auto; border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-md); }
  :where([data-mem-model-definition]) .model-definition-table { width:100%; min-width:560px; border-collapse:collapse; background:var(--mem-view-color-surface); font-size:var(--mem-view-font-size-sm); }
  :where([data-mem-model-definition]) .model-definition-table th { text-align:left; background:var(--mem-view-color-canvas); color:var(--mem-view-color-text-muted); font-size:var(--mem-view-font-size-sm); }
  :where([data-mem-model-definition]) .model-definition-table th, :where([data-mem-model-definition]) .model-definition-table td { padding:var(--mem-view-space-2) var(--mem-view-space-3); border-bottom:1px solid var(--mem-view-color-border); vertical-align:top; }
  :where([data-mem-model-definition]) .model-definition-table th { white-space:nowrap; }
  :where([data-mem-model-definition]) .model-definition-table td:first-child { white-space:nowrap; }
  :where([data-mem-model-definition]) .model-definition-table td:nth-child(2), :where([data-mem-model-definition]) .model-definition-table td:nth-child(3), :where([data-mem-model-definition]) .model-definition-table td:nth-child(4) { white-space:nowrap; }
  :where([data-mem-model-definition]) .model-definition-table th:last-child { width:40%; }
  :where([data-mem-model-definition]) .model-definition-table tr:last-child td { border-bottom:0; }
  :where([data-mem-model-definition]) .model-definition-field { display:flex; align-items:stretch; min-height:1.5em; }
  :where([data-mem-model-definition]) .model-definition-toggle, :where([data-mem-model-definition]) .model-definition-leaf { display:inline-flex; align-items:center; gap:var(--mem-view-space-1); }
  :where([data-mem-model-definition]) .model-definition-toggle { border:0; padding:0; background:transparent; color:var(--mem-view-color-text); font:inherit; cursor:pointer; }
  :where([data-mem-model-definition]) .model-definition-toggle:hover { color:var(--mem-view-color-accent); }
  :where([data-mem-model-definition]) .model-definition-arrow { display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box; width:var(--mem-view-space-4); height:var(--mem-view-space-4); flex:0 0 var(--mem-view-space-4); line-height:1; }
  :where([data-mem-model-definition]) .model-definition-toggle .model-definition-arrow { border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-sm); background:var(--mem-view-color-canvas); color:var(--mem-view-color-text-muted); }
  :where([data-mem-model-definition]) .model-definition-name { font-family:var(--mem-view-font-mono); }
  :where([data-mem-model-definition]) .model-definition-indent { display:flex; flex-shrink:0; }
  :where([data-mem-model-definition]) .model-definition-indent-step { width:var(--mem-view-space-4); flex:0 0 var(--mem-view-space-4); }
  :where([data-mem-model-definition]) .model-definition-field-title, :where([data-mem-model-definition]) .model-definition-node-label { align-self:center; margin-left:var(--mem-view-space-2); color:var(--mem-view-color-text-muted); font-size:var(--mem-view-font-size-sm); }
  :where([data-mem-model-definition]) .model-definition-node-label { border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-sm); padding:0 var(--mem-view-space-1); }
  :where([data-mem-model-definition]) .model-definition-table tr:is([data-definition-kind="element"], [data-definition-kind="dynamic-field"], [data-definition-kind="branch"]) td { background:var(--mem-view-color-canvas); color:var(--mem-view-color-text-muted); }
  :where([data-mem-model-definition]) .model-definition-table tr:is([data-definition-kind="element"], [data-definition-kind="dynamic-field"], [data-definition-kind="branch"]) .model-definition-name { font-family:var(--mem-view-font-sans); }
  :where([data-mem-model-definition]) .model-definition-table td.model-definition-format { min-width:8em; white-space:pre-line; overflow-wrap:anywhere; }
  :where([data-mem-model-definition]) .model-definition-table td.model-definition-rules { min-width:8em; white-space:normal; overflow-wrap:anywhere; }
  :where([data-mem-model-definition]) .model-definition-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:var(--mem-view-space-4); }
  :where([data-mem-model-definition]) .model-definition-text-action { min-height:var(--mem-view-space-6); border:0; background:transparent; padding:0; color:var(--mem-view-color-accent); font:400 var(--mem-view-font-size-sm)/var(--mem-view-line-compact) var(--mem-view-font-sans); cursor:pointer; }
  :where([data-mem-model-definition]) .model-definition-text-action:hover:not(:disabled) { background:transparent; color:var(--mem-view-color-accent-hover); text-decoration:underline; }
  :where([data-mem-model-definition]) .model-definition-text-action:focus-visible { outline:2px solid var(--mem-view-color-accent); outline-offset:2px; box-shadow:0 0 0 3px var(--mem-view-color-focus-ring); }
  :where([data-mem-model-definition]) .model-definition-toggle:focus-visible { outline:2px solid var(--mem-view-color-accent); outline-offset:2px; }
`;
