import { defineViewPlugin, slots } from "@memsphere/view-sdk";

// Presentation only: revision groups and views are derived from concrete IDs.
// The demo records are ordered oldest to newest; production must use submission
// order from the domain service, never names or arbitrary Store enumeration.
export function createArtifactHistory(records) {
  const byId = new Map(records.map(a => [a.id, a]));
  const rootOf = id => {
    const seen = new Set();
    while (byId.get(id)?.revisedFrom) {
      if (seen.has(id)) throw new Error("Cyclic revision history");
      seen.add(id);
      id = byId.get(id).revisedFrom;
    }
    if (!byId.has(id)) throw new Error("Missing revision source");
    return id;
  };
  const groups = new Map();
  for (const a of records) {
    const key = rootOf(a.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  function ancestors(id, result = new Set()) {
    if (result.has(id)) return result;
    const a = byId.get(id);
    if (!a) throw new Error(`Missing Artifact: ${id}`);
    result.add(id);
    for (const dep of a.dependencies) ancestors(dep, result);
    return result;
  }
  function order(ids) {
    const ordered = [];
    const seen = new Set();
    function visit(id) {
      if (seen.has(id) || !ids.has(id)) return;
      seen.add(id);
      for (const dep of byId.get(id).dependencies) visit(dep);
      ordered.push(byId.get(id));
    }
    for (const a of records) visit(a.id);
    return ordered;
  }
  function latest(rootIds) {
    const visible = new Set();
    const roots = rootIds ?? [...groups.values()].map(g => g.at(-1).id);
    for (const id of roots) ancestors(id, visible);
    return order(visible);
  }
  function around(id) {
    const visible = ancestors(id);
    const descendants = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const a of records) {
        if (!descendants.has(a.id) && a.dependencies.some(dep => descendants.has(dep))) {
          descendants.add(a.id); changed = true;
        }
      }
    }
    // Prefer the latest compatible continuation, preserving the selected
    // version and all of its exact prerequisites. Revisions are never edges.
    for (const a of [...records].reverse()) {
      if (!descendants.has(a.id)) continue;
      const required = ancestors(a.id);
      const conflicts = [...required].some(candidate => [...visible].some(current => (
        candidate !== current && rootOf(candidate) === rootOf(current)
      )));
      if (!conflicts) for (const candidate of required) visible.add(candidate);
    }
    return order(visible);
  }
  return { latest, around, versions: id => groups.get(rootOf(id)), root: id => byId.get(rootOf(id)) };
}

