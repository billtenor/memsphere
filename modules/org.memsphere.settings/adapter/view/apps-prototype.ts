/** Interactive design preview. It never reads or writes App installation state. */
type Draft = { name: string; store: string; option: string; enabled: boolean };
const demos = [
  { id: "expense-tracker", name: "费用记录", package: "org.example.expenses", description: "记录日常支出，和 CLI 共用同一份费用数据。", icon: "stack", version: "1.2.0", model: "example/expense.json", key: "expenses", option: "默认币种", options: ["人民币 · CNY", "美元 · USD", "欧元 · EUR"], stores: ["business/expenses", "business/team-expenses"], configurable: true },
  { id: "task-board", name: "任务看板", package: "org.example.tasks", description: "集中管理项目任务与进度。", icon: "stack", version: "0.8.2", model: "example/task.json", key: "tasks", option: "默认任务视图", options: ["看板", "列表", "日历"], stores: ["business/tasks", "business/team-tasks"], configurable: true },
  { id: "meeting-notes", name: "会议纪要", package: "org.example.notes", description: "整理讨论记录，保留重要结论。", icon: "file-text", version: "1.0.0", model: "", key: "", option: "", options: [], stores: [], configurable: false }
];
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const icon = (name: string) => `<img src="/assets/system-icons/${name}.svg" alt="">`;

