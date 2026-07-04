export const browserHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>vibe-mem</title>
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
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    button, input, textarea { font: inherit; }
    button { cursor: pointer; }
    .shell { display: grid; grid-template-columns: 300px minmax(0, 1fr) 360px; min-height: 100vh; }
    .sidebar, .review { background: #fbfbf8; border-color: var(--line); overflow: auto; height: 100vh; position: sticky; top: 0; }
    .sidebar { border-right: 1px solid var(--line); padding: 16px; }
    .review { border-left: 1px solid var(--line); padding: 16px; }
    .brand, .review-head, .toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .brand h1, .review-head h2, .title { margin: 0; letter-spacing: 0; }
    .brand h1 { font-size: 18px; }
    .count, .muted, .subtitle, .review-sub { color: var(--muted); }
    .count { font-size: 12px; }
    .search, textarea { width: 100%; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); outline: none; }
    .search { margin: 14px 0 16px; padding: 9px 10px; }
    textarea { min-height: 92px; resize: vertical; padding: 10px; }
    .search:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(40, 108, 103, .12); }
    .kind { margin: 14px 0 6px; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .08em; }
    .memory-list, .review-list, .comment-list, .flow { display: grid; gap: 8px; }
    .memory-button, .review-card { width: 100%; text-align: left; border: 0; border-radius: 6px; background: transparent; color: var(--text); padding: 8px 9px; }
    .memory-button:hover, .review-card:hover { background: #eceee8; }
    .memory-button.active, .review-card.active { background: var(--accent-soft); color: #173f3c; font-weight: 700; }
    .review-card { border: 1px solid var(--line); background: var(--surface); border-radius: 8px; box-shadow: var(--shadow); }
    .review-card b { display: block; overflow-wrap: anywhere; margin-bottom: 4px; }
    .content { min-width: 0; padding: 22px 28px 48px; }
    .toolbar { margin-bottom: 18px; }
    .toolbar-actions, .comment-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .title { font-size: 26px; line-height: 1.2; }
    .subtitle { margin-top: 7px; font-size: 13px; overflow-wrap: anywhere; }
    .btn { border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); padding: 7px 10px; }
    .btn:hover { border-color: var(--accent); }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn.danger { color: var(--danger); }
    .btn:disabled { opacity: .55; cursor: not-allowed; }
    .empty, .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow); }
    .empty { padding: 24px; color: var(--muted); }
    .panel { padding: 12px; margin: 12px 0; }
    .meta { display: flex; gap: 8px; flex-wrap: wrap; margin: 13px 0 18px; }
    .pill { border: 1px solid var(--line); background: var(--surface); color: var(--muted); border-radius: 999px; padding: 3px 8px; font-size: 12px; }
    .pill.strong { color: #173f3c; border-color: #b8cbc7; background: #edf6f3; }
    .pill.warn { color: var(--warn); background: #fbf2e8; border-color: #ead2b7; }
    .pill.processing { color: var(--accent); background: #edf6f3; border-color: #b8cbc7; }
    .pill.done { color: var(--ok); background: #edf6f0; border-color: #b8d8c5; }
    .pill.outdated { color: var(--danger); background: #fbefed; border-color: #e5bcb5; }
    .section { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow); margin: 10px 0; overflow: hidden; }
    .section-header { width: 100%; border: 0; background: transparent; text-align: left; display: grid; grid-template-columns: 22px minmax(0, 1fr) auto auto; align-items: center; gap: 8px; padding: 12px 14px; color: var(--text); }
    .section-header:hover { background: #f4f5f1; }
    .chevron { color: var(--muted); transition: transform 120ms ease; }
    .section.open > .section-header .chevron { transform: rotate(90deg); }
    .node-title { overflow-wrap: anywhere; font-weight: 700; }
    .section-body { display: none; border-top: 1px solid var(--line); padding: 12px 14px 14px; }
    .section.open > .section-body { display: block; }
    .block-title { margin: 12px 0 6px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; font-weight: 700; }
    .text-list { margin: 0; padding-left: 18px; }
    .text-list li { margin: 5px 0; white-space: pre-wrap; }
    .commentable { position: relative; display: block; margin: 4px 0; width: 100%; }
    .review-active .commentable { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 7px; align-items: flex-start; }
    .commentable-body { min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .inline-plus, .target-add { border: 1px solid var(--line); border-radius: 999px; background: #fff; color: var(--muted); padding: 0; }
    .inline-plus { width: 20px; height: 20px; line-height: 16px; opacity: 0; transition: opacity 120ms ease, border-color 120ms ease, color 120ms ease; }
    .target-add { width: 24px; height: 24px; }
    .review-active .commentable:hover .inline-plus, .review-active .field-table th:hover .inline-plus, .review-active .inline-plus:focus { opacity: 1; }
    .inline-plus:hover, .target-add:hover { border-color: var(--accent); color: var(--accent); }
    body:not(.review-active) .target-add, body:not(.review-active) .inline-plus { display: none; }
    .inline-comment-editor { grid-column: 2; border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 10px; box-shadow: var(--shadow); margin-top: 8px; width: 100%; }
    .inline-comment-editor textarea { margin-bottom: 8px; }
    .thread-edit-editor { grid-column: auto; margin: 2px 0 0; }
    .child-stack { margin-top: 12px; }
    .field-table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
    .field-table th, .field-table td { border-bottom: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; white-space: pre-wrap; }
    .field-table th { width: 220px; background: #f3f5f0; font-weight: 700; }
    .flow-item { border: 1px solid var(--line); border-left: 4px solid #a7b0a5; background: var(--surface); border-radius: 8px; padding: 10px 12px; box-shadow: var(--shadow); white-space: pre-wrap; }
    .flow-item.call { border-left-color: var(--accent); background: #f2f8f6; }
    .flow-item.branch { border-left-color: var(--warn); background: #fbf7f0; }
    .flow-label { color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 5px; }
    .flow-condition { font-weight: 700; margin-bottom: 7px; }
    .flow-children { margin-left: 14px; padding-left: 14px; border-left: 1px solid var(--line); display: grid; gap: 8px; }
    .call-link { color: var(--accent); text-decoration: none; font-weight: 700; }
    .call-link:hover { text-decoration: underline; }
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
    code { background: var(--soft); border-radius: 4px; padding: 1px 4px; }
    @media (max-width: 1100px) {
      .shell { grid-template-columns: 280px minmax(0, 1fr); }
      .review { grid-column: 1 / -1; height: auto; position: static; border-left: 0; border-top: 1px solid var(--line); }
    }
    @media (max-width: 760px) {
      .shell { grid-template-columns: 1fr; }
      .sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
      .content { padding: 18px 16px 36px; }
      .toolbar { flex-direction: column; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <aside class="sidebar">
      <div class="brand"><h1>vibe-mem</h1><span class="count" id="count">Loading</span></div>
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
          <button class="btn" id="refresh">Refresh</button>
        </div>
      </div>
      <div id="detail" class="empty">Loading...</div>
    </section>

    <aside class="review">
      <div class="review-head">
        <div>
          <h2>Review</h2>
          <div class="review-sub" id="review-label">Create or select a review to comment inline</div>
        </div>
        <button class="btn primary" id="create-review">Create Review</button>
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
    const selectedReviewKey = "vibe-mem.selectedReview.v2";
    const state = {
      payload: null,
      memories: [],
      filtered: [],
      selectedId: null,
      selectedReviewId: localStorage.getItem(selectedReviewKey) || null,
      byName: new Map(),
      reviews: [],
      renderLine: 0
    };

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
      reviewLabel: document.getElementById("review-label")
    };

    document.getElementById("expand").addEventListener("click", () => setAllSections(true));
    document.getElementById("collapse").addEventListener("click", () => setAllSections(false));
    document.getElementById("refresh").addEventListener("click", () => loadAll());
    document.getElementById("create-review").addEventListener("click", createReview);
    el.submitReview.addEventListener("click", submitReview);
    el.search.addEventListener("input", () => {
      applyFilter();
      renderNav();
    });

    loadAll();

    async function loadAll() {
      await Promise.all([loadMemories(), loadReviews()]);
      renderAll();
    }

    async function loadMemories() {
      el.detail.className = "empty";
      el.detail.textContent = "Loading...";
      const response = await fetch("/api/memories");
      if (!response.ok) throw new Error(await response.text());
      state.payload = await response.json();
      state.memories = state.payload.memories;
      state.byName = new Map();
      for (const memory of state.memories) {
        for (const name of memory.entity.names || []) state.byName.set(name, memory);
      }
      applyFilter();
      el.count.textContent = state.memories.length + " memories";
      if (!state.selectedId && state.filtered[0]) state.selectedId = state.filtered[0].id;
    }

    async function loadReviews() {
      const response = await fetch("/api/reviews");
      if (!response.ok) throw new Error(await response.text());
      state.reviews = (await response.json()).reviews || [];
      if (!state.reviews.some(review => review.id === state.selectedReviewId)) {
        state.selectedReviewId = state.reviews[0]?.id || null;
        saveSelectedReview();
      }
    }

    function renderAll() {
      document.body.classList.toggle("review-active", canComment());
      renderNav();
      renderSelected();
      renderReview();
    }

    function applyFilter() {
      const q = el.search.value.trim().toLowerCase();
      state.filtered = state.memories.filter((memory) => {
        if (!q) return true;
        return [memory.kind, ...(memory.entity.names || [])].join(" ").toLowerCase().includes(q);
      });
    }

    function renderNav() {
      el.nav.innerHTML = "";
      for (const kind of kindOrder) {
        const group = state.filtered.filter((memory) => memory.kind === kind);
        if (!group.length) continue;
        const label = document.createElement("div");
        label.className = "kind";
        label.textContent = kind;
        el.nav.append(label);
        const list = document.createElement("div");
        list.className = "memory-list";
        for (const memory of group) {
          const button = document.createElement("button");
          button.className = "memory-button" + (memory.id === state.selectedId ? " active" : "");
          button.textContent = primaryName(memory.entity);
          button.title = primaryName(memory.entity);
          button.addEventListener("click", () => {
            state.selectedId = memory.id;
            renderAll();
          });
          list.append(button);
        }
        el.nav.append(list);
      }
    }

    function selectedMemory() {
      return state.memories.find((item) => item.id === state.selectedId) || state.filtered[0];
    }

    function selectedReview() {
      return state.reviews.find(review => review.id === state.selectedReviewId) || null;
    }

    function canComment() {
      const status = selectedReview()?.status;
      return status === "draft" || status === "submitted";
    }

    function renderSelected() {
      const memory = selectedMemory();
      if (!memory) {
        el.title.textContent = "No memories";
        el.subtitle.textContent = "";
        el.detail.className = "empty";
        el.detail.textContent = "No memory entities found.";
        return;
      }
      state.selectedId = memory.id;
      el.title.textContent = primaryName(memory.entity);
      el.subtitle.textContent = memory.kind + " / " + primaryName(memory.entity);
      el.detail.className = "";
      el.detail.innerHTML = "";
      state.renderLine = 0;
      el.detail.append(renderMeta(memory));
      if (memory.kind === "schemas") el.detail.append(renderSchema(memory.entity, 0, primaryName(memory.entity)));
      else if (memory.kind === "procedures") el.detail.append(renderProcedure(memory.entity));
      else el.detail.append(renderGeneric(memory.entity));
    }

    function primaryName(entity) {
      return entity && Array.isArray(entity.names) && entity.names.length ? entity.names[0] : "(unnamed)";
    }

    function renderMeta(memory) {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.append(pill(memory.entity.tag || memory.kind, true));
      if (memory.entity.format) meta.append(pill("format: " + memory.entity.format));
      for (const name of (memory.entity.names || []).slice(1)) meta.append(pill(name));
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
      box.append(sectionHeader(primaryName(entity), entity.tag || "memory", primaryName(entity), "section:" + primaryName(entity)));
      const body = document.createElement("div");
      body.className = "section-body";
      appendTextBlocks(body, entity);
      box.append(body);
      return box;
    }

    function renderSchema(node, depth, path) {
      const section = document.createElement("div");
      section.className = "section" + (depth < 2 ? " open" : "");
      const badge = node.format ? "format: " + node.format : (node.fields && node.fields.length ? node.fields.length + " fields" : "field");
      section.append(sectionHeader(primaryName(node), badge, path, "schema:" + path));
      const body = document.createElement("div");
      body.className = "section-body";
      appendTextBlocks(body, node);
      if (node.format === "table") body.append(renderTableFields(node.fields || [], path));
      else if (node.fields && node.fields.length) {
        const children = document.createElement("div");
        children.className = "child-stack";
        for (const child of node.fields) children.append(renderSchema(child, depth + 1, path + " > " + primaryName(child)));
        body.append(children);
      }
      section.append(body);
      return section;
    }

    function sectionHeader(text, badge, target, anchor) {
      const location = nextLocation(anchor || "section:" + target);
      const button = document.createElement("button");
      button.className = "section-header";
      button.dataset.anchor = location.anchor;
      button.id = domIdForAnchor(location.anchor);
      button.innerHTML = '<span class="chevron">›</span><span class="node-title"></span><span class="pill"></span>';
      button.querySelector(".node-title").textContent = text;
      button.querySelector(".pill").textContent = badge;
      const count = commentsForAnchor(location.anchor, text).length;
      if (count) button.append(pill(count + " comments", false, "warn"));
      const targetButton = document.createElement("span");
      targetButton.className = "target-add";
      targetButton.textContent = "+";
      targetButton.title = "Add review comment";
      targetButton.addEventListener("click", (event) => {
        event.stopPropagation();
        openInlineEditor(button.parentElement, target || text, text, withLocationHash(location, text));
      });
      button.append(targetButton);
      button.addEventListener("click", () => button.parentElement.classList.toggle("open"));
      return button;
    }

    function appendTextBlocks(target, node) {
      appendList(target, "defines", node.defines, "defines");
      appendList(target, "asserts", node.asserts, "asserts");
    }

    function appendList(target, heading, values, key) {
      if (!values || !values.length) return;
      const title = document.createElement("div");
      title.className = "block-title";
      title.textContent = heading;
      const list = document.createElement("ul");
      list.className = "text-list";
      values.forEach((value, index) => {
        const item = document.createElement("li");
        const label = heading + "[" + (index + 1) + "]";
        item.append(commentable(value, label, value, key + "[" + (index + 1) + "]"));
        list.append(item);
      });
      target.append(title, list);
    }

    function renderTableFields(fields, path) {
      const table = document.createElement("table");
      table.className = "field-table";
      const body = document.createElement("tbody");
      for (const field of fields) {
        const row = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = primaryName(field);
        const fieldTarget = path + " > " + primaryName(field);
        const fieldAnchor = "field:" + fieldTarget;
        const fieldLocation = nextLocation(fieldAnchor);
        th.dataset.anchor = fieldLocation.anchor;
        th.append(commentButton(fieldTarget, primaryName(field), withLocationHash(fieldLocation, primaryName(field))));
        const td = document.createElement("td");
        const parts = [];
        if (field.defines && field.defines.length) parts.push(field.defines.join("\n"));
        if (field.asserts && field.asserts.length) parts.push(field.asserts.join("\n"));
        const snapshot = parts.join("\n\n") || "Column";
        td.append(commentable(snapshot, fieldTarget, snapshot, fieldAnchor + ":body"));
        row.append(th, td);
        body.append(row);
      }
      table.append(body);
      return table;
    }

    function renderProcedure(entity) {
      const wrap = document.createElement("div");
      appendTextBlocks(wrap, entity);
      if (entity.goals && entity.goals.length) appendList(wrap, "goals", entity.goals, "goals");
      const title = document.createElement("div");
      title.className = "block-title";
      title.textContent = "flow";
      const flow = document.createElement("div");
      flow.className = "flow";
      for (const [index, step] of (entity.flow || []).entries()) flow.append(renderFlowStep(step, "flow[" + (index + 1) + "]"));
      wrap.append(title, flow);
      return wrap;
    }

    function renderFlowStep(step, anchor) {
      if (typeof step === "string") return flowItem(commentable(step, anchor, step, anchor));
      if (!step || typeof step !== "object") return flowItem(commentable(String(step), anchor, String(step), anchor));
      if (step.tag === "!call") return renderCall(step.value, anchor);
      if (step.tag === "!if" || step.tag === "!elseif" || step.tag === "!else" || step.tag === "!while") return renderBranch(step, anchor);
      const text = JSON.stringify(step, null, 2);
      return flowItem(commentable(text, anchor, text, anchor));
    }

    function flowItem(child) {
      const item = document.createElement("div");
      item.className = "flow-item";
      item.append(child);
      return item;
    }

    function renderCall(name, anchor) {
      const item = document.createElement("div");
      item.className = "flow-item call";
      const label = document.createElement("div");
      label.className = "flow-label";
      label.textContent = "call";
      const link = document.createElement("a");
      link.className = "call-link";
      link.textContent = name;
      link.addEventListener("click", () => {
        const target = state.byName.get(name);
        if (target) {
          state.selectedId = target.id;
          renderAll();
        }
      });
      item.append(label, commentable(link, "!call " + name, String(name), anchor));
      return item;
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

    function commentable(content, target, snapshot, anchor) {
      const location = nextLocation(anchor || target);
      const locationWithHash = withLocationHash(location, snapshot);
      const wrap = document.createElement("div");
      wrap.className = "commentable";
      wrap.dataset.anchor = location.anchor;
      wrap.id = domIdForAnchor(location.anchor);
      wrap.append(commentButton(target, snapshot, locationWithHash));
      const body = document.createElement("div");
      body.className = "commentable-body";
      if (content instanceof Node) body.append(content);
      else body.textContent = String(content);
      wrap.append(body);
      const thread = renderInlineThread(location.anchor, snapshot);
      if (thread) wrap.append(thread);
      return wrap;
    }

    function commentButton(target, snapshot, location) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "inline-plus";
      button.textContent = "+";
      button.title = "Add review comment";
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        openInlineEditor(button.parentElement, target, snapshot, location);
      });
      return button;
    }

    function openInlineEditor(host, target, snapshot, location) {
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
      save.addEventListener("click", async () => {
        const body = textarea.value.trim();
        if (!body) {
          textarea.focus();
          return;
        }
        await addComment(target, snapshot, body, location);
        editor.remove();
      });
      cancel.addEventListener("click", () => editor.remove());
      actions.append(save, cancel);
      editor.append(textarea, actions);
      host.append(editor);
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

    function commentsForAnchor(anchor, snapshot) {
      const review = selectedReview();
      const memory = selectedMemory();
      if (!review || !memory) return [];
      return review.comments.filter(comment => {
        if (comment.memoryId !== memory.id) return false;
        const anchorMatches = comment.location?.anchor ? comment.location.anchor === anchor : comment.target === anchor;
        if (!anchorMatches) return false;
        if (!comment.location?.hash) return true;
        return comment.location.hash === hashSnapshot(snapshot);
      });
    }

    function renderInlineThread(anchor, snapshot) {
      const comments = commentsForAnchor(anchor, snapshot);
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
        if (canComment()) {
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
      save.addEventListener("click", async () => {
        const body = textarea.value.trim();
        if (!body) {
          textarea.focus();
          return;
        }
        await updateComment(comment.id, body);
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

    function setAllSections(open) {
      for (const section of el.detail.querySelectorAll(".section")) section.classList.toggle("open", open);
    }

    async function createReview() {
      const response = await fetch("/api/reviews", { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      const review = (await response.json()).review;
      state.reviews.unshift(review);
      state.selectedReviewId = review.id;
      saveSelectedReview();
      renderAll();
    }

    async function addComment(target, snapshot, body, location) {
      const memory = selectedMemory();
      const review = selectedReview();
      if (!memory || !review || !canComment()) return;
      const comments = review.comments.concat({
        id: uuid(),
        memoryId: memory.id,
        memoryName: primaryName(memory.entity),
        kind: memory.kind,
        target: String(target || "").trim(),
        location,
        snapshot: snapshot === undefined ? undefined : String(snapshot),
        body,
        createdAt: new Date().toISOString()
      });
      await patchReview(review.id, { comments });
    }

    async function removeComment(id) {
      const review = selectedReview();
      if (!review || !canComment()) return;
      await patchReview(review.id, { comments: review.comments.filter(comment => comment.id !== id) });
    }

    async function updateComment(id, body) {
      const review = selectedReview();
      if (!review || !canComment()) return;
      await patchReview(review.id, {
        comments: review.comments.map(comment => comment.id === id ? { ...comment, body } : comment)
      });
    }

    async function submitReview() {
      const review = selectedReview();
      if (!review || review.status !== "draft" || !review.comments.length) return;
      await patchReview(review.id, { status: "submitted" });
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
      const review = selectedReview();
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
        title.textContent = comment.memoryName + (comment.target ? " · " + comment.target : "");
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
        open.textContent = "Open";
        open.addEventListener("click", () => {
          state.selectedId = comment.memoryId;
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

    function scrollToComment(comment) {
      if (isCommentOutdated(comment)) return;
      const anchor = comment.location?.anchor || comment.target || "";
      const target = document.getElementById(domIdForAnchor(anchor)) || document.querySelector('[data-anchor="' + CSS.escape(anchor) + '"]');
      if (target) {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }

    function editCommentInDocument(comment) {
      state.selectedId = comment.memoryId;
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
      return comment.location?.line ? "Line " + comment.location.line : "Unanchored";
    }

    function isCommentOutdated(comment) {
      if (!comment.location?.hash) return false;
      const memory = selectedMemory();
      if (!memory || memory.id !== comment.memoryId) return false;
      const node = document.querySelector('[data-anchor="' + CSS.escape(comment.location.anchor) + '"] .commentable-body');
      if (!node) return true;
      return hashSnapshot(node.textContent || "") !== comment.location.hash;
    }

    function renderReviewList() {
      el.reviews.innerHTML = "";
      if (!state.reviews.length) return;
      for (const review of state.reviews) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "review-card" + (review.id === state.selectedReviewId ? " active" : "");
        const title = document.createElement("b");
        title.textContent = review.title || review.id;
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.style.margin = "0";
        meta.append(pill(review.status, false, statusPillClass(review.status)));
        meta.append(pill(review.comments.length + " comments"));
        button.append(title, meta);
        button.addEventListener("click", () => {
          state.selectedReviewId = review.id;
          saveSelectedReview();
          renderAll();
        });
        el.reviews.append(button);
      }
    }

    function statusPillClass(status) {
      if (status === "done") return "done";
      if (status === "processing") return "processing";
      if (status === "draft") return "warn";
      return "";
    }

    function saveSelectedReview() {
      if (state.selectedReviewId) localStorage.setItem(selectedReviewKey, state.selectedReviewId);
      else localStorage.removeItem(selectedReviewKey);
    }

    function uuid() {
      if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
      return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }
  </script>
</body>
</html>`;