// Fixed, local demonstration data. This Module never reads or writes real Runs.
const artifacts = [
  {
    id: "artifact-a1", label: "A", name: "需求契约", status: "submitted", tags: ["default", "requirements"], dependencies: [],
    content: `<h3>上下文控制 · 当前迭代需求</h3><p>让 Agent 在同一 Run 中持续提交产物，声明实际依赖，通过轻量 Review 留下修改依据。</p><h4>当前范围</h4><ul><li>自由探索 CLI 与完整产物上报。</li><li>基于已有产物修改，保留历史结果。</li><li>依赖关系与按标签批量选择。</li></ul><h4>交付方式</h4><p>首版先通过命令行完成生产和查询，运行状态沿用已有本地文件。</p>`,
    reviews: [{ id: "review-a1-human", reviewer: { role: "reviewer", actorId: "actor5" }, time: "13:10", comments: ["自由探索需要直接使用已经确认的新模型及其 Store，不能沿用旧 Run 状态文件。", "第一版也需要前端依赖图，以及查看产物内容和 Review 的浮窗。"] }]
  },
  {
    id: "artifact-b1", label: "B", name: "存储方案", status: "submitted", tags: ["default", "design"], dependencies: ["artifact-a1"],
    content: `<h3>原持久化方案</h3><p>基于需求 A，为自由探索增加运行入口，并复用当前流程的 Run 状态文件。</p><h4>存储方式</h4><p>由应用服务组合本地路径，直接保存 JSON。后续再考虑模型化迁移。</p><h4>界面</h4><p>首版暂时只提供 CLI 查询。</p>`,
    reviews: [{ id: "review-b1-human", reviewer: { role: "reviewer", actorId: "actor5" }, time: "13:16", comments: ["JSON 文件可以作为 Store 后端，但领域逻辑不能直接依赖物理路径。请单独建设新模块。"] }]
  },
  {
    id: "artifact-c1", label: "C", name: "验证报告", status: "submitted", tags: ["default", "implementation"], dependencies: ["artifact-b1"],
    content: `<h3>验证报告</h3><p>本文整理本轮 CLI 的实现范围。</p><h4>已有工作</h4><ul><li>上报完整产物。</li><li>保存产物依赖。</li><li>命令行读取内容。</li></ul><p>此版本基于旧 B，不会因为 A、B 后来修改而自动改变。</p>`, reviews: []
  },
  {
    id: "artifact-a2", label: "A′", name: "需求契约", status: "submitted", tags: ["default", "requirements"], dependencies: [], revisedFrom: "artifact-a1",
    content: `<h3>上下文控制 · 修订后的需求</h3><p>自由探索使用独立的新模块，Run、Step、Artifact、External、Review 全部通过对应模型的 Store 读写。</p><h4>持久化边界</h4><ul><li>首版采用 JSON 文件 Store。</li><li>领域服务只依赖模型与 Store 接口。</li><li>旧流程保持原有模块，后续逐步适配。</li></ul><h4>首版前端</h4><p>在 View 中展示 Artifact 依赖图。点击节点打开浮窗，左侧查看产物内容，右侧查看该产物的 Review。</p><h4>修订与交付</h4><p>提交后的内容和依赖固定。修改产生新的 Artifact，最终交付视图由所选产物的依赖闭包组成。</p>`,
    reviews: [{ id: "review-a2-agent", reviewer: { role: "reviewer", actorId: "traex1" }, time: "13:35", comments: ["当前范围已补入独立模块、模型 Store 和首版前端。建议通过 A → B → C 与修订分支用例验证数据和界面保持一致。"] }]
  },
  {
    id: "artifact-b-mid", label: "B·中间版", name: "存储方案", status: "submitted", tags: ["default", "design"], dependencies: ["artifact-a2"], revisedFrom: "artifact-b1",
    content: `<h3>存储方案</h3><p>这份修订已改为使用新模型 Store，但还没有基于它生产任何下游产物。</p><h4>当前进展</h4><p>上游是修订后的需求 A′。后续方案仍需完善多 Store 写入失败时的处理。</p><p>后续验证报告尚未产出。</p>`, reviews: []
  },
  {
    id: "artifact-b2", label: "B′", name: "存储方案", status: "submitted", tags: ["default", "design"], dependencies: ["artifact-a2"], revisedFrom: "artifact-b-mid",
    content: `<h3>模型 Store 与模块边界</h3><p>基于修订后的需求 A′，将自由探索组织成独立领域模块。首版采用 JSON 文件后端，但持久化通过模型 Store 接口完成。</p><h4>领域服务</h4><ul><li>Run 组织一次探索和最终交付选择。</li><li>Step 承载具体生产工作，由上报自动关联。</li><li>Artifact 保存内容、依赖、标签与修订来源。</li><li>Review 保存针对具体 Artifact 的轻量意见。</li></ul><h4>依赖与标签</h4><p><code>tag:research</code> 在本次上报时展开为具体 Artifact ID，随后标签变化不会改写历史依赖。</p><h4>数据访问</h4><p>新模块通过模型 Store 接口读写，不直接访问物理文件路径。</p>`,
    reviews: [
      { id: "review-b2-human", reviewer: { role: "reviewer", actorId: "actor5" }, time: "13:42", comments: ["这个版本的模块与存储边界符合预期。原型中需要能直接查看产物之间的依赖。", "产物内容与 Review 分栏，查看意见时要能同时对照正文。"] },
      { id: "review-b2-agent", reviewer: { role: "reviewer", actorId: "traex1" }, time: "13:46", comments: ["需要覆盖多 Store 写入失败后的可见状态；不能把部分完成的操作展示成完整成果。"] }
    ]
  },
  {
    id: "artifact-c2", label: "C′", name: "验证报告", status: "submitted", tags: ["default", "verification"], dependencies: ["artifact-b2"], revisedFrom: "artifact-c1",
    content: `<h3>验证报告</h3><p>本轮验证计划如下。</p><h4>需要验证的场景</h4><ul><li>在同一 Run 中生产 A → B → C。</li><li>修改 A，使用旧 B 和新 A′ 重新生产 B′。</li><li>标签快捷选择保存固定 ID 集合。</li><li>点击旧、新产物时，内容与意见不串位。</li><li>完成 Run 后展示选定交付物的依赖图。</li></ul><h4>观察</h4><p>验证记录待补充。</p>`, reviews: []
  }
];
const byId = new Map(artifacts.map(a => [a.id, a]));
const history = createArtifactHistory(artifacts);
const scenarios = [
  { id: "running", name: "上下文控制", status: "running" },
  { id: "delivered", name: "需求迭代", status: "done" },
  { id: "empty", name: "新建运行", status: "running" },
  { id: "error", name: "读取失败" }
];
const runStatusLabels = { running: "运行中", done: "已完成", abandoned: "已废弃" };
const artifactStatusLabels = { draft: "草稿", submitted: "已提交" };
const reviewerNames = { actor5: "billtenor", traex1: "产品" };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function chip(text, accent = false) { return element("span", `cc-chip${accent ? " cc-chip-accent" : ""}`, text); }
function icon(name) {
  const img = element("img"); img.src = `/assets/system-icons/${name}.svg`; img.alt = ""; img.setAttribute("aria-hidden", "true"); return img;
}

