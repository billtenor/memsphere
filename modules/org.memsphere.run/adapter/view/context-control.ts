import type { ViewUi } from "@memsphere/view-sdk";
import { renderArtifactValue } from "./run-detail.js";
import { contextControlStyles } from "./context-control-styles.js";
import { layoutGraph } from "./graph-layout.js";

type Artifact = { id: string; stepId: string; name: string; status: string; tags: string[]; revisedFrom?: string; dependencies: Array<{ kind: string; id: string }> };
type Snapshot = { graph?: { procedure: unknown; work: Array<{ id: string; status: string; artifact?: unknown; action?: { description: string; artifact?: unknown }; inputs?: unknown; reviewHandle?: string }> }; run: { id: string; status: string }; outputArtifactIds: string[]; artifacts: Artifact[]; externals?: Array<{ id: string; source: string }>; steps: Array<{ id: string; createdAt: string }>; completeIds: string[]; reviews: Array<{ id: string; artifactId: string; reviewer: { source?: string }; comments: Array<{ id: string; body: string }>; createdAt: string }> };
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

export function createContextGraph(ui: ViewUi, request: (path: string) => Promise<any>, locale?: string, projectApiBase?: string, openReview?: (runId: string, reviewId: string) => Promise<void>) {
  const english = locale?.startsWith("en");
  const label = (zh: string, en: string) => english ? en : zh;
  const root = element("section", "cc-exploration"); root.dataset.contextControl = "";
  const style = element("style"); style.textContent = contextControlStyles; root.append(style);
  const toolbar = element("div", "cc-toolbar"), graphHost = element("div", "cc-canvas-scroll");
  const viewLabel = element("span", "cc-toolbar-label"); toolbar.append(element("strong", "", label("产物", "Artifacts")), viewLabel);
  const graphCard = element("section", "cc-graph-card"); graphCard.setAttribute("aria-label", label("产物依赖图", "Artifact dependency graph")); graphCard.append(graphHost); root.append(toolbar, graphCard);
  const workDisclosures = new Map<string, boolean>();
  const work = element("section", "cc-work"); root.insertBefore(work, toolbar);
  let snapshot: Snapshot, history: ReturnType<typeof artifactHistory>, selected: string | undefined, currentId: string | undefined;
  let currentKind: "artifact" | "external" = "artifact";
  const events = new AbortController();
  let dialog: HTMLDialogElement | undefined, origin: HTMLElement | undefined, generation = 0, disposed = false, layoutGeneration = 0;
  let snapshotKey = "", graphKey = "";
  let renderController: AbortController | undefined; let activePane = "content";
  const button = (text: string, action: () => void, cls = "cc-button") => { const node = element("button", cls, text); node.type = "button"; node.addEventListener("click", action); return node; };
  const reset = button(label("回到最新", "Latest"), () => { selected = undefined; close(); graph(); }); toolbar.append(reset);
  const close = () => { renderController?.abort(); activePane = "content"; generation++; dialog?.close(); dialog?.remove(); dialog = undefined; currentId = undefined; const node = graphHost.querySelector<HTMLButtonElement>(`[data-artifact-id="${selected ?? origin?.dataset.artifactId ?? ""}"]`); (node ?? origin)?.focus(); };
  let drag: { pointer: number; x: number; y: number; left: number; top: number; moved: boolean } | undefined;
  let blockClick = false;
  const stopDrag = () => {
    const previous = drag; drag = undefined; delete graphHost.dataset.dragging;
    if (previous) { blockClick = previous.moved; if (graphHost.hasPointerCapture(previous.pointer)) graphHost.releasePointerCapture(previous.pointer); }
  };
  graphHost.addEventListener("pointerdown", event => {
    blockClick = false;
    if (event.button !== 0 || event.pointerType === "touch" || (event.target as Element).closest("button,a,input,select,textarea,summary,label,[contenteditable]")) return;
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: graphHost.scrollLeft, top: graphHost.scrollTop, moved: false };
    graphHost.setPointerCapture(event.pointerId); event.preventDefault();
  }, { signal: events.signal });
  graphHost.addEventListener("pointermove", event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true; graphHost.dataset.dragging = "true";
    graphHost.scrollLeft = drag.left - dx; graphHost.scrollTop = drag.top - dy;
  }, { signal: events.signal });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"] as const) graphHost.addEventListener(name, stopDrag, { signal: events.signal });
  window.addEventListener("blur", stopDrag, { signal: events.signal });
  graphHost.addEventListener("click", event => { if (blockClick) { blockClick = false; event.preventDefault(); event.stopImmediatePropagation(); } }, { capture: true, signal: events.signal });
  const versions = (a: Artifact) => snapshot.completeIds.includes(a.id) ? history.versions(a.id) : [a];
  const choose = (id: string) => { selected = id; graph(); };
  const select = (id: string) => { choose(id); graphHost.querySelector<HTMLButtonElement>(`[data-artifact-id="${id}"]`)?.focus(); };
  async function graph() {
    const projectionKey = JSON.stringify([snapshot, selected]);
    if (projectionKey === graphKey) return;
    graphKey = projectionKey;
    const requestId = ++layoutGeneration;
    const scroll = { left: graphHost.scrollLeft, top: graphHost.scrollTop };
    const openMenus = new Set([...graphHost.querySelectorAll<HTMLDetailsElement>(".cc-history[open]")].map(d => d.parentElement?.querySelector<HTMLElement>("[data-node-key]")?.dataset.nodeKey));
    try {
      reset.hidden = !selected; reset.textContent = snapshot.run.status === "done" ? label("回到交付视图", "Delivery view") : label("回到当前成果", "Current outputs");
      const defaultView = () => history.latest(snapshot.outputArtifactIds);
      const visible = selected && snapshot.completeIds.includes(selected) ? history.around(selected) : defaultView();
      stopDrag();
      const referenced = new Set(visible.flatMap(a => a.dependencies.filter(d => d.kind === "external").map(d => d.id)));
      const used = new Set(snapshot.artifacts.filter(a => snapshot.completeIds.includes(a.id)).flatMap(a => a.dependencies.filter(d => d.kind === "external").map(d => d.id)));
      const externals = (snapshot.externals ?? []).filter(e => referenced.has(e.id) || !selected && snapshot.run.status === "running" && !used.has(e.id));
      const key = (kind: string, id: string) => `${kind}:${id}`;
      viewLabel.textContent = selected ? versions(snapshot.artifacts.find(a => a.id === selected)!).findIndex(a => a.id === selected) + 1 + "" : "";
      graphHost.replaceChildren();
      if (!visible.length && !externals.length) { graphHost.append(element("div", "cc-state", label("暂无成果", "No outputs"))); return; }
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
        const node = button("", () => { origin = node; void open(a.id); }, "cc-node"); node.dataset.artifactId = a.id; node.dataset.nodeKey = key("artifact", a.id); node.dataset.selected = String(selected === a.id); node.setAttribute("aria-label", `${a.name} v${index + 1}`);
        const tagRow = element("div", "cc-node-tags"); a.tags.filter(t => t !== "default").forEach(t => tagRow.append(ui.badge({ text: t })));
        const comments = snapshot.reviews.filter(r => r.artifactId === a.id).reduce((n, r) => n + r.comments.length, 0);
        const footer = element("div", "cc-node-footer"); footer.append(element("span", "", a.status === "draft" ? label("草稿", "Draft") : snapshot.completeIds.includes(a.id) ? label("已提交", "Submitted") : label("提交未完成", "Incomplete submission")), element("span", "", `${comments} ${label("条评论", "comments")}`));
        node.append(element("div", "cc-node-version", `v${index + 1}${index === group.length - 1 ? label(" · 最新", " · Latest") : ""}`), element("strong", "", a.name), tagRow, footer); stack.append(node);
        if (group.length > 1) { const details = element("details", "cc-history"); details.append(element("summary", "", `${label("历史版本", "History")} · ${group.length - 1}`)); const menu = element("div", "cc-history-menu"); [...group].reverse().forEach((v) => menu.append(button(`v${group.indexOf(v) + 1} · ${v.name}`, () => select(v.id), "cc-history-option"))); details.append(menu); stack.append(details); }
        canvas.append(stack);
      }
      // Measure rendered cards and folded history controls before assigning coordinates.
      canvas.style.visibility = "hidden"; graphHost.append(canvas);
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
      canvas.style.width = `${layout.width}px`; canvas.style.height = `${layout.height}px`;
      stacks.forEach(stack => {
        const node = stack.querySelector<HTMLElement>("[data-node-key]")!, pos = layout.positions.get(node.dataset.nodeKey!)!;
        stack.style.left = `${pos.x}px`; stack.style.top = `${pos.y}px`;
        if (openMenus.has(node.dataset.nodeKey)) stack.querySelector<HTMLDetailsElement>(".cc-history")?.setAttribute("open", "");
      });
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("aria-hidden", "true");
      for (const edge of layout.edges) {
        const path = document.createElementNS(svg.namespaceURI, "path") as SVGPathElement;
        path.setAttribute("class", "cc-edge"); path.setAttribute("d", edge.path);
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
      message.append(button(label("重试", "Retry"), () => { void graph(); })); graphHost.replaceChildren(message);
    }
  }
  async function open(id: string) {
    const a = snapshot.artifacts.find(a => a.id === id); if (!a) return;
    currentKind = "artifact"; currentId = id; const currentGeneration = ++generation;
    renderController?.abort(); renderController = new AbortController();
    if (!dialog) { dialog = element("dialog", "cc-dialog"); dialog.setAttribute("aria-label", label("产物", "Artifact")); dialog.addEventListener("cancel", event => { event.preventDefault(); close(); }); root.append(dialog); }
    dialog.dataset.artifactId = id; delete dialog.dataset.externalId; dialog.setAttribute("aria-label", label("产物", "Artifact"));
    const head = element("header", "cc-modal-head"); head.append(element("h2", "", a.name), button(label("关闭", "Close"), close));
    const columns = element("div", "cc-modal-columns"), content = element("section", "cc-pane cc-pane-content"), reviews = element("section", "cc-pane cc-pane-review");
    content.setAttribute("aria-label", label("产物内容", "Artifact content")); reviews.setAttribute("aria-label", label("评审", "Reviews"));
    const metadata = element("div", "cc-metadata"); metadata.append(element("span", "cc-chip", a.id), ...a.tags.map(t => ui.badge({ text: t }))); content.append(metadata);
    const group = versions(a), index = group.findIndex(a => a.id === id), bar = element("div", "cc-version-bar"), selectVersion = element("select", "cc-version-select"); selectVersion.setAttribute("aria-label", label("历史版本", "History"));
    group.forEach((v, i) => { const option = element("option", "", `v${i + 1} · ${v.name}`); option.value = v.id; option.selected = v.id === id; selectVersion.append(option); });
    const switchTo = (next: string, action: string) => { choose(next); void open(next); const control = dialog?.querySelector<HTMLButtonElement | HTMLSelectElement>(`[data-version-action="${action}"]`); (control?.disabled ? dialog?.querySelector<HTMLSelectElement>(".cc-version-select") : control)?.focus(); };
    selectVersion.addEventListener("change", () => switchTo(selectVersion.value, "select"));
    const older = button(label("上一版", "Previous"), () => switchTo(group[index - 1].id, "older")), newer = button(label("下一版", "Next"), () => switchTo(group[index + 1].id, "newer")); older.dataset.versionAction = "older"; newer.dataset.versionAction = "newer"; selectVersion.dataset.versionAction = "select"; older.disabled = index === 0; newer.disabled = index === group.length - 1; bar.append(selectVersion, older, newer); content.append(bar);
    const deps = element("div", "cc-related"); a.dependencies.forEach(r => deps.append(r.kind === "artifact" ? button(snapshot.artifacts.find(a => a.id === r.id)?.name ?? r.id, () => { choose(r.id); void open(r.id); }, "cc-text-button") : button(snapshot.externals?.find(e => e.id === r.id)?.source ?? r.id, () => { void openExternal(r.id); }, "cc-text-button"))); content.append(deps);
    const body = element("article", "cc-document", a.status === "draft" ? label("未提交", "Not submitted") : label("加载中…", "Loading…")); content.append(body);
    const entries = snapshot.reviews.filter(r => r.artifactId === id); reviews.append(element("h3", "cc-pane-title", label("评审", "Reviews")));
    if (!entries.length) reviews.append(element("div", "cc-no-review", label("暂无评审", "No reviews")));
    for (const r of entries) { const card = element("article", "cc-review-card"); card.append(element("div", "cc-review-head", `${r.reviewer.source === "human" ? "Human" : "Agent"} · ${r.createdAt}`)); for (const c of r.comments) card.append(element("p", "", c.body)); reviews.append(card); }
    const tabs = element("div", "cc-mobile-tabs"), media = window.matchMedia("(max-width: 760px)");
    const applyPane = () => { content.hidden = media.matches && activePane !== "content"; reviews.hidden = media.matches && activePane !== "review"; };
    tabs.append(button(label("产物内容", "Content"), () => { activePane = "content"; applyPane(); }), button(label("评审", "Reviews"), () => { activePane = "review"; applyPane(); })); media.addEventListener("change", applyPane, { signal: renderController.signal }); applyPane();
    columns.append(content, reviews); dialog.replaceChildren(head, tabs, columns); if (!dialog.open) dialog.showModal();
    if (a.status !== "draft") try {
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
  async function openExternal(id: string) {
    const external = snapshot.externals?.find(e => e.id === id); if (!external) return;
    currentKind = "external"; currentId = id; const currentGeneration = ++generation;
    renderController?.abort(); renderController = new AbortController();
    if (!dialog) { dialog = element("dialog", "cc-dialog"); dialog.addEventListener("cancel", event => { event.preventDefault(); close(); }); root.append(dialog); }
    dialog.dataset.externalId = id; delete dialog.dataset.artifactId;
    dialog.setAttribute("aria-label", label("外部资料", "External"));
    const head = element("header", "cc-modal-head"); head.append(element("h2", "", label("外部资料", "External")), button(label("关闭", "Close"), close));
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
  return {
    element: root,
    update(value: Snapshot) {
      const nextKey = JSON.stringify(value);
      if (nextKey === snapshotKey) return;
      snapshotKey = nextKey; snapshot = value;
      for (const node of work.querySelectorAll<HTMLDetailsElement>("details[data-work-disclosure]")) workDisclosures.set(node.dataset.workDisclosure!, node.open);
      work.hidden = !value.graph;
      if (value.graph) {
        work.replaceChildren(element("h2", "", label("流程进度", "Workflow progress")));
        for (const step of value.graph.work) {
          const item = element("details", "cc-work-step"); item.dataset.stepId = step.id; item.dataset.workDisclosure = step.id; item.open = workDisclosures.get(step.id) ?? false;
          item.append(element("summary", "", `${step.action?.description ?? step.id} · ${step.status}`));
          item.append(element("p", "", `Step ${step.id}`), element("pre", "", JSON.stringify({ inputs: step.inputs, artifact: step.action?.artifact, result: step.artifact }, null, 2)));
          if (step.reviewHandle && openReview) item.append(button(label("查看与参与评审", "Open review"), () => { void openReview(value.run.id, step.reviewHandle!); }));
          work.append(item);
        }
        const definition = element("details"); definition.dataset.workDisclosure = "definition"; definition.open = workDisclosures.get("definition") ?? false; definition.append(element("summary", "", label("流程定义", "Workflow definition")), element("pre", "", JSON.stringify(value.graph.procedure, null, 2))); work.append(definition);
      } else work.replaceChildren();
      const times = new Map(value.steps.map(s => [s.id, s.createdAt]));
      history = artifactHistory(value.artifacts.filter(a => value.completeIds.includes(a.id)).sort((a, b) => (times.get(a.stepId) ?? "").localeCompare(times.get(b.stepId) ?? "") || a.id.localeCompare(b.id)));
      if (selected && !value.artifacts.some(a => a.id === selected)) selected = undefined;
      try { void graph(); if (currentId) void (currentKind === "external" ? openExternal(currentId) : open(currentId)); } catch (error) { graphHost.replaceChildren(element("div", "cc-state", error instanceof Error ? error.message : String(error))); }
    },
    dispose() { disposed = true; layoutGeneration++; stopDrag(); events.abort(); close(); root.remove(); }
  };
}