export class AppSettingsPrototype {
  #root?: HTMLElement;
  #events?: AbortController;
  #selected = new URLSearchParams(location.search).get("app") ?? "";
  #draft?: Draft;
  #saved?: Draft;
  #notice = "";
  #error = "";
  #query = "";
  #empty = false;
  #confirmLeave = false;
  #tab: "general" | "data" = "general";
  constructor(readonly project: string) {}
  #key(id: string) { return `memsphere.app-settings-prototype.v1:${this.project}:${id}`; }
  #read(id: string): Draft {
    const app = demos.find(a => a.id === id)!;
    try { const saved = JSON.parse(localStorage.getItem(this.#key(id)) ?? "null"); if (saved && typeof saved.name === "string" && typeof saved.store === "string" && typeof saved.option === "string" && typeof saved.enabled === "boolean") return saved; } catch { /* Preview still works without storage. */ }
    return {name: app.name, store: app.stores[0] ?? "", option: app.options[0] ?? "", enabled: true};
  }
  #dirty() { return JSON.stringify(this.#draft) !== JSON.stringify(this.#saved); }
  mount(root: HTMLElement) {
    this.#root = root;
    if (this.#selected && demos.some(a => a.id === this.#selected) && !this.#draft) this.#load(this.#selected);
    this.#render();
  }
  dispose() { this.#events?.abort(); this.#root = undefined; }
  #load(id: string) { this.#selected = id; this.#saved = this.#read(id); this.#draft = {...this.#saved}; this.#notice = ""; this.#error = ""; this.#tab = "general"; }
  #go(id: string) {
    if (this.#dirty()) { this.#confirmLeave = true; this.#render(); return; }
    if (id) this.#load(id); else { this.#selected = ""; this.#draft = undefined; this.#saved = undefined; }
    const url = new URL(location.href); if (id) url.searchParams.set("app", id); else url.searchParams.delete("app");
    history.replaceState(history.state, "", url); this.#render();
  }
  #render() {
    if (!this.#root) return;
    this.#events?.abort(); this.#events = new AbortController();
    const app = demos.find(a => a.id === this.#selected);
    const banner = `<div class="ap-preview"><span>交互原型</span><p>示例 App 与数据，仅用于体验配置流程，不修改真实项目。</p><button class="ap-link" data-do="reset">重置原型</button></div>`;
    this.#root.innerHTML = `<style>${styles}</style><div class="app-preview">${banner}${app ? this.#detail(app) : this.#list()}${this.#confirmLeave ? `<div class="ap-modal-backdrop"><section class="ap-modal" role="dialog" aria-modal="true" aria-labelledby="ap-leave-title"><h3 id="ap-leave-title">还有未保存的修改</h3><p>返回 App 列表前，是否放弃这次修改？</p><div class="ap-actions"><button class="btn" data-do="stay">继续编辑</button><button class="btn primary" data-do="discard-leave">放弃并返回</button></div></section></div>` : ""}</div>`;
    const signal = this.#events.signal;
    this.#root.querySelectorAll<HTMLButtonElement>("[data-open]").forEach(b => b.addEventListener("click", () => this.#go(b.dataset.open!), {signal}));
    this.#root.querySelectorAll<HTMLButtonElement>("[data-do]").forEach(b => b.addEventListener("click", () => this.#action(b.dataset.do!), {signal}));
    this.#root.querySelector<HTMLInputElement>("#ap-search")?.addEventListener("input", e => {
      this.#query = (e.target as HTMLInputElement).value;
      this.#root!.querySelectorAll<HTMLElement>("[data-app-card]").forEach(card => { card.hidden = !card.dataset.appCard!.includes(this.#query.toLowerCase()); });
      this.#root!.querySelector<HTMLElement>("#ap-no-match")!.hidden = demos.some(a => `${a.name} ${a.package}`.toLowerCase().includes(this.#query.toLowerCase()));
    }, {signal});
    this.#root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-draft]").forEach(field => field.addEventListener("input", () => {
      if (!this.#draft) return;
      const key = field.dataset.draft as keyof Draft;
      if (key === "enabled") this.#draft.enabled = (field as HTMLInputElement).checked;
      else this.#draft[key] = field.value;
      this.#root!.querySelector("#ap-dirty")!.textContent = this.#dirty() ? "有未保存的修改" : "配置未修改";
      this.#root!.querySelector<HTMLButtonElement>("[data-do=save]")!.disabled = !this.#dirty();
    }, {signal}));
    window.addEventListener("beforeunload", e => { if (this.#dirty()) { e.preventDefault(); e.returnValue = ""; } }, {signal});
    if (this.#confirmLeave) this.#root.querySelector<HTMLButtonElement>("[data-do=stay]")?.focus();
  }
  #list() {
    return `<header class="ap-heading"><div><div class="ap-eyebrow">当前项目 · ${escape(this.project)}</div><h2>App 配置</h2><p>管理外部安装的 App，每个 App 都有独立的配置。</p></div><button class="btn" data-do="empty">${this.#empty ? "查看示例 App" : "预览未安装状态"}</button></header>
      ${this.#empty ? `<section class="ap-empty">${icon("cube")}<h3>当前项目尚未安装 App</h3><p>安装 App 后，它会出现在这里。你可以在各自的页面管理配置和数据来源。</p><p class="ap-muted">现有安装入口：<code>memsphere app install &lt;App目录&gt;</code></p><button class="btn" data-do="empty">查看示例 App</button></section>` : `<div class="ap-toolbar"><label class="ap-search">${icon("magnifying-glass")}<input id="ap-search" type="search" placeholder="搜索 App 名称或 ID" aria-label="搜索 App" value="${escape(this.#query)}"></label><span class="ap-muted">3 个示例 App</span></div><div class="ap-cards">${demos.map(a => `<button class="ap-card" data-open="${a.id}" data-app-card="${escape(`${a.name} ${a.package}`.toLowerCase())}" ${this.#query && !`${a.name} ${a.package}`.toLowerCase().includes(this.#query.toLowerCase()) ? "hidden" : ""}><span class="ap-app-icon">${icon(a.icon)}</span><div class="ap-card-copy"><div class="ap-card-title"><strong>${escape(a.name)}</strong><span class="ap-badge">示例</span></div><code>${a.package}</code><p>${a.description}</p><div class="ap-card-footer"><span>v${a.version}</span><span>${a.configurable ? "配置与数据来源" : "无可配置项"}</span></div></div><span class="ap-arrow">${icon("caret-down")}</span></button>`).join("")}</div><p id="ap-no-match" class="ap-empty" hidden>没有匹配的 App，试试其他名称。</p><div class="ap-list-note">${icon("cube")}<span>配置按项目分别保存。切换项目后，可以为同一个 App 选择不同的数据来源。</span></div>`}`;
  }
  #detail(app: typeof demos[number]) {
    const draft = this.#draft!;
    return `<button class="ap-back ap-link" data-do="back">${icon("arrow-right")}所有 App</button><header class="ap-detail-heading"><span class="ap-app-icon">${icon(app.icon)}</span><div><h2>${escape(app.name)}<span class="ap-badge">示例</span></h2><p><code>${app.package}</code> · v${app.version} · ${escape(this.project)}</p></div></header>
      ${!app.configurable ? `<section class="ap-empty"><h3>这个 App 没有可配置项</h3><p>App 开发者没有声明需要用户填写的设置。</p><button class="btn" data-do="back">返回 App 列表</button></section>` : `<div class="ap-tabs" role="tablist" aria-label="App 设置分类"><button role="tab" aria-selected="${this.#tab === "general"}" data-do="general">常规设置</button><button role="tab" aria-selected="${this.#tab === "data"}" data-do="data">数据来源</button></div>
      ${this.#notice ? `<div class="ap-success" role="status"><strong>原型配置已保存</strong><p>${escape(this.#notice)}</p></div>` : ""}${this.#error ? `<div class="ap-error" role="alert">${escape(this.#error)}</div>` : ""}
      <section class="ap-panel">${this.#tab === "general" ? `<div class="ap-section-title"><h3>常规设置</h3><p>这些设置只用于当前项目中的${app.name}。</p></div><div class="ap-fields"><label for="ap-name">显示名称<span>在 App 中显示的名称。</span></label><input id="ap-name" data-draft="name" maxlength="60" value="${escape(draft.name)}"><label for="ap-option">${app.option}<span>${app.id === "expense-tracker" ? "创建费用记录时使用的币种。" : "进入 App 时优先显示的视图。"}</span></label><select id="ap-option" data-draft="option">${app.options.map(o => `<option ${o === draft.option ? "selected" : ""}>${o}</option>`).join("")}</select><label for="ap-enabled">显示汇总<span>在 App 首页展示数据概览。</span></label><label class="ap-toggle"><input id="ap-enabled" type="checkbox" data-draft="enabled" ${draft.enabled ? "checked" : ""}>显示数据概览</label></div>` : `<div class="ap-section-title"><h3>Project Store 绑定</h3><p>选择当前项目已有的数据。App 与 CLI 将共用同一份记录。</p></div><div class="ap-requirement"><span>用途 <code>${app.key}</code></span><span>ValueStore</span><span>模型 <code>${app.model}</code></span></div><div class="ap-fields"><label for="ap-store">目标 Store <b>*</b><span>仅展示模型和类型匹配的 Store。</span></label><div><select id="ap-store" data-draft="store"><option value="">请选择一个 Store</option>${app.stores.map(o => `<option ${o === draft.store ? "selected" : ""}>${o}</option>`).join("")}</select><small class="ap-field-help">选择只改变数据来源，不搬迁或删除任何记录。</small></div></div><div class="ap-source"><span>原型已保存的来源</span><strong>${escape(this.#saved!.store || "尚未绑定")}</strong></div><p class="ap-muted ap-callout">更换来源后，旧页面的保存或删除会被拒绝。刷新并检查新目标后，才能重新提交。</p>`}</section>
      <footer class="ap-savebar"><span id="ap-dirty" class="ap-muted">${this.#dirty() ? "有未保存的修改" : "配置未修改"}</span><div class="ap-actions"><button class="btn" data-do="cancel">取消修改</button><button class="btn primary" data-do="save" ${this.#dirty() ? "" : "disabled"}>保存配置</button></div></footer><p class="ap-footnote">保存仅影响浏览器中的原型数据，不会安装 App 或修改真实 Store。</p>`}`;
  }
  #action(action: string) {
    if (action === "back") return this.#go("");
    if (action === "stay") { this.#confirmLeave = false; this.#render(); return; }
    if (action === "discard-leave") { this.#draft = this.#saved ? {...this.#saved} : undefined; this.#confirmLeave = false; return this.#go(""); }
    if (action === "general" || action === "data") this.#tab = action;
    if (action === "empty") this.#empty = !this.#empty;
    if (action === "cancel") { this.#draft = {...this.#saved!}; this.#notice = ""; this.#error = ""; }
    if (action === "reset") {
      for (const a of demos) localStorage.removeItem(this.#key(a.id));
      this.#selected = ""; this.#draft = undefined; this.#saved = undefined; this.#notice = ""; this.#error = ""; this.#empty = false; this.#query = "";
      const url = new URL(location.href); url.searchParams.delete("app"); history.replaceState(history.state, "", url);
    }
    if (action === "save") {
      this.#error = "";
      if (!this.#draft!.name.trim()) this.#error = "请填写显示名称。";
      else if (!this.#draft!.store) { this.#tab = "data"; this.#error = "请选择一个目标 Store，已有配置未修改。"; }
      else try {
        localStorage.setItem(this.#key(this.#selected), JSON.stringify(this.#draft));
        this.#saved = {...this.#draft!};
        this.#notice = `已保存来源：${this.#saved.store}。正式版本会在需要时提示“待重启”；本原型没有真实运行中的 App。`;
      } catch { this.#error = "浏览器无法保存原型数据，请检查存储权限。"; }
    }
    this.#render();
  }
}
const styles = `
.app-preview{max-width:960px;margin:0 auto;color:var(--mem-view-color-text);font-size:14px;line-height:1.6}.app-preview *{box-sizing:border-box}.app-preview img{width:18px;height:18px}.app-preview button,.app-preview input,.app-preview select{font:inherit}.app-preview button{cursor:pointer}.app-preview [hidden]{display:none!important}.ap-preview{display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--mem-view-color-border);border-radius:9px;background:var(--mem-view-color-subtle);font-size:12px;margin-bottom:28px}.ap-preview>span{white-space:nowrap;font-weight:650}.ap-preview p{margin:0;flex:1;color:var(--mem-view-color-text-muted)}.ap-link{display:inline-flex;gap:7px;align-items:center;background:none;border:0;padding:0;color:var(--mem-view-color-accent);font-size:12px}.ap-heading{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:24px}.ap-eyebrow{font-size:12px;color:var(--mem-view-color-text-muted);margin-bottom:5px}.app-preview h2{font-size:27px;letter-spacing:-.03em;margin:0 0 6px;line-height:1.3}.ap-heading p,.ap-detail-heading p{color:var(--mem-view-color-text-muted);margin:0;font-size:13px}.ap-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}.ap-search{display:flex;align-items:center;gap:8px;border:1px solid var(--mem-view-color-border);background:var(--mem-view-color-surface);border-radius:8px;padding:8px 11px;width:min(100%,340px)}.ap-search input{border:0;outline:0;min-width:0;flex:1;color:inherit;background:none}.ap-cards{display:grid;gap:12px}.ap-card{width:100%;display:flex;text-align:left;gap:16px;padding:20px;border:1px solid var(--mem-view-color-border);border-radius:12px;background:var(--mem-view-color-surface);color:inherit;transition:border-color .15s}.ap-card:hover{border-color:var(--mem-view-color-accent)}.ap-app-icon{width:46px;height:46px;display:grid;place-items:center;flex-shrink:0;border:1px solid var(--mem-view-color-border);border-radius:12px;background:var(--mem-view-color-subtle)}.ap-app-icon img{width:23px;height:23px}.ap-card-copy{min-width:0;flex:1}.ap-card-title{display:flex;align-items:center;gap:10px;margin-bottom:3px}.ap-card-title strong{font-size:16px}.ap-badge{display:inline-block;vertical-align:middle;font-weight:500;line-height:1.6;border:1px solid var(--mem-view-color-border);padding:1px 7px;border-radius:5px;font-size:10px;color:var(--mem-view-color-text-muted);margin-left:6px}.app-preview code{font:11px ui-monospace,SFMono-Regular,monospace;overflow-wrap:anywhere}.ap-card code{color:var(--mem-view-color-text-muted)}.ap-card p{font-size:13px;margin:10px 0;color:var(--mem-view-color-text-muted)}.ap-card-footer{display:flex;gap:14px;font-size:11px;color:var(--mem-view-color-text-muted)}.ap-arrow{align-self:center}.ap-arrow img{transform:rotate(-90deg)}.ap-muted{font-size:12px;color:var(--mem-view-color-text-muted)}.ap-list-note{display:flex;align-items:start;gap:9px;color:var(--mem-view-color-text-muted);margin:24px 0;font-size:12px}.ap-list-note img{flex-shrink:0}.ap-back{margin-bottom:20px}.ap-back img{transform:rotate(180deg)}.ap-detail-heading{display:flex;align-items:center;gap:15px;margin-bottom:25px}.ap-detail-heading h2{font-size:24px}.ap-tabs{display:flex;gap:24px;border-bottom:1px solid var(--mem-view-color-border);margin-bottom:24px}.ap-tabs button{padding:10px 1px;background:none;border:0;border-bottom:2px solid transparent;color:var(--mem-view-color-text-muted)}.ap-tabs [aria-selected=true]{border-bottom-color:var(--mem-view-color-accent);color:var(--mem-view-color-text);font-weight:650}.ap-panel{border:1px solid var(--mem-view-color-border);background:var(--mem-view-color-surface);border-radius:12px;padding:24px}.ap-section-title{margin-bottom:26px}.ap-section-title h3{margin:0 0 4px;font-size:16px}.ap-section-title p{margin:0;font-size:12px;color:var(--mem-view-color-text-muted)}.ap-fields{display:grid;grid-template-columns:minmax(180px,.8fr) minmax(0,1.2fr);align-items:start;column-gap:24px;row-gap:25px}.ap-fields>label{font-size:13px;font-weight:600;padding-top:8px}.ap-fields>label span{display:block;font-size:12px;color:var(--mem-view-color-text-muted);font-weight:400;margin-top:4px}.ap-fields input:not([type=checkbox]),.ap-fields select{min-width:0;width:100%;border:1px solid var(--mem-view-color-border);border-radius:7px;padding:8px 11px;background:var(--mem-view-color-canvas);color:inherit}.ap-fields .ap-toggle{font-weight:400;display:flex;gap:9px;align-items:center}.ap-field-help{display:block;font-size:11px;color:var(--mem-view-color-text-muted);margin-top:8px}.ap-requirement{display:flex;gap:15px;flex-wrap:wrap;font-size:11px;background:var(--mem-view-color-subtle);border-radius:7px;padding:10px 12px;margin-bottom:25px;color:var(--mem-view-color-text-muted)}.ap-source{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:28px;padding-top:18px;border-top:1px solid var(--mem-view-color-border);font-size:12px}.ap-source span{color:var(--mem-view-color-text-muted)}.ap-callout{margin:20px 0 0}.ap-savebar{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:20px 0}.ap-actions{display:flex;gap:9px}.ap-footnote{font-size:11px;color:var(--mem-view-color-text-muted);margin:0}.ap-success,.ap-error{padding:13px 16px;border:1px solid var(--mem-view-color-border);border-left:3px solid var(--mem-view-color-accent);border-radius:8px;background:var(--mem-view-color-subtle);margin-bottom:16px;font-size:12px}.ap-success p{margin:4px 0 0}.ap-error{border-left-color:var(--mem-view-color-danger);color:var(--mem-view-color-danger)}.ap-empty{text-align:center;border:1px dashed var(--mem-view-color-border);padding:50px 24px;border-radius:12px}.ap-empty>img{width:30px;height:30px}.ap-empty h3{font-size:17px;margin-bottom:8px}.ap-empty p{color:var(--mem-view-color-text-muted);font-size:13px;max-width:440px;margin:10px auto 22px}.app-preview button:focus-visible,.app-preview input:focus-visible,.app-preview select:focus-visible{outline:2px solid var(--mem-view-color-accent);outline-offset:3px}.ap-modal-backdrop{position:fixed;inset:0;background:#0005;display:grid;place-items:center;z-index:1000;padding:20px}.ap-modal{background:var(--mem-view-color-surface);border:1px solid var(--mem-view-color-border);border-radius:13px;padding:25px;max-width:420px;width:100%;box-shadow:var(--mem-view-shadow-popover)}.ap-modal h3{margin-top:0}.ap-modal p{color:var(--mem-view-color-text-muted);margin:12px 0 24px}.ap-modal .ap-actions{justify-content:flex-end}@media(max-width:640px){.ap-preview{align-items:flex-start;flex-wrap:wrap}.ap-preview p{min-width:160px}.ap-heading{align-items:flex-start;flex-direction:column}.ap-fields{grid-template-columns:1fr;row-gap:9px}.ap-fields>input,.ap-fields>select,.ap-fields>div,.ap-fields>.ap-toggle{margin-bottom:16px}.ap-panel{padding:18px}.ap-card{padding:16px;gap:12px}.ap-savebar{flex-wrap:wrap}.ap-source{align-items:flex-start;flex-direction:column}.ap-toolbar{align-items:flex-start;flex-direction:column}}
`;
