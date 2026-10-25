import type { ViewUi } from "@memsphere/view-sdk";
import { renderArtifactValue } from "./run-detail.js";
import { contextControlStyles } from "./context-control-styles.js";

type Artifact = { id: string; stepId: string; name: string; status: string; tags: string[]; revisedFrom?: string; dependencies: Array<{ kind: string; id: string }> };
type Snapshot = { run: { id: string; status: string; finalArtifactIds: string[] }; artifacts: Artifact[]; steps: Array<{ id: string; createdAt: string }>; completeIds: string[]; reviews: Array<{ id: string; artifactId: string; reviewer: { source?: string }; comments: Array<{ id: string; body: string }>; createdAt: string }> };
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

export function createContextGraph(ui: ViewUi, request: (path: string) => Promise<any>, locale?: string, projectApiBase?: string) {
  const english = locale?.startsWith("en");
  const label = (zh: string, en: string) => english ? en : zh;
  const root = element("section", "cc-exploration"); root.dataset.contextControl = "";
  const style = element("style"); style.textContent = contextControlStyles; root.append(style);
  const toolbar = element("div", "cc-toolbar"), graphHost = element("div", "cc-canvas-scroll");
  const viewLabel = element("span", "cc-toolbar-label"); toolbar.append(element("strong", "", label("产物", "Artifacts")), viewLabel);
  const graphCard = element("section", "cc-graph-card"); graphCard.setAttribute("aria-label", label("产物依赖图", "Artifact dependency graph")); graphCard.append(graphHost); root.append(toolbar, graphCard);
  let snapshot: Snapshot, history: ReturnType<typeof artifactHistory>, selected: string | undefined, currentId: string | undefined;
  let dialog: HTMLDialogElement | undefined, origin: HTMLElement | undefined, generation = 0, disposed = false;
  let renderController: AbortController | undefined; let activePane = "content";
  const button = (text: string, action: () => void, cls = "cc-button") => { const node = element("button", cls, text); node.type = "button"; node.addEventListener("click", action); return node; };
  const reset = button(label("回到最新", "Latest"), () => { selected = undefined; close(); graph(); }); toolbar.append(reset);
  const close = () => { renderController?.abort(); activePane = "content"; generation++; dialog?.close(); dialog?.remove(); dialog = undefined; currentId = undefined; const node = graphHost.querySelector<HTMLButtonElement>(`[data-artifact-id="${selected ?? origin?.dataset.artifactId ?? ""}"]`); (node ?? origin)?.focus(); };
  const versions = (a: Artifact) => snapshot.completeIds.includes(a.id) ? history.versions(a.id) : [a];
  const choose = (id: string) => { selected = id; graph(); };
  const select = (id: string) => { choose(id); graphHost.querySelector<HTMLButtonElement>(`[data-artifact-id="${id}"]`)?.focus(); };
  function graph() {
    reset.hidden = !selected; reset.textContent = snapshot.run.status === "done" ? label("回到交付视图", "Delivery view") : label("回到最新", "Latest");
    const defaultView = () => history.latest(snapshot.run.status === "done" ? snapshot.run.finalArtifactIds : undefined);
    const visible = selected && snapshot.completeIds.includes(selected) ? history.around(selected) : defaultView();
    if (snapshot.run.status === "running") visible.push(...snapshot.artifacts.filter(a => !snapshot.completeIds.includes(a.id)));
    viewLabel.textContent = selected ? versions(snapshot.artifacts.find(a => a.id === selected)!).findIndex(a => a.id === selected) + 1 + "" : "";
    graphHost.replaceChildren();
    if (!visible.length) { graphHost.append(element("div", "cc-state", label("暂无产物", "No artifacts"))); return; }
    const canvas = element("div", "cc-graph"), positions = new Map<string, { x: number; y: number }>(), depths = new Map<string, number>(), rows = new Map<number, number>();
    for (const a of visible) {
      const depth = snapshot.completeIds.includes(a.id) ? Math.max(0, ...a.dependencies.filter(r => r.kind === "artifact").map(r => (depths.get(r.id) ?? -1) + 1)) : 0;
      const row = rows.get(depth) ?? 0; rows.set(depth, row + 1); depths.set(a.id, depth); positions.set(a.id, { x: 30 + depth * 300, y: 60 + row * 250 });
    }
    canvas.style.width = `${Math.max(890, 290 + Math.max(...depths.values()) * 300)}px`; canvas.style.height = `${Math.max(330, 80 + Math.max(...rows.values()) * 250)}px`;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("aria-hidden", "true");
    for (const a of visible) for (const r of a.dependencies.filter(r => r.kind === "artifact")) {
      const from = positions.get(r.id), to = positions.get(a.id); if (!from || !to || !snapshot.completeIds.includes(a.id)) continue;
      const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("class", "cc-edge"); path.setAttribute("d", `M ${from.x + 226} ${from.y + 73} C ${from.x + 265} ${from.y + 73}, ${to.x - 38} ${to.y + 73}, ${to.x - 7} ${to.y + 73} l -7 -4 m 7 4 l -7 4`); path.setAttribute("data-dependency", `${r.id}:${a.id}`); svg.append(path);
    }
    canvas.append(svg);
    for (const a of visible) {
      const pos = positions.get(a.id)!, group = versions(a), index = group.findIndex(v => v.id === a.id);
      const stack = element("div", "cc-node-stack"); stack.style.left = `${pos.x}px`; stack.style.top = `${pos.y}px`;
      const node = button("", () => { origin = node; void open(a.id); }, "cc-node"); node.dataset.artifactId = a.id; node.setAttribute("aria-label", `${a.name} v${index + 1}`);
      const tagRow = element("div", "cc-node-tags"); a.tags.filter(t => t !== "default").forEach(t => tagRow.append(ui.badge({ text: t })));
      const comments = snapshot.reviews.filter(r => r.artifactId === a.id).reduce((n, r) => n + r.comments.length, 0);
      const footer = element("div", "cc-node-footer"); footer.append(element("span", "", a.status === "draft" ? label("草稿", "Draft") : snapshot.completeIds.includes(a.id) ? label("已提交", "Submitted") : label("提交未完成", "Incomplete submission")), element("span", "", `${comments} ${label("条评论", "comments")}`));
      node.append(element("div", "cc-node-version", `v${index + 1}${index === group.length - 1 ? label(" · 最新", " · Latest") : ""}`), element("strong", "", a.name), tagRow, footer); stack.append(node);
      if (group.length > 1) { const details = element("details", "cc-history"); details.append(element("summary", "", `${label("历史版本", "History")} · ${group.length - 1}`)); const menu = element("div", "cc-history-menu"); [...group].reverse().forEach((v) => menu.append(button(`v${group.indexOf(v) + 1} · ${v.name}`, () => select(v.id), "cc-history-option"))); details.append(menu); stack.append(details); }
      canvas.append(stack);
    }
    graphHost.append(canvas);
  }
  async function open(id: string) {
    const a = snapshot.artifacts.find(a => a.id === id); if (!a) return;
    currentId = id; const currentGeneration = ++generation;
    renderController?.abort(); renderController = new AbortController();
    if (!dialog) { dialog = element("dialog", "cc-dialog"); dialog.setAttribute("aria-label", label("产物", "Artifact")); dialog.addEventListener("cancel", event => { event.preventDefault(); close(); }); root.append(dialog); }
    dialog.dataset.artifactId = id;
    const head = element("header", "cc-modal-head"); head.append(element("h2", "", a.name), button(label("关闭", "Close"), close));
    const columns = element("div", "cc-modal-columns"), content = element("section", "cc-pane cc-pane-content"), reviews = element("section", "cc-pane cc-pane-review");
    content.setAttribute("aria-label", label("产物内容", "Artifact content")); reviews.setAttribute("aria-label", label("评审", "Reviews"));
    const metadata = element("div", "cc-metadata"); metadata.append(element("span", "cc-chip", a.id), ...a.tags.map(t => ui.badge({ text: t }))); content.append(metadata);
    const group = versions(a), index = group.findIndex(a => a.id === id), bar = element("div", "cc-version-bar"), selectVersion = element("select", "cc-version-select"); selectVersion.setAttribute("aria-label", label("历史版本", "History"));
    group.forEach((v, i) => { const option = element("option", "", `v${i + 1} · ${v.name}`); option.value = v.id; option.selected = v.id === id; selectVersion.append(option); });
    const switchTo = (next: string, action: string) => { choose(next); void open(next); const control = dialog?.querySelector<HTMLButtonElement | HTMLSelectElement>(`[data-version-action="${action}"]`); (control?.disabled ? dialog?.querySelector<HTMLSelectElement>(".cc-version-select") : control)?.focus(); };
    selectVersion.addEventListener("change", () => switchTo(selectVersion.value, "select"));
    const older = button(label("上一版", "Previous"), () => switchTo(group[index - 1].id, "older")), newer = button(label("下一版", "Next"), () => switchTo(group[index + 1].id, "newer")); older.dataset.versionAction = "older"; newer.dataset.versionAction = "newer"; selectVersion.dataset.versionAction = "select"; older.disabled = index === 0; newer.disabled = index === group.length - 1; bar.append(selectVersion, older, newer); content.append(bar);
    const deps = element("div", "cc-related"); a.dependencies.forEach(r => deps.append(r.kind === "artifact" ? button(snapshot.artifacts.find(a => a.id === r.id)?.name ?? r.id, () => { choose(r.id); void open(r.id); }, "cc-text-button") : element("span", "cc-chip", `External · ${r.id}`))); content.append(deps);
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
  return {
    element: root,
    update(value: Snapshot) {
      snapshot = value;
      const times = new Map(value.steps.map(s => [s.id, s.createdAt]));
      history = artifactHistory(value.artifacts.filter(a => value.completeIds.includes(a.id)).sort((a, b) => (times.get(a.stepId) ?? "").localeCompare(times.get(b.stepId) ?? "") || a.id.localeCompare(b.id)));
      if (selected && !value.artifacts.some(a => a.id === selected)) selected = undefined;
      try { graph(); if (currentId) void open(currentId); } catch (error) { graphHost.replaceChildren(element("div", "cc-state", error instanceof Error ? error.message : String(error))); }
    },
    dispose() { disposed = true; close(); root.remove(); }
  };
}
