import { defineViewPlugin, slots } from "@memsphere/view-sdk";

export default defineViewPlugin({
  apiVersion: 1, inject: ["slots", "router", "api", "ui"], uiVersion: 1,
  apply(ctx) {
    if (!ctx.api || !ctx.router || !ctx.ui) throw new Error("Expense App requires API, router and UI services");
    const route = ctx.router.register({ id: "expenses", path: "/expenses" });
    ctx.slots.register(slots.navigationPrimary, { id: "expense.navigation", order: 80,
      value: { label: { text: "费用 / Expenses" }, icon: { kind: "system", name: "file-text" }, route: route.to() } });
    ctx.slots.register(slots.mainView, { id: "expense.main", key: route.key, when: route.activation, value: {
      async mount({ element }) {
        let disposed = false;
        element.dataset.expenseApp = "";
        const style = document.createElement("style");
        style.textContent = '[data-expense-app] {padding:var(--mem-view-space-5); color:var(--mem-view-color-text)} .expense-form {display:flex; flex-wrap:wrap; gap:var(--mem-view-space-3); align-items:end} .expense-field {display:grid; gap:var(--mem-view-space-2)} .expense-field input {max-width:100%;padding:var(--mem-view-space-2);background:var(--mem-view-color-surface);color:var(--mem-view-color-text);border:1px solid var(--mem-view-color-border);border-radius:var(--mem-view-radius-sm)} .expense-record {display:flex;flex-wrap:wrap;gap:var(--mem-view-space-3);align-items:center;padding:var(--mem-view-space-3);border-bottom:1px solid var(--mem-view-color-border)}';
        const heading = document.createElement("h2"); heading.textContent = "费用记录 / Expenses";
        const form = document.createElement("form"); form.className = "expense-form";
        function field(labelText, name, type) {
          const label = document.createElement("label"); label.className = "expense-field"; label.textContent = labelText;
          const input = document.createElement("input"); input.name = name; input.type = type; input.required = true;
          label.append(input); form.append(label); return input;
        }
        const description = field("说明 / Description", "description", "text");
        const amount = field("金额 / Amount", "amount", "number"); amount.step = "0.01"; amount.min = "0.01";
        const message = document.createElement("p"); message.setAttribute("role", "status");
        const records = document.createElement("div"); records.setAttribute("aria-label", "费用记录 / Expense records");
        async function refresh() {
          try {
            const result = await ctx.api.invoke("list", {}); if (disposed) return;
            records.replaceChildren(); message.textContent = result.nextCursor ? "显示前 100 条；CLI 可继续分页 / First 100 records" : "";
            if (!result.records.length) records.append(ctx.ui.emptyState({ title: { text: "暂无费用 / No expenses" } }));
            for (const record of result.records) {
              const row = document.createElement("div"); row.className = "expense-record";
              const text = document.createElement("span"); text.textContent = `${record.value.description} · ${record.value.amount} · ${record.value.status}`; row.append(text);
              if (record.value.status === "draft") row.append(ctx.ui.button({ label: { text: "提交 / Submit" }, async run() {
                try { await ctx.api.invoke("submit", { id: record.id, revision: record.revision }); await refresh(); }
                catch (error) { if (!disposed) message.textContent = error.message; }
              } }));
              records.append(row);
            }
          } catch (error) { if (!disposed) message.textContent = error.message; }
        }
        async function create(event) {
          event?.preventDefault(); if (!form.reportValidity()) return;
          try { await ctx.api.invoke("create", { description: description.value, amount: Number(amount.value) }); if (!disposed) { form.reset(); await refresh(); } }
          catch (error) { if (!disposed) message.textContent = error.message; }
        }
        form.append(ctx.ui.button({ label: { text: "录入 / Add expense" }, run: () => create() }, { tone: "primary" }));
        form.onsubmit = create;
        element.append(style, heading, form, ctx.ui.button({ label: { text: "刷新 / Refresh" }, run: refresh }), message, records);
        await refresh();
        return () => { disposed = true; form.onsubmit = null; element.replaceChildren(); delete element.dataset.expenseApp; };
      }
    } });
  }
});
