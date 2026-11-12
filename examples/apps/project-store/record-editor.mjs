/** Example caller: a changed binding refreshes the record and requires a new decision. */
export function createRecordEditor({ invoke, notify, showRecord, confirmTarget }) {
  let current;
  let confirmationRequired = false;

  async function load(id) {
    current = undefined;
    const loaded = await invoke("read", { id });
    current = { ...loaded, id };
    showRecord(structuredClone(current));
    return structuredClone(current);
  }

  async function change(operation, value) {
    if (!current) throw new Error("请先读取记录，再保存或删除。");
    const selected = current;
    if (confirmationRequired && !await confirmTarget({ operation, storeId: selected.storeId, record: selected.record })) {
      notify("已取消，本次未修改当前目标的数据。");
      return { status: "cancelled" };
    }
    try {
      await invoke(operation, { id: selected.id, token: selected.token, ...(operation === "save" ? { value } : {}) });
    } catch (error) {
      if (error.code !== "APP_STORE_BINDING_CHANGED") throw error;
      notify("数据来源已改变，请刷新并重新确认目标后再保存或删除。");
      confirmationRequired = true;
      const refreshed = await load(selected.id);
      notify(`已刷新，当前数据源：${refreshed.storeId}。请检查记录，再重新发起保存或删除；不会自动重试刚才的操作。`);
      return { status: "binding-changed", current: refreshed };
    }
    confirmationRequired = false;
    if (operation === "remove") current = undefined;
    notify(operation === "save" ? "保存成功。" : "删除成功。");
    return { status: operation === "save" ? "saved" : "removed" };
  }

  return { load, save: value => change("save", value), remove: () => change("remove") };
}

export function createHttpInvoker({ baseUrl, project, headers = {} }) {
  const origin = new URL(baseUrl).origin;
  return async (operation, input) => {
    const response = await fetch(new URL(`/api/projects/${encodeURIComponent(project)}/apps/org.example.project-store/operations/${operation}`, origin), {
      method: "POST",
      headers: { "content-type": "application/json", origin, ...headers },
      body: JSON.stringify({ input })
    });
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(typeof body.error === "string" ? body.error : "App 请求失败"), { code: body.code });
    return body.result;
  };
}
