export const modelStyles = `
  [data-models] { min-width:0; min-height:100%; padding:var(--mem-view-space-6); color:var(--mem-view-color-text); background:var(--mem-view-color-canvas); font:var(--mem-view-font-size-base)/var(--mem-view-line-body) var(--mem-view-font-sans); }
  [data-models] .model-browser-body { max-width:var(--mem-view-layout-content-max); margin:0 auto; display:grid; min-width:0; gap:var(--mem-view-space-5); }
  [data-models] .model-browser-heading { margin:0; font-size:var(--mem-view-font-size-xl); line-height:var(--mem-view-line-heading); overflow-wrap:anywhere; }
  [data-models] .model-browser-description { margin:0; color:var(--mem-view-color-text-muted); }
  [data-models] .model-browser-meta { display:grid; grid-template-columns:160px minmax(0,1fr); gap:var(--mem-view-space-2) var(--mem-view-space-4); margin:0; }
  [data-models] .model-browser-meta dt { color:var(--mem-view-color-text-muted); }
  [data-models] .model-browser-meta dd { margin:0; overflow-wrap:anywhere; font-family:var(--mem-view-font-mono); }
  [data-models] .model-browser-actions { display:flex; flex-wrap:wrap; gap:var(--mem-view-space-2); }
  [data-models] .model-browser-form { display:grid; gap:var(--mem-view-space-4); max-width:720px; }
  [data-models] .model-browser-code-header { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:var(--mem-view-space-3); }
  [data-models] .model-browser-code-header h3 { margin:0; font-size:var(--mem-view-font-size-md); }
  [data-models] .model-browser-definition-panel { min-width:0; }
  @media (max-width:700px) {
    [data-models] { padding:var(--mem-view-space-4); }
    [data-models] .model-browser-meta { grid-template-columns:1fr; }
    [data-models] .model-browser-meta dd { margin-bottom:var(--mem-view-space-2); }
  }

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
