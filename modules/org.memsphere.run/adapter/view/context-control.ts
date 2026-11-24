import { effectiveRuleStyles } from "../../../shared/view/effective-rules.js";
import { joinEvidence, type JoinFrame } from './graph-run-projection.js';
import { createGraphCanvas, graphStatistics } from '../../../shared/view/graph-canvas.js';
import { createProcedureGraph, type ProcedureDefinition, type ProcedureAction } from "../../../shared/view/procedure-graph.js";
import { graphRuleGroup } from "../../../shared/view/graph-rules.js";
import type { ViewUi } from "@memsphere/view-sdk";
import { renderArtifactValue } from "./run-detail.js";
import { contextControlStyles } from "./context-control-styles.js";
import { layoutGraph } from "./graph-layout.js";

type Artifact = { schema?: string; writingProgress?: { index: number; items: Array<{ path?: string }>; skipped: string[]; validation?: {issues: Array<{message: string}>}; submitting?: boolean }; id: string; stepId: string; name: string; status: string; tags: string[]; revisedFrom?: string; dependencies: Array<{ kind: string; id: string }> };
type WorkflowStep = { writing?: { draftId: string }; id: string; createdAt: string; startedAt?: string; endedAt?: string; status: string; artifact?: unknown; source?: { actionId: string }; reviewRounds?: Array<{ id: string; artifactId: string }>; action?: { description: string; artifact?: unknown }; inputs?: unknown; reviewHandle?: string; reviewConfiguration?: unknown };
type ExplorationReview = { id: string; artifactId: string; roundId: string; reviewer?: string; status: string; createdAt: string; vote?: string };
type Snapshot = { lazy?:boolean; graph?: { procedure: unknown; work: WorkflowStep[] }; workflow?: { name: string; steps: WorkflowStep[] }; explorationReviews?: ExplorationReview[]; run: { id: string; status: string; frames?: Array<{ type: string; graphFrame?: JoinFrame }> }; outputArtifactIds: string[]; artifacts: Artifact[]; externals?: Array<{ id: string; source: string }>; steps: Array<{ id: string; createdAt: string }>; completeIds: string[]; reviews: Array<{ id: string; artifactId: string; reviewer: { source?: string }; comments: Array<{ id: string; body: string }>; createdAt: string }> };
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node;
};

/** Groups and projections are computed from immutable IDs, never stored as selection. */
export function artifactHistory(records: Artifact[]) {
  const byId = new Map(records.map(a => [a.id, a]));
  const family = (id: string): string => { const seen = new Set<string>(); while (byId.get(id)?.revisedFrom) { if (seen.has(id)) throw Error("Cyclic revision history"); seen.add(id); id = byId.get(id)!.revisedFrom!; } if (!byId.has(id)) throw Error("Missing revision source"); return id; };
  const groups = new Map<string, Artifact[]>();
  for (const a of records) { const key = family(a.id); const group = groups.get(key) ?? []; group.push(a); groups.set(key, group); }
  const order = new Map(records.map((a, i) => [a.id, i]));
  const ancestor = (id: string, candidate: Artifact): boolean => {
    let parent = candidate.revisedFrom;
    while (parent) { if (parent === id) return true; parent = byId.get(parent)?.revisedFrom; }
    return false;
  };
  for (const group of groups.values()) group.sort((a, b) => ancestor(a.id, b) ? -1 : ancestor(b.id, a) ? 1 : order.get(a.id)! - order.get(b.id)!);
  const closure = (roots: string[]) => {
    const done = new Set<string>(), active = new Set<string>(); const ordered: Artifact[] = [];
    const visit = (id: string) => { if (active.has(id)) throw Error("Cyclic dependencies"); if (done.has(id)) return; const a = byId.get(id); if (!a) throw Error(`Missing Artifact: ${id}`); active.add(id); a.dependencies.filter(r => r.kind === "artifact").forEach(r => visit(r.id)); active.delete(id); done.add(id); ordered.push(a); };
    roots.forEach(visit); return ordered;
  };
  const latest = (roots?: string[]) => closure(roots ?? [...groups.values()].map(g => g.at(-1)!.id));
  const around = (id: string) => {
    const descendants = new Set([id]); let changed = true;
    while (changed) { changed = false; for (const a of records) if (!descendants.has(a.id) && a.dependencies.some(r => r.kind === "artifact" && descendants.has(r.id))) { descendants.add(a.id); changed = true; } }
    const continuations = [...groups.values()].map(g => g.filter(a => descendants.has(a.id)).at(-1)).filter((a): a is Artifact => !!a);
    return closure([id, ...continuations.map(a => a.id)]);
  };
  return { latest, around, versions: (id: string) => groups.get(family(id))!, family };
}