export default defineViewPlugin({
  name: "context-control-prototype", apiVersion: 1,
  inject: ["slots", "router", "theme", "ui"], uiVersion: 1, themeVersion: 1,
  apply(ctx) {
    const route = ctx.router.register({ id: "prototype", path: "/", query: ["scenario"] });
    const text = value => ({ text: value });
    const list = ctx.ui.contentList(context => ({
      label: text("运行"),
      header: { eyebrow: text("上下文控制"), title: text("运行") },
      empty: { title: text("暂无运行") },
      sections: [{ id: "scenarios", items: scenarios.map(s => ({
        id: s.id, title: text(s.name), ...(s.status ? { meta: text(runStatusLabels[s.status]) } : {}),
        icon: { kind: "system", name: s.id === "error" ? "warning-circle" : "stack" },
        selected: (context.route.query.scenario || "running") === s.id,
        route: route.to({}, { query: { scenario: s.id } })
      })) }]
    }));

    const main = {
      mount({ element: host }, context) {
        const signal = new AbortController();
        const root = element("section", "cc-prototype"); root.dataset.contextControlPrototype = "";
        const scenario = scenarios.find(s => s.id === context.route.query.scenario)?.id || "running";
        const currentRun = scenarios.find(s => s.id === scenario);
        const disposeTitle = ctx.slots.upsert(slots.headerTitle, {
          id: "title", when: route.activation,
          value: {
            title: text(currentRun.name),
            ...(currentRun.status ? { subtitle: text(runStatusLabels[currentRun.status]) } : {}),
            breadcrumbs: [{ label: text("运行") }, { label: text("原型") }]
          }
        });
        const defaultView = () => history.latest(scenario === "delivered" ? ["artifact-c2"] : undefined);
        let visibleArtifacts = defaultView();
        let selectedVersion = null;
        let graphHost = null;
        let viewLabel = null;
        let returnButton = null;
        let dialog = null;
        let dialogRender = null;
        let previousFocus = null;
        host.append(root);
        function button(label, action, className = "cc-button") {
          const b = element("button", className, label); b.type = "button"; b.addEventListener("click", action, { signal: signal.signal }); return b;
        }
        function closeDialog() {
          dialogRender?.abort(); dialogRender = null;
          const active = dialog; dialog = null;
          if (active) { if (active.open) active.close(); active.remove(); }
          if (previousFocus?.isConnected) previousFocus.focus();
        }
        function updateVersionGraph(id) {
          if (!byId.has(id)) return;
          if (graphHost) {
            visibleArtifacts = history.around(id);
            selectedVersion = id;
            renderGraph(graphHost);
            previousFocus = graphHost.querySelector(`button[data-artifact-id="${id}"]`);
            updateViewLabel();
          }
        }
        function selectVersion(id) {
          if (!byId.has(id)) return;
          closeDialog();
          updateVersionGraph(id);
          previousFocus?.focus();
        }
        function switchDialogVersion(id, action) {
          if (!byId.has(id)) return;
          updateVersionGraph(id);
          openArtifact(id);
          const target = dialog.querySelector(`[data-version-action="${action}"]`);
          (target?.disabled ? dialog.querySelector(".cc-version-select") : target)?.focus();
        }
        function openArtifact(id, origin) {
          const a = byId.get(id); if (!a) return;
          if (origin) previousFocus = origin;
          dialogRender?.abort(); dialogRender = new AbortController();
          if (!dialog) {
            dialog = element("dialog", "cc-dialog");
            dialog.setAttribute("aria-labelledby", "cc-artifact-title");
            dialog.addEventListener("cancel", event => { event.preventDefault(); closeDialog(); }, { signal: signal.signal });
            dialog.addEventListener("click", event => { if (event.target === dialog) { const b = dialog.getBoundingClientRect(); if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) closeDialog(); } }, { signal: signal.signal });
            root.append(dialog);
          }
          dialog.dataset.artifactId = a.id;
          const header = element("header", "cc-modal-head");
          const label = element("div"); label.append(element("div", "cc-modal-kicker", `产物 · ${artifactStatusLabels[a.status]}`));
          const versions = history.versions(a.id);
          const versionIndex = versions.findIndex(v => v.id === a.id);
          const family = history.root(a.id).name;
          const title = element("h2", "", a.name); title.id = "cc-artifact-title"; label.append(title);
          const actions = element("div", "cc-group");
          actions.append(button("关闭", closeDialog)); header.append(label, actions);
          const columns = element("div", "cc-modal-columns");
          const content = element("section", "cc-pane cc-pane-content"); content.setAttribute("aria-label", "产物内容");
          content.append(element("h3", "cc-pane-title", "产物内容"));
          const metadata = element("div", "cc-metadata"); metadata.append(chip(a.id), ...a.tags.map(t => ctx.ui.badge(text(t)))); content.append(metadata);
          const versionBar = element("div", "cc-version-bar");
          const versionLabel = element("label", "", "版本 ");
          const versionSelect = element("select", "cc-version-select"); versionSelect.setAttribute("aria-label", `${family} 的历史版本`);
          [...versions].reverse().forEach(v => {
            const n = versions.indexOf(v) + 1;
            const option = element("option", "", `v${n}${n === versions.length ? " · 最新" : " · 历史"} · ${v.name}`);
            option.value = v.id; option.selected = v.id === a.id; versionSelect.append(option);
          });
          versionSelect.dataset.versionAction = "select";
          versionSelect.addEventListener("change", () => switchDialogVersion(versionSelect.value, "select"), { signal: dialogRender.signal });
          versionLabel.append(versionSelect);
          const older = button("上一版", () => switchDialogVersion(versions[versionIndex - 1].id, "older")); older.disabled = versionIndex === 0; older.dataset.versionAction = "older";
          const newer = button("下一版", () => switchDialogVersion(versions[versionIndex + 1].id, "newer")); newer.disabled = versionIndex === versions.length - 1; newer.dataset.versionAction = "newer";
          versionBar.append(versionLabel, older, newer); content.append(versionBar);
          if (a.dependencies.length) {
            const related = element("div", "cc-related", "依赖：");
            a.dependencies.forEach(dep => related.append(button(`${byId.get(dep).label} · ${byId.get(dep).name}`, () => openArtifact(dep), "cc-text-button")));
            content.append(related);
          }
          const documentBody = element("article", "cc-document"); documentBody.innerHTML = a.content; content.append(documentBody);
          const reviewPane = element("section", "cc-pane cc-pane-review"); reviewPane.setAttribute("aria-label", "评审");
          reviewPane.append(element("h3", "cc-pane-title", `评审 · ${a.reviews.length}`));
          for (const review of a.reviews) {
            const card = element("article", "cc-review-card"); card.dataset.reviewId = review.id;
            const head = element("div", "cc-review-head"); head.append(chip(reviewerNames[review.reviewer.actorId] ?? review.reviewer.actorId), element("time", "", `10 月 22 日 ${review.time}`)); card.append(head);
            if (review.comments.length > 1) {
              const comments = element("ol"); review.comments.forEach(c => comments.append(element("li", "", c))); card.append(comments);
            } else card.append(element("p", "", review.comments[0]));
            card.append(element("div", "cc-review-summary", `${review.comments.length} 条评论`)); reviewPane.append(card);
          }
          if (!a.reviews.length) {
            const empty = element("div", "cc-no-review"); const illustration = element("div", "cc-state-icon"); illustration.append(icon("file-text"));
            empty.append(illustration, element("h3", "", "暂无评审")); reviewPane.append(empty);
          }
          const tabs = element("div", "cc-mobile-tabs");
          const tabContent = button("产物内容", () => selectPane("content"), "cc-toggle");
          const tabReview = button(`评审 · ${a.reviews.length}`, () => selectPane("review"), "cc-toggle"); tabs.append(tabContent, tabReview);
          let selectedPane = "content";
          const media = window.matchMedia("(max-width: 760px)");
          function selectPane(pane) {
            selectedPane = pane;
            tabContent.setAttribute("aria-pressed", String(pane === "content")); tabReview.setAttribute("aria-pressed", String(pane === "review"));
            content.hidden = media.matches && pane !== "content"; reviewPane.hidden = media.matches && pane !== "review";
          }
          media.addEventListener("change", () => selectPane(selectedPane), { signal: dialogRender.signal }); selectPane("content");
          columns.append(content, reviewPane);
          dialog.replaceChildren(header, tabs, columns);
          if (!dialog.open) dialog.showModal();
        }

        function updateViewLabel() {
          if (!viewLabel) return;
          if (selectedVersion) {
            const versions = history.versions(selectedVersion);
            const index = versions.findIndex(v => v.id === selectedVersion);
            viewLabel.textContent = `${history.root(selectedVersion).name} · v${index + 1}`;
          } else viewLabel.textContent = scenario === "delivered" ? "最终交付物" : "";
          returnButton.hidden = !selectedVersion;
        }
        function renderGraph(container) {
          container.replaceChildren();
          const visible = visibleArtifacts;
          const graph = element("div", "cc-graph");
          const depths = new Map();
          const rows = new Map();
          const positions = new Map();
          for (const a of visible) {
            const depth = Math.max(0, ...a.dependencies.map(dep => (depths.get(dep) ?? -1) + 1));
            const row = rows.get(depth) ?? 0;
            depths.set(a.id, depth); rows.set(depth, row + 1);
            positions.set(a.id, { x: 30 + depth * 300, y: 70 + row * 250 });
          }
          graph.style.width = `${Math.max(890, 290 + Math.max(0, ...depths.values()) * 300)}px`;
          graph.style.height = `${Math.max(330, 80 + Math.max(1, ...rows.values()) * 250)}px`;
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("aria-hidden", "true");
          const defs = document.createElementNS(svg.namespaceURI, "defs");
          const marker = document.createElementNS(svg.namespaceURI, "marker"); marker.id = "cc-arrow"; marker.setAttribute("viewBox", "0 0 10 10"); marker.setAttribute("refX", "8"); marker.setAttribute("refY", "5"); marker.setAttribute("markerWidth", "5"); marker.setAttribute("markerHeight", "5"); marker.setAttribute("orient", "auto");
          const arrow = document.createElementNS(svg.namespaceURI, "path"); arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z"); arrow.setAttribute("fill", "currentColor"); marker.style.color = "var(--mem-view-color-accent)"; marker.append(arrow); defs.append(marker); svg.append(defs);
          for (const a of visible) {
            const to = positions.get(a.id);
            for (const dep of a.dependencies) {
              const from = positions.get(dep); if (!from) continue;
              const line = document.createElementNS(svg.namespaceURI, "path"); line.setAttribute("class", "cc-edge"); line.setAttribute("d", `M ${from.x + 226} ${from.y + 73} C ${from.x + 265} ${from.y + 73}, ${to.x - 38} ${to.y + 73}, ${to.x - 7} ${to.y + 73}`); line.setAttribute("marker-end", "url(#cc-arrow)"); line.dataset.dependency = `${dep}:${a.id}`; svg.append(line);
            }
          }
          graph.append(svg);
          for (const a of visible) {
            const pos = positions.get(a.id);
            const versions = history.versions(a.id);
            const versionIndex = versions.findIndex(v => v.id === a.id);
            const stack = element("div", "cc-node-stack"); stack.style.left = `${pos.x}px`; stack.style.top = `${pos.y}px`;
            stack.dataset.hasHistory = String(versions.length > 1);
            const node = button("", () => openArtifact(a.id, node), "cc-node");
            node.dataset.artifactId = a.id; node.dataset.selected = String(selectedVersion === a.id);
            const family = history.root(a.id).name;
            node.setAttribute("aria-label", `查看 ${family} v${versionIndex + 1} ${a.name}`);
            const version = element("div", "cc-node-version", `v${versionIndex + 1}${versionIndex === versions.length - 1 ? " · 最新" : " · 历史"}`);
            const tags = element("div", "cc-node-tags"); a.tags.filter(t => t !== "default").forEach(t => tags.append(ctx.ui.badge(text(t))));
            const count = a.reviews.reduce((n, r) => n + r.comments.length, 0);
            const footer = element("div", "cc-node-footer"); footer.append(element("span", "", artifactStatusLabels[a.status]), element("span", "", `${count} 条评论`));
            node.append(version, element("strong", "", a.name), tags, footer); stack.append(node);
            if (versions.length > 1) {
              const details = element("details", "cc-history");
              const summary = element("summary", "", `历史版本 · ${versions.length - 1}`); summary.setAttribute("aria-label", `查看 ${family} 的历史版本`);
              const menu = element("div", "cc-history-menu");
              [...versions].reverse().forEach(v => {
                const n = versions.indexOf(v) + 1;
                const entry = button(`v${n}${n === versions.length ? " · 最新" : ""} · ${v.name}`, () => selectVersion(v.id), "cc-history-option");
                entry.setAttribute("aria-current", String(v.id === a.id)); menu.append(entry);
              });
              details.append(summary, menu); stack.append(details);
            }
            graph.append(stack);
          }
          container.append(graph);
        }

        if (scenario === "empty" || scenario === "error") {
          const state = element("div", "cc-state cc-graph-card"); const picture = element("div", "cc-state-icon"); picture.append(icon(scenario === "error" ? "warning-circle" : "stack"));
          state.append(picture, element("h2", "", scenario === "error" ? "读取失败" : "暂无产物"));
          if (scenario === "error") state.append(button("重试", () => ctx.router.navigate(route.to({}, { query: { scenario: "running" } }))));
          root.append(state);
        } else {
          const toolbar = element("div", "cc-toolbar");
          const info = element("div", "cc-group");
          viewLabel = element("span", "cc-toolbar-label");
          info.append(element("strong", "", "产物"), viewLabel); toolbar.append(info);
          graphHost = element("div", "cc-canvas-scroll");
          returnButton = button(scenario === "delivered" ? "回到交付视图" : "回到最新", () => {
            closeDialog(); selectedVersion = null; visibleArtifacts = defaultView(); renderGraph(graphHost); updateViewLabel();
          });
          toolbar.append(returnButton); updateViewLabel(); root.append(toolbar);
          const card = element("section", "cc-graph-card"); card.setAttribute("aria-label", "产物依赖图");
          renderGraph(graphHost); card.append(graphHost); root.append(card);
        }
        return () => { closeDialog(); signal.abort(); disposeTitle(); root.remove(); };
      }
    };
    ctx.slots.register(slots.navigationPrimary, { id: "navigation", order: 85, value: { label: text("上下文控制"), icon: { kind: "system", name: "stack" }, route: route.to() } });
    ctx.slots.register(slots.headerTitle, { id: "title", when: route.activation, value: { title: text("上下文控制"), breadcrumbs: [{ label: text("运行") }] } });
    ctx.slots.register(slots.contentList, { id: "list", when: route.activation, value: list });
    ctx.slots.register(slots.mainView, { id: "page", key: route.key, when: route.activation, value: main });
  }
});
