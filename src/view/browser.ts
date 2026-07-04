export const browserHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>vibe-mem</title>
  <style>
    :root {
      --bg: #f7f7f4;
      --panel: #ffffff;
      --text: #222426;
      --muted: #6d7278;
      --line: #d9ddd8;
      --accent: #2f6f6d;
      --accent-2: #8a5a2b;
      --warn: #9a4b35;
      --code: #eef1ed;
      --shadow: 0 1px 2px rgba(25, 30, 35, 0.08);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    button,
    input {
      font: inherit;
    }

    .app {
      display: grid;
      grid-template-columns: 300px minmax(0, 1fr);
      min-height: 100vh;
    }

    .sidebar {
      border-right: 1px solid var(--line);
      background: #fbfbf8;
      padding: 16px;
      overflow: auto;
      position: sticky;
      top: 0;
      height: 100vh;
    }

    .brand {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }

    .brand h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0;
    }

    .count {
      color: var(--muted);
      font-size: 12px;
    }

    .search {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      padding: 9px 10px;
      color: var(--text);
      outline: none;
      margin-bottom: 16px;
    }

    .search:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(47, 111, 109, 0.12);
    }

    .kind {
      margin: 14px 0 6px;
      color: var(--muted);
      text-transform: uppercase;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
    }

    .memory-list {
      display: grid;
      gap: 4px;
    }

    .memory-button {
      width: 100%;
      text-align: left;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--text);
      padding: 8px 9px;
      cursor: pointer;
    }

    .memory-button:hover {
      background: #eceee8;
    }

    .memory-button.active {
      background: #dfe8e4;
      color: #163d3b;
      font-weight: 700;
    }

    .content {
      min-width: 0;
      padding: 22px 28px 48px;
    }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }

    .toolbar-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .icon-button {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      padding: 7px 10px;
      cursor: pointer;
    }

    .icon-button:hover {
      border-color: var(--accent);
    }

    .title {
      margin: 0;
      font-size: 26px;
      line-height: 1.2;
      letter-spacing: 0;
    }

    .subtitle {
      margin-top: 7px;
      color: var(--muted);
      font-size: 13px;
      word-break: break-word;
    }

    .empty {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 24px;
      color: var(--muted);
      box-shadow: var(--shadow);
    }

    .meta {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin: 13px 0 18px;
    }

    .pill {
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--muted);
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 12px;
    }

    .pill.strong {
      color: #163d3b;
      border-color: #b9cbc6;
      background: #ecf4f1;
    }

    .section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      margin: 10px 0;
      overflow: hidden;
    }

    .section-header {
      width: 100%;
      border: 0;
      background: transparent;
      text-align: left;
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      padding: 12px 14px;
      cursor: pointer;
      color: var(--text);
    }

    .section-header:hover {
      background: #f4f5f1;
    }

    .chevron {
      color: var(--muted);
      transform: rotate(0deg);
      transition: transform 120ms ease;
    }

    .section.open > .section-header .chevron {
      transform: rotate(90deg);
    }

    .node-title {
      overflow-wrap: anywhere;
      font-weight: 700;
    }

    .section-body {
      display: none;
      border-top: 1px solid var(--line);
      padding: 12px 14px 14px;
    }

    .section.open > .section-body {
      display: block;
    }

    .block-title {
      margin: 12px 0 6px;
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
    }

    .text-list {
      margin: 0;
      padding-left: 18px;
    }

    .text-list li {
      margin: 5px 0;
      white-space: pre-wrap;
    }

    .child-stack {
      margin-top: 12px;
    }

    .field-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 6px;
      overflow: hidden;
    }

    .field-table th,
    .field-table td {
      border-bottom: 1px solid var(--line);
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }

    .field-table th {
      width: 220px;
      background: #f3f5f0;
      font-weight: 700;
    }

    .flow {
      display: grid;
      gap: 8px;
    }

    .flow-item {
      border: 1px solid var(--line);
      border-left: 4px solid #a7b0a5;
      background: var(--panel);
      border-radius: 8px;
      padding: 10px 12px;
      box-shadow: var(--shadow);
    }

    .flow-item.call {
      border-left-color: var(--accent);
      background: #f2f8f6;
    }

    .flow-item.branch {
      border-left-color: var(--accent-2);
      background: #fbf7f0;
    }

    .flow-item.loop {
      border-left-color: var(--warn);
      background: #fbf3f0;
    }

    .flow-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 5px;
    }

    .flow-condition {
      font-weight: 700;
      margin-bottom: 7px;
    }

    .flow-children {
      margin-left: 14px;
      padding-left: 14px;
      border-left: 1px dashed var(--line);
      display: grid;
      gap: 8px;
    }

    .call-link {
      color: var(--accent);
      text-decoration: none;
      font-weight: 700;
      cursor: pointer;
    }

    .call-link:hover {
      text-decoration: underline;
    }

    code {
      background: var(--code);
      border-radius: 4px;
      padding: 1px 4px;
    }

    @media (max-width: 820px) {
      .app {
        grid-template-columns: 1fr;
      }

      .sidebar {
        position: static;
        height: auto;
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }

      .content {
        padding: 18px 16px 36px;
      }

      .toolbar {
        align-items: flex-start;
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <main class="app">
    <aside class="sidebar">
      <div class="brand">
        <h1>vibe-mem</h1>
        <span class="count" id="count">Loading</span>
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
          <button class="icon-button" id="expand">Expand all</button>
          <button class="icon-button" id="collapse">Collapse all</button>
          <button class="icon-button" id="refresh">Refresh</button>
        </div>
      </div>
      <div id="detail" class="empty">Loading...</div>
    </section>
  </main>

  <script>
    const kindOrder = ["procedures", "schemas", "concepts", "statements"];
    const state = {
      payload: null,
      memories: [],
      filtered: [],
      selectedId: null,
      byName: new Map()
    };

    const nav = document.getElementById("nav");
    const detail = document.getElementById("detail");
    const title = document.getElementById("title");
    const subtitle = document.getElementById("subtitle");
    const count = document.getElementById("count");
    const search = document.getElementById("search");

    document.getElementById("expand").addEventListener("click", () => setAllSections(true));
    document.getElementById("collapse").addEventListener("click", () => setAllSections(false));
    document.getElementById("refresh").addEventListener("click", load);
    search.addEventListener("input", () => {
      applyFilter();
      renderNav();
    });

    load();

    async function load() {
      detail.className = "empty";
      detail.textContent = "Loading...";
      const response = await fetch("/api/memories");
      if (!response.ok) throw new Error(await response.text());
      state.payload = await response.json();
      state.memories = state.payload.memories;
      state.byName = new Map();
      for (const memory of state.memories) {
        const names = memory.entity.names || [];
        for (const name of names) state.byName.set(name, memory);
      }
      applyFilter();
      count.textContent = state.memories.length + " memories";
      if (!state.selectedId && state.filtered[0]) state.selectedId = state.filtered[0].id;
      renderNav();
      renderSelected();
    }

    function applyFilter() {
      const q = search.value.trim().toLowerCase();
      state.filtered = state.memories.filter((memory) => {
        if (!q) return true;
        const haystack = [memory.kind, ...(memory.entity.names || [])].join(" ").toLowerCase();
        return haystack.includes(q);
      });
    }

    function renderNav() {
      nav.innerHTML = "";
      for (const kind of kindOrder) {
        const group = state.filtered.filter((memory) => memory.kind === kind);
        if (!group.length) continue;
        const label = document.createElement("div");
        label.className = "kind";
        label.textContent = kind;
        nav.append(label);
        const list = document.createElement("div");
        list.className = "memory-list";
        for (const memory of group) {
          const button = document.createElement("button");
          button.className = "memory-button" + (memory.id === state.selectedId ? " active" : "");
          button.textContent = primaryName(memory.entity);
          button.title = primaryName(memory.entity);
          button.addEventListener("click", () => {
            state.selectedId = memory.id;
            renderNav();
            renderSelected();
          });
          list.append(button);
        }
        nav.append(list);
      }
    }

    function renderSelected() {
      const memory = state.memories.find((item) => item.id === state.selectedId) || state.filtered[0];
      if (!memory) {
        title.textContent = "No memories";
        subtitle.textContent = "";
        detail.className = "empty";
        detail.textContent = "No memory entities found.";
        return;
      }
      state.selectedId = memory.id;
      title.textContent = primaryName(memory.entity);
      subtitle.textContent = memory.kind + " / " + primaryName(memory.entity);
      detail.className = "";
      detail.innerHTML = "";
      detail.append(renderMeta(memory));
      if (memory.kind === "schemas") detail.append(renderSchema(memory.entity, 0));
      else if (memory.kind === "procedures") detail.append(renderProcedure(memory.entity));
      else detail.append(renderGeneric(memory.entity));
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
      return meta;
    }

    function pill(text, strong = false) {
      const item = document.createElement("span");
      item.className = "pill" + (strong ? " strong" : "");
      item.textContent = text;
      return item;
    }

    function renderGeneric(entity) {
      const box = document.createElement("div");
      box.className = "section open";
      box.append(sectionHeader(primaryName(entity), entity.tag || "memory"));
      const body = document.createElement("div");
      body.className = "section-body";
      appendTextBlocks(body, entity);
      box.append(body);
      return box;
    }

    function renderSchema(node, depth) {
      const section = document.createElement("div");
      section.className = "section" + (depth < 2 ? " open" : "");
      const badge = node.format ? "format: " + node.format : (node.fields && node.fields.length ? node.fields.length + " fields" : "field");
      section.append(sectionHeader(primaryName(node), badge));
      const body = document.createElement("div");
      body.className = "section-body";
      appendTextBlocks(body, node);
      if (node.format === "table") body.append(renderTableFields(node.fields || []));
      else if (node.fields && node.fields.length) {
        const children = document.createElement("div");
        children.className = "child-stack";
        for (const child of node.fields) children.append(renderSchema(child, depth + 1));
        body.append(children);
      }
      section.append(body);
      return section;
    }

    function sectionHeader(text, badge) {
      const button = document.createElement("button");
      button.className = "section-header";
      button.innerHTML = '<span class="chevron">›</span><span class="node-title"></span><span class="pill"></span>';
      button.querySelector(".node-title").textContent = text;
      button.querySelector(".pill").textContent = badge;
      button.addEventListener("click", () => button.parentElement.classList.toggle("open"));
      return button;
    }

    function appendTextBlocks(target, node) {
      appendList(target, "Definitions", node.defines);
      appendList(target, "Assertions", node.asserts);
    }

    function appendList(target, heading, values) {
      if (!values || !values.length) return;
      const title = document.createElement("div");
      title.className = "block-title";
      title.textContent = heading;
      const list = document.createElement("ul");
      list.className = "text-list";
      for (const value of values) {
        const item = document.createElement("li");
        item.textContent = value;
        list.append(item);
      }
      target.append(title, list);
    }

    function renderTableFields(fields) {
      const table = document.createElement("table");
      table.className = "field-table";
      const body = document.createElement("tbody");
      for (const field of fields) {
        const row = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = primaryName(field);
        const td = document.createElement("td");
        const parts = [];
        if (field.defines && field.defines.length) parts.push(field.defines.join("\\n"));
        if (field.asserts && field.asserts.length) parts.push(field.asserts.join("\\n"));
        td.textContent = parts.join("\\n\\n") || "Column";
        row.append(th, td);
        body.append(row);
      }
      table.append(body);
      return table;
    }

    function renderProcedure(entity) {
      const wrap = document.createElement("div");
      appendTextBlocks(wrap, entity);
      if (entity.goals && entity.goals.length) appendList(wrap, "Goals", entity.goals);
      const title = document.createElement("div");
      title.className = "block-title";
      title.textContent = "Flow";
      const flow = document.createElement("div");
      flow.className = "flow";
      for (const step of entity.flow || []) flow.append(renderFlowStep(step));
      wrap.append(title, flow);
      return wrap;
    }

    function renderFlowStep(step) {
      if (typeof step === "string") {
        const item = document.createElement("div");
        item.className = "flow-item";
        item.textContent = step;
        return item;
      }
      if (!step || typeof step !== "object") {
        const item = document.createElement("div");
        item.className = "flow-item";
        item.textContent = String(step);
        return item;
      }
      if (step.tag === "!call") return renderCall(step.value);
      if (step.tag === "!if" || step.tag === "!elseif" || step.tag === "!else" || step.tag === "!while") return renderBranch(step);
      const item = document.createElement("div");
      item.className = "flow-item";
      item.textContent = JSON.stringify(step, null, 2);
      return item;
    }

    function renderCall(name) {
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
          renderNav();
          renderSelected();
        }
      });
      item.append(label, link);
      return item;
    }

    function renderBranch(step) {
      const item = document.createElement("div");
      item.className = "flow-item " + (step.tag === "!while" ? "loop" : "branch");
      const label = document.createElement("div");
      label.className = "flow-label";
      label.textContent = step.tag.replace("!", "");
      item.append(label);
      for (const [key, value] of Object.entries(step)) {
        if (key === "tag") continue;
        const condition = document.createElement("div");
        condition.className = "flow-condition";
        condition.textContent = key;
        item.append(condition);
        const children = document.createElement("div");
        children.className = "flow-children";
        const steps = Array.isArray(value) ? value : [value];
        for (const child of steps) children.append(renderFlowStep(child));
        item.append(children);
      }
      return item;
    }

    function setAllSections(open) {
      for (const section of detail.querySelectorAll(".section")) {
        section.classList.toggle("open", open);
      }
    }
  </script>
</body>
</html>`;