export function createContextGraph(ui: ViewUi, request: (path: string, init?: RequestInit) => Promise<any>, locale?: string, projectApiBase?: string, openReview?: (runId: string, reviewId: string, roundId?: string) => Promise<void>, mountReview?: (runId:string,reviewId:string,roundId:string,container:HTMLElement,content:HTMLElement,panel:HTMLElement)=>Promise<void>, disposeReview?:()=>void) {
  const english = locale?.startsWith("en");
  const label = (zh: string, en: string) => english ? en : zh;
  const root = element("section", "cc-exploration"); root.dataset.contextControl = "";
  const style = element("style"); style.textContent = contextControlStyles + effectiveRuleStyles; root.append(style);
  const graphHost = element("div", "cc-canvas-scroll");
  const graphCard = element("section", "cc-graph-card"); graphCard.setAttribute("aria-label", label("产物依赖图", "Artifact dependency graph")); const artifactCanvas=createGraphCanvas({locale,viewport:graphHost});graphCard.append(artifactCanvas.element);root.append(graphCard);
  const work = element("section", "cc-work"); root.insertBefore(work, graphCard);
  const definitionInfo = element("details", "cc-procedure-definition");
  definitionInfo.append(element("summary", "cc-procedure-summary", label("流程信息", "Procedure information")));
  const definitionBody = element("div", "cc-procedure-definition-body");
  definitionInfo.append(definitionBody);
  let definitionKey = "";
  let snapshot: Snapshot, history: ReturnType<typeof artifactHistory>, selected: string | undefined, currentId: string | undefined;
  let currentKind: "artifact" | "external" = "artifact";
  let dialog: HTMLDialogElement | undefined, origin: HTMLElement | undefined, generation = 0, disposed = false, layoutGeneration = 0;
  let snapshotKey = "", graphKey = "", refreshEpoch = 0;
  let graphSelection: { action: ProcedureAction; stepId?: string; artifactId?: string } | undefined;
  const graphNavigation:Array<NonNullable<typeof graphSelection>>=[];
  const artifactNavigation:Array<{kind:"artifact"|"external";id:string}>=[];
  const loadedActions=new Set<string>();
  const actionDefinitions=new Map<string,ProcedureAction>();
  const selectedReviews = new Map<string, string>();
  const reviewWarnings = new Map<string, string>();
  const selectedNodes = new Map<string, string>();
  const configDrafts = new Map<string, { asserts: string; suggests: string; reviewer: string }>();
  let artifactsLoaded=false;
  let graphView: "workflow" | "artifacts" = "workflow";
  const graphViews = element("div", "cc-graph-view-tabs"); root.insertBefore(graphViews, work);
  const syncGraphView = () => { const graph = Boolean(snapshot?.graph);root.classList.toggle("cc-artifact-perspective",graph&&graphView==="artifacts"); graphViews.hidden = !graph; [...graphViews.querySelectorAll("button")].forEach((button, index) => button.setAttribute("aria-pressed", String(index === (graphView === "workflow" ? 0 : 1)))); work.hidden = !graph || graphView !== "workflow"; graphCard.hidden = graph && graphView !== "artifacts"; };
  for (const [id, title] of [["workflow", label("流程视角", "Workflow view")], ["artifacts", label("产物视角", "Artifact view")]] as const) { const tab = element("button", "", title); tab.type = "button"; tab.addEventListener("click", () => { graphView = id; syncGraphView(); if(id==="artifacts"){graphKey="";void graph();}else procedureCanvas?.refreshLayout(); }); graphViews.append(tab); }
  let procedureCanvas: ReturnType<typeof createProcedureGraph> | undefined;
  let renderController: AbortController | undefined; let activePane = "content";
  let reviewRatio=(100-(Number(localStorage.getItem("memsphere.artifactReviewSplit.v1"))||70))/100,reviewCollapsed=false;
  const button = (text: string, action: () => void, cls = "cc-button") => { const node = element("button", cls, text); node.type = "button"; node.addEventListener("click", action); return node; };
  const reset = button(label("回到最新", "Latest"), () => { selected = undefined; close(); graph(); }); artifactCanvas.header.append(reset);
  const close = () => { disposeReview?.(); refreshEpoch++; graphNavigation.length=0;artifactNavigation.length=0;graphSelection = undefined; renderController?.abort(); activePane = "content"; generation++; dialog?.close(); dialog?.remove(); dialog = undefined; currentId = undefined; const node = graphHost.querySelector<HTMLButtonElement>(`[data-artifact-id="${selected ?? origin?.dataset.artifactId ?? ""}"]`); (node ?? origin)?.focus(); };
  const stopDrag=artifactCanvas.stopPan;
  const versions = (a: Artifact) => snapshot.graph ? artifactHistory(snapshot.artifacts).versions(a.id) : snapshot.completeIds.includes(a.id) ? history.versions(a.id) : [a];
  const choose = (id: string) => { selected = id; graph(); };
  const select = (id: string) => { choose(id); graphHost.querySelector<HTMLButtonElement>(`[data-artifact-id="${id}"]`)?.focus(); };
  function openArtifact(id: string) {
    const a = snapshot.artifacts.find(artifact => artifact.id === id), step = snapshot.graph?.work.find(s => s.id === a?.stepId);
    const action = (snapshot.graph?.procedure as ProcedureDefinition | undefined)?.actions.find(definition => definition.id === step?.source?.actionId);
    return action ? openGraphAction(action, step?.id, id) : open(id);
  }
  async function graph() {
    if(snapshot.graph&&graphView!=="artifacts")return;
    if(snapshot.lazy&&snapshot.graph&&!artifactsLoaded){
      const payload=await request(`/api/runs/${encodeURIComponent(snapshot.run.id)}?representation=artifacts`);
      if(disposed)return;Object.assign(snapshot,{artifacts:payload.run.context.artifacts,completeIds:payload.run.context.completeIds});
      history=artifactHistory(snapshot.artifacts);artifactsLoaded=true;
    }
    const projectionKey = JSON.stringify([snapshot, selected]);
    if (projectionKey === graphKey) return;
    graphKey = projectionKey;
    const requestId = ++layoutGeneration;
    const scroll = { left: graphHost.scrollLeft, top: graphHost.scrollTop };
    const openMenus = new Set([...graphHost.querySelectorAll<HTMLDetailsElement>(".cc-history[open]")].map(d => d.parentElement?.querySelector<HTMLElement>("[data-node-key]")?.dataset.nodeKey));
    try {
      reset.hidden = !selected; reset.textContent = snapshot.run.status === "done" ? label("回到交付视图", "Delivery view") : label("回到当前成果", "Current outputs");
      const defaultView = () => history.latest(snapshot.graph && !snapshot.workflow ? undefined : snapshot.outputArtifactIds);
      const tapped = snapshot.artifacts.find(a => a.id === selected);
      const visible = selected && tapped ? history.around(selected) : [...new Map([...defaultView(), ...snapshot.artifacts.filter(a => snapshot.workflow && a.status === "draft")].map(a => [a.id, a])).values()];
      stopDrag();
      const referenced = new Set(visible.flatMap(a => a.dependencies.filter(d => d.kind === "external").map(d => d.id)));
      const used = new Set(snapshot.artifacts.filter(a => snapshot.completeIds.includes(a.id)).flatMap(a => a.dependencies.filter(d => d.kind === "external").map(d => d.id)));
      const externals = (snapshot.externals ?? []).filter(e => referenced.has(e.id) || !selected && snapshot.run.status === "running" && !used.has(e.id));
      const key = (kind: string, id: string) => `${kind}:${id}`;
      artifactCanvas.world.replaceChildren();
      if (!visible.length && !externals.length) { artifactCanvas.world.append(element("div", "cc-state", label("暂无成果", "No outputs"))); return; }
      const canvas = element("div", "cc-graph");
      const graphNodes = [...externals.map(e => ({ id: key("external", e.id), dependencies: [] as string[] })), ...visible.map(a => ({ id: key("artifact", a.id), dependencies: a.dependencies.map(r => key(r.kind, r.id)) }))];
      for (const external of externals) {
        const stack = element("div", "cc-node-stack");
        const node = button("", () => { origin = node; void openExternal(external.id); }, "cc-node cc-external");
        node.dataset.nodeKey = key("external", external.id); node.dataset.externalId = external.id;
        node.append(ui.badge({ text: label("外部资料", "External") }), element("strong", "", external.source));
        stack.append(node); canvas.append(stack);
      }
      for (const a of visible) {
        const group = versions(a), index = group.findIndex(v => v.id === a.id);
        const stack = element("div", "cc-node-stack");
        const node = button("", () => { origin = node; void openArtifact(a.id); }, "cc-node"); node.dataset.artifactId = a.id; node.dataset.nodeKey = key("artifact", a.id); node.dataset.selected = String(selected === a.id); node.setAttribute("aria-label", `${a.name} v${index + 1}`);
        const tagRow = element("div", "cc-node-tags"); a.tags.filter(t => t !== "default").forEach(t => tagRow.append(ui.badge({ text: t })));
        const comments = snapshot.reviews.filter(r => r.artifactId === a.id).reduce((n, r) => n + r.comments.length, 0);
        const footer = element("div", "cc-node-footer"); footer.append(element("span", "", a.status === "draft" ? label("草稿", "Draft") : snapshot.completeIds.includes(a.id) ? label("已提交", "Submitted") : label("提交未完成", "Incomplete submission")));if(!snapshot.lazy)footer.append(element("span","",`${comments} ${label("条评论","comments")}`));
        node.append(element("div", "cc-node-version", `v${index + 1}${index === group.length - 1 ? label(" · 最新", " · Latest") : ""}`), element("strong", "", a.name), tagRow, footer); stack.append(node);
        if (group.length > 1) { const details = element("details", "cc-history"); details.append(element("summary", "", `${label("历史版本", "History")} · ${group.length - 1}`)); const menu = element("div", "cc-history-menu"); [...group].reverse().forEach((v) => menu.append(button(`v${group.indexOf(v) + 1} · ${v.name}`, () => select(v.id), "cc-history-option"))); details.append(menu); stack.append(details); }
        canvas.append(stack);
      }
      // Measure rendered cards and folded history controls before assigning coordinates.
      canvas.style.visibility = "hidden"; artifactCanvas.world.append(canvas);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (disposed || requestId !== layoutGeneration) return;
      const stacks = [...canvas.querySelectorAll<HTMLElement>(".cc-node-stack")];
      const measured = graphNodes.map(input => {
        const stack = stacks.find(s => s.querySelector<HTMLElement>("[data-node-key]")?.dataset.nodeKey === input.id)!;
        const card = stack.querySelector<HTMLElement>(".cc-node")!;
        return { ...input, width: stack.offsetWidth, height: stack.offsetHeight, cardHeight: card.offsetHeight };
      });
      const layout = await layoutGraph(measured);
      if (disposed || requestId !== layoutGeneration) return;
      canvas.style.width = `${layout.width}px`; canvas.style.height = `${layout.height}px`;artifactCanvas.setSize(layout.width,layout.height);
      stacks.forEach(stack => {
        const node = stack.querySelector<HTMLElement>("[data-node-key]")!, pos = layout.positions.get(node.dataset.nodeKey!)!;
        stack.style.left = `${pos.x}px`; stack.style.top = `${pos.y}px`;
        if (openMenus.has(node.dataset.nodeKey)) stack.querySelector<HTMLDetailsElement>(".cc-history")?.setAttribute("open", "");
      });
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("aria-hidden", "true");
      for (const edge of layout.edges) {
        const path = document.createElementNS(svg.namespaceURI, "path") as SVGPathElement;
        path.setAttribute("class", "cc-edge graph-edge"); path.setAttribute("d", edge.path);
        path.dataset.dependency = `${edge.from.slice(edge.from.indexOf(":") + 1)}:${edge.to.slice(edge.to.indexOf(":") + 1)}`; svg.append(path);
        const hit = path.cloneNode(true) as SVGPathElement; hit.setAttribute("class", "cc-edge-hit");
        hit.addEventListener("pointerenter", () => {
          path.dataset.highlighted = "true";
          canvas.querySelectorAll<HTMLElement>("[data-node-key]").forEach(node => { if ([edge.from, edge.to].includes(node.dataset.nodeKey!)) node.dataset.edgeHighlighted = "true"; });
        });
        hit.addEventListener("pointerleave", () => { delete path.dataset.highlighted; canvas.querySelectorAll<HTMLElement>("[data-edge-highlighted]").forEach(node => delete node.dataset.edgeHighlighted); }); svg.append(hit);
      }
      canvas.prepend(svg); canvas.style.visibility = ""; canvas.dataset.layoutReady = "true";
      graphHost.scrollLeft = scroll.left; graphHost.scrollTop = scroll.top;
      if (selected) graphHost.querySelector<HTMLButtonElement>(`[data-artifact-id="${selected}"]`)?.focus({ preventScroll: true });
    } catch (error) {
      if (disposed || requestId !== layoutGeneration) return;
      graphKey = "";
      const message = element("div", "cc-state", error instanceof Error ? error.message : String(error));
      message.append(button(label("重试", "Retry"), () => { void graph(); })); artifactCanvas.world.replaceChildren(message);
    }
  }
  async function open(id: string) {
    const a = snapshot.artifacts.find(a => a.id === id); if (!a) return;
    currentKind = "artifact"; currentId = id; const currentGeneration = ++generation;
    renderController?.abort(); renderController = new AbortController();
    if (!dialog) { dialog = element("dialog", "cc-dialog"); dialog.setAttribute("aria-label", label("产物", "Artifact")); dialog.addEventListener("cancel", event => { event.preventDefault(); close(); }); root.append(dialog); }
    dialog.dataset.artifactId = id; delete dialog.dataset.externalId; dialog.setAttribute("aria-label", label("产物", "Artifact"));
    const head = element("header", "cc-modal-head"); head.append(element("h2", "", a.name), button(label("关闭", "Close"), close));
    if(!graphSelection || snapshot.workflow)artifactBack(head);
    const columns = element("div", "cc-modal-columns"), content = element("section", "cc-pane cc-pane-content"), reviews = element("section", "cc-pane cc-pane-review");
    content.setAttribute("aria-label", label("产物内容", "Artifact content")); reviews.setAttribute("aria-label", label("评审", "Reviews"));
    const metadata = element("div", "cc-metadata"); metadata.append(element("span", "cc-chip", a.id), ...a.tags.filter(t=>!snapshot.graph||t!=="default").map(t => ui.badge({ text: t }))); if(!snapshot.graph)content.append(metadata);
    const group = versions(a), bar = element("div", "cc-version-bar");
    const switchTo = (next: string, action: string) => { if (graphSelection) {
      const owner = snapshot.workflow ? snapshot.artifacts.find(a => a.id === next)?.stepId : undefined;
      const definition = owner ? (snapshot.graph?.procedure as ProcedureDefinition)?.actions.find(a => a.id === owner) : undefined;
      void openGraphAction(definition ?? graphSelection.action, owner ?? graphSelection.stepId, next);
    } else { choose(next); void open(next); } const control = dialog?.querySelector<HTMLButtonElement | HTMLSelectElement>(`[data-version-action="${action}"]`); (control?.disabled ? dialog?.querySelector<HTMLSelectElement>('[data-version-action="select"]') : control)?.focus(); };
    const versionField=ui.select({label:{text:label("产物版本","Artifact version")},value:id,options:group.map((version,i)=>({value:version.id,label:{text:`v${i+1} · ${version.name}`}})),onChange:next=>switchTo(next,"select")});versionField.root.classList.add("cc-select-field");const selectVersion=versionField.control;selectVersion.classList.add("cc-version-select");selectVersion.setAttribute("aria-label",label("历史版本","History"));
    selectVersion.dataset.versionAction = "select"; bar.append(versionField.root);
    if(snapshot.graph){
      const header=element("section","cc-artifact-header");header.setAttribute("aria-label",label("产物导航","Artifact navigation"));
      const details=element("details","cc-artifact-info");details.append(element("summary","",label("产物信息","Artifact information")),metadata);
      header.append(bar,details);content.append(header);
    }else content.append(bar);
    const deps = element("div", "cc-related");
    if(a.dependencies.length) deps.append(element("span","",label("依赖产物","Dependencies")));
    a.dependencies.forEach(ref => {
      const name = ref.kind === "artifact" ? snapshot.artifacts.find(a => a.id === ref.id)?.name : snapshot.externals?.find(e => e.id === ref.id)?.source;
      deps.append(button(name ?? ref.id, () => {
        if (currentId) artifactNavigation.push({kind:currentKind,id:currentId});
        if (ref.kind === "artifact") { choose(ref.id); void openArtifact(ref.id); }
        else void openExternal(ref.id);
      }, "cc-text-button"));
    });
    if (!graphSelection || snapshot.workflow) content.append(deps);
    const body = element("article", "cc-document", a.status === "draft" ? label("未提交", "Not submitted") : label("加载中…", "Loading…")); content.append(body);
    const reviewStep=snapshot.graph?.work.find(step=>step.id===a.stepId);
    const reviewRound=reviewStep?.reviewRounds?.filter(round=>round.artifactId===id).at(-1);
    const progressive = (snapshot.explorationReviews ?? []).filter(r => r.artifactId === id);
    const selectedReview = progressive.find(r => r.id === selectedReviews.get(id)) ?? progressive.at(-1);
    const inlineId = selectedReview?.id ?? reviewStep?.reviewHandle, inlineRound = selectedReview?.roundId ?? reviewRound?.id;
    const inline=Boolean(mountReview&&inlineId&&inlineRound);
    if(!inline)disposeReview?.();
    const entries = snapshot.reviews.filter(r => r.artifactId === id); reviews.append(element("h3", "cc-pane-title", label("评审", "Reviews")));
    if (!entries.length) reviews.append(element("div", "cc-no-review", label("暂无评审", "No reviews")));
    for (const r of entries) { const card = element("article", "cc-review-card"); card.append(element("div", "cc-review-head", `${r.reviewer.source === "human" ? "Human" : "Agent"} · ${r.createdAt}`)); for (const c of r.comments) card.append(element("p", "", c.body)); reviews.append(card); }
    const tabs = element("div", "cc-mobile-tabs"), media = window.matchMedia("(max-width: 760px)");
    const divider=element("div","cc-review-divider");divider.tabIndex=0;divider.setAttribute("role","separator");divider.setAttribute("aria-orientation","vertical");divider.setAttribute("aria-label",label("调整评审栏宽度","Resize review panel"));
    const clampRatio=(ratio:number)=>Math.max(.25,Math.min(.7,ratio));
    const applyWidth=()=>{reviewRatio=clampRatio(reviewRatio);columns.style.setProperty("--cc-review-width",`${reviewRatio*100}%`);divider.setAttribute("aria-valuemin","25");divider.setAttribute("aria-valuemax","70");divider.setAttribute("aria-valuenow",String(Math.round(reviewRatio*100)));divider.setAttribute("aria-valuetext",`${Math.round(reviewRatio*100)}%`);};
    const saveRatio=()=>localStorage.setItem("memsphere.artifactReviewSplit.v1",String(100-reviewRatio*100));
    const reviewToggle=ui.iconButton({label:{text:label("展开评审","Show reviews")},icon:{kind:"system",name:"sidebar-simple"},run:()=>{reviewCollapsed=false;applyPane();dialog?.dispatchEvent(new Event("cc-review-visible"));}});reviewToggle.classList.add("cc-review-toggle");head.insertBefore(reviewToggle,head.lastChild);
    const reviewClose=ui.iconButton({label:{text:label("收起评审","Hide reviews")},icon:{kind:"system",name:"x"},run:()=>{reviewCollapsed=true;activePane="content";applyPane();}});reviewClose.classList.add("cc-review-close");const reviewHeader=element("header","cc-review-pane-head");reviewHeader.append(reviews.firstElementChild!,reviewClose);reviews.prepend(reviewHeader);
    const reviewScroll=element("div","cc-review-scroll");reviewScroll.append(...[...reviews.children].filter(child=>child!==reviewHeader));reviews.append(reviewScroll);
    const reviewWarning = selectedReview && reviewWarnings.get(selectedReview.id);
    if (reviewWarning) {
      const message = element("p", "", reviewWarning);
      message.setAttribute("role", "alert");
      reviewScroll.prepend(message);
    }
    if (progressive.length) {
      const field = ui.select({ label: { text: label("评审轮次", "Review round") }, value: selectedReview!.id,
        options: progressive.map((r, index) => ({ value: r.id, label: { text: `${index + 1} · ${r.reviewer ?? ""} · ${r.vote ?? r.status}` } })),
        onChange: value => { selectedReviews.set(id, value); void refreshDetail(); } });
      reviewScroll.prepend(field.root);
    }
    const applyPane = () => { content.hidden = media.matches && activePane !== "content"; reviews.hidden = media.matches ? activePane !== "review" : reviewCollapsed;divider.hidden=media.matches||reviewCollapsed;columns.classList.toggle("cc-review-collapsed",!media.matches&&reviewCollapsed);reviewToggle.hidden=!reviewCollapsed||media.matches;reviewToggle.setAttribute("aria-expanded",String(!reviewCollapsed));applyWidth(); };
    tabs.append(button(label("产物内容", "Content"), () => { activePane = "content"; applyPane(); }), button(label("评审", "Reviews"), () => { activePane = "review";reviewCollapsed=false;applyPane();dialog?.dispatchEvent(new Event("cc-review-visible")); })); media.addEventListener("change", applyPane, { signal: renderController.signal });window.addEventListener("resize",applyPane,{signal:renderController.signal});
    let drag:{x:number;ratio:number}|undefined;
    divider.addEventListener("pointerdown",event=>{if(event.button!==0)return;event.preventDefault();drag={x:event.clientX,ratio:reviewRatio};divider.setPointerCapture(event.pointerId);});
    divider.addEventListener("pointermove",event=>{if(!drag)return;reviewRatio=clampRatio(drag.ratio+(drag.x-event.clientX)/columns.clientWidth);applyWidth();});
    for(const name of ["pointerup","pointercancel","lostpointercapture"])divider.addEventListener(name,()=>{if(drag)saveRatio();drag=undefined;});
    divider.addEventListener("keydown",event=>{if(!["ArrowLeft","ArrowRight","Home"].includes(event.key))return;event.preventDefault();reviewRatio=clampRatio(event.key==="Home"?.3:reviewRatio+(event.key==="ArrowLeft"?.02:-.02));applyWidth();saveRatio();});
    columns.append(content,divider,reviews); dialog.replaceChildren(head, tabs, columns); if (!dialog.open) dialog.showModal();applyPane();
    if(inline){
      const material=element("div","cc-review-material");content.append(material);
      material.addEventListener("cc-review-material-ready",()=>{body.hidden=true;},{signal:renderController.signal});
      const panel=element("div","cc-review-session");reviewScroll.append(panel);
      reviews.querySelectorAll(selectedReview ? ".cc-no-review" : ".cc-review-card,.cc-no-review").forEach(node=>node.remove());
      void mountReview!(snapshot.run.id,inlineId!,inlineRound!,dialog,material,panel).catch(error=>{if(!disposed&&generation===currentGeneration)panel.textContent=error instanceof Error?error.message:String(error);});
      body.hidden=Boolean(material.querySelector(".artifact-review-material-heading"));
    }
    if (selectedReview) showExplorationNodes(reviewScroll, selectedReview, renderController.signal);
    if (!body.hidden) try {
      const value = await request(`/api/runs/${encodeURIComponent(snapshot.run.id)}/artifacts/${encodeURIComponent(id)}/content`);
      if (!disposed && generation === currentGeneration && currentId === id) {
        if (value.previewable === false) {
          const link = element("a", "cc-text-button", label("下载产物内容", "Download content"));
          const path = `/runs/${encodeURIComponent(snapshot.run.id)}/artifacts/${encodeURIComponent(id)}/content?download=1`;
          link.href = `${projectApiBase ?? "/api"}${path}`; link.download = a.name;
          body.replaceChildren(element("p", "", value.contentType), link);
        } else body.replaceChildren(renderArtifactValue(value));
      }
    } catch (error) { if (!disposed && generation === currentGeneration) body.textContent = error instanceof Error ? error.message : String(error); }
  }
  function artifactBack(head:HTMLElement){if(!artifactNavigation.length)return;head.prepend(button(label("← 返回","← Back"),()=>{const previous=artifactNavigation.pop();if(previous)void(previous.kind==="external"?openExternal(previous.id):openArtifact(previous.id));},"cc-text-button cc-back-button"));}
  function graphMember(id:string){
    const artifact=snapshot.artifacts.find(a=>a.id===id),owner=snapshot.graph!.work.find(s=>s.id===artifact?.stepId),definition=(snapshot.graph!.procedure as ProcedureDefinition).actions.find(a=>a.id===owner?.source?.actionId);
    const row=button("",()=>{if(definition&&owner){if(graphSelection)graphNavigation.push({...graphSelection});void openGraphAction(definition,owner.id,id);}},"cc-member-row");
    row.append(element("strong","",artifact?.name??id),element("span","",definition?.description??""),element("span","cc-member-arrow","→"));return row;
  }
  function graphBack(head:HTMLElement){if(!graphNavigation.length)return;head.prepend(button(label("← 返回","← Back"),()=>{const previous=graphNavigation.pop();if(previous)void openGraphAction(previous.action,previous.stepId,previous.artifactId);},"cc-text-button cc-back-button"));}
  function upstreamSteps(step:NonNullable<Snapshot["graph"]>["work"][number]){
    const inputs=[...new Map((Object.values(step.inputs??{}).flat()as Array<{kind:string;id:string}>).filter(input=>input.kind==="artifact").map(input=>[input.id,input])).values()];
    if(!inputs.length)return undefined;
    const section=element("section","cc-upstream-steps");section.setAttribute("aria-label",label("上游步骤","Upstream steps"));section.append(element("h3","",label("上游步骤","Upstream steps")));
    const links=element("div","cc-upstream-links");for(const input of inputs){const link=graphMember(input.id);link.classList.add("cc-upstream-link");link.querySelector(".cc-member-arrow")!.textContent="←";links.append(link);}section.append(links);return section;
  }
  function executionInformation(step:NonNullable<Snapshot["graph"]>["work"][number], artifact?: Artifact){
    const statuses:Record<string,string>={pending:label("待执行","Pending"),running:label("执行中","Running"),awaiting_review:label("待评审","Awaiting review"),done:label("已完成","Done"),failed:label("失败","Failed"),cancelled:label("已取消","Cancelled")};
    const info=element("details","cc-execution-info");info.dataset.disclosureKey=`execution:${step.id}`;info.append(element("summary","",label("执行信息","Execution information")));
    const facts=element("dl","cc-execution-facts");for(const [name,value]of [[label("状态","Status"),statuses[step.status]??step.status],[label("创建时间","Created"),step.createdAt],[label("开始时间","Started"),step.startedAt],[label("结束时间","Ended"),step.endedAt]])if(value){const content=element("dd");if(name!==label("状态","Status")){const time=element("time","",new Date(value).toLocaleString(english?"en":"zh-CN"));time.dateTime=value;content.append(time);}else content.textContent=value;facts.append(element("dt","",name),content);}info.append(facts);
    if (artifact?.writingProgress) {
      const writing = artifact.writingProgress, progress = element("section", "cc-schema-writing");
      progress.setAttribute("aria-label", label("Schema 撰写进度", "Schema writing progress"));
      progress.append(element("p", "", `${label("进度", "Progress")} ${writing.index}/${writing.items.length}`));
      const current = writing.items[writing.index]?.path;
      if (artifact.schema) progress.append(element("p", "", artifact.schema));
      if (current) progress.append(element("p", "", `${label("当前项", "Current field")}: ${current}`));
      else progress.append(element("p", "", writing.submitting ? label("提交处理中", "Submitting") : label("待完整检查与提交", "Ready for final inspection and submission")));
      progress.append(element("p", "", `${label("已跳过", "Skipped")}: ${writing.skipped.length}`));
      for (const issue of writing.validation?.issues ?? []) progress.append(element("p", "cc-schema-issue", issue.message));
      info.append(progress);
    }
    return info;
  }
  function showExplorationNodes(host: HTMLElement, review: ExplorationReview, signal: AbortSignal) {
    const details = element("details", "cc-execution-info"); details.dataset.disclosureKey = `nodes:${review.id}`;
    details.append(element("summary", "", label("渐进评审节点", "Progressive review nodes")));
    host.prepend(details);
    const path = `/api/runs/${encodeURIComponent(snapshot.run.id)}/exploration/reviews/${encodeURIComponent(review.id)}`;
    void request(path, { signal }).then(value => {
      if (signal.aborted) return;
      type Node = { nodeId: string; name: string; source?: { memoryRef?: string; path?: string }; requiresReport: boolean; reported: boolean; applicable?: boolean; asserts: { text: string }[]; suggests: { text: string }[]; comments: { body: string }[]; ruleResults: { rulePath: string; result: string }[] };
      const nodes = (value.nodes as Node[]).filter(node => node.requiresReport);
      const status = element("p", "", `${value.progress.processed}/${value.progress.total}`);
      if (value.attempt?.completion?.failure) status.append(` · ${value.attempt.completion.failure.message}`);
      if (value.vote?.summary) status.append(` · ${value.vote.summary}`);
      details.append(status);
      if (!nodes.length) return;
      const selected = nodes.find(node => node.nodeId === selectedNodes.get(review.id)) ?? nodes.find(node => !node.reported) ?? nodes[0];
      const body = element("section", "cc-review-card");
      const render = (node: Node) => {
        body.replaceChildren(element("p", "", node.reported ? node.applicable === false ? label("不适用", "Not applicable") : label("已记录", "Reported") : label("待审查", "Unreviewed")));
        if (node.source?.memoryRef) body.append(element("p", "", `${node.source.memoryRef} · ${node.source.path ?? "."}`));
        for (const [title, rules] of [[label("必核规则", "Assertions"), node.asserts], [label("建议规则", "Suggestions"), node.suggests]] as const) {
          if (!rules.length) continue;
          const list = element("ul"); rules.forEach(rule => list.append(element("li", "", rule.text))); body.append(element("h4", "", title), list);
        }
        for (const result of node.ruleResults) body.append(element("p", "", `${result.rulePath} · ${result.result === "undetermined" ? label("无法判定", "Undetermined") : label("未满足", "Not satisfied")}`));
        for (const comment of node.comments) body.append(element("p", "", comment.body));
      };
      const field = ui.select({ label: { text: label("评审节点", "Review node") }, value: selected.nodeId,
        options: nodes.map(node => ({ value: node.nodeId, label: { text: node.name } })),
        onChange: value => { selectedNodes.set(review.id, value); render(nodes.find(node => node.nodeId === value)!); } });
      render(selected); details.append(field.root, body);
    }).catch(error => { if (!signal.aborted) details.append(element("p", "", error instanceof Error ? error.message : String(error))); });
  }
  function explorationConfiguration(step: WorkflowStep, artifact: Artifact, signal: AbortSignal) {
    const details = element("details", "cc-execution-info"); details.dataset.disclosureKey = `review-config:${step.id}`;
    details.append(element("summary", "", label("评审配置", "Review configuration")));
    const base = `/api/runs/${encodeURIComponent(snapshot.run.id)}/exploration`;
    const path = `${base}/steps/${encodeURIComponent(step.id)}`;
    const help = element("p", "", label("加载中…", "Loading…")); details.append(help);
    const write = (path: string, body: Record<string, unknown>) => request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    const errorMessage = (error: unknown) => { const message = error instanceof Error ? error.message : String(error); try { return JSON.parse(message).error ?? message; } catch { return message; } };
    void request(path, { signal }).then(value => {
      if (signal.aborted) return;
      const fields = ["asserts", "suggests", "reviewer"] as const;
      const configuredValues = (configuration: { asserts?: string[]; suggests?: string[]; reviewer?: string }) => ({
        asserts: (configuration.asserts ?? []).join("\n"), suggests: (configuration.suggests ?? []).join("\n"), reviewer: configuration.reviewer ?? ""
      });
      let before = configuredValues(value.configuration);
      const state = configDrafts.get(step.id) ?? { ...before };
      const inputs = new Map<"asserts" | "suggests", HTMLTextAreaElement>();
      const form = element("div", "cc-procedure-definition-body");
      const readonly = snapshot.run.status !== "running";
      const selections = (value.reviewers as { value: string; name: string }[]).map(r => ({ value: r.value, label: { text: r.name } }));
      if (state.reviewer && !selections.some(r => r.value === state.reviewer)) selections.push({ value: state.reviewer, label: { text: state.reviewer } });
      function readiness(current: typeof value) {
        help.textContent = current.rulesError ?? (current.missing.length ? `${label("待补齐", "Required")} · ${current.missing.map((id: string) => ({ "asserts/suggests": label("Statement 规则", "Statement rules"), reviewer: label("评审人", "Reviewer"), "submitted Artifact": label("提交产物", "Submitted artifact") })[id] ?? id).join(" · ")}` : label("可发起评审", "Ready for review"));
      }
      readiness(value);
      if (value.configuration.inheritedFrom) {
        const source = value.configuration.inheritedFrom;
        form.append(element("p", "", `${label("继承自", "Inherited from")} ${source.artifactId} · ${source.stepId}`));
        const edited = value.configuration.edited as string[] | undefined;
        if (edited?.length) form.append(element("p", "", `${label("已调整", "Edited")} · ${edited.map(key => ({ asserts: label("必核规则", "Assertions"), suggests: label("建议规则", "Suggestions"), reviewer: label("评审人", "Reviewer") })[key] ?? key).join(" · ")}`));
      }
      for (const [key, title] of [["asserts", label("必核 Statement（每行一个引用）", "Assertion Statements, one reference per line")], ["suggests", label("建议 Statement（每行一个引用）", "Suggestion Statements, one reference per line")]] as const) {
        const field = element("label", "cc-select-field", title), input = element("textarea");
        inputs.set(key, input);
        input.value = state[key]; input.rows = 2; input.readOnly = readonly;
        input.addEventListener("input", () => { state[key] = input.value; configDrafts.set(step.id, state); });
        field.append(input); form.append(field);
      }
      const reviewer = ui.select({ label: { text: label("评审人", "Reviewer") }, value: state.reviewer,
        options: [{ value: "", label: { text: label("选择评审人", "Select reviewer") } }, ...selections],
        onChange: value => { state.reviewer = value; configDrafts.set(step.id, state); } });
      reviewer.control.disabled = readonly; form.append(reviewer.root);
      if (!readonly) {
        const message = element("p", ""); message.setAttribute("role", "status");
        const save = button(label("保存配置", "Save configuration"), () => void perform(async () => {
          const submitted = { ...state };
          const patch: Record<string, unknown> = {};
          for (const key of ["asserts", "suggests"] as const) if (submitted[key] !== before[key]) patch[key] = submitted[key].split("\n").map(s => s.trim()).filter(Boolean);
          if (submitted.reviewer !== before.reviewer) Object.assign(patch, submitted.reviewer ? { reviewer: submitted.reviewer } : { clearReviewer: true });
          if (!Object.keys(patch).length) return;
          const result = await write(path, patch);
          if (signal.aborted) return;
          before = configuredValues(result.configuration);
          for (const [key, input] of inputs) if (state[key] === submitted[key]) input.value = state[key] = before[key];
          if (state.reviewer === submitted.reviewer) reviewer.control.value = state.reviewer = before.reviewer;
          const pending = fields.some(key => state[key] !== before[key]);
          if (pending) configDrafts.set(step.id, state);
          else configDrafts.delete(step.id);
          readiness(result);
          message.textContent = pending ? label("仍有未保存的编辑", "There are unsaved edits") : label("配置已保存", "Configuration saved");
        }));
        const start = button(label("发起评审", "Start review"), () => void perform(async () => {
          const result = await write(`${base}/reviews/${encodeURIComponent(artifact.id)}`, {});
          if (signal.aborted) return;
          const chosen: ExplorationReview = { id: result.reviewId, artifactId: artifact.id, roundId: result.roundId, reviewer: result.reviewer, status: result.status, createdAt: result.createdAt };
          if (typeof result.warning === "string") reviewWarnings.set(chosen.id, result.warning);
          else reviewWarnings.delete(chosen.id);
          snapshot.explorationReviews = [...(snapshot.explorationReviews ?? []).filter(r => r.id !== chosen.id), chosen];
          selectedReviews.set(artifact.id, chosen.id);
          await refreshDetail();
        }));
        const perform = async (action: () => Promise<void>) => {
          message.textContent = ""; save.disabled = start.disabled = true;
          try { await action(); } catch (error) { if (!signal.aborted) message.textContent = errorMessage(error); }
          finally { save.disabled = false; start.disabled = artifact.status !== "submitted"; }
        };
        start.disabled = artifact.status !== "submitted"; form.append(save, start, message);
      }
      details.append(form);
    }).catch(error => { if (!signal.aborted) help.textContent = errorMessage(error); });
    return details;
  }
  function actionDefinition(action: ProcedureAction) {
    const details = element("details", "cc-action-definition");
    details.append(element("summary", "", label("流程定义", "Procedure definition")), procedureCanvas!.actionBody(action));
    return details;
  }
  async function openGraphAction(action: ProcedureAction, stepId?: string, chosenArtifactId?: string) {
    if(snapshot.lazy&&!loadedActions.has(action.id)){
      disposeReview?.();renderController?.abort();const requestGeneration=++generation;
      if(!dialog){dialog=element("dialog","cc-dialog");dialog.addEventListener("cancel",event=>{event.preventDefault();close();});root.append(dialog);}
      const head=element("header","cc-modal-head");head.append(element("h2","",action.artifact?.name??action.description),button(label("关闭","Close"),close));
      const loading=element("section","cc-step-body");loading.setAttribute("aria-busy","true");loading.append(ui.feedback({state:"loading",title:{text:label("加载中…","Loading…")}}));dialog.replaceChildren(head,loading);if(!dialog.open)dialog.showModal();
      let payload:any;
      try{payload=await request(`/api/runs/${encodeURIComponent(snapshot.run.id)}?representation=action&action=${encodeURIComponent(action.id)}`);}
      catch(error){if(disposed||generation!==requestGeneration)return;loading.removeAttribute("aria-busy");loading.replaceChildren(element("p","",error instanceof Error?error.message:String(error)),button(label("重试","Retry"),()=>void openGraphAction(action,stepId,chosenArtifactId)));return;}
      if(disposed||generation!==requestGeneration)return;const next=payload.run.context as Snapshot;
      snapshot.graph!.work=next.graph!.work.map(s=>s.source?.actionId===action.id?s:(snapshot.graph!.work.find(old=>old.id===s.id)??s));
      snapshot.artifacts=[...new Map([...snapshot.artifacts,...next.artifacts].map(a=>[a.id,a])).values()];
      action=(next.graph!.procedure as ProcedureDefinition).actions.find(a=>a.id===action.id)??action;
      actionDefinitions.set(action.id,action);loadedActions.add(action.id);
    }
    action=actionDefinitions.get(action.id)??action;
    const selection: { action: ProcedureAction; stepId?: string; artifactId?: string } = { action, stepId }; graphSelection = selection;
    const steps = snapshot.graph!.work.filter(step => step.source?.actionId === action.id);
    const step = steps.find(s => s.id === stepId) ?? steps.at(-1);
    if (!step) { close(); graphSelection = selection; procedureCanvas!.show(action.description, procedureCanvas!.actionBody(action)); return; }
    selection.stepId = step.id;
    const stateLabels:Record<string,string>={pending:label("待执行","Pending"),running:label("执行中","Running"),awaiting_review:label("待评审","Awaiting review"),done:label("已完成","Done"),failed:label("失败","Failed"),cancelled:label("已取消","Cancelled")};
    const executionSelect = () => {
      const field=ui.select({label:{text:label("执行实例","Execution")},value:step.id,options:steps.map((candidate,index)=>({value:candidate.id,label:{text:`${label("第", "Execution ")}${index+1}${label("次执行", "")} · ${stateLabels[candidate.status]??candidate.status}`}})),onChange:value=>{void openGraphAction(action,value);}});
      field.root.classList.add("cc-select-field","cc-execution-select");field.control.classList.add("cc-version-select");return field.root;
    };
    const result = step.artifact as { mode?: string; id?: string; items?: Record<string,string[]> } | undefined;
    const candidates = snapshot.artifacts.filter(a => a.stepId === step.id);
    const artifactId = candidates.some(a => a.id === chosenArtifactId) ? chosenArtifactId : candidates.find(a => a.id === step.writing?.draftId)?.id ?? result?.id ?? step.reviewRounds?.at(-1)?.artifactId ?? candidates.at(-1)?.id;
    selection.artifactId = artifactId;
    if (!artifactId) {
      disposeReview?.();
      renderController?.abort(); generation++; currentId = undefined;
      const body = element("section","cc-step-body");
      const intro=element("div","cc-step-intro");intro.append(element("p","cc-step-description",action.description),ui.badge({text:stateLabels[step.status]??step.status}));body.append(intro);
      if (!dialog) { dialog = element("dialog", "cc-dialog"); dialog.addEventListener("cancel", event => { event.preventDefault(); close(); }); root.append(dialog); }
      const head = element("header", "cc-modal-head"); head.append(element("h2", "", result?.mode==="collect"?label("收集产物","Collected artifacts"):action.artifact?.name??action.description), button(label("关闭", "Close"), close));
      const selectors=element("div","cc-version-bar");selectors.append(executionSelect());body.prepend(selectors);const upstream=upstreamSteps(step);if(upstream)selectors.after(upstream);
      if(result?.mode==="collect"){
        const items=Object.entries(result.items??{}),count=items.reduce((total,[,ids])=>total+ids.length,0);
        const heading=element("div","cc-member-heading");heading.append(element("h3","",label("产物成员","Artifact members")),ui.badge({text:String(count)}));body.append(heading);
        const list=element("div","cc-member-list");for(const [source,ids]of items){if(!ids.length){const definition=(snapshot.graph!.procedure as ProcedureDefinition).actions.find(a=>a.id===source);list.append(element("p","cc-member-empty",`${definition?.artifact?.name??source} · ${label("0 个产物","0 artifacts")}`));}for(const id of ids)list.append(graphMember(id));}body.append(list);
      }else body.append(element("p","cc-step-empty",label("本次执行尚未产生产物。","This execution has no artifact yet.")));
      body.append(actionDefinition(action), executionInformation(step));graphBack(head);
      dialog.replaceChildren(head, body); dialog.setAttribute("aria-label",label("运行详情","Run details")); if (!dialog.open) dialog.showModal(); return;
    }
    await open(artifactId);
    if (!dialog || currentId !== artifactId || graphSelection !== selection) return;
    const head=dialog.querySelector<HTMLElement>(".cc-modal-head")!;
    if (!snapshot.workflow) { dialog.querySelector(".cc-version-bar")?.prepend(executionSelect()); graphBack(head); }
    const header=dialog.querySelector(".cc-artifact-header");
    const info=executionInformation(step, snapshot.artifacts.find(a=>a.id===artifactId)),metadata=header?.querySelector(".cc-metadata");
    if(metadata){const facts=info.querySelector("dl")!;facts.append(element("dt","",label("产物 ID","Artifact ID")),element("dd","cc-artifact-id",metadata.textContent??""));}
    header?.querySelector(".cc-artifact-info")?.remove();
    const upstream=snapshot.workflow ? undefined : upstreamSteps(step);if(upstream)header?.append(upstream);
    const artifact = snapshot.artifacts.find(a => a.id === artifactId);
    if (snapshot.workflow && artifact && renderController) header?.append(info, explorationConfiguration(step, artifact, renderController.signal));
    else header?.append(actionDefinition(action), info);

  }
  async function openExternal(id: string) {
    disposeReview?.();
    if (snapshot.workflow) graphSelection = undefined;
    const external = snapshot.externals?.find(e => e.id === id); if (!external) return;
    currentKind = "external"; currentId = id; const currentGeneration = ++generation;
    renderController?.abort(); renderController = new AbortController();
    if (!dialog) { dialog = element("dialog", "cc-dialog"); dialog.addEventListener("cancel", event => { event.preventDefault(); close(); }); root.append(dialog); }
    dialog.dataset.externalId = id; delete dialog.dataset.artifactId;
    dialog.setAttribute("aria-label", label("外部资料", "External"));
    const head = element("header", "cc-modal-head"); head.append(element("h2", "", label("外部资料", "External")), button(label("关闭", "Close"), close));
    artifactBack(head);
    const pane = element("section", "cc-pane cc-external-pane");
    pane.append(element("div", "cc-metadata", id), element("p", "cc-external-source", external.source));
    const body = element("article", "cc-document", label("加载中…", "Loading…")); pane.append(body);
    dialog.replaceChildren(head, pane); if (!dialog.open) dialog.showModal();
    try {
      const value = await request(`/api/runs/${encodeURIComponent(snapshot.run.id)}/externals/${encodeURIComponent(id)}/content`);
      if (disposed || generation !== currentGeneration || currentId !== id || currentKind !== "external") return;
      if (value.previewable === false) {
        const link = element("a", "cc-text-button", label("下载内容", "Download content"));
        link.href = `${projectApiBase ?? "/api"}/runs/${encodeURIComponent(snapshot.run.id)}/externals/${encodeURIComponent(id)}/content?download=1`; link.download = id;
        body.replaceChildren(element("p", "", value.contentType), link);
      } else body.replaceChildren(renderArtifactValue(value));
    } catch (error) { if (!disposed && generation === currentGeneration) body.textContent = error instanceof Error ? error.message : String(error); }
  }
  const detailIdentity = () => JSON.stringify([graphSelection?.action.id, graphSelection?.stepId, graphSelection?.artifactId, currentKind, currentId]);
  const detailFingerprint = (value: Snapshot) => JSON.stringify({
    steps: graphSelection ? value.graph?.work.filter(step => step.source?.actionId === graphSelection!.action.id) : undefined,
    artifacts: graphSelection ? value.artifacts.filter(a => value.graph?.work.some(step => step.source?.actionId === graphSelection!.action.id && step.id === a.stepId)) : value.artifacts.find(a => a.id === currentId),
    reviews: [...value.reviews, ...(value.explorationReviews ?? [])].filter(review => review.artifactId === currentId),
    external: currentKind === "external" ? value.externals?.find(item => item.id === currentId) : undefined
  });
  async function refreshDetail() {
    const epoch = ++refreshEpoch, identity = detailIdentity();
    const disclosureKey = (node: HTMLDetailsElement) => (node.dataset.disclosureKey ?? node.id) || JSON.stringify([node.className, node.textContent]);
    const oldDetails = [...dialog?.querySelectorAll<HTMLDetailsElement>('details') ?? []];
    const opened = new Map(oldDetails.filter(node => oldDetails.filter(other => disclosureKey(other) === disclosureKey(node)).length === 1).map(node => [disclosureKey(node), node.open]));
    const scrolling = ['.cc-pane-content', '.cc-pane-review', '.cc-step-body', '.cc-external-pane'].map(selector => ({ selector, top: dialog?.querySelector(selector)?.scrollTop ?? 0 }));
    if (graphSelection) await openGraphAction(graphSelection.action, graphSelection.stepId, graphSelection.artifactId);
    else if (currentId) await (currentKind === "external" ? openExternal(currentId) : open(currentId));
    if (disposed || epoch !== refreshEpoch || identity !== detailIdentity()) return;
    const details = [...dialog?.querySelectorAll<HTMLDetailsElement>('details') ?? []];
    for (const node of details) {
      const key = disclosureKey(node);
      if (opened.has(key) && details.filter(other => disclosureKey(other) === key).length === 1) node.open = opened.get(key)!;
    }
    for (const state of scrolling) { const node = dialog?.querySelector(state.selector); if (node) node.scrollTop = state.top; }
  }
  return {
    element: root,
    update(value: Snapshot) {
      if (value.workflow) {
        const artifacts = new Map(value.artifacts.map(a => [a.id, a]));
        const work = value.workflow.steps.map(step => {
          const artifact = value.artifacts.find(a => a.stepId === step.id);
          return { ...step, source: { actionId: step.id }, inputs: { dependencies: artifact?.dependencies ?? [] } };
        });
        const definition: ProcedureDefinition = { names: [value.workflow.name], actions: work.map(step => {
          const artifact = value.artifacts.find(a => a.stepId === step.id);
          const dependencies = (artifact?.dependencies ?? []).flatMap(ref => ref.kind === "artifact" && artifacts.get(ref.id) ? [{ from: artifacts.get(ref.id)!.stepId }] : []);
          return { id: step.id, description: artifact?.name ?? step.id, ...(artifact ? { artifact: { name: artifact.name } } : {}), dependencies };
        }) };
        value = { ...value, graph: { procedure: definition, work } };
      }
      const nextKey = JSON.stringify(value);
      if (nextKey === snapshotKey) return;
      const detailChanged = !snapshot || detailFingerprint(snapshot) !== detailFingerprint(value);
      if (snapshot && snapshot.run.id !== value.run.id) definitionInfo.open = false;
      if(value.lazy&&snapshot?.run.id===value.run.id){
        value.artifacts=snapshot.artifacts;artifactsLoaded=false;
        if(value.graph&&snapshot.graph)value.graph.work=value.graph.work.map(step=>{
          const old=snapshot.graph!.work.find(s=>s.id===step.id);
          if(old?.status===step.status&&JSON.stringify(old.artifact)===JSON.stringify(step.artifact)&&JSON.stringify(old.writing)===JSON.stringify(step.writing))return {...old,...step};
          if(step.source)loadedActions.delete(step.source.actionId);return step;
        });
      }else{loadedActions.clear();actionDefinitions.clear();artifactsLoaded=false;}
      snapshotKey = nextKey; snapshot = value;
      work.hidden = !value.graph;
      if (value.graph) {
        const definition = value.graph.procedure as ProcedureDefinition;
        const nextDefinitionKey = JSON.stringify([value.run.id, definition.names, definition.defines, definition.goals, definition.asserts, definition.suggests, definition.effectiveRules]);
        if (nextDefinitionKey !== definitionKey) {
        definitionKey = nextDefinitionKey;
        definitionBody.replaceChildren();
        for (const [title, values] of [[label("名称", "Names"), definition.names], [label("定义", "Definitions"), definition.defines], [label("目标", "Goals"), definition.goals]] as const) {
          if (!values?.length) continue;
          const section = element("section"), list = element("ul"); section.append(element("h3", "", title), list);
          values.forEach(value => list.append(element("li", "", value))); definitionBody.append(section);
        }
        for (const channel of ["asserts", "suggests"] as const) {
          const group = graphRuleGroup(channel === "asserts" ? label("总体要求", "Overall requirements") : label("总体建议", "Overall suggestions"), definition[channel], definition.effectiveRules, channel, Boolean(english));
          if (group) definitionBody.append(group);
        }
        }
        if (value.workflow) artifactCanvas.setSummary(label("自由探索","Exploration"), `${label("产物","Artifacts")} ${value.artifacts.length} · ${label("执行","Executions")} ${value.steps.length} · ${label("外部资料","External sources")} ${value.externals?.length??0}`);
        else artifactCanvas.setStatistics(graphStatistics(definition.actions));
        const summary = (id: string) => `${snapshot.graph!.work.filter(step => step.source?.actionId === id).length} ${label("次执行", "executions")}`;
        if (!procedureCanvas) {
          procedureCanvas = createProcedureGraph(definition, { ui, locale, summary, badges: id => {
            const steps = snapshot.graph!.work.filter(step => step.source?.actionId === id);
            const labels: Record<string,string> = {pending:label("待执行","Pending"),running:label("执行中","Running"),awaiting_review:label("待评审","Awaiting review"),done:label("已完成","Done"),failed:label("失败","Failed"),cancelled:label("已取消","Cancelled")};
            return Object.entries(labels).flatMap(([status,text]) => { const count = steps.filter(s => s.status === status).length; return count ? [{label:`${text} ${count}`,tone:status === "awaiting_review" ? "wait" : status === "done" ? "done" : "neutral"}] : []; });
          }, edgeDetails: edge => {
            if(edge.collect || edge.group.length < 2) return;
            const frame = snapshot.run.frames?.find(f => f.type === "graph")?.graphFrame;
            const evidence = joinEvidence(frame, edge.to, edge.dependencyIndex!, edge.group);
            const body = element("section", "cc-join-evidence");
            if (evidence.state === "arrivals") {
              for (const [title, ids] of [[label("已到达", "Arrived"), evidence.arrived], [label("尚未到达", "Missing"), evidence.missing]] as const) {
                const group = element("section"), list = element("ul"); group.append(element("h4", "", title), list);
                for (const id of ids) list.append(element("li", "", id === "START" ? label("开始", "Start") : definition.actions.find(a => a.id === id)?.artifact?.name ?? id));
                body.append(group);
              }
            } else if (evidence.state === "triggered") {
              body.append(element("p", "", label("已汇合并触发执行", "Joined and triggered execution")));
              const step = snapshot.graph!.work.find(s => s.id === evidence.stepId), action = definition.actions.find(a => a.id === step?.source?.actionId);
              if (step && action) body.append(button(action.artifact?.name ?? action.description, () => { procedureCanvas!.close(); void openGraphAction(action, step.id); }, "cc-text-button"));
            } else body.append(element("p", "", evidence.state === "condition-not-accepted" ? label("最近一次汇合的条件未通过", "The latest join condition was not accepted") : label("暂无可用的汇合记录", "No join evidence available")));
            return body;
          }, onClose:()=>{graphSelection=undefined;}, onAction: action => { void openGraphAction(action); } });
          work.replaceChildren(definitionInfo, procedureCanvas.element);
        } else procedureCanvas.update(definition);
      } else { procedureCanvas?.dispose(); procedureCanvas = undefined; work.replaceChildren();artifactCanvas.setSummary(label("自由探索","Exploration"),`${label("产物","Artifacts")} ${value.artifacts.length} · ${label("执行","Executions")} ${value.steps.length} · ${label("外部资料","External sources")} ${value.externals?.length??0}`); }
      syncGraphView();
      const times = new Map(value.steps.map(s => [s.id, s.createdAt]));
      history = artifactHistory(value.artifacts.filter(a => value.graph && !value.workflow || value.completeIds.includes(a.id) || a.status === "draft" && value.workflow?.steps.some(s => s.id === a.stepId)).sort((a, b) => (times.get(a.stepId) ?? "").localeCompare(times.get(b.stepId) ?? "") || a.id.localeCompare(b.id)));
      if (selected && !value.artifacts.some(a => a.id === selected)) selected = undefined;
      try { void graph(); if (detailChanged && (graphSelection || currentId)) void refreshDetail(); } catch (error) { graphHost.replaceChildren(element("div", "cc-state", error instanceof Error ? error.message : String(error))); }
    },
    dispose() { procedureCanvas?.dispose(); disposed = true; layoutGeneration++; stopDrag(); artifactCanvas.dispose(); close(); root.remove(); }
  };
}
