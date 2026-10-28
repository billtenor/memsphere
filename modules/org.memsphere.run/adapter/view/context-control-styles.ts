export const contextControlStyles = `
.cc-exploration {
  min-height:100%; box-sizing:border-box; padding:0;
  color:var(--mem-view-color-text); background:var(--mem-view-color-canvas);
  font:14px/1.6 var(--mem-view-font-sans);
}
.cc-exploration * { box-sizing:border-box; }
.cc-work { min-width:0; margin-bottom:24px; }
.cc-work-step { margin:8px 0; padding:12px; border:1px solid var(--mem-view-color-border); border-radius:8px; }
.cc-work summary { cursor:pointer; overflow-wrap:anywhere; }
.cc-work pre { max-width:100%; white-space:pre-wrap; overflow-wrap:anywhere; font-size:12px; }
.cc-exploration button { font:inherit; }
.cc-exploration button:focus-visible { outline:3px solid var(--mem-view-color-focus-ring); outline-offset:3px; }

.cc-group { display:flex; align-items:center; gap:10px; }
.cc-modal-head { display:flex; align-items:center; gap:10px; }
.cc-review-head { display:flex; align-items:center; gap:10px; }

.cc-modal-head { justify-content:flex-start; }


.cc-button { border:1px solid var(--mem-view-color-border); border-radius:6px; background:var(--mem-view-color-surface); color:var(--mem-view-color-text); cursor:pointer; padding:6px 10px; }
.cc-toggle { border:1px solid var(--mem-view-color-border); border-radius:6px; background:var(--mem-view-color-surface); color:var(--mem-view-color-text); cursor:pointer; padding:6px 10px; }
.cc-text-button { border:1px solid var(--mem-view-color-border); border-radius:6px; background:var(--mem-view-color-surface); color:var(--mem-view-color-text); cursor:pointer; padding:6px 10px; }
.cc-button:hover { border-color:var(--mem-view-color-accent); }
.cc-toggle:hover { border-color:var(--mem-view-color-accent); }
.cc-toggle[aria-pressed="true"] { border-color:var(--mem-view-color-accent); color:var(--mem-view-color-accent); background:var(--mem-view-color-accent-soft); }
.cc-text-button { background:transparent; border-color:transparent; color:var(--mem-view-color-accent); padding:3px 5px; }
.cc-chip { display:inline-flex; align-items:center; gap:5px; padding:2px 7px; border:1px solid var(--mem-view-color-border); border-radius:5px; font-size:11px; line-height:1.6; color:var(--mem-view-color-text-muted); background:var(--mem-view-color-subtle); }
.cc-chip-accent { color:var(--mem-view-color-accent); background:var(--mem-view-color-accent-soft); border-color:transparent; }
.cc-chip-note { background:var(--mem-view-color-surface); }
.cc-graph-card { overflow:hidden; border:1px solid var(--mem-view-color-border); border-radius:10px; background:var(--mem-view-color-surface); }

.cc-graph { position:relative; margin:0 auto; width:890px; height:330px; }
.cc-graph svg { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; overflow:visible; }
.cc-edge-hit { fill:none; stroke:transparent; stroke-width:16; pointer-events:stroke; }

.cc-node[data-edge-highlighted="true"] { border-color:var(--mem-view-color-accent); box-shadow:0 0 0 2px var(--mem-view-color-accent-soft); }

.cc-external strong, .cc-external-source { overflow-wrap:anywhere; }
.cc-external-pane { flex:1; min-height:0; }

.cc-node-stack { position:absolute; width:226px; }
.cc-node-stack:focus-within { z-index:4; }
.cc-node { position:relative; width:226px; min-height:126px; padding:15px 16px 12px; border:1px solid var(--mem-view-color-border); border-radius:8px; background:var(--mem-view-color-surface); color:var(--mem-view-color-text); cursor:pointer; text-align:left; box-shadow:0 2px 5px #00000004; transition:border-color .15s,box-shadow .15s; }
.cc-node:hover { border-color:var(--mem-view-color-accent); box-shadow:0 3px 14px #00000009; }
.cc-node-version { text-align:right; color:var(--mem-view-color-text-muted); font-size:10px; letter-spacing:.02em; }
.cc-node strong { display:block; font-size:14px; margin:9px 0 5px; font-weight:600; }
.cc-node-tags { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:10px; }
.cc-node-footer { display:flex; align-items:center; justify-content:space-between; font-size:11px; color:var(--mem-view-color-text-muted); border-top:1px solid var(--mem-view-color-border); padding-top:8px; }
.cc-node[data-selected="true"] { border-color:var(--mem-view-color-accent); }
.cc-history { position:relative; margin-top:8px; font-size:12px; }
.cc-history summary { width:fit-content; color:var(--mem-view-color-accent); cursor:pointer; padding:3px 6px; border-radius:4px; }
.cc-history summary:focus-visible { outline:3px solid var(--mem-view-color-focus-ring); outline-offset:3px; }
.cc-history-menu { position:absolute; top:100%; left:0; width:290px; max-width:75vw; max-height:230px; overflow:auto; z-index:5; padding:5px; border:1px solid var(--mem-view-color-border); border-radius:8px; background:var(--mem-view-color-surface); box-shadow:var(--mem-view-shadow-popover); }
.cc-history-option { display:block; width:100%; padding:9px 10px; border:0; border-radius:4px; background:transparent; color:var(--mem-view-color-text); text-align:left; cursor:pointer; }
.cc-history-option:hover { background:var(--mem-view-color-subtle); }
.cc-history-option[aria-current="true"] { color:var(--mem-view-color-accent); background:var(--mem-view-color-accent-soft); }
.cc-version-bar { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
.cc-version-bar label { min-width:0; max-width:100%; font-size:12px; color:var(--mem-view-color-text-muted); }
.cc-version-select { max-width:100%; min-width:0; }

.cc-button:disabled { opacity:.4; cursor:default; }
.cc-state { display:grid; justify-items:center; align-content:center; min-height:370px; text-align:center; padding:30px; }
.cc-state h2 { margin:15px 0 4px; font-size:17px; font-weight:600; }
.cc-state p { color:var(--mem-view-color-text-muted); max-width:400px; margin:4px 0 16px; font-size:13px; }
.cc-state-icon { display:grid; place-items:center; width:46px; height:46px; border:1px solid var(--mem-view-color-border); border-radius:12px; }
.cc-state-icon img { width:22px; height:22px; opacity:.65; }
.cc-dialog { padding:0; width:min(90vw,calc(100vw - 96px)); max-width:none; height:min(90dvh,calc(100vh - 48px)); max-height:none; border:1px solid var(--mem-view-color-border); border-radius:var(--mem-view-radius-lg); background:var(--mem-view-color-surface); color:var(--mem-view-color-text); box-shadow:var(--mem-view-shadow-overlay); }
.cc-dialog::backdrop { background:var(--mem-view-color-overlay); }
.cc-dialog[open] { display:flex; flex-direction:column; }
.cc-modal-head { flex-shrink:0; padding:17px 22px; border-bottom:1px solid var(--mem-view-color-border); }
.cc-modal-head h2 { margin:3px 0 1px; font-size:18px; font-weight:600; flex:1; }
.cc-modal-head .cc-group { align-self:flex-start; }
.cc-modal-kicker { color:var(--mem-view-color-text-muted); font-size:10px; }
.cc-modal-columns { display:grid; grid-template-columns:minmax(0,1fr) 7px minmax(0,var(--cc-review-width,280px)); flex:1; min-height:0; }
.cc-pane { min-width:0; overflow:auto; padding:20px 24px; }
.cc-pane-review { border-left:0; background:var(--mem-view-color-canvas); }
.cc-pane-title { font-size:11px; color:var(--mem-view-color-text-muted); font-weight:600; letter-spacing:.04em; margin:0 0 15px; }
.cc-metadata { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px; }
.cc-related { display:flex; flex-wrap:wrap; align-items:center; gap:4px; margin-bottom:16px; font-size:11px; color:var(--mem-view-color-text-muted); }
.cc-document { padding-top:16px; border-top:1px solid var(--mem-view-color-border); font-size:14px; line-height:1.9; }
.cc-document h3 { margin:0 0 14px; font-size:22px; line-height:1.5; font-weight:650; }
.cc-document h4 { margin:23px 0 8px; font-size:15px; font-weight:650; }
.cc-document p { margin:8px 0; }
.cc-document ul { margin:6px 0; padding-left:21px; }
.cc-document code { padding:2px 5px; background:var(--mem-view-color-subtle); border-radius:4px; font-size:12px; }
.cc-review-card { padding:15px; border:1px solid var(--mem-view-color-border); border-radius:8px; background:var(--mem-view-color-surface); margin-bottom:12px; }
.cc-review-head { justify-content:space-between; font-size:11px; margin-bottom:12px; }
.cc-review-card time { color:var(--mem-view-color-text-muted); font-size:10px; }
.cc-review-card p { margin:8px 0; font-size:13px; line-height:1.8; }
.cc-review-card ol { padding-left:19px; font-size:13px; line-height:1.8; margin:8px 0; }
.cc-review-summary { border-top:1px solid var(--mem-view-color-border); margin-top:12px; padding-top:10px; font-size:11px; color:var(--mem-view-color-text-muted); }
.cc-no-review { min-height:230px; padding:25px 10px; display:grid; justify-items:center; align-content:center; text-align:center; }
.cc-no-review h3 { font-size:14px; margin:12px 0 5px; font-weight:600; }
.cc-no-review p { color:var(--mem-view-color-text-muted); font-size:12px; max-width:230px; margin:0; }
.cc-mobile-tabs { display:none; }
@media(max-width:1050px) {


  .cc-pane { padding:18px; }
}
@media(max-width:760px) {


  .cc-dialog { width:100vw; height:100dvh; max-height:100vh; border:0; border-radius:0; }
  .cc-modal-head { padding:14px; }
  .cc-modal-head h2 { font-size:16px; }
  .cc-mobile-tabs { display:flex; gap:8px; padding:8px 14px; border-bottom:1px solid var(--mem-view-color-border); }
  .cc-modal-columns { display:block; overflow:auto; }
  .cc-pane { overflow:visible; padding:18px; }
  .cc-pane-review { border-left:0; }
  .cc-pane[hidden] { display:none; }
}



.cc-graph-card { border-radius:12px; background:var(--mem-view-color-canvas); }

.cc-graph { margin:0; }
.cc-node { min-height:130px; padding:12px 14px 10px; border-radius:12px; box-shadow:0 2px 6px #14372f07; }
.cc-node-version { font-size:10px; line-height:14px; }
.cc-node strong { font-size:14px; line-height:1.5; font-weight:600; margin:5px 0 8px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; }
.cc-node-tags { gap:4px; margin:0 0 8px; min-height:20px; }
.cc-node-footer { font-size:10px; line-height:16px; padding-top:7px; }
.cc-external { min-height:130px; background:var(--mem-view-color-subtle); }
.cc-external strong { margin-top:9px; -webkit-line-clamp:3; font-weight:500; font-size:12px; line-height:1.6; }
.cc-history { font-size:11px; margin-top:4px; }
.cc-history summary { padding:3px 4px; }


.cc-node[data-edge-highlighted="true"],.cc-node:hover { border-color:var(--mem-view-color-accent); box-shadow:0 0 0 2px var(--mem-view-color-accent-soft); }





.cc-artifact-perspective .cc-graph-view-tabs{margin:0}
.cc-exploration .cc-graph-card{border:0;border-radius:0}

.cc-graph-view-tabs{display:flex;gap:24px;padding:12px 24px 0;background:var(--mem-view-color-surface);border-bottom:1px solid var(--mem-view-color-border)}
.cc-graph-view-tabs button{border:0;background:transparent;color:var(--mem-view-color-text-muted);padding:10px 0;font:14px/1.55 var(--mem-view-font-sans);cursor:pointer}
.cc-graph-view-tabs button:focus-visible{outline:2px solid var(--mem-view-color-accent)}
.cc-work{margin:0}

.cc-graph-view-tabs button[aria-pressed=true]{border-bottom:2px solid var(--mem-view-color-accent);color:var(--mem-view-color-accent);font-weight:600}

.cc-exploration [hidden]{display:none}

.cc-review-toggle{margin-left:0}
.cc-review-toggle,.cc-review-close{display:grid;place-items:center;width:28px;height:28px;min-height:28px;padding:0;border:0;border-radius:6px;background:transparent}
.cc-review-toggle:hover,.cc-review-close:hover{background:var(--mem-view-color-subtle)}
.cc-review-toggle img,.cc-review-close img{width:16px;height:16px;opacity:.65}
.cc-review-pane-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:18px}
.cc-review-pane-head .cc-pane-title{margin:0;font-size:13px;letter-spacing:0}
.cc-select-field{max-width:320px;min-width:160px}
.cc-version-bar>.cc-select-field{flex:0 1 280px}
.cc-back-button{border:0;background:transparent;padding:4px 6px;font-size:12px;white-space:nowrap}
.cc-fixed-inputs{margin-top:8px}

.cc-modal-head h2{min-width:0;overflow-wrap:anywhere}.cc-modal-head>.cc-button{flex-shrink:0}
.cc-review-divider{cursor:col-resize;touch-action:none;background:var(--mem-view-color-border);border-left:3px solid var(--mem-view-color-surface);border-right:3px solid var(--mem-view-color-canvas)}
.cc-review-divider:hover,.cc-review-divider:focus-visible{background:var(--mem-view-color-accent);outline:none}
.cc-modal-columns.cc-review-collapsed{grid-template-columns:minmax(0,1fr)}
.cc-step-body{flex:1;min-height:0;overflow:auto;padding:22px 26px}
.cc-step-intro{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:20px;border-bottom:1px solid var(--mem-view-color-border)}
.cc-step-description{font-size:13px;color:var(--mem-view-color-text-muted);margin:0}
.cc-member-heading{display:flex;align-items:center;gap:8px;margin:20px 0 12px}.cc-member-heading h3{font-size:14px;margin:0}
.cc-member-list{display:grid;gap:0}
.cc-member-row{position:relative;display:grid;gap:5px;width:100%;text-align:left;padding:14px 32px 14px 0;border:0;border-bottom:1px solid var(--mem-view-color-border);background:transparent;color:var(--mem-view-color-text);cursor:pointer}
.cc-member-row:hover{background:var(--mem-view-color-accent-soft)}.cc-member-row strong{font-size:13px;font-weight:600}.cc-member-row>span{font-size:12px;color:var(--mem-view-color-text-muted)}.cc-member-row .cc-member-arrow{position:absolute;right:10px;top:50%;transform:translateY(-50%)}
.cc-execution-info{margin-top:22px;font-size:12px;color:var(--mem-view-color-text-muted)}.cc-execution-info>summary{cursor:pointer}
.cc-execution-facts{display:grid;grid-template-columns:90px minmax(0,1fr);gap:8px 12px;margin:14px 0}.cc-execution-facts dd{margin:0;overflow-wrap:anywhere}
.cc-step-empty,.cc-member-empty{font-size:13px;color:var(--mem-view-color-text-muted);margin:22px 0}
@media(max-width:760px){.cc-review-divider,.cc-review-toggle{display:none}.cc-step-body{padding:18px}.cc-modal-head{flex-wrap:wrap}}

.cc-upstream-steps{margin:12px 0 18px}.cc-upstream-steps h3{font-size:12px;font-weight:500;color:var(--mem-view-color-text-muted);margin:0 0 8px}
.cc-upstream-links{display:flex;flex-wrap:wrap;gap:8px}
.cc-upstream-link{display:inline-flex;align-items:center;gap:7px;width:auto;max-width:100%;padding:6px 10px;border:1px solid var(--mem-view-color-border);border-radius:6px;background:var(--mem-view-color-surface)}
.cc-upstream-link strong{font-size:12px;font-weight:400;overflow-wrap:anywhere}.cc-upstream-link>span:not(.cc-member-arrow){display:none}.cc-upstream-link .cc-member-arrow{position:static;transform:none;order:-1;color:var(--mem-view-color-text-muted)}


`;
